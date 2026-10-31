"""
Haalt de actuele bezetting van post Nieuw-Beijerland op uit Pre-Com
en schrijft alleen geaggregeerde cijfers (aantallen per functie) naar bezetting.js.

Inloggegevens komen uit omgevingsvariabelen (in GitHub: Settings > Secrets):
  PRECOM_USER, PRECOM_PASS
Optioneel: PRECOM_GROUP_ID (standaard 4915), PRECOM_DAGEN (standaard 28)

Er worden GEEN namen opgeslagen of gelogd: alleen tellingen.
"""
import json, os, sys, re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from html.parser import HTMLParser
import requests

BASIS = "https://portal.pre-com.nl/PreCom/"
TZ = ZoneInfo("Europe/Amsterdam")
GROEP = int(os.environ.get("PRECOM_GROUP_ID", "4915"))
NODE = os.environ.get("PRECOM_NODE_ID", "2123")      # post Nieuw-Beijerland in de Pre-Com-boom
MODULE = os.environ.get("PRECOM_MODULE_ID", "79")    # module 'Bezetting'
DAGEN = int(os.environ.get("PRECOM_DAGEN", "28"))
UIT = os.environ.get("PRECOM_OUTPUT", "bezetting.js")


class LoginForm(HTMLParser):
    """Verzamelt verborgen velden (zoals een verificatietoken) uit het loginformulier."""
    def __init__(self):
        super().__init__(); self.velden = {}; self.in_form = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form" and "Login" in (a.get("action") or "") or a.get("id") == "frmLogin":
            self.in_form = True
        if tag == "input" and a.get("type") == "hidden" and a.get("name"):
            if self.in_form or a["name"] == "__RequestVerificationToken":
                self.velden.setdefault(a["name"], a.get("value", ""))
    def handle_endtag(self, tag):
        if tag == "form": self.in_form = False


def fout(msg):
    print("FOUT:", msg); sys.exit(1)


def inloggen(s):
    gebruiker, wachtwoord = os.environ.get("PRECOM_USER"), os.environ.get("PRECOM_PASS")
    if not gebruiker or not wachtwoord:
        fout("PRECOM_USER en/of PRECOM_PASS ontbreken (zet ze in GitHub Secrets).")
    r = s.get(BASIS + "Account/Login", timeout=30); r.raise_for_status()
    p = LoginForm(); p.feed(r.text)
    data = dict(p.velden); data.update({"UserName": gebruiker, "Password": wachtwoord})
    r = s.post(BASIS + "Account/PostLogin", data=data, timeout=30,
               headers={"X-Requested-With": "XMLHttpRequest", "Referer": BASIS + "Account/Login"})
    r.raise_for_status()
    try:
        j = r.json()
    except ValueError:
        fout(f"Onverwacht antwoord bij inloggen (HTTP {r.status_code}).")
    if not (j.get("Succesfully") or j.get("Successfully")):
        fout("Inloggen mislukt: " + str(j.get("Message") or "controleer gebruikersnaam/wachtwoord."))
    # Pre-Com onthoudt per sessie welke post en module geselecteerd zijn; zonder deze stap geeft
    # het bezettingsoverzicht 403.
    xhr = {"X-Requested-With": "XMLHttpRequest", "Referer": BASIS}
    s.get(BASIS, timeout=30)
    for pad in (f"Navigation/NavigateToNode?nodeId={NODE}", f"Navigation/NavigateToModule?moduleId={MODULE}",
                "Occupancy/Overview", f"Occupancy/GetVehicles?groupId={GROEP}"):
        r = s.get(BASIS + pad, headers=xhr, timeout=30)
        if r.status_code >= 400:
            fout(f"Stap {pad.split('?')[0]} gaf HTTP {r.status_code}.")


def bezetting(s, datums):
    data = [("groupId", str(GROEP))] + [("selectedDates[]", d.strftime("%Y-%m-%d")) for d in datums]
    r = s.post(BASIS + "Occupancy/GetOccupancy", data=data, timeout=60,
               headers={"X-Requested-With": "XMLHttpRequest", "Referer": BASIS})
    if r.status_code == 403:
        fout("Pre-Com weigert het bezettingsoverzicht (403). Controleer PRECOM_NODE_ID/PRECOM_MODULE_ID.")
    r.raise_for_status()
    if "json" not in r.headers.get("Content-Type", ""):
        fout("Geen JSON terug van Pre-Com (sessie verlopen of geen rechten op deze groep?).")
    return r.json()


