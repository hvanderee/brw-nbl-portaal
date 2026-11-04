import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.47.10/+esm';

const { SUPABASE_URL, SUPABASE_KEY, KWALS } = window.NBL_CONFIG;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const toon  = id => { ['#auth','#app'].forEach(x => $(x).hidden = (x !== id)); };
const kaart = id => { ['#c-login','#c-reset','#c-nieuw'].forEach(x => $(x).hidden = ('#'+id !== x)); };
function melding(el, tekst, type){ const m = $(el); m.textContent = tekst; m.className = 'melding' + (type ? ' '+type : ''); }

let rolHuidig = 'lid';
let leden = [];

const hash = new URLSearchParams(location.hash.slice(1));
const flow = hash.get('type');
// Korte, pre-fetch-bestendige uitnodigingslink: ?u=<code>. De code wordt pas bij de knopdruk
// "Wachtwoord instellen" ingewisseld (claim), dus een WhatsApp-preview verbruikt 'm niet.
const inviteCode = new URLSearchParams(location.search).get('u');
let herstelModus = (flow === 'recovery' || flow === 'invite') || !!inviteCode;

/* ============ TABBLADEN ============ */
const TABS = ['overzicht','beschikbaarheid','paraatheid','uitrukken','mijn'];
let tabHuidig = 'overzicht';
function toonTab(naam){
  tabHuidig = naam;
  TABS.forEach(t => { const v = $('#view-'+t); if(v) v.hidden = (t !== naam); });
  $$('.tabknop').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === naam)));
  if(naam === 'uitrukken' && window.NBLDash) window.NBLDash.tekenGrafieken();
  if(naam === 'mijn') laadMijnUitrukken();
  scrollTo(0,0);
}
$$('.tabknop').forEach(b => b.addEventListener('click', () => toonTab(b.dataset.tab)));

/* Handmatige uitruk-correcties uit de tabel halen en omzetten naar de vorm die renderMijn verwacht
   ({toevoegen:[...], verwijderen:[...]}). RLS geeft elke ingelogde gebruiker leesrecht; we filteren
   later per ploeglid op user_id. */
async function haalCorrecties(){
  try{
    const [{ data: deel }, { data: verb }] = await Promise.all([
      supabase.from('uitruk_deelnemers').select('user_id,opkomst,rol,incident:uitruk_incidenten(begin_op,tijd_bekend,prioriteit,melding,straat,plaats)'),
      supabase.from('uitruk_verbergen').select('user_id,gebeurtenis_id,eenheid_id'),
    ]);
    const toevoegen = (deel || []).filter(d => d.incident).map(d => ({
      user_id:d.user_id, opkomst:d.opkomst, rol:d.rol,
      begin_op:d.incident.begin_op, tijd_bekend:d.incident.tijd_bekend, prioriteit:d.incident.prioriteit,
      melding:d.incident.melding, straat:d.incident.straat, plaats:d.incident.plaats,
    }));
    const verwijderen = (verb || []).map(v => ({ user_id:v.user_id, gebeurtenis_id:v.gebeurtenis_id, eenheid_id:v.eenheid_id }));
    return { toevoegen, verwijderen };
  }catch(e){ return { toevoegen:[], verwijderen:[] }; }
}

/* Mijn uitrukken: leest de eigen opkomst-regels uit Supabase (RLS geeft alleen eigen regels). */
let mijnGeladen = false;
async function laadMijnUitrukken(){
  if(!window.NBLDash || !window.NBLDash.renderMijn) return;
  if(mijnGeladen) return; mijnGeladen = true;
  try{
    const { data, error } = await supabase
      .from('vp_opkomst')
      .select('user_id,opkomst,rol,eenheid_id,uitgerukt_op,terug_op,incident:vp_incidenten(gebeurtenis_id,nummer,begin_op,prioriteit,city_name,street_full,object_functie,classificatie)')
      .order('id', { ascending:false });
    const rijen = error ? [] : (data || []);
    // Handmatige correcties (Excel-leidend) over de VP-data heen leggen, alleen voor het
    // ingelogde ploeglid. De correcties komen nu uit de tabel uitruk_correcties (beheerbaar in
    // Beheer), niet meer uit het statische correcties.js. RLS op vp_opkomst levert enkel de eigen
    // regels, dus het VP-id leiden we af uit de eerste eigen regel.
    const alle = await haalCorrecties();
    const uid = rijen.length ? rijen[0].user_id : null;
    const corr = (uid == null) ? { toevoegen:[], verwijderen:[] } : {
      toevoegen:  (alle.toevoegen  || []).filter(t => String(t.user_id) === String(uid)),
      verwijderen:(alle.verwijderen|| []).filter(v => String(v.user_id) === String(uid)),
    };
    window.NBLDash.renderMijn(rijen, corr);
  }catch(e){ window.NBLDash.renderMijn([]); }
}

