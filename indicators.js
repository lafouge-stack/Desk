/* ================================================================
   COCKPIT — Calculs sur historiques (phase 3) : CK.ind
   Fonctions pures, « point-in-time » : chaque calcul à la date T n'utilise que les
   clôtures datées ≤ T. Aucune donnée instantanée du scanner ici.
   Partagé par le navigateur (fiche, tableau) et par le robot des historiques (histo.mjs,
   chargé dans Node avec node:vm) : mêmes chiffres partout.
   Entrées : t[] (ms, instant de clôture, croissant) et c[] (clôtures > 0).
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5;

function fin(x){return typeof x==="number"&&isFinite(x);}
/** Dernier indice k tel que t[k] ≤ T (recherche dichotomique), ou -1. */
function idxAt(t,T){var lo=0,hi=t.length-1,i=-1;while(lo<=hi){var m=(lo+hi)>>1;if(t[m]<=T){i=m;lo=m+1;}else hi=m-1;}return i;}
/** Date civile UTC (AAAA-MM-JJ) d'un instant. */
function ymd(ts){return new Date(ts).toISOString().slice(0,10);}
/** Recule d'un nombre de mois calendaires (le 31 mars − 1 mois → 28/29 février). */
function minusMonths(T,n){var d=new Date(T),y=d.getUTCFullYear(),m=d.getUTCMonth()-n,day=d.getUTCDate();
  var last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return Date.UTC(y,m,Math.min(day,last),d.getUTCHours(),d.getUTCMinutes());}

/** Rendement entre la dernière clôture ≤ T0 et la dernière clôture ≤ T1 ; null si une borne manque.
   diff : écart de niveau (c1 − c0) au lieu d'un rendement, pour un taux d'intérêt (en points de %). */
function ret(t,c,T0,T1,diff){var a=idxAt(t,T0),b=idxAt(t,T1);if(a<0||b<0||!fin(c[a])||!fin(c[b]))return null;return diff?c[b]-c[a]:c[a]>0?c[b]/c[a]-1:null;}

/** Périodes standard (calendaires), mesurées depuis la dernière clôture ≤ T. */
var PERIODS=[{k:"w",l:"1 sem",d:7},{k:"m1",l:"1 mois",m:1},{k:"m3",l:"3 mois",m:3},{k:"m6",l:"6 mois",m:6},{k:"y1",l:"1 an",m:12},
  {k:"y3",l:"3 ans",m:36},{k:"y5",l:"5 ans",m:60},{k:"y10",l:"10 ans",m:120}];
/**
 * Performances à la date T (défaut : dernière clôture). Une période plus longue que l'historique donne null
 * (jamais un rendement « depuis le début » déguisé). ytd : depuis la dernière clôture de l'année précédente.
 */
function perfs(t,c,T,diff){
  var o={};if(!t||!t.length)return o;var e=idxAt(t,T==null?t[t.length-1]:T);if(e<0)return o;var Te=t[e];
  PERIODS.forEach(function(p){var T0=p.d?Te-p.d*DAY:minusMonths(Te,p.m);o[p.k]=T0<t[0]?null:ret(t,c,T0,Te,diff);});
  var y=new Date(Te).getUTCFullYear(),T0y=Date.UTC(y,0,1)-1;o.ytd=T0y<t[0]?null:ret(t,c,T0y,Te,diff);
  o.max=ret(t,c,t[0],Te,diff);
  return o;
}
/** Rendement annualisé d'un rendement total r sur `years` années. */
function annualize(r,years){return fin(r)&&years>0&&r>-1?Math.pow(1+r,1/years)-1:null;}
/** Rendements logarithmiques de clôture à clôture. */
function logRets(c){var out=[];for(var k=1;k<c.length;k++)if(c[k]>0&&c[k-1]>0)out.push(Math.log(c[k]/c[k-1]));return out;}
/**
 * Volatilité annualisée sur les `n` derniers rendements quotidiens ≤ T (écart-type × √périodes par an).
 * perYear : 252 (bourse) ou 365 (crypto, cotée tous les jours). null s'il y a moins de n/2 rendements.
 */
