/* ================================================================
   COCKPIT — Screener mensuel multi-actifs (phase 6) : CK.ms
   Score mensuel par instrument, calculé à la date de décision (dernière séance Euronext du mois,
   22 h 30 à Paris) avec les seuls historiques datés (point-in-time, en euros, dividendes réinvestis).
   L'indice de compression existant (CHOP 14 du screener crypto, fonction inchangée) est affiché à côté.
   Sous-scores 0-100 : momentum, tendance, risque, volatilité, diversification ; score global pondéré
   par allocation.json → MSCREEN_WEIGHTS (jamais dans l'interface) ; étiquette par table ordonnée
   (seuils dans allocation.json → screener_seuils) ; explication courte et détail des composantes.
   Fonctions pures (aucun DOM, aucun réseau) : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5;
function M(){return CK.models||{};}
function IND(){return CK.ind;}
function A(){return CK.alloc;}
function fin(x){return typeof x==="number"&&isFinite(x);}
function nz(v,d){return fin(v)?v:d;}
function dict(){return Object.create(null);}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function pct(v,d){return fin(v)?(Math.round(v*Math.pow(10,(d||1)+2))/Math.pow(10,d||1)).toLocaleString("fr-FR")+" %":"—";}
function mean(a){var s=0;for(var i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:null;}

var LABELS=["RENFORCER","CONSERVER","SURVEILLER","RÉDUIRE","BASCULER"];
var SUBS=[{k:"momentum",l:"Momentum"},{k:"tendance",l:"Tendance"},{k:"risque",l:"Risque"},{k:"volatilite",l:"Volatilité"},{k:"diversification",l:"Diversification"}];

/* ---------- Série en euros, dividendes réinvestis ---------- */
/**
 * bars : PriceBar[] (timestamp, open, high, low, close, volume) ; div : [[t, montant]] ; ccy : devise des cours ;
 * fx(ccy, "AAAA-MM-JJ") → € pour 1 (à la date, jamais une date future). Renvoie {t, o, h, l, c (rendement total, €), raw (clôture €), v}.
 * Les cours bruts sont gardés pour la liquidité ; o / h / l suivent le même facteur que c (ATR et CHOP inchangés en proportion).
 */
function prep(bars,div,ccy,fx){
  var t=[],c=[],o=[],h=[],l=[],v=[],r=[],list=Array.isArray(bars)?bars:[];
  for(var k=0;k<list.length;k++){var b=list[k],ts=b&&(b.timestamp!=null?b.timestamp:b.t),cl=b&&(b.close!=null?b.close:b.c);if(!fin(ts)||!(cl>0))continue;
    if(t.length&&ts<=t[t.length-1])continue;var cc=ccy||b.currency||"EUR",x=cc==="EUR"?1:fx?fx(cc,new Date(ts).toISOString().slice(0,10)):null;if(!(x>0))continue;
    var g=function(y){y=y!=null?y:null;return fin(y)&&y>0?y:cl;};
    t.push(ts);c.push(cl);o.push(g(b.open!=null?b.open:b.o));h.push(g(b.high!=null?b.high:b.h));l.push(g(b.low!=null?b.low:b.l));v.push(fin(b.volume!=null?b.volume:b.v)?(b.volume!=null?b.volume:b.v):null);r.push(x);}
  var tr=IND().totalReturn(t,c,div);
  var S={t:t,c:[],o:[],h:[],l:[],raw:[],v:v};
  for(var j=0;j<t.length;j++){var f=c[j]>0?tr[j]/c[j]:1;S.c.push(tr[j]*r[j]);S.o.push(o[j]*f*r[j]);S.h.push(Math.max(h[j],c[j])*f*r[j]);S.l.push(Math.min(l[j],c[j])*f*r[j]);S.raw.push(c[j]*r[j]);}
  return S;
}

