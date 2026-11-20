/* ================================================================
   COCKPIT — Onglet « Backtest » du Portefeuille (phase 7) : CK.btui
   Rejoue tes règles sur le passé (CK.bt) : réglages (début, fréquence, capital, fiscalité, coûts),
   calcul découpé avec progression et bouton Annuler, courbes base 100 (stratégie, allocation fixe,
   achat-conservation) avec repère au survol, métriques, exposition moyenne, grille de sensibilité
   (sur demande), journal mois par mois, avertissements. Rien n'est chargé avant l'ouverture de l'onglet.
   Les fonctions de rendu (CK.btui._t) n'utilisent pas le DOM : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
function U(){return CK.u||{};}
function M(){return CK.models||{};}
function esc(s){var f=U().esc;return f?f(s):String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fin(x){return typeof x==="number"&&isFinite(x);}
function nf(v,d){if(!fin(v))return "—";if(Math.abs(v)<Math.pow(10,-(d||0))/2)v=0;return Number(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});}
function pc(v,d){if(!fin(v))return "—";d=d==null?1:d;var p=Math.pow(10,d),r=Math.round(v*100*p)/p;return (r>0?"+":r<0?"−":"")+nf(Math.abs(r),d)+" %";}
function pa(v,d){return fin(v)?nf(v*100,d==null?1:d)+" %":"—";}
var HIDE="•••";
function money(v,h){if(!fin(v))return "—";return h?HIDE+" €":nf(v,0)+" €";}
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function disclaimer(){return CK.DISCLAIMER||"";}
function label(p){return CK.alloc?CK.alloc.label(p):p;}

var SERIES=[{k:"strategie",l:"Tes règles",c:"var(--pf-1)"},{k:"fixe",l:"Allocation fixe",c:"var(--pf-2)"},{k:"achat",l:"Achat-conservation",c:"var(--pf-3)"}];
var TAX=[{id:"aucune",l:"Avant impôt"},{id:"CTO",l:"Compte-titres (PFU)"},{id:"PEA",l:"PEA"}];

/* ================================================================
   Rendu (sans DOM)
   ================================================================ */