/* ============ AUTH ============ */
$('#naar-reset').onclick  = () => kaart('c-reset');
$('#terug-login').onclick = () => kaart('c-login');

$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  $('#l-knop').disabled = true; melding('#l-melding','Bezig met inloggen…');
  const { error } = await supabase.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pw').value });
  $('#l-knop').disabled = false;
  if(error) melding('#l-melding', vertaalFout(error.message), 'fout'); else melding('#l-melding','');
});

$('#f-reset').addEventListener('submit', async e => {
  e.preventDefault();
  $('#r-knop').disabled = true; melding('#r-melding','Bezig…');
  const { error } = await supabase.auth.resetPasswordForEmail($('#r-email').value.trim(), { redirectTo: location.origin + location.pathname });
  $('#r-knop').disabled = false;
  if(error) melding('#r-melding', vertaalFout(error.message), 'fout');
  else melding('#r-melding','Als dit e-mailadres bekend is, is er een herstel-link verstuurd. Controleer je mail.', 'ok');
});

$('#f-nieuw').addEventListener('submit', async e => {
  e.preventDefault();
  if($('#n-pw').value !== $('#n-pw2').value){ melding('#n-melding','De wachtwoorden zijn niet gelijk.', 'fout'); return; }
  $('#n-knop').disabled = true; melding('#n-melding','Opslaan…');
  // Bij een korte uitnodigingslink (?u=code): verzilver nu pas het token. We halen het token_hash
  // op via de beheer-functie (publieke 'claim') en loggen ermee in; pas deze knopdruk verbruikt het.
  if(inviteCode){
    try{
      const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'claim', code: inviteCode } });
      if(error || !data || !data.ok || !data.token_hash){
        melding('#n-melding', (data && data.error) || 'Deze link is ongeldig of al gebruikt. Vraag de beheerder om een nieuwe.', 'fout');
        $('#n-knop').disabled = false; return;
      }
      const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: data.type });
      if(vErr){ melding('#n-melding', vertaalFout(vErr.message), 'fout'); $('#n-knop').disabled = false; return; }
    }catch(err){ melding('#n-melding','Er ging iets mis bij het openen van de link. Probeer het opnieuw.', 'fout'); $('#n-knop').disabled = false; return; }
  }
  const { error } = await supabase.auth.updateUser({ password: $('#n-pw').value });
  $('#n-knop').disabled = false;
  if(error){ melding('#n-melding', vertaalFout(error.message), 'fout'); }
  else { herstelModus = false; history.replaceState(null,'',location.pathname);
    melding('#n-melding','Wachtwoord opgeslagen. Je wordt ingelogd…', 'ok'); await naarApp(); }
});

$('#uitloggen').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });

/* ============ BEHEER-WEERGAVE ============ */
let ledenGeladen = false;
$('#beheer-knop').addEventListener('click', async () => {
  $('#tabbalk').hidden = true; $('#dash').hidden = true; $('#view-beheer').hidden = false;
  scrollTo(0,0);
  if(!ledenGeladen){ ledenGeladen = true; await laadLeden(); vulBeheerSelects(); laadUitrukken(); }
});
$('#terug-knop').addEventListener('click', () => {
  $('#view-beheer').hidden = true; $('#tabbalk').hidden = false; $('#dash').hidden = false;
  scrollTo(0,0);
});

async function naarApp(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user){ startAuth(); return; }
  let naam = user.email, rol = 'lid';
  const { data: prof } = await supabase.from('profielen').select('naam,rol,actief').eq('id', user.id).maybeSingle();
  if(prof){ naam = prof.naam || naam; rol = prof.rol || 'lid';
    if(prof.actief === false){ await supabase.auth.signOut(); startAuth('Je account is gedeactiveerd. Neem contact op met de beheerder.'); return; } }
  rolHuidig = rol;
  $('#wie-naam').textContent = naam;
  $('#wie-rol').textContent = rol === 'beheerder' ? 'Beheerder' : 'Lid';
  $('#beheer-knop').hidden = (rol !== 'beheerder');
  toon('#app');
  toonTab('overzicht');
  await laadBezetting();
  await laadBeschikbaarheidUren();
  if(window.NBLDash) window.NBLDash.teken();
  startBezettingRefresh();
}

