/* ================================================================
   COCKPIT — Éligibilité PEA / PEA-PME (phase 1)
   Ordre de priorité : ta correction > référentiel (avec source) > règles certaines (non éligible)
   > règle légale pour les actions UE/EEE (eligible_regle) > « à vérifier ».
   Un fonds (ETF, OPCVM) n'est JAMAIS déclaré éligible par déduction.
   Aucun accès au DOM ni minuterie au chargement : testable dans Node (vmkit.mjs).
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

/* Pays de l'UE (27) + EEE (Islande, Norvège, Liechtenstein) : préfixes ISIN. */
var EEA=["AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","IS","NO","LI"];
var STATUSES=["eligible","eligible_regle","not_eligible","unknown"];
var FUNDS={etf:1,fonds:1};
var NON_INVEST={indice:1,taux:1};
var DAY=86400000,STALE_DAYS=365,KEY="pea:overrides";
var SRC_REGLE="règle : société UE/EEE, art. L221-31 CMF";
var SRC_PME_ETF="constat : aucun ETF éligible PEA-PME depuis 2022";
var BAD={"__proto__":1,"constructor":1,"prototype":1};

var M=function(){return CK.models||{};};
function now(opts){
  var n=opts&&opts.now;if(n instanceof Date)return n.getTime();if(typeof n==="number")return n;
  var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();
}
function today(opts){return new Date(now(opts)).toISOString().slice(0,10);}
function clean(s,max){var m=M();return m.cleanText?m.cleanText(s,max):String(s==null?"":s).replace(/<[^>]*>/g," ").trim().slice(0,max||200);}
function label(st,pme){var t=(pme?M().PEA_PME_STATUS:M().PEA_STATUS)||{};return t[st]||st;}
/** Pays (2 lettres) déduit de l'ISIN, ou null. "XS" (émission internationale) n'est pas un pays de l'EEE. */
function isinCountry(i){var s=String(i&&i.isin||"").toUpperCase();return /^[A-Z]{2}/.test(s)?s.slice(0,2):null;}
function inEEA(c){return EEA.indexOf(c)>=0;}
/** Vrai si la classe (ou un de ses parents) est dans la liste. */
function classIn(cls,list){if(list.indexOf(cls)>=0)return true;var a=M().classAncestors?M().classAncestors(cls):[];return a.some(function(p){return list.indexOf(p)>=0;});}
function stale(checked,opts){if(!checked)return true;var t=Date.parse(String(checked).slice(0,10)+"T00:00:00Z");return !isFinite(t)||now(opts)-t>STALE_DAYS*DAY;}
function res(st,by,source,checked,reason,opts,pme,useStale){
  return {status:st,label:label(st,pme),source:source||null,checked_at:checked||null,stale_check:useStale?stale(checked,opts):false,reason:reason||"",by:by};
}

/* ---------- Corrections de l'utilisateur ----------
   Stockées dans CK.lsj("pea:overrides") si disponible, sinon en mémoire (session).
   Clé = id de l'instrument (PEA) ou "pme:"+id (PEA-PME). */