function formHTML(f,o){
  o=o||{};var y0=o.minYear||2012,y1=new Date(now()).getUTCFullYear()-2,years=[];for(var y=y0;y<=y1;y++)years.push(y);
  return '<form class="bt-form" data-bt-form="1"><label><span>Début</span><select name="from"><option value="">Le plus tôt possible</option>'+years.map(function(y){return '<option value="'+y+'"'+(String(f.from)===String(y)?" selected":"")+'>'+y+'</option>';}).join("")+'</select></label>'+
    '<label><span>Décision</span><select name="freq"><option value="1"'+(f.freq!==3?" selected":"")+'>Chaque mois</option><option value="3"'+(f.freq===3?" selected":"")+'>Chaque trimestre</option></select></label>'+
    '<label><span>Capital de départ (€)</span><input name="capital" inputmode="decimal" value="'+esc(nf(f.capital||10000,0))+'"></label>'+
    '<label><span>Fiscalité</span><select name="tax">'+TAX.map(function(t){return '<option value="'+t.id+'"'+(f.tax===t.id?" selected":"")+'>'+esc(t.l)+'</option>';}).join("")+'</select></label>'+
    '<label class="bt-chk"><input type="checkbox" name="costs"'+(f.costs!==false?" checked":"")+'> Frais de courtage, spread et change</label>'+
    '<button type="submit" class="btn sm primary">Lancer le backtest</button></form>';
}
function warnHTML(){
  return '<ul class="bt-warn"><li><b>Performances simulées</b> sur le passé, avec les seules données connues à chaque date de décision ; elles ne disent rien de l\'avenir.</li>'+
    '<li>Mesuré au niveau des <b>classes d\'actifs</b>, sur une série représentative par classe (ETF ou ETC, dividendes réinvestis, en euros), pas sur tes propres instruments. Les titres en direct ne sont pas simulés.</li>'+
    '<li><b>Biais du survivant</b> : les séries utilisées sont celles qui existent encore aujourd\'hui. Chaque classe n\'entre qu\'après 13 mois d\'historique.</li>'+
    '<li>Fiscalité <b>simplifiée et indicative</b> : taux actuels de fiscal.json appliqués à tout le passé ; espèces rémunérées au taux sans risque (€STR, EONIA avant 2019).</li></ul>';
}
/** Courbes base 100 : axes discrets, une ligne par série, étiquette au bout, données pour le repère au survol. */
function chartHTML(R,o){
  o=o||{};var W=760,H=300,L=44,Rm=118,T=12,Bm=26,ks=SERIES.filter(function(s){return R.books[s.k];});
  var cap=R.capital,curves=ks.map(function(s){return R.books[s.k].curve.map(function(x){return [x[0],x[1]/cap*100];});}),t0=curves[0][0][0],t1=curves[0][curves[0].length-1][0];
  var ymin=Infinity,ymax=-Infinity;curves.forEach(function(c){c.forEach(function(x){if(x[1]<ymin)ymin=x[1];if(x[1]>ymax)ymax=x[1];});});
  var step=ymax-ymin>200?50:ymax-ymin>80?20:10;ymin=Math.floor(ymin/step)*step;ymax=Math.ceil(ymax/step)*step;
  var X=function(t){return L+(t-t0)/(t1-t0||1)*(W-L-Rm);},Y=function(v){return T+(ymax-v)/(ymax-ymin||1)*(H-T-Bm);};
  var grid="";for(var v=ymin;v<=ymax+1e-9;v+=step)grid+='<line x1="'+L+'" x2="'+(W-Rm)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" class="bt-gl'+(v===100?" bt-g100":"")+'"/><text x="'+(L-6)+'" y="'+(Y(v)+4).toFixed(1)+'" class="bt-ax" text-anchor="end">'+v+'</text>';
  var y0=new Date(t0).getUTCFullYear(),y1=new Date(t1).getUTCFullYear(),ev=y1-y0>8?2:1,ticks="";
  for(var y=y0+1;y<=y1;y+=1){if((y-y0)%ev)continue;var tt=Date.UTC(y,0,1);ticks+='<line x1="'+X(tt).toFixed(1)+'" x2="'+X(tt).toFixed(1)+'" y1="'+(H-Bm)+'" y2="'+(H-Bm+4)+'" class="bt-gl"/><text x="'+X(tt).toFixed(1)+'" y="'+(H-8)+'" class="bt-ax" text-anchor="middle">'+y+'</text>';}
  var lines="",ends=[];
  ks.forEach(function(s,i){var c=curves[i],d="";c.forEach(function(x,j){d+=(j?"L":"M")+X(x[0]).toFixed(1)+" "+Y(x[1]).toFixed(1);});
    lines+='<path d="'+d+'" class="bt-line" style="stroke:'+s.c+'"/>';var e=c[c.length-1];ends.push({s:s,y:Y(e[1]),v:e[1]});});
  ends.sort(function(a,b){return a.y-b.y;});for(var i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<14)ends[i].y=ends[i-1].y+14;   // étiquettes sans chevauchement
  var lab=ends.map(function(e){return '<text x="'+(W-Rm+6)+'" y="'+(e.y+4).toFixed(1)+'" class="bt-end"><tspan style="fill:'+e.s.c+'">●</tspan> '+esc(nf(e.v,0))+' · '+esc(e.s.l)+'</text>';}).join("");
  // données du repère (une ligne par point de la stratégie)
  var data=curves[0].map(function(x,j){return [x[0]].concat(curves.map(function(c){var p=c[Math.min(j,c.length-1)];return Math.round(p[1]*10)/10;}));});
  return '<div class="bt-chart" data-bt-chart="1"><div class="al-leg">'+ks.map(function(s){return '<span><i class="bt-key" style="background:'+s.c+'"></i>'+esc(s.l)+'</span>';}).join("")+'<em>Base 100 au '+esc(frDate(R.from))+'</em></div>'+
    '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Évolution en base 100 : tes règles, allocation fixe, achat-conservation" preserveAspectRatio="none">'+grid+ticks+lines+lab+
    '<line class="bt-cross" x1="0" x2="0" y1="'+T+'" y2="'+(H-Bm)+'" hidden/><rect class="bt-hit" x="'+L+'" y="'+T+'" width="'+(W-L-Rm)+'" height="'+(H-T-Bm)+'" data-bt="hit"/></svg>'+
    '<div class="bt-tip" hidden></div><script type="application/json" class="bt-data">'+JSON.stringify({t0:t0,t1:t1,L:L,W:W,Rm:Rm,keys:ks.map(function(s){return [s.l,s.c];}),d:data}).replace(/</g,"\\u003c")+'</'+'script></div>';
}
var ROWS=[["Valeur finale",function(b,h){return money(b.value,h);}],["Après impôt de sortie",function(b,h,R){return R.tax==="aucune"?"—":money(b.net,h);}],
  ["Rendement annualisé",function(b){return pc(b.metrics.cagr,2);}],["Volatilité annuelle",function(b){return pa(b.metrics.vol);}],
  ["Sharpe (intervalle 95 %)",function(b){var m=b.metrics;return fin(m.sharpe)?nf(m.sharpe,2)+(fin(m.sharpeLo)?' <em>['+nf(m.sharpeLo,2)+' ; '+nf(m.sharpeHi,2)+']</em>':''):"—";}],
  ["Sortino",function(b){return fin(b.metrics.sortino)?nf(b.metrics.sortino,2):"—";}],
  ["Perte maximale",function(b){var m=b.metrics;return pc(m.mdd)+(m.mddFrom?' <em>'+esc(frDate(m.mddFrom))+' → '+esc(frDate(m.mddTo))+'</em>':'');}],
  ["Plus longue période sous un sommet",function(b){return fin(b.metrics.mddDays)?nf(b.metrics.mddDays,0)+" jours":"—";}],
  ["Calmar",function(b){return fin(b.metrics.calmar)?nf(b.metrics.calmar,2):"—";}],["Mois gagnants",function(b){return pa(b.metrics.win,0);}],
  ["Rotation par an (ventes)",function(b){return pa(b.turnoverYear,0);}],["Frais cumulés",function(b,h){return money(b.costs,h);}],["Impôts payés en route",function(b,h,R){return R.tax==="CTO"?money(b.taxes,h):"—";}]];
