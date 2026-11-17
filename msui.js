/* ================================================================
   COCKPIT — Screener mensuel multi-actifs : interface (phase 6) : CK.msui
   Bascule « Crypto (compression) / Mensuel multi-actifs » dans l'espace Screener (le screener crypto
   n'est ni modifié ni rechargé : il est seulement masqué en mode mensuel). Le mode mensuel a son propre
   bloc (#msMeta, #msBody) et ne charge rien avant d'être ouvert : historiques du robot (en cache),
   Binance pour la crypto, taux et résumé du robot. Aucun appel au scanner TradingView.
   Les fonctions de rendu (CK.msui._t) n'utilisent pas le DOM : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5;
function U(){return CK.u||{};}
function M(){return CK.models||{};}
function esc(s){var f=U().esc;return f?f(s):String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fin(x){return typeof x==="number"&&isFinite(x);}
function nf(v,d){if(!fin(v))return "—";if(Math.abs(v)<Math.pow(10,-(d||0))/2)v=0;return Number(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});}
function pc(v,d){if(!fin(v))return "—";d=d==null?1:d;var p=Math.pow(10,d),r=Math.round(v*100*p)/p;return (r>0?"+":r<0?"−":"")+nf(Math.abs(r),d)+" %";}
function pa(v,d){return fin(v)?nf(v*100,d==null?1:d)+" %":"—";}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function disclaimer(){return CK.DISCLAIMER||"";}
function lsGet(k){try{return CK.ls?CK.ls(k):null;}catch(e){return null;}}
function lsSet(k,v){try{if(CK.ls)CK.ls(k,v);}catch(e){}}

/* ---------- Libellés ---------- */
var LBL={"RENFORCER":["up","Renforcer"],"CONSERVER":["keep","Conserver"],"SURVEILLER":["watch","Surveiller"],"RÉDUIRE":["down","Réduire"],"BASCULER":["sw","Basculer"],"HORS":["out","Hors de tes classes"]};
var GROUPS=[{id:"tous",label:"Tous"},{id:"actions_etf",label:"ETF actions"},{id:"actions_titres",label:"Actions"},{id:"obligations",label:"Obligations"},
  {id:"mp",label:"Matières premières"},{id:"immobilier_cote",label:"Immobilier"},{id:"crypto",label:"Crypto"},{id:"liquidites",label:"Monétaire"}];
var MP={or:1,argent:1,petrole:1,gaz:1,matieres_premieres:1,agricole:1};
function groupOf(i){var p=CK.alloc?CK.alloc.pocheOf(i):null;return MP[p]?"mp":p||"autre";}
var COLS=[{k:"nom",l:"Instrument"},{k:"score",l:"Score",n:1},{k:"momentum",l:"Mom.",n:1,t:"Momentum ajusté du risque (3, 6, 12 mois)"},{k:"tendance",l:"Tend.",n:1,t:"Tendance : cours vs moyennes 50 / 100 / 200 j"},
  {k:"risque",l:"Risque",n:1,t:"Baisse depuis le plus haut et perte maximale sur 12 mois (100 = le plus favorable)"},{k:"volatilite",l:"Vol.",n:1,t:"Volatilité 60 j inverse, bonus si compression"},
  {k:"diversification",l:"Divers.",n:1,t:"Diversification : (1 − corrélation) × 50"},{k:"chop",l:"Compression",n:1,t:"Indice de compression du screener crypto (CHOP 14, quotidien) et son centile sur un an"},
  {k:"pea",l:"PEA"},{k:"label",l:"Étiquette"},{k:"explain",l:"En bref"}];
var PEA_UI={eligible:["ok","PEA"],eligible_regle:["rule","PEA (règle)"],not_eligible:["no","Non PEA"],unknown:["unk","À vérifier"]};
function peaBadge(i){var s=CK.pea&&CK.pea.status?CK.pea.status(i):{status:"unknown",label:"Éligibilité à vérifier"},m=PEA_UI[s.status]||PEA_UI.unknown;
  return '<span class="mk-pea '+m[0]+'" title="'+esc(s.label+(s.source?" · source : "+s.source:"")+(s.checked_at?" · vérifié le "+frDate(s.checked_at):""))+'">'+esc(m[1])+'</span>';}