/* Live bezetting uit Supabase (geplande Edge Function). Valt terug op bezetting.js als er
   nog geen rij is of de query faalt. */
async function laadBezetting(){
  try{
    const { data, error } = await supabase.from('bezetting').select('data').eq('id', 1).maybeSingle();
    if(!error && data && data.data) window.NBL_BEZETTING = data.data;
  }catch(e){ /* fallback: window.NBL_BEZETTING uit bezetting.js blijft staan */ }
}

/* Beschikbare uren (per lid) komen live uit Pre-Com via de dagelijkse Edge Function 'beschikbaarheid'.
   We leggen ze over de A3-data (beschikbaarheid.js) heen: alleen de uren-kolommen worden overschreven,
   de uitrukken-kolommen blijven uit de Excel. Lukt het niet, dan blijven de A3-uren staan. */
async function laadBeschikbaarheidUren(){
  try{
    const { data } = await supabase.from('beschikbaarheid_uren').select('data').eq('id', 1).maybeSingle();
    const u = data && data.data; const B = window.NBL_BESCHIKBAARHEID;
    if(!u || !B) return;
    for(const l of (B.leden || [])){
      const lu = u.leden && u.leden[l.naam];
      if(lu){ l.uren_totaal = lu.uren_totaal; l.uren_odw = lu.uren_odw; l.pct_uren_odw = lu.pct_uren_odw; }
    }
    if(B.meta){
      B.meta.ploeg_uren_totaal = u.ploeg_uren_totaal;
      B.meta.ploeg_uren_odw    = u.ploeg_uren_odw;
      B.meta.ploeg_pct_odw     = u.ploeg_pct_odw;
      B.meta.uren_bijgewerkt   = u.bijgewerkt;
      if(u.periode_eind) B.meta.periode_eind = u.periode_eind;
    }
  }catch(e){ /* A3-uren blijven staan */ }
}

/* Status nu actueel houden: de Edge Function werkt de bezetting-tabel elke 5 min bij (pg_cron),
   dus halen we 'm met dezelfde frequentie opnieuw op en hertekenen we het Overzicht. Een
   openstaande pagina toont zo nooit een verouderde stand. Ververst ook meteen bij terugkeer op
   het tabblad. */
let bezettingTimer = null;
async function herlaadBezetting(){
  await laadBezetting();
  if(window.NBLDash) window.NBLDash.teken();
}
function startBezettingRefresh(){
  if(bezettingTimer) return;                         // niet dubbel plannen
  bezettingTimer = setInterval(herlaadBezetting, 5 * 60 * 1000);   // elke 5 min, gelijk aan de Pre-Com-ophaler
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') herlaadBezetting();
  });
}

function startAuth(fout){ toon('#auth'); kaart('c-login'); if(fout) melding('#l-melding', fout, 'fout'); }

function vertaalFout(m){
  if(/Invalid login credentials/i.test(m)) return 'E-mailadres of wachtwoord klopt niet.';
  if(/Email not confirmed/i.test(m))      return 'Je account is nog niet bevestigd. Gebruik de link uit je uitnodigingsmail.';
  if(/rate limit|too many/i.test(m))      return 'Te veel pogingen. Probeer het over een paar minuten opnieuw.';
  if(/should be at least/i.test(m))       return 'Wachtwoord is te kort (minimaal 8 tekens).';
  if(/duplicate key|unique/i.test(m))     return 'Er bestaat al een lid met deze gegevens.';
  if(/row-level security|permission/i.test(m)) return 'Je hebt geen rechten voor deze actie.';
  return m;
}

/* ============ PLOEGLEDENBEHEER ============ */
let accountStatus = {};   // lid.id -> 'geen' | 'uitgenodigd' | 'actief'

async function laadLeden(){
  melding('#leden-melding','');
  const { data, error } = await supabase.from('leden').select('*').order('volgorde', { ascending:true });
  if(error){ melding('#leden-melding', vertaalFout(error.message), 'fout'); return; }
  leden = data || [];
  renderLeden();
  laadAccountStatus();
}

/* Accountstatus per lid ophalen via de beveiligde Edge Function (alleen beheerder). */
async function laadAccountStatus(){
  try{
    const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'status' } });
    if(!error && data && data.ok){ accountStatus = data.status || {}; renderLeden(); }
  }catch(e){ /* stil: kolom toont dan "…" */ }
}

