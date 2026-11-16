/* ================================================================
   COCKPIT — Modèles de données multi-actifs (phase 1)
   Classes d'actifs (arbre), véhicules, énumérations, normaliseurs,
   validateurs, garde-fou unique CK.allow, référentiel CK.ref.
   Aucun accès au DOM ni minuterie au chargement : testable dans Node (vmkit.mjs).
   Types documentés en JSDoc (vérifiables par VS Code avec // @ts-check).
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

/* ---------- Données éditables injectées par build.mjs (referentiel.json, allocation.json, fiscal.json) ----------
   Dans index.html, chaque marqueur est remplacé par le contenu JSON du fichier. Hors build (tests), ce sont
   des chaînes : les tests appellent CK.models.setData(). */
CK.DATA=CK.DATA||{referentiel:"@@REFERENTIEL@@",allocation:"@@ALLOCATION@@",fiscal:"@@FISCAL@@"};
function data(k){var v=Object.prototype.hasOwnProperty.call(CK.DATA,k)?CK.DATA[k]:null;return v&&typeof v==="object"?v:null;}

/** Phrase exacte imposée, affichée partout (accueil compris). */
var DISCLAIMER="Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
CK.DISCLAIMER=DISCLAIMER;

/* ---------- Classes d'exposition : arbre parent → enfants ----------
   Une classe n'est autorisée que si elle ET tous ses parents sont cochés. */
/** @typedef {"actions"|"obligations"|"oblig_etat"|"oblig_entreprise"|"matieres_premieres"|"or"|"argent"|"energie"|"petrole"|"gaz"|"agricole"|"immobilier_cote"|"crypto"|"stablecoin"|"liquidites"|"devises"} AssetClass */
var CLASSES=[
  {id:"actions",label:"Actions",parent:null},
  {id:"obligations",label:"Obligations",parent:null},
  {id:"oblig_etat",label:"Obligations d'État",parent:"obligations"},
  {id:"oblig_entreprise",label:"Obligations d'entreprise",parent:"obligations"},
  {id:"matieres_premieres",label:"Matières premières",parent:null},
  {id:"or",label:"Or",parent:"matieres_premieres"},
  {id:"argent",label:"Argent",parent:"matieres_premieres"},
  {id:"energie",label:"Énergie",parent:"matieres_premieres"},
  {id:"petrole",label:"Pétrole",parent:"energie"},
  {id:"gaz",label:"Gaz naturel",parent:"energie"},
  {id:"agricole",label:"Matières premières agricoles",parent:"matieres_premieres"},
  {id:"immobilier_cote",label:"Immobilier coté (REIT, SIIC)",parent:null},
  {id:"crypto",label:"Crypto",parent:null},
  {id:"stablecoin",label:"Stablecoins",parent:"crypto"},
  {id:"liquidites",label:"Liquidités",parent:null},
  {id:"devises",label:"Devises",parent:null}
];
/* Tables sans prototype : "toString", "constructor"… ne sont jamais pris pour une classe, un véhicule ou un instrument. */
var dict=function(){return Object.create(null);};
var CL=dict();CLASSES.forEach(function(c){CL[c.id]=c;});
/** Identifiant de classe connu (chaîne exacte) ou null : ["or"] ou {toString…} ne passent jamais pour "or". */
function clsId(v){return typeof v==="string"&&CL[v]?v:null;}
function classAncestors(id){var out=[],c=CL[clsId(id)],guard=0;while(c&&c.parent&&guard++<10){out.push(c.parent);c=CL[c.parent];}return out;}
function classChildren(id){return CLASSES.filter(function(c){return c.parent===id;}).map(function(c){return c.id;});}
/** Vrai si la classe et tous ses parents sont cochés dans `checked` ({classe:true}). */
function isClassAllowed(id,checked){if(!clsId(id)||!checked||checked[id]!==true)return false;return classAncestors(id).every(function(p){return checked[p]===true;});}

/* ---------- Véhicules ---------- */
/** @typedef {"titre"|"etf"|"etc_etn"|"fonds"|"spot_crypto"|"cash"|"indice"|"taux"} Vehicle */
var VEHICLES=[
  {id:"titre",label:"Titres en direct (actions)",investable:true},
  {id:"etf",label:"ETF",investable:true},
  {id:"etc_etn",label:"ETC / ETN",investable:true},
  {id:"fonds",label:"Fonds (OPCVM, UC)",investable:true},
  {id:"spot_crypto",label:"Crypto au comptant",investable:true},
  {id:"cash",label:"Liquidités",investable:true},
  {id:"indice",label:"Indice (non investissable)",investable:false},
  {id:"taux",label:"Taux (non investissable)",investable:false}
];
var VH=dict();VEHICLES.forEach(function(v){VH[v.id]=v;});