function peaPass(i,f){if(!f||f==="tous")return true;var s=CK.pea?CK.pea.status(i).status:"unknown";return s==="eligible"||s==="eligible_regle"||(f==="verifier"&&s==="unknown");}
function badge(l){if(!l)return '<span class="ms-lbl ms-none">—</span>';var m=LBL[l]||["watch",l];return '<span class="ms-lbl ms-'+m[0]+'">'+esc(m[1])+'</span>';}
function sc(v){return fin(v)?'<span class="ms-sc" style="--v:'+Math.round(Math.max(0,Math.min(100,v)))+'">'+nf(v,0)+'</span>':'<span class="ms-sc ms-na">—</span>';}

/* ================================================================
   Rendu (sans DOM)
   ================================================================ */
/** Tri et filtres. o : {grp, lbl, peaf, mine, q, sort, dir, prefs}. */
function filterRows(rows,o){
  o=o||{};var q=String(o.q||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
  var out=rows.filter(function(r){
    if(o.grp&&o.grp!=="tous"&&groupOf(r.i)!==o.grp)return false;
    if(o.lbl&&o.lbl!=="toutes"&&r.label!==o.lbl)return false;
    if(!peaPass(r.i,o.peaf))return false;
    if(o.mine&&r.label==="HORS")return false;
    if(q){var t=(r.i.symbol+" "+r.i.name+" "+(r.i.isin||"")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");if(t.indexOf(q)<0)return false;}
    return true;});
  var k=o.sort||"score",dir=o.dir==="asc"?1:-1,val=function(r){if(k==="nom")return r.i.symbol;if(k==="score")return r.score;if(k==="chop")return r.m&&r.m.chop;if(k==="label")return r.label||"";return r.sub&&r.sub[k];};
  out.sort(function(a,b){var x=val(a),y=val(b);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x<y?-1:x>y?1:0)*(k==="nom"||k==="label"?-dir:dir);});
  return out;
}
function rowHTML(r,open){
  var m=r.m||{},ch=fin(m.chop)?nf(m.chop,0)+(fin(m.chopPct)?'<em>'+nf(m.chopPct,0)+'ᵉ c.</em>':''):"—";
  var main='<tr class="clk ms-row'+(open?" on":"")+'" data-ms="open" data-id="'+esc(r.id)+'" tabindex="0" aria-expanded="'+(open?"true":"false")+'">'+
    '<td class="mk-nm"><b>'+esc(r.i.symbol)+(r.held?' <i class="ms-held" title="Dans ton portefeuille">●</i>':'')+'</b><span>'+esc(r.i.name)+'</span></td>'+
    '<td class="r">'+sc(r.score)+'</td>'+["momentum","tendance","risque","volatilite","diversification"].map(function(k){return '<td class="r">'+(fin(r.sub[k])?nf(r.sub[k],0):"—")+'</td>';}).join("")+
    '<td class="r ms-chop">'+ch+'</td><td>'+peaBadge(r.i)+'</td><td>'+badge(r.label)+'</td><td class="ms-ex">'+esc(r.explain||"")+'</td></tr>';
  return open?main+'<tr class="ms-det"><td colspan="'+COLS.length+'">'+detailHTML(r)+'</td></tr>':main;
}
function kv(k,v,t){return '<div'+(t?' title="'+esc(t)+'"':'')+'><em>'+esc(k)+'</em><b>'+v+'</b></div>';}
/** Détail d'une ligne : toutes les composantes, pondérations, étiquette et alternative. */
function detailHTML(r){
  var m=r.m||{},W=CK.ms.weights(),refI=CK.ref.get(r.ref),fee=CK.ms.fee(r.i);
  if(!r.m||m.stale)return '<div class="ms-detb"><p class="mk-note">'+esc(r.explain)+'</p></div>';
  var subs='<div class="ms-subs">'+CK.ms.SUBS.map(function(s){return '<div><em>'+esc(s.l)+' · poids '+esc(W[s.k])+'</em><i style="--v:'+(fin(r.sub[s.k])?Math.round(r.sub[s.k]):0)+'"></i><b>'+(fin(r.sub[s.k])?nf(r.sub[s.k],0):"—")+'</b></div>';}).join("")+'</div>';
  var g='<div class="ms-kv">'+
    kv("Momentum 1 / 3 / 6 / 12 mois",[m.mom1,m.mom3,m.mom6,m.mom12].map(function(x){return pc(x);}).join(" / "))+
    kv("12 mois hors dernier mois",pc(m.mom12_1))+kv("Momentum ajusté du risque",fin(m.momAdj)?nf(m.momAdj,2):"—","rendement / (volatilité × √durée), moyenne 3 / 6 / 12 mois")+
    kv("Tendance",fin(m.trendPts)?nf(m.trendPts,0)+" / 100":"—","25 points par condition : cours > MM50, > MM100, > MM200, MM50 > MM200")+
    kv("MACD",m.macd==null?"—":m.macdOk?"tendance confirmée":"non confirmée","MACD au-dessus de sa ligne de signal et de zéro")+
    kv("Volatilité 20 / 60 / 120 j",[m.vol20,m.vol60,m.vol120].map(function(x){return pa(x,1);}).join(" / "))+kv("Amplitude moyenne (ATR 14)",fin(m.atrp)?nf(m.atrp,2)+" %":"—")+
    kv("Sous le plus haut d'un an",pc(m.dd))+kv("Au-dessus du plus bas d'un an",pc(m.loDist))+kv("Perte maximale 12 mois",pc(m.mdd12))+
    kv("RSI 14 (filtre)",fin(m.rsi)?nf(m.rsi,0):"—","au-dessus de 75 : surachat ; sous 25 : survente")+
    kv("Bandes de Bollinger",fin(m.bbw)?"largeur "+pa(m.bbw)+(fin(m.bbwPct)?" · "+nf(m.bbwPct,0)+"ᵉ centile sur 1 an":""):"—","bas centile = volatilité comprimée")+
    kv("Compression (CHOP 14)",fin(m.chop)?nf(m.chop,1)+(fin(m.chopPct)?" · "+nf(m.chopPct,0)+"ᵉ centile sur 1 an":""):"—","même indice que le screener crypto, sur bougies quotidiennes")+
    kv("Volume relatif",fin(m.relVol)?"× "+nf(m.relVol,2):"—","volume du jour / moyenne des 10 jours précédents")+
    kv("Liquidité (valeur échangée, 10 j)",fin(m.liq)?nf(m.liq/1e6,m.liq>=1e7?0:1)+" M€ / jour":"—")+
    kv("Référence",esc(refI?refI.name:r.ref||"—"))+kv("Corrélation · beta (3 ans)",(fin(m.corrRef)?nf(m.corrRef,2):"—")+" · "+(fin(m.beta)?nf(m.beta,2):"—"))+
    kv("Force relative 6 mois",pc(m.rs),"performance 6 mois moins celle de la référence")+
    kv("Diversification",fin(r.rho)?"corrélation "+nf(r.rho,2)+" avec ton "+(r.divBasis==="portefeuille"?"portefeuille":"marché de référence"):"—")+
    (fin(r.rc)?kv("Part du risque de ton portefeuille",pa(r.rc)):"")+
    kv("Frais estimés",nf(fee,2)+" %/an","frais courants + demi-spread")+'</div>';
  var alt=r.alt?CK.ref.get(r.alt):null;
  return '<div class="ms-detb">'+subs+g+'<p class="ms-why">'+badge(r.label)+' '+esc(r.why||"")+(alt?' <button type="button" class="btn sm" data-ms="fiche" data-id="'+esc(alt.id)+'">Voir '+esc(alt.symbol)+'</button>':'')+
    ' <button type="button" class="btn sm" data-ms="fiche" data-id="'+esc(r.id)+'">Fiche</button></p>'+
    '<p class="mk-note">Données du '+esc(frDate(m.first))+' au '+esc(frDate(m.last))+' (euros, dividendes réinvestis) · '+esc(r.months)+' fins de mois pour les centiles.</p></div>';
}
function barHTML(o,counts){
  var seg=function(list,act,cur){return list.map(function(x){return '<button type="button" data-ms="'+act+'" data-id="'+esc(x.id)+'" aria-pressed="'+(x.id===cur?"true":"false")+'">'+esc(x.label)+(counts&&counts[act+":"+x.id]!=null?' <em>'+counts[act+":"+x.id]+'</em>':'')+'</button>';}).join("");};
  var lbls=[{id:"toutes",label:"Toutes"}].concat(["RENFORCER","CONSERVER","SURVEILLER","RÉDUIRE","BASCULER"].map(function(k){return {id:k,label:LBL[k][1]};}));
  return '<div class="ms-bar"><div class="seg mk-tabs" role="group" aria-label="Classe">'+seg(GROUPS,"grp",o.grp||"tous")+'</div>'+
    '<div class="ms-bar2"><div class="seg" role="group" aria-label="Étiquette">'+seg(lbls,"lbl",o.lbl||"toutes")+'</div>'+
    '<div class="seg" role="group" aria-label="Filtre PEA">'+seg([{id:"tous",label:"Tous"},{id:"eligibles",label:"Éligibles PEA"},{id:"verifier",label:"+ à vérifier"}],"peaf",o.peaf||"tous")+'</div>'+
    '<label class="ms-chk"><input type="checkbox" data-ms="mine"'+(o.mine?" checked":"")+'> Seulement mes classes</label>'+
    '<input type="search" class="ms-q" data-ms="q" placeholder="Rechercher" value="'+esc(o.q||"")+'" autocomplete="off"></div></div>';
}
function tableHTML(rows,o){
  o=o||{};var open=o.open||{};
  if(!rows.length)return '<p class="mk-note">Aucun instrument ne correspond à ces filtres.</p>';
  return '<div class="tbl-wrap"><table class="scan mk-table pf-tb ms-table"><thead><tr>'+COLS.map(function(c){var on=(o.sort||"score")===c.k;
    return '<th'+(c.n?' class="r"':'')+(c.t?' title="'+esc(c.t)+'"':'')+'>'+(c.k==="pea"||c.k==="explain"?esc(c.l):'<button type="button" class="ms-sort'+(on?" on":"")+'" data-ms="sort" data-id="'+c.k+'">'+esc(c.l)+(on?(o.dir==="asc"?" ▲":" ▼"):"")+'</button>')+'</th>';}).join("")+
    '</tr></thead><tbody>'+rows.map(function(r){return rowHTML(r,!!open[r.id]);}).join("")+'</tbody></table></div>';
}
function weightsHTML(){var W=CK.ms.weights(),S=cfg().screener_seuils||{};
  return '<details class="al-card ms-meth"><summary>Comment le score est calculé</summary><p>Score global = moyenne pondérée des sous-scores : '+CK.ms.SUBS.map(function(s){return esc(s.l)+' '+esc(W[s.k]);}).join(" · ")+' (fichier allocation.json, MSCREEN_WEIGHTS).</p><ul>'+
    '<li><b>Momentum</b> : rendement 3, 6 et 12 mois divisé par la volatilité, comparé à son propre historique de 5 ans (centile).</li>'+
    '<li><b>Tendance</b> : 25 points par condition (cours au-dessus des moyennes 50, 100 et 200 jours ; moyenne 50 au-dessus de la 200).</li>'+
    '<li><b>Risque</b> : baisse depuis le plus haut d\'un an et perte maximale sur 12 mois, comparées à son historique (100 = le plus favorable).</li>'+
    '<li><b>Volatilité</b> : volatilité 60 jours inverse, comparée à son historique ; +10 si les bandes de Bollinger sont dans leur 20 % le plus étroit de l\'année.</li>'+
    '<li><b>Diversification</b> : (1 − corrélation hebdomadaire sur 3 ans) × 50, avec ton portefeuille, ou avec le marché de référence si tu n\'en as pas.</li></ul>'+
    '<p>Étiquettes, dans l\'ordre (la première vraie l\'emporte) : hors de tes classes → données insuffisantes (Surveiller) → même exposition moins chère ou éligible PEA, avec un gain annuel supérieur au coût de bascule si tu la détiens (Basculer) → RSI au-dessus de '+esc(S.rsi_surachat||75)+' ou sous '+esc(S.rsi_survente||25)+' (Surveiller) → score ≥ '+esc(S.renforcer_score_min||70)+', tendance ≥ '+esc(S.renforcer_tendance_min||75)+' et 12 mois hors dernier mois au-dessus du taux sans risque (Renforcer) → score &lt; '+esc(S.reduire_score_max||40)+' avec tendance ≤ '+esc(S.reduire_tendance_max||25)+' ou 12 mois négatif (Réduire) → score ≥ '+esc(S.conserver_score_min||50)+' (Conserver) → sinon Surveiller. Seuils : allocation.json, screener_seuils.</p>'+
    '<p>Tout est calculé à la date de décision avec les seuls cours connus ce jour-là, en euros, dividendes réinvestis. L\'indice de compression (CHOP) est celui du screener crypto, appliqué aux bougies quotidiennes ; il est affiché, pas compté dans le score.</p></details>';}
/** Vue complète. st : {R, rows, busy, err, progress, o (filtres), prefs, asOf}. */
function viewHTML(st){
  var p=st.prefs||{},o=st.o||{};
  var head='<div class="ms-head"><div><h3>Screener mensuel'+(st.R?' · '+esc(st.monthLabel||""):'')+'</h3><p>'+(st.R?esc(st.dataLabel||"")+' · '+esc(st.R.rows.length)+' instruments · score 0-100 et étiquette selon tes règles':'Classement mensuel de tous les instruments suivis (ETF, actions, obligations, matières premières, crypto).')+'</p></div>'+
    '<div class="ms-acts">'+(p.saved?'':'<button type="button" class="btn sm primary" data-ms="prefs">Définir mes règles</button>')+'<button type="button" class="btn sm" data-ms="run">Recalculer</button></div></div>'+
    (p.saved?'':'<p class="pf-banner info">Les scores s\'affichent pour tous les instruments. Les étiquettes (Renforcer, Réduire…) n\'apparaissent qu\'une fois tes règles enregistrées, et jamais pour une classe que tu n\'as pas cochée.</p>');
  if(st.err&&!st.R)return head+'<div class="pf-banner warn">'+esc(st.err)+'</div>';
  if(!st.R)return head+'<div class="al-load"><span class="al-spin" aria-hidden="true"></span>Lecture des historiques… '+esc(st.progress||"")+'</div>';
  var counts={};(st.R.rows||[]).forEach(function(r){var g=groupOf(r.i);counts["grp:"+g]=(counts["grp:"+g]||0)+1;counts["grp:tous"]=(counts["grp:tous"]||0)+1;if(r.label)counts["lbl:"+r.label]=(counts["lbl:"+r.label]||0)+1;});
  var rows=filterRows(st.R.rows,Object.assign({},o,{prefs:p}));
  return head+(st.busy?'<p class="mk-note">Mise à jour en cours… '+esc(st.progress||"")+'</p>':'')+(st.missing&&st.missing.length?'<p class="mk-note">Historique indisponible pour '+esc(st.missing.length)+' instrument(s) : ils restent sans score.</p>':'')+
    barHTML(o,counts)+tableHTML(rows,Object.assign({},o,{open:st.open||{}}))+weightsHTML()+'<p class="mk-disc">'+esc(disclaimer())+'</p>';
}

/* ================================================================
   Données et calcul
   ================================================================ */
var ST={R:null,busy:false,err:null,progress:"",data:null,dataTs:0,key:"",o:null,open:{}},seen=false,built=false;
function universe(){return CK.ref.all().filter(function(i){return i.is_investable===true&&i.is_active!==false&&i.vehicle!=="cash"&&i.asset_class!=="stablecoin"&&i.asset_class!=="devises";}).map(function(i){return i.id;});}
function refIds(){var out=[];Object.keys(CK.ms.REFS).forEach(function(k){out.push(CK.ms.REFS[k]);});var px=cfg().proxies||{};Object.keys(px).forEach(function(k){if(px[k]&&px[k].id)out.push(px[k].id);});out.push("crypto:BTC");
  return out.filter(function(x,k){return out.indexOf(x)===k;});}
function hist(id){var i=CK.ref.get(id),crypto=/^crypto:/.test(id);if(!CK.mkt||!CK.mkt.history)return Promise.resolve({bars:[],div:null});
  return CK.mkt.history(id,crypto?{from:now()-8*365*DAY}:{}).then(function(b){var ev=null;try{var h=CK.mkt.adapters().hist;ev=h&&h.events?h.events(i):null;}catch(e){ev=null;}return {bars:b||[],div:ev&&ev.div||null};},function(){return {bars:[],div:null};});}
/** Charge tous les historiques (4 à la fois), avec progression. */
function loadAll(repaint){
  if(ST.data&&now()-ST.dataTs<6*36e5)return Promise.resolve(ST.data);
  var ids=universe(),all=ids.concat(refIds().filter(function(x){return ids.indexOf(x)<0;})),done=0,raw={};
  var fxp=CK.fx&&CK.fx.load?Promise.resolve(CK.fx.load()).then(null,function(){return null;}):Promise.resolve(null);
  return fxp.then(function(){return hist("tv:FX_IDC:EURUSD");}).then(function(eu){
    var eus=CK.alloc.eurSeries(eu.bars,"EUR",null),fx=CK.alui&&CK.alui._t.fxFn?CK.alui._t.fxFn(eus):function(c,d){return CK.fx.rate(c,d);};
    var q=all.slice(),run=function(){var id=q.shift();if(!id)return Promise.resolve();return hist(id).then(function(h){raw[id]=h;done++;ST.progress=done+" / "+all.length;if(repaint)repaint();return run();});};
    var extra=Promise.all([CK.mkt&&CK.mkt.taux?CK.mkt.taux():null,CK.mkt&&CK.mkt.resume?CK.mkt.resume():null]);
    return Promise.all([run(),run(),run(),run(),extra]).then(function(x){
      var series={},missing=[];all.forEach(function(id){var h=raw[id];if(!h||!h.bars.length){if(ids.indexOf(id)>=0)missing.push(id);return;}
        var ccy=h.bars[h.bars.length-1].currency||(CK.ref.get(id)||{}).currency||"EUR";series[id]=CK.ms.prep(h.bars,h.div,ccy,fx);});
      var d={ids:ids,series:series,missing:missing,taux:x[4][0],resume:x[4][1]&&x[4][1].items||null};ST.data=d;ST.dataTs=now();return d;});
  });
}
/** Taux sans risque sur 12 mois à la date T : €STR publié le jour ouvré ≤ T (fraction). */
function rfAt(taux,T){var s=taux&&taux.estr&&taux.estr.serie;if(!s||!Array.isArray(s.d)||!Array.isArray(s.v))return 0;var day=new Date(T).toISOString().slice(0,10),v=null;
  for(var k=0;k<s.d.length;k++){if(s.d[k]<=day&&fin(s.v[k]))v=s.v[k];}return fin(v)?v/100:0;}
/** Portefeuille : lignes détenues (valeur, compte, part de plus-value), rendement hebdomadaire composite, contributions au risque. */
function pfContext(d,T){
  var out={held:{},pfRet:null,risk:{}};if(!CK.pfc)return out;var P=CK.pfc.load();if(!P.accounts.length)return out;
  var res=d.resume||{},close=function(id){var r=res[id];return r&&fin(r.c)?{c:r.c,d:r.d}:null;};
  var V=CK.pfc.value(P,function(id){return CK.mkt&&CK.mkt.last?CK.mkt.last(id):null;},{close:close}),acc={};(V.accounts||[]).forEach(function(a){acc[a.id]=a;});
  var by={};(V.lines||[]).forEach(function(L){if(!(L.value>0))return;var b=by[L.instrument_id]||(by[L.instrument_id]={value:0,account_type:null,gain_share:0,_v:0});b.value+=L.value;
    var at=acc[L.account_id]&&acc[L.account_id].account_type;if(L.value>b._v){b._v=L.value;b.account_type=at;b.gain_share=L.price>0&&L.pru!=null?(L.price*(L.fx||1)-L.pru*(L.fxb||L.fx||1))/(L.price*(L.fx||1)):0;}});
  var tot=Object.keys(by).reduce(function(s,k){return s+by[k].value;},0);if(!(tot>0))return out;out.held=by;
  // rendement hebdomadaire du portefeuille (lignes mesurées, poids actuels) et contributions au risque
  var lines=[],agg={},wsum=0;Object.keys(by).forEach(function(id){var S=d.series[id];if(!S)return;var w=by[id].value/tot,r=CK.ms.wret(S,T,156);wsum+=w;
    Object.keys(r).forEach(function(k){agg[k]=agg[k]||{s:0,w:0};agg[k].s+=w*r[k];agg[k].w+=w;});lines.push({id:id,label:id,w:w,weekly:CK.alloc.weeklyMap(S,T,160)});});
  if(wsum>0){out.pfRet={};Object.keys(agg).forEach(function(k){if(agg[k].w>=wsum*0.8)out.pfRet[k]=agg[k].s/agg[k].w;});}
  try{var rk=CK.pfc.risk(lines,0);(rk.contrib||[]).forEach(function(c){if(fin(c.rc))out.risk[c.id]=c.rc;});}catch(e){}
  return out;
}
function compute(d){
  var p=CK.prefs?CK.prefs.get():null,D=CK.alloc.decision(now()),T=D.T,pc=pfContext(d,T);
  var R=CK.ms.run({T:T,series:d.series,ids:d.ids,prefs:p&&p.saved?p:null,rf12:rfAt(d.taux,T),held:pc.held,pfRet:pc.pfRet,risk:pc.risk});
  R.monthLabel=D.monthLabel;R.dataLabel=D.dataLabel;return R;
}
function prefsKey(){var p=CK.prefs?CK.prefs.get():null;return JSON.stringify(p||{})+"|"+((CK.pfc&&CK.pfc.load().updated_at)||"");}
/** Lance le chargement et le calcul si nécessaire. */
function ensure(force){
  if(ST.busy)return;var k=prefsKey();if(!force&&ST.R&&ST.key===k&&now()-ST.dataTs<6*36e5)return;
  ST.busy=true;ST.err=null;if(force)ST.data=null;paint();
  loadAll(paint).then(function(d){setTimeout(function(){try{ST.R=compute(d);ST.key=k;ST.missing=d.missing;}catch(e){ST.err="Calcul impossible : "+(e&&e.message||e);}ST.busy=false;ST.progress="";paint();},0);},
    function(e){ST.busy=false;ST.err="Lecture des historiques impossible : "+(e&&e.message||e);paint();});
}

/* ================================================================
   DOM : bascule de mode, bloc, événements
   ================================================================ */
function $(id){return typeof document!=="undefined"&&document.getElementById?document.getElementById(id):null;}
function mode(){var m=lsGet("scr:mode");return m==="mensuel"?"mensuel":"crypto";}
function opts(){if(!ST.o){var o=null;try{o=CK.lsj?CK.lsj("ms:o"):null;}catch(e){o=null;}o=o&&typeof o==="object"?o:{};
  ST.o={grp:typeof o.grp==="string"?o.grp:"tous",lbl:typeof o.lbl==="string"?o.lbl:"toutes",mine:o.mine===true,sort:typeof o.sort==="string"?o.sort:"score",dir:o.dir==="asc"?"asc":"desc",q:""};}
  ST.o.peaf=(function(v){return v==="eligibles"||v==="verifier"?v:"tous";})(lsGet("mk:pea"));return ST.o;}
function saveOpts(){try{if(CK.lsj)CK.lsj("ms:o",{grp:ST.o.grp,lbl:ST.o.lbl,mine:ST.o.mine,sort:ST.o.sort,dir:ST.o.dir});}catch(e){}}
function toggleHTML(m){return '<div class="seg ms-mode" role="group" aria-label="Mode du screener"><button type="button" data-ms-mode="crypto" aria-pressed="'+(m==="crypto"?"true":"false")+'">Crypto (compression)</button><button type="button" data-ms-mode="mensuel" aria-pressed="'+(m==="mensuel"?"true":"false")+'">Mensuel multi-actifs</button></div>';}
function applyMode(){
  var m=mode();if(typeof document==="undefined")return;document.body.setAttribute("data-scrmode",m);
  [].forEach.call(document.querySelectorAll(".ms-mode button"),function(b){b.setAttribute("aria-pressed",b.getAttribute("data-ms-mode")===m?"true":"false");});
  if(m==="mensuel"&&seen)ensure(false);
}
function injectToggle(){
  if(typeof document==="undefined")return;var C=CK.cfg?CK.cfg():{};if(C.modules&&C.modules.msmain===false)return;
  [document.querySelector('[data-mod="screener"] .mhd'),document.querySelector('[data-mod="msmain"] .mhd')].forEach(function(h){if(!h||h.querySelector(".ms-mode"))return;
    var meta=h.querySelector(".meta"),w=document.createElement("div");w.innerHTML=toggleHTML(mode());h.insertBefore(w.firstChild,meta||null);});
}
var paintQ=false;
function paint(){if(paintQ)return;paintQ=true;setTimeout(function(){paintQ=false;var b=$("msBody");if(!b||mode()!=="mensuel")return;var p=CK.prefs?CK.prefs.get():{};
  var focus=document.activeElement&&document.activeElement.getAttribute&&document.activeElement.getAttribute("data-ms")==="q";
  b.innerHTML=viewHTML({R:ST.R,busy:ST.busy,err:ST.err,progress:ST.progress,o:opts(),prefs:p,open:ST.open,monthLabel:ST.R&&ST.R.monthLabel,dataLabel:ST.R&&ST.R.dataLabel,missing:ST.missing});
  var meta=$("msMeta");if(meta)meta.textContent=ST.R?ST.R.rows.filter(function(r){return r.label==="RENFORCER";}).length+" à renforcer · "+ST.R.rows.filter(function(r){return r.label==="RÉDUIRE";}).length+" à réduire":"";
  if(focus){var q=b.querySelector('[data-ms="q"]');if(q){q.focus();var n=q.value.length;try{q.setSelectionRange(n,n);}catch(e){}}}},30);}
function onClick(e){
  var t=e.target;if(!t||!t.closest)return;var mm=t.closest("[data-ms-mode]");
  if(mm){lsSet("scr:mode",mm.getAttribute("data-ms-mode"));applyMode();if(mode()==="mensuel"){seen=true;ensure(false);paint();}return;}
  var b=t.closest("[data-ms]");if(!b||!$("msBody")||!$("msBody").contains(b))return;var a=b.getAttribute("data-ms"),id=b.getAttribute("data-id"),o=opts();
  if(b.tagName==="TR"&&t.closest("button,a"))return;
  switch(a){
    case "open":ST.open[id]=!ST.open[id];paint();return;
    case "grp":o.grp=id;saveOpts();paint();return;
    case "lbl":o.lbl=id;saveOpts();paint();return;
    case "peaf":lsSet("mk:pea",id);paint();return;
    case "sort":if(o.sort===id)o.dir=o.dir==="asc"?"desc":"asc";else{o.sort=id;o.dir=id==="nom"||id==="label"?"asc":"desc";}saveOpts();paint();return;
    case "run":ensure(true);return;
    case "prefs":if(CK.prefs)CK.prefs.open();return;
    case "fiche":if(CK.mk&&CK.mk.fiche)CK.mk.fiche(id);return;
  }
}
function build(){
  if(built||typeof document==="undefined")return;built=true;injectToggle();applyMode();
  document.addEventListener("click",onClick);
  var b=$("msBody");if(b){b.addEventListener("input",function(e){if(e.target&&e.target.getAttribute("data-ms")==="q"){opts().q=e.target.value;paint();}});
    b.addEventListener("change",function(e){if(e.target&&e.target.getAttribute("data-ms")==="mine"){opts().mine=!!e.target.checked;saveOpts();paint();}});
    b.addEventListener("keydown",function(e){if(e.key!=="Enter"||!e.target.closest)return;var r=e.target.closest("tr[data-ms]");if(r){e.preventDefault();ST.open[r.getAttribute("data-id")]=!ST.open[r.getAttribute("data-id")];paint();}});}
}
function onView(on){if(on){seen=true;build();injectToggle();applyMode();if(mode()==="mensuel")ensure(false);}}
function open(){lsSet("scr:mode","mensuel");if(CK.layout&&CK.layout.show)CK.layout.show("screener");build();applyMode();seen=true;ensure(false);paint();}

CK.msui={
  boot:function(){if(CK.onView)CK.onView("screener",onView);build();
    var prev=CK.onPrefs;CK.onPrefs=function(p){if(typeof prev==="function")try{prev(p);}catch(e){}if(seen&&mode()==="mensuel")ensure(false);};},
  open:open,mode:mode,rows:function(){return ST.R?ST.R.rows:[];},state:function(){return {busy:ST.busy,err:ST.err,n:ST.R?ST.R.rows.length:0,mode:mode()};},
  _t:{viewHTML:viewHTML,filterRows:filterRows,detailHTML:detailHTML,tableHTML:tableHTML,toggleHTML:toggleHTML,groupOf:groupOf,rfAt:rfAt,universe:universe,refIds:refIds,pfContext:pfContext,
    reset:function(){ST={R:null,busy:false,err:null,progress:"",data:null,dataTs:0,key:"",o:null,open:{}};seen=false;}}
};
})();