function accountCel(l){
  const s = accountStatus[l.id];
  const groen = 'background:#E6F2EB;color:var(--groen);border-color:#c9e4d4';
  const amber = 'background:#FDF1E3;color:#B5700E;border-color:#F0D8B3';
  const bMail = `<button class="knop-rand" data-invite="${l.id}" data-via="mail" title="Verstuur uitnodigingsmail">Mail</button>`;
  const bLink = `<button class="knop-rand" data-invite="${l.id}" data-via="link" title="Maak een deelbare toegangslink">Link</button>`;
  if(s === 'actief')      return `<span class="pill" style="${groen}">Actief account</span>`;
  if(!l.email)            return `<span class="status-nee">geen e-mail</span>`;
  if(s === 'uitgenodigd') return `<span class="pill" style="${amber}">Uitgenodigd</span> ${bLink}`;
  if(s === 'geen')        return `${bMail} ${bLink}`;
  return `<span class="dim">…</span>`;
}

function renderLeden(){
  $('#leden-telt').textContent = leden.length + ' leden';
  const body = $('#leden-body');
  if(!leden.length){ body.innerHTML = '<tr><td colspan="5" style="color:var(--slate)">Nog geen leden. Voeg er een toe met “+ Nieuw lid”.</td></tr>'; return; }
  body.innerHTML = leden.map(l => {
    const naam = l.naam || ((l.voornaam||'')+' '+(l.achternaam||'')).trim();
    const chips = KWALS.filter(([k]) => l[k]).map(([k,lab]) => `<span class="kw">${lab}</span>`).join('');
    return `<tr class="${l.actief===false?'inact':''}">
      <td><span class="nm">${esc(naam)}</span></td>
      <td><span class="em">${esc(l.email||'')}</span></td>
      <td><div class="kwals">${chips||'<span class="status-nee">—</span>'}</div></td>
      <td>${accountCel(l)}</td>
      <td><div class="acties">
        <button class="knop-rand" data-edit="${l.id}">Bewerken</button>
        <button class="knop-rand rood" data-del="${l.id}">Verwijderen</button>
      </div></td></tr>`;
  }).join('');
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(Number(b.dataset.edit)));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => verwijderLid(Number(b.dataset.del)));
  body.querySelectorAll('[data-invite]').forEach(b => b.onclick = () => nodigUit(Number(b.dataset.invite), b.dataset.via));
}

async function nodigUit(id, via){
  via = (via === 'mail') ? 'mail' : 'link';
  const l = leden.find(x => x.id===id); if(!l) return;
  if(!l.email){ melding('#leden-melding','Dit lid heeft geen e-mailadres. Vul dat eerst in via Bewerken.', 'fout'); return; }
  if(via === 'mail'){
    if(!confirm('Uitnodigingsmail sturen naar '+l.email+'?')) return;
    melding('#leden-melding','Uitnodigingsmail versturen…');
  } else {
    if(!confirm('Een toegangslink maken voor '+l.naam+'?\nJe deelt die daarna zelf (bijv. via WhatsApp).')) return;
    melding('#leden-melding','Link maken…');
  }
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'invite', id, via } });
  if(error || !data || !data.ok){ melding('#leden-melding', (data && data.error) || vertaalFout((error && error.message) || 'Mislukt.'), 'fout'); return; }
  if(via === 'mail'){
    melding('#leden-melding', 'Uitnodigingsmail verstuurd naar '+l.email+'.', 'ok');
  } else if(data.link){
    try{ await navigator.clipboard.writeText(data.link); }catch(e){}
    melding('#leden-melding', 'Toegangslink voor '+l.naam+' gekopieerd. Deel hem privé (WhatsApp/mail); hij stelt daarmee zijn wachtwoord in.', 'ok');
    try{ window.prompt('Toegangslink voor '+l.naam+' — kopieer en deel privé:', data.link); }catch(e){}
  } else {
    melding('#leden-melding', 'Uitnodiging klaargezet voor '+l.naam+'.', 'ok');
  }
  laadAccountStatus();
}

$('#m-checks').innerHTML = KWALS.map(([k,lab]) =>
  `<label class="check" data-k="${k}"><input type="checkbox" id="chk-${k}"> ${lab}</label>`).join('');
$('#m-checks').querySelectorAll('input').forEach(inp => {
  inp.onchange = () => inp.closest('.check').classList.toggle('aan', inp.checked);
});

