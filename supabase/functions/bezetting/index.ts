// Supabase Edge Function: haalt de bezetting van post Nieuw-Beijerland uit Pre-Com
// en schrijft alleen geaggregeerde cijfers (aantallen per functie) naar de tabel `bezetting`.
// Geen namen worden opgeslagen of gelogd — alleen tellingen.
//
// Port van precom_bezetting.py. Secrets (Project Settings > Edge Functions):
//   PRECOM_USER, PRECOM_PASS   (verplicht)
//   PRECOM_GROUP_ID (4915), PRECOM_NODE_ID (2123), PRECOM_MODULE_ID (79), PRECOM_DAGEN (28)  (optioneel)
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY worden automatisch geïnjecteerd.

const BASIS = "https://portal.pre-com.nl/PreCom/";
const GROEP = Deno.env.get("PRECOM_GROUP_ID") ?? "4915";
const NODE = Deno.env.get("PRECOM_NODE_ID") ?? "2123";
const MODULE = Deno.env.get("PRECOM_MODULE_ID") ?? "79";
const DAGEN = parseInt(Deno.env.get("PRECOM_DAGEN") ?? "28", 10);

// Streefsterkte (volwaardige TS) en aspirant, op functielabel — los van Pre-Com's 'nodig' (ondergrens).
const STREEF: Record<string, number> = { "Bevelvoerder": 1, "Chauffeur TS": 1, "Manschap": 4 };
const ASP: Record<string, number> = { "Asp. Manschap": 1, "Asp. manschap": 1 };

// ---- kleine cookie-jar bovenop fetch ----
const jar = new Map<string, string>();
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function slurpCookies(resp: Response) {
  const sc = (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const line of sc) {
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}
async function req(method: string, path: string, body?: string, xhr = false): Promise<Response> {
  const headers: Record<string, string> = { "User-Agent": "NBL-portaal/1.0 (bezetting)" };
  const ck = cookieHeader();
  if (ck) headers["Cookie"] = ck;
  if (xhr) { headers["X-Requested-With"] = "XMLHttpRequest"; headers["Referer"] = BASIS; }
  if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const resp = await fetch(BASIS + path, { method, headers, body, redirect: "follow" });
  slurpCookies(resp);
  return resp;
}

function fout(msg: string): never { throw new Error(msg); }

async function inloggen() {
  const user = Deno.env.get("PRECOM_USER"), pass = Deno.env.get("PRECOM_PASS");
  if (!user || !pass) fout("PRECOM_USER en/of PRECOM_PASS ontbreken.");
  const login = await req("GET", "Account/Login");
  const html = await login.text();
  // verborgen velden (o.a. __RequestVerificationToken) verzamelen
  const velden: Record<string, string> = {};
  const re = /<input[^>]*type="hidden"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const nm = /name="([^"]+)"/i.exec(tag)?.[1];
    const vl = /value="([^"]*)"/i.exec(tag)?.[1] ?? "";
    if (nm) velden[nm] = vl;
  }
  const form = new URLSearchParams(velden);
  form.set("UserName", user!); form.set("Password", pass!);
  const post = await req("POST", "Account/PostLogin", form.toString(), true);
  let j: Record<string, unknown>;
  try { j = await post.json(); } catch { fout(`Onverwacht antwoord bij inloggen (HTTP ${post.status}).`); }
  if (!(j!["Succesfully"] || j!["Successfully"])) fout("Inloggen mislukt: " + (j!["Message"] ?? "controleer gebruikersnaam/wachtwoord."));
  // post selecteert welke post/module geselecteerd zijn; zonder deze stap geeft het overzicht 403
  await req("GET", "");
  for (const pad of [
    `Navigation/NavigateToNode?nodeId=${NODE}`,
    `Navigation/NavigateToModule?moduleId=${MODULE}`,
    "Occupancy/Overview",
    `Occupancy/GetVehicles?groupId=${GROEP}`,
  ]) {
    const r = await req("GET", pad, undefined, true);
    if (r.status >= 400) fout(`Stap ${pad.split("?")[0]} gaf HTTP ${r.status}.`);
  }
}

