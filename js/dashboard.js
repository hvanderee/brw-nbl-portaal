/* Dashboard-rendering: paraatheid, kerncijfers, beschikbaarheid en uitrukken.
   Leest window.NBL_DATA, window.NBL_BEZETTING en window.NBL_BESCHIKBAARHEID.
   Aangeroepen na inloggen via window.NBLDash.teken(); grafieken via .tekenGrafieken(). */
(function(){
const $ = s => document.querySelector(s);
const D = window.NBL_DATA;
const MND = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
const DAG = ["ma","di","wo","do","vr","za","zo"];
const fmtMin = m => { const s = Math.round(m*60); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); };
const fmtN   = n => Number(n).toLocaleString('nl-NL');
const nlDat  = s => new Date(s).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'});
const nlDatTijd = s => new Date(s).toLocaleString('nl-NL',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});

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
  let vol=true, f="";
  for(const x of fl){ const ok=x.n>=x.nodig; if(!ok) vol=false;
    f += `<div class="functie ${ok?"":"tekort"}"><div class="nm">${x.nm}</div><div class="vl">${x.n} <span>/ ${x.nodig} nodig</span></div><div class="balk"><i style="width:${Math.min(100,x.n/x.nodig*100)}%"></i></div></div>`; }
  const overig = B ? B.functies.filter(x=>x.nodig===0).map(x=>`${x.label} <b>${x.beschikbaar}</b>`).join(" · ") : "";
  $("#status").innerHTML = `<div class="st-kop"><div class="st-icoon ${vol?"ok":"niet"}">${vol?ICOON_OK:ICOON_NIET}</div><div><b>${vol?"TS volledig bezet":"TS niet volledig bezet"}</b><small>Beschikbaarheid volgens Pre-Com</small></div></div><div class="functies">${f}</div>${overig?`<div class="overig">Ook beschikbaar: ${overig}</div>`:""}`;

  const dj=D.uitrukken_per_maand.dit_jaar, vj=D.uitrukken_per_maand.vorig_jaar, n=dj.filter(v=>v!=null).length;
  const tot=dj.reduce((a,v)=>a+(v||0),0), vtot=vj.slice(0,n).reduce((a,v)=>a+v,0);
  const tijden=D.uitruktijd_per_maand.filter(v=>v!=null), gem=tijden.reduce((a,v)=>a+v,0)/tijden.length;
  const kpis=[
    ["Uitrukken "+D.jaar, tot, `${tot>=vtot?"+":"−"}${Math.abs(tot-vtot)} t.o.v. zelfde periode ${D.jaar-1}`],
    ["Gemiddelde uitruktijd", fmtMin(gem), `Streefwaarde ${fmtMin(D.norm.uitruktijd_min)}`],
    ["TS bezet", (B?B.ts_bezet_pct:D.beschikbaarheid_30d_pct)+"%", B?`Van de tijd, afgelopen ${B.periode_dagen} dagen`:"Van de tijd, afgelopen 30 dagen"],
    ["Maanden binnen norm", tijden.filter(v=>v<=D.norm.uitruktijd_min).length+" van "+tijden.length, "Gemiddelde uitruktijd ≤ streefwaarde"],
  ];
  $("#kpis").innerHTML = kpis.map(k=>`<div class="kaart kpi"><div class="label">${k[0]}</div><div class="waarde">${k[1]}</div><div class="sub">${k[2]}</div></div>`).join("");

  renderBeschikbaarheid();
  renderSterkte();

  const HM=B&&(B.heatmap_streef||B.heatmap)?(B.heatmap_streef||B.heatmap):D.heatmap, alle=HM.flat().filter(v=>v!=null), lo=Math.min(99,...alle);
  $("#hmMin").textContent = lo+"%";
  const kleur = v => { const t=(v-lo)/(100-lo||1); const a=[237,239,240], b=[17,24,32]; return `rgb(${a.map((x,i)=>Math.round(x+(b[i]-x)*t)).join(",")})`; };
  let h='<div></div>'; for(let u=0;u<24;u++) h+=`<div class="u">${u}</div>`;
  HM.forEach((rij,d)=>{ h+=`<div class="d">${DAG[d]}</div>`;
    rij.forEach((v,u)=>h+=v==null?`<div class="c" style="background:#EDEFF0"></div>`:`<div class="c" style="background:${kleur(v)}" data-t="${DAG[d]} ${String(u).padStart(2,"0")}:00–${String(u+1).padStart(2,"0")}:00 · ${v}% volledige TS"></div>`); });
  const hm=$("#heatmap"); if(hm){ hm.innerHTML=h;
    hm.addEventListener("mousemove",e=>{const c=e.target.closest(".c"); c?toonTip(e,c.dataset.t):verberg();}); hm.addEventListener("mouseleave",verberg); }

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
  const m = B.meta, mt = $("#besch-meta");
  if(mt) mt.textContent = `Periode ${nlDat(m.periode_start)} t/m ${nlDat(m.periode_eind)} · ${m.n_uitrukken} uitrukken, waarvan ${m.n_odw} overdag op een werkdag (${m.pct_odw}%) · bijgewerkt ${nlDatTijd(m.bijgewerkt)}`;
  const body = $("#besch-body"); if(!body) return;
  body.innerHTML = B.leden.map(l=>`<tr>
      <td><span class="nm">${l.naam}</span></td>
      <td class="r">${fmtN(l.uren_totaal)}<span class="eh">u</span></td>
      <td class="r kol-sort"><b>${fmtN(l.uren_odw)}<span class="eh">u</span></b><span class="pct">${l.pct_uren_odw}%</span></td>
      <td class="r sep"><b>${l.mee_totaal}<span class="eh">×</span></b><span class="pct">${l.pct_mee_totaal}%</span></td>
      <td class="r"><b>${l.mee_odw}<span class="eh">×</span></b><span class="pct">${l.pct_mee_odw}%</span></td>
      <td class="r"><b>${l.mee_overig}<span class="eh">×</span></b><span class="pct">${l.pct_mee_overig}%</span></td>
    </tr>`).join("")
    + `<tr class="totaal"><td><b>Totaal ploeg</b></td><td class="r">${fmtN(m.ploeg_uren_totaal)}<span class="eh">u</span></td><td class="r kol-sort"><b>${fmtN(m.ploeg_uren_odw)}<span class="eh">u</span></b><span class="pct">${m.ploeg_pct_odw}%</span></td><td class="r sep"></td><td class="r"></td><td class="r"></td></tr>`;
}