function openForm(id){
  const l = id ? leden.find(x => x.id===id) : null;
  $('#m-id').value = l ? l.id : '';
  $('#m-titel').textContent = l ? 'Lid bewerken' : 'Nieuw lid';
  $('#m-voornaam').value   = l ? (l.voornaam||'') : '';
  $('#m-achternaam').value = l ? (l.achternaam||'') : '';
  $('#m-email').value      = l ? (l.email||'') : '';
  $('#m-vpid').value       = l ? (l.vp_id||'') : '';
  $('#m-actief').checked   = l ? l.actief !== false : true;
  KWALS.forEach(([k]) => { const inp = $('#chk-'+k); inp.checked = l ? !!l[k] : false; inp.closest('.check').classList.toggle('aan', inp.checked); });
  melding('#m-melding','');
  $('#overlay').hidden = false;
  $('#m-voornaam').focus();
}
function sluitForm(){ $('#overlay').hidden = true; }
$('#nieuw-lid').onclick  = () => openForm(null);
$('#m-annuleer').onclick = sluitForm;
$('#overlay').addEventListener('click', e => { if(e.target === $('#overlay')) sluitForm(); });

$('#f-lid').addEventListener('submit', async e => {
  e.preventDefault();
  const vn = $('#m-voornaam').value.trim(), an = $('#m-achternaam').value.trim();
  if(!vn || !an){ melding('#m-melding','Voornaam en achternaam zijn verplicht.', 'fout'); return; }
  const rij = { voornaam:vn, achternaam:an, naam:(vn+' '+an),
    email: $('#m-email').value.trim() || null, vp_id: $('#m-vpid').value.trim() || null, actief: $('#m-actief').checked };
  KWALS.forEach(([k]) => rij[k] = $('#chk-'+k).checked);
  const id = $('#m-id').value;
  $('#m-opslaan').disabled = true; melding('#m-melding','Opslaan…');
  let error;
  if(id){
    ({ error } = await supabase.from('leden').update(rij).eq('id', Number(id)));
  } else {
    rij.volgorde = (leden.reduce((m,l) => Math.max(m, l.volgorde||0), 0)) + 1;
    ({ error } = await supabase.from('leden').insert(rij));
  }
  $('#m-opslaan').disabled = false;
  if(error){ melding('#m-melding', vertaalFout(error.message), 'fout'); return; }
  sluitForm();
  await laadLeden();
});

async function verwijderLid(id){
  const l = leden.find(x => x.id===id); if(!l) return;
  const naam = l.naam || ((l.voornaam||'')+' '+(l.achternaam||'')).trim();
  if(!confirm('Lid “'+naam+'” definitief verwijderen uit de ploeglijst?')) return;
  const { error } = await supabase.from('leden').delete().eq('id', id);
  if(error){ melding('#leden-melding', vertaalFout(error.message), 'fout'); return; }
  await laadLeden();
}

/* ============ HANDMATIGE UITRUKKEN OP UITRUK-NIVEAU (BEHEER) ============ */
let incidenten = [];
let verbergen = [];
let uitrukFilter = '';
const OPK_LABEL = { 3:'Uitgerukt', 4:'Kazerne', 1:'Niet opgekomen' };
const ROLLEN = ['Bevelvoerder','Chauffeur TS','Chauffeur VEB','Manschap','Aspirant Manschap'];
const dkort = s => new Date(s).toLocaleDateString('nl-NL', { day:'numeric', month:'short', year:'numeric' });

function ledNaam(l){ return l.naam || ((l.voornaam||'')+' '+(l.achternaam||'')).trim(); }
function ledLabel(uid){ const l = leden.find(x => String(x.vp_id) === String(uid)); return l ? ledNaam(l) : ('VP '+uid); }
function ledenMetVp(){ return leden.filter(l => l.vp_id).slice().sort((a,b) => ledNaam(a).localeCompare(ledNaam(b))); }

function vulBeheerSelects(){
  const opts = ledenMetVp().map(l => `<option value="${esc(l.vp_id)}">${esc(ledNaam(l))}</option>`).join('');
  const f = $('#uitruk-filter'); if(f){ const cur = f.value; f.innerHTML = '<option value="">Alle leden</option>' + opts; f.value = cur; }
  const v = $('#vm-lid'); if(v) v.innerHTML = opts || '<option value="">— geen leden met VP-id —</option>';
}