async function getOccupancy(datums: string[]): Promise<Record<string, unknown>> {
  const form = new URLSearchParams();
  form.set("groupId", GROEP);
  for (const d of datums) form.append("selectedDates[]", d);
  const r = await req("POST", "Occupancy/GetOccupancy", form.toString(), true);
  if (r.status === 403) fout("Pre-Com weigert het bezettingsoverzicht (403). Controleer PRECOM_NODE_ID/PRECOM_MODULE_ID.");
  if (!r.ok) fout(`GetOccupancy gaf HTTP ${r.status}.`);
  if (!(r.headers.get("Content-Type") ?? "").includes("json")) fout("Geen JSON terug van Pre-Com (sessie verlopen of geen rechten?).");
  return await r.json();
}

function slotIndex(k: string): number {
  k = k.padStart(4, "0");
  return parseInt(k.slice(0, 2), 10) * 4 + Math.floor(parseInt(k.slice(2), 10) / 15);
}
// datum "yyMMdd" -> weekday 0=ma..6=zo
function weekdayFromYYMMDD(s: string): number {
  const y = 2000 + parseInt(s.slice(0, 2), 10), mo = parseInt(s.slice(2, 4), 10) - 1, d = parseInt(s.slice(4, 6), 10);
  return (new Date(y, mo, d).getDay() + 6) % 7;
}
function fmtNowAmsterdam(): string {
  // "YYYY-MM-DDTHH:MM" in Europe/Amsterdam
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
function datesForward(days: number): string[] {
  // lokale datums (Amsterdam) in "YYYY-MM-DD"
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    out.push(s);
  }
  return out;
}

