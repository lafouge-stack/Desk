/* ================================================================
   COCKPIT — Moteur d'allocation mensuelle (phase 5) : CK.alloc
   « Proposition du mois selon tes règles » : uniquement les classes et types que tu as cochés,
   calculée à la date de décision (dernière séance Euronext du mois, 22 h 30 à Paris),
   avec les seuls historiques datés (point-in-time) : jamais les valeurs instantanées du scanner.
   Étapes (journalisées) : univers → poids du profil × horizon → inclinaison par le score →
   régime de marché → cible de volatilité → plafonds et plancher → bande d'inaction et rotation
   maximale → instruments (CK.sel) → enveloppes, ordres indicatifs, coûts → explications.
   Aucun ordre n'est jamais passé. Fonctions pures (aucun DOM, aucun réseau) : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5,WEEK=7*DAY;
function M(){return CK.models||{};}
function IND(){return CK.ind;}
function fin(x){return typeof x==="number"&&isFinite(x);}
function nz(v,d){return fin(v)?v:d;}
function dict(){return Object.create(null);}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function sumv(o,ids){return (ids||Object.keys(o)).reduce(function(s,k){return s+nz(o[k],0);},0);}
function pct1(v){return fin(v)?(Math.round(v*1000)/10).toLocaleString("fr-FR")+" %":"—";}
function pts(v){if(!fin(v))return "—";var r=Math.round(v*1000)/10;return (r>0?"+":r<0?"−":"")+Math.abs(r).toLocaleString("fr-FR")+" pt"+(Math.abs(r)>1?"s":"");}
var MOIS=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}

/* ---------- Poches (allocation.json) ---------- */
function poches(){var p=cfg().poches;return Array.isArray(p)?p.filter(function(x){return x&&typeof x.id==="string";}):[];}
function poche(id){return poches().filter(function(p){return p.id===id;})[0]||null;}
function label(id){var p=poche(id);return p?p.label:id;}
var SAFE=["liquidites","obligations","or"],DEFENSIVE=["liquidites","obligations"];
/** Poche d'un instrument : classe exacte puis classes parentes, en respectant les types de produit de la poche. */
function pocheOf(i){
  if(!i)return null;if(i.vehicle==="cash")return "liquidites";
  var ps=poches(),chain=[i.asset_class].concat(M().classAncestors?M().classAncestors(i.asset_class):[]);
  for(var k=0;k<chain.length;k++){var c=chain[k],hit=ps.filter(function(p){return p.classe===c&&(p.vehicules||[]).indexOf(i.vehicle)>=0;})[0];if(hit)return hit.id;}
  for(var j=0;j<chain.length;j++){var c2=chain[j],any=ps.filter(function(p){return p.classe===c2;})[0];if(any)return any.id;}
  return null;
}

/* ---------- Date de décision ---------- */
/** Dernière séance Euronext du mois, 22 h 30 à Paris, au plus tard `ts`. {T, date, month ("AAAA-MM" du mois proposé), monthLabel, dataLabel}. */
function decision(ts){
  var C=CK.cal,d=new Date(ts),y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
  for(var k=0;k<4;k++){
    var L=C&&C.lastTradingDayOfMonth?C.lastTradingDayOfMonth("euronext",y,m):null;
    if(!L){var dd=new Date(Date.UTC(y,m,0));while(dd.getUTCDay()===0||dd.getUTCDay()===6)dd=new Date(dd.getTime()-DAY);L=dd.toISOString().slice(0,10);}
    var T=C&&C.zoned?C.zoned(L,"22:30","Europe/Paris"):Date.parse(L+"T21:30:00Z");
    if(fin(T)&&T<=ts){var ny=m===12?y+1:y,nm=m===12?1:m+1;
      return {T:T,date:L,month:ny+"-"+(nm<10?"0":"")+nm,monthLabel:MOIS[nm-1]+" "+ny,dataLabel:"données arrêtées au "+frDate(L)};}
    m--;if(m<1){m=12;y--;}
  }
  return null;
}

/* ---------- Séries en euros ---------- */
/** bars (PriceBar[] ou {t,c}) → {t[], c[]} en euros au fixing du jour de chaque clôture. fx(ccy, "AAAA-MM-JJ") → € pour 1. */
function eurSeries(bars,ccy,fx){
  var t=[],c=[],list=Array.isArray(bars)?bars:[];
  for(var k=0;k<list.length;k++){var b=list[k],ts=b&&(b.timestamp!=null?b.timestamp:b.t),cl=b&&(b.close!=null?b.close:b.c);if(!fin(ts)||!(cl>0))continue;
    var cc=ccy||b.currency||"EUR",r=cc==="EUR"?1:fx?fx(cc,new Date(ts).toISOString().slice(0,10)):null;if(!(r>0))continue;
    if(t.length&&ts<=t[t.length-1])continue;t.push(ts);c.push(cl*r);}
  return {t:t,c:c};
}
function cut(S,T){if(!S||!S.t)return null;var e=IND().idxAt(S.t,T);return e<0?null:{t:S.t.slice(0,e+1),c:S.c.slice(0,e+1)};}
function weekKey(t){var d=new Date(t),w=(d.getUTCDay()+6)%7;return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-w)).toISOString().slice(0,10);}
/** Index des semaines d'une série (calculé une fois) : clé du lundi et indice de la dernière clôture de chaque semaine. */
function weekIdx(S){if(S._wi&&S._wi.n===S.t.length)return S._wi;var keys=[],last=[];
  for(var k=0;k<S.t.length;k++){var wk=weekKey(S.t[k]);if(keys.length&&keys[keys.length-1]===wk)last[last.length-1]=k;else{keys.push(wk);last.push(k);}}
  try{Object.defineProperty(S,"_wi",{value:{keys:keys,last:last,n:S.t.length},configurable:true,enumerable:false,writable:true});}catch(e){}return {keys:keys,last:last,n:S.t.length};}
/** Les n+1 dernières clôtures hebdomadaires ≤ T : {k: [lundis], v: [clôtures]} ; la semaine de T s'arrête à la dernière clôture ≤ T (rien après T). */
function weeklyTail(S,T,n){var out={k:[],v:[]};if(!S||!S.t||!S.t.length)return out;var e=IND().idxAt(S.t,T);if(e<0)return out;var W=weekIdx(S),lo=0,hi=W.last.length-1,j=hi;
  while(lo<=hi){var m=(lo+hi)>>1;if(W.last[m]>=e){j=m;hi=m-1;}else lo=m+1;}
  for(var q=Math.max(0,n==null?0:j-n);q<=j;q++){out.k.push(W.keys[q]);out.v.push(q<j?S.c[W.last[q]]:S.c[e]);}return out;}
/** {semaine: dernière clôture} sur les clôtures ≤ T. */
function weeklyMap(S,T,n){var o=dict(),w=weeklyTail(S,T,n);for(var k=0;k<w.k.length;k++)o[w.k[k]]=w.v[k];return o;}
function sma(c,e,n){if(e+1<n)return null;var s=0;for(var k=e-n+1;k<=e;k++)s+=c[k];return s/n;}
function corr(a,b){var n=a.length;if(n<8)return null;var ma=0,mb=0,k;for(k=0;k<n;k++){ma+=a[k];mb+=b[k];}ma/=n;mb/=n;var sab=0,sa=0,sb=0;
  for(k=0;k<n;k++){var x=a[k]-ma,y=b[k]-mb;sab+=x*y;sa+=x*x;sb+=y*y;}return sa>0&&sb>0?sab/Math.sqrt(sa*sb):null;}