async function laadUitrukken(){
  melding('#uitruk-melding',''); melding('#verb-melding','');
  const [{ data: inc, error: e1 }, { data: verb, error: e2 }] = await Promise.all([
    supabase.from('uitruk_incidenten').select('*, deelnemers:uitruk_deelnemers(user_id,opkomst,rol)').order('begin_op', { ascending:false, nullsFirst:false }),
    supabase.from('uitruk_verbergen').select('*').order('id', { ascending:true }),
  ]);
  if(e1){ melding('#uitruk-melding', vertaalFout(e1.message), 'fout'); return; }
  if(e2){ melding('#verb-melding', vertaalFout(e2.message), 'fout'); }
  incidenten = inc || [];
  verbergen = verb || [];
  renderUitrukken();
  renderVerbergen();
}

function renderUitrukken(){
  const body = $('#uitruk-body'); if(!body) return;
  const lijst = incidenten.filter(i => !uitrukFilter || (i.deelnemers||[]).some(d => String(d.user_id) === String(uitrukFilter)));
  $('#uitruk-telt').textContent = lijst.length + (lijst.length === 1 ? ' uitruk' : ' uitrukken');
  if(!lijst.length){
    body.innerHTML = '<tr><td colspan="6" style="color:var(--slate)">Nog geen handmatige uitrukken. Voeg er een toe met “+ Uitruk toevoegen”.</td></tr>';
    return;
  }
  body.innerHTML = lijst.map(i => {
    const d = i.deelnemers || [];
    const tel = { 3:0, 4:0, 1:0 }; d.forEach(x => { tel[x.opkomst] = (tel[x.opkomst]||0)+1; });
    const brok = [];
    if(tel[3]) brok.push(tel[3]+' uitgerukt'); if(tel[4]) brok.push(tel[4]+' kazerne'); if(tel[1]) brok.push(tel[1]+' niet');
    const tijd = (i.tijd_bekend === false || !i.begin_op) ? '' : `<span class="pct">${new Date(i.begin_op).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}</span>`;
    const prio = (i.prioriteit != null && i.prioriteit !== '') ? `<span class="prio P${i.prioriteit}">P${i.prioriteit}</span>` : '<span class="dim">–</span>';
    const loc = `${esc(i.straat||'–')}${i.plaats?`<span class="pct">${esc(i.plaats)}</span>`:''}`;
    const deel = `${d.length} ${d.length===1?'lid':'leden'}${brok.length?`<span class="pct">${brok.join(' · ')}</span>`:''}`;
    return `<tr>
      <td>${i.begin_op?dkort(i.begin_op):'–'}${tijd}</td>
      <td>${prio}</td>
      <td>${esc(i.melding||'–')}</td>
      <td>${loc}</td>
      <td>${deel}</td>
      <td><div class="acties"><button class="knop-rand" data-iedit="${i.id}">Bewerken</button><button class="knop-rand rood" data-idel="${i.id}">Verwijderen</button></div></td></tr>`;
  }).join('');
  body.querySelectorAll('[data-iedit]').forEach(b => b.onclick = () => openInc(Number(b.dataset.iedit)));
  body.querySelectorAll('[data-idel]').forEach(b => b.onclick = () => verwijderInc(Number(b.dataset.idel)));
}

function renderVerbergen(){
  const body = $('#verb-body'); if(!body) return;
  const lijst = verbergen.filter(v => !uitrukFilter || String(v.user_id) === String(uitrukFilter));
  $('#verb-telt').textContent = lijst.length + (lijst.length === 1 ? ' regel' : ' regels');
  if(!lijst.length){
    body.innerHTML = '<tr><td colspan="4" style="color:var(--slate)">Geen verborgen VP-regels.</td></tr>';
    return;
  }
  body.innerHTML = lijst.map(v => `<tr>
    <td>${esc(ledLabel(v.user_id))}</td>
    <td>${esc(v.gebeurtenis_id)}</td>
    <td>${v.eenheid_id ? esc(v.eenheid_id) : '<span class="dim">hele incident</span>'}</td>
    <td><div class="acties"><button class="knop-rand" data-vedit="${v.id}">Bewerken</button><button class="knop-rand rood" data-vdel="${v.id}">Verwijderen</button></div></td></tr>`).join('');
  body.querySelectorAll('[data-vedit]').forEach(b => b.onclick = () => openVerb(Number(b.dataset.vedit)));
  body.querySelectorAll('[data-vdel]').forEach(b => b.onclick = () => verwijderVerb(Number(b.dataset.vdel)));
}

$('#uitruk-filter').addEventListener('change', e => { uitrukFilter = e.target.value; renderUitrukken(); renderVerbergen(); });

