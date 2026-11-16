/* ================================================================
   COCKPIT — Change : conversion en EUR (phase 1)
   Taux stockés en « EUR pour 1 unité de la devise » (USD → ~0,90).
   Fixings quotidiens BCE (Frankfurter) + taux en direct (setLive, ex. EURUSD TradingView).
   Conventions : EUR = 1 ; GBX/GBp (pence) = GBP/100 ; USDT, USDC, FDUSD, DAI ≈ USD ;
   devise inconnue → null (jamais 1 par défaut).
   Aucun appel réseau ni minuterie au chargement : tout passe par CK.fx.load().
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

var FR="https://api.frankfurter.dev/v1/",FR2="https://api.frankfurter.dev/v2/rates?base=EUR&providers=ECB";
var TTL=6*3600000,DAY=86400000,LIVE_MAX=DAY;
/* Devises de l'historique chargé par défaut (le dernier fixing, lui, contient toutes les devises BCE) */
var SYMS=["USD","GBP","CHF","JPY","SEK","NOK","DKK","PLN","CZK","HUF","CAD","AUD","HKD","SGD","CNY"];
/* Alias : [devise de référence, multiplicateur]. « GBp » est testé tel quel avant la mise en majuscules (sinon il deviendrait GBP). */
var ALIAS={GBX:["GBP",0.01],GBp:["GBP",0.01],USDT:["USD",1],USDC:["USD",1],FDUSD:["USD",1],DAI:["USD",1]};
var CCY_RE=/^[A-Z]{3}$/,YMD_RE=/^\d{4}-\d{2}-\d{2}/;

var D={},LIVE={},INFO={source:null,loadedAt:null,stale:false};   // D[ccy] = {m:{date:taux}, k:[dates triées]|null}

function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function fin(x){x=typeof x==="string"&&x.trim()!==""?Number(x):x;return typeof x==="number"&&isFinite(x)?x:null;}
/** "AAAA-MM-JJ" depuis une chaîne, un nombre (ms, jour UTC) ou une Date ; null si illisible ou date inexistante (2026-13-45). */
function ymd(v){
  if(v==null||v==="")return null;
  if(typeof v==="object"&&typeof v.getTime==="function")v=v.getTime();   // Date (même venue d'un autre cadre)
  if(typeof v==="number"){if(!isFinite(v))return null;var d=new Date(v);return isNaN(d.getTime())?null:d.toISOString().slice(0,10);}
  var s=String(v).trim().slice(0,10);if(!YMD_RE.test(s))return null;
  var t=new Date(s+"T00:00:00Z");return !isNaN(t.getTime())&&t.toISOString().slice(0,10)===s?s:null;
}
/** Devise → [référence, multiplicateur] ou null. */
function res(c){
  if(c==null)return null;c=String(c).trim();
  if(ALIAS.hasOwnProperty(c))return ALIAS[c];
  var u=c.toUpperCase();if(ALIAS.hasOwnProperty(u))return ALIAS[u];
  return CCY_RE.test(u)?[u,1]:null;
}
function put(c,date,eur){
  if(!CCY_RE.test(c)||c==="EUR"||!(eur>0)||!date)return false;
  var s=D[c]||(D[c]={m:{},k:null});if(s.m[date]!==eur){s.m[date]=eur;s.k=null;}return true;
}
function keys(s){return s.k||(s.k=Object.keys(s.m).sort());}
/** Dernier fixing ≤ date (recherche dichotomique) ; date absente → dernier fixing connu. */
function fixing(c,date){
  var s=D[c];if(!s)return null;var k=keys(s);if(!k.length)return null;
  if(date==null)return {date:k[k.length-1],rate:s.m[k[k.length-1]]};
  var lo=0,hi=k.length-1,i=-1;
  while(lo<=hi){var mid=(lo+hi)>>1;if(k[mid]<=date){i=mid;lo=mid+1;}else hi=mid-1;}
  return i<0?null:{date:k[i],rate:s.m[k[i]]};
}