/** Corrélation des rendements hebdomadaires sur `weeks` semaines ≤ T. */
function corrWeekly(A,B,T,weeks){
  var a=weeklyMap(A,T,weeks+8),b=weeklyMap(B,T,weeks+8),ks=Object.keys(a).filter(function(k){return b[k]!=null;}).sort().slice(-(weeks+1)),ra=[],rb=[];
  for(var k=1;k<ks.length;k++){ra.push(a[ks[k]]/a[ks[k-1]]-1);rb.push(b[ks[k]]/b[ks[k-1]]-1);}return corr(ra,rb);
}

/* ---------- Métriques d'une classe à la date T (point-in-time) ---------- */
/**
 * S : {t, c} en euros ; py : séances par an (252 bourse, 365 crypto) ; R : série de l'indice actions de référence.
 * Momentum 1, 3, 6, 12 mois et 12-1 (mois calendaires), momentum ajusté du risque, volatilité 20 / 60 / 120 séances,
 * baisse depuis le plus haut d'un an, perte maximale sur 12 mois, tendance (cours vs MM50, MM100, MM200 et MM50 > MM200),
 * force relative (12 mois, vs l'indice), corrélation hebdomadaire avec l'indice (1 an), position dans le range 52 semaines.
 */
function metricsAt(S,T,py,R){
  var I=IND();if(!S||!S.t||!S.t.length)return null;var t=S.t,c=S.c,e=I.idxAt(t,T);if(e<0)return null;
  var Te=t[e],P=c[e],years=(Te-t[0])/(365.25*DAY);if(T-Te>10*DAY)return {stale:true,last:I.ymd(Te)};
  var mom=function(k){var T0=I.minusMonths(Te,k);return T0<t[0]?null:I.ret(t,c,T0,Te);};
  var m={last:I.ymd(Te),first:I.ymd(t[0]),years:years,price:P,mom1:mom(1),mom3:mom(3),mom6:mom(6),mom12:mom(12),
    mom12_1:I.minusMonths(Te,12)<t[0]?null:I.ret(t,c,I.minusMonths(Te,12),I.minusMonths(Te,1)),
    vol20:I.vol(t,c,20,Te,py),vol60:I.vol(t,c,60,Te,py),vol120:I.vol(t,c,120,Te,py),mdd12:I.maxDD(t,c,Te-365*DAY,Te)};
  var a=Math.max(0,I.idxAt(t,Te-365*DAY)),hi=-Infinity,lo=Infinity;for(var k=a;k<=e;k++){if(c[k]>hi)hi=c[k];if(c[k]<lo)lo=c[k];}
  m.dd=hi>0?P/hi-1:null;m.range=hi>lo?(P-lo)/(hi-lo):null;
  var s50=sma(c,e,50),s100=sma(c,e,100),s200=sma(c,e,200);m.sma50=s50;m.sma100=s100;m.sma200=s200;
  if(s200!=null){var n=0;if(P>s50)n++;if(P>s100)n++;if(P>s200)n++;if(s50>s200)n++;m.trend=n/4;}else m.trend=null;
  var adj=[];[[3,m.mom3],[6,m.mom6],[12,m.mom12]].forEach(function(x){if(x[1]!=null&&m.vol120>0)adj.push(x[1]/(m.vol120*Math.sqrt(x[0]/12)));});
  m.momAdj=adj.length?adj.reduce(function(s,v){return s+v;},0)/adj.length:null;
  if(R&&R!==S){var mr=metricsLite(R,Te);m.rs=m.mom12!=null&&mr!=null?m.mom12-mr:null;m.corrRef=corrWeekly(S,R,Te,52);}else{m.rs=R===S?0:null;m.corrRef=R===S?1:null;}
  return m;
}
function metricsLite(R,T){var I=IND(),T0=I.minusMonths(T,12);return R&&R.t&&R.t.length&&T0>=R.t[0]?I.ret(R.t,R.c,T0,T):null;}
/** Composantes du score (plus haut = plus favorable). */
function components(m){if(!m||m.stale)return null;
  return {momentum_ajuste:m.momAdj,tendance:m.trend,drawdown:m.dd,volatilite_inverse:m.vol60!=null?-m.vol60:null,diversification:m.corrRef!=null?-m.corrRef:null};}
function monthEnd(T,k){var d=new Date(T);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-k+1,0,21,30);}
/** Rang centile (0-100, ex-æquo au milieu) de x parmi xs. */
function prank(x,xs){var lo=0,eq=0;xs.forEach(function(v){if(v<x)lo++;else if(v===x)eq++;});return xs.length?100*(lo+eq/2)/xs.length:50;}
/**
 * Score de rotation (0-100) EN SÉRIE TEMPORELLE : chaque composante est comparée à son propre historique de fin de mois
 * sur 5 ans (valeurs recalculées à chaque date, sans rien voir après elle), puis pondérée (score_rotation d'allocation.json).
 * Cocher une autre classe ne change jamais le score d'une classe. Moins de 12 fins de mois mesurables → score absent.
 */
var UID=0;
function hidden(o,k,v){try{Object.defineProperty(o,k,{value:v,enumerable:false,configurable:true,writable:true});}catch(e){}return v;}
/** Composantes du score à la date Tk, mémorisées sur la série (elles ne dépendent que des clôtures ≤ Tk et de la référence). */
function compAt(S,Tk,py,R){
  var c=S._cc||hidden(S,"_cc",{}),rid=R===S?"s":R?(R._uid||hidden(R,"_uid",++UID)):"n",k=Tk+"|"+py+"|"+rid;
  if(!(k in c))c[k]=components(metricsAt(S,Tk,py,R));return c[k];
}
function scoreAt(S,T,py,R){
  var W=cfg().score_rotation||{},keys=["momentum_ajuste","tendance","drawdown","volatilite_inverse","diversification"],hist=dict();
  keys.forEach(function(k){hist[k]=[];});
  var now=compAt(S,T,py,R);if(!now)return null;
  for(var k=1;k<=60;k++){var Tk=monthEnd(T,k);if(!S.t.length||Tk<S.t[0])break;var ck=compAt(S,Tk,py,R);if(!ck)continue;
    keys.forEach(function(q){if(ck[q]!=null)hist[q].push(ck[q]);});}
  var tot=0,wsum=0,parts=dict(),n=0;
  keys.forEach(function(q){var w=nz(W[q],0);if(now[q]==null||hist[q].length<12||!(w>0))return;var p=prank(now[q],hist[q].concat([now[q]]));parts[q]=p;tot+=w*p;wsum+=w;n=Math.max(n,hist[q].length);});
  if(!(wsum>0))return null;
  return {score:Math.round(tot/wsum*10)/10,parts:parts,months:n+1,missing:keys.filter(function(q){return parts[q]==null;})};
}