function vol(t,c,n,T,perYear){
  n=n||252;perYear=perYear||252;var e=T==null?c.length-1:idxAt(t,T);if(e<1)return null;
  var r=logRets(c.slice(Math.max(0,e-n),e+1));if(r.length<Math.max(2,Math.floor(n/2)))return null;
  var m=r.reduce(function(s,x){return s+x;},0)/r.length,v=r.reduce(function(s,x){return s+(x-m)*(x-m);},0)/(r.length-1);
  return Math.sqrt(v*perYear);
}
/** Perte maximale (de plus haut à plus bas), négative ou 0, sur les clôtures entre T0 et T (inclus). */
function maxDD(t,c,T0,T){
  var a=T0==null?0:Math.max(0,idxAt(t,T0)),e=T==null?c.length-1:idxAt(t,T),pk=-Infinity,dd=0;if(e<0)return null;
  for(var k=a;k<=e;k++){if(!(c[k]>0))continue;if(c[k]>pk)pk=c[k];var d=c[k]/pk-1;if(d<dd)dd=d;}return dd;
}
/** Clôtures hebdomadaires (dernière clôture de chaque semaine ISO, lundi-dimanche) : les `weeks` dernières ≤ T. */
function weekly(t,c,weeks,T){
  var e=T==null?t.length-1:idxAt(t,T),out=[],key=null;
  for(var k=0;k<=e;k++){var d=Math.floor(t[k]/DAY),wk=d-(d+3)%7;if(wk!==key){out.push([t[k],c[k]]);key=wk;}else out[out.length-1]=[t[k],c[k]];}
  return weeks?out.slice(-weeks):out;
}
/** Plus haut / plus bas des clôtures sur 52 semaines ≤ T. */
function range52(t,c,T){var e=T==null?t.length-1:idxAt(t,T);if(e<0)return null;var a=idxAt(t,t[e]-365*DAY),hi=-Infinity,lo=Infinity;
  for(var k=Math.max(0,a);k<=e;k++){if(c[k]>hi)hi=c[k];if(c[k]<lo)lo=c[k];}return {hi:hi,lo:lo};}

/**
 * diff : série de taux (écarts en points, ni volatilité ni perte maximale).
 * Résumé compact d'un historique (publié par le robot dans resume.json, recalculé dans la fiche) :
 * {d: date de la dernière clôture, c, p: perfs, vol1y, mdd1y, mdd5y, hi52, lo52, n, first, spark: 52 clôtures hebdo}.
 * perYear : 365 pour la crypto (cotée 7 j / 7), 252 sinon.
 */
function summary(t,c,perYear,diff){
  if(!t||!t.length)return null;var e=t.length-1,T=t[e],r=range52(t,c,T);
  return {d:ymd(T),c:c[e],p:perfs(t,c,T,diff),vol1y:diff?null:vol(t,c,perYear===365?365:252,T,perYear||252),
    mdd1y:diff?null:maxDD(t,c,T-365*DAY,T),mdd5y:!diff&&t[0]<=minusMonths(T,60)?maxDD(t,c,minusMonths(T,60),T):null,
    hi52:r?r.hi:null,lo52:r?r.lo:null,n:t.length,first:ymd(t[0]),spark:weekly(t,c,52,T).map(function(x){return x[1];})};
}
/** Arrondi à `sig` chiffres significatifs (fichiers plus légers, précision largement suffisante). */
function round(v,sig){if(!fin(v)||v===0)return v;var p=Math.pow(10,(sig||6)-Math.ceil(Math.log10(Math.abs(v))));return Math.round(v*p)/p;}

CK.ind={idxAt:idxAt,ymd:ymd,minusMonths:minusMonths,ret:ret,perfs:perfs,PERIODS:PERIODS,annualize:annualize,logRets:logRets,
  vol:vol,maxDD:maxDD,weekly:weekly,range52:range52,summary:summary,round:round};
})();
