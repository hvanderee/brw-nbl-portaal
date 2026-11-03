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
let herstelModus = (flow === 'recovery' || flow === 'invite');

/* ============ TABBLADEN ============ */
const TABS = ['overzicht','beschikbaarheid','paraatheid','uitrukken','mijn'];
let tabHuidig = 'overzicht';
function toonTab(naam){
  tabHuidig = naam;
  TABS.forEach(t => { const v = $('#view-'+t); if(v) v.hidden = (t !== naam); });
  $$('.tabknop').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === naam)));
  if(naam === 'uitrukken' && window.NBLDash) window.NBLDash.tekenGrafieken();
  scrollTo(0,0);
}
$$('.tabknop').forEach(b => b.addEventListener('click', () => toonTab(b.dataset.tab)));

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
  const { error } = await supabase.auth.updateUser({ password: $('#n-pw').value });
  $('#n-knop').disabled = false;
  if(error){ melding('#n-melding', vertaalFout(error.message), 'fout'); }
  else { herstelModus = false; history.replaceState(null,'',location.pathname);
    melding('#n-melding','Wachtwoord opgeslagen. Je wordt ingelogd…', 'ok'); await naarApp(); }
});

$('#uitloggen').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });

/* ============ BEHEER-WEERGAVE ============ */
let ledenGeladen = false;
$('#beheer-knop').addEventListener('click', () => {
  $('#tabbalk').hidden = true; $('#dash').hidden = true; $('#view-beheer').hidden = false;
  if(!ledenGeladen){ ledenGeladen = true; laadLeden(); }
  scrollTo(0,0);
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
  if(window.NBLDash) window.NBLDash.teken();
}

/* Live bezetting uit Supabase (geplande Edge Function). Valt terug op bezetting.js als er
   nog geen rij is of de query faalt. */
async function laadBezetting(){
  try{
    const { data, error } = await supabase.from('bezetting').select('data').eq('id', 1).maybeSingle();
    if(!error && data && data.data) window.NBL_BEZETTING = data.data;
  }catch(e){ /* fallback: window.NBL_BEZETTING uit bezetting.js blijft staan */ }
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
async function laadLeden(){
  melding('#leden-melding','');
  const { data, error } = await supabase.from('leden').select('*').order('volgorde', { ascending:true });
  if(error){ melding('#leden-melding', vertaalFout(error.message), 'fout'); return; }
  leden = data || [];
  renderLeden();
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
      <td>${l.actief===false?'<span class="status-nee">Inactief</span>':'<span class="pill" style="background:#E6F2EB;color:var(--groen);border-color:#c9e4d4">Actief</span>'}</td>
      <td><div class="acties">
        <button class="knop-rand" data-edit="${l.id}">Bewerken</button>
        <button class="knop-rand rood" data-del="${l.id}">Verwijderen</button>
      </div></td></tr>`;
  }).join('');
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(Number(b.dataset.edit)));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => verwijderLid(Number(b.dataset.del)));
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

/* ============ OPSTART ============ */
if(herstelModus){ toon('#auth'); kaart('c-nieuw'); }
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