/* ---------- Régime de marché ---------- */
var REGIMES={risk_on:"Risk-on (marché porteur)",neutre:"Neutre",risk_off:"Risk-off (prudence)",haute_volatilite:"Haute volatilité",inconnu:"Inconnu (données manquantes)"};
/** Indice de référence (cours vs MM200, MM50 vs MM200), VIX (≤ T, 10 jours au plus), percentile de la volatilité 60 j sur 3 ans. */
function regimeAt(R,V,T){
  var c=cfg().regime||{},I=IND(),out={id:"inconnu",label:REGIMES.inconnu,reasons:[]};if(!R||!R.t||!R.t.length)return out;
  var e=I.idxAt(R.t,T);if(e<0||T-R.t[e]>10*DAY)return out;var P=R.c[e],s50=sma(R.c,e,50),s200=sma(R.c,e,200);if(s200==null)return out;
  var vix=null;if(V&&V.t&&V.t.length){var ev=I.idxAt(V.t,T);if(ev>=0&&T-V.t[ev]<=10*DAY)vix=V.c[ev];}
  var v60=I.vol(R.t,R.c,60,R.t[e],252),hv=[];for(var k=1;k<=36;k++){var Tk=monthEnd(T,k);if(Tk<R.t[0])break;var vk=I.vol(R.t,R.c,60,Tk,252);if(vk!=null)hv.push(vk);}
  var vp=v60!=null&&hv.length>=12?prank(v60,hv.concat([v60])):null;
  var hi=nz(c.vix_haut,25),vhi=nz(c.vix_tres_haut,35),phi=nz(c.percentile_vol_haute,80);
  var above=P>s200,golden=s50>s200,stress=(vix!=null&&vix>=hi)||(vp!=null&&vp>=phi);
  out={P:P,sma50:s50,sma200:s200,above:above,golden:golden,vix:vix,vol60:v60,volPct:vp,reasons:[]};
  out.reasons.push("Indice actions "+(above?"au-dessus":"en dessous")+" de sa moyenne 200 jours ("+pts((P/s200-1)).replace(/ pts?$/,"")+" %)");
  if(vix!=null)out.reasons.push("VIX à "+(Math.round(vix*10)/10).toLocaleString("fr-FR"));
  if(vp!=null)out.reasons.push("Volatilité 60 j au "+Math.round(vp)+"ᵉ centile de 3 ans");
  out.id=(vix!=null&&vix>=vhi)||(vp!=null&&vp>=95)?"haute_volatilite":!above&&stress?"risk_off":above&&golden&&!stress?"risk_on":"neutre";
  out.label=REGIMES[out.id];return out;
}

/* ---------- Covariance (rendements hebdomadaires en euros, rétrécissement de Ledoit-Wolf) ---------- */
/**
 * series : {id: {t, c}} ; ids : poches à mesurer ; T. Fenêtre commune de 156 semaines au plus (52 au moins) :
 * la série la plus courte est écartée tant qu'il manque des semaines. Matrice annualisée (× 52), rétrécie vers
 * une corrélation constante (Ledoit-Wolf 2004). Renvoie {ids, S, weeks, from, to, delta, unmeasured}.
 */
function covariance(series,ids,T,opts){
  opts=opts||{};var W=opts.weeks||156,MIN=opts.minWeeks||52,maps=dict(),cand=[],unmeasured=[];
  ids.forEach(function(id){var mp=weeklyMap(series[id],T,W+60);var ks=Object.keys(mp);if(ks.length>MIN&&T-Date.parse(ks[ks.length-1]+"T00:00:00Z")<15*DAY){maps[id]=mp;cand.push(id);}else unmeasured.push(id);});
  var weeks=[];
  while(cand.length){
    var all=Object.keys(maps[cand[0]]).filter(function(k){return cand.every(function(id){return maps[id][k]!=null;});}).sort().slice(-(W+1));
    if(all.length>MIN){weeks=all;break;}
    var short=cand.slice().sort(function(a,b){return Object.keys(maps[a]).length-Object.keys(maps[b]).length;})[0];unmeasured.push(short);cand.splice(cand.indexOf(short),1);
  }
  if(!cand.length)return {ids:[],S:[],weeks:0,unmeasured:unmeasured,delta:null};
  var n=cand.length,Tn=weeks.length-1,X=[];
  cand.forEach(function(id){var r=[];for(var k=1;k<weeks.length;k++)r.push(maps[id][weeks[k]]/maps[id][weeks[k-1]]-1);X.push(r);});
  var mu=X.map(function(r){return r.reduce(function(s,v){return s+v;},0)/Tn;}),Y=X.map(function(r,i){return r.map(function(v){return v-mu[i];});});
  var S=[],i,j,t;for(i=0;i<n;i++){S.push([]);for(j=0;j<n;j++){var s=0;for(t=0;t<Tn;t++)s+=Y[i][t]*Y[j][t];S[i][j]=s/Tn;}}
  var sd=S.map(function(row,k){return Math.sqrt(Math.max(0,row[k]));}),rbar=0,cnt=0;
  for(i=0;i<n;i++)for(j=i+1;j<n;j++)if(sd[i]>0&&sd[j]>0){rbar+=S[i][j]/(sd[i]*sd[j]);cnt++;}rbar=cnt?rbar/cnt:0;
  var Fm=[];for(i=0;i<n;i++){Fm.push([]);for(j=0;j<n;j++)Fm[i][j]=i===j?S[i][i]:rbar*sd[i]*sd[j];}
  var delta=0;
  if(n>1){var pi=0,rho=0,gam=0;
    for(i=0;i<n;i++)for(j=0;j<n;j++){var p=0;for(t=0;t<Tn;t++){var z=Y[i][t]*Y[j][t]-S[i][j];p+=z*z;}pi+=p/Tn;gam+=(Fm[i][j]-S[i][j])*(Fm[i][j]-S[i][j]);}
    for(i=0;i<n;i++){var pii=0;for(t=0;t<Tn;t++){var zi=Y[i][t]*Y[i][t]-S[i][i];pii+=zi*zi;}rho+=pii/Tn;}
    for(i=0;i<n;i++)for(j=0;j<n;j++){if(i===j||!(sd[i]>0&&sd[j]>0))continue;var a1=0,a2=0;
      for(t=0;t<Tn;t++){var cij=Y[i][t]*Y[j][t]-S[i][j];a1+=(Y[i][t]*Y[i][t]-S[i][i])*cij;a2+=(Y[j][t]*Y[j][t]-S[j][j])*cij;}
      rho+=rbar/2*(sd[j]/sd[i]*a1/Tn+sd[i]/sd[j]*a2/Tn);}
    var kappa=gam>0?(pi-rho)/gam:0;delta=Math.max(0,Math.min(1,kappa/Tn));}
  var Sig=[];for(i=0;i<n;i++){Sig.push([]);for(j=0;j<n;j++)Sig[i][j]=52*(delta*Fm[i][j]+(1-delta)*S[i][j]);}
  return {ids:cand,S:Sig,weeks:Tn,from:weeks[0],to:weeks[weeks.length-1],delta:delta,unmeasured:unmeasured};
}
/** Volatilité annuelle d'un vecteur de poids {poche: w} (les poches non mesurées sont ignorées, les liquidités ont une volatilité nulle). */
function sigma(w,cov){if(!cov||!cov.ids.length)return null;var v=0,ids=cov.ids;for(var i=0;i<ids.length;i++)for(var j=0;j<ids.length;j++)v+=nz(w[ids[i]],0)*nz(w[ids[j]],0)*cov.S[i][j];return Math.sqrt(Math.max(0,v));}
/** Variation de volatilité (en points) due à la poche p : Δp × (Σw)p / σ (premier ordre). */
function marginal(w,cov,p,d){if(!cov)return null;var k=cov.ids.indexOf(p),s=sigma(w,cov);if(k<0||!(s>0))return p==="liquidites"?null:null;
  var g=0;for(var j=0;j<cov.ids.length;j++)g+=cov.S[k][j]*nz(w[cov.ids[j]],0);return d*g/s;}

/* ---------- Projection sur les contraintes (plafonds par groupe, planchers) ---------- */
/**
 * w : {poche: poids} sur l'univers U (somme 1) ; groups : [{ids, cap, label}] ; floors : {poche: plancher}.
 * Coupe au plafond, redistribue l'excédent au prorata des poches non saturées, relève les planchers ; somme = 1.
 * Si les plafonds sont incompatibles (tout est saturé), l'excédent reste sur la plus grosse poche et c'est signalé.
 */
