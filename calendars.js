/* ================================================================
   COCKPIT — Calendriers de marché (phase 1)
   Jours fériés calculés par RÈGLE (Pâques : algorithme de Meeus/Butcher), jamais par liste :
   valables pour toute année sans mise à jour. Heures locales converties en ms UTC via Intl
   (heure d'été gérée par le fuseau de la place).
   Marchés : "euronext", "xetra", "nyse", "crypto" (toujours ouvert).
   Limites : fermetures exceptionnelles (deuil national, panne) non prévisibles ; Juneteenth à partir de 2022 ;
   clôture 14h05 des demi-séances Euronext à confirmer chaque année sur l'avis Euronext.
   Aucun accès au DOM ni minuterie au chargement.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

var DAY=86400000,YMD_RE=/^(\d{4})-(\d{2})-(\d{2})$/;
var NAMES={nyd:"Jour de l'an",gf:"Vendredi saint",em:"Lundi de Pâques",may:"Fête du Travail",xmas:"Noël",boxing:"Lendemain de Noël",
  xeve:"Veille de Noël",nye:"Saint-Sylvestre",mlk:"Martin Luther King Day",pres:"Presidents' Day",mem:"Memorial Day",
  june:"Juneteenth",ind:"Independence Day",labor:"Labor Day",thx:"Thanksgiving"};

/* ---------- Dates (calcul en UTC pur, sans fuseau) ---------- */
function pad(n){return (n<10?"0":"")+n;}
function mk(y,m,d){return y+"-"+pad(m)+"-"+pad(d);}
function parse(s){var m=YMD_RE.exec(String(s==null?"":s));if(!m)return null;var y=+m[1],mo=+m[2],d=+m[3],t=Date.UTC(y,mo-1,d),x=new Date(t);
  return x.getUTCMonth()===mo-1&&x.getUTCDate()===d?{y:y,m:mo,d:d,t:t}:null;}
function fromT(t){var x=new Date(t);return mk(x.getUTCFullYear(),x.getUTCMonth()+1,x.getUTCDate());}
function add(s,n){var p=parse(s);return p?fromT(p.t+n*DAY):null;}
function dow(y,m,d){return new Date(Date.UTC(y,m-1,d)).getUTCDay();}          // 0 = dimanche
function isWeekend(s){var p=parse(s);if(!p)return false;var w=dow(p.y,p.m,p.d);return w===0||w===6;}
function nth(y,m,wd,n){return 1+(wd-dow(y,m,1)+7)%7+(n-1)*7;}                 // n-ième jour wd du mois
function lastWd(y,m,wd){var L=new Date(Date.UTC(y,m,0)).getUTCDate();return L-(dow(y,m,L)-wd+7)%7;}

/** Dimanche de Pâques (calendrier grégorien), algorithme de Meeus/Butcher. */
function easter(y){
  y=Math.floor(+y);if(!(y>=1583&&y<=9999))return null;
  var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
      h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
      x=h+l-7*m+114;
  return mk(y,Math.floor(x/31),x%31+1);
}
/* Règle américaine d'observation : samedi → vendredi, dimanche → lundi. */
function observed(y,m,d){var w=dow(y,m,d),s=mk(y,m,d);return w===6?add(s,-1):w===0?add(s,1):s;}

