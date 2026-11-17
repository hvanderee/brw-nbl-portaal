// Supabase Edge Function: berekent de uitruk-aggregaten uit de ENIGE bron van waarheid
// (VP: vp_opkomst + vp_incidenten, plus de handmatige correcties: uitruk_incidenten/deelnemers/verbergen)
// en schrijft het resultaat als één JSON-rij naar public.uitruk_aggregaten. Het portaal leest die en
// legt de cijfers over data.js/beschikbaarheid.js heen. Zo werkt een toegevoegde uitruk overal door.
//
// Draait server-side met service_role (ziet dus alle opkomstregels, RLS-vrij) en levert alleen
// geaggregeerde cijfers op — geen persoonsregels. Aanroepen: na elke Beheer-wijziging (ploeg_beheer)
// en 1x/dag via pg_cron. Zet Verify JWT op OFF.
//
// Verificatie: de logica is offline 1-op-1 getoetst aan beschikbaarheid.js (20/20 leden exact) en
// data.js (per_maand, prioriteit, denominatoren exact).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JAAR = Number(Deno.env.get("NBL_JAAR") ?? "2026");
const AMS = "Europe/Amsterdam";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const RANG: Record<number, number> = { 3: 3, 4: 2, 1: 1 };

// Datumdelen in Amsterdamse tijd (maand, uur, weekend) — zelfde conventie als het portaal.
function deelParts(iso: string) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("nl-NL", { timeZone: AMS, weekday: "short", hour: "2-digit", hour12: false, month: "2-digit" }).formatToParts(d);
  const o: Record<string, string> = {};
  for (const p of f) o[p.type] = p.value;
  const hour = parseInt(o.hour) % 24;
  const weekend = o.weekday === "za" || o.weekday === "zo";
  return { hour, weekend, maand: parseInt(o.month) };
}
const isODW = (iso: string) => { const { hour, weekend } = deelParts(iso); return !weekend && hour >= 7 && hour < 18; };
const isP1 = (inc: { prioriteit?: string | null }) => { const p = String(inc.prioriteit ?? "").toUpperCase(); return p.includes("1"); };
function dagdeel(iso: string) { const { hour } = deelParts(iso); if (hour >= 6 && hour < 12) return "Ochtend"; if (hour >= 12 && hour < 18) return "Middag"; if (hour >= 18 && hour < 24) return "Avond"; return "Nacht"; }
const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;