function project(w,U,groups,floors,flags){
  var o=dict();U.forEach(function(p){o[p]=Math.max(0,nz(w[p],0));});floors=floors||{};
  var norm=function(){var s=sumv(o,U);if(s>0)U.forEach(function(p){o[p]/=s;});};norm();
  var capOf=function(p){var c=Infinity;groups.forEach(function(g){if(g.ids.indexOf(p)>=0)c=Math.min(c,g.cap);});return c;};
  for(var it=0;it<60;it++){
    var changed=false,fixed=dict(),pool=0;
    U.forEach(function(p){var f=nz(floors[p],0);if(o[p]<f-1e-12){pool-=f-o[p];o[p]=f;fixed[p]=1;changed=true;}});
    groups.forEach(function(g){var mem=g.ids.filter(function(p){return U.indexOf(p)>=0;}),s=sumv(o,mem);if(s<=g.cap+1e-12)return;
      var fl=mem.reduce(function(a,p){return a+nz(floors[p],0);},0),cap=Math.max(g.cap,fl),free=s-fl,target=cap-fl;
      mem.forEach(function(p){var f=nz(floors[p],0),x=free>0?f+(o[p]-f)*target/free:f;pool+=o[p]-x;o[p]=x;fixed[p]=1;});changed=true;
      if(fl>g.cap+1e-9&&!flags.some(function(x){return x.code==="floorcap";}))flags.push({level:"attention",code:"floorcap",msg:"Le plancher de "+g.label+" dépasse son plafond : plancher conservé."});});
    if(!changed&&Math.abs(pool)<1e-12)break;
    var recv=U.filter(function(p){if(fixed[p])return false;var c=capOf(p);return pool<0?o[p]>nz(floors[p],0)+1e-12:o[p]<c-1e-12;});
    if(!recv.length){if(Math.abs(pool)>1e-9){var big=U.slice().sort(function(a,b){return o[b]-o[a];})[0];if(big)o[big]+=pool;
        if(pool>0&&!flags.some(function(x){return x.code==="caps";}))flags.push({level:"attention",code:"caps",msg:"Tes plafonds par classe sont incompatibles avec tes classes cochées (total sous 100 %) : dépassement sur "+label(big)+"."});}break;}
    var base=recv.reduce(function(s,p){return s+(pool<0?o[p]-nz(floors[p],0):Math.max(o[p],1e-9));},0);
    recv.forEach(function(p){var share=pool<0?(o[p]-nz(floors[p],0))/base:Math.max(o[p],1e-9)/base;o[p]+=pool*share;});
  }
  U.forEach(function(p){if(o[p]<0)o[p]=0;});norm();return o;
}

/* ---------- Univers autorisé ---------- */
/** Poches proposables : classe cochée (et ses parents), au moins un type de produit coché, non écartée, au moins un instrument proposable. */
function universe(prefs,cands){
  var U=[],ex=[],P=prefs||{},isOk=M().isClassAllowed;
  poches().forEach(function(p){
    var why="";
    if((P.poches_exclues||[]).indexOf(p.id)>=0)why="Écartée dans tes règles.";
    else if(!isOk(p.classe,P.classes||{}))why="Classe non cochée : "+(M().classLabel?M().classLabel(p.classe):p.classe)+".";
    else if(p.id==="liquidites")why="";
    else if(!(p.vehicules||[]).some(function(v){return P.vehicles&&P.vehicles[v]===true;}))why="Type de produit non coché ("+(p.vehicules||[]).map(function(v){return M().vehicleLabel?M().vehicleLabel(v):v;}).join(", ")+").";
    else{var v=CK.sel.viable(p.id,cands[p.id]||[]);if(!v.ok)why=v.why;}
    if(why)ex.push({id:p.id,label:p.label,why:why});else U.push(p.id);
  });
  return {U:U,excluded:ex};
}

/* ---------- Étape 2 : poids du profil × horizon, restreints à l'univers ---------- */
function strategic(prefs,U,log){
  var C=cfg(),prof=(C.profils||{})[prefs.risk_profile]||{},raw=prefs.poids_perso||prof.poids||{},w=dict(),f=nz(((C.horizons||{})[prefs.horizon]||{}).facteur_risque,1);
  poches().forEach(function(p){w[p.id]=Math.max(0,nz(raw[p.id],0));});
  var profW=dict();Object.keys(w).forEach(function(k){profW[k]=w[k];});
  if(f<1){var moved=0;Object.keys(w).forEach(function(k){if(DEFENSIVE.indexOf(k)<0){moved+=w[k]*(1-f);w[k]*=f;}});
    var to=DEFENSIVE.filter(function(k){return U.indexOf(k)>=0;});
    if(to.length){var b=sumv(profW,to);to.forEach(function(k){w[k]+=moved*(b>0?profW[k]/b:1/to.length);});log.push("Horizon : "+Math.round((1-f)*100)+" % des poches risquées glissent vers "+to.map(label).join(" et ")+".");}
    else log.push("Horizon court mais ni obligations ni liquidités cochées : rien ne peut glisser vers un refuge.");}
  var o=dict(),s=sumv(w,U);
  if(s>0)U.forEach(function(k){o[k]=w[k]/s;});else{U.forEach(function(k){o[k]=1/U.length;});if(U.length)log.push("Tes classes cochées ont un poids nul dans ce profil : répartition égale.");}
  return {w:o,profile:profW,factor:f,perso:!!prefs.poids_perso};
}

/* ---------- Le moteur ---------- */
/**
 * input : {
 *   prefs (InvestmentPrefs, saved = true), now (ms),
 *   series: {poche: {t, c} en €}, ref: {t,c} (indice actions de référence en €), vix: {t,c},
 *   current: {w0: {poche: poids sur la base}, value (€ hors versement), locked: {poche: €}, lines, accounts, holdings},
 *   resume: {id:{d, first, n}} | null, vols: {instrument: vol}, unit(id) → € pour 1 part (affichage des quantités)
 * }
 * Renvoie la MonthlyProposal (voir CLAUDE.md), ou {ok:false, why} si tes règles ne sont pas enregistrées.
 */