function metricsHTML(R,o){
  var h=!!(o&&o.hide),ks=SERIES.filter(function(s){return R.books[s.k];});
  return '<div class="tbl-wrap"><table class="scan mk-table pf-tb bt-table"><thead><tr><th>Mesure</th>'+ks.map(function(s){return '<th class="r"><i class="bt-key" style="background:'+s.c+'"></i> '+esc(s.l)+'</th>';}).join("")+'</tr></thead><tbody>'+
    ROWS.map(function(r){return '<tr><td>'+esc(r[0])+'</td>'+ks.map(function(s){return '<td class="r">'+r[1](R.books[s.k],h,R)+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table></div>';
}
function exposureHTML(R){
  var e=R.books.strategie.exposure,ks=Object.keys(e).filter(function(k){return e[k]>0.001;}).sort(function(a,b){return e[b]-e[a];});
  return '<div class="pf-hb">'+ks.map(function(k){return '<div class="pf-hbr"><span>'+esc(label(k))+'</span><i style="width:'+(e[k]*100).toFixed(1)+'%"></i><b>'+pa(e[k])+'</b><em></em></div>';}).join("")+'</div>';
}
function gridHTML(G){
  if(!G)return '<p class="mk-note">La grille rejoue tes règles 9 fois en faisant varier l\'inclinaison (aucune, moitié, maximum du profil) et la bande d\'inaction (1, 2, 4 points). Elle montre si le résultat tient quand on bouge les réglages : on regarde l\'écart, pas la meilleure case.</p><button type="button" class="btn sm" data-bt="grid">Lancer la grille (≈ 10 s)</button>';
  if(G.busy)return '<p class="mk-note">Grille en cours… '+esc(G.n)+' / 9</p>';
  var cell=function(t,b){var c=G.cells.filter(function(x){return x.tilt===t&&x.band===b;})[0];return c&&c.m?'<td class="r">'+pc(c.m.cagr,2)+'<em>Sharpe '+nf(c.m.sharpe,2)+' · '+pc(c.m.mdd,0)+'</em></td>':'<td class="r">—</td>';};
  var tilts=[];G.cells.forEach(function(c){if(tilts.indexOf(c.tilt)<0)tilts.push(c.tilt);});var S=G.sum||{};
  return '<div class="tbl-wrap"><table class="scan mk-table pf-tb bt-grid"><thead><tr><th>Inclinaison / bande</th><th class="r">1 point</th><th class="r">2 points</th><th class="r">4 points</th></tr></thead><tbody>'+
    tilts.map(function(t,i){return '<tr><td>'+esc(["Aucune","Moitié","Maximum"][i]||nf(t,2))+' ('+nf(t*100,0)+' %)</td>'+cell(t,1)+cell(t,2)+cell(t,4)+'</tr>';}).join("")+'</tbody></table></div>'+
    (S.cagr?'<p class="mk-note">Dispersion : rendement annualisé de '+pc(S.cagr.min,2)+' à '+pc(S.cagr.max,2)+' · Sharpe de '+nf(S.sharpe.min,2)+' à '+nf(S.sharpe.max,2)+' · perte maximale de '+pc(S.mdd.min,1)+' à '+pc(S.mdd.max,1)+'.</p>':'');
}
function journalHTML(R,all,hide){
  var j=R.journal.slice().reverse(),list=all?j:j.slice(0,24);
  return '<details class="al-card"><summary>Journal des décisions ('+R.journal.length+')</summary><div class="tbl-wrap"><table class="scan mk-table pf-tb bt-jr"><thead><tr><th>Décision</th><th>Régime</th><th>Répartition visée</th><th class="r">Rotation</th><th class="r">Coût</th></tr></thead><tbody>'+
    list.map(function(x){var w=Object.keys(x.w).sort(function(a,b){return x.w[b]-x.w[a];}).map(function(p){return label(p)+" "+nf(x.w[p]*100,0)+" %";}).join(" · ");
      return '<tr><td>'+esc(frDate(x.date))+'</td><td>'+esc(x.regime||"")+'</td><td class="bt-w">'+esc(w)+(x.frozen&&x.frozen.length?'<em> (bande : '+esc(x.frozen.map(label).join(", "))+')</em>':'')+'</td><td class="r">'+pa(x.turnover,0)+'</td><td class="r">'+(fin(x.cost)?money(x.cost,hide):"—")+'</td></tr>';}).join("")+
    '</tbody></table></div>'+(!all&&R.journal.length>24?'<button type="button" class="btn sm" data-bt="alljr">Tout afficher</button>':'')+'</details>';
}
function tile(k,v,cls,sub){return '<div class="pf-kpi"><em>'+esc(k)+'</em><b class="'+(cls||"")+'">'+v+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</div>';}
/** Vue complète. st : {prefs, f (réglages), R, busy, progress, err, G (grille), hide, alljr, minYear}. */
function viewHTML(st){
  var p=st.prefs||{},f=st.f||{};
  if(!p.saved)return '<div class="al-setup"><h3>Backtest de tes règles</h3><p>Le backtest rejoue la proposition mensuelle sur les années passées, avec tes classes d\'actifs, ton profil et tes limites. Enregistre d\'abord tes règles.</p><button type="button" class="btn primary" data-pf="al-prefs">Définir mes règles</button></div>';
  var head='<div class="ms-head"><div><h3>Backtest de tes règles</h3><p>Profil '+esc(((CK.prefs&&CK.prefs.summary(p))||{}).profile||"")+' · comparé à l\'allocation fixe du profil et à l\'achat-conservation.</p></div></div>'+formHTML(f,{minYear:st.minYear});
  if(st.busy)return head+'<div class="bt-prog"><div><i style="width:'+Math.round((st.progress||0)*100)+'%"></i></div><span>'+esc(st.stage||"Calcul")+' · '+Math.round((st.progress||0)*100)+' %</span><button type="button" class="btn sm" data-bt="cancel">Annuler</button></div>'+warnHTML();
  if(st.err)return head+'<div class="pf-banner warn">'+esc(st.err)+'</div>'+warnHTML();
  if(!st.R)return head+'<p class="mk-note">Choisis tes réglages puis lance le backtest. Le premier calcul lit les historiques (quelques secondes).</p>'+warnHTML()+'<p class="mk-disc">'+esc(disclaimer())+'</p>';
  var R=st.R,s=R.books.strategie,m=s.metrics,fx=R.books.fixe&&R.books.fixe.metrics,h=!!st.hide;
  var kp='<div class="pf-kpis">'+tile("Valeur finale",money(s.value,h),"pf-big",esc(frDate(R.from))+" → "+esc(frDate(R.to))+" · "+esc(R.decisions)+" décisions")+
    tile("Rendement annualisé",pc(m.cagr,2),m.cagr>0?"up":"down",fx?"allocation fixe : "+pc(fx.cagr,2):"")+tile("Volatilité",pa(m.vol),"",fx?"allocation fixe : "+pa(fx.vol):"")+
    tile("Perte maximale",pc(m.mdd),"down",fx?"allocation fixe : "+pc(fx.mdd):"")+tile("Sharpe",fin(m.sharpe)?nf(m.sharpe,2):"—","",fin(m.sharpeLo)?"95 % : "+nf(m.sharpeLo,2)+" à "+nf(m.sharpeHi,2):"")+'</div>';
  var flags=(R.flags||[]).length?'<ul class="pf-checks al-flags">'+R.flags.map(function(x){return '<li><i class="'+(x.level==="attention"?"warn":"")+'" aria-hidden="true">'+(x.level==="attention"?"!":"i")+'</i><span>'+esc(x.msg)+'</span></li>';}).join("")+'</ul>':'';
  return head+kp+flags+'<section class="al-card"><h4>Évolution (base 100 au départ)</h4>'+chartHTML(R)+'</section>'+
    '<section class="al-card"><h4>Mesures</h4>'+metricsHTML(R,st)+'</section>'+
    '<section class="al-card"><h4>Exposition moyenne de tes règles</h4>'+exposureHTML(R)+'</section>'+
    '<section class="al-card"><h4>Sensibilité aux réglages</h4>'+gridHTML(st.G)+'</section>'+journalHTML(R,st.alljr,!!st.hide)+warnHTML()+'<p class="mk-disc">'+esc(disclaimer())+'</p>';
}

/* ================================================================
   Calcul (découpé) et DOM
   ================================================================ */
var ST={R:null,busy:false,progress:0,stage:"",err:null,G:null,alljr:false,cancel:false,memo:{},data:null,key:""},repaint=null;
function form(){var f=null;try{f=CK.lsj?CK.lsj("bt:o"):null;}catch(e){f=null;}f=f&&typeof f==="object"?f:{};
  return {from:/^\d{4}$/.test(String(f.from||""))?Number(f.from):"",freq:f.freq===3?3:1,capital:fin(f.capital)&&f.capital>=100?Math.min(f.capital,1e9):10000,tax:["aucune","CTO","PEA"].indexOf(f.tax)>=0?f.tax:"aucune",costs:f.costs!==false};}
function saveForm(f){try{if(CK.lsj)CK.lsj("bt:o",f);}catch(e){}}
function paint(){if(repaint)repaint();}
/** Exécute un calcul pas à pas (≈ 25 ms par tranche) pour garder la page fluide. */
function chunked(c,onStep){return new Promise(function(done){var tick=function(){if(ST.cancel){done(null);return;}var t=Date.now();while(Date.now()-t<25){if(!c.next()){done(c.result());return;}}onStep(c.progress());setTimeout(tick,0);};tick();});}
function options(d,f,p){return {prefs:p,series:d.series,ref:d.ref,vix:d.vix,rf:d.rf,capital:f.capital,tax:f.tax,costs:f.costs,freq:f.freq,
  from:f.from?Date.UTC(Number(f.from),0,1):undefined,memo:ST.memo,now:now()};}
function load(p){
  if(ST.data&&now()-ST.data.ts<6*36e5)return Promise.resolve(ST.data);
  ST.stage="Lecture des historiques";paint();
  return Promise.all([CK.alui._t.loadData(p,[]),CK.mkt&&CK.mkt.taux?CK.mkt.taux():null]).then(function(x){var d=x[0];ST.data={series:d.series,ref:d.ref,vix:d.vix,rf:x[1]&&x[1].rf||null,ts:now()};ST.memo={};return ST.data;});
}
function start(){
  var p=CK.prefs?CK.prefs.get():null;if(!p||!p.saved||ST.busy)return;var f=form();
  ST.busy=true;ST.cancel=false;ST.err=null;ST.progress=0;ST.G=null;paint();
  load(p).then(function(d){ST.stage="Calcul mois par mois";var c=CK.bt.create(options(d,f,p));if(c.error)throw new Error(c.error);
    return chunked(c,function(pr){ST.progress=pr;paint();});})
  .then(function(R){ST.busy=false;if(R){ST.R=R;ST.key=JSON.stringify(p)+"|"+JSON.stringify(f);}else ST.err=ST.cancel?"Backtest annulé.":"Backtest impossible.";paint();},
    function(e){ST.busy=false;ST.err="Backtest impossible : "+(e&&e.message||e);paint();});
}
function runGrid(){
  if(!ST.R||!ST.data||(ST.G&&ST.G.busy))return;var p=CK.prefs.get(),f=form(),cells=CK.bt.grid(options(ST.data,f,p)),out=[],k=0;ST.G={busy:true,n:0,cells:[]};ST.cancel=false;paint();
  var one=function(){if(k>=cells.length||ST.cancel){ST.G={busy:false,cells:out,sum:CK.bt.summarize(out)};paint();return;}var g=cells[k++],c=CK.bt.create(g.o);
    if(c.error){one();return;}chunked(c,function(){}).then(function(R){if(R)out.push({tilt:g.tilt,band:g.band,m:R.books.strategie.metrics});ST.G.n=k;paint();one();});};
  one();
}
function html(P,V,o){var p=CK.prefs?CK.prefs.get():{};return viewHTML({prefs:p,f:form(),R:ST.R,busy:ST.busy,progress:ST.progress,stage:ST.stage,err:ST.err,G:ST.G,hide:!!(o&&o.hide),alljr:ST.alljr});}
function act(a,id,el){
  if(a==="bt-cancel"||a==="cancel"){ST.cancel=true;return true;}
  if(a==="grid"){runGrid();return true;}
  if(a==="alljr"){ST.alljr=true;paint();return true;}
  return false;
}
/* repère au survol : lit les données du graphique et place la ligne verticale + l'infobulle (textes insérés avec textContent) */
function hover(e){
  var svg=e.target&&e.target.closest?e.target.closest(".bt-chart svg"):null;if(!svg)return;var box=svg.closest(".bt-chart"),js=box.querySelector(".bt-data"),tip=box.querySelector(".bt-tip"),cr=svg.querySelector(".bt-cross");if(!js||!tip)return;
  var D=box._d||(box._d=JSON.parse(js.textContent)),r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*D.W;
  var t=D.t0+(x-D.L)/(D.W-D.L-D.Rm)*(D.t1-D.t0),lo=0,hi=D.d.length-1;while(lo<hi){var m=(lo+hi)>>1;if(D.d[m][0]<t)lo=m+1;else hi=m;}var row=D.d[lo];if(!row)return;
  var cx=D.L+(row[0]-D.t0)/(D.t1-D.t0)*(D.W-D.L-D.Rm);cr.setAttribute("x1",cx);cr.setAttribute("x2",cx);cr.removeAttribute("hidden");
  tip.textContent="";var h=document.createElement("b");h.textContent=frDate(new Date(row[0]).toISOString());tip.appendChild(h);
  D.keys.forEach(function(k,i){var l=document.createElement("div"),sw=document.createElement("i"),v=document.createElement("strong"),n=document.createElement("span");sw.style.background=k[1];v.textContent=nf(row[i+1],1);n.textContent=k[0];l.appendChild(sw);l.appendChild(v);l.appendChild(n);tip.appendChild(l);});
  tip.hidden=false;var px=(cx/D.W)*r.width;tip.style.left=Math.max(0,Math.min(r.width-170,px+12))+"px";
}
function leave(e){var box=e.target&&e.target.closest?e.target.closest(".bt-chart"):null;if(!box)return;var t=box.querySelector(".bt-tip"),c=box.querySelector(".bt-cross");if(t)t.hidden=true;if(c)c.setAttribute("hidden","");}
var wired=false;
function wire(host){
  if(wired||!host)return;wired=true;
  host.addEventListener("submit",function(e){var f=e.target;if(!f||!f.getAttribute||!f.getAttribute("data-bt-form"))return;e.preventDefault();
    var cap=M().num(String(f.capital.value).replace(/[€\s]/g,""));
    saveForm({from:f.from.value?Number(f.from.value):"",freq:Number(f.freq.value)===3?3:1,capital:fin(cap)&&cap>=100?cap:10000,tax:f.tax.value,costs:!!f.costs.checked});start();});
  host.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("[data-bt]"):null;if(b&&b.getAttribute("data-bt")!=="hit")act(b.getAttribute("data-bt"));});
  host.addEventListener("pointermove",hover);host.addEventListener("pointerleave",leave,true);
}
CK.btui={html:html,act:act,start:start,wire:function(host,rp){repaint=rp;wire(host);},state:function(){return {busy:ST.busy,ok:!!ST.R,err:ST.err,grid:ST.G?(ST.G.busy?"busy":"ok"):null};},
  reset:function(){ST={R:null,busy:false,progress:0,stage:"",err:null,G:null,alljr:false,cancel:false,memo:{},data:null,key:""};},
  _t:{viewHTML:viewHTML,chartHTML:chartHTML,metricsHTML:metricsHTML,gridHTML:gridHTML,journalHTML:journalHTML,formHTML:formHTML,warnHTML:warnHTML,form:form}};
})();