async function bouwBezetting(): Promise<Record<string, unknown>> {
  await inloggen();

  // 1. Actuele stand (vandaag)
  const vandaag = datesForward(1)[0];
  const j0 = await getOccupancy([vandaag]);
  const totals = ((j0["TotalsOccupancy"] as Array<Record<string, unknown>>) ?? [])
    .slice().sort((a, b) => Number(a["OrderBy"] ?? 0) - Number(b["OrderBy"] ?? 0));
  if (!totals.length) fout("Geen functies gevonden in Pre-Com-antwoord.");
  const functies = totals.map((t) => ({
    id: t["ServiceFunctionID"] as number, label: t["Label"] as string,
    beschikbaar: t["Available"] as number, nodig: t["Necessary"] as number,
    totaal: t["Configured"] as number,
    streef: STREEF[t["Label"] as string] ?? ASP[t["Label"] as string] ?? 0,
  }));
  const labels: Record<number, string> = {};
  for (const f of functies) labels[f.id] = f.label;
  const ts: Record<number, number> = {};
  for (const f of functies) if (f.nodig > 0) ts[f.id] = f.nodig;
  const streef: Record<number, number> = {};
  const asp: Record<number, number> = {};
  for (const f of functies) {
    if (STREEF[f.label] !== undefined) streef[f.id] = STREEF[f.label];
    if (ASP[f.label] !== undefined) asp[f.id] = ASP[f.label];
  }
  const volg = new Set<number>([...Object.keys(ts), ...Object.keys(streef), ...Object.keys(asp)].map(Number));

  // 2. Vooruitblik: per kwartier ondergrens én streefsterkte
  const toekomst = datesForward(DAGEN);
  const ok = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const tot = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const okS = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const okF: Record<number, number> = {};
  for (const fid of Object.keys(ts)) okF[Number(fid)] = 0;
  let nSlots = 0, nOnd = 0, nStr = 0, nSas = 0;

  for (let i = 0; i < toekomst.length; i += 7) {
    const blok = await getOccupancy(toekomst.slice(i, i + 7));
    // per dag per functie: {slot: count}
    const perDag: Record<string, Record<number, Record<number, number>>> = {};
    for (const item of (blok["AvailablePeople"] as Array<Record<string, unknown>>) ?? []) {
      const fid = item["ServiceFunctionID"] as number, dag = item["DateOfDay"] as string;
      if (volg.has(fid) && dag) {
        const counters: Record<number, number> = {};
        for (const c of (item["DayCounters"] as Array<Record<string, unknown>>) ?? []) {
          counters[slotIndex(String(c["K"]))] = Number(c["V"]);
        }
        (perDag[dag] ??= {})[fid] = counters;
      }
    }
    for (const dag of Object.keys(perDag)) {
      const wd = weekdayFromYYMMDD(dag);
      const f = perDag[dag];
      for (let slot = 0; slot < 96; slot++) {
        const av = (fid: number) => f[fid]?.[slot] ?? 0;
        const bezet = Object.entries(ts).every(([fid, n]) => av(Number(fid)) >= n);
        const bezetS = Object.keys(streef).length > 0 && Object.entries(streef).every(([fid, n]) => av(Number(fid)) >= n);
        const bezetA = bezetS && Object.entries(asp).every(([fid, n]) => av(Number(fid)) >= n);
        const u = slot >> 2;
        tot[wd][u]++; if (bezet) ok[wd][u]++; if (bezetS) okS[wd][u]++;
        nSlots++; if (bezet) nOnd++; if (bezetS) nStr++; if (bezetA) nSas++;
        for (const [fid, n] of Object.entries(ts)) if (av(Number(fid)) >= n) okF[Number(fid)]++;
      }
    }
  }

  const heatmap = ok.map((row, d) => row.map((v, u) => tot[d][u] ? Math.round(100 * v / tot[d][u]) : null));
  const heatmapStreef = okS.map((row, d) => row.map((v, u) => tot[d][u] ? Math.round(100 * v / tot[d][u]) : null));
  const alleOk = ok.flat().reduce((a, b) => a + b, 0), alle = tot.flat().reduce((a, b) => a + b, 0);
  const dekkingPerRol = nSlots
    ? Object.keys(ts).map((fid) => ({ label: labels[Number(fid)] ?? String(fid), pct: Math.round(100 * okF[Number(fid)] / nSlots) }))
        .sort((a, b) => a.pct - b.pct)
    : [];
  const pct = (x: number) => nSlots ? Math.round(100 * x / nSlots) : null;
  const sterkte = {
    ondergrens: { eis: 4, pct: pct(nOnd) },
    streef: { eis: 6, pct: pct(nStr) },
    streef_asp: { eis: 7, pct: pct(nSas) },
  };

  return {
    bron: "Pre-Com",
    bijgewerkt: fmtNowAmsterdam(),
    functies,
    ts_bezet_pct: alle ? Math.round(100 * alleOk / alle) : null,
    periode_dagen: DAGEN,
    heatmap,
    heatmap_streef: heatmapStreef,
    sterkte,
    dekking_per_rol: dekkingPerRol,
  };
}

async function schrijfNaarDb(data: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) fout("SUPABASE_URL/SERVICE_ROLE_KEY ontbreken.");
  const r = await fetch(`${url}/rest/v1/bezetting?on_conflict=id`, {
    method: "POST",
    headers: {
      "apikey": key!, "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ id: 1, data, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) fout(`Wegschrijven naar DB mislukt (HTTP ${r.status}): ${await r.text()}`);
}

Deno.serve(async () => {
  try {
    const data = await bouwBezetting();
    await schrijfNaarDb(data);
    const s = data["sterkte"] as Record<string, { pct: number }>;
    return new Response(JSON.stringify({
      ok: true, bijgewerkt: data["bijgewerkt"],
      ondergrens: s.ondergrens.pct, streef: s.streef.pct, streef_asp: s.streef_asp.pct,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("bezetting-functie fout:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