/* ---------- Règles par place : fermetures et demi-séances d'une année ---------- */
function eurRules(y,extra){
  var e=easter(y),h={};
  h[mk(y,1,1)]="nyd";h[add(e,-2)]="gf";h[add(e,1)]="em";h[mk(y,5,1)]="may";h[mk(y,12,25)]="xmas";h[mk(y,12,26)]="boxing";
  (extra||[]).forEach(function(x){h[mk(y,x[0],x[1])]=x[2];});
  return h;
}
function nyseRules(y){
  var h={},e=easter(y),nyd=mk(y,1,1),w=dow(y,1,1);
  if(w!==6)h[w===0?mk(y,1,2):nyd]="nyd";                  // 1er janvier un samedi : pas d'observation le 31/12
  h[mk(y,1,nth(y,1,1,3))]="mlk";h[mk(y,2,nth(y,2,1,3))]="pres";h[add(e,-2)]="gf";h[mk(y,5,lastWd(y,5,1))]="mem";
  if(y>=2022)h[observed(y,6,19)]="june";
  h[observed(y,7,4)]="ind";h[mk(y,9,nth(y,9,1,1))]="labor";h[mk(y,11,nth(y,11,4,4))]="thx";h[observed(y,12,25)]="xmas";
  return h;
}
var MK={
  euronext:{label:"Euronext Paris",tz:"Europe/Paris",open:"09:00",close:"17:30",half:"14:05",
    hol:function(y){return eurRules(y);},
    halves:function(y){var o={};o[mk(y,12,24)]=1;o[mk(y,12,31)]=1;return o;}},
  xetra:{label:"Xetra (Francfort)",tz:"Europe/Berlin",open:"09:00",close:"17:30",half:null,
    hol:function(y){return eurRules(y,[[12,24,"xeve"],[12,31,"nye"]]);},
    halves:function(){return {};}},
  nyse:{label:"NYSE / Nasdaq",tz:"America/New_York",open:"09:30",close:"16:00",half:"13:00",
    hol:nyseRules,
    halves:function(y){var o={},j3=mk(y,7,3);
      o[add(mk(y,11,nth(y,11,4,4)),1)]=1;                                    // lendemain de Thanksgiving
      o[mk(y,12,24)]=1;                                                       // 24/12 (ignoré si férié ou week-end)
      if(observed(y,7,4)!==j3)o[j3]=1;                                        // 3/7 si le 4/7 n'est pas observé ce jour-là (ignoré le week-end)
      return o;}},
  crypto:{label:"Crypto",tz:"UTC",always:true}
};
var CACHE={};
function yearOf(m,y){var k=m+":"+y;if(!CACHE[k]){var M=MK[m];CACHE[k]=easter(y)?{hol:M.hol(y),half:M.halves(y)}:{hol:{},half:{}};}return CACHE[k];}
function mkt(m){return Object.prototype.hasOwnProperty.call(MK,m)?MK[m]:null;}

/* ---------- Fuseaux (Intl) ---------- */
var FMT=Object.create(null);
/** Formateur mis en cache ; null si le fuseau est inconnu (pas d'exception). */
function fmt(tz){tz=String(tz||"UTC");if(!(tz in FMT))try{FMT[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){FMT[tz]=null;}return FMT[tz];}
/** Heure murale de ts dans tz : {y,m,d,h,mi,s} ; null si ts n'est pas un instant valide ou tz inconnu. */
function wall(ts,tz){var F=fmt(tz),x=new Date(typeof ts==="number"?ts:NaN);if(!F||isNaN(x.getTime()))return null;
  var o={};F.formatToParts(x).forEach(function(p){if(p.type!=="literal")o[p.type]=+p.value;});
  return {y:o.year,m:o.month,d:o.day,h:o.hour===24?0:o.hour,mi:o.minute,s:o.second};}
function offset(ts,tz){var w=wall(ts,tz);return w?Date.UTC(w.y,w.m-1,w.d,w.h,w.mi,w.s)-Math.floor(ts/1000)*1000:null;}
/** ms UTC de l'heure locale "HH:MM" du jour ymd dans le fuseau tz (heure d'été comprise). */
function zoned(s,hm,tz){
  var p=parse(s),t=/^(\d{1,2}):(\d{2})$/.exec(String(hm||""));if(!p||!t||+t[1]>23||+t[2]>59)return null;
  var guess=Date.UTC(p.y,p.m-1,p.d,+t[1],+t[2]),o1=offset(guess,tz||"UTC");if(o1==null)return null;
  var o2=offset(guess-o1,tz||"UTC");return o2==null?null:guess-o2;
}
function dayIn(ts,tz){var w=wall(ts,tz);return w?mk(w.y,w.m,w.d):null;}
function toYmd(v,tz){if(typeof v==="number"&&isFinite(v))return dayIn(v,tz||"UTC");var p=parse(v);return p?mk(p.y,p.m,p.d):null;}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}

/* ---------- API ---------- */
/** Nom du jour férié (fermeture en semaine) ou null. Un férié tombant un week-end n'est pas compté (le week-end prime). */
function holidayName(m,v){var M=mkt(m);if(!M||M.always)return null;var s=toYmd(v,M.tz);if(!s||isWeekend(s))return null;
  var c=yearOf(m,+s.slice(0,4)).hol[s];return c?NAMES[c]:null;}
