/* Dashboard-rendering: paraatheid, kerncijfers, beschikbaarheid en uitrukken.
   Leest window.NBL_DATA, window.NBL_BEZETTING en window.NBL_BESCHIKBAARHEID.
   Aangeroepen na inloggen via window.NBLDash.teken(); grafieken via .tekenGrafieken(). */
(function(){
const $ = s => document.querySelector(s);
const D = window.NBL_DATA;
const MND = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
const DAG = ["ma","di","wo","do","vr","za","zo"];
// Bezettingsgraad — 5 niveaus (rood → donkergroen)
const TIERKLEUR = ["#CF311B","#E8820E","#86C98E","#2F7D4F","#13482C"];
const TIERNAAM  = ["Onvoldoende","Ondergrens · 4","Krap · 5","Volwaardig · 6","Volledig · 6 + aspirant"];
const TIERKORT  = ["Onvoldoende","Ondergrens","Krap","Volwaardig","Volledig"];
function _hx(h){ return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)); }
function tierKleur(v){
  if(v==null) return "#EDEFF0";
  const x=Math.max(0,Math.min(4,v)), lo=Math.floor(x), hi=Math.ceil(x), t=x-lo;
  const a=_hx(TIERKLEUR[lo]), b=_hx(TIERKLEUR[hi]);
  return `rgb(${a.map((c,i)=>Math.round(c+(b[i]-c)*t)).join(",")})`;
}
const fmtMin = m => { const s = Math.round(m*60); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); };
const fmtN   = n => Number(n).toLocaleString('nl-NL');
const nlDat  = s => new Date(s).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'});
const nlDatTijd = s => new Date(s).toLocaleString('nl-NL',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const tip = $("#tip");
function toonTip(e,t){ if(!tip)return; tip.textContent=t; tip.hidden=false; tip.style.left=Math.max(8,Math.min(e.clientX+12,innerWidth-tip.offsetWidth-8))+"px"; tip.style.top=(e.clientY-38)+"px"; }
const verberg = () => { if(tip) tip.hidden=true; };
const NS = "http://www.w3.org/2000/svg";
function el(t,a,p){ const n=document.createElementNS(NS,t); for(const k in a) n.setAttribute(k,a[k]); if(p) p.appendChild(n); return n; }
function klok(){ const k=$("#klok"),dd=$("#datum"); if(!k||!dd)return; const n=new Date(); k.textContent=n.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"}); dd.textContent=n.toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long"}); }
const ICOON_OK   = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICOON_NIET = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>';