function run(input){
  var P=M().normPrefs?M().normPrefs(input.prefs):input.prefs,C=cfg(),log=[],flags=[];
  if(!P||P.saved!==true)return {ok:false,why:"Enregistre d'abord tes règles (Préférences d'investissement) : rien n'est calculé avant."};
  var D=decision(nz(input.now,Date.now()));if(!D)return {ok:false,why:"Date de décision introuvable."};
  var T=D.T,prof=(C.profils||{})[P.risk_profile]||{},lim=P.limits,band=nz(lim.bande_inaction_pp,2)/100,Tmax=nz(lim.max_turnover_mensuel,20)/100;
  // préférences effectives : le niveau de risque maximal du profil s'applique si tu n'en as pas fixé
  var EP=JSON.parse(JSON.stringify(P));if(EP.limits.risque_max_sri==null&&fin(prof.risque_max_sri))EP.limits.risque_max_sri=prof.risque_max_sri;
  var cur=input.current||{},hasPf=!!(cur.accounts&&cur.accounts.length),Cc=Math.max(0,nz(P.monthly_contribution_eur,0)),V0=Math.max(0,nz(cur.value,0)),B=V0+Cc;
  var held=dict();(cur.holdings||[]).forEach(function(h){if(h.value>0&&!h.locked)held[h.instrument_id]=(held[h.instrument_id]||0)+h.value;});
  // 1. univers
  var ctx={prefs:EP,T:T,resume:input.resume||null,held:held,accounts:cur.accounts||[],pocheOf:pocheOf,pea_mode:P.pea_mode,vols:input.vols||{}};
  var cands=dict();poches().forEach(function(p){cands[p.id]=CK.sel.candidates(p.id,ctx);});
  var UN=universe(EP,cands),U=UN.U;
  if(Array.isArray(input.restrict)){var keep=U.filter(function(p){return input.restrict.indexOf(p)>=0;});
    U.filter(function(p){return keep.indexOf(p)<0;}).forEach(function(p){UN.excluded.push({id:p,label:label(p),why:"Pas encore de données à cette date."});});U=UN.U=keep;}
  log.push("Univers : "+(U.length?U.map(label).join(", "):"aucune poche")+".");
  if(!U.length)return {ok:false,why:"Aucune classe proposable avec tes règles : coche au moins une classe et un type de produit.",excluded:UN.excluded};
  // 2. profil × horizon
  var ST=strategic(P,U,log),w=ST.w;
  log.push("Profil "+(prof.label||P.risk_profile)+(ST.perso?" (poids personnalisés)":"")+" : "+U.map(function(p){return label(p)+" "+pct1(w[p]);}).join(" · ")+".");
  var steps={strategic:Object.assign(dict(),w)};
  // métriques, scores, régime
  // métriques, scores et régime ne dépendent pas de tes cases : mémorisés (input.memo) pour recalculer vite
  var R=input.ref||null,memo=input.memo&&typeof input.memo==="object"?input.memo:{},mk="T"+T;
  if(!memo[mk]){var mm={met:dict(),sco:dict()};
    poches().forEach(function(p){var S=input.series&&input.series[p.id],py=nz((C.proxies||{})[p.id]&&(C.proxies||{})[p.id].jours_par_an,252);
      if(p.id==="liquidites"||!S||!S.t||!S.t.length)return;mm.met[p.id]=metricsAt(S,T,py,R);mm.sco[p.id]=mm.met[p.id]&&!mm.met[p.id].stale?scoreAt(S,T,py,R):null;});
    mm.reg=regimeAt(R,input.vix,T);var REGp=[1,2].map(function(k){return regimeAt(R,input.vix,monthEnd(T,k)).id;});
    mm.reg.stable=mm.reg.id!=="inconnu"&&REGp.every(function(x){return x===mm.reg.id;});mm.cov=dict();memo[mk]=mm;}
  var met=memo[mk].met,sco=memo[mk].sco,REG=memo[mk].reg;
  // 3. inclinaison par le score
  var tilt=input.overrides&&fin(input.overrides.tilt)?input.overrides.tilt:nz(prof.inclinaison_max,0.25),w3=dict();
  U.forEach(function(p){var s=sco[p]&&sco[p].score,t=p==="liquidites"||s==null?0:Math.max(-0.5,Math.min(0.5,tilt*(s-50)/50));w3[p]=w[p]*(1+t);});
  w3=project(w3,U,[],{},flags);steps.tilted=Object.assign(dict(),w3);
  // 4. régime : part du risque déplacée vers les refuges cochés
  var w4=Object.assign(dict(),w3),tr=nz((C.regime||{}).transfert_risk_off_pct,30)/100;
  if(REG.id==="risk_off"||REG.id==="haute_volatilite"){var safe=SAFE.filter(function(p){return U.indexOf(p)>=0;}),risky=U.filter(function(p){return safe.indexOf(p)<0;});
    if(safe.length&&risky.length){var mv=sumv(w4,risky)*tr,sb=sumv(w4,safe);risky.forEach(function(p){w4[p]*=1-tr;});safe.forEach(function(p){w4[p]+=mv*(sb>0?w4[p]/sb:1/safe.length);});
      log.push("Régime "+REG.label+" : "+Math.round(tr*100)+" % du poids risqué déplacé vers "+safe.map(label).join(", ")+".");}
    else if(risky.length)flags.push({level:"attention",msg:"Régime "+REG.label+", mais aucune classe refuge (liquidités, obligations, or) n'est cochée : aucun transfert possible."});}
  steps.regime=Object.assign(dict(),w4);
  // 5. cible de volatilité
  var ck=U.join(","),cov=memo[mk].cov[ck]||(memo[mk].cov[ck]=covariance(input.series||{},U.filter(function(p){return p!=="liquidites";}),T)),vc=nz(prof.vol_cible,null)/100,w5=Object.assign(dict(),w4),alpha=0;
  var sv=sigma(w5,cov);
  if(cov.unmeasured.length&&U.some(function(p){return cov.unmeasured.indexOf(p)>=0&&w5[p]>0.001;}))flags.push({level:"info",msg:"Volatilité estimée sans "+cov.unmeasured.filter(function(p){return U.indexOf(p)>=0;}).map(label).join(", ")+" (historique insuffisant)."});
  if(sv!=null&&vc>0&&sv>vc){
    var e=U.indexOf("liquidites")>=0?"liquidites":U.indexOf("obligations")>=0?"obligations":null;
    if(!e)flags.push({level:"attention",code:"vol",msg:"Cible de volatilité "+pct1(vc)+" inatteignable sans liquidités ni obligations cochées (volatilité estimée "+pct1(sv)+")."});
    else{var mix=function(a){var o=dict();U.forEach(function(p){o[p]=(1-a)*w4[p]+(p===e?a:0);});return o;};
      if(sigma(mix(1),cov)>vc){alpha=1;flags.push({level:"attention",code:"vol",msg:"Cible de volatilité "+pct1(vc)+" inatteignable même à 100 % en "+label(e)+" : poids au plus prudent."});}
      else{var lo=0,hi=1;for(var it=0;it<50;it++){var mid=(lo+hi)/2;if(sigma(mix(mid),cov)>vc)lo=mid;else hi=mid;}alpha=hi;}
      w5=mix(alpha);log.push("Cible de volatilité "+pct1(vc)+" : "+pct1(sv)+" estimée, "+Math.round(alpha*100)+" % du portefeuille glisse vers "+label(e)+".");}
  }else if(sv!=null&&vc>0)log.push("Volatilité estimée "+pct1(sv)+", sous la cible de "+pct1(vc)+".");
  steps.voltarget=Object.assign(dict(),w5);
  // 6. plafonds par classe, plafond crypto, plancher de liquidités, lignes bloquées (assurance-vie…)
  var groups=[],floors=dict();
  Object.keys(lim.max_par_classe||{}).forEach(function(k){var ids=U.filter(function(p){var c=poche(p).classe;return c===k||(M().classAncestors(c)||[]).indexOf(k)>=0;});
    if(ids.length)groups.push({ids:ids,cap:lim.max_par_classe[k]/100,label:M().classLabel(k)});});
  if(U.indexOf("crypto")>=0)groups.push({ids:["crypto"],cap:nz(lim.max_crypto,100)/100,label:"Crypto"});
  if(nz(lim.min_liquidites,0)>0){if(U.indexOf("liquidites")>=0)floors.liquidites=lim.min_liquidites/100;else flags.push({level:"attention",msg:"Plancher de liquidités demandé, mais la classe Liquidités n'est pas cochée."});}
  var locked=cur.locked||{};if(B>0)Object.keys(locked).forEach(function(p){if(U.indexOf(p)>=0&&locked[p]>0)floors[p]=Math.max(nz(floors[p],0),locked[p]/B);});
  // lignes bloquées hors de l'univers (ex. fonds en assurance-vie d'une classe non cochée) : elles restent, l'univers se partage le reste
  var lockedOut=B>0?Object.keys(locked).reduce(function(s2,p){return s2+(U.indexOf(p)<0?nz(locked[p],0)/B:0);},0):0,share=Math.max(0,1-lockedOut);
  if(lockedOut>0.0005)flags.push({level:"info",msg:pct1(lockedOut)+" du portefeuille est bloqué hors de tes classes (assurance-vie, compte bancaire, lignes hors liste) : le moteur ne le déplace pas."});
  var sg=share>0?groups.map(function(g){return {ids:g.ids,cap:g.cap/share,label:g.label};}):groups,sf=dict();Object.keys(floors).forEach(function(p){sf[p]=share>0?floors[p]/share:floors[p];});
  var w6=project(w5,U,sg,sf,flags);U.forEach(function(p){w6[p]*=share;});steps.constrained=Object.assign(dict(),w6);
  // 7-9. écart à l'actuel, bande d'inaction, rotation maximale
  var w0=dict(),allP=poches().map(function(p){return p.id;});allP.forEach(function(p){w0[p]=nz(cur.w0&&cur.w0[p],0);});
  var tw=dict(),forced=dict(),frozen=dict();allP.forEach(function(p){tw[p]=U.indexOf(p)>=0?w6[p]:B>0&&locked[p]>0?locked[p]/B:0;forced[p]=U.indexOf(p)<0&&w0[p]>tw[p]+1e-9;});
  // une poche au-dessus de son plafond doit redescendre : réduction forcée
  groups.forEach(function(g){var s=sumv(w0,g.ids);if(s>g.cap+1e-9)g.ids.forEach(function(p){forced[p]=true;});});
  if(hasPf||input.backtest){
    allP.forEach(function(p){if(forced[p]||U.indexOf(p)<0)return;var d=tw[p]-w0[p];if(Math.abs(d)<band&&!(floors[p]>w0[p]+1e-9)){tw[p]=w0[p];frozen[p]=1;}});
    settle(tw,w0,U,frozen,forced,floors);
    // dépenser ses espèces n'est pas une vente : la baisse des liquidités ne compte pas dans la rotation
    var sells=function(only){return allP.reduce(function(s,p){if(p==="liquidites")return s;if(only==="f"&&!forced[p])return s;if(only==="l"&&forced[p])return s;return s+Math.max(0,w0[p]-tw[p]);},0);};
    var sF=sells("f"),sL=sells("l");
    if(sF+sL>Tmax+1e-9){
      if(sF>Tmax)flags.push({level:"attention",msg:"Les ventes obligatoires (classes décochées, plafonds dépassés) représentent "+pct1(sF)+" du portefeuille, au-delà de ta rotation maximale ("+pct1(Tmax)+")."});
      var lam=sL>0?Math.max(0,(Tmax-sF)/sL):0;
      allP.forEach(function(p){if(forced[p]||frozen[p]||U.indexOf(p)<0)return;var d=tw[p]-w0[p];if(d<0)tw[p]=w0[p]+lam*d;});
      // les ventes réduites libèrent moins d'argent : les achats sont réduits d'autant (le versement reste investi)
      settle(tw,w0,U,frozen,forced,floors);
      log.push("Rotation limitée à "+pct1(Tmax)+" du portefeuille (ventes) : mouvements réduits à "+Math.round(lam*100)+" %.");}
  }
  steps.final=Object.assign(dict(),tw);
  if(input.lite){var scores=dict();U.forEach(function(p){scores[p]=sco[p]?sco[p].score:null;});
    return {ok:true,lite:true,asOf:D.date,T:T,month:D.month,regime:REG,universe:U,excluded:UN.excluded,steps:steps,final:tw,scores:scores,alpha:alpha,flags:flags,log:log,
      sigma:sigma(tw,cov),frozen:Object.keys(frozen)};}
  // 10. instruments puis enveloppes
  var picks=dict(),pflags=[],placed=null;
  var Bp=B>0?B:10000;   // sans portefeuille ni versement : choix des instruments sur une base fictive (seuls les poids s'affichent)
  if(hasPf){
    // cible de chaque poche en € (hors lignes bloquées), répartie entre tes comptes, puis instruments compte par compte
    var tg=dict();U.forEach(function(p){tg[p]=Math.max(0,tw[p]*B-nz(locked[p],0));});
    placed=CK.sel.place(tg,cands,{accounts:cur.accounts,holdings:cur.holdings},{contribution:Cc,split:P.contribution_split,unit:input.unit,B:B,ctx:ctx});
    U.forEach(function(p){picks[p]={lines:placed.lines[p]||[],flags:[]};});
  }else U.forEach(function(p){if(p==="liquidites")return;var amt=tw[p]*Bp;if(!(amt>0.5)){picks[p]={lines:[],flags:[]};return;}
    var pk=CK.sel.pick(p,cands[p],amt,Bp,ctx);picks[p]=pk;pk.flags.forEach(function(f){pflags.push(Object.assign({poche:p},f));});});
  // poids obtenus après placement (ce qui ne se loge pas reste en espèces)
  var wf=dict();allP.forEach(function(p){wf[p]=0;});
  if(placed&&B>0){
    var after=dict(),inst=dict();
    (cur.holdings||[]).forEach(function(h){if(h.locked||!(h.value>0))return;after[h.instrument_id]=(after[h.instrument_id]||0)+h.value;inst[h.instrument_id]=h.i;});
    placed.orders.forEach(function(o){if(o.skipped)return;after[o.instrument_id]=(after[o.instrument_id]||0)+(o.side==="achat"?o.amount:-o.amount);if(o.i)inst[o.instrument_id]=o.i;});
    Object.keys(after).forEach(function(id){var pp=pocheOf(inst[id]);if(pp&&after[id]>0)wf[pp]+=after[id]/B;});
    Object.keys(locked).forEach(function(p){wf[p]=(wf[p]||0)+locked[p]/B;});
    wf.liquidites+=Object.keys(placed.cash).reduce(function(s2,k){return s2+Math.max(0,placed.cash[k]);},0)/B;
    var tot=sumv(wf,allP);if(tot>0)allP.forEach(function(p){wf[p]/=tot;});
  }else allP.forEach(function(p){wf[p]=tw[p];});
  // 11-12. décisions et explications
  var sigB=sigma(w0,cov),sigA=sigma(wf,cov),decisions=[];
  if(placed&&B>0){var to=placed.orders.reduce(function(s2,o){return s2+(!o.skipped&&o.side==="vente"?o.amount:0);},0)/B;
    if(to>Tmax+0.005)flags.push({level:"attention",msg:"Rotation estimée "+pct1(to)+", au-delà de ta limite ("+pct1(Tmax)+") : changements d'instruments imposés par tes limites (plafond par instrument, PEA, classes décochées) ou par tes comptes. Tu peux étaler ces mouvements sur plusieurs mois."});
    if(sigA!=null&&vc>0&&sigA>vc+0.005)flags.push({level:"info",msg:"Après placement dans tes comptes, volatilité estimée "+pct1(sigA)+" pour une cible de "+pct1(vc)+" : l'écart vient des enveloppes (sans transfert entre comptes)."});}
  allP.forEach(function(p){
    var inU=U.indexOf(p)>=0,ex=UN.excluded.filter(function(x){return x.id===p;})[0],d=wf[p]-w0[p],m=met[p]||null,s=sco[p]||null;
    if(!inU&&!(w0[p]>0.0005))return;
    var act="",isHeld=w0[p]>0.0005;
    var sw=(placed?placed.orders:[]).filter(function(o){return !o.skipped&&pocheOf(o.i)===p;}),swSell=sw.some(function(o){return o.side==="vente"&&o.all;}),swBuy=sw.some(function(o){return o.side==="achat"&&!(o.current>0);});
    if(!inU||wf[p]<0.0005){act=!isHeld?"NE RIEN FAIRE":U.indexOf("liquidites")>=0&&wf.liquidites>w0.liquidites+0.001?"PASSER EN LIQUIDITÉS":"BASCULER VERS UN AUTRE ACTIF";}
    else if(d>=band-1e-9)act=swSell&&swBuy?"BASCULER VERS UN AUTRE ACTIF":"RENFORCER";
    else if(d<=-band+1e-9)act=swSell&&swBuy?"BASCULER VERS UN AUTRE ACTIF":"RÉDUIRE";
    else act=isHeld?(swSell&&swBuy?"BASCULER VERS UN AUTRE ACTIF":"CONSERVER"):"NE RIEN FAIRE";
    if(!hasPf&&inU)act=wf[p]>0.0005?"RENFORCER":"NE RIEN FAIRE";
    var why=[],add=function(v,t){if(t)why.push({v:Math.abs(nz(v,0)),t:t});};
    if(!inU)add(1,(ex?ex.why:"Hors de tes règles.")+(isHeld?" Vente de la poche proposée.":""));
    else{
      add(Math.abs(ST.w[p]-nz(ST.profile[p],0)/100)+0.001,"Poids "+(ST.perso?"personnalisé":"du profil "+(prof.label||""))+" : "+pct1(nz(ST.profile[p],0)/100)+(Math.abs(ST.w[p]-nz(ST.profile[p],0)/100)>0.0005?", ramené à "+pct1(ST.w[p])+" sur tes classes cochées":"")+".");
      if(s)add(steps.tilted[p]-ST.w[p],"Score de rotation "+Math.round(s.score)+"/100"+scoreWords(s)+" : "+pts(steps.tilted[p]-ST.w[p])+".");
      else if(p!=="liquidites")add(0.0001,"Données insuffisantes pour un score : poids du profil sans inclinaison.");
      if(Math.abs(steps.regime[p]-steps.tilted[p])>0.0005)add(steps.regime[p]-steps.tilted[p],"Régime "+REG.label+" : "+pts(steps.regime[p]-steps.tilted[p])+".");
      if(Math.abs(steps.voltarget[p]-steps.regime[p])>0.0005)add(steps.voltarget[p]-steps.regime[p],"Cible de volatilité "+pct1(vc)+" : "+pts(steps.voltarget[p]-steps.regime[p])+".");
      if(Math.abs(steps.constrained[p]-steps.voltarget[p])>0.0005)add(steps.constrained[p]-steps.voltarget[p],(locked[p]>0&&locked[p]/B>=steps.voltarget[p]?"Lignes que le moteur ne déplace pas (assurance-vie, compte bancaire, hors liste)":"Tes limites (plafonds, plancher)")+" : "+pts(steps.constrained[p]-steps.voltarget[p])+".");
      if(frozen[p])add(band,"Écart inférieur à ta bande d'inaction ("+pts(band)+") : on ne bouge pas.");
      if(Math.abs(steps.final[p]-steps.constrained[p])>0.0005&&!frozen[p])add(steps.final[p]-steps.constrained[p],"Rotation maximale et bande d'inaction : "+pts(steps.final[p]-steps.constrained[p])+".");
      if(Math.abs(wf[p]-steps.final[p])>0.002&&hasPf)add(wf[p]-steps.final[p],"Placement dans tes comptes (sans transfert entre enveloppes) : "+pts(wf[p]-steps.final[p])+".");
    }
    // le poids du profil d'abord (point de départ), puis les deux effets les plus forts
    var first=inU&&why.length?why.shift():null;why.sort(function(a,b){return b.v-a.v;});if(first)why.unshift(first);
    var risks=[];if(m&&!m.stale){if(m.vol60>0.25)risks.push("Volatilité élevée ("+pct1(m.vol60)+" par an)");if(m.dd<-0.15)risks.push("À "+pct1(-m.dd)+" sous son plus haut d'un an");
      if(m.mdd12<-0.2)risks.push("Perte maximale sur 12 mois : "+pct1(m.mdd12));if(m.corrRef>0.8&&poche(p).classe!=="actions")risks.push("Très corrélée aux actions ("+(Math.round(m.corrRef*100)/100).toLocaleString("fr-FR")+")");}
    if(wf[p]>0.4)risks.push("Poids élevé dans le portefeuille ("+pct1(wf[p])+")");
    if(!m&&p!=="liquidites"&&inU)risks.push("Données insuffisantes");
    var conf=confidence(m,s,REG);
    var lines=(picks[p]&&picks[p].lines||[]).map(function(l){return {id:l.id,symbol:l.i.symbol,name:l.i.name,amount:B>0?l.amount:null,w:l.amount/Bp,held:l.held,score:l.score,reasons:l.reasons.slice(0,3),
      pea:CK.pea?CK.pea.allowedIn(l.i,"PEA"):null};});
    var alts=[];if(P.pea_mode!=="off")lines.forEach(function(l){if(l.pea&&!l.pea.ok){var i=CK.ref.get(l.id);(CK.pea.alternatives(i)||[]).filter(function(x){return CK.allow(x,EP);}).slice(0,3).forEach(function(x){alts.push({for:l.symbol,id:x.id,symbol:x.symbol,name:x.name,ter:x.ter});});}});
    var cost=0,tax=0;sw.forEach(function(o){cost+=o.cost||0;tax+=o.tax||0;});
    var px=(C.proxies||{})[p]||{};
    decisions.push({poche:p,label:label(p),classe:poche(p).classe,w0:w0[p],w_target:wf[p],w_engine:steps.final[p],delta_pp:(wf[p]-w0[p])*100,score:s?s.score:null,parts:s?s.parts:null,
      action:act,raisons:why.slice(0,3).map(function(x){return x.t;}),risques:risks,impact_vol_pp:marginal(wf,cov,p,wf[p]-w0[p])!=null?marginal(wf,cov,p,wf[p]-w0[p])*100:null,
      cout_estime_eur:cost,cout_fiscal_estime_eur:tax,confiance:conf,metrics:m,in_universe:inU,
      fenetre:m&&!m.stale?{from:m.first,to:m.last,proxy:px.label||null}:{from:null,to:null,proxy:px.label||null},date_calcul:D.date,
      instruments_proposes:lines,alternatives_pea:alts});
  });
  var order=["RENFORCER","RÉDUIRE","BASCULER VERS UN AUTRE ACTIF","PASSER EN LIQUIDITÉS","CONSERVER","NE RIEN FAIRE"];
  decisions.sort(function(a,b){return order.indexOf(a.action)-order.indexOf(b.action)||b.w_target-a.w_target;});
  var orders=placed?placed.orders:[],tc=orders.reduce(function(s,o){return s+(o.cost||0);},0),tt=orders.reduce(function(s,o){return s+(o.tax||0);},0);
  var sellsEUR=orders.reduce(function(s,o){return s+(!o.skipped&&o.side==="vente"?o.amount:0);},0);
  var neff=function(o){var s=0,t=0;allP.forEach(function(p){if(p==="liquidites")return;t+=o[p]||0;});if(!(t>0))return null;allP.forEach(function(p){if(p==="liquidites")return;var x=(o[p]||0)/t;s+=x*x;});return s>0?1/s:null;};
  return {ok:true,v:1,asOf:D.date,T:T,month:D.month,monthLabel:D.monthLabel,dataLabel:D.dataLabel,computed_at:nz(input.now,Date.now()),prefs_hash:hash(P),
    profile:{id:P.risk_profile,label:prof.label||P.risk_profile,vol_cible:vc,perso:ST.perso},horizon:P.horizon,pea_mode:P.pea_mode,regime:REG,
    universe:U,excluded:UN.excluded,steps:steps,decisions:decisions,orders:orders,unplaced:placed?placed.unplaced:[],contrib:placed?placed.contrib:null,
    totals:{base:B,value:V0,contribution:Cc,cost:tc,tax:tt,turnover:B>0?sellsEUR/B:0,sigma_before:sigB,sigma_after:sigA,sigma_engine:sigma(steps.final,cov),
      neff_before:neff(w0),neff_after:neff(wf),cov_weeks:cov.weeks,cov_from:cov.from,cov_to:cov.to,shrink:cov.delta,alpha:alpha},
    flags:flags.concat(pflags).concat(placed?placed.flags:[]),log:log,invariants:placed?placed.invariants:null,portfolio:hasPf};
}
/** Après un gel (bande) ou une réduction des ventes : remet la somme à 1. Un surplus va aux liquidités (si cochées), sinon au plus gros achat ;
    un manque est pris sur les liquidités (au-dessus de leur niveau actuel), puis sur les achats, au prorata. */