/* ---------- Indicateurs à la date T ---------- */
function ema(a,n){if(!a.length)return [];var k=2/(n+1),out=[a[0]];for(var i=1;i<a.length;i++)out.push(a[i]*k+out[i-1]*(1-k));return out;}
function sd(a){var m=mean(a),s=0;for(var i=0;i<a.length;i++)s+=(a[i]-m)*(a[i]-m);return a.length>1?Math.sqrt(s/(a.length-1)):null;}
function bbWidth(c,e){if(e<19)return null;var w=c.slice(e-19,e+1),m=mean(w),s=sd(w);return m>0&&s!=null?4*s/m:null;}
function candles(S,a,e){var out=[];for(var k=Math.max(0,a);k<=e;k++)out.push({h:S.h[k],l:S.l[k],c:S.c[k],o:S.o[k]});return out;}
function prank(x,xs){var lo=0,eq=0;xs.forEach(function(v){if(v<x)lo++;else if(v===x)eq++;});return xs.length?100*(lo+eq/2)/xs.length:50;}
function T_(){return CK.screener&&CK.screener._t||null;}
/** Rendements hebdomadaires (clés de semaine) sur `n` semaines ≤ T. */
function wret(S,T,n){var w=A().weeklyTail(S,T,n),out=dict();for(var k=1;k<w.k.length;k++)out[w.k[k]]=w.v[k]/w.v[k-1]-1;return out;}
function corrBeta(a,b){var ks=Object.keys(a).filter(function(k){return b[k]!=null;});if(ks.length<26)return {corr:null,beta:null,n:ks.length};
  var x=ks.map(function(k){return a[k];}),y=ks.map(function(k){return b[k];}),mx=mean(x),my=mean(y),sxy=0,sxx=0,syy=0;
  for(var i=0;i<x.length;i++){sxy+=(x[i]-mx)*(y[i]-my);sxx+=(x[i]-mx)*(x[i]-mx);syy+=(y[i]-my)*(y[i]-my);}
  return {corr:sxx>0&&syy>0?sxy/Math.sqrt(sxx*syy):null,beta:syy>0?sxy/syy:null,n:ks.length};}
/**
 * Toutes les mesures d'un instrument à la date T. S : prep() ; py : séances par an (252 ou 365) ; R : série de référence (prep ou {t,c}).
 */
function analyze(S,T,py,R){
  var I=IND();if(!S||!S.t||!S.t.length)return null;var e=I.idxAt(S.t,T);if(e<0)return null;
  var base=A().metricsAt({t:S.t,c:S.c},T,py,null);if(!base)return null;if(base.stale)return {stale:true,last:base.last};
  var m=Object.assign({},base),c=S.c,P=c[e];
  m.trendPts=fin(base.trend)?base.trend*100:null;
  var tt=T_(),cs=candles(S,e-14,e);
  m.atrp=tt&&cs.length>=15?tt.atrp(cs,14):null;
  m.chop=tt&&cs.length>=15?tt.chop(cs,14):null;
  var closes=c.slice(Math.max(0,e-299),e+1);m.rsi=tt&&closes.length>15?tt.rsi(closes,14):null;
  var e12=ema(closes,12),e26=ema(closes,26),mac=e12.map(function(x,k){return x-e26[k];}),sig=ema(mac,9);
  m.macd=closes.length>=60?mac[mac.length-1]/P:null;m.macdSig=closes.length>=60?sig[sig.length-1]/P:null;m.macdOk=m.macd!=null&&m.macd>m.macdSig&&m.macd>0;
  m.bbw=bbWidth(c,e);var ws=[],chs=[];for(var k=Math.max(19,e-251);k<=e;k++){var bw=bbWidth(c,k);if(bw!=null)ws.push(bw);if(tt&&k>=14){var ch=tt.chop(candles(S,k-14,k),14);if(ch!=null)chs.push(ch);}}
  m.bbwPct=m.bbw!=null&&ws.length>=60?prank(m.bbw,ws):null;m.chopPct=m.chop!=null&&chs.length>=60?prank(m.chop,chs):null;
  var vs=S.v?S.v.slice(Math.max(0,e-10),e).filter(function(x){return x>0;}):[];m.relVol=S.v&&S.v[e]>0&&vs.length>=5?S.v[e]/mean(vs):null;
  var liq=[];for(var q=Math.max(0,e-9);q<=e;q++)if(S.v&&S.v[q]>0&&S.raw)liq.push(S.v[q]*S.raw[q]);m.liq=liq.length>=5?mean(liq):null;
  m.hiDist=fin(base.range)&&fin(base.dd)?base.dd:null;
  var a=Math.max(0,I.idxAt(S.t,S.t[e]-365*DAY)),lo=Infinity;for(var z=a;z<=e;z++)if(c[z]<lo)lo=c[z];m.loDist=lo>0?P/lo-1:null;
  if(R&&R.t&&R.t.length){var cb=corrBeta(wret(S,T,156),wret(R,T,156));m.corrRef=cb.corr;m.beta=cb.beta;
    var r6=I.minusMonths(T,6),er=I.idxAt(R.t,T);m.rs=base.mom6!=null&&er>=0&&I.idxAt(R.t,r6)>=0&&R.t[0]<=r6?base.mom6-I.ret(R.t,R.c,r6,R.t[er]):null;}
  else{m.corrRef=null;m.beta=null;m.rs=null;}
  return m;
}
/** Historique de fin de mois (5 ans, sans rien voir après chaque date) des grandeurs qui deviennent des percentiles. */
function history(S,T,py){
  var h={momAdj:[],dd:[],mdd12:[],vol60:[]};
  for(var k=1;k<=60;k++){var d=new Date(T),Tk=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-k+1,0,21,30);if(!S.t.length||Tk<S.t[0])break;
    var m=A().metricsAt({t:S.t,c:S.c},Tk,py,null);if(!m||m.stale)continue;
    if(fin(m.momAdj))h.momAdj.push(m.momAdj);if(fin(m.dd))h.dd.push(m.dd);if(fin(m.mdd12))h.mdd12.push(m.mdd12);if(fin(m.vol60))h.vol60.push(-m.vol60);}
  return h;
}
/**
 * Sous-scores 0-100. Momentum, risque et volatilité : percentile dans l'historique propre de l'instrument (5 ans, 12 fins de mois au moins).
 * Tendance : 25 points par condition (cours > MM50, > MM100, > MM200, MM50 > MM200). Volatilité : bonus de 10 si les bandes de
 * Bollinger sont dans leur 20 % le plus étroit de l'année (compression). Diversification : (1 − corrélation) × 50, corrélation
 * hebdomadaire sur 3 ans avec ton portefeuille (ou avec l'indice de référence si tu n'as pas de portefeuille).
 */
