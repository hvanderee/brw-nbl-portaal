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
    const { data, error } = await supabase.from('uitruk_correcties').select('*');
    if(error || !data) return { toevoegen:[], verwijderen:[] };
    const toevoegen = [], verwijderen = [];
    for(const r of data){
      if(r.soort === 'verwijderen'){
        verwijderen.push({ user_id:r.user_id, gebeurtenis_id:r.gebeurtenis_id, eenheid_id:r.eenheid_id });
      } else {
        toevoegen.push({ user_id:r.user_id, begin_op:r.begin_op, tijd_bekend:r.tijd_bekend,
          prioriteit:r.prioriteit, opkomst:r.opkomst, melding:r.melding, straat:r.straat, plaats:r.plaats, rol:r.rol });
      }
    }
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
  if(!ledenGeladen){ ledenGeladen = true; await laadLeden(); vulCorrSelects(); laadCorrecties(); }
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

/* ============ HANDMATIGE UITRUKKEN (BEHEER) ============ */
let correcties = [];
let corrFilter = '';
const OPK_LABEL = { 3:'Uitgerukt', 4:'Kazerne', 1:'Niet opgekomen' };
const dkort = s => new Date(s).toLocaleDateString('nl-NL', { day:'numeric', month:'short', year:'numeric' });

function ledNaam(l){ return l.naam || ((l.voornaam||'')+' '+(l.achternaam||'')).trim(); }
function ledLabel(uid){ const l = leden.find(x => String(x.vp_id) === String(uid)); return l ? ledNaam(l) : ('VP '+uid); }

function vulCorrSelects(){
  const metVp = leden.filter(l => l.vp_id).slice().sort((a,b) => ledNaam(a).localeCompare(ledNaam(b)));
  const opts = metVp.map(l => `<option value="${esc(l.vp_id)}">${esc(ledNaam(l))}</option>`).join('');
  const lid = $('#cm-lid'); if(lid) lid.innerHTML = opts || '<option value="">— geen leden met VP-id —</option>';
  const f = $('#corr-filter'); if(f){ const cur = f.value; f.innerHTML = '<option value="">Alle leden</option>' + opts; f.value = cur; }
}

async function laadCorrecties(){
  melding('#corr-melding','');
  const { data, error } = await supabase.from('uitruk_correcties').select('*')
    .order('begin_op', { ascending:false, nullsFirst:false });
  if(error){ melding('#corr-melding', vertaalFout(error.message), 'fout'); return; }
  correcties = data || [];
  renderCorrecties();
}

function renderCorrecties(){
  const body = $('#corr-body'); if(!body) return;
  const lijst = correcties.filter(c => !corrFilter || String(c.user_id) === String(corrFilter));
  $('#corr-telt').textContent = lijst.length + (lijst.length === 1 ? ' regel' : ' regels');
  if(!lijst.length){
    body.innerHTML = '<tr><td colspan="7" style="color:var(--slate)">Nog geen handmatige uitrukken. Voeg er een toe met “+ Uitruk toevoegen”.</td></tr>';
    return;
  }
  body.innerHTML = lijst.map(c => {
    const naam = esc(ledLabel(c.user_id));
    const acties = `<div class="acties"><button class="knop-rand" data-cedit="${c.id}">Bewerken</button><button class="knop-rand rood" data-cdel="${c.id}">Verwijderen</button></div>`;
    if(c.soort === 'verwijderen'){
      const amber = 'background:#FDF1E3;color:#B5700E;border-color:#F0D8B3';
      const det = 'gebeurtenis ' + esc(c.gebeurtenis_id) + (c.eenheid_id ? (' · eenheid ' + esc(c.eenheid_id)) : '');
      return `<tr><td>${naam}</td><td colspan="4"><span class="pill" style="${amber}">VP-regel verbergen</span> <span class="dim">${det}</span></td><td>${acties}</td></tr>`;
    }
    const tijd = (c.tijd_bekend === false) ? '' : `<span class="pct">${new Date(c.begin_op).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}</span>`;
    const prio = (c.prioriteit != null && c.prioriteit !== '') ? `<span class="prio P${c.prioriteit}">P${c.prioriteit}</span>` : '<span class="dim">–</span>';
    const loc = `${esc(c.straat||'–')}${c.plaats?`<span class="pct">${esc(c.plaats)}</span>`:''}`;
    return `<tr>
      <td>${naam}</td>
      <td>${c.begin_op?dkort(c.begin_op):'–'}${tijd}</td>
      <td>${prio}</td>
      <td>${esc(c.melding||'–')}</td>
      <td>${loc}</td>
      <td>${OPK_LABEL[c.opkomst]||'–'}</td>
      <td>${acties}</td></tr>`;
  }).join('');
  body.querySelectorAll('[data-cedit]').forEach(b => b.onclick = () => openCorr(Number(b.dataset.cedit)));
  body.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => verwijderCorr(Number(b.dataset.cdel)));
}

$('#corr-filter').addEventListener('change', e => { corrFilter = e.target.value; renderCorrecties(); });