function renderSterkte(){
  const B = window.NBL_BEZETTING, box = $("#sterkte"); if(!box) return;
  const sb = $("#sterkteBron"); if(sb && B) sb.textContent = "Komende "+(B.periode_dagen||28)+" dagen · bron Pre-Com";
  const s = B && B.sterkte;
  if(!s){ box.innerHTML = '<p class="geen">Vooruitblik op sterkte wordt bij de volgende Pre-Com-verversing toegevoegd.</p>'; return; }
  const dgn = B.periode_dagen||28;
  const items = [
    ["Ondergrens · 4 leden","Bevelvoerder, chauffeur, 2 manschappen — krapst mogelijk", s.ondergrens],
    ["Streefsterkte · 6 leden","Bevelvoerder, chauffeur, 4 manschappen — volwaardige TS", s.streef],
    ["Volledig · 6 + aspirant","Streefsterkte plus 1 aspirant-manschap", s.streef_asp],
  ];
  box.innerHTML = items.map(([t,sub,o])=>{ const p = o && o.pct!=null ? o.pct : null;
    const kleur = p==null?"var(--ink)":(p>=90?"var(--groen)":p>=60?"var(--gold)":"var(--red-accessible)");
    return `<div class="tegel"><div class="nm"><b>${t}</b><br>${sub}</div>`
      + `<div class="vl" style="color:${kleur}">${p==null?"–":p+"%"}</div>`
      + `<div class="balk"><i style="width:${p||0}%;background:${kleur}"></i></div>`
      + `<div class="nm" style="margin-top:7px">van de tijd beschikbaar · komende ${dgn} dagen</div></div>`;
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
  const HMW = B ? (B.heatmap_streef||B.heatmap) : null;
  if(B&&HMW){
    let dOk=0,dN=0,nOk=0,nN=0;
    HMW.forEach(rij=>rij.forEach((v,u)=>{ if(v==null)return; if(u>=8&&u<18){dN++;dOk+=v;}else{nN++;nOk+=v;} }));
    const dag=dN?Math.round(dOk/dN):null, nacht=nN?Math.round(nOk/nN):null, dn=$("#dagnacht");
    if(dn) dn.innerHTML=[["Overdag","08–18 uur",dag],["'s Nachts","18–08 uur",nacht]].map(([t,sb,v])=>
      `<div class="tegel"><div class="nm">${t} · ${sb}</div><div class="vl">${v==null?"–":v+"%"}</div><div class="balk"><i style="width:${v||0}%"></i></div></div>`).join("");
    const vs=[];
    HMW.forEach((rij,d)=>{ let st=null;
      for(let u=0;u<=24;u++){ const bad=u<24&&rij[u]!=null&&rij[u]<100;
        if(bad&&st==null)st=u; else if(!bad&&st!=null){ const seg=rij.slice(st,u).filter(x=>x!=null); vs.push([DAG[d],st,u,Math.min(...seg)]); st=null; } } });
    vs.sort((a,b)=>a[3]-b[3]);
    const vb=$("#vensters");
    if(vb) vb.innerHTML = vs.length
      ? '<p class="uitleg" style="margin:16px 0 8px">Kwetsbaarste momenten komende periode</p><ul class="vensters">'+vs.slice(0,5).map(([d,a,b,lo])=>`<li><span>${d} ${String(a).padStart(2,"0")}:00–${String(b).padStart(2,"0")}:00</span><span class="pct">${lo}%</span></li>`).join("")+'</ul>'
      : '<p class="geen" style="margin-top:16px"><b>Geen kwetsbare momenten.</b> De TS is de hele periode volledig bezet.</p>';
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
  el("text",{x:W-m.r,y:y(nm)-6,"text-anchor":"end",style:"fill:var(--red-accessible)"},svg).textContent="Streefwaarde "+fmtMin(nm);
  const pts=vals.map((v,i)=>v==null?null:[m.l+bw*i+bw/2,y(v),v,i]).filter(Boolean);
  el("polyline",{points:pts.map(p=>p[0]+","+p[1]).join(" "),fill:"none",stroke:"var(--ink)","stroke-width":2,"stroke-linejoin":"round"},svg);
  pts.forEach(([x,yy,v,i])=>{ const bo=v>nm;
    el("circle",{cx:x,cy:yy,r:bo?4.5:3.5,fill:bo?"var(--red-accessible)":"var(--white)",stroke:bo?"var(--red-accessible)":"var(--ink)","stroke-width":2},svg);
    const hit=el("circle",{cx:x,cy:yy,r:12,fill:"transparent"},svg);
    hit.addEventListener("mousemove",e=>toonTip(e,`${MND[i]}: ${fmtMin(v)} min${bo?" · boven streefwaarde":""}`)); hit.addEventListener("mouseleave",verberg); });
}
function tekenGrafieken(){ if(!D) return; grafUitrukTijd(); grafJaar(); }

window.NBLDash = { teken, tekenGrafieken };
})();