/* ---------- Autres énumérations ---------- */
var PEA_STATUS={eligible:"Éligible PEA",eligible_regle:"Éligible PEA (règle, à confirmer chez ton courtier)",not_eligible:"Non éligible PEA",unknown:"Éligibilité à vérifier"};
var PEA_PME_STATUS={eligible:"Éligible PEA-PME",eligible_regle:"Éligible PEA-PME (règle, à confirmer)",not_eligible:"Non éligible PEA-PME",unknown:"Éligibilité PEA-PME à vérifier"};
var ACCOUNT_TYPES=[
  {id:"PEA",label:"PEA"},{id:"PEA_PME",label:"PEA-PME"},{id:"CTO",label:"Compte-titres (CTO)"},
  {id:"assurance_vie",label:"Assurance-vie"},{id:"crypto_wallet",label:"Portefeuille crypto"},
  {id:"bank_account",label:"Compte bancaire"},{id:"other",label:"Autre"}
];
var REGIONS=[{id:"france",label:"France"},{id:"europe",label:"Europe"},{id:"etats_unis",label:"États-Unis"},{id:"monde",label:"Monde"},
  {id:"emergents",label:"Émergents"},{id:"japon",label:"Japon"},{id:"asie",label:"Asie"},{id:"autre",label:"Autre"}];
var RISK_PROFILES=[{id:"prudent",label:"Prudent"},{id:"modere",label:"Modéré"},{id:"dynamique",label:"Dynamique"},{id:"agressif",label:"Agressif"}];
var HORIZONS=[{id:"court",label:"Court terme"},{id:"moyen",label:"Moyen terme"},{id:"long",label:"Long terme"}];
var GRANULARITIES=["1d","1w","1M","snapshot"];
var SOURCE_STATES={connectee:"Connectée",degradee:"Dégradée",hors_ligne:"Hors ligne",obsolete:"Données obsolètes"};
var idsOf=function(a){return a.map(function(x){return x.id;});};
var ACC_IDS=idsOf(ACCOUNT_TYPES),REG_IDS=idsOf(REGIONS),RISK_IDS=idsOf(RISK_PROFILES),HOR_IDS=idsOf(HORIZONS);

/* ---------- Nettoyage des textes et nombres venus de l'extérieur ---------- */
/** Retire balises HTML (y compris une balise non refermée en fin de texte), caractères de contrôle (C0, C1) et marques
    de sens d'écriture (U+202A-202E, U+2066-2069), compacte les espaces, coupe à `max` caractères.
    « 1 < 3 » est conservé (un < suivi d'un espace ou d'un chiffre n'ouvre pas de balise). Le résultat reste à passer par esc() à l'affichage. */
function cleanText(s,max){
  if(typeof s!=="string"){if(typeof s!=="number"&&typeof s!=="boolean")return "";s=String(s);}   // objet, tableau → "" (String({toString:1}) lèverait)
  // Une balise commence par « < » suivi d'une lettre, « ! », « / » ou « ? » et va jusqu'au « > » (ou la fin) : « <3 % et >2 % » reste intact.
  // Remplacée par une espace, elle ne peut pas recoller un « < » à une lettre (« <</p>img » → « < img »).
  var t=s.replace(/<[A-Za-z!\/?][^>]*(>|$)/g," ").replace(/&nbsp;/gi," ")
    .replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]/g," ").replace(/\s+/g," ").trim();
  max=max||200;if(t.length>max){t=t.slice(0,max);if(/[\uD800-\uDBFF]$/.test(t))t=t.slice(0,-1);}   // jamais de demi-emoji
  return t;
}
/** Nombre fini ou null. Accepte "1 234,5" (format français), "1.234,5", "1.234.567" et "1,234.5".
    Un seul point sans virgule ("0.125", "1.500") est un séparateur décimal, jamais un séparateur de milliers.
    Le signe moins typographique (U+2212) vaut « - ». Chaîne vide ou blanche, "NaN", "Infinity", hexadécimal,
    tout ce qui n'est ni nombre ni chaîne (tableau [1,2], objet, booléen) → null. */