function subscores(m,h,rho){
  var s={momentum:null,tendance:null,risque:null,volatilite:null,diversification:null};if(!m||m.stale)return s;
  var ok=function(a){return a&&a.length>=12;};
  if(fin(m.momAdj)&&ok(h.momAdj))s.momentum=prank(m.momAdj,h.momAdj.concat([m.momAdj]));
  if(fin(m.trendPts))s.tendance=m.trendPts;
  var r=[];if(fin(m.dd)&&ok(h.dd))r.push(prank(m.dd,h.dd.concat([m.dd])));if(fin(m.mdd12)&&ok(h.mdd12))r.push(prank(m.mdd12,h.mdd12.concat([m.mdd12])));if(r.length)s.risque=mean(r);
  if(fin(m.vol60)&&ok(h.vol60))s.volatilite=Math.min(100,prank(-m.vol60,h.vol60.concat([-m.vol60]))+(fin(m.bbwPct)&&m.bbwPct<=20?10:0));
  if(fin(rho))s.diversification=Math.max(0,Math.min(100,(1-rho)*50));
  return s;
}
function weights(){var w=cfg().MSCREEN_WEIGHTS||{};return {momentum:nz(w.momentum,30),tendance:nz(w.tendance,25),risque:nz(w.risque,15),volatilite:nz(w.volatilite,15),diversification:nz(w.diversification,15)};}
/** Score global : moyenne pondérée des sous-scores disponibles (les poids viennent d'allocation.json). */
function global(s){var W=weights(),t=0,ws=0;SUBS.forEach(function(x){if(fin(s[x.k])&&W[x.k]>0){t+=W[x.k]*s[x.k];ws+=W[x.k];}});return ws>0?Math.round(t/ws*10)/10:null;}
/** Explication courte : la composante la plus forte et la plus faible, en mots simples. */
function explain(r){
  if(!r.m||r.m.stale)return "Données trop anciennes ou absentes à la date de décision.";
  if(r.score==null)return "Historique trop court pour un score fiable (moins d'un an).";
  var W={momentum:["élan fort sur 3 à 12 mois","élan faible sur 3 à 12 mois"],tendance:["au-dessus de ses moyennes mobiles","sous ses moyennes mobiles"],
    risque:["proche de ses plus hauts","loin de ses plus hauts"],volatilite:["calme pour lui","plus agité que d'habitude"],
    diversification:r.divBasis==="portefeuille"?["diversifie bien ton portefeuille","très corrélé à ton portefeuille"]:["peu lié à son marché de référence","suit de près son marché de référence"]};
  var ks=SUBS.map(function(x){return x.k;}).filter(function(k){return fin(r.sub[k]);}).sort(function(a,b){return r.sub[b]-r.sub[a];});
  if(!ks.length)return "";var hi=ks[0],lo=ks[ks.length-1],out=[];
  if(r.sub[hi]>=60)out.push(W[hi][0]);if(lo!==hi&&r.sub[lo]<=40)out.push(W[lo][1]);
  var liq=A().pocheOf(r.i)==="liquidites";
  if(!liq&&fin(r.m.rsi)&&r.m.rsi>75)out.push("surachat (RSI "+Math.round(r.m.rsi)+")");else if(!liq&&fin(r.m.rsi)&&r.m.rsi<25)out.push("survente (RSI "+Math.round(r.m.rsi)+")");
  if(fin(r.m.bbwPct)&&r.m.bbwPct<=20)out.push("volatilité comprimée");
  var t=out.join(", ");return t?t.charAt(0).toUpperCase()+t.slice(1)+".":"Profil moyen sur toutes les composantes.";
}