let klaar = false;
function teken(){
  if(klaar || !D) return; klaar = true; klok(); setInterval(klok,15000);
  const _b = $("#banier"); if(_b) _b.hidden = true;
  if(D.bijgewerkt) $("#bijgewerkt").textContent = "Bijgewerkt "+nlDatTijd(D.bijgewerkt);
  $("#jaarlabel").textContent = D.jaar+" tot en met vandaag";

  const B = window.NBL_BEZETTING && window.NBL_BEZETTING.functies ? window.NBL_BEZETTING : null;
  if(B){
    const tb = new Date(B.bijgewerkt), oud = (Date.now()-tb) > 60*60*1000;
    $("#bijgewerkt").innerHTML = (oud?'<span class="oud">Niet actueel · </span>':'')+"Pre-Com · bijgewerkt "+tb.toLocaleString("nl-NL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    $("#hmBron").textContent = "Komende "+B.periode_dagen+" dagen · bron Pre-Com";
  }
  const fl = B ? B.functies.filter(x=>x.nodig>0).map(x=>({nm:x.label,n:x.beschikbaar,nodig:x.nodig}))
              : Object.keys(D.norm.bezetting).map(k=>({nm:k,n:D.nu[k]||0,nodig:D.norm.bezetting[k]}));
  const namenVan = x => (B && B.nu_namen && Array.isArray(B.nu_namen[x.nm])) ? B.nu_namen[x.nm] : null;
  let vol=true, f="";
  for(const x of fl){ const ok=x.n>=x.nodig; if(!ok) vol=false;
    const nn = namenVan(x);
    const wie = nn==null ? "" : (nn.length ? `<div class="wie">${nn.map(esc).join("<span class='sc'>·</span>")}</div>` : `<div class="wie leeg">niemand beschikbaar</div>`);
    f += `<div class="functie ${ok?"":"tekort"}"><div class="nm">${x.nm}</div><div class="vl">${x.n} <span>/ ${x.nodig} nodig</span></div><div class="balk"><i style="width:${Math.min(100,x.n/x.nodig*100)}%"></i></div>${wie}</div>`; }
  const overig = B ? B.functies.filter(x=>x.nodig===0).map(x=>`${x.label} <b>${x.beschikbaar}</b>`).join(" · ") : "";
  const nt = B && B.nu_tier;
  const stK = nt ? TIERKLEUR[nt.tier] : null;
  const stTitel = nt ? "TS nu: "+nt.label : (vol?"TS volledig bezet":"TS niet volledig bezet");
  const stIco = nt ? (nt.tier>=1?ICOON_OK:ICOON_NIET) : (vol?ICOON_OK:ICOON_NIET);
  const stKop = nt ? `<div class="st-icoon" style="background:${stK}22;color:${stK}">${stIco}</div>` : `<div class="st-icoon ${vol?"ok":"niet"}">${stIco}</div>`;
  $("#status").innerHTML = `<div class="st-kop">${stKop}<div><b>${stTitel}</b><small>Beschikbaarheid volgens Pre-Com · vandaag</small></div></div><div class="functies">${f}</div>${overig?`<div class="overig">Ook beschikbaar: ${overig}</div>`:""}`;

  const dj=D.uitrukken_per_maand.dit_jaar, vj=D.uitrukken_per_maand.vorig_jaar, n=dj.filter(v=>v!=null).length;
  const tot=dj.reduce((a,v)=>a+(v||0),0), vtot=vj.slice(0,n).reduce((a,v)=>a+v,0);
  const tijden=D.uitruktijd_per_maand.filter(v=>v!=null), gem=tijden.reduce((a,v)=>a+v,0)/tijden.length;
  const kpis=[
    ["Uitrukken "+D.jaar, tot, `${tot>=vtot?"+":"−"}${Math.abs(tot-vtot)} t.o.v. zelfde periode ${D.jaar-1}`],
    ["Gem. uitruktijd (P1)", fmtMin(gem), `P1-streefwaarde ${fmtMin(D.norm.uitruktijd_min)} · excl. reanimatie`],
    (nt
      ? ["Bezetting vandaag", `<span style="color:${TIERKLEUR[nt.tier]};font-size:30px;display:block;text-align:center">${TIERKORT[nt.tier]}</span>`, `${nt.koppen}${nt.aspirant?` + ${nt.aspirant} asp`:""}`]
      : ["TS bezet", (B?B.ts_bezet_pct:D.beschikbaarheid_30d_pct)+"%", B?`Van de tijd, afgelopen ${B.periode_dagen} dagen`:"Van de tijd, afgelopen 30 dagen"]),
    ["Maanden binnen norm", tijden.filter(v=>v<=D.norm.uitruktijd_min).length+" van "+tijden.length, "Gemiddelde uitruktijd ≤ streefwaarde"],
  ];
  $("#kpis").innerHTML = kpis.map(k=>`<div class="kaart kpi"><div class="label">${k[0]}</div><div class="waarde">${k[1]}</div><div class="sub">${k[2]}</div></div>`).join("");

  renderBeschikbaarheid();
  renderSterkte();

  const tierMode = !!(B && B.heatmap_tier);
  const HM = tierMode ? B.heatmap_tier : (B&&(B.heatmap_streef||B.heatmap)?(B.heatmap_streef||B.heatmap):D.heatmap);
  const lo = Math.min(99, ...HM.flat().filter(v=>v!=null), 99);
  const grijs = v => { const t=(v-lo)/(100-lo||1); const a=[237,239,240], b=[17,24,32]; return `rgb(${a.map((x,i)=>Math.round(x+(b[i]-x)*t)).join(",")})`; };
  const cel = v => tierMode ? tierKleur(v) : grijs(v);
  const uur = u => `${String(u).padStart(2,"0")}:00–${String(u+1).padStart(2,"0")}:00`;
  const celTip = (d,u,v) => tierMode ? `${DAG[d]} ${uur(u)} · ${TIERNAAM[Math.round(v)]}` : `${DAG[d]} ${uur(u)} · ${v}% volledige TS`;
  let h='<div></div>'; for(let u=0;u<24;u++) h+=`<div class="u">${u}</div>`;
  HM.forEach((rij,d)=>{ h+=`<div class="d">${DAG[d]}</div>`;
    rij.forEach((v,u)=>h+=v==null?`<div class="c" style="background:#EDEFF0"></div>`:`<div class="c" style="background:${cel(v)}" data-t="${celTip(d,u,v)}"></div>`); });
  const hm=$("#heatmap"); if(hm){ hm.innerHTML=h;
    hm.addEventListener("mousemove",e=>{const c=e.target.closest(".c"); c?toonTip(e,c.dataset.t):verberg();}); hm.addEventListener("mouseleave",verberg); }
  const sch=$("#hmSchaal"); if(sch) sch.innerHTML = tierMode
    ? TIERNAAM.map((nm,i)=>`<span class="tlegend"><i style="background:${TIERKLEUR[i]}"></i>${nm}</span>`).join("")
    : `<span>${lo}%</span><div class="grad"></div><span>100% volledige TS</span>`;

  $("#lgJaar").textContent=D.jaar; $("#lgVorig").textContent=D.jaar-1;

  $("#recent").innerHTML = D.recente_uitrukken.map(([dt,tijd,prio,mld,ut,bez])=>{ const [m,sc]=ut.split(":").map(Number);
    const boven = prio==="P1" && (m+sc/60)>D.norm.uitruktijd_min;
    return `<tr><td>${new Date(dt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"}).replace(" ","&nbsp;")}<br><span class="dim">${tijd}</span></td><td><span class="prio ${prio}">${prio}</span></td><td>${mld}</td><td class="r ${boven?"boven":""}">${ut}</td><td class="r">${bez}</td></tr>`; }).join("");

  const ty=[...D.meldingstypen].sort((a,b)=>b[1]-a[1]), mx=ty[0][1];
  $("#typen").innerHTML = ty.map(([t,v])=>`<div class="type"><div class="rij"><span>${t}</span><b>${v}</b></div><div class="balk"><i style="width:${v/mx*100}%"></i></div></div>`).join("");

  widgets();
  let t; addEventListener("resize",()=>{ clearTimeout(t); t=setTimeout(tekenGrafieken,120); });
}

function renderBeschikbaarheid(){
  const B = window.NBL_BESCHIKBAARHEID; if(!B) return;
  const m = B.meta, g = m.gem, mt = $("#besch-meta");
  if(mt) mt.textContent = `Periode ${nlDat(m.periode_start)} t/m ${nlDat(m.periode_eind)} · ${m.n_uitrukken} uitrukken (${m.n_prio1}× P1, ${m.n_prio2}× P2), waarvan ${m.n_odw} overdag op een werkdag (${m.pct_odw}%) · bijgewerkt ${nlDatTijd(m.bijgewerkt)}`;
  const dec = n => Number(n).toLocaleString('nl-NL');
  const cel = (ct,pct,sep) => ct==null
    ? `<td class="r${sep?' sep':''}"><span class="dim">–</span></td>`
    : `<td class="r${sep?' sep':''}"><b>${ct}<span class="eh">×</span></b><span class="pct">${pct}%</span></td>`;
  // Kleur Overig-kolommen naar afwijking t.o.v. het gemiddelde.
  // Warm (oranje→rood) = gaat veel mee (mag minder); koel (lichtblauw→blauw) = gaat weinig mee (mag meer).
  // Neutrale zone rond het gemiddelde; tint blijft licht zodat de tekst leesbaar is. Niet voor overdag.
  const _lerp = (a,b,t) => a.map((x,i)=>Math.round(x+(b[i]-x)*t));
  const bgDev = (ct, gem) => {
    if(gem==null || ct==null) return "";
    const band = Math.max(1.5, gem*0.25), d = ct - gem, ad = Math.abs(d);
    if(ad <= band) return "";
    const t = Math.min(1, (ad-band)/Math.max(gem*0.7, 2));
    const a = (0.15 + t*0.26).toFixed(2);
    const c = d>0 ? _lerp([232,130,14],[207,49,27],t) : _lerp([125,178,232],[37,99,235],t);
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };
  const celC = (ct,pct,bg,sep) => ct==null
    ? `<td class="r${sep?' sep':''}"><span class="dim">–</span></td>`
    : `<td class="r${sep?' sep':''}"${bg?` style="background:${bg}"`:""}><b>${ct}<span class="eh">×</span></b><span class="pct">${pct}%</span></td>`;
  // Eén Overig-oordeel per lid, leidend bepaald door de uitsplitsing naar moment en prio
  // (som van beide prio-overig t.o.v. het gemiddelde). Dezelfde kleur kleurt zowel de
  // totaal-Overig (tabel 1) als de Overig-cellen P1/P2 (tabel 2), zodat beide overzichten
  // altijd hetzelfde verhaal vertellen.
  const gemOverig = g ? (g.overig_p1||0)+(g.overig_p2||0) : null;
  const bgOverig  = l => bgDev((l.overig_p1||0)+(l.overig_p2||0), gemOverig);

  const body = $("#besch-body");
  if(body){
    body.innerHTML = B.leden.map(l=>`<tr>
        <td><span class="nm">${l.naam}</span></td>
        <td class="r">${fmtN(l.uren_totaal)}<span class="eh">u</span></td>
        <td class="r kol-sort"><b>${fmtN(l.uren_odw)}<span class="eh">u</span></b><span class="pct">${l.pct_uren_odw}%</span></td>
        ${cel(l.mee_totaal,l.pct_mee_totaal,true)}${cel(l.mee_p1,l.pct_mee_p1)}${cel(l.mee_p2,l.pct_mee_p2)}${cel(l.mee_odw,l.pct_mee_odw)}${celC(l.mee_overig,l.pct_mee_overig,bgOverig(l))}
      </tr>`).join("")
      + `<tr class="totaal"><td><b>Totaal ploeg</b></td><td class="r">${fmtN(m.ploeg_uren_totaal)}<span class="eh">u</span></td><td class="r kol-sort"><b>${fmtN(m.ploeg_uren_odw)}<span class="eh">u</span></b><span class="pct">${m.ploeg_pct_odw}%</span></td><td class="r sep"></td><td class="r"></td><td class="r"></td><td class="r"></td><td class="r"></td></tr>`
      + (g?`<tr class="gem"><td>Gemiddelde p.p.</td><td class="r"></td><td class="r kol-sort"></td>${cel(dec(g.mee_totaal),g.pct_totaal,true)}${cel(dec(g.mee_p1),g.pct_p1)}${cel(dec(g.mee_p2),g.pct_p2)}${cel(dec(g.mee_odw),g.pct_odw)}${cel(dec(g.mee_overig),g.pct_overig)}</tr>`:"");
  }

  const kb = $("#besch-kruis-body");
  if(kb && B.leden[0] && B.leden[0].odw_p1!=null){
    kb.innerHTML = B.leden.map(l=>`<tr>
        <td><span class="nm">${l.naam}</span></td>
        ${cel(l.odw_p1,l.pct_odw_p1)}${cel(l.odw_p2,l.pct_odw_p2)}${celC(l.overig_p1,l.pct_overig_p1,bgOverig(l),true)}${celC(l.overig_p2,l.pct_overig_p2,bgOverig(l))}
      </tr>`).join("")
      + (g?`<tr class="gem"><td>Gemiddelde p.p.</td>${cel(dec(g.odw_p1),g.pct_odw_p1)}${cel(dec(g.odw_p2),g.pct_odw_p2)}${cel(dec(g.overig_p1),g.pct_overig_p1,true)}${cel(dec(g.overig_p2),g.pct_overig_p2)}</tr>`:"");
  }
}

function renderSterkte(){
  const B = window.NBL_BEZETTING, box = $("#sterkte"); if(!box) return;
  const sb = $("#sterkteBron"); if(sb && B) sb.textContent = "Vandaag · bron Pre-Com";
  const tv = B && B.tier_verdeling;
  if(tv && tv.length){
    box.innerHTML = tv.slice().reverse().map(r=>{ const p = r.pct==null?0:r.pct, kl = TIERKLEUR[r.tier];
      return `<div class="tier-rij"><div class="tier-kop"><span class="tier-naam"><i style="background:${kl}"></i>${r.label}</span><b>${r.pct==null?"–":p+"%"}</b></div><div class="balk"><i style="width:${p}%;background:${kl}"></i></div></div>`;
    }).join("")
      + `<p class="uitleg" style="margin:14px 0 0">Aandeel van vandaag dat de post op dat niveau kan uitrukken, volgens Pre-Com-beschikbaarheid. Elk kwartier telt mee op het hoogste niveau dat haalbaar is.</p>`;
    return;
  }
  const dgn = (B && B.periode_dagen) || 7;
  const s = B && B.sterkte;
  if(!s){ box.innerHTML = '<p class="geen">Vooruitblik op sterkte wordt bij de volgende Pre-Com-verversing toegevoegd.</p>'; return; }
  const items = [
    ["Ondergrens · 4 leden","Bevelvoerder, chauffeur, 2 manschappen", s.ondergrens],
    ["Streefsterkte · 6 leden","Bevelvoerder, chauffeur, 4 manschappen", s.streef],
    ["Volledig · 6 + aspirant","Streefsterkte plus 1 aspirant", s.streef_asp],
  ];
  box.innerHTML = items.map(([t,sub,o])=>{ const p = o && o.pct!=null ? o.pct : null;
    const kleur = p==null?"var(--ink)":(p>=90?"var(--groen)":p>=60?"var(--gold)":"var(--red-accessible)");
    return `<div class="tegel"><div class="nm"><b>${t}</b><br>${sub}</div><div class="vl" style="color:${kleur}">${p==null?"–":p+"%"}</div><div class="balk"><i style="width:${p||0}%;background:${kleur}"></i></div></div>`;
  }).join("");
}
function balken(id,rows,opt){
  const box=$("#"+id); if(!box||!rows||!rows.length) return;
  const mx=Math.max(...rows.map(r=>r[1]))||1, suf=(opt&&opt.suffix)||"";
  box.innerHTML = rows.map(([t,v],i)=>{ const smal=opt&&opt.smalIndex===i;
    return `<div class="type"><div class="rij"><span>${t}${smal?'<span class="vlag">smalste schakel</span>':''}</span><b>${v}${suf}</b></div><div class="balk"><i style="width:${Math.max(2,v/mx*100)}%${smal?';background:var(--red-accessible)':''}"></i></div></div>`;
  }).join("");
}
function widgets(){
  const B=window.NBL_BEZETTING||null;
  const tierMode = !!(B && B.heatmap_tier);
  const HMW = B ? (tierMode ? B.heatmap_tier : (B.heatmap_streef||B.heatmap)) : null;
  if(B&&HMW){
    let dOk=0,dN=0,nOk=0,nN=0;
    HMW.forEach(rij=>rij.forEach((v,u)=>{ if(v==null)return; if(u>=8&&u<18){dN++;dOk+=v;}else{nN++;nOk+=v;} }));
    const dag=dN?dOk/dN:null, nacht=nN?nOk/nN:null, dn=$("#dagnacht");
    if(dn) dn.innerHTML=[["Overdag","08–18 uur",dag],["'s Nachts","18–08 uur",nacht]].map(([t,sb,v])=>{
      if(tierMode){ const kl=tierKleur(v); return `<div class="tegel"><div class="nm">${t} · ${sb}</div><div class="vl" style="font-size:20px;color:${kl}">${v==null?"–":TIERNAAM[Math.round(v)]}</div><div class="balk"><i style="width:${v==null?0:Math.round(v/4*100)}%;background:${kl}"></i></div></div>`; }
      return `<div class="tegel"><div class="nm">${t} · ${sb}</div><div class="vl">${v==null?"–":Math.round(v)+"%"}</div><div class="balk"><i style="width:${v==null?0:Math.round(v)}%"></i></div></div>`;
    }).join("");
    const vs=[];
    HMW.forEach((rij,d)=>{ let st=null;
      for(let u=0;u<=24;u++){ const v=u<24?rij[u]:null; const bad = tierMode ? (v!=null&&v<2) : (v!=null&&v<100);
        if(bad&&st==null)st=u; else if(!bad&&st!=null){ const seg=rij.slice(st,u).filter(x=>x!=null); vs.push([DAG[d],st,u,Math.min(...seg)]); st=null; } } });
    vs.sort((a,b)=>a[3]-b[3]);
    const vb=$("#vensters");
    if(vb) vb.innerHTML = vs.length
      ? '<p class="uitleg" style="margin:16px 0 8px">Krapste momenten komende periode</p><ul class="vensters">'+vs.slice(0,5).map(([d,a,b,lo])=>`<li><span>${d} ${String(a).padStart(2,"0")}:00–${String(b).padStart(2,"0")}:00</span><span class="pct">${tierMode?TIERNAAM[Math.round(lo)]:lo+"%"}</span></li>`).join("")+'</ul>'
      : `<p class="geen" style="margin-top:16px"><b>Geen krappe momenten.</b> ${tierMode?"De post haalt de hele periode minstens krapte-sterkte.":"De TS is de hele periode volledig bezet."}</p>`;
  }
  if(B&&B.dekking_per_rol&&B.dekking_per_rol.length){
    const _r=B.dekking_per_rol,_mn=Math.min(..._r.map(x=>x.pct)),_mx=Math.max(..._r.map(x=>x.pct));
    balken("perRol",_r.map(r=>[r.label,r.pct]),{smalIndex:(_mn<_mx?0:-1),suffix:"%"});
  }
  if(D.dagdeel) balken("dagdeel",D.dagdeel);
  if(D.prioriteit) balken("prioriteit",D.prioriteit);
  if(D.opkomst){ const o=D.opkomst, box=$("#opkomst");
    if(box){ const mx=Math.max(...o.verdeling.map(r=>r[1]))||1;
      box.innerHTML=`<div class="tegel" style="margin-bottom:16px"><div class="nm">Gemiddelde opkomst op de TS</div><div class="vl">${String(o.gemiddeld).replace(".",",")} <span>/ ${o.norm} norm</span></div><div class="balk"><i style="width:${Math.min(100,o.gemiddeld/o.norm*100)}%"></i></div></div>`
        +`<p class="uitleg" style="margin:0 0 8px">Aantal man op de TS per uitruk</p>`
        +o.verdeling.map(([k,v])=>`<div class="type"><div class="rij"><span>${k} man</span><b>${v}×</b></div><div class="balk"><i style="width:${Math.max(2,v/mx*100)}%"></i></div></div>`).join(""); } }
  if(D.uitruktijd_spreiding){ const sp=D.uitruktijd_spreiding, box=$("#spreiding");
    if(box){ const mx=Math.max(...sp.histogram.map(r=>r[1]))||1;
      box.innerHTML=`<div class="duo" style="margin-bottom:16px"><div class="tegel"><div class="nm">Helft binnen (mediaan)</div><div class="vl">${sp.mediaan_tekst}</div></div><div class="tegel"><div class="nm">9 op 10 binnen (p90)</div><div class="vl">${sp.p90_tekst}</div></div></div>`
        +`<p class="uitleg" style="margin:0 0 8px">Verdeling van ${sp.n} uitrukken · ${sp.binnen_streef_pct}% binnen de streefwaarde (${fmtMin(sp.streef)})</p>`
        +sp.histogram.map(([k,v])=>{ const goed=k==="< 4 min"; return `<div class="type"><div class="rij"><span>${k}</span><b>${v}×</b></div><div class="balk"><i style="width:${Math.max(2,v/mx*100)}%${goed?';background:var(--ink)':''}"></i></div></div>`; }).join(""); } }
}

function grafJaar(){
  const svg=$("#grafJaar"); if(!svg||!D.uitrukken_per_jaar) return; svg.innerHTML="";
  const W=svg.clientWidth||400,H=220,m={t:16,r:8,b:28,l:28};
  const J=D.uitrukken_per_jaar, max=Math.max(4,Math.ceil(Math.max(...J.map(x=>x[1]))/10)*10);
  for(let v=0;v<=max;v+=max/4){ const y=m.t+(H-m.t-m.b)*(1-v/max);
    el("line",{x1:m.l,x2:W-m.r,y1:y,y2:y,stroke:v===0?"#D6D3CD":"#EEF0F0"},svg);
    el("text",{x:m.l-8,y:y+4,"text-anchor":"end"},svg).textContent=Math.round(v); }
  const bw=(W-m.l-m.r)/J.length, y=v=>m.t+(H-m.t-m.b)*(1-v/max);
  J.forEach(([jr,n],i)=>{ const w=Math.min(70,bw*0.5), x=m.l+bw*i+(bw-w)/2, huidig=i===J.length-1;
    const r=el("rect",{x,y:y(n),width:w,height:y(0)-y(n),rx:3,fill:huidig?"var(--red-accessible)":"var(--ink)"},svg);
    el("text",{x:x+w/2,y:y(n)-8,"text-anchor":"middle",style:"fill:var(--ink);font-weight:700;font-family:var(--font-display);font-size:16px"},svg).textContent=n;
    el("text",{x:x+w/2,y:H-8,"text-anchor":"middle",style:huidig?"fill:var(--red-accessible);font-weight:600":""},svg).textContent=jr+(huidig?" · t/m okt":"");
    r.addEventListener("mousemove",e=>toonTip(e,jr+": "+n+" uitrukken"+(huidig?" (t/m oktober)":""))); r.addEventListener("mouseleave",verberg); });
}
function assen(svg,W,H,m,max,stap,fmt){
  for(let v=0;v<=max;v+=stap){ const y=m.t+(H-m.t-m.b)*(1-v/max);
    el("line",{x1:m.l,x2:W-m.r,y1:y,y2:y,stroke:v===0?"#D6D3CD":"#EEF0F0"},svg); el("text",{x:m.l-8,y:y+4,"text-anchor":"end"},svg).textContent=fmt?fmt(v):v; }
  const bw=(W-m.l-m.r)/12; MND.forEach((mn,i)=>el("text",{x:m.l+bw*i+bw/2,y:H-4,"text-anchor":"middle"},svg).textContent=mn); return bw;
}
function grafUitrukTijd(){
  let svg=$("#grafUitruk"); if(!svg)return; svg.innerHTML=""; let W=svg.clientWidth||500, H=220, m={t:8,r:4,b:22,l:26};
  const dj=D.uitrukken_per_maand.dit_jaar, vj=D.uitrukken_per_maand.vorig_jaar;
  let max=Math.ceil(Math.max(...vj,...dj.filter(v=>v!=null))/4)*4;
  let bw=assen(svg,W,H,m,max,4), y=v=>m.t+(H-m.t-m.b)*(1-v/max), b=Math.min(14,bw*.3);
  dj.forEach((v,i)=>{ const cx=m.l+bw*i+bw/2;
    el("rect",{x:cx+1,y:y(vj[i]),width:b,height:y(0)-y(vj[i]),rx:2,fill:"#D6D3CD"},svg);
    if(v!=null) el("rect",{x:cx-b-1,y:y(v),width:b,height:y(0)-y(v),rx:2,fill:"var(--ink)"},svg);
    const hit=el("rect",{x:m.l+bw*i,y:m.t,width:bw,height:H-m.t-m.b,fill:"transparent"},svg);
    hit.addEventListener("mousemove",e=>toonTip(e,`${MND[i]}: ${v==null?"–":v} (${D.jaar}) · ${vj[i]} (${D.jaar-1})`)); hit.addEventListener("mouseleave",verberg); });

  svg=$("#grafTijd"); if(!svg)return; svg.innerHTML=""; W=svg.clientWidth||500; m={t:8,r:4,b:22,l:34};
  const vals=D.uitruktijd_per_maand, nm=D.norm.uitruktijd_min; max=Math.ceil(Math.max(nm,...vals.filter(v=>v!=null))+1);
  bw=assen(svg,W,H,m,max,1,v=>v+":00"); y=v=>m.t+(H-m.t-m.b)*(1-v/max);
  el("line",{x1:m.l,x2:W-m.r,y1:y(nm),y2:y(nm),stroke:"var(--red-accessible)","stroke-width":1,"stroke-dasharray":"4 4"},svg);
  el("text",{x:W-m.r,y:y(nm)-6,"text-anchor":"end",style:"fill:var(--red-accessible)"},svg).textContent="P1-streefwaarde "+fmtMin(nm);
  const pts=vals.map((v,i)=>v==null?null:[m.l+bw*i+bw/2,y(v),v,i]).filter(Boolean);
  el("polyline",{points:pts.map(p=>p[0]+","+p[1]).join(" "),fill:"none",stroke:"var(--ink)","stroke-width":2,"stroke-linejoin":"round"},svg);
  pts.forEach(([x,yy,v,i])=>{ const bo=v>nm;
    el("circle",{cx:x,cy:yy,r:bo?4.5:3.5,fill:bo?"var(--red-accessible)":"var(--white)",stroke:bo?"var(--red-accessible)":"var(--ink)","stroke-width":2},svg);
    const hit=el("circle",{cx:x,cy:yy,r:12,fill:"transparent"},svg);
    hit.addEventListener("mousemove",e=>toonTip(e,`${MND[i]}: ${fmtMin(v)} min${bo?" · boven streefwaarde":""}`)); hit.addEventListener("mouseleave",verberg); });
}
function tekenGrafieken(){ if(!D) return; grafUitrukTijd(); grafJaar(); }

/* ===== Mijn uitrukken (Veiligheidspaspoort) ===== */
// Opkomst-codes uit VP: 1 = niet opgekomen, 3 = uitgerukt (met de TS mee), 4 = kazerne
// (wel opgekomen, niet uitgerukt). "Mee" op een uitruk = uitgerukt (3).
const OPKOMST_LABEL = { 1:"Niet opgekomen", 3:"Uitgerukt", 4:"Kazerne" };
const OPKOMST_MEE   = new Set([3]);
const nlDatKort = s => new Date(s).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"});
const kortRol = r => !r ? "–" : r.replace(/vrijwillig\s*/i,"").replace(/\s*\(.*?\)\s*/g," ").replace(/\s+/g," ").trim().replace(/^./,c=>c.toUpperCase());

function renderMijn(rows, corr){
  const jaar = new Date().getFullYear();
  corr = corr || { toevoegen:[], verwijderen:[] };
  // Handmatige correcties uit de Verschillen-verklaring:
  //  - verwijderen: onterechte VP-regels (bv. OBL/buurpost-inzet) eruit filteren op gebeurtenis_id.
  //  - toevoegen: uitrukken die niet in VP staan maar wel meetellen, als synthetische regel erbij.
  const weg = new Set((corr.verwijderen||[]).map(v=>String(v.gebeurtenis_id)));
  rows = (rows||[]).filter(r=> !(r.incident && weg.has(String(r.incident.gebeurtenis_id))));
  const extra = (corr.toevoegen||[]).map(t=>({
    opkomst:3, rol:t.rol, _handmatig:true, _geentijd:(t.tijd_bekend===false),
    incident:{ gebeurtenis_id:null, begin_op:t.begin_op,
      prioriteit:(t.prioriteit!=null?t.prioriteit:null),
      city_name:t.plaats, street_full:t.straat, object_functie:t.melding, classificatie:null }
  }));
  rows = rows.concat(extra);
  // Alleen het lopende jaar, nieuwste eerst.
  rows = rows.filter(r=>r.incident && new Date(r.incident.begin_op).getFullYear()===jaar).slice()
    .sort((a,b)=> new Date(b.incident.begin_op||0) - new Date(a.incident.begin_op||0));
  const uitgerukt = rows.filter(r=> r.opkomst===3);
  const opgekomen = rows.filter(r=> r.opkomst===3 || r.opkomst===4);
  const laatste = uitgerukt[0] || opgekomen[0] || rows[0];
  const rolTel = {}; uitgerukt.forEach(r=>{ if(r.rol) rolTel[r.rol]=(rolTel[r.rol]||0)+1; });
  const vaak = Object.entries(rolTel).sort((a,b)=>b[1]-a[1])[0];
  const kpis = [
    ["Uitgerukt "+jaar, uitgerukt.length, "met de TS mee"],
    ["Opgekomen "+jaar, opgekomen.length, "uitgerukt of kazerne"],
    ["Laatste uitruk", laatste?nlDatKort(laatste.incident.begin_op):"–", laatste&&laatste.incident.city_name||""],
    ["Vaakste functie", vaak?kortRol(vaak[0]):"–", vaak?vaak[1]+"×":""],
  ];
  const kp = $("#mijn-kpis"); if(kp) kp.innerHTML = kpis.map(k=>`<div class="kaart kpi"><div class="label">${k[0]}</div><div class="waarde">${k[1]}</div><div class="sub">${k[2]}</div></div>`).join("");
  const bron = $("#mijn-bron"); const body = $("#mijn-body"); if(!body) return;
  if(!rows.length){
    if(bron) bron.textContent = "";
    body.innerHTML = `<tr><td colspan="6" style="color:var(--slate)">Nog geen uitrukken in ${jaar} gekoppeld. Draai de VP-sync, of controleer of je account-mailadres aan je ploeglid (met VP-id) gekoppeld is.</td></tr>`;
    return;
  }
  if(bron) bron.textContent = rows.length+" uitrukken in "+jaar+" · "+uitgerukt.length+" uitgerukt";
  body.innerHTML = rows.map(r=>{ const i=r.incident, dt=new Date(i.begin_op), isUit = r.opkomst===3, hm = !!r._handmatig;
    const mld = (i.object_functie && i.object_functie!=="Onbekend") ? i.object_functie : (i.classificatie || "Melding");
    const loc = `${esc(i.street_full||"–")}${i.city_name?`<span class="pct">${esc(i.city_name)}</span>`:""}`;
    const tijd = (hm && r._geentijd) ? "" : `<span class="pct">${dt.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}</span>`;
    const prio = (i.prioriteit!=null && i.prioriteit!=="") ? `<span class="prio P${i.prioriteit}">P${i.prioriteit}</span>` : '<span class="dim">–</span>';
    return `<tr class="${isUit?"":"nietmee"}">
      <td>${nlDatKort(i.begin_op)}${tijd}</td>
      <td>${prio}</td>
      <td>${esc(mld)}${hm?' <span class="tag-hm" title="Handmatig toegevoegd uit de Verschillen-verklaring">handmatig</span>':""}</td>
      <td>${loc}</td>
      <td>${isUit ? esc(kortRol(r.rol)) : '<span class="dim">–</span>'}</td>
      <td class="r"><span class="opk opk${r.opkomst}">${OPKOMST_LABEL[r.opkomst]||("code "+r.opkomst)}</span></td>
    </tr>`; }).join("");
}

window.NBLDash = { teken, tekenGrafieken, renderMijn };
})();
