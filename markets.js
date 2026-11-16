/* ================================================================
   COCKPIT — Espace « Marchés » (phase 2) : CK.mk
   Bandeau (indices, or, argent, pétrole), tableau par onglet (Indices · Actions · ETF ·
   Obligations & taux · Matières premières · Devises), fiche instrument avec badge PEA,
   source, date et correction. Rien n'est chargé avant la première ouverture de l'espace :
   un seul abonnement CK.mkt (1 appel groupé au scanner par minute, onglet visible),
   arrêté quand on quitte l'espace.
   Les fonctions de calcul et de rendu HTML (CK.mk._t) n'utilisent pas le DOM : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

/* ---------- Petits outils (CK.u si présent) ---------- */
function U(){return CK.u||{};}
function esc(s){var f=U().esc;return f?f(s):String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function nf(v,d){if(v==null||!isFinite(v))return "—";return Number(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});}
function pct(v,d){if(v==null||!isFinite(v))return "—";d=d==null?2:d;var r=Math.abs(v)<Math.pow(10,-d)/2?0:v;return (r>0?"+":r<0?"−":"")+nf(Math.abs(r),d)+" %";}
function safeUrl(s){var f=U().safeUrl;if(f)return f(s);s=String(s==null?"":s).trim();return /^https?:\/\//i.test(s)?s:"#";}
function fin(x){return typeof x==="number"&&isFinite(x)?x:null;}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function hhmm(ts){try{return new Date(ts).toLocaleTimeString("fr-FR",{timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit"});}catch(e){return "";}}
function dday(ts){try{return new Date(ts).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit"});}catch(e){return "";}}
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function M(){return CK.models||{};}
function ref(){return CK.ref&&CK.ref.all?CK.ref.all():[];}
function dict(){return Object.create(null);}
function disclaimer(){return CK.DISCLAIMER||M().DISCLAIMER||"";}

/* ---------- Onglets et groupes ---------- */
var TABS=[
  {id:"indices",label:"Indices"},{id:"actions",label:"Actions"},{id:"etf",label:"ETF"},
  {id:"taux",label:"Obligations & taux"},{id:"mp",label:"Matières premières"},{id:"devises",label:"Devises"}
];
var TAB_IDS=TABS.map(function(t){return t.id;});
var COMMO={matieres_premieres:1,or:1,argent:1,energie:1,petrole:1,gaz:1,agricole:1};
var BONDS={obligations:1,oblig_etat:1,oblig_entreprise:1};
var REG=dict();(M().REGIONS||[]).forEach(function(r){REG[r.id]=r.label;});
function regLabel(id){return REG[id]||(id==="zone_euro"?"Zone euro":"")||"";}

/** Onglet d'un instrument, ou null (la crypto au comptant reste dans les espaces crypto). */
function tabOf(i){
  if(!i||i.is_active===false)return null;var c=i.asset_class,v=i.vehicle;
  if(v==="spot_crypto"||v==="cash")return null;
  if(c==="devises")return "devises";
  if(v==="taux"||BONDS[c])return "taux";
  if(COMMO[c])return "mp";
  if(v==="indice")return "indices";
  if(v==="titre")return "actions";
  if(v==="etf"||v==="etc_etn"||v==="fonds")return "etf";
  return null;
}
/** Groupe affiché dans l'onglet (titre de section du tableau). */
function groupOf(i,tab){
  var c=i.asset_class,v=i.vehicle,r=regLabel(i.region);
  switch(tab||tabOf(i)){
    case "indices":return i.symbol==="VIX"?"Volatilité":r||"Autres";
    case "actions":return c==="immobilier_cote"?"Immobilier coté (foncières)":r||"Autres";
    case "etf":return c==="liquidites"?"Monétaire":c==="crypto"?"Crypto (ETN)":"ETF actions · "+(r||"autres");
    case "taux":return v==="taux"?"Rendements d'État (indicatifs, non investissables)":"ETF obligataires";
    case "mp":return v==="indice"?"Cours de référence (non investissables)":"ETC et ETF (investissables)";
    case "devises":return "Taux de change";
  }
  return "Autres";
}
/** Rang d'un groupe : repères d'abord, produits annexes (monétaire, crypto, foncières, volatilité) à la fin ; sinon ordre du référentiel. */
function grank(k){return /^Rendements|^Cours de référence/.test(k)?0:/^Monétaire|^Immobilier/.test(k)?80:/^Crypto/.test(k)?85:/^Volatilité/.test(k)?90:50;}
/** Instruments d'un onglet, dans l'ordre du référentiel. */
function listTab(tab,all){return (all||ref()).filter(function(i){return tabOf(i)===tab;});}
/** Tous les instruments affichés par l'espace (pour l'abonnement unique). */
function allIds(all){return (all||ref()).filter(function(i){return tabOf(i)!=null;}).map(function(i){return i.id;});}

/* ---------- Filtre PEA (tous / éligibles / éligibles + à vérifier) ----------
   Les indices, taux et cours de référence (non investissables) restent visibles : ce sont des repères. */
var PEAF=[{id:"tous",label:"Tous"},{id:"eligibles",label:"Éligibles PEA"},{id:"verifier",label:"+ à vérifier"}];
function peaStatus(i){return CK.pea&&CK.pea.status?CK.pea.status(i):{status:"unknown",label:"Éligibilité à vérifier",source:null,checked_at:null,reason:"",by:"inconnu"};}
function peaPass(i,f){
  if(!f||f==="tous"||!i.is_investable)return true;
  var s=peaStatus(i).status;
  return s==="eligible"||s==="eligible_regle"||(f==="verifier"&&s==="unknown");
}

/* ---------- Format des prix et variations ---------- */
function isYield(i){return !!i&&i.vehicle==="taux";}
function decOf(i,v){
  if(isYield(i))return 3;
  if(i&&i.asset_class==="devises")return /JPY/.test(i.symbol||"")?2:4;
  var a=Math.abs(v||0);return a>=1||!a?2:a>=0.01?4:6;
}
function fmtPx(i,v){if(v==null||!isFinite(v))return "—";var s=nf(v,decOf(i,v));return isYield(i)?s+" %":s;}
/** Variation du jour : en % pour un prix, en points de base pour un rendement (le « change » du scanner serait un % du taux). */
function chg(i,q){
  if(!q)return null;
  if(isYield(i)){var l=fin(q.last),p=fin(q.prev_close);return l==null||p==null?null:{v:(l-p)*100,u:"pb"};}
  var c=fin(q.change_pct);return c==null?null:{v:c,u:"%"};
}
function fmtChg(c){
  if(!c||c.v==null||!isFinite(c.v))return "—";
  if(c.u==="pb"){var r=Math.round(c.v*10)/10;return (r>0?"+":r<0?"−":"")+nf(Math.abs(r),1)+" pb";}
  return pct(c.v,2);
}
function cl(v){return v>0?"up":v<0?"down":"";}
function fmtVol(v){if(v==null||!isFinite(v)||v<=0)return "—";var a=Math.abs(v);
  return a>=1e9?nf(v/1e9,1)+" Md":a>=1e6?nf(v/1e6,1)+" M":a>=1e3?nf(v/1e3,0)+" k":nf(v,0);}
/** Retard d'une cotation, en mots. */
function delayTxt(q){
  if(!q)return "";if(q.stale)return "obsolète";var d=fin(q.delay_s);
  if(d==null)return "";if(d<=0)return "temps réel";if(d<120)return "différé "+Math.round(d)+" s";return "différé "+Math.round(d/60)+" min";
}
/** Marché du calendrier (CK.cal) d'un instrument, ou null (devises, matières premières, LSE…). */
var MKT={EURONEXT:"euronext",XETR:"xetra",NASDAQ:"nyse",NYSE:"nyse",AMEX:"nyse",SP:"nyse",DJ:"nyse"};
function marketOf(i){return i&&i.exchange&&MKT[i.exchange]||null;}

/* ---------- Écarts de taux ---------- */
var SPREADS=[
  {label:"OAT − Bund 10 ans",a:"tv:TVC:FR10Y",b:"tv:TVC:DE10Y",tip:"Prime de risque de la France face à l'Allemagne"},
  {label:"BTP − Bund 10 ans",a:"tv:TVC:IT10Y",b:"tv:TVC:DE10Y",tip:"Prime de risque de l'Italie face à l'Allemagne"},
  {label:"France 10 ans − 2 ans",a:"tv:TVC:FR10Y",b:"tv:TVC:FR02Y",tip:"Pente de la courbe française"},
  {label:"États-Unis 10 ans − 2 ans",a:"tv:TVC:US10Y",b:"tv:TVC:US02Y",tip:"Pente de la courbe américaine (négative = inversée)"}
];
/** Écarts en points de base et leur variation du jour, depuis les cotations Q (id → Quote). */
function spreads(Q){
  return SPREADS.map(function(s){var a=Q[s.a],b=Q[s.b],la=a&&fin(a.last),lb=b&&fin(b.last),pa=a&&fin(a.prev_close),pb=b&&fin(b.prev_close);
    var v=la!=null&&lb!=null?(la-lb)*100:null,d=v!=null&&pa!=null&&pb!=null?v-(pa-pb)*100:null;
    return {label:s.label,tip:s.tip,v:v,d:d};});
}

/* ---------- Bandeau ---------- */
var STRIP=[
  {id:"tv:EURONEXT:PX1",n:"CAC 40"},{id:"tv:SP:SPX",n:"S&P 500"},{id:"tv:NASDAQ:NDX",n:"Nasdaq 100"},{id:"tv:NASDAQ:IXIC",n:"Nasdaq Composite"},
  {id:"tv:DJ:DJI",n:"Dow Jones"},{id:"tv:TVC:GOLD",n:"Or"},{id:"tv:TVC:SILVER",n:"Argent"},{id:"tv:FX:USOIL",n:"Pétrole WTI"},
  {id:"tv:FX:UKOIL",n:"Pétrole Brent"},{id:"tv:NYMEX:NG1!",n:"Gaz naturel",gaz:true}
];
function stripItems(gaz){return STRIP.filter(function(s){return !s.gaz||gaz;});}
function gazOn(){var c=CK.cfg?CK.cfg():{};return !!(c&&c.marches&&c.marches.gaz);}
/** Position du dernier cours dans la fourchette du jour (0 à 1), ou null. */
function rangePos(q){var h=q&&fin(q.high),l=q&&fin(q.low),x=q&&fin(q.last);if(h==null||l==null||x==null||h<=l)return null;return Math.max(0,Math.min(1,(x-l)/(h-l)));}
function stripHTML(Q,gaz){
  return stripItems(gaz).map(function(s){
    var i=CK.ref&&CK.ref.get?CK.ref.get(s.id):null,q=Q[s.id],c=chg(i,q),rp=rangePos(q);
    return '<button type="button" class="mk-tile" data-mk-id="'+esc(s.id)+'" title="'+esc((i&&i.name)||s.n)+' · ouvrir la fiche">'+
      '<span class="mk-tn">'+esc(s.n)+'</span>'+
      '<b class="mk-tp">'+(q?fmtPx(i,q.last):'<i class="mk-sk"></i>')+'</b>'+
      '<span class="mk-tc '+cl(c&&c.v)+'">'+fmtChg(c)+'</span>'+
      '<span class="mk-rg" aria-hidden="true">'+(rp!=null?'<i style="left:'+(rp*100).toFixed(1)+'%"></i>':'')+'</span>'+
      '<span class="mk-tm">'+(q?esc(q.currency||"")+(q.stale?' · <em class="warn">obsolète</em>':''):'')+'</span></button>';
  }).join("");
}

/* ---------- Badge PEA ---------- */
var PEA_UI={eligible:["ok","PEA"],eligible_regle:["rule","PEA (règle)"],not_eligible:["no","Non PEA"],unknown:["unk","À vérifier"]};
function peaBadge(i){
  if(!i.is_investable)return '<span class="mk-pea na" title="Non investissable (repère)">—</span>';
  var s=peaStatus(i),m=PEA_UI[s.status]||PEA_UI.unknown;
  var t=s.label+(s.source?" · source : "+s.source:"")+(s.checked_at?" · vérifié le "+frDate(s.checked_at):"");
  return '<span class="mk-pea '+m[0]+'" title="'+esc(t)+'">'+esc(m[1])+(s.by==="utilisateur"?' <i aria-label="corrigé par toi">✎</i>':'')+'</span>';
}

/* ---------- Tableau ---------- */
var COLS=[
  {k:"name",t:"Instrument"},{k:"last",t:"Cours",r:1},{k:"chg",t:"Jour",r:1},{k:"w",t:"1 sem",r:1},{k:"m1",t:"1 mois",r:1},
  {k:"m3",t:"3 mois",r:1},{k:"m6",t:"6 mois",r:1},{k:"y1",t:"1 an",r:1},{k:"ytd",t:"Depuis jan.",r:1},{k:"rg",t:"Séance",nos:1},
  {k:"vol",t:"Volume",r:1},{k:"pea",t:"PEA"},{k:"zone",t:"Zone · secteur"},{k:"maj",t:"Mise à jour",nos:1}
];
var PEA_RANK={eligible:0,eligible_regle:1,unknown:2,not_eligible:3};
function sortVal(i,q,k){
  if(k==="name")return (i.symbol||i.name||"").toLowerCase();
  if(k==="pea")return i.is_investable?PEA_RANK[peaStatus(i).status]:9;
  if(k==="zone")return (regLabel(i.region)+" "+(i.sector||i.sub_asset_class||"")).toLowerCase();
  if(!q)return null;
  if(k==="last")return fin(q.last);
  if(k==="chg"){var c=chg(i,q);return c?c.v:null;}
  if(k==="vol")return fin(q.value_traded)!=null?q.value_traded:fin(q.volume);
  if(isYield(i))return null;
  return q.perf?fin(q.perf[k]):null;
}
/** Tri stable ; les valeurs absentes vont toujours en bas. */
function sortList(list,Q,k,dir){
  var d=dir<0?-1:1;
  return list.map(function(i,n){return {i:i,n:n,v:sortVal(i,Q[i.id],k)};}).sort(function(a,b){
    var x=a.v,y=b.v;if(x==null&&y==null)return a.n-b.n;if(x==null)return 1;if(y==null)return -1;
    return (x<y?-1:x>y?1:0)*d||a.n-b.n;}).map(function(o){return o.i;});
}
function perfCell(i,q,k){if(isYield(i)||!q||!q.perf)return '<td class="r mk-dim">—</td>';var v=fin(q.perf[k]);return '<td class="r '+cl(v)+'">'+pct(v,1)+'</td>';}
function rowHTML(i,q){
  var c=chg(i,q),rp=rangePos(q),vol=q?(fin(q.value_traded)!=null&&q.value_traded>0?q.value_traded:q.volume):null;
  var zone=[regLabel(i.region),i.sector||(i.vehicle!=="titre"?i.sub_asset_class:"")].filter(Boolean).join(" · ");
  var t=[i.name,i.isin?"ISIN "+i.isin:"",M().vehicleLabel?M().vehicleLabel(i.vehicle):i.vehicle].filter(Boolean).join(" · ");
  return '<tr class="clk mk-row'+(q&&q.stale?" mk-stale":"")+'" data-mk-id="'+esc(i.id)+'" tabindex="0">'+
    '<td class="mk-nm" title="'+esc(t)+'"><b>'+esc(i.symbol||"")+'<em>'+esc([i.exchange,i.currency].filter(Boolean).join(" · "))+'</em></b><span>'+esc(i.name||"")+'</span></td>'+
    '<td class="r mk-px">'+(q?fmtPx(i,q.last):'<i class="mk-sk"></i>')+'</td>'+
    '<td class="r '+cl(c&&c.v)+'">'+fmtChg(c)+'</td>'+
    perfCell(i,q,"w")+perfCell(i,q,"m1")+perfCell(i,q,"m3")+perfCell(i,q,"m6")+perfCell(i,q,"y1")+perfCell(i,q,"ytd")+
    '<td class="mk-rgc">'+(rp!=null?'<span class="mk-rg" title="Bas '+esc(fmtPx(i,q.low))+' · haut '+esc(fmtPx(i,q.high))+'"><i style="left:'+(rp*100).toFixed(1)+'%"></i></span>':'<span class="mk-dim">—</span>')+'</td>'+
    '<td class="r">'+fmtVol(vol)+'</td>'+
    '<td>'+peaBadge(i)+'</td>'+
    '<td class="mk-zone">'+esc(zone||"—")+'</td>'+
    '<td class="mk-maj">'+(q?esc(hhmm(q.ts))+' <em class="'+(q.stale?"warn":"")+'">'+esc(delayTxt(q))+'</em>':'<span class="mk-dim">en attente</span>')+'</td></tr>';
}
/** Corps du tableau : groupes (ordre du référentiel) si aucun tri, sinon liste triée à plat. */
function tableHTML(list,Q,sort){
  var head='<thead><tr>'+COLS.map(function(c){var on=sort&&sort.k===c.k;
      return '<th'+(c.r?' class="r"':'')+(c.nos?'':' data-mk-sort="'+c.k+'"')+(on?' aria-sort="'+(sort.dir<0?"descending":"ascending")+'"':'')+'>'+esc(c.t)+(on?'<span class="ar">'+(sort.dir<0?"▼":"▲")+'</span>':'')+'</th>';}).join("")+'</tr></thead>';
  if(!list.length)return '<table class="scan mk-table">'+head+'<tbody><tr><td colspan="'+COLS.length+'" class="mk-empty">Aucun instrument ne correspond.</td></tr></tbody></table>';
  var body="";
  if(sort&&sort.k){body=sortList(list,Q,sort.k,sort.dir).map(function(i){return rowHTML(i,Q[i.id]);}).join("");}
  else{var g=[],by=dict();list.forEach(function(i){var k=groupOf(i);if(!by[k]){by[k]=[];g.push(k);}by[k].push(i);});
    g=g.map(function(k,n){return {k:k,n:n,r:grank(k)};}).sort(function(a,b){return a.r-b.r||a.n-b.n;}).map(function(o){return o.k;});
    body=g.map(function(k){return '<tr class="mk-grp"><th colspan="'+COLS.length+'">'+esc(k)+' <em>'+by[k].length+'</em></th></tr>'+by[k].map(function(i){return rowHTML(i,Q[i.id]);}).join("");}).join("");}
  return '<table class="scan mk-table">'+head+'<tbody>'+body+'</tbody></table>';
}
/** Recherche : nom, symbole, ISIN, dans tous les onglets. */
function norm(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function matches(i,q){q=norm(q).trim();if(!q)return true;return norm(i.name).indexOf(q)>=0||norm(i.symbol).indexOf(q)>=0||norm(i.isin).indexOf(q)>=0;}
function visible(tab,query,peaf,all){
  all=all||ref();
  return all.filter(function(i){var t=tabOf(i);return t!=null&&(query?matches(i,query):t===tab)&&peaPass(i,peaf);});
}

/* ---------- Pastille d'état de la source ---------- */
var ST_CLS={connectee:"ok",degradee:"warn",obsolete:"warn",hors_ligne:"down",inactif:"idle"};
function srcHTML(st,Q,ids){
  st=st||{};var k=ST_CLS[st.state]||"idle",last=0,delays=dict();
  (ids||[]).forEach(function(id){var q=Q[id];if(!q)return;if(q.ts>last)last=q.ts;var d=delayTxt(q);if(d)delays[d]=1;});
  var dl=Object.keys(delays).filter(function(d){return d!=="obsolète";}).join(" / ");
  var txt=(st.label||"En attente")+(st.paused?" · en pause":"")+(dl?" · "+dl:"")+(last?" · cours de "+hhmm(last):"");
  return '<span class="mk-src '+k+'" title="'+esc("TradingView (scanner public)"+(st.msg?" · "+st.msg:""))+'"><i></i>'+esc(txt)+'</span>';
}

/* ---------- Taux de change BCE (onglet Devises) ---------- */
var FX_LIST=["USD","GBP","CHF","JPY","CAD","AUD","SEK","NOK","DKK","PLN","CNY","HKD","SGD"];
function fixingsHTML(){
  var F=CK.fx;if(!F||!F.fixing)return "";var rows=FX_LIST.map(function(c){var f=F.fixing(c);return f&&f.rate>0?{c:c,v:1/f.rate,d:f.date}:null;}).filter(Boolean);
  if(!rows.length)return '<p class="mk-note">Fixings de la BCE en cours de chargement…</p>';
  return '<div class="mk-fx"><h4>Fixings de référence de la BCE <em>1 EUR = … · '+esc(frDate(rows[0].d))+'</em></h4><div class="mk-fxg">'+
    rows.map(function(r){return '<span><em>'+esc(r.c)+'</em><b>'+nf(r.v,r.v>=100?2:4)+'</b></span>';}).join("")+'</div></div>';
}
function spreadsHTML(Q){
  return '<div class="mk-spr"><h4>Écarts de taux <em>en points de base</em></h4><div class="mk-sprg">'+spreads(Q).map(function(s){
    return '<span title="'+esc(s.tip)+'"><em>'+esc(s.label)+'</em><b>'+(s.v==null?"—":nf(s.v,0)+" pb")+'</b><i class="'+cl(s.d)+'">'+(s.d==null?"":(s.d>0?"+":s.d<0?"−":"")+nf(Math.abs(s.d),1)+" pb")+'</i></span>';}).join("")+'</div></div>';
}
var NOTES={
  taux:"Obligations individuelles : cours non disponibles gratuitement. Exposition via ETF obligataires. Rendements d'État indicatifs, non investissables.",
  mp:"Les cours de référence (or, argent, pétrole, gaz) sont en dollars et non investissables. Les ETC sont des titres de créance : non éligibles au PEA.",
  indices:"Un indice n'est pas investissable directement : on l'achète au travers d'un ETF (onglet ETF).",
  etf:"Le statut PEA vient du référentiel (source et date sur chaque fiche). Un fonds n'est jamais déclaré éligible par déduction.",
  actions:"Action d'une société de l'UE ou de l'EEE : éligible au PEA selon la règle, à confirmer chez ton courtier. Les foncières SIIC sont exclues.",
  devises:"Cours TradingView en continu ; la conversion en euros du Desk utilise les fixings de la BCE."
};

/* ---------- Fiche instrument ---------- */
function kv(k,v,cls){return v==null||v===""?"":'<div'+(cls?' class="'+cls+'"':'')+'><dt>'+esc(k)+'</dt><dd>'+v+'</dd></div>';}
function peaBlock(i){
  if(!i.is_investable)return '<div class="mk-peab na"><b>Non investissable</b><p>Un indice, un taux ou un cours de référence ne s\'achète pas directement.</p></div>';
  var s=peaStatus(i),m=PEA_UI[s.status]||PEA_UI.unknown,src=s.source||"",mu=/https?:\/\/[^\s"'<>»]+/.exec(src),url=mu?safeUrl(mu[0]):"#",link=url!=="#";
  var srcTxt=src.replace(/https?:\/\/\S+/g,"").replace(/[\s,·:]+$/,"").trim();
  var pme=CK.pea&&CK.pea.pmeStatus?CK.pea.pmeStatus(i):null;
  var alts=s.status==="eligible"||s.status==="eligible_regle"||!CK.pea||!CK.pea.alternatives?[]:CK.pea.alternatives(i);
  return '<div class="mk-peab '+m[0]+'"><div class="mk-peah"><span class="mk-pea '+m[0]+'">'+esc(m[1])+'</span><b>'+esc(s.label)+'</b>'+
      '<button type="button" class="btn sm" data-mk-fix="'+esc(i.id)+'">Corriger</button></div>'+
    '<p>'+esc(s.reason||"")+'</p>'+
    '<dl class="mk-kv">'+kv("Source",src?esc(srcTxt||src.slice(0,80))+(link?' <a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">voir la source ↗</a>':''):'<span class="mk-dim">aucune</span>')+
      kv("Vérifié le",s.checked_at?esc(frDate(s.checked_at))+(s.stale_check?' <em class="warn">plus d\'un an : à revérifier</em>':''):'<span class="mk-dim">—</span>')+
      (pme?kv("PEA-PME",esc(pme.label)):"")+'</dl>'+
    (alts.length?'<div class="mk-alt"><em>Alternatives éligibles au PEA (même exposition)</em>'+alts.slice(0,4).map(function(a){return '<button type="button" class="chip" data-mk-id="'+esc(a.id)+'">'+esc(a.symbol)+' · '+esc(a.name)+'</button>';}).join("")+'</div>':'')+
    '<p class="mk-peaw">La liste n\'est pas exhaustive : vérifie toujours chez ton courtier ou sur le DIC du fonds.</p>'+
    '<form class="mk-fixf" data-mk-form="'+esc(i.id)+'" hidden>'+
      '<label>Statut PEA<select name="st"><option value="eligible">Éligible PEA</option><option value="not_eligible">Non éligible PEA</option><option value="unknown">À vérifier</option></select></label>'+
      '<label>Source (lien vers le DIC, l\'émetteur ou justETF)<input name="note" maxlength="200" placeholder="https://…"></label>'+
      '<div class="mk-fixb"><button type="submit" class="btn sm primary">Enregistrer ma correction</button>'+(s.by==="utilisateur"?'<button type="button" class="btn sm" data-mk-unfix="'+esc(i.id)+'">Retirer ma correction</button>':'')+
      '<button type="button" class="btn sm" data-mk-export>Copier mes corrections</button></div>'+
      '<p class="mk-note">Ta correction reste dans ce navigateur. « Copier mes corrections » donne les lignes à reporter dans referentiel.json.</p></form>'+
  '</div>';
}
/** Bloc des cours (rafraîchi seul à chaque cotation, sans toucher au formulaire). */
function priceHTML(i,q){
  if(!q)return '<div class="mk-fp"><p class="mk-dim">Cours en attente…</p></div>';
  var c=chg(i,q),inf=q.info||{},F=CK.fx,eur=i.currency&&i.currency!=="EUR"&&F&&F.toEUR&&!isYield(i)&&i.asset_class!=="devises"?F.toEUR(q.last,q.currency||i.currency):null;
  var perf=isYield(i)?"":'<div class="mk-perf">'+[["w","1 sem"],["m1","1 mois"],["m3","3 mois"],["m6","6 mois"],["y1","1 an"],["ytd","Depuis jan."]].map(function(p){var v=q.perf?fin(q.perf[p[0]]):null;return '<span><em>'+p[1]+'</em><b class="'+cl(v)+'">'+pct(v,1)+'</b></span>';}).join("")+'</div>';
  var lo52=fin(inf.low_52w),hi52=fin(inf.high_52w),p52=lo52!=null&&hi52!=null&&hi52>lo52?Math.max(0,Math.min(1,(q.last-lo52)/(hi52-lo52))):null;
  return '<div class="mk-fp"><div class="mk-fpx"><b>'+fmtPx(i,q.last)+'</b><span class="'+cl(c&&c.v)+'">'+fmtChg(c)+'</span>'+(q.currency&&!isYield(i)?'<em>'+esc(q.currency)+'</em>':'')+
      (eur!=null?'<em class="mk-eur">≈ '+nf(eur,eur>=100?2:4)+' €</em>':'')+'</div>'+
    '<p class="mk-fsrc">'+esc(q.source||"")+' · cours de '+esc(dday(q.ts))+' '+esc(hhmm(q.ts))+' · <span class="'+(q.stale?"warn":"")+'">'+esc(delayTxt(q)||"délai inconnu")+'</span></p>'+
    '<dl class="mk-kv mk-kv4">'+kv("Ouverture",fmtPx(i,q.open))+kv("Plus haut",fmtPx(i,q.high))+kv("Plus bas",fmtPx(i,q.low))+kv("Clôture veille",fmtPx(i,q.prev_close))+
      (isYield(i)?"":kv("Volume",fmtVol(q.volume))+kv("Capitaux échangés",fmtVol(q.value_traded)))+
      (p52!=null?kv("Sur 52 semaines",fmtPx(i,lo52)+' <span class="mk-rg mk-rgw"><i style="left:'+(p52*100).toFixed(1)+'%"></i></span> '+fmtPx(i,hi52),"mk-w2"):"")+'</dl>'+perf+
    (isYield(i)?'':'<p class="mk-note">Performances fournies par TradingView, à titre indicatif.</p>')+'</div>';
}
function ficheHTML(i,q){
  var t=i.tickers||{},inf=(q&&q.info)||{},ms=marketOf(i),st=ms&&CK.cal&&CK.cal.state?CK.cal.state(ms,now()):null;
  var ter=fin(i.ter)!=null?i.ter:fin(inf.ter);
  return '<p class="mk-disc">'+esc(disclaimer())+'</p>'+
    '<div class="mk-fh"><div><span class="mk-ftag">'+esc(M().vehicleLabel?M().vehicleLabel(i.vehicle):i.vehicle)+' · '+esc(M().classLabel?M().classLabel(i.asset_class):i.asset_class)+'</span>'+
      '<p class="mk-fsub">'+esc([i.symbol,i.exchange,i.currency].filter(Boolean).join(" · "))+(st?' · <span class="'+(st.open?"up":"")+'">'+esc(st.label)+'</span>':'')+'</p></div>'+
      (t.tv?'<div class="mk-fbtn"><button type="button" class="btn sm" data-mk-chart="'+esc(i.id)+'">Graphique</button><a class="btn sm" href="'+esc(safeUrl("https://www.tradingview.com/chart/?symbol="+encodeURIComponent(t.tv)))+'" target="_blank" rel="noopener noreferrer">TradingView</a></div>':'')+'</div>'+
    '<div id="mkfPrice">'+priceHTML(i,q)+'</div>'+
    '<div class="mk-fcols"><section><h4>Identité</h4><dl class="mk-kv">'+
      kv("ISIN",i.isin?esc(i.isin):null)+kv("Ticker TradingView",t.tv?esc(t.tv):null)+kv("Ticker Yahoo",t.yahoo?esc(t.yahoo):null)+
      kv("Zone d'exposition",regLabel(i.region)?esc(regLabel(i.region)):null)+kv("Secteur",i.sector?esc(i.sector):inf.sector?esc(inf.sector):null)+
      kv("Sous-classe",i.sub_asset_class?esc(i.sub_asset_class):null)+kv("Domicile",i.domicile?esc(i.domicile):null)+
      kv("Frais courants",ter!=null?nf(ter,2)+" % par an":null)+kv("Risque (SRI)",i.risk_level?esc(i.risk_level)+" / 7":null)+
      kv("Levier",i.leverage&&i.leverage!==1?"× "+esc(i.leverage)+" (quotidien)":null)+kv("Encours",fin(inf.aum)?fmtVol(inf.aum)+" "+esc(q&&q.currency||""):null)+
      kv("Lancement",i.launch_date?esc(frDate(i.launch_date)):null)+'</dl>'+(i.notes?'<p class="mk-note">'+esc(i.notes)+'</p>':'')+'</section>'+
    '<section><h4>Éligibilité PEA</h4>'+peaBlock(i)+'</section></div>';
}

/* ---------- Accueil : lecture du cache seulement (aucun appel réseau) ---------- */
var CORE_MK={"tv:SP:SPX":"SPX","tv:NASDAQ:NDX":"NDX","tv:TVC:GOLD":"GOLD"};
function cached(id){
  var q=CK.mkt&&CK.mkt.last?CK.mkt.last(id):null;if(q&&fin(q.last)!=null)return {last:q.last,c:chg(CK.ref&&CK.ref.get?CK.ref.get(id):null,q)};
  var k=CORE_MK[id],m=k&&CK.S&&CK.S.mk&&CK.S.mk[k];   // déjà lu par les Signaux (core.js)
  return m&&fin(m.c)!=null?{last:m.c,c:fin(m.ch)!=null?{v:m.ch,u:"%"}:null}:null;
}
function home(){
  var items=stripItems(gazOn()).map(function(s){var x=cached(s.id),i=CK.ref&&CK.ref.get?CK.ref.get(s.id):null;
    return {id:s.id,n:s.n,last:x?x.last:null,px:x?fmtPx(i,x.last):"—",c:x&&x.c?x.c.v:null,txt:x?fmtChg(x.c):"—"};});
  var st=CK.cal&&CK.cal.state?CK.cal.state("euronext",now()):null,ny=CK.cal&&CK.cal.state?CK.cal.state("nyse",now()):null;
  return {items:items,euronext:st,nyse:ny};
}

/* ================================================================
   Interface (DOM)
   ================================================================ */
var Q=dict(),tab="indices",sort=null,peaf="tous",query="",unsub=null,built=false,loopT=null,paintQ=false,ficheId=null,fxAsked=false,seen=false;
function $(id){return typeof document!=="undefined"&&document.getElementById?document.getElementById(id):null;}
function lsGet(k){try{return CK.ls?CK.ls(k):null;}catch(e){return null;}}
function lsSet(k,v){try{if(CK.ls)CK.ls(k,v);}catch(e){}}
function restore(){var t=lsGet("mk:tab");if(TAB_IDS.indexOf(t)>=0)tab=t;var p=lsGet("mk:pea");if(p==="tous"||p==="eligibles"||p==="verifier")peaf=p;}
function build(){
  var host=$("mkMain");if(!host||built)return;built=true;restore();
  host.innerHTML='<div class="mk-bar"><div class="seg mk-tabs" role="tablist" aria-label="Familles d\'actifs">'+TABS.map(function(t){return '<button type="button" role="tab" data-mk-tab="'+t.id+'">'+esc(t.label)+'</button>';}).join("")+'</div>'+
      '<input class="mk-q" id="mkQ" type="search" placeholder="Rechercher (nom, symbole, ISIN)" autocomplete="off" aria-label="Rechercher un instrument">'+
      '<div class="seg mk-peaf" role="group" aria-label="Filtre PEA">'+PEAF.map(function(p){return '<button type="button" data-mk-pea="'+p.id+'">'+esc(p.label)+'</button>';}).join("")+'</div>'+
      '<span id="mkSrc"></span></div>'+
    '<p class="mk-note" id="mkNote"></p><div id="mkExtra"></div><div class="tablewrap mk-tw" id="mkTable"></div>'+
    '<p class="mk-disc">'+esc(disclaimer())+'</p>';
  host.addEventListener("click",onClick);
  host.addEventListener("keydown",function(e){if(e.key!=="Enter")return;var r=e.target.closest&&e.target.closest("tr[data-mk-id]");if(r){e.preventDefault();fiche(r.getAttribute("data-mk-id"));}});
  var qi=$("mkQ");if(qi)qi.addEventListener("input",function(){query=qi.value.trim();paint();});
  var sh=$("mkStrip");if(sh)sh.addEventListener("click",onClick);
  var fb=$("mkfBody");if(fb){fb.addEventListener("click",onClick);fb.addEventListener("submit",onFix);}
}
function onClick(e){
  var t=e.target;if(!t||!t.closest)return;var b;
  if((b=t.closest("[data-mk-tab]"))){setTab(b.getAttribute("data-mk-tab"));return;}
  /* tri : 1er clic sens naturel (texte A→Z, nombres du plus grand au plus petit), 2e clic inverse, 3e clic retour aux groupes */
  if((b=t.closest("[data-mk-sort]"))){var k=b.getAttribute("data-mk-sort"),d0=k==="name"||k==="pea"||k==="zone"?1:-1;sort=!sort||sort.k!==k?{k:k,dir:d0}:sort.dir===d0?{k:k,dir:-d0}:null;paint();return;}
  if((b=t.closest("[data-mk-pea]"))){peaf=b.getAttribute("data-mk-pea");lsSet("mk:pea",peaf);paint();return;}
  if((b=t.closest("[data-mk-fix]"))){var f=document.querySelector('[data-mk-form="'+cssq(b.getAttribute("data-mk-fix"))+'"]');if(f){f.hidden=!f.hidden;if(!f.hidden&&f.note)f.note.focus();}return;}
  if((b=t.closest("[data-mk-unfix]"))){if(CK.pea)CK.pea.setOverride(b.getAttribute("data-mk-unfix"),null);toast("Correction retirée.");refreshFiche(true);paint();return;}
  if((b=t.closest("[data-mk-export]"))){copy(CK.pea?CK.pea.exportOverrides():"[]");return;}
  if((b=t.closest("[data-mk-chart]"))){var i=get(b.getAttribute("data-mk-chart"));if(i&&i.tickers&&i.tickers.tv&&CK.openChart)CK.openChart(i.tickers.tv,i.name);return;}
  if((b=t.closest("[data-mk-id]"))){fiche(b.getAttribute("data-mk-id"));}
}
function cssq(s){return String(s).replace(/["\\]/g,"\\$&");}
function toast(h){if(CK.toast)CK.toast(esc(h));}
function copy(txt){
  var ok=function(){toast("Corrections copiées : colle-les dans referentiel.json.");},ko=function(){toast("Copie impossible : autorise le presse-papiers.");};
  try{if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(ok,ko);else ko();}catch(e){ko();}
}
function onFix(e){
  var f=e.target;if(!f||!f.getAttribute||!f.getAttribute("data-mk-form"))return;e.preventDefault();
  var id=f.getAttribute("data-mk-form"),st=f.st.value,note=f.note.value.trim();
  if(st==="eligible"&&!/^https?:\/\//i.test(note)){toast("Pour déclarer un instrument éligible, indique l'adresse de la source (DIC, émetteur ou justETF).");f.note.focus();return;}
  if(CK.pea&&CK.pea.setOverride(id,st,note))toast("Correction enregistrée dans ce navigateur.");
  refreshFiche(true);paint();
}
function get(id){return CK.ref&&CK.ref.get?CK.ref.get(id):null;}
function setTab(t){if(TAB_IDS.indexOf(t)<0)return;tab=t;sort=null;lsSet("mk:tab",t);if(query){query="";var qi=$("mkQ");if(qi)qi.value="";}paint();}
function schedule(){if(paintQ)return;paintQ=true;var f=typeof requestAnimationFrame==="function"&&!(typeof document!=="undefined"&&document.hidden)?requestAnimationFrame:function(cb){setTimeout(cb,50);};f(function(){paintQ=false;paint();});}
function paint(){
  var sh=$("mkStrip");if(sh){var h=stripHTML(Q,gazOn());if(sh._h!==h){sh.innerHTML=h;sh._h=h;}}
  var sm=$("mkStripMeta"),eu=CK.cal&&CK.cal.state?CK.cal.state("euronext",now()):null,ny=CK.cal&&CK.cal.state?CK.cal.state("nyse",now()):null;
  if(sm){var t=[eu?"Euronext : "+eu.label.toLowerCase():"",ny?"Wall Street : "+ny.label.toLowerCase():""].filter(Boolean).join(" · ");if(sm.textContent!==t)sm.textContent=t;}
  if(!built)return;
  [].forEach.call(document.querySelectorAll("[data-mk-tab]"),function(b){var on=!query&&b.getAttribute("data-mk-tab")===tab;b.setAttribute("aria-selected",on?"true":"false");b.setAttribute("aria-pressed",on?"true":"false");});
  [].forEach.call(document.querySelectorAll("[data-mk-pea]"),function(b){b.setAttribute("aria-pressed",b.getAttribute("data-mk-pea")===peaf?"true":"false");});
  var list=visible(tab,query,peaf),tb=$("mkTable"),html=tableHTML(list,Q,sort);
  if(tb&&tb._h!==html){tb.innerHTML=html;tb._h=html;}
  var note=$("mkNote"),nt=query?"Résultats dans tous les onglets pour « "+query+" » ("+list.length+").":NOTES[tab]||"";if(note&&note.textContent!==nt)note.textContent=nt;
  var ex=$("mkExtra"),eh=query?"":tab==="taux"?spreadsHTML(Q):tab==="devises"?fixingsHTML():"";if(ex&&ex._h!==eh){ex.innerHTML=eh;ex._h=eh;}
  var ids=list.map(function(i){return i.id;}),src=$("mkSrc"),sx=srcHTML(CK.mkt&&CK.mkt.status?CK.mkt.status("equity"):null,Q,ids);if(src&&src._h!==sx){src.innerHTML=sx;src._h=sx;}
  var meta=$("mkMeta"),mt=list.length+" instrument"+(list.length>1?"s":"")+" · "+(query?"recherche":(TABS[TAB_IDS.indexOf(tab)]||{}).label);if(meta&&meta.textContent!==mt)meta.textContent=mt;
  refreshFiche(false);
}
/** Les taux EUR/devise du scanner deviennent les taux « en direct » de CK.fx (EUR pour 1 unité). */
var FXQ={"tv:FX_IDC:EURUSD":"USD","tv:FX_IDC:EURGBP":"GBP","tv:FX_IDC:EURCHF":"CHF","tv:FX_IDC:EURJPY":"JPY"};
function onQuotes(m){
  Object.keys(m||{}).forEach(function(k){var q=m[k];if(!q)return;Q[k]=q;
    if(FXQ[k]&&!q.stale&&fin(q.last)>0&&CK.fx&&CK.fx.setLive)try{CK.fx.setLive(FXQ[k],1/q.last,q.ts);}catch(e){}});
  schedule();
}
function start(){
  if(unsub)return;
  var ids=allIds();stripItems(true).forEach(function(s){if(ids.indexOf(s.id)<0)ids.push(s.id);});
  if(CK.mkt&&CK.mkt.subscribe)unsub=CK.mkt.subscribe(ids,onQuotes);
  if(!fxAsked&&CK.fx&&CK.fx.load){fxAsked=true;try{CK.fx.load().then(schedule,function(){});}catch(e){}}
  clearInterval(loopT);loopT=setInterval(function(){if(typeof document==="undefined"||!document.hidden)paint();},15000);
  paint();
}
function stop(){if(unsub){try{unsub();}catch(e){}unsub=null;}clearInterval(loopT);loopT=null;}
function onView(on){if(on){seen=true;build();start();}else stop();}

/* ---------- Fiche (fenêtre #ovMk) ---------- */
function fiche(id){
  var i=get(id);if(!i){toast("Instrument inconnu.");return;}
  build();var body=$("mkfBody"),ti=$("mkfTitle");if(!body)return;ficheId=i.id;
  if(ti)ti.textContent=i.name||i.symbol;
  body.innerHTML=ficheHTML(i,Q[i.id]||(CK.mkt&&CK.mkt.last?CK.mkt.last(i.id):null));body._h=null;
  if(CK.openOv)CK.openOv("ovMk");
  /* Hors de l'espace Marchés : une cotation ponctuelle (un seul appel groupé). */
  if(!unsub&&!Q[i.id]&&CK.mkt&&CK.mkt.quotes)CK.mkt.quotes([i.id]).then(function(m){Object.keys(m||{}).forEach(function(k){Q[k]=m[k];});refreshFiche(false);});
}
function refreshFiche(full){
  var ov=$("ovMk");if(!ficheId||!ov||ov.hidden)return;var i=get(ficheId);if(!i)return;
  if(full){var body=$("mkfBody");if(body)body.innerHTML=ficheHTML(i,Q[i.id]);return;}
  var p=$("mkfPrice");if(!p)return;var h=priceHTML(i,Q[i.id]);if(p._h!==h){p.innerHTML=h;p._h=h;}
}
/** Ouvre l'espace Marchés sur un onglet (Ctrl+K, #marches/etf). */
function open(t){if(t)setTab(t);if(CK.layout&&CK.layout.show)CK.layout.show("marches");}
function fromHash(){
  var h=typeof location!=="undefined"?String(location.hash||""):"",m=/^#marches(?:\/([a-z]+))?$/.exec(h);if(!m)return;
  var alias={obligations:"taux",taux:"taux",matieres:"mp",mp:"mp",indices:"indices",actions:"actions",etf:"etf",devises:"devises"};
  restore();if(m[1]&&alias[m[1]]){tab=alias[m[1]];lsSet("mk:tab",tab);}if(CK.layout&&CK.layout.show)CK.layout.show("marches");if(built)paint();
}

CK.mk={
  boot:function(){
    if(CK.onView)CK.onView("marches",onView);
    fromHash();if(typeof window!=="undefined"&&window.addEventListener)window.addEventListener("hashchange",fromHash);
    var ov=$("ovMk");if(ov&&typeof MutationObserver!=="undefined")new MutationObserver(function(){if(ov.hidden)ficheId=null;}).observe(ov,{attributes:true,attributeFilter:["hidden"]});
  },
  open:open,fiche:fiche,home:home,start:start,stop:stop,
  TABS:TABS,
  state:function(){return {tab:tab,peaf:peaf,query:query,sort:sort,running:!!unsub,seen:seen,quotes:Object.keys(Q).length};},
  _t:{tabOf:tabOf,groupOf:groupOf,listTab:listTab,allIds:allIds,peaPass:peaPass,chg:chg,fmtChg:fmtChg,fmtPx:fmtPx,fmtVol:fmtVol,delayTxt:delayTxt,
    marketOf:marketOf,spreads:spreads,stripItems:stripItems,stripHTML:stripHTML,rangePos:rangePos,peaBadge:peaBadge,rowHTML:rowHTML,tableHTML:tableHTML,
    sortList:sortList,visible:visible,matches:matches,srcHTML:srcHTML,ficheHTML:ficheHTML,priceHTML:priceHTML,peaBlock:peaBlock,spreadsHTML:spreadsHTML,
    fixingsHTML:fixingsHTML,onQuotes:onQuotes,Q:function(){return Q;},reset:function(){stop();Q=dict();tab="indices";sort=null;peaf="tous";query="";built=false;ficheId=null;fxAsked=false;seen=false;},
    STRIP:STRIP,SPREADS:SPREADS,NOTES:NOTES}
};
})();