/* --- Uitruk-modal (incident + deelnemers) --- */
function bouwDeelGrid(statusPerUid){
  const rolOpts = '<option value="">—</option>' + ROLLEN.map(r => `<option value="${r}">${r}</option>`).join('');
  $('#im-deel').innerHTML = ledenMetVp().map(l => {
    const st = statusPerUid[String(l.vp_id)] || {};
    const sel = v => st.opkomst != null && String(st.opkomst) === v ? ' selected' : '';
    const rolSel = r => (st.rol || '') === r ? ' selected' : '';
    const uit = String(st.opkomst) === '3';
    return `<div class="deel-rij">
      <span class="deel-naam">${esc(ledNaam(l))}</span>
      <select class="deel-opk" data-uid="${esc(l.vp_id)}">
        <option value=""${st.opkomst==null?' selected':''}>—</option>
        <option value="3"${sel('3')}>Uitgerukt</option>
        <option value="4"${sel('4')}>Kazerne</option>
        <option value="1"${sel('1')}>Niet opgekomen</option>
      </select>
      <select class="deel-rol" data-uid="${esc(l.vp_id)}"${uit?'':' disabled'}>${rolOpts.replace('<option value=""', `<option value=""${st.rol?'':' selected'}`)}</select>
    </div>`;
  }).join('');
  // rol pas actief als status = uitgerukt
  $('#im-deel').querySelectorAll('.deel-opk').forEach(s => {
    const syncRol = () => { const rol = s.closest('.deel-rij').querySelector('.deel-rol'); rol.disabled = (s.value !== '3'); if(s.value !== '3') rol.value = ''; };
    s.addEventListener('change', syncRol);
  });
  // bestaande rol-selectie zetten
  for(const uid in statusPerUid){ const st = statusPerUid[uid]; if(st.rol){ const r = $('#im-deel .deel-rol[data-uid="'+uid+'"]'); if(r){ r.disabled = String(st.opkomst)!=='3'; r.value = st.rol; } } }
}

function openInc(id){
  const i = id ? incidenten.find(x => x.id === id) : null;
  $('#im-id').value = i ? i.id : '';
  $('#im-titel').textContent = i ? 'Uitruk bewerken' : 'Uitruk toevoegen';
  let datum = '', tijd = '';
  if(i && i.begin_op){ const d = new Date(i.begin_op);
    datum = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    tijd  = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  $('#im-datum').value   = datum;
  $('#im-geentijd').checked = i ? (i.tijd_bekend === false) : false;
  $('#im-tijd').value    = (i && i.tijd_bekend === false) ? '' : tijd;
  $('#im-prio').value    = i && i.prioriteit != null ? String(i.prioriteit) : '';
  $('#im-melding').value = i ? (i.melding||'') : '';
  $('#im-straat').value  = i ? (i.straat||'') : '';
  $('#im-plaats').value  = i ? (i.plaats||'') : '';
  const statusPerUid = {};
  if(i){ for(const d of (i.deelnemers||[])) statusPerUid[String(d.user_id)] = { opkomst:d.opkomst, rol:d.rol }; }
  bouwDeelGrid(statusPerUid);
  melding('#im-status','');
  $('#overlay-inc').hidden = false;
  $('#im-datum').focus();
}
function sluitInc(){ $('#overlay-inc').hidden = true; }
$('#nieuw-uitruk').onclick = () => openInc(null);
$('#im-annuleer').onclick  = sluitInc;
$('#overlay-inc').addEventListener('click', e => { if(e.target === $('#overlay-inc')) sluitInc(); });

$('#f-inc').addEventListener('submit', async e => {
  e.preventDefault();
  const datum = $('#im-datum').value;
  if(!datum){ melding('#im-status','Datum is verplicht.', 'fout'); return; }
  const geenTijd = $('#im-geentijd').checked, tijd = $('#im-tijd').value;
  const bekend = !geenTijd && !!tijd;
  const begin = new Date(`${datum}T${bekend ? tijd : '00:00'}`);
  const incident = { id: $('#im-id').value || null, begin_op: begin.toISOString(), tijd_bekend: bekend,
    prioriteit: $('#im-prio').value, melding: $('#im-melding').value.trim(),
    straat: $('#im-straat').value.trim(), plaats: $('#im-plaats').value.trim() };
  const deelnemers = [];
  $('#im-deel').querySelectorAll('.deel-rij').forEach(rij => {
    const opk = rij.querySelector('.deel-opk').value;
    if(!opk) return;
    const uid = rij.querySelector('.deel-opk').dataset.uid;
    const rol = rij.querySelector('.deel-rol').value;
    deelnemers.push({ user_id: Number(uid), opkomst: Number(opk), rol: (opk === '3' ? rol : '') });
  });
  if(!deelnemers.length){ melding('#im-status','Koppel minstens één ploeglid met een status.', 'fout'); return; }
  $('#im-opslaan').disabled = true; melding('#im-status','Opslaan…');
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'inc_save', incident, deelnemers } });
  $('#im-opslaan').disabled = false;
  if(error || !data || !data.ok){ melding('#im-status', (data && data.error) || vertaalFout((error && error.message) || 'Opslaan mislukt.'), 'fout'); return; }
  sluitInc();
  await laadUitrukken();
});