function isHoliday(m,v){return holidayName(m,v)!=null;}
function isTradingDay(m,v){var M=mkt(m);if(!M)return false;var s=toYmd(v,M.tz);if(!s)return false;if(M.always)return true;return !isWeekend(s)&&!isHoliday(m,s);}
function isHalfDay(m,v){var M=mkt(m);if(!M||M.always||!M.half)return false;var s=toYmd(v,M.tz);return !!s&&isTradingDay(m,s)&&!!yearOf(m,+s.slice(0,4)).half[s];}
/** Séance du jour : {open, close (ms UTC), half} ou null si fermé. Crypto : journée UTC complète. */
function session(m,v){
  var M=mkt(m);if(!M)return null;var s=toYmd(v,M.tz);if(!s||!isTradingDay(m,s))return null;
  if(M.always){var t=parse(s).t;return {open:t,close:t+DAY,half:false};}
  var half=isHalfDay(m,s);return {open:zoned(s,M.open,M.tz),close:zoned(s,half?M.half:M.close,M.tz),half:half};
}
function step(m,v,dir){var M=mkt(m);if(!M)return null;var s=toYmd(v,M.tz);if(!s)return null;
  for(var i=0;i<30;i++){s=add(s,dir);if(isTradingDay(m,s))return s;}return null;}
function nextTradingDay(m,v){return step(m,v,1);}
function prevTradingDay(m,v){return step(m,v,-1);}
/** Dernier jour de bourse du mois (mo de 1 à 12). */
function lastTradingDayOfMonth(m,y,mo){
  y=Math.floor(+y);mo=Math.floor(+mo);if(!mkt(m)||!(mo>=1&&mo<=12)||!easter(y))return null;
  var L=mk(y,mo,new Date(Date.UTC(y,mo,0)).getUTCDate());return isTradingDay(m,L)?L:prevTradingDay(m,L);
}
/** État à l'instant ts (défaut : maintenant) : {open, label, next_open, close (si ouvert), half, holiday} ; null si marché inconnu ou instant hors limites. */
function state(m,ts){
  var M=mkt(m);if(!M)return null;ts=typeof ts==="number"&&isFinite(ts)?ts:now();
  if(M.always)return {open:true,label:"Ouvert",next_open:null,close:null,half:false,holiday:null};
  var s=dayIn(ts,M.tz);if(!s)return null;var se=session(m,s);
  if(se&&ts>=se.open&&ts<se.close)return {open:true,label:se.half?"Séance écourtée":"Ouvert",next_open:null,close:se.close,half:se.half,holiday:null};
  var nx=se&&ts<se.open?se.open:null;if(nx==null){var n=nextTradingDay(m,s);nx=n?session(m,n).open:null;}
  var hn=holidayName(m,s);
  return {open:false,label:isWeekend(s)?"Fermé (week-end)":hn?"Fermé (jour férié)":"Fermé",next_open:nx,close:null,half:false,holiday:hn};
}
function isOpen(m,ts){var st=state(m,ts);return !!(st&&st.open);}
/** Fermetures en semaine et demi-séances d'une année : [{date, name|null, half:boolean}] triées. */
function holidays(m,y){
  var M=mkt(m);y=Math.floor(+y);if(!M||M.always||!easter(y))return [];
  var Y=yearOf(m,y),out=[];
  Object.keys(Y.hol).forEach(function(s){if(s.slice(0,4)===String(y)&&!isWeekend(s))out.push({date:s,name:NAMES[Y.hol[s]],half:false});});
  Object.keys(Y.half).forEach(function(s){if(isHalfDay(m,s))out.push({date:s,name:null,half:true});});
  return out.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;});
}

CK.cal={
  MARKETS:Object.keys(MK).map(function(id){return {id:id,label:MK[id].label,tz:MK[id].tz};}),
  easter:easter,isHoliday:isHoliday,holidayName:holidayName,isTradingDay:isTradingDay,isHalfDay:isHalfDay,
  session:session,state:state,isOpen:isOpen,nextTradingDay:nextTradingDay,prevTradingDay:prevTradingDay,
  lastTradingDayOfMonth:lastTradingDayOfMonth,holidays:holidays,
  parisDay:function(ts){return dayIn(typeof ts==="number"&&isFinite(ts)?ts:now(),"Europe/Paris");},
  dayIn:dayIn,zoned:zoned,
  /** Heure murale "HH:MM" de ts dans tz (pour l'affichage et les tests). */
  hm:function(ts,tz){var w=wall(ts,tz||"Europe/Paris");return w?pad(w.h)+":"+pad(w.mi):null;}
};
})();