/** Fixings quotidiens : [["AAAA-MM-JJ", eurParUnite], …] ou {date: taux}. Fusionne avec l'existant. Renvoie le nombre de points retenus. */
function setDaily(ccy,series){
  var r=res(ccy);if(!r||r[1]!==1||r[0]!==String(ccy).trim().toUpperCase())return 0;   // pas de série pour un alias (GBX, USDT…)
  var n=0,c=r[0],add=function(d,v){if(put(c,ymd(d),fin(v)))n++;};
  if(Array.isArray(series))series.forEach(function(p){if(Array.isArray(p))add(p[0],p[1]);});
  else if(series&&typeof series==="object")Object.keys(series).forEach(function(d){add(d,series[d]);});
  return n;
}
/** Taux en direct (EUR pour 1 unité), valable un jour. */
function setLive(ccy,eur,ts){
  var r=res(ccy);eur=fin(eur);if(!r||r[1]!==1||r[0]==="EUR"||r[0]!==String(ccy).trim().toUpperCase()||!(eur>0))return false;
  LIVE[r[0]]={rate:eur,ts:fin(ts)||now()};return true;
}
/** EUR pour 1 unité de ccy. date absente → direct (< 1 jour) sinon dernier fixing ; date → dernier fixing ≤ date, null si aucun. */
function rate(ccy,date){
  var r=res(ccy);if(!r)return null;if(r[0]==="EUR")return r[1];
  if(date==null){
    var l=LIVE[r[0]];if(l&&Math.abs(now()-l.ts)<LIVE_MAX)return l.rate*r[1];
    var f=fixing(r[0],null);return f?f.rate*r[1]:null;
  }
  var d=ymd(date);if(!d)return null;
  var g=fixing(r[0],d);return g?g.rate*r[1]:null;
}
function toEUR(amount,ccy,date){var a=fin(amount),r=rate(ccy,date);return a==null||r==null?null:a*r;}
/** Rendement en EUR d'un rendement local entre d0 et d1 : (1 + r_loc)·(fx(d1)/fx(d0)) − 1. */
function ret(rLocal,ccy,d0,d1){
  var r=fin(rLocal),f0=rate(ccy,d0),f1=rate(ccy,d1);
  return r==null||f0==null||f1==null||!(f0>0)?null:(1+r)*(f1/f0)-1;
}

/* ---------- Chargement ----------
   Frankfurter (BCE) donne « 1 EUR = x devise » : on stocke 1/x.
   Dernier fixing : FR+"latest?base=EUR" → {base, date, rates:{USD:1.1081,…}}
   Historique     : FR+"AAAA-MM-JJ..?base=EUR&symbols=…" → {base, start_date, end_date, rates:{"AAAA-MM-JJ":{USD:…},…}}
                    (quotidien, jours ouvrés BCE ; la 1re date est le dernier fixing ≤ début demandé).
   Secours 1 (API v1 dépréciée par Frankfurter depuis mai 2026, en-tête Deprecation) : v2 avec providers=ECB, mêmes fixings BCE,
                    FR2 → [{date, base:"EUR", quote:"USD", rate:1.1081}, …] (&from=AAAA-MM-JJ pour l'historique, &quotes=… pour les devises).
   Secours 2 (si une partie échoue encore) : fichier du robot `${data}/data/fx.json`, MÊME FORMAT que l'historique v1
   Frankfurter : {"_doc":"…", "base":"EUR", "src":"BCE", "updated":"AAAA-MM-JJ", "rates":{"AAAA-MM-JJ":{"USD":1.1081,…},…}}. */
function validFx(d){
  if(Array.isArray(d))return d.some(function(p){return p&&p.base==="EUR"&&p.quote&&p.date&&fin(p.rate)>0;})?true:"pas de taux en base EUR";   // v2
  return d&&typeof d==="object"&&d.rates&&typeof d.rates==="object"&&(d.base==null||d.base==="EUR")?true:"pas de taux en base EUR";
}
function apply(d){
  var n=0,R=d.rates,one=function(date,o){if(!date||!o||typeof o!=="object")return;Object.keys(o).forEach(function(c){var x=fin(o[c]);if(x>0&&put(c,date,1/x))n++;});};
  if(Array.isArray(d))d.forEach(function(p){var x=p&&fin(p.rate);if(p&&p.base==="EUR"&&x>0&&put(String(p.quote),ymd(p.date),1/x))n++;});   // v2 : [{date, base, quote, rate}]
  else if(ymd(d.date)&&Object.keys(R).some(function(k){return typeof R[k]!=="object";}))one(ymd(d.date),R);
  else Object.keys(R).forEach(function(k){one(ymd(k),R[k]);});
  return n;
}
function get(url){
  if(CK.dk&&typeof CK.dk.fetch==="function")
    return CK.dk.fetch(url,{provider:"fx",parse:"json",ttl:TTL,validate:validFx}).then(function(r){return {data:r&&r.data,stale:!!(r&&r.stale)};});
  var f=window.fetch;if(typeof f!=="function")return Promise.reject(new Error("réseau indisponible"));
  /* Repli sans CK.dk : délai maximal de 15 s pour que load() finisse toujours */
  return new Promise(function(res,rej){
    var T=window.setTimeout,tm=typeof T==="function"?T(function(){rej(new Error("Délai dépassé"));},15000):null;
    Promise.resolve().then(function(){return f.call(window,url);})
      .then(function(r){if(!r||!r.ok)throw new Error("HTTP "+(r?r.status:0));return r.json();})
      .then(function(d){var v=validFx(d);if(v!==true)throw new Error(v);return {data:d,stale:false};})
      .then(res,rej).then(function(){if(tm!=null&&typeof window.clearTimeout==="function")window.clearTimeout(tm);});
  });
}
function log(level,msg){if(CK.dk&&typeof CK.dk.log==="function")try{CK.dk.log(level,"fx",msg);}catch(e){}}
function cfgData(){try{var c=CK.cfg&&CK.cfg();return c&&c.data||"";}catch(e){return "";}}
/**
 * Charge le dernier fixing et l'historique. opts : {from:"AAAA-MM-JJ"|ms (défaut : 3 ans), days, symbols:[…], base (adresse du robot), robot:false}.
 * Chaque partie essaie Frankfurter v1, puis Frankfurter v2 (fournisseur BCE, mêmes fixings) ; si une partie échoue encore, fichier du robot.
 * Ne rejette jamais : résout {ok, source:"frankfurter"|"frankfurter-v2"|"robot"|null, stale, points, date (dernier fixing USD), errors:[une ligne par partie en échec]}.
 */