function num(v){
  if(typeof v==="number")return isFinite(v)?v:null;if(typeof v!=="string")return null;
  var s=v.replace(/\s/g,"").replace(/^\u2212/,"-");   // \s couvre aussi les espaces insécables (U+00A0, U+202F)
  if(!s)return null;
  if(/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)||/^-?[1-9]\d{0,2}(\.\d{3}){2,}$/.test(s))s=s.replace(/\./g,"").replace(",",".");
  else if(/^-?\d+(,\d+)$/.test(s))s=s.replace(",",".");
  else s=s.replace(/,(?=\d{3}(\D|$))/g,"");
  if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s))return null;
  var n=Number(s);return isFinite(n)?n:null;
}
/** Date "AAAA-MM-JJ" ou null. Nombre (ms) → jour UTC. "AAAA-MM-JJ…" → ce jour-là tel quel (même avec une heure et un décalage).
    "JJ/MM/AAAA" ou "JJ.MM.AAAA" → format français (jamais lu à l'américaine). Jour inexistant (30 février) → null.
    Autre texte : parseur de l'hôte, jour UTC si un fuseau est écrit, sinon jour local (pas de recul d'un jour à Paris). */
function ymd(y,m,d){var dim=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  return m>=1&&m<=12&&d>=1&&d<=dim[m-1]?y+"-"+(m<10?"0":"")+m+"-"+(d<10?"0":"")+d:null;}
function isoDate(v){
  if(Object.prototype.toString.call(v)==="[object Date]")v=v.getTime();
  if(typeof v==="number"){if(!isFinite(v))return null;var u=new Date(v);return isNaN(u.getTime())?null:u.toISOString().slice(0,10);}
  if(typeof v!=="string")return null;
  var s=v.trim(),m=/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s);if(m)return ymd(+m[1],+m[2],+m[3]);
  m=/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s);if(m)return ymd(+m[3],+m[2],+m[1]);
  var d=new Date(s);if(isNaN(d.getTime()))return null;
  return /(Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(s)?d.toISOString().slice(0,10):ymd(d.getFullYear(),d.getMonth()+1,d.getDate());
}
function pick(v,allowed,def){return allowed.indexOf(v)>=0?v:def;}
function upper(s,max){return cleanText(s,max||40).toUpperCase();}
var ISIN_RE=/^[A-Z]{2}[A-Z0-9]{9}\d$/;
/** Contrôle de la clé ISIN (algorithme de Luhn sur les chiffres convertis). */
function isinValid(isin){
  if(typeof isin!=="string"||!ISIN_RE.test(isin))return false;
  var digits=isin.split("").map(function(ch){return /[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;}).join("");
  var sum=0,dbl=false;for(var i=digits.length-1;i>=0;i--){var d=+digits[i];if(dbl){d*=2;if(d>9)d-=9;}sum+=d;dbl=!dbl;}return sum%10===0;
}
var BAD_KEYS=dict();["__proto__","constructor","prototype"].forEach(function(k){BAD_KEYS[k]=1;});
/** Copie un objet en ne gardant que les clés autorisées (jamais __proto__/constructor/prototype). */
function only(obj,keys){var o={};if(!obj||typeof obj!=="object")return o;keys.forEach(function(k){if(!BAD_KEYS[k]&&Object.prototype.hasOwnProperty.call(obj,k))o[k]=obj[k];});return o;}
/** Vrai si un objet (ou un de ses enfants, à toute profondeur) contient une clé dangereuse. Parcours itératif, sûr sur les cycles. */
function hasBadKeys(v){var st=[v],seen=new Set();
  while(st.length){var x=st.pop();if(!x||typeof x!=="object"||seen.has(x))continue;seen.add(x);
    var ks=Object.getOwnPropertyNames(x);for(var i=0;i<ks.length;i++){if(BAD_KEYS[ks[i]])return true;st.push(x[ks[i]]);}}return false;}
/** JSON.parse qui refuse les clés dangereuses. Renvoie {ok, value, error}. */
function safeJSON(text){try{var v=JSON.parse(String(text));if(hasBadKeys(v))return {ok:false,error:"Clé interdite dans le fichier (__proto__, constructor ou prototype)."};return {ok:true,value:v};}catch(e){return {ok:false,error:"Fichier JSON illisible."};}}

/* ---------- Modèles ---------- */
/**
 * @typedef {Object} Instrument
 * @property {string} id                 identifiant stable : "isin:LU1681043599", "crypto:BTC", "tv:TVC:GOLD"
 * @property {string} symbol             mnémonique affiché (CW8, BTC, GOLD)
 * @property {string} name
 * @property {string|null} isin
 * @property {AssetClass} asset_class    classe d'exposition
 * @property {string|null} sub_asset_class  précision libre (ex. "monde", "nasdaq100", "ETC physique")
 * @property {Vehicle} vehicle
 * @property {string|null} exchange      place de cotation (EURONEXT, XETR, NASDAQ…)
 * @property {string|null} mic           code MIC (XPAR, XAMS…)
 * @property {string|null} currency      devise de cotation (EUR, USD, GBX…)
 * @property {string|null} country       pays de l'émetteur (ou du domicile pour un fonds, cf. domicile)
 * @property {string|null} domicile      pays de domicile d'un fonds (≠ région d'exposition)
 * @property {string|null} sector        secteur (actions, ETF sectoriels) ; "diversifie" pour un ETF large
 * @property {string|null} region        zone d'EXPOSITION (france, europe, etats_unis, monde, emergents…)
 * @property {boolean|null} pea_eligible
 * @property {"eligible"|"eligible_regle"|"not_eligible"|"unknown"} pea_eligibility_status
 * @property {string|null} pea_source
 * @property {string|null} pea_last_checked_at   AAAA-MM-JJ
 * @property {"eligible"|"eligible_regle"|"not_eligible"|"unknown"} pea_pme_status
 * @property {string|null} alt_group     groupe d'instruments équivalents (sp500, msci_world…)
 * @property {number|null} ter           frais courants annuels en % (0,38 = 0,38 %)
 * @property {number|null} risk_level    SRI 1-7 du DIC
 * @property {number} leverage           1 = sans levier ; 2 = ×2 ; -1 = inverse
 * @property {string|null} launch_date
 * @property {string|null} delisted_at
 * @property {boolean} siic              foncière SIIC / REIT (exclue du PEA)
 * @property {boolean} preferred         action de préférence (exclue du PEA)
 * @property {{tv?:string,yahoo?:string,okx?:string,euronext?:string,binance?:string}} tickers
 * @property {string} data_source        provider principal : tvscan, crypto…
 * @property {boolean} is_active
 * @property {boolean} is_investable
 */
var INSTR_KEYS=["id","symbol","name","isin","asset_class","sub_asset_class","vehicle","exchange","mic","currency","country","domicile","sector","region",
  "pea_eligible","pea_eligibility_status","pea_source","pea_last_checked_at","pea_pme_status","pea_pme_source","alt_group","ter","risk_level","leverage",
  "launch_date","delisted_at","siic","preferred","tickers","data_source","is_active","is_investable","market_cap_eur","notes"];
var STATUS_IDS=["eligible","eligible_regle","not_eligible","unknown"];
/** @returns {Instrument} */
function normInstrument(raw){
  // ISIN : espaces et tirets retirés, puis 12 caractères exactement (jamais tronqué : "FR00001202711" n'est pas "FR0000120271").
  var r=only(raw||{},INSTR_KEYS),isin=upper(r.isin,40).replace(/[ -]/g,"")||null;if(isin&&!ISIN_RE.test(isin))isin=null;
  var vehicle=pick(r.vehicle,Object.keys(VH),"titre"),cls=clsId(r.asset_class)||"actions";
  // Code pays ISO à 2 lettres, sinon null : « Allemagne » ne devient pas « AL » (Albanie).
  var cc=function(v){v=upper(v,10);return /^[A-Z]{2}$/.test(v)?v:null;},mic=upper(r.mic,10);
  var t=r.tickers&&typeof r.tickers==="object"?only(r.tickers,["tv","yahoo","okx","euronext","binance"]):{};
  Object.keys(t).forEach(function(k){t[k]=cleanText(t[k],40)||undefined;if(!t[k])delete t[k];});
  var pst=pick(r.pea_eligibility_status,STATUS_IDS,"unknown");
  var o={
    id:cleanText(r.id,64)||(isin?"isin:"+isin:t.tv?"tv:"+t.tv:"x:"+cleanText(r.symbol,20)),
    symbol:upper(r.symbol,20),name:cleanText(r.name,120),isin:isin,
    asset_class:cls,sub_asset_class:cleanText(r.sub_asset_class,60)||null,vehicle:vehicle,
    exchange:upper(r.exchange,20)||null,mic:/^[A-Z0-9]{4}$/.test(mic)?mic:null,currency:upper(r.currency,4)||null,
    country:cc(r.country),domicile:cc(r.domicile),sector:cleanText(r.sector,60)||null,
    region:REG_IDS.indexOf(r.region)>=0?r.region:null,
    pea_eligible:pst==="eligible"||pst==="eligible_regle"?true:pst==="not_eligible"?false:null,
    pea_eligibility_status:pst,pea_source:cleanText(r.pea_source,200)||null,pea_last_checked_at:isoDate(r.pea_last_checked_at),
    pea_pme_status:pick(r.pea_pme_status,STATUS_IDS,"unknown"),pea_pme_source:cleanText(r.pea_pme_source,200)||null,
    alt_group:cleanText(r.alt_group,40)||null,ter:num(r.ter),risk_level:(function(x){x=num(x);return x>=1&&x<=7?Math.round(x):null;})(r.risk_level),
    leverage:num(r.leverage)||1,launch_date:isoDate(r.launch_date),delisted_at:isoDate(r.delisted_at),
    siic:r.siic===true,preferred:r.preferred===true,tickers:t,data_source:cleanText(r.data_source,20)||(cls==="crypto"||cls==="stablecoin"?"crypto":"tvscan"),
    is_active:r.is_active!==false,is_investable:VH[vehicle].investable&&(r.is_investable==null||r.is_investable===true),   // un indice ou un taux n'est jamais investissable
    market_cap_eur:num(r.market_cap_eur),notes:cleanText(r.notes,300)||null
  };
  return o;
}
/**
 * @typedef {Object} PriceBar
 * @property {string} instrument_id
 * @property {number} timestamp   ms UTC (clôture de la barre)
 * @property {number} open @property {number} high @property {number} low @property {number} close
 * @property {number|null} volume
 * @property {string|null} currency
 * @property {string} source
 * @property {"1d"|"1w"|"1M"|"snapshot"} granularity
 */
function normBar(raw,instrument_id,ccy,source,gran){
  var r=raw||{},ts=num(r.timestamp!=null?r.timestamp:r.t),c=num(r.close!=null?r.close:r.c);
  if(ts==null||c==null||c<=0)return null;
  var o=num(r.open!=null?r.open:r.o),h=num(r.high!=null?r.high:r.h),l=num(r.low!=null?r.low:r.l);
  o=o>0?o:c;h=h>0?h:Math.max(o,c);l=l>0?l:Math.min(o,c);
  if(h<Math.max(o,c))h=Math.max(o,c);if(l>Math.min(o,c))l=Math.min(o,c);
  return {instrument_id:instrument_id||cleanText(r.instrument_id,64)||null,timestamp:ts,open:o,high:h,low:l,close:c,volume:num(r.volume!=null?r.volume:r.v),
    currency:ccy||upper(r.currency,4)||null,source:source||cleanText(r.source,40),granularity:pick(gran||r.granularity,GRANULARITIES,"1d")};
}
/**
 * Cotation instantanée (affichage seulement : jamais utilisée par le moteur d'allocation ni le backtest).
 * @typedef {Object} Quote
 * @property {string} instrument_id @property {number|null} last @property {number|null} prev_close
 * @property {number|null} open @property {number|null} high @property {number|null} low
 * @property {number|null} volume @property {number|null} value_traded @property {number|null} change_pct
 * @property {{w:number|null,m1:number|null,m3:number|null,m6:number|null,y1:number|null,ytd:number|null}} perf
 * @property {string|null} currency @property {number} ts @property {number|null} delay_s
 * @property {string} source @property {boolean} stale
 */
function normQuote(raw){
  var r=raw||{},p=r.perf||{};
  return {instrument_id:cleanText(r.instrument_id,64)||null,last:num(r.last),prev_close:num(r.prev_close),open:num(r.open),high:num(r.high),low:num(r.low),
    volume:num(r.volume),value_traded:num(r.value_traded),change_pct:num(r.change_pct),
    perf:{w:num(p.w),m1:num(p.m1),m3:num(p.m3),m6:num(p.m6),y1:num(p.y1),ytd:num(p.ytd)},
    currency:upper(r.currency,4)||null,ts:num(r.ts)||0,delay_s:num(r.delay_s),source:cleanText(r.source,40),stale:r.stale===true,src:"scan"};
}
/**
 * @typedef {Object} Account
 * @property {string} id @property {string} name
 * @property {"PEA"|"PEA_PME"|"CTO"|"assurance_vie"|"crypto_wallet"|"bank_account"|"other"} account_type
 * @property {string} currency @property {number} cash_balance @property {number|null} total_value_eur
 * @property {string|null} broker @property {boolean} is_active
 * @property {string|null} opened_at      AAAA-MM-JJ (ancienneté PEA 5 ans, assurance-vie 8 ans)
 * @property {number|null} deposits_total versements cumulés (plafond PEA)
 */
function normAccount(raw){
  var r=only(raw||{},["id","name","account_type","currency","cash_balance","total_value_eur","broker","is_active","opened_at","deposits_total","manual_universe"]);
  return {id:cleanText(r.id,40)||null,name:cleanText(r.name,60)||"Compte",account_type:pick(r.account_type,ACC_IDS,"other"),
    currency:upper(r.currency,4)||"EUR",cash_balance:num(r.cash_balance)||0,total_value_eur:num(r.total_value_eur),broker:cleanText(r.broker,60)||null,
    is_active:r.is_active!==false,opened_at:isoDate(r.opened_at),deposits_total:num(r.deposits_total),
    manual_universe:Array.isArray(r.manual_universe)?r.manual_universe.slice(0,200).map(function(x){return cleanText(x,64);}).filter(Boolean):[]};
}
/**
 * @typedef {Object} Position
 * @property {string} account_id @property {string} instrument_id @property {number} quantity
 * @property {number|null} average_purchase_price @property {number|null} current_price
 * @property {number|null} market_value_eur @property {number|null} unrealized_pnl @property {number|null} realized_pnl
 * @property {AssetClass|null} asset_class @property {string|null} currency
 * @property {"PEA"|"PEA_PME"|"CTO"|"assurance_vie"|"crypto_wallet"|"bank_account"|"other"|null} account_type
 * @property {string|null} updated_at
 * @property {number|null} fx_rate_at_purchase  EUR pour 1 unité de la devise d'achat
 * @property {"marche"|"manuel"} price_source
 */
function normPosition(raw){
  var r=only(raw||{},["account_id","instrument_id","quantity","average_purchase_price","current_price","market_value_eur","unrealized_pnl","realized_pnl",
    "asset_class","currency","account_type","updated_at","fx_rate_at_purchase","price_source","manual_price"]);
  return {account_id:cleanText(r.account_id,40)||null,instrument_id:cleanText(r.instrument_id,64)||null,quantity:num(r.quantity)||0,
    average_purchase_price:num(r.average_purchase_price),current_price:num(r.current_price),market_value_eur:num(r.market_value_eur),
    unrealized_pnl:num(r.unrealized_pnl),realized_pnl:num(r.realized_pnl),asset_class:clsId(r.asset_class),
    currency:upper(r.currency,4)||null,account_type:ACC_IDS.indexOf(r.account_type)>=0?r.account_type:null,updated_at:isoDate(r.updated_at),
    fx_rate_at_purchase:num(r.fx_rate_at_purchase),price_source:r.price_source==="manuel"?"manuel":"marche",manual_price:num(r.manual_price)};
}
/** @typedef {Object} Transaction  achat, vente, dividende, versement, retrait, frais */
var TX_TYPES=["achat","vente","dividende","versement","retrait","frais"];
function normTransaction(raw){
  var r=only(raw||{},["id","account_id","instrument_id","date","type","quantity","price","fees","currency","fx_rate"]);
  return {id:cleanText(r.id,40)||null,account_id:cleanText(r.account_id,40)||null,instrument_id:cleanText(r.instrument_id,64)||null,
    date:isoDate(r.date),type:pick(r.type,TX_TYPES,"achat"),quantity:num(r.quantity)||0,price:num(r.price),fees:num(r.fees)||0,
    currency:upper(r.currency,4)||"EUR",fx_rate:num(r.fx_rate)};
}
/**
 * Préférences d'investissement. Tant que `saved` est faux, aucune proposition n'est calculée.
 * @typedef {Object} InvestmentPrefs
 */
function defaultPrefs(){
  var classes={};CLASSES.forEach(function(c){classes[c.id]=false;});
  var vehicles={};VEHICLES.forEach(function(v){if(v.investable)vehicles[v.id]=false;});
  return {v:1,saved:false,classes:classes,vehicles:vehicles,pea_mode:"off",pea_filter:"tous",risk_profile:"modere",horizon:"long",
    monthly_contribution_eur:0,contribution_split:{},
    limits:{max_par_classe:{},max_par_instrument:20,max_crypto:10,min_liquidites:0,max_turnover_mensuel:20,bande_inaction_pp:2,risque_max_sri:null,levier_autorise:false},
    filters:{regions:[],devises:[],secteurs:[]},fiscal:{pfu_par_defaut:true,tmi:null}};
}
function pct(v,lo,hi,def){v=num(v);return v==null?def:Math.min(hi,Math.max(lo,v));}
function normPrefs(raw){
  var d=defaultPrefs(),r=raw&&typeof raw==="object"&&!hasBadKeys(raw)?raw:{};
  var classes={};CLASSES.forEach(function(c){classes[c.id]=!!(r.classes&&r.classes[c.id]===true);});
  var vehicles={};Object.keys(d.vehicles).forEach(function(k){vehicles[k]=!!(r.vehicles&&r.vehicles[k]===true);});
  var L=r.limits||{},mpc={};Object.keys(L.max_par_classe||{}).forEach(function(k){if(CL[k])mpc[k]=pct(L.max_par_classe[k],0,100,100);});
  var arr=function(a,ok){return Array.isArray(a)?a.filter(function(x){return ok(x);}).slice(0,50):[];};
  var cs=r.contribution_split,split={};   // objet {compte: %} seulement (pas une chaîne ni un tableau), 50 comptes au plus
  if(cs&&typeof cs==="object"&&!Array.isArray(cs))Object.keys(cs).slice(0,50).forEach(function(k){var kk=cleanText(k,40);if(kk&&!BAD_KEYS[kk])split[kk]=pct(cs[k],0,100,0);});
  return {v:1,saved:r.saved===true,classes:classes,vehicles:vehicles,
    pea_mode:pick(r.pea_mode,["off","prioritaire","strict"],d.pea_mode),pea_filter:pick(r.pea_filter,["tous","eligibles","eligibles_a_verifier"],d.pea_filter),
    risk_profile:pick(r.risk_profile,RISK_IDS,d.risk_profile),horizon:pick(r.horizon,HOR_IDS,d.horizon),
    monthly_contribution_eur:Math.max(0,num(r.monthly_contribution_eur)||0),contribution_split:split,
    limits:{max_par_classe:mpc,max_par_instrument:pct(L.max_par_instrument,1,100,d.limits.max_par_instrument),max_crypto:pct(L.max_crypto,0,100,d.limits.max_crypto),
      min_liquidites:pct(L.min_liquidites,0,100,0),max_turnover_mensuel:pct(L.max_turnover_mensuel,0,100,d.limits.max_turnover_mensuel),
      bande_inaction_pp:pct(L.bande_inaction_pp,0,20,d.limits.bande_inaction_pp),risque_max_sri:(function(x){x=num(x);return x>=1&&x<=7?Math.round(x):null;})(L.risque_max_sri),
      levier_autorise:L.levier_autorise===true},
    filters:{regions:arr((r.filters||{}).regions,function(x){return REG_IDS.indexOf(x)>=0;}),devises:arr((r.filters||{}).devises,function(x){return typeof x==="string"&&/^[A-Z]{3}$/.test(x);}),
      secteurs:arr((r.filters||{}).secteurs,function(x){return typeof x==="string"&&x.length<60;}).map(function(x){return cleanText(x,60);})},
    fiscal:{pfu_par_defaut:(r.fiscal||{}).pfu_par_defaut!==false,tmi:pct((r.fiscal||{}).tmi,0,45,null)}};
}

/* ---------- Garde-fou unique : un instrument hors des classes ou véhicules cochés n'est JAMAIS proposé ----------
   Utilisé par l'allocation, la sélection, le screener mensuel, les alternatives et le backtest.
   Renvoie true/false ; CK.allow.why(instr, prefs) donne le motif en français. */
function allowWhy(instr,prefs){
  if(!instr)return "Instrument inconnu.";
  // Le véhicule est relu dans la table : un objet brut {vehicle:"indice", is_investable:true} reste refusé.
  var vh=typeof instr.vehicle==="string"?VH[instr.vehicle]:null;
  if(instr.is_investable!==true||(vh&&!vh.investable))return "Non investissable (indice ou taux).";
  if(instr.is_active===false)return "Instrument inactif.";
  if(!prefs||!prefs.classes||!prefs.vehicles)return "Préférences absentes.";
  if(!isClassAllowed(instr.asset_class,prefs.classes)){var p=classAncestors(instr.asset_class).filter(function(x){return prefs.classes[x]!==true;});
    return "Hors de tes classes : "+(CL[instr.asset_class]?CL[instr.asset_class].label:instr.asset_class)+(p.length?" (classe parente non cochée : "+p.map(function(x){return CL[x].label;}).join(", ")+")":"")+".";}
  if(!vh)return "Type de produit inconnu.";
  if(prefs.vehicles[instr.vehicle]!==true)return "Type non coché : "+vh.label+".";
  if(!(prefs.limits&&prefs.limits.levier_autorise===true)&&instr.leverage!=null&&instr.leverage!==1)return "Produit à levier ou inverse non autorisé.";
  // Comparaison numérique (des chaînes "10" > "4" seraient comparées comme du texte)
  var sri=num(prefs.limits&&prefs.limits.risque_max_sri),rl=num(instr.risk_level);if(sri&&rl&&rl>sri)return "Niveau de risque "+rl+"/7 au-dessus de ton maximum ("+sri+"/7).";
  return "";
}
function allow(instr,prefs){return allowWhy(instr,prefs)==="";}
allow.why=allowWhy;
CK.allow=allow;

/* ---------- Référentiel des instruments (referentiel.json) ---------- */
/* BY : identifiants propres ; AL : alias "isin:…" et "tv:…". Séparés pour qu'un alias (ISIN partagé par deux cotations)
   ne fasse jamais prendre pour un doublon l'instrument dont c'est l'identifiant réel. */
var REF=null,BY=dict(),AL=dict();
function refLoad(list){
  REF=[];BY=dict();AL=dict();(Array.isArray(list)?list:[]).forEach(function(raw){var i=normInstrument(raw);if(BY[i.id])return;REF.push(i);BY[i.id]=i;
    if(i.isin&&!AL["isin:"+i.isin])AL["isin:"+i.isin]=i;if(i.tickers.tv&&!AL["tv:"+i.tickers.tv])AL["tv:"+i.tickers.tv]=i;});
  return REF;
}
function refKey(k){refAll();return BY[k]||AL[k]||null;}
function refAll(){if(!REF){var d=data("referentiel");refLoad(d&&d.instruments||[]);}return REF;}
var norm=function(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");};
CK.ref={
  load:refLoad,
  all:refAll,
  get:function(id){return typeof id==="string"?refKey(id):null;},
  byIsin:function(isin){return typeof isin==="string"?refKey("isin:"+isin.trim().toUpperCase()):null;},
  byTv:function(sym){return typeof sym==="string"?refKey("tv:"+sym):null;},
  /** Recherche texte (nom, symbole, ISIN) + filtres {asset_class, vehicle, region, currency, investable}. */
  search:function(q,f){q=norm(q);f=f||{};return refAll().filter(function(i){
    if(f.asset_class&&i.asset_class!==f.asset_class&&classAncestors(i.asset_class).indexOf(f.asset_class)<0)return false;
    if(f.vehicle&&i.vehicle!==f.vehicle)return false;if(f.region&&i.region!==f.region)return false;if(f.currency&&i.currency!==f.currency)return false;
    if(f.investable!=null&&i.is_investable!==f.investable)return false;
    return !q||norm(i.name).indexOf(q)>=0||norm(i.symbol).indexOf(q)>=0||norm(i.isin).indexOf(q)>=0;});}
};

/* ---------- Validation (pour l'import et les tests) ---------- */
function validateInstrument(i){var e=[];if(!i||typeof i!=="object")return {ok:false,errors:["instrument absent"]};
  var t=i.tickers&&typeof i.tickers==="object"?i.tickers:{};
  if(!i.id)e.push("id manquant");if(!i.name)e.push("nom manquant");if(i.isin&&!isinValid(i.isin))e.push("ISIN invalide ("+cleanText(i.isin,20)+")");
  if(!clsId(i.asset_class))e.push("classe inconnue");if(typeof i.vehicle!=="string"||!VH[i.vehicle])e.push("véhicule inconnu");
  if(i.is_investable&&!t.tv&&!t.okx&&!t.binance&&!t.yahoo)e.push("aucun ticker pour obtenir un cours");return {ok:!e.length,errors:e};}

CK.models={
  CLASSES:CLASSES,VEHICLES:VEHICLES,PEA_STATUS:PEA_STATUS,PEA_PME_STATUS:PEA_PME_STATUS,ACCOUNT_TYPES:ACCOUNT_TYPES,REGIONS:REGIONS,
  RISK_PROFILES:RISK_PROFILES,HORIZONS:HORIZONS,SOURCE_STATES:SOURCE_STATES,TX_TYPES:TX_TYPES,DISCLAIMER:DISCLAIMER,
  classLabel:function(id){return CL[id]?CL[id].label:id;},vehicleLabel:function(id){return VH[id]?VH[id].label:id;},
  classAncestors:classAncestors,classChildren:classChildren,isClassAllowed:isClassAllowed,
  cleanText:cleanText,num:num,isoDate:isoDate,isinValid:isinValid,only:only,hasBadKeys:hasBadKeys,safeJSON:safeJSON,
  normInstrument:normInstrument,normBar:normBar,normQuote:normQuote,normAccount:normAccount,normPosition:normPosition,normTransaction:normTransaction,
  defaultPrefs:defaultPrefs,normPrefs:normPrefs,validateInstrument:validateInstrument,
  data:data,setData:function(k,v){if(typeof k!=="string"||BAD_KEYS[k])return;CK.DATA[k]=v;if(k==="referentiel")REF=null;}
};
})();