function settle(tw,w0,U,frozen,forced,floors){
  var all=Object.keys(tw),r=1-sumv(tw,all);if(Math.abs(r)<1e-12)return;
  var hasL=U.indexOf("liquidites")>=0&&!frozen.liquidites;
  var buys=U.filter(function(p){return !frozen[p]&&!forced[p]&&p!=="liquidites"&&tw[p]>w0[p];});
  if(r>0){if(hasL)tw.liquidites+=r;else{var tgt=(buys.length?buys:U.filter(function(p){return !frozen[p];})).sort(function(a,b){return tw[b]-tw[a];})[0]||U[0];tw[tgt]+=r;}return;}
  var need=-r;
  if(hasL){var x=Math.min(need,Math.max(0,tw.liquidites-Math.max(nz(floors.liquidites,0),w0.liquidites)));tw.liquidites-=x;need-=x;}
  if(need>1e-12){var src=buys.length?buys:U.filter(function(p){return !frozen[p]&&tw[p]>nz(floors[p],0);});
    var room=function(p){return Math.max(0,tw[p]-Math.max(buys.length?w0[p]:0,nz(floors[p],0)));},tot=src.reduce(function(s,p){return s+room(p);},0);
    if(tot>0){var k=Math.min(1,need/tot);src.forEach(function(p){tw[p]-=room(p)*k;});}
    var left=1-sumv(tw,all);if(Math.abs(left)>1e-12){var big=U.slice().sort(function(a,b){return tw[b]-tw[a];})[0];tw[big]+=left;}}
}
function scoreWords(s){var p=s.parts||{},bits=[];
  if(p.momentum_ajuste>=70)bits.push("momentum fort");else if(p.momentum_ajuste<=30)bits.push("momentum faible");
  if(p.tendance>=70)bits.push("tendance haussière");else if(p.tendance<=30)bits.push("tendance baissière");
  if(p.drawdown<=25)bits.push("loin de ses plus hauts");if(p.volatilite_inverse<=25)bits.push("volatilité inhabituelle");
  return bits.length?" ("+bits.join(", ")+")":"";}