def slot_index(k):
    k = k.rjust(4, "0"); return int(k[:2]) * 4 + int(k[2:]) // 15


def main():
    nu = datetime.now(TZ); vandaag = nu.date()
    s = requests.Session(); s.headers["User-Agent"] = "NBL-portaal/1.0 (bezettingsoverzicht)"
    inloggen(s)

    # 1. Actuele stand
    j = bezetting(s, [vandaag])
    totals = sorted(j.get("TotalsOccupancy") or [], key=lambda t: t.get("OrderBy", 0))
    if not totals:
        fout("Geen functies gevonden in Pre-Com-antwoord.")
    functies = [{"id": t["ServiceFunctionID"], "label": t["Label"], "beschikbaar": t["Available"],
                 "nodig": t["Necessary"], "totaal": t["Configured"]} for t in totals]
    ts = {f["id"]: f["nodig"] for f in functies if f["nodig"] > 0}

    # 2. Vooruitblik: per kwartier of de TS de komende periode volledig bezet kan uitrukken
    labels = {f["id"]: f["label"] for f in functies}
    toekomst = [vandaag + timedelta(days=i) for i in range(0, DAGEN)]
    ok = [[0] * 24 for _ in range(7)]; tot = [[0] * 24 for _ in range(7)]
    ok_f = {fid: 0 for fid in ts}; n_slots = 0            # per functie: aantal kwartieren voldoende bezet
    for i in range(0, len(toekomst), 7):
        blok = bezetting(s, toekomst[i:i + 7])
        per_dag = {}
        for item in blok.get("AvailablePeople") or []:
            fid, dag = item.get("ServiceFunctionID"), item.get("DateOfDay")
            if fid in ts and dag:
                per_dag.setdefault(dag, {})[fid] = {slot_index(c["K"]): c["V"] for c in item.get("DayCounters", [])}
        for dag, f in per_dag.items():
            d = datetime.strptime(dag, "%y%m%d"); wd = d.weekday()
            for slot in range(96):
                bezet = all(f.get(fid, {}).get(slot, 0) >= nodig for fid, nodig in ts.items())
                tot[wd][slot // 4] += 1; ok[wd][slot // 4] += bezet
                n_slots += 1
                for fid, nodig in ts.items():
                    if f.get(fid, {}).get(slot, 0) >= nodig:
                        ok_f[fid] += 1
    heatmap = [[round(100 * ok[d][u] / tot[d][u]) if tot[d][u] else None for u in range(24)] for d in range(7)]
    alle_ok = sum(map(sum, ok)); alle = sum(map(sum, tot))
    # Dekking per functie over de hele periode; de laagste is de 'smalste schakel'.
    dekking_per_rol = sorted(
        ({"label": labels.get(fid, str(fid)), "pct": round(100 * ok_f[fid] / n_slots)} for fid in ts),
        key=lambda r: r["pct"]) if n_slots else []

    uit = {
        "bron": "Pre-Com",
        "bijgewerkt": nu.strftime("%Y-%m-%dT%H:%M"),
        "functies": functies,
        "ts_bezet_pct": round(100 * alle_ok / alle) if alle else None,
        "periode_dagen": DAGEN,
        "heatmap": heatmap,
        "dekking_per_rol": dekking_per_rol,
    }
    with open(UIT, "w", encoding="utf-8") as fh:
        fh.write("/* Automatisch gegenereerd uit Pre-Com — alleen aantallen, geen namen. Niet handmatig bewerken. */\n")
        fh.write("window.NBL_BEZETTING = " + json.dumps(uit, ensure_ascii=False) + ";\n")
    print("OK:", ", ".join(f"{f['label']} {f['beschikbaar']}/{f['nodig']}" for f in functies),
          f"| TS bezet {uit['ts_bezet_pct']}% over {DAGEN} dagen")


if __name__ == "__main__":
    main()