type Inc = { gebeurtenis_id: number; begin_op: string; prioriteit: string | null; object_functie: string | null; classificatie: string | null; city_name: string | null; street_full: string | null };
type Opk = { gebeurtenis_id: number; user_id: number; opkomst: number; eenheid_id: number | null; uitgerukt_op: string | null };
type Row = { opkomst: number; gid: number | null; hid: number | null; eenheid_id: number | null; inc: { begin_op: string; prioriteit: string | null } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

    // Alle brondata ophalen (gepagineerd waar nodig).
    async function alles(tabel: string, kolommen: string) {
      const uit: Record<string, unknown>[] = [];
      for (let van = 0; ; van += 1000) {
        const { data, error } = await admin.from(tabel).select(kolommen).range(van, van + 999);
        if (error) throw new Error(`${tabel}: ${error.message}`);
        uit.push(...(data ?? [])); if (!data || data.length < 1000) break;
      }
      return uit;
    }
    const [incRows, opkRows, leden, handInc, handDeel, verb] = await Promise.all([
      alles("vp_incidenten", "gebeurtenis_id,begin_op,prioriteit,object_functie,classificatie,city_name,street_full"),
      alles("vp_opkomst", "gebeurtenis_id,user_id,opkomst,eenheid_id,uitgerukt_op"),
      alles("leden", "naam,voornaam,achternaam,vp_id"),
      alles("uitruk_incidenten", "id,begin_op,tijd_bekend,prioriteit,melding,straat,plaats"),
      alles("uitruk_deelnemers", "incident_id,user_id,opkomst,rol"),
      alles("uitruk_verbergen", "user_id,gebeurtenis_id,eenheid_id"),
    ]);

    const incById = new Map<number, Inc>();
    for (const i of incRows as unknown as Inc[]) incById.set(i.gebeurtenis_id, i);
    const handById = new Map<number, Record<string, unknown>>();
    for (const h of handInc) handById.set(Number(h.id), h);
    // handmatige deelnemers per user_id
    const handPerUser = new Map<string, Row[]>();
    for (const d of handDeel) {
      const hi = handById.get(Number(d.incident_id)); if (!hi) continue;
      const r: Row = { opkomst: Number(d.opkomst), gid: null, hid: Number(d.incident_id), eenheid_id: null, inc: { begin_op: String(hi.begin_op), prioriteit: hi.prioriteit as string } };
      const k = String(d.user_id); (handPerUser.get(k) ?? handPerUser.set(k, []).get(k)!).push(r);
    }
    // VP opkomst per user_id
    const opkPerUser = new Map<string, Opk[]>();
    for (const o of opkRows as unknown as Opk[]) { const k = String(o.user_id); (opkPerUser.get(k) ?? opkPerUser.set(k, []).get(k)!).push(o); }
    // verbergen per user_id
    const verbPerUser = new Map<string, { gid: number; eenheid: number | null }[]>();
    for (const v of verb) { const k = String(v.user_id); (verbPerUser.get(k) ?? verbPerUser.set(k, []).get(k)!).push({ gid: Number(v.gebeurtenis_id), eenheid: v.eenheid_id == null ? null : Number(v.eenheid_id) }); }

    // Post-overlay rijen van één lid (zelfde logica als "Mijn uitrukken").
    function overlay(uid: string): Row[] {
      let rows: Row[] = (opkPerUser.get(uid) ?? []).map((o) => {
        const i = incById.get(o.gebeurtenis_id); return i ? { opkomst: o.opkomst, gid: o.gebeurtenis_id, hid: null, eenheid_id: o.eenheid_id, inc: { begin_op: i.begin_op, prioriteit: i.prioriteit } } : null;
      }).filter((x): x is Row => !!x);
      const V = verbPerUser.get(uid) ?? [];
      const wegGid = new Set<string>(), wegKey = new Set<string>();
      for (const v of V) { if (v.eenheid != null) wegKey.add(v.gid + "|" + v.eenheid); else wegGid.add(String(v.gid)); }
      rows = rows.filter((r) => { if (wegGid.has(String(r.gid))) return false; if (r.eenheid_id != null && wegKey.has(r.gid + "|" + r.eenheid_id)) return false; return true; });
      rows = rows.concat(handPerUser.get(uid) ?? []);
      // dedup VP op (gid,eenheid), hoogste rang
      const perKey = new Map<string, Row>(); const losse: Row[] = [];
      for (const r of rows) { if (r.gid == null || r.eenheid_id == null) { losse.push(r); continue; } const k = r.gid + "|" + r.eenheid_id; const b = perKey.get(k); if (!b || (RANG[r.opkomst] || 0) > (RANG[b.opkomst] || 0)) perKey.set(k, r); }
      return [...perKey.values(), ...losse].filter((r) => new Date(r.inc.begin_op).getFullYear() === JAAR);
    }

    const ledNaam = (l: Record<string, unknown>) => (l.naam as string) || `${l.voornaam ?? ""} ${l.achternaam ?? ""}`.trim();
    const ploeg = leden.filter((l) => l.vp_id);

    // Overlay per lid één keer berekenen en cachen (zelfde logica als "Mijn uitrukken").
    const overlayByUid = new Map<string, Row[]>();
    for (const l of ploeg) overlayByUid.set(String(l.vp_id), overlay(String(l.vp_id)));

    // Ploegtotaal = het lid met de MEESTE uitrukken ná overlay. Een lid dat het hele jaar in de
    // ploeg zit, is voor elk incident gealarmeerd, dus zijn overlay bevat álle ploeg-incidenten.
    // Zo volgt het totaal automatisch de data (57 → 60 → …) i.p.v. vast te zitten op een referentie
    // die op aantal VP-rijen is gekozen.
    let ref = ""; let refN = -1;
    for (const l of ploeg) { const uid = String(l.vp_id); const m = (overlayByUid.get(uid) ?? []).length; if (m > refN) { refN = m; ref = uid; } }
    const refRows = overlayByUid.get(ref) ?? [];
    const n = refRows.length;
    const nP1 = refRows.filter((r) => isP1(r.inc)).length;
    const nODW = refRows.filter((r) => isODW(r.inc.begin_op)).length;
    const nODW_p1 = refRows.filter((r) => isODW(r.inc.begin_op) && isP1(r.inc)).length;
    const nOverig_p1 = refRows.filter((r) => !isODW(r.inc.begin_op) && isP1(r.inc)).length;
    const vandaagISO = new Intl.DateTimeFormat("sv-SE", { timeZone: AMS, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const meta = {
      n_uitrukken: n, n_prio1: nP1, n_prio2: n - nP1, n_odw: nODW, n_overig: n - nODW,
      n_odw_p1: nODW_p1, n_odw_p2: nODW - nODW_p1, n_overig_p1: nOverig_p1, n_overig_p2: (n - nODW) - nOverig_p1,
      pct_odw: pct(nODW, n), periode_start: `${JAAR}-01-01`, periode_eind: vandaagISO,
    };

    // Per-lid deelname (mee = uitgerukt / opkomst 3).
    const ledenUit: Record<string, unknown>[] = [];
    const som: Record<string, number> = {};
    for (const l of ploeg) {
      const rows = overlayByUid.get(String(l.vp_id)) ?? [];
      const uit = rows.filter((r) => r.opkomst === 3);
      const odw = uit.filter((r) => isODW(r.inc.begin_op)), overig = uit.filter((r) => !isODW(r.inc.begin_op));
      const mee_p1 = uit.filter((r) => isP1(r.inc)).length;
      const odw_p1 = odw.filter((r) => isP1(r.inc)).length, overig_p1 = overig.filter((r) => isP1(r.inc)).length;
      const rec: Record<string, number> = {
        mee_totaal: uit.length, mee_p1, mee_p2: uit.length - mee_p1, mee_odw: odw.length, mee_overig: overig.length,
        odw_p1, odw_p2: odw.length - odw_p1, overig_p1, overig_p2: overig.length - overig_p1,
      };
      for (const k in rec) som[k] = (som[k] || 0) + rec[k];
      ledenUit.push({
        naam: ledNaam(l),
        mee_totaal: rec.mee_totaal, pct_mee_totaal: pct(rec.mee_totaal, meta.n_uitrukken),
        mee_p1: rec.mee_p1, pct_mee_p1: pct(rec.mee_p1, meta.n_prio1),
        mee_p2: rec.mee_p2, pct_mee_p2: pct(rec.mee_p2, meta.n_prio2),
        mee_odw: rec.mee_odw, pct_mee_odw: pct(rec.mee_odw, meta.n_odw),
        mee_overig: rec.mee_overig, pct_mee_overig: pct(rec.mee_overig, meta.n_overig),
        odw_p1: rec.odw_p1, pct_odw_p1: pct(rec.odw_p1, meta.n_odw_p1),
        odw_p2: rec.odw_p2, pct_odw_p2: pct(rec.odw_p2, meta.n_odw_p2),
        overig_p1: rec.overig_p1, pct_overig_p1: pct(rec.overig_p1, meta.n_overig_p1),
        overig_p2: rec.overig_p2, pct_overig_p2: pct(rec.overig_p2, meta.n_overig_p2),
      });
    }
    const N = ploeg.length || 1;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const gem = {
      mee_totaal: r1(som.mee_totaal / N), pct_totaal: pct(som.mee_totaal / N, meta.n_uitrukken),
      mee_p1: r1(som.mee_p1 / N), pct_p1: pct(som.mee_p1 / N, meta.n_prio1),
      mee_p2: r1(som.mee_p2 / N), pct_p2: pct(som.mee_p2 / N, meta.n_prio2),
      mee_odw: r1(som.mee_odw / N), pct_odw: pct(som.mee_odw / N, meta.n_odw),
      mee_overig: r1(som.mee_overig / N), pct_overig: pct(som.mee_overig / N, meta.n_overig),
      odw_p1: r1(som.odw_p1 / N), pct_odw_p1: pct(som.odw_p1 / N, meta.n_odw_p1),
      odw_p2: r1(som.odw_p2 / N), pct_odw_p2: pct(som.odw_p2 / N, meta.n_odw_p2),
      overig_p1: r1(som.overig_p1 / N), pct_overig_p1: pct(som.overig_p1 / N, meta.n_overig_p1),
      overig_p2: r1(som.overig_p2 / N), pct_overig_p2: pct(som.overig_p2 / N, meta.n_overig_p2),
    };

    // Ploegverdelingen uit het referentielid (elk incident één keer met zijn datum/prio).
    const per_maand = Array(12).fill(0);
    const dd: Record<string, number> = { Ochtend: 0, Middag: 0, Avond: 0, Nacht: 0 };
    for (const r of refRows) { per_maand[deelParts(r.inc.begin_op).maand - 1]++; dd[dagdeel(r.inc.begin_op)]++; }

    // ===== Per-incident cijfers (live) voor de overige widgets: uitruktijd, opkomst, meldingstypen,
    // recente uitrukken, meerjaren. De ploeg-incidentenset leiden we af uit het referentielid (de
    // incidenten waar hij bij betrokken was = de ploeg-uitrukken), daarna verrijken we elk incident
    // met de volledige VP/handmatige-gegevens. =====
    const ploegGids = new Set<number>();
    const ploegHids = new Set<number>();
    for (const r of refRows) { if (r.gid != null) ploegGids.add(r.gid); else if (r.hid != null) ploegHids.add(r.hid); }

    // VP-opkomst per incident (voor bemanning + uitruktijd)
    const opkByGid = new Map<number, Opk[]>();
    for (const o of opkRows as unknown as Opk[]) { if (!ploegGids.has(o.gebeurtenis_id)) continue; (opkByGid.get(o.gebeurtenis_id) ?? opkByGid.set(o.gebeurtenis_id, []).get(o.gebeurtenis_id)!).push(o); }
    // Handmatige deelnemers per incident
    const handDeelByInc = new Map<number, Record<string, unknown>[]>();
    for (const d of handDeel) { const k = Number(d.incident_id); if (!ploegHids.has(k)) continue; (handDeelByInc.get(k) ?? handDeelByInc.set(k, []).get(k)!).push(d); }

    const minUit = (iso: string, begin: string): number | null => {
      const a = new Date(begin).getTime(), b = new Date(iso).getTime();
      if (!isFinite(a) || !isFinite(b)) return null;
      const min = (b - a) / 60000;
      return (min >= 0 && min <= 60) ? min : null;   // onrealistische waarden negeren
    };
    const typeLabel = (i: Inc): string => (i.classificatie || i.object_functie || "Overig").trim() || "Overig";

    type PInc = { begin_op: string; p1: boolean; type: string; crew: number; uitruk_min: number | null; reanim: boolean; plaats: string | null; straat: string | null };
    const pins: PInc[] = [];
    for (const gid of ploegGids) {
      const i = incById.get(gid); if (!i) continue;
      const rows = opkByGid.get(gid) ?? [];
      const uit = rows.filter((o) => o.opkomst === 3);
      const crew = new Set(uit.map((o) => o.user_id)).size;
      let um: number | null = null;
      for (const o of uit) { if (o.uitgerukt_op) { const m = minUit(o.uitgerukt_op, i.begin_op); if (m != null && (um == null || m < um)) um = m; } }
      const type = typeLabel(i);
      pins.push({ begin_op: i.begin_op, p1: isP1(i), type, crew, uitruk_min: um, reanim: /reanim/i.test(type), plaats: i.city_name, straat: i.street_full });
    }
    for (const hid of ploegHids) {
      const h = handById.get(hid); if (!h) continue;
      const deel = handDeelByInc.get(hid) ?? [];
      const crew = new Set(deel.filter((d) => Number(d.opkomst) === 3).map((d) => Number(d.user_id))).size;
      const type = String(h.melding ?? "Overig").trim() || "Overig";
      pins.push({ begin_op: String(h.begin_op), p1: isP1({ prioriteit: h.prioriteit as string } as Inc), type, crew, uitruk_min: null, reanim: /reanim/i.test(type), plaats: (h.plaats as string) ?? null, straat: (h.straat as string) ?? null });
    }

    const mmss = (min: number): string => { const s = Math.round(min * 60); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

    // Uitruktijd per maand (P1, excl. reanimatie, alleen incidenten met een gemeten uitruktijd)
    const tijdSom = Array(12).fill(0), tijdN = Array(12).fill(0);
    const tijdAlle: number[] = [];
    for (const p of pins) {
      if (!p.p1 || p.reanim || p.uitruk_min == null) continue;
      const mnd = deelParts(p.begin_op).maand - 1;
      tijdSom[mnd] += p.uitruk_min; tijdN[mnd]++; tijdAlle.push(p.uitruk_min);
    }
    const uitruktijd_per_maand = tijdSom.map((s, i) => tijdN[i] ? Math.round((s / tijdN[i]) * 100) / 100 : null);

    // Spreiding uitruktijd (zelfde set)
    const sorted = tijdAlle.slice().sort((a, b) => a - b);
    const kwant = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] : 0;
    const STREEF = 4;
    const hist: Record<string, number> = { "< 4 min": 0, "4–5 min": 0, "5–6 min": 0, "6–7 min": 0, "> 7 min": 0 };
    for (const t of tijdAlle) { hist[t < 4 ? "< 4 min" : t < 5 ? "4–5 min" : t < 6 ? "5–6 min" : t < 7 ? "6–7 min" : "> 7 min"]++; }
    const uitruktijd_spreiding = sorted.length ? {
      n: sorted.length,
      gemiddeld_tekst: mmss(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      mediaan_tekst: mmss(kwant(0.5)), p90_tekst: mmss(kwant(0.9)), streef: STREEF,
      binnen_streef_pct: Math.round(sorted.filter((t) => t <= STREEF).length / sorted.length * 100),
      histogram: [["< 4 min", hist["< 4 min"]], ["4–5 min", hist["4–5 min"]], ["5–6 min", hist["5–6 min"]], ["6–7 min", hist["6–7 min"]], ["> 7 min", hist["> 7 min"]]],
    } : null;

    // Opkomst op de TS (alleen uitrukken waarbij de post daadwerkelijk uitrukte: bemanning >= 1)
    const turnout = pins.filter((p) => p.crew > 0);
    const opkVerd: Record<number, number> = {};
    for (const p of turnout) opkVerd[p.crew] = (opkVerd[p.crew] || 0) + 1;
    const crews = turnout.map((p) => p.crew);
    const opkomst = turnout.length ? {
      gemiddeld: Math.round(crews.reduce((a, b) => a + b, 0) / crews.length * 10) / 10,
      norm: 6, min: Math.min(...crews), max: Math.max(...crews),
      verdeling: Object.keys(opkVerd).map(Number).sort((a, b) => a - b).map((k) => [k, opkVerd[k]]),
    } : null;

    // Meldingstypen (top 10, rest in "Overig")
    const typeTel: Record<string, number> = {};
    for (const p of pins) typeTel[p.type] = (typeTel[p.type] || 0) + 1;
    const typeGesorteerd = Object.entries(typeTel).sort((a, b) => b[1] - a[1]);
    const top = typeGesorteerd.slice(0, 10);
    const restSom = typeGesorteerd.slice(10).reduce((a, [, v]) => a + v, 0);
    const meldingstypen = restSom > 0 ? [...top.filter(([t]) => t !== "Overig"), ["Overig", (typeTel["Overig"] || 0) + restSom]] : top;

    // Recente uitrukken (laatste 8, nieuwste eerst): [datum, tijd, prio, melding, uitruktijd, bemanning]
    const recente_uitrukken = pins.slice().sort((a, b) => new Date(b.begin_op).getTime() - new Date(a.begin_op).getTime()).slice(0, 8).map((p) => {
      const d = new Date(p.begin_op);
      const tijd = new Intl.DateTimeFormat("nl-NL", { timeZone: AMS, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      const datum = new Intl.DateTimeFormat("sv-SE", { timeZone: AMS, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      return [datum, tijd, p.p1 ? "P1" : "P2", p.type, p.uitruk_min != null ? mmss(p.uitruk_min) : "–", p.crew];
    });

    const ploegOut = {
      per_maand,
      prioriteit: [["P1", meta.n_prio1], ["P2", meta.n_prio2]],
      dagdeel: [["Ochtend", dd.Ochtend], ["Middag", dd.Middag], ["Avond", dd.Avond], ["Nacht", dd.Nacht]],
      uitruktijd_per_maand, uitruktijd_spreiding, opkomst, meldingstypen, recente_uitrukken,
      jaar_huidig: n,   // lopend jaar; historie blijft statisch in data.js
    };

    // Veiligheid: nooit lege cijfers wegschrijven (zou de goede cijfers in het portaal overschrijven).
    if (!n || !ledenUit.length) return json({ ok: false, error: "Geen uitrukdata gevonden — niets weggeschreven." }, 200);

    const bijgewerkt = new Intl.DateTimeFormat("sv-SE", { timeZone: AMS, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
    const payload = { bijgewerkt, jaar: JAAR, meta: { ...meta, gem }, leden: ledenUit, ploeg: ploegOut };

    const { error } = await admin.from("uitruk_aggregaten").upsert({ id: 1, data: payload });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, n_uitrukken: n, leden: ledenUit.length, bijgewerkt });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