/** Grille de confiance : historique ≥ 3 ans, ≥ 3 des 4 momentums du même signe, régime stable 2 mois, aucune composante manquante. */
function confidence(m,s,REG){
  var c=[{k:"histo",ok:!!(m&&!m.stale&&m.years>=3),t:"historique d'au moins 3 ans"},
    {k:"mom",ok:!!(m&&(function(){var v=[m.mom1,m.mom3,m.mom6,m.mom12].filter(fin);var p=v.filter(function(x){return x>0;}).length,n=v.filter(function(x){return x<0;}).length;return v.length===4&&(p>=3||n>=3);})()),t:"momentums 1, 3, 6 et 12 mois concordants (3 sur 4)"},
    {k:"regime",ok:!!(REG&&REG.stable),t:"régime de marché stable depuis 2 mois"},
    {k:"complet",ok:!!(s&&!s.missing.length),t:"aucune donnée manquante"}];
  var n=c.filter(function(x){return x.ok;}).length;return {n:n,label:n>=4?"élevée":n>=2?"moyenne":"faible",checks:c};
}
function hash(o){var s=JSON.stringify(o),h=5381;for(var i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36);}

/* ---------- État actuel du portefeuille, vu par poche ---------- */
/**
 * V : résultat de CK.pfc.value(P, …). Les comptes à univers manuel (assurance-vie, banque, autre) et les lignes hors référentiel
 * (perso:…) sont « bloqués » : ils comptent dans les poids actuels mais le moteur ne les déplace jamais.
 * Renvoie {w0, value, locked, lockedCash, accounts, holdings, unpriced}.
 */