var MEM={};
function readStore(){
  var raw=null;if(typeof CK.lsj==="function"){try{raw=CK.lsj(KEY);}catch(e){raw=null;}}else raw=MEM;
  var out={};if(!raw||typeof raw!=="object")return out;
  Object.keys(raw).forEach(function(k){var o=raw[k];if(BAD[k]||!o||typeof o!=="object"||STATUSES.indexOf(o.status)<0)return;
    out[k]={status:o.status,date:typeof o.date==="string"?o.date.slice(0,10):null,note:clean(o.note,200),kind:o.kind==="pme"?"pme":"pea"};});
  return out;
}
function writeStore(map){if(typeof CK.lsj==="function"){try{CK.lsj(KEY,map);}catch(e){}}else MEM=map;}
function overrides(){return readStore();}
/** Ajoute (status) ou retire (status = null) ta correction. kind : "pea" (défaut) ou "pme". Renvoie false si refusé. */
function setOverride(id,status,note,kind,opts){
  id=clean(id,64);kind=kind==="pme"?"pme":"pea";if(!id||BAD[id])return false;
  var key=kind==="pme"?"pme:"+id:id,map=readStore();
  if(status==null)delete map[key];
  else{if(STATUSES.indexOf(status)<0)return false;map[key]={status:status,date:today(opts),note:clean(note,200),kind:kind};}
  writeStore(map);return true;
}
function ovFor(id,kind){var map=readStore();return map[kind==="pme"?"pme:"+id:id]||null;}
function ovRes(o,pme,opts){
  return res(o.status,"utilisateur","correction utilisateur"+(o.note?" : "+o.note:""),o.date,"Corrigé par toi"+(o.date?" le "+o.date:"")+".",opts,pme,true);
}
/** Tes corrections au format du référentiel (à coller dans "instruments" de referentiel.json, champ par champ). */
function exportOverrides(){
  var map=readStore(),by={},order=[];
  Object.keys(map).forEach(function(k){var o=map[k],id=o.kind==="pme"?k.slice(4):k;
    if(!by[id]){by[id]={id:id};order.push(id);}
    var src="Correction utilisateur"+(o.note?" : "+o.note:"");
    if(o.kind==="pme"){by[id].pea_pme_status=o.status;by[id].pea_pme_source=src;}
    else{by[id].pea_eligibility_status=o.status;by[id].pea_source=src;by[id].pea_last_checked_at=o.date;}});
  return JSON.stringify(order.sort().map(function(id){return by[id];}),null,2);
}

/* ---------- Statut PEA ---------- */
/** Statut PEA d'un instrument : {status, label, source, checked_at, stale_check, reason, by}. opts.now injectable (ms ou Date). */
function status(i,opts){
  if(!i)return res("unknown","inconnu",null,null,"Instrument inconnu.",opts);
  // 1) ta correction
  var o=ovFor(i.id,"pea");if(o)return ovRes(o,false,opts);
  var st=i.pea_eligibility_status,v=i.vehicle,fund=!!FUNDS[v];
  // 2) référentiel (statut explicite + source) ; un fonds ne peut pas être « éligible par règle »
  if(st&&st!=="unknown"&&STATUSES.indexOf(st)>=0&&i.pea_source&&!(st==="eligible_regle"&&v!=="titre"))
    return res(st,"referentiel",i.pea_source,i.pea_last_checked_at,"Référentiel"+(i.pea_last_checked_at?" (vérifié le "+i.pea_last_checked_at+")":"")+".",opts,false,true);
  // 3) règles certaines → non éligible
  var no=function(r){return res("not_eligible","regle","règle : "+r,null,r.charAt(0).toUpperCase()+r.slice(1)+".",opts);};
  if(NON_INVEST[v]||i.is_investable===false)return no("non investissable (indice, taux ou cours de référence)");
  if(v==="etc_etn")return no("ETC / ETN, titre de créance et non action");
  if(classIn(i.asset_class,["obligations"]))return no("obligations exclues du PEA");
  if(classIn(i.asset_class,["matieres_premieres"]))return no("matières premières exclues du PEA");
  if(classIn(i.asset_class,["crypto"]))return no("crypto exclue du PEA");
  if(i.asset_class==="devises")return no("devises exclues du PEA");
  if(v==="cash"||v==="spot_crypto")return no(v==="cash"?"liquidités hors PEA":"crypto au comptant exclue du PEA");
  if(i.siic)return no("foncière SIIC / REIT, exclue depuis 2011");
  if(i.preferred)return no("action de préférence exclue du PEA");
  var c=isinCountry(i);
  if(fund){var dom=i.domicile||c;if(dom&&!inEEA(dom))return no("fonds domicilié hors UE/EEE ("+dom+")");}
  if(v==="titre"&&c&&!inEEA(c))return no("société hors UE/EEE (ISIN "+c+")");
  // 4) règle légale : action ordinaire d'une société UE/EEE
  if(v==="titre"&&c&&i.asset_class==="actions")
    return res("eligible_regle","regle",SRC_REGLE,null,"Action d'une société UE/EEE : éligible selon la règle, à confirmer chez ton courtier.",opts);
  // 5) inconnu
  return res("unknown","inconnu",null,null,fund?"Fonds : l'éligibilité n'est jamais déduite. À vérifier sur le DIC, chez l'émetteur ou sur justETF.":
    v==="titre"&&i.asset_class==="immobilier_cote"?"Foncière : régime fiscal à vérifier (les SIIC et foncières exonérées sont exclues).":"Éligibilité à vérifier.",opts);
}