/* ---------- Étiquette (table ordonnée : la première règle vraie l'emporte) ---------- */
function fee(i){var sp=((cfg().couts||{}).spread_bps_defaut||{})[i&&i.vehicle];return nz(i&&i.ter,0)+nz(i&&i.spread_bps,nz(sp,10))/200;}
/** Meilleure alternative de même exposition : moins chère (≥ 0,05 pt par an) ou éligible PEA alors que la ligne ne l'est pas. */
function betterAlt(r,rows,prefs){
  var i=r.i;if(!i||!i.alt_group)return null;var peaOn=prefs&&prefs.pea_mode&&prefs.pea_mode!=="off",peaOk=function(x){return CK.pea?CK.pea.allowedIn(x,"PEA").ok:false;};
  var mine=fee(i),cand=rows.filter(function(x){return x!==r&&x.i&&x.i.alt_group===i.alt_group&&x.score!=null&&(!prefs||!prefs.saved||CK.allow(x.i,prefs));});
  var best=null;cand.forEach(function(x){var gain=mine-fee(x.i),why=null;
    if(peaOn&&peaOk(i)&&!peaOk(x.i))return;   // en mode PEA, jamais d'un éligible vers un non éligible
    if(gain>=0.05)why="même exposition, frais plus bas ("+String(Math.round(gain*100)/100).replace(".",",")+" pt par an de moins)";
    else if(peaOn&&!peaOk(i)&&peaOk(x.i)&&gain>-0.1)why="même exposition, éligible PEA";
    if(why&&(!best||gain>best.gain))best={row:x,gain:gain,why:why};});
  return best;
}
/**
 * ctx : {prefs (enregistrées ou null), rf12 (taux sans risque 12 mois, en fraction), held ({id: {value, account_type, gain_share}})}.
 * Renvoie {label, why}. Sans règles enregistrées : aucune étiquette (seulement les scores).
 */
function label(r,rows,ctx){
  var S=cfg().screener_seuils||{},p=ctx.prefs;
  if(!p||!p.saved)return {label:null,why:"Enregistre tes règles pour voir les étiquettes."};
  if(!CK.allow(r.i,p)){var w=CK.allow.why(r.i,p);return {label:"HORS",why:/^Hors de tes classes/.test(w)?w:"Hors de tes règles : "+w.charAt(0).toLowerCase()+w.slice(1)};}
  if(!r.m||r.m.stale||r.score==null||!(r.m.years>=1))return {label:"SURVEILLER",why:"Données insuffisantes : on observe avant d'agir."};
  var alt=betterAlt(r,rows,p),h=ctx.held&&ctx.held[r.id];
  if(alt){var ok=true;
    if(h&&h.value>0){var cost=2*(CK.sel?CK.sel.orderCost(h.value,h.account_type||"CTO",r.i):0)+(CK.sel?CK.sel.saleTax(h.value,h.account_type||"CTO",h.gain_share||0):0);
      ok=h.value*alt.gain/100>cost;alt.cost=cost;}
    if(ok)return {label:"BASCULER",why:"Vers "+alt.row.i.symbol+" : "+alt.why+(alt.cost!=null?" ; gain annuel supérieur au coût de bascule":"")+".",alt:alt.row.id};}
  if(A().pocheOf(r.i)==="liquidites")return {label:"CONSERVER",why:"Fonds monétaire : réserve de liquidités, rendement proche du taux sans risque (son score sert peu)."};
  var rsi=r.m.rsi;   // un fonds monétaire monte tout seul : RSI sans signification
  if(fin(rsi)&&(rsi>nz(S.rsi_surachat,75)||rsi<nz(S.rsi_survente,25)))return {label:"SURVEILLER",why:(rsi>50?"Surachat":"Survente")+" (RSI "+Math.round(rsi)+") : attendre que ça se calme."};
  var m12=r.m.mom12_1,tr=r.sub.tendance;
  if(r.score>=nz(S.renforcer_score_min,70)&&fin(tr)&&tr>=nz(S.renforcer_tendance_min,75)&&fin(m12)&&m12>nz(ctx.rf12,0))return {label:"RENFORCER",why:"Score élevé, tendance haussière et performance 12 mois (hors dernier mois) au-dessus du taux sans risque."};
  if(r.score<nz(S.reduire_score_max,40)&&((fin(tr)&&tr<=nz(S.reduire_tendance_max,25))||(fin(m12)&&m12<0)))return {label:"RÉDUIRE",why:"Score faible avec une tendance baissière ou une performance 12 mois négative."};
  if(r.score>=nz(S.conserver_score_min,50))return {label:"CONSERVER",why:"Score correct, sans signal fort."};
  return {label:"SURVEILLER",why:"Score moyen : rien d'assez net pour agir."};
}