async function verwijderInc(id){
  const i = incidenten.find(x => x.id === id); if(!i) return;
  if(!confirm('Deze uitruk en alle gekoppelde ploegleden verwijderen?\n\n'+(i.melding||'uitruk')+' op '+(i.begin_op?dkort(i.begin_op):''))) return;
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'inc_del', id } });
  if(error || !data || !data.ok){ melding('#uitruk-melding', (data && data.error) || vertaalFout((error && error.message) || 'Verwijderen mislukt.'), 'fout'); return; }
  await laadUitrukken();
}

/* --- Verbergen-modal --- */
function openVerb(id){
  const v = id ? verbergen.find(x => x.id === id) : null;
  $('#vm-id').value  = v ? v.id : '';
  $('#vm-titel').textContent = v ? 'Verborgen VP-regel bewerken' : 'VP-regel verbergen';
  $('#vm-lid').value = v ? String(v.user_id) : ($('#vm-lid').options[0] ? $('#vm-lid').options[0].value : '');
  $('#vm-gid').value = v ? (v.gebeurtenis_id||'') : '';
  $('#vm-eenheid').value = v ? (v.eenheid_id||'') : '';
  melding('#vm-status','');
  $('#overlay-verb').hidden = false;
  $('#vm-lid').focus();
}
function sluitVerb(){ $('#overlay-verb').hidden = true; }
$('#nieuw-verb').onclick  = () => openVerb(null);
$('#vm-annuleer').onclick = sluitVerb;
$('#overlay-verb').addEventListener('click', e => { if(e.target === $('#overlay-verb')) sluitVerb(); });

$('#f-verb').addEventListener('submit', async e => {
  e.preventDefault();
  const user_id = $('#vm-lid').value;
  if(!user_id){ melding('#vm-status','Kies eerst een ploeglid.', 'fout'); return; }
  const gid = $('#vm-gid').value.trim();
  if(!gid){ melding('#vm-status','Gebeurtenis-id is verplicht.', 'fout'); return; }
  const rij = { id: $('#vm-id').value || null, user_id: Number(user_id), gebeurtenis_id: gid, eenheid_id: $('#vm-eenheid').value.trim() };
  $('#vm-opslaan').disabled = true; melding('#vm-status','Opslaan…');
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'verb_save', rij } });
  $('#vm-opslaan').disabled = false;
  if(error || !data || !data.ok){ melding('#vm-status', (data && data.error) || vertaalFout((error && error.message) || 'Opslaan mislukt.'), 'fout'); return; }
  sluitVerb();
  await laadUitrukken();
});

async function verwijderVerb(id){
  const v = verbergen.find(x => x.id === id); if(!v) return;
  if(!confirm('Deze verberg-regel verwijderen? De VP-regel verschijnt dan weer in “Mijn uitrukken”.')) return;
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'verb_del', id } });
  if(error || !data || !data.ok){ melding('#verb-melding', (data && data.error) || vertaalFout((error && error.message) || 'Verwijderen mislukt.'), 'fout'); return; }
  await laadUitrukken();
}

/* ============ OPSTART ============ */
if(herstelModus){
  toon('#auth'); kaart('c-nieuw');
  if(inviteCode){ const h=$('#c-nieuw h2'), p=$('#c-nieuw .intro');
    if(h) h.textContent='Welkom bij het ploegportaal';
    if(p) p.textContent='Kies een wachtwoord om je account te activeren. Minimaal 8 tekens.'; }
}
else {
  toon('#auth'); kaart('c-login');
  supabase.auth.getSession().then(({ data:{ session } }) => { if(session) naarApp(); }).catch(() => {});
}
supabase.auth.onAuthStateChange((event) => {
  if(herstelModus) return;
  if(event === 'SIGNED_IN')  naarApp();
  if(event === 'SIGNED_OUT') startAuth();
});

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