function load(opts){
  var o=opts||{},out={ok:false,source:null,stale:false,points:0,date:null,errors:[]},miss=false;
  /* tries : [[source, url], …] essayées dans l'ordre jusqu'au premier succès */
  var part=function(tries){
    var errs=[],run=function(i){
      if(i>=tries.length){miss=true;out.errors.push(errs.join(" ; "));return;}
      var t=tries[i];
      return get(t[1]).then(function(r){
        var v=r&&r.data!=null?validFx(r.data):"réponse vide";if(v!==true)throw new Error(v);
        out.points+=apply(r.data);out.stale=out.stale||!!r.stale;if(!out.source)out.source=t[0];
      }).then(null,function(e){var m=t[0]+" : "+(e&&e.message||e);errs.push(m);log("warn",m);return run(i+1);});
    };
    return Promise.resolve().then(function(){return run(0);});
  };
  var done=function(){
    var f=fixing("USD",null);out.date=f?f.date:null;out.ok=out.points>0;
    if(out.ok){INFO.source=out.source;INFO.loadedAt=now();INFO.stale=out.stale;}
    return out;
  };
  try{
    if(CK.dk&&typeof CK.dk.provider==="function")try{CK.dk.provider("fx",{label:"Change (BCE / Frankfurter)",rate:1,burst:2,timeout:12000,period:TTL,staleMs:2*DAY});}catch(e){}   // fixings quotidiens : pas « obsolète » au bout de 30 min
    var from=ymd(o.from)||ymd(now()-(fin(o.days)||1100)*DAY);
    var sym=(Array.isArray(o.symbols)?o.symbols:SYMS).map(function(c){return String(c).toUpperCase();}).filter(function(c){return CCY_RE.test(c)&&c!=="EUR";}).join(",");
    var base=String((o.base!=null?o.base:cfgData())||"").replace(/\/+$/,"");
    return Promise.all([
      part([["frankfurter",FR+"latest?base=EUR"],["frankfurter-v2",FR2]]),
      part([["frankfurter",FR+from+"..?base=EUR"+(sym?"&symbols="+sym:"")],["frankfurter-v2",FR2+"&from="+from+(sym?"&quotes="+sym:"")]])
    ]).then(function(){if(miss&&base&&o.robot!==false)return part([["robot",base+"/data/fx.json"]]);})
      .then(done,function(e){out.errors.push(String(e&&e.message||e));return done();});
  }catch(e){out.errors.push(String(e&&e.message||e));return Promise.resolve(done());}
}

CK.fx={
  setDaily:setDaily,setLive:setLive,rate:rate,toEUR:toEUR,ret:ret,load:load,
  /** Dernier fixing ≤ date : {date, rate} (EUR pour 1 unité, alias appliqués) ou null. */
  fixing:function(ccy,date){var r=res(ccy);if(!r)return null;if(r[0]==="EUR")return {date:ymd(date),rate:r[1]};
    var d=date==null?null:ymd(date);if(date!=null&&!d)return null;var f=fixing(r[0],d);return f?{date:f.date,rate:f.rate*r[1]}:null;},
  /** Vrai si la devise est convertible (EUR, alias ou taux connu). */
  has:function(ccy,date){return rate(ccy,date)!=null;},
  currencies:function(){return Object.keys(D).sort();},
  info:function(){var l={};Object.keys(LIVE).forEach(function(c){l[c]={rate:LIVE[c].rate,ts:LIVE[c].ts};});
    var f=fixing("USD",null);return {source:INFO.source,loadedAt:INFO.loadedAt,stale:INFO.stale,last:f?f.date:null,currencies:Object.keys(D).sort(),live:l};},
  ALIAS:ALIAS,
  _reset:function(){D={};LIVE={};INFO={source:null,loadedAt:null,stale:false};}
};
})();