/* ---------- Statut PEA-PME (jamais éligible par déduction) ---------- */
function pmeStatus(i,opts){
  if(!i)return res("unknown","inconnu",null,null,"Instrument inconnu.",opts,true);
  var o=ovFor(i.id,"pme");if(o)return ovRes(o,true,opts);
  var st=i.pea_pme_status;
  if(st&&st!=="unknown"&&STATUSES.indexOf(st)>=0&&i.pea_pme_source)return res(st,"referentiel",i.pea_pme_source,null,"Référentiel.",opts,true,true);
  if(i.vehicle==="etf")return res("not_eligible","regle",SRC_PME_ETF,null,"Aucun ETF n'est éligible au PEA-PME depuis 2022.",opts,true);
  var p=status(i,opts);
  if(p.status==="not_eligible")return res("not_eligible",p.by,p.source,p.checked_at,"Non éligible au PEA, donc pas au PEA-PME.",opts,true);
  return res("unknown","inconnu",null,null,"Éligibilité PEA-PME à vérifier (taille de la société : capitalisation sous 2 Md€ sur l'un des 4 derniers exercices).",opts,true);
}

/* ---------- Ce que chaque compte accepte ---------- */
/** {ok, reason}. PEA / PEA-PME : fonds → « eligible » seulement ; action → « eligible » ou « eligible_regle ». Autres comptes : tout sauf indices et taux. */
function allowedIn(i,acc,opts){
  if(!i)return {ok:false,reason:"Instrument inconnu."};
  if(NON_INVEST[i.vehicle]||i.is_investable===false)return {ok:false,reason:"Non investissable (indice, taux ou cours de référence)."};
  if(acc!=="PEA"&&acc!=="PEA_PME")return {ok:true,reason:""};
  var pme=acc==="PEA_PME",s=pme?pmeStatus(i,opts):status(i,opts),name=pme?"PEA-PME":"PEA";
  var ok=s.status==="eligible"||(i.vehicle==="titre"&&s.status==="eligible_regle");
  if(ok)return {ok:true,reason:s.status==="eligible_regle"?"Éligible "+name+" selon la règle, à confirmer chez ton courtier.":""};
  return {ok:false,reason:s.status==="eligible_regle"?"Un fonds doit être confirmé éligible "+name+" par une source.":
    s.status==="not_eligible"?"Non éligible "+name+" : "+s.reason:"Éligibilité "+name+" non confirmée : "+s.reason};
}

/* ---------- Alternatives éligibles PEA (même alt_group), triées par frais puis encours ---------- */
function alternatives(i,list,opts){
  if(!i||!i.alt_group)return [];
  if(!Array.isArray(list))list=CK.ref&&CK.ref.all?CK.ref.all():[];
  var nz=function(x,d){return typeof x==="number"&&isFinite(x)?x:d;};
  return list.filter(function(x){return x&&x.id!==i.id&&x.alt_group===i.alt_group&&x.is_active!==false&&allowedIn(x,"PEA",opts).ok;})
    .sort(function(a,b){return nz(a.ter,1e9)-nz(b.ter,1e9)||nz(b.market_cap_eur,-1)-nz(a.market_cap_eur,-1)||(a.id<b.id?-1:a.id>b.id?1:0);});
}

CK.pea={EEA:EEA,status:status,pmeStatus:pmeStatus,allowedIn:allowedIn,overrides:overrides,setOverride:setOverride,
  exportOverrides:exportOverrides,alternatives:alternatives,isinCountry:isinCountry};
})();