function corrSoortWissel(){
  const soort = $('#cm-soort').value;
  $('#cm-toe').hidden  = (soort !== 'toevoegen');
  $('#cm-verb').hidden = (soort !== 'verwijderen');
}
$('#cm-soort').addEventListener('change', corrSoortWissel);

function openCorr(id){
  const c = id ? correcties.find(x => x.id === id) : null;
  $('#cm-id').value    = c ? c.id : '';
  $('#cm-titel').textContent = c ? 'Uitruk bewerken' : 'Uitruk toevoegen';
  $('#cm-soort').value = c ? c.soort : 'toevoegen';
  $('#cm-lid').value   = c ? String(c.user_id) : ($('#cm-lid').options[0] ? $('#cm-lid').options[0].value : '');
  // toevoegen-velden
  let datum = '', tijd = '';
  if(c && c.begin_op){ const d = new Date(c.begin_op);
    datum = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    tijd  = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  $('#cm-datum').value   = datum;
  $('#cm-geentijd').checked = c ? (c.tijd_bekend === false) : false;
  $('#cm-tijd').value    = (c && c.tijd_bekend === false) ? '' : tijd;
  $('#cm-opkomst').value = c && c.opkomst != null ? String(c.opkomst) : '3';
  $('#cm-prio').value    = c && c.prioriteit != null ? String(c.prioriteit) : '';
  $('#cm-melding').value = c ? (c.melding||'') : '';
  $('#cm-rol').value     = c ? (c.rol||'') : '';
  $('#cm-straat').value  = c ? (c.straat||'') : '';
  $('#cm-plaats').value  = c ? (c.plaats||'') : '';
  // verwijderen-velden
  $('#cm-gid').value     = c ? (c.gebeurtenis_id||'') : '';
  $('#cm-eenheid').value = c ? (c.eenheid_id||'') : '';
  corrSoortWissel();
  melding('#cm-status','');
  $('#overlay-corr').hidden = false;
  $('#cm-lid').focus();
}
function sluitCorr(){ $('#overlay-corr').hidden = true; }
$('#nieuw-corr').onclick  = () => openCorr(null);
$('#cm-annuleer').onclick = sluitCorr;
$('#overlay-corr').addEventListener('click', e => { if(e.target === $('#overlay-corr')) sluitCorr(); });

$('#f-corr').addEventListener('submit', async e => {
  e.preventDefault();
  const soort = $('#cm-soort').value;
  const user_id = $('#cm-lid').value;
  if(!user_id){ melding('#cm-status','Kies eerst een ploeglid.', 'fout'); return; }
  const rij = { id: $('#cm-id').value || null, soort, user_id: Number(user_id) };
  if(soort === 'toevoegen'){
    const datum = $('#cm-datum').value;
    if(!datum){ melding('#cm-status','Datum is verplicht.', 'fout'); return; }
    const geenTijd = $('#cm-geentijd').checked;
    const tijd = $('#cm-tijd').value;
    const bekend = !geenTijd && !!tijd;
    const begin = new Date(`${datum}T${bekend ? tijd : '00:00'}`);   // lokale tijd (NL) → ISO (UTC) bij opslaan
    rij.begin_op = begin.toISOString();
    rij.tijd_bekend = bekend;
    rij.opkomst = Number($('#cm-opkomst').value);
    rij.prioriteit = $('#cm-prio').value;
    rij.melding = $('#cm-melding').value.trim();
    rij.rol = $('#cm-rol').value;
    rij.straat = $('#cm-straat').value.trim();
    rij.plaats = $('#cm-plaats').value.trim();
  } else {
    const gid = $('#cm-gid').value.trim();
    if(!gid){ melding('#cm-status','Vul het gebeurtenis-id in van de VP-regel die weg moet.', 'fout'); return; }
    rij.gebeurtenis_id = gid;
    rij.eenheid_id = $('#cm-eenheid').value.trim();
  }
  $('#cm-opslaan').disabled = true; melding('#cm-status','Opslaan…');
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'corr_save', rij } });
  $('#cm-opslaan').disabled = false;
  if(error || !data || !data.ok){ melding('#cm-status', (data && data.error) || vertaalFout((error && error.message) || 'Opslaan mislukt.'), 'fout'); return; }
  sluitCorr();
  await laadCorrecties();
});

async function verwijderCorr(id){
  const c = correcties.find(x => x.id === id); if(!c) return;
  const wat = c.soort === 'verwijderen' ? ('de verberg-regel voor '+ledLabel(c.user_id)) : (ledLabel(c.user_id)+' — '+(c.melding||'uitruk')+' op '+(c.begin_op?dkort(c.begin_op):''));
  if(!confirm('Deze handmatige regel verwijderen?\n\n'+wat)) return;
  const { data, error } = await supabase.functions.invoke('ploeg_beheer', { body:{ action:'corr_del', id } });
  if(error || !data || !data.ok){ melding('#corr-melding', (data && data.error) || vertaalFout((error && error.message) || 'Verwijderen mislukt.'), 'fout'); return; }
  await laadCorrecties();
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