/* ---------- Référence de chaque instrument ---------- */
var REFS={france:"tv:EURONEXT:PX1",europe:"tv:STOXX:SXXP",etats_unis:"tv:SP:SPX",monde:"isin:LU1681043599"};
/** Indice de référence : CAC 40 (France), STOXX 600 (Europe), S&P 500 (États-Unis), MSCI World (monde et autres actions), sinon la série de sa classe. */
function refOf(i){
  if(!i)return null;var px=cfg().proxies||{};
  if(i.asset_class==="actions"||i.asset_class==="immobilier_cote")return REFS[i.region]||REFS.monde;
  var p=A().pocheOf(i),x=p&&px[p];return x&&x.id&&x.id!==i.id?x.id:p==="crypto"&&i.id!=="crypto:BTC"?"crypto:BTC":REFS.monde;
}

/* ---------- Calcul complet ---------- */
/**
 * input : {T, series: {id: prep()}, prefs, rf12, held, pfRet ({semaine: rendement du portefeuille} ou null), risk ({id: contribution}),
 *   ids: [instruments à classer]}. Renvoie {rows, T, weights}. Chaque ligne : {id, i, m, sub, score, label, why, explain, ref, held, rc}.
 */
function run(input){
  var T=input.T,series=input.series||{},rows=[];
  (input.ids||[]).forEach(function(id){
    var i=CK.ref.get(id),S=series[id];if(!i)return;var py=i.vehicle==="spot_crypto"||(i.asset_class==="crypto"&&!i.isin)?365:252;
    var ref=refOf(i),R=series[ref]||null,m=S&&S.t.length?analyze(S,T,py,R):null,h=m&&!m.stale?history(S,T,py):{};
    var rho=null;if(m&&!m.stale){if(input.pfRet){var cb=corrBeta(wret(S,T,156),input.pfRet);rho=cb.corr;}if(rho==null)rho=m.corrRef;}
    var sub=subscores(m,h,rho),row={id:id,i:i,m:m,sub:sub,score:m&&!m.stale&&fin(sub.momentum)?global(sub):null,ref:ref,rho:rho,divBasis:input.pfRet?"portefeuille":"indice de référence",
      held:input.held&&input.held[id]||null,rc:input.risk&&fin(input.risk[id])?input.risk[id]:null,months:h.momAdj?h.momAdj.length+1:0};
    rows.push(row);});
  rows.forEach(function(r){var L=label(r,rows,input);r.label=L.label;r.why=L.why;r.alt=L.alt||null;r.explain=explain(r);});
  return {rows:rows,T:T,weights:weights()};
}

CK.ms={LABELS:LABELS,SUBS:SUBS,REFS:REFS,prep:prep,analyze:analyze,history:history,subscores:subscores,global:global,weights:weights,label:label,explain:explain,
  betterAlt:betterAlt,refOf:refOf,fee:fee,run:run,corrBeta:corrBeta,wret:wret,prank:prank,ema:ema};
})();