function current(P,V,Cc){
  var out={w0:dict(),value:0,locked:dict(),lockedCash:0,accounts:[],holdings:[],unpriced:0};if(!V||!V.total)return out;
  var tr=CK.sel.TRADABLE,acc=dict(),f=M().data?M().data("fiscal"):null,env=f&&f.enveloppes||{},plaf=nz(env.PEA&&env.PEA.plafond_versements_eur,150000),comm=nz(env.PEA_PME&&env.PEA_PME.plafond_commun_eur,225000);
  var depPEA=0,depPME=0;(V.accounts||[]).forEach(function(a){if(a.account_type==="PEA")depPEA+=nz(a.deposits_total,0);if(a.account_type==="PEA_PME")depPME+=nz(a.deposits_total,0);});
  (V.accounts||[]).forEach(function(a){acc[a.id]=a;var t=a.account_type,cash=nz(a.cash_eur,0);
    if(tr[t]){var left=t==="PEA"?Math.min(plaf-depPEA,comm-depPEA-depPME):t==="PEA_PME"?comm-depPEA-depPME:null;
      out.accounts.push({id:a.id,name:a.name,account_type:t,cash_eur:cash,deposits_total:a.deposits_total,opened_at:a.opened_at,pea_left:left!=null?Math.max(0,left):null,pea_full:left!=null&&left<=0});}
    else if(cash>0){out.lockedCash+=cash;out.locked.liquidites=(out.locked.liquidites||0)+cash;}
    out.value+=Math.max(0,cash);});
  (V.lines||[]).forEach(function(L){if(!(L.value>0)){if(L.quantity>0)out.unpriced++;return;}var a=acc[L.account_id],t=a&&a.account_type,p=pocheOf(L.i);
    var lk=!tr[t]||!L.i||L.i.custom||/^perso:/.test(L.instrument_id||"");
    out.holdings.push({account_id:L.account_id,instrument_id:L.instrument_id,i:L.i,value:L.value,quantity:L.quantity,price:L.price,fx:L.fx,pru:L.pru,fxb:L.fxb,currency:L.currency,locked:lk,poche:p,account_type:t});
    out.value+=L.value;if(lk&&p)out.locked[p]=(out.locked[p]||0)+L.value;});
  var B=out.value+Math.max(0,nz(Cc,0));
  poches().forEach(function(p){out.w0[p.id]=0;});
  if(B>0){out.holdings.forEach(function(h){if(h.poche)out.w0[h.poche]+=h.value/B;});
    (V.accounts||[]).forEach(function(a){if(a.cash_eur>0)out.w0.liquidites+=a.cash_eur/B;});}
  return out;
}

CK.alloc={monthEnd:monthEnd,compAt:compAt,weeklyTail:weeklyTail,weeklyMap:weeklyMap,poches:poches,poche:poche,label:label,pocheOf:pocheOf,decision:decision,eurSeries:eurSeries,cut:cut,metricsAt:metricsAt,scoreAt:scoreAt,
  regimeAt:regimeAt,REGIMES:REGIMES,covariance:covariance,sigma:sigma,project:project,universe:universe,strategic:strategic,run:run,current:current,
  confidence:confidence,weekKey:weekKey,SAFE:SAFE,ACTIONS:["RENFORCER","RÉDUIRE","BASCULER VERS UN AUTRE ACTIF","PASSER EN LIQUIDITÉS","CONSERVER","NE RIEN FAIRE"]};
})();
