/* ================================================================
   COCKPIT — Portefeuille : données et calculs (phase 4) : CK.pfc
   Le portefeuille reste dans CE navigateur (CK.lsj("pf")) : il n'est jamais envoyé
   sur internet, ni dans le dépôt GitHub. Seuls les cours sont demandés aux sources.
   Contenu : comptes, positions de départ, opérations (rejouées dans l'ordre des dates),
   instruments hors référentiel, import CSV de courtier (« ; », virgule décimale,
   Windows-1252), sauvegarde JSON, valorisation en euros, plus-value prix / change,
   répartition, contrôles d'enveloppe (PEA, plafonds, ancienneté), risques
   (volatilité, perte maximale, concentration, corrélations, contributions).
   Aucun accès au DOM ni minuterie : testable dans Node (vmkit.mjs).
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var KEY="pf",FORMAT="desk-portefeuille",DAY=864e5,EPS=1e-9;
var LIM={accounts:50,holdings:2000,transactions:20000,instruments:1000};
function M(){return CK.models||{};}
function num(v){var f=M().num;return f?f(v):typeof v==="number"&&isFinite(v)?v:null;}
function clean(s,max){var f=M().cleanText;return f?f(s,max):String(s==null?"":s).replace(/<[^>]*>/g," ").trim().slice(0,max||200);}
function iso(v){var f=M().isoDate;return f?f(v):null;}
function fin(x){return typeof x==="number"&&isFinite(x)?x:null;}
function dict(){return Object.create(null);}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function today(){return new Date(now()).toISOString().slice(0,10);}
var BAD={"__proto__":1,"constructor":1,"prototype":1};
var seq=0;
/** Identifiant court et unique (préfixe + temps + compteur + hasard). */
function uid(p){seq=(seq+1)%1e6;return (p||"x")+"_"+now().toString(36)+seq.toString(36)+Math.floor(Math.random()*1296).toString(36);}

/* ================================================================
   Modèle et stockage
   ================================================================ */
function empty(){return {format:FORMAT,v:1,accounts:[],holdings:[],transactions:[],instruments:[],updated_at:null,exported_at:null};}
function normAcc(r){
  var a=M().normAccount(r||{});if(!a.id||BAD[a.id])a.id=uid("acc");
  a.note=clean(r&&r.note,200)||null;a.demo=!!(r&&r.demo===true);return a;
}
/** Position de départ (avant les opérations) : quantité, prix de revient unitaire (devise de cotation), taux de change d'achat. */
function normHold(r){
  r=r||{};var p=M().normPosition(r);
  return {id:clean(r.id,40)||uid("pos"),account_id:p.account_id,instrument_id:p.instrument_id,quantity:Math.max(0,p.quantity),
    average_purchase_price:p.average_purchase_price!=null&&p.average_purchase_price>=0?p.average_purchase_price:null,
    fx_rate_at_purchase:p.fx_rate_at_purchase>0?p.fx_rate_at_purchase:null,price_source:p.price_source,
    manual_price:p.manual_price>0?p.manual_price:null,manual_price_date:iso(r.manual_price_date),
    origin:clean(r.origin,120)||"Saisie",updated_at:p.updated_at||today(),note:clean(r.note,200)||null,demo:r.demo===true};
}
function normTx(r){
  r=r||{};var t=M().normTransaction(r);
  t.id=t.id&&!BAD[t.id]?t.id:uid("op");t.quantity=Math.abs(t.quantity||0);t.fees=Math.abs(t.fees||0);
  t.amount=num(r.amount);if(t.amount!=null)t.amount=Math.abs(t.amount);
  t.fx_rate=t.fx_rate>0?t.fx_rate:null;t.cash=r.cash!==false;
  t.origin=clean(r.origin,120)||"Saisie";t.note=clean(r.note,200)||null;t.demo=r.demo===true;
  return t;
}
/** Instrument hors référentiel (assurance-vie, fonds, action non suivie) : identifiant toujours « perso:… », prix manuel. */
function normCustom(r){
  r=r||{};var id=clean(r.id,64);if(!/^perso:/.test(id))id="perso:"+(id||slug(r.isin||r.name||"ligne"));
  var i=M().normInstrument(Object.assign({},r,{id:id,data_source:"manuel"}));i.id=id;i.custom=true;i.auto=r.auto===true;
  if(!i.symbol)i.symbol=(i.isin||i.name||"LIGNE").slice(0,12).toUpperCase();
  return i;
}
function slug(s){return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Za-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40).toUpperCase()||"LIGNE";}
/** Nettoie un état complet (stockage ou sauvegarde importée). Les lignes rattachées à un compte inconnu sont retirées. */
function norm(raw){
  var P=empty(),r=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  if(M().hasBadKeys&&M().hasBadKeys(r))return P;
  var arr=function(a,n){return Array.isArray(a)?a.slice(0,n):[];};
  var seen=dict();
  arr(r.accounts,LIM.accounts).forEach(function(x){if(!x||typeof x!=="object")return;var a=normAcc(x);if(seen[a.id])a.id=uid("acc");seen[a.id]=1;P.accounts.push(a);});
  var ins=dict();arr(r.instruments,LIM.instruments).forEach(function(x){if(!x||typeof x!=="object")return;var i=normCustom(x);if(!ins[i.id]){ins[i.id]=1;P.instruments.push(i);}});
  arr(r.holdings,LIM.holdings).forEach(function(x){if(!x||typeof x!=="object")return;var h=normHold(x);if(h.account_id&&seen[h.account_id]&&h.instrument_id)P.holdings.push(h);});
  arr(r.transactions,LIM.transactions).forEach(function(x){if(!x||typeof x!=="object")return;var t=normTx(x);if(t.account_id&&seen[t.account_id]&&t.date)P.transactions.push(t);});
  P.updated_at=typeof r.updated_at==="string"?r.updated_at.slice(0,30):null;P.exported_at=typeof r.exported_at==="string"?r.exported_at.slice(0,30):null;
  return P;
}
var MEM=null;
function load(){
  var raw=null;if(typeof CK.lsj==="function"){try{raw=CK.lsj(KEY);}catch(e){raw=null;}}else raw=MEM;
  return norm(raw);
}
/** Enregistre dans ce navigateur. Renvoie false si le stockage est plein ou refusé. */
function save(P,keepDate){
  if(!keepDate)P.updated_at=new Date(now()).toISOString();
  var o=JSON.parse(JSON.stringify(P));
  if(typeof CK.lsj==="function"){try{CK.lsj(KEY,o);var back=CK.lsj(KEY);return !!(back&&back.format===FORMAT);}catch(e){return false;}}
  MEM=o;return true;
}
function clear(){if(typeof CK.lsj==="function"){try{CK.lsj(KEY,null);}catch(e){}}MEM=null;}

/* ================================================================
   Instruments
   ================================================================ */
/** Instrument d'une position : référentiel, instrument perso, ou crypto « crypto:XXX ». */
function instr(P,id){
  if(typeof id!=="string"||!id)return null;
  var r=CK.ref&&CK.ref.get?CK.ref.get(id):null;if(r)return r;
  for(var k=0;k<(P&&P.instruments||[]).length;k++)if(P.instruments[k].id===id)return P.instruments[k];
  if(/^crypto:[A-Z0-9]{2,12}$/.test(id))return M().normInstrument({id:id,symbol:id.slice(7),name:id.slice(7),asset_class:"crypto",vehicle:"spot_crypto",currency:"USDT",tickers:{okx:id.slice(7)+"-USDT"}});
  return null;
}
/** Une cotation de marché est-elle possible ? (référentiel ou crypto ; jamais un instrument perso). */
function quotable(i){return !!i&&!i.custom&&i.is_investable!==false&&(!!(i.tickers&&(i.tickers.tv||i.tickers.okx))||i.vehicle==="spot_crypto");}

/* Grandes familles de la répartition (ordre fixe : la couleur suit la famille, jamais son rang). */
var GROUPS=[
  {id:"actions",label:"Actions"},{id:"obligations",label:"Obligations"},{id:"mp",label:"Matières premières"},
  {id:"immo",label:"Immobilier coté"},{id:"crypto",label:"Crypto"},{id:"liq",label:"Liquidités"},{id:"autre",label:"Autres"}
];
function groupOf(cls){
  if(!cls)return "autre";var a=[cls].concat(M().classAncestors?M().classAncestors(cls):[]),top=a[a.length-1];
  return top==="actions"?"actions":top==="obligations"?"obligations":top==="matieres_premieres"?"mp":top==="immobilier_cote"?"immo":
    top==="crypto"?"crypto":top==="liquidites"?"liq":"autre";
}

/* ================================================================
   Taux de change (CK.fx : EUR pour 1 unité)
   ================================================================ */
function fxRate(ccy,date){
  var c=String(ccy||"EUR");if(c==="EUR")return 1;
  var F=CK.fx;if(!F||!F.rate)return null;
  var r=date?F.rate(c,date):null;if(r==null)r=F.rate(c);return r;
}

/* ================================================================
   Rejeu des opérations : positions et espèces effectives
   ================================================================ */
var TX_ORDER={versement:0,achat:1,dividende:2,frais:3,vente:4,retrait:5};
/**
 * Positions de départ + opérations triées par date → positions et comptes effectifs.
 * Les montants réalisés (plus-values de cession, dividendes, frais) sont en euros, au taux du jour de l'opération.
 * @returns {{accounts:Object[], positions:Object[], errors:{id:string,msg:string}[]}}
 */
function compute(P){
  var A=dict(),order=[],pos=dict(),plist=[],errors=[];
  (P.accounts||[]).forEach(function(a){A[a.id]={a:a,cash:fin(a.cash_balance)||0,deposits:fin(a.deposits_total)||0,withdrawals:0,realized:0,dividends:0,fees:0};order.push(a.id);});
  function ccyOf(id){var i=instr(P,id);return i&&i.currency||"EUR";}
  function get(acc,id){var k=acc+"|"+id,p=pos[k];
    if(!p){p=pos[k]={key:k,account_id:acc,instrument_id:id,quantity:0,pru:null,fxb:null,realized:0,dividends:0,origins:[],holding_ids:[],tx:0,
      price_source:"marche",manual_price:null,manual_price_date:null,currency:ccyOf(id),note:null,demo:false};plist.push(p);}return p;}
  /* positions de départ (deux lignes du même instrument sur le même compte sont fusionnées) */
  (P.holdings||[]).forEach(function(h){
    if(!A[h.account_id])return;var p=get(h.account_id,h.instrument_id),q=h.quantity||0,pr=h.average_purchase_price,fx=h.fx_rate_at_purchase||fxRate(p.currency,h.updated_at);
    if(q>0){
      if(pr!=null&&(p.pru!=null||p.quantity===0)){var c0=p.quantity*(p.pru||0),c1=q*pr,e0=c0*(p.fxb||0),e1=c1*(fx||0);
        p.pru=(c0+c1)/(p.quantity+q);p.fxb=c0+c1>0&&fx?(e0+e1)/(c0+c1):p.fxb||fx;}
      else p.pru=null;
      p.quantity+=q;
    }
    p.holding_ids.push(h.id);if(p.origins.indexOf(h.origin)<0)p.origins.push(h.origin);
    if(h.price_source==="manuel"){p.price_source="manuel";p.manual_price=h.manual_price;p.manual_price_date=h.manual_price_date;}
    if(h.note)p.note=h.note;if(h.demo)p.demo=true;
  });
  /* opérations, dans l'ordre des dates (à date égale : versements d'abord, ventes et retraits ensuite) */
  var txs=(P.transactions||[]).map(function(t,n){return {t:t,n:n};}).sort(function(x,y){
    return x.t.date<y.t.date?-1:x.t.date>y.t.date?1:(TX_ORDER[x.t.type]-TX_ORDER[y.t.type])||x.n-y.n;});
  txs.forEach(function(o){
    var t=o.t,acc=A[t.account_id];if(!acc){errors.push({id:t.id,msg:"Compte inconnu."});return;}
    var ccy=t.currency||"EUR",fx=t.fx_rate||fxRate(ccy,t.date),accFx=fxRate(acc.a.currency,t.date)||1;
    if(fx==null){errors.push({id:t.id,msg:"Devise "+ccy+" non convertible en euros : opération ignorée."});return;}
    var cash=function(eur){if(t.cash)acc.cash+=eur/accFx;};
    var amt=t.amount!=null?t.amount:t.price!=null&&t.quantity?t.price*t.quantity:null;
    if(t.type==="achat"||t.type==="vente"){
      if(!t.instrument_id||!(t.quantity>0)||t.price==null||t.price<0){errors.push({id:t.id,msg:"Achat ou vente incomplet (instrument, quantité et prix)."});return;}
      var p=get(t.account_id,t.instrument_id);p.tx++;if(p.origins.indexOf("Opérations")<0)p.origins.push("Opérations");
      /* le prix de revient reste dans la devise de cotation de l'instrument */
      var fxI=fxRate(p.currency,t.date)||fx,conv=ccy===p.currency?1:fx/fxI;
      if(t.type==="achat"){
        var costL=(t.quantity*t.price+t.fees)*conv,costE=(t.quantity*t.price+t.fees)*fx;
        var oldL=p.quantity*(p.pru||0),oldE=oldL*(p.fxb||fxI);
        p.quantity+=t.quantity;p.pru=(oldL+costL)/p.quantity;p.fxb=oldL+costL>0?(oldE+costE)/(oldL+costL):fxI;
        cash(-costE);
      }else{
        if(t.quantity>p.quantity+EPS){errors.push({id:t.id,msg:"Vente de "+t.quantity+" alors que la position n'en compte que "+round(p.quantity,8)+" : opération ignorée."});return;}
        var proceedsE=(t.quantity*t.price-t.fees)*fx,costOut=p.pru!=null?t.quantity*p.pru*(p.fxb||fxI):null;
        if(costOut!=null){p.realized+=proceedsE-costOut;acc.realized+=proceedsE-costOut;}
        p.quantity-=t.quantity;if(p.quantity<EPS)p.quantity=0;
        cash(proceedsE);
      }
      return;
    }
    if(amt==null){errors.push({id:t.id,msg:"Montant manquant."});return;}
    var e=amt*fx,fe=t.fees*fx;
    if(t.type==="dividende"){var net=e-fe;acc.dividends+=net;if(t.instrument_id){var pd=get(t.account_id,t.instrument_id);pd.dividends+=net;pd.tx++;}cash(net);}
    else if(t.type==="versement"){acc.deposits+=e;cash(e-fe);}
    else if(t.type==="retrait"){acc.withdrawals+=e;cash(-e-fe);}
    else if(t.type==="frais"){acc.fees+=e+fe;cash(-e-fe);}
  });
  return {
    accounts:order.map(function(id){var x=A[id];return Object.assign({},x.a,{cash:x.cash,deposits:x.deposits,withdrawals:x.withdrawals,realized:x.realized,dividends:x.dividends,fees:x.fees});}),
    positions:plist,errors:errors
  };
}

/* ================================================================
   Valorisation en euros
   ================================================================ */
/**
 * Valorise les positions effectives. quote(id) → Quote ou null ; opts.close(id) → {c, d} (clôture du robot) ou null.
 * Plus-value latente = prix + change : qté·(cours − PRU)·fx_actuel + qté·PRU·(fx_actuel − fx_achat).
 */
function value(P,quote,opts){
  opts=opts||{};var C=compute(P),T=now(),lines=[],acc=dict(),tot={value:0,cost:0,pnl:0,pnl_px:0,pnl_fx:0,day:0,dayBase:0,cash:0,invested:0,realized:0,dividends:0,fees:0,unpriced:0,unconvertible:0,manual:0};
  C.accounts.forEach(function(a){
    var r=fxRate(a.currency),cash=r!=null?a.cash*r:null;
    acc[a.id]=Object.assign({},a,{cash_eur:cash,value:cash||0,invested:0,pnl:0,cost:0,lines:0});
    if(cash!=null){tot.cash+=cash;tot.value+=cash;}else tot.unconvertible++;
    tot.realized+=a.realized;tot.dividends+=a.dividends;tot.fees+=a.fees;
  });
  C.positions.forEach(function(p){
    if(!(p.quantity>0))return;var i=instr(P,p.instrument_id),q=null,px=null,src="",ts=null,stale=false,ccy=p.currency,kind="";
    if(p.price_source==="manuel"&&p.manual_price>0){px=p.manual_price;kind="manuel";src="Prix manuel";ts=p.manual_price_date?Date.parse(p.manual_price_date+"T12:00:00Z"):null;}
    else{
      q=quotable(i)&&typeof quote==="function"?quote(p.instrument_id):null;
      if(q&&fin(q.last)>0){px=q.last;kind="marche";src=q.source||"";ts=q.ts||null;stale=!!q.stale;if(q.currency)ccy=q.currency;}
      else{var cl=opts.close?opts.close(p.instrument_id):null;
        if(cl&&fin(cl.c)>0){px=cl.c;kind="cloture";src="Dernière clôture publiée";ts=cl.d?Date.parse(cl.d+"T17:30:00Z"):null;}
        else if(p.manual_price>0){px=p.manual_price;kind="manuel";src="Prix manuel";}
        else if(p.pru!=null){px=p.pru;kind="pru";src="Prix d'achat (cours indisponible)";}}
    }
    var fx=fxRate(ccy),L={key:p.key,account_id:p.account_id,instrument_id:p.instrument_id,i:i,quantity:p.quantity,pru:p.pru,fxb:p.fxb,currency:ccy,
      price:px,kind:kind,src:src,ts:ts,stale:stale,fx:fx,value:null,cost:null,pnl:null,pnl_px:null,pnl_fx:null,pnl_pct:null,day:null,
      realized:p.realized,dividends:p.dividends,origins:p.origins,holding_ids:p.holding_ids,tx:p.tx,note:p.note,demo:p.demo,
      price_source:p.price_source,manual_price:p.manual_price,manual_price_date:p.manual_price_date,group:groupOf(i&&i.asset_class),weight:null};
    if(px==null){tot.unpriced++;lines.push(L);return;}
    if(fx==null){tot.unconvertible++;lines.push(L);return;}
    L.value=p.quantity*px*fx;
    if(p.pru!=null){var fb=p.fxb||fx;L.cost=p.quantity*p.pru*fb;L.pnl=L.value-L.cost;L.pnl_px=p.quantity*(px-p.pru)*fx;L.pnl_fx=p.quantity*p.pru*(fx-fb);L.pnl_pct=L.cost>0?L.pnl/L.cost:null;}
    if(kind==="marche"&&q&&!stale&&fin(q.change_pct)!=null&&q.change_pct>-100){L.day=L.value-L.value/(1+q.change_pct/100);tot.day+=L.day;tot.dayBase+=L.value-L.day;}
    if(kind==="pru")tot.unpriced++;if(kind==="manuel")tot.manual++;
    tot.value+=L.value;tot.invested+=L.value;
    if(L.cost!=null){tot.cost+=L.cost;tot.pnl+=L.pnl;tot.pnl_px+=L.pnl_px;tot.pnl_fx+=L.pnl_fx;}
    var a=acc[p.account_id];if(a){a.value+=L.value;a.invested+=L.value;a.lines++;if(L.cost!=null){a.cost+=L.cost;a.pnl+=L.pnl;}}
    lines.push(L);
  });
  lines.forEach(function(L){L.weight=L.value!=null&&tot.value>0?L.value/tot.value:null;});
  tot.pnl_pct=tot.cost>0?tot.pnl/tot.cost:null;tot.day_pct=tot.dayBase>0?tot.day/tot.dayBase:null;
  var accounts=C.accounts.map(function(a){var x=acc[a.id];x.weight=tot.value>0?x.value/tot.value:null;return x;});
  return {ts:T,total:tot,lines:lines,accounts:accounts,errors:C.errors,breakdown:breakdown(lines,accounts,tot)};
}
/** Répartition par famille, zone, devise, statut PEA, et par compte × famille. Les espèces comptent en liquidités (EUR ou devise du compte). */
function breakdown(lines,accounts,tot){
  var by=function(){return dict();},G=by(),R=by(),Cc=by(),PE=by(),AG=dict();
  var add=function(m,k,v){m[k]=(m[k]||0)+v;};
  lines.forEach(function(L){if(L.value==null)return;var i=L.i||{};add(G,L.group,L.value);
    add(R,i.region||(L.group==="liq"?"liquidites":L.group==="crypto"?"crypto":"autre"),L.value);add(Cc,ccyBase(L.currency),L.value);
    var st=!i.id?"unknown":CK.pea&&CK.pea.status?CK.pea.status(i).status:"unknown";add(PE,st,L.value);
    var ag=AG[L.account_id]||(AG[L.account_id]=dict());add(ag,L.group,L.value);});
  accounts.forEach(function(a){if(a.cash_eur){add(G,"liq",a.cash_eur);add(R,"liquidites",a.cash_eur);add(Cc,ccyBase(a.currency),a.cash_eur);add(PE,"cash",a.cash_eur);
    var ag=AG[a.id]||(AG[a.id]=dict());add(ag,"liq",a.cash_eur);}});
  var list=function(m){return Object.keys(m).map(function(k){return {k:k,v:m[k],w:tot.value>0?m[k]/tot.value:null};}).sort(function(a,b){return b.v-a.v;});};
  return {groups:GROUPS.map(function(g){var v=G[g.id]||0;return {k:g.id,label:g.label,v:v,w:tot.value>0?v/tot.value:null};}),
    regions:list(R),currencies:list(Cc),pea:list(PE),byAccount:AG};
}
function ccyBase(c){c=String(c||"EUR");var a=CK.fx&&CK.fx.ALIAS&&CK.fx.ALIAS[c];return a?a[0]:c.toUpperCase();}

/* ================================================================
   Contrôles d'enveloppe (PEA, plafonds, ancienneté, espèces, prix)
   ================================================================ */
function fiscal(){var d=M().data?M().data("fiscal"):null;return d&&d.enveloppes||{};}
function years(from,at){var a=Date.parse(from+"T00:00:00Z");return isFinite(a)?(at-a)/(365.25*DAY):null;}
function addYears(d,n){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||"");if(!m)return null;var y=+m[1]+n,mo=m[2],da=m[3];if(mo==="02"&&da==="29")da="28";return y+"-"+mo+"-"+da;}
function fr(d){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||"");return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function eur(v){return Math.round(v).toLocaleString("fr-FR")+" €";}
/**
 * Liste de contrôles {level:"alerte"|"attention"|"info", account_id, text}.
 * Rien n'est bloqué : le Desk signale, tu décides.
 */
function checks(P,V){
  var out=[],F=fiscal(),T=V&&V.ts||now(),push=function(level,a,text){out.push({level:level,account_id:a?a.id:null,text:text});};
  var accs=V?V.accounts:compute(P).accounts,depPEA=0,depPME=0;
  accs.forEach(function(a){
    var t=a.account_type;
    if(t==="PEA"||t==="PEA_PME"){
      var lim=t==="PEA"?(F.PEA&&F.PEA.plafond_versements_eur||150000):(F.PEA_PME&&F.PEA_PME.plafond_commun_eur||225000);
      if(t==="PEA")depPEA+=a.deposits||0;else depPME+=a.deposits||0;
      if(t==="PEA"&&a.deposits>lim)push("alerte",a,a.name+" : versements de "+eur(a.deposits)+", au-dessus du plafond de "+eur(lim)+".");
      else if(t==="PEA"&&a.deposits>0.9*lim)push("info",a,a.name+" : "+eur(a.deposits)+" versés sur "+eur(lim)+" de plafond ("+eur(lim-a.deposits)+" disponibles).");
      if(a.opened_at){var y=years(a.opened_at,T),d5=addYears(a.opened_at,5);
        if(y!=null&&y<5)push("info",a,a.name+" : 5 ans le "+fr(d5)+". Un retrait avant cette date clôt le plan (sauf exceptions).");
        else if(y!=null)push("info",a,a.name+" : plus de 5 ans (depuis le "+fr(d5)+"). Gains exonérés d'impôt sur le revenu, prélèvements sociaux dus.");}
      else push("info",a,a.name+" : indique la date d'ouverture pour suivre les 5 ans du plan.");
    }
    if(t==="assurance_vie"&&a.opened_at){var y8=years(a.opened_at,T);if(y8!=null&&y8<8)push("info",a,a.name+" : 8 ans le "+fr(addYears(a.opened_at,8))+" (abattement annuel ensuite).");}
    if(a.cash<-0.005)push("attention",a,a.name+" : espèces négatives. Ajoute un versement ou corrige le solde du compte.");
  });
  if(depPEA+depPME>(F.PEA_PME&&F.PEA_PME.plafond_commun_eur||225000))push("alerte",null,"PEA + PEA-PME : "+eur(depPEA+depPME)+" versés, au-dessus du plafond commun de "+eur(F.PEA_PME&&F.PEA_PME.plafond_commun_eur||225000)+".");
  var A=dict();accs.forEach(function(a){A[a.id]=a;});
  (V?V.lines:[]).forEach(function(L){
    var a=A[L.account_id],i=L.i,nm=i?(i.symbol||i.name):L.instrument_id;if(!a)return;
    if((a.account_type==="PEA"||a.account_type==="PEA_PME")&&CK.pea&&CK.pea.allowedIn){
      var r=i?CK.pea.allowedIn(i,a.account_type):{ok:false,reason:"Instrument inconnu."};
      if(!r.ok){var st=i&&CK.pea.status?CK.pea.status(i).status:"unknown";push(st==="not_eligible"?"alerte":"attention",a,nm+" dans "+a.name+" : "+r.reason);}
    }
    if(i&&i.leverage&&i.leverage!==1)push("info",a,nm+" : produit à levier ou inverse (×"+i.leverage+", quotidien) : son comportement s'écarte de l'indice sur la durée.");
    if(L.kind==="pru")push("attention",a,nm+" : cours indisponible, valorisé à son prix d'achat.");
    if(L.price==null)push("attention",a,nm+" : ni cours ni prix d'achat, ligne non valorisée.");
    else if(L.fx==null)push("attention",a,nm+" : devise "+L.currency+" non convertible pour l'instant (taux BCE en cours de chargement).");
    if(L.kind==="manuel"){var md=L.manual_price_date,age=md?years(md,T)*365.25:null;
      if(age==null||age>31)push("info",a,nm+" : prix manuel "+(md?"du "+fr(md):"sans date")+", à mettre à jour.");}
  });
  (V?V.errors:compute(P).errors).forEach(function(e){push("attention",null,"Opération ignorée : "+e.msg);});
  var rank={alerte:0,attention:1,info:2};
  return out.sort(function(x,y){return rank[x.level]-rank[y.level];});
}

/* ================================================================
   Import CSV de courtier
   ================================================================ */
/* Windows-1252 : octets 0x80-0x9F (€, guillemets, tirets…) ; le reste = Latin-1. */
var W1252={128:8364,130:8218,131:402,132:8222,133:8230,134:8224,135:8225,136:710,137:8240,138:352,139:8249,140:338,142:381,145:8216,146:8217,147:8220,148:8221,149:8226,150:8211,151:8212,152:732,153:8482,154:353,155:8250,156:339,158:382,159:376};
/** Octets → texte : UTF-8 si valide (avec ou sans BOM), sinon Windows-1252 (exports Excel des courtiers français). */
function decode(bytes){
  var b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]),i=0,out=[],ok=true;
  if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)i=3;
  var start=i;
  while(i<b.length){var c=b[i];
    if(c<0x80){out.push(c);i++;continue;}
    var n=c>=0xF0&&c<0xF5?3:c>=0xE0?2:c>=0xC2&&c<0xE0?1:-1;if(n<0||i+n>=b.length){ok=false;break;}
    var cp=c&(n===1?0x1F:n===2?0x0F:0x07);for(var k=1;k<=n;k++){var d=b[i+k];if(d==null||(d&0xC0)!==0x80){ok=false;break;}cp=(cp<<6)|(d&0x3F);}
    if(!ok||(n===2&&cp<0x800)||(n===3&&(cp<0x10000||cp>0x10FFFF))||(cp>=0xD800&&cp<=0xDFFF)){ok=false;break;}
    out.push(cp);i+=n+1;}
  if(ok)return {text:cps(out),encoding:"UTF-8"};
  var w=[];for(var j=start;j<b.length;j++){var x=b[j];w.push(x>=0x80&&x<=0x9F?W1252[x]||0xFFFD:x);}
  return {text:cps(w),encoding:"Windows-1252"};
}
function cps(a){var s="",CH=8192;for(var i=0;i<a.length;i+=CH)s+=String.fromCodePoint.apply(null,a.slice(i,i+CH));return s;}
/** Découpe un CSV (guillemets, "" échappés, retours à la ligne dans un champ). Séparateur détecté : ; , tabulation ou |. */
function parseCSV(text,delim){
  text=String(text||"").replace(/^﻿/,"");
  if(!delim){var first=text.split(/\r?\n/).filter(function(l){return l.trim();}).slice(0,5),best=";",bn=-1;
    [";","\t",",","|"].forEach(function(d){var n=0;first.forEach(function(l){var inq=false;for(var k=0;k<l.length;k++){var ch=l[k];if(ch==='"')inq=!inq;else if(ch===d&&!inq)n++;}});if(n>bn){bn=n;best=d;}});delim=best;}
  var rows=[],row=[],f="",q=false,i=0,L=text.length;
  while(i<L){var c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}
    if(c==='"'&&f.trim()===""){q=true;f="";i++;continue;}
    if(c===delim){row.push(f);f="";i++;continue;}
    if(c==="\r"||c==="\n"){row.push(f);f="";if(row.some(function(x){return x.trim()!=="";}))rows.push(row);row=[];if(c==="\r"&&text[i+1]==="\n")i++;i++;continue;}
    f+=c;i++;}
  row.push(f);if(row.some(function(x){return x.trim()!=="";}))rows.push(row);
  return {delim:delim,rows:rows.map(function(r){return r.map(function(x){return x.trim();});})};
}
function nh(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim();}
/* Synonymes d'en-têtes (comparés sans accents ni ponctuation). */
var SYN={
  isin:["isin","code isin","code valeur isin","isin code"],
  name:["libelle","nom","valeur","instrument","titre","produit","designation","support","nom du support","libelle valeur","libelle du titre","actif","nom de la valeur","name","security","valeur titre"],
  symbol:["ticker","symbole","mnemo","mnemonique","code mnemonique","symbol","code"],
  qty:["quantite","qte","qty","nombre","nombre de titres","nb titres","nombre de parts","parts","quantity","nb parts","nb de parts","quantite detenue"],
  pru:["pru","prix de revient","prix de revient unitaire","pr unitaire","prix revient unitaire","cours moyen","prix moyen","prix moyen d achat","prix d achat","prix d achat moyen","cout moyen","prix revient","pam","average price","cout de revient unitaire"],
  price:["cours","dernier cours","prix","cours d execution","prix unitaire","cours unitaire","price","prix d execution","cours execute","valeur liquidative","vl"],
  value:["valorisation","montant","valeur eur","montant net","total","montant total","valeur de marche","valeur actuelle","montant brut","amount","montant eur","montant en euros","encours","valeur totale"],
  currency:["devise","monnaie","currency","devise de cotation"],
  date:["date","date d operation","date operation","date execution","date d execution","date de valeur","date valeur","date de l operation","date d effet"],
  type:["sens","operation","type","nature","type d operation","nature de l operation","libelle operation","type operation","mouvement"],
  fees:["frais","commission","courtage","frais de courtage","fees","frais totaux","commissions"]
};
var FIELDS=Object.keys(SYN);
/** Colonnes reconnues {champ: index}. Correspondance exacte d'abord, puis début d'en-tête (« Quantité (titres) »). */
function mapHeader(cells){
  var H=cells.map(nh),m={},used={};
  FIELDS.forEach(function(f){for(var k=0;k<H.length;k++){if(used[k])continue;if(SYN[f].indexOf(H[k])>=0){m[f]=k;used[k]=1;return;}}});
  FIELDS.forEach(function(f){if(m[f]!=null)return;for(var k=0;k<H.length;k++){if(used[k]||!H[k])continue;
    if(SYN[f].some(function(s){return H[k].indexOf(s+" ")===0;})){m[f]=k;used[k]=1;return;}}});
  return m;
}
/** Nombre d'un export : « 1 234,56 € », « (12,50) » négatif, « -3,2 % »… */
function csvNum(s){
  if(s==null)return null;var t=String(s).trim(),neg=/^\(.*\)$/.test(t);
  t=t.replace(/[()]/g,"").replace(/[€$£%]|\b(EUR|USD|GBP|CHF)\b/gi,"").replace(/−/g,"-").trim();
  var n=num(t);return n==null?null:neg?-Math.abs(n):n;
}
function csvDate(s){var t=String(s||"").trim(),m=/^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(t);if(m)t=m[1]+"/"+m[2]+"/"+m[3];
  m=/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(t);if(m)t=m[1]+"/"+m[2]+"/20"+m[3];
  return iso(t.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/,""));}
function txType(s){
  var t=nh(s);if(!t)return null;
  if(/divid|coupon|distribution/.test(t))return "dividende";
  if(/frais|droits de garde|taxe|ttf|impot|prelevement/.test(t))return "frais";
  if(/versement|depot|apport|virement entrant|alimentation|credit/.test(t))return "versement";
  if(/retrait|virement sortant|rachat|debit/.test(t))return "retrait";
  if(/vente|sell|cession|^v$|^s$/.test(t))return "vente";
  if(/achat|buy|acquisition|souscription|^a$|^b$/.test(t))return "achat";
  return null;
}
/** Famille et type devinés pour une ligne hors référentiel (marqués « à vérifier »). */
function guess(name,isin){
  var n=nh(name),cls="actions",veh="titre";
  if(/fonds euro|fonds en euro|euro croissance|monetaire|money market|tresorerie|livret/.test(n)){cls="liquidites";veh="fonds";}
  else if(/oblig|bond|treasury|govt|aggregate|credit|haut rendement|high yield/.test(n))cls="obligations";
  else if(/\bor\b|gold|\bargent\b|silver|commodit|matieres premieres/.test(n))cls=/silver|\bargent\b/.test(n)?"argent":/gold|\bor\b/.test(n)?"or":"matieres_premieres";
  else if(/immobili|reit|siic|scpi|opci/.test(n))cls="immobilier_cote";
  else if(/bitcoin|ethereum|crypto/.test(n))cls="crypto";
  if(veh==="titre"){if(/\betf\b|ucits|tracker|\bamundi\b|\bishares\b|\blyxor\b|\bxtrackers\b|\bspdr\b|\bvanguard\b/.test(n))veh="etf";
    else if(/fonds|sicav|fcp|\bfund\b|\bopcvm\b|\bsci\b|\bscpi\b|\bopci\b|portefeuille|gestion|\bpatrimoine\b/.test(n))veh="fonds";}
  if(cls==="crypto"&&veh==="titre")veh="etc_etn";
  return {asset_class:cls,vehicle:veh};
}
/** Instrument d'une ligne : ISIN du référentiel, symbole exact, instrument perso existant, sinon brouillon perso. */
function matchInstr(P,isin,symbol,name){
  var I=String(isin||"").toUpperCase().replace(/[\s-]/g,""),S=String(symbol||"").toUpperCase().trim();
  var okIsin=M().isinValid?M().isinValid(I):/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(I);
  if(okIsin&&CK.ref&&CK.ref.byIsin){var r=CK.ref.byIsin(I);if(r&&r.is_investable)return {id:r.id,i:r,how:"ISIN"};}
  if(S&&CK.ref&&CK.ref.all){var all=CK.ref.all();for(var k=0;k<all.length;k++){var x=all[k];if(x.is_investable&&x.symbol===S&&(!okIsin||!x.isin||x.isin===I))return {id:x.id,i:x,how:"symbole"};}}
  var cs=P&&P.instruments||[];
  for(var j=0;j<cs.length;j++){var c=cs[j];if((okIsin&&c.isin===I)||(!okIsin&&name&&nh(c.name)===nh(name)))return {id:c.id,i:c,how:"ligne perso"};}
  if(!okIsin&&!name&&!S)return null;
  var g=guess(name,I),draft=normCustom({id:"perso:"+(okIsin?I:slug(name||S)),name:clean(name,120)||S||I,symbol:S||(okIsin?I:""),isin:okIsin?I:null,
    asset_class:g.asset_class,vehicle:g.vehicle,currency:"EUR",auto:true});
  return {id:draft.id,i:draft,how:"nouvelle ligne",draft:true};
}
/**
 * Lit un CSV : détection de l'en-tête (10 premières lignes), du mode (positions ou opérations) et de chaque ligne.
 * @returns {{ok:boolean, error?:string, mode:"positions"|"operations", delim:string, header:string[], fields:Object, items:Object[], encoding?:string}}
 */
function readCSV(P,text){
  var C=parseCSV(text),rows=C.rows,hi=-1,map=null;
  if(rows.length>5001)return {ok:false,error:"Fichier trop long (5 000 lignes au plus).",items:[]};
  for(var k=0;k<Math.min(10,rows.length);k++){var m=mapHeader(rows[k]),n=Object.keys(m).length;if(n>=2&&(m.qty!=null||m.date!=null||m.value!=null)){hi=k;map=m;break;}}
  if(hi<0)return {ok:false,error:"En-tête non reconnu. Il faut au moins une colonne Quantité (positions) ou Date + Sens (opérations), avec ISIN ou Libellé.",delim:C.delim,items:[]};
  var mode=map.date!=null&&map.type!=null?"operations":"positions";
  if(mode==="positions"&&map.qty==null&&map.value==null)return {ok:false,error:"Colonne Quantité absente.",items:[]};
  if(map.isin==null&&map.name==null&&map.symbol==null&&mode==="positions")return {ok:false,error:"Il faut une colonne ISIN, Libellé ou Ticker pour reconnaître les lignes.",items:[]};
  var cell=function(r,f){return map[f]!=null?r[map[f]]:null;};
  var items=rows.slice(hi+1).map(function(r,n){
    var it={line:hi+n+2,isin:clean(cell(r,"isin"),20),name:clean(cell(r,"name"),120),symbol:clean(cell(r,"symbol"),20),qty:csvNum(cell(r,"qty")),pru:csvNum(cell(r,"pru")),
      price:csvNum(cell(r,"price")),value:csvNum(cell(r,"value")),currency:(clean(cell(r,"currency"),5)||"").toUpperCase()||null,fees:csvNum(cell(r,"fees")),
      date:map.date!=null?csvDate(cell(r,"date")):null,type:map.type!=null?txType(cell(r,"type")):null,raw_type:clean(cell(r,"type"),40),ok:true,err:"",note:""};
    if(it.currency&&!/^[A-Z]{3}$|^GBX$/.test(it.currency))it.currency=null;
    if(/^(total|sous total|solde|cumul)( |$)/.test(nh(it.name||it.isin||"")))return null;   // lignes de total des exports
    var needI=mode==="positions"||it.type==="achat"||it.type==="vente"||(it.type==="dividende"&&(it.isin||it.name||it.symbol));
    if(needI){var mi=matchInstr(P,it.isin,it.symbol,it.name);if(!mi){it.ok=false;it.err="Ni ISIN valide, ni libellé.";return it;}it.inst=mi;}
    if(mode==="positions"){
      if(it.qty==null&&it.value!=null){it.qty=1;it.manual=it.value;it.note="Montant seul : 1 part valant le montant (prix manuel).";}
      else if(it.inst&&it.inst.draft){var px=it.price!=null&&it.price>0?it.price:it.value!=null&&it.qty?Math.abs(it.value/it.qty):null;if(px){it.manual=px;it.note="Hors référentiel : prix manuel "+px.toLocaleString("fr-FR")+".";}}
      it.qty=it.qty!=null?Math.abs(it.qty):null;
      if(!(it.qty>0)){it.ok=false;it.err="Quantité absente ou nulle.";}
    }else{
      if(!it.date){it.ok=false;it.err="Date illisible.";}
      else if(!it.type){it.ok=false;it.err="Opération non reconnue ("+(it.raw_type||"vide")+").";}
      else if(it.type==="achat"||it.type==="vente"){
        it.qty=it.qty!=null?Math.abs(it.qty):null;if(it.price==null&&it.value!=null&&it.qty)it.price=Math.abs(it.value)/it.qty;
        if(!(it.qty>0)||it.price==null){it.ok=false;it.err="Quantité ou prix manquant.";}
      }else if(it.value==null&&!(it.price!=null&&it.qty)){it.ok=false;it.err="Montant manquant.";}
    }
    return it;
  }).filter(Boolean);
  return {ok:true,mode:mode,delim:C.delim,header:rows[hi],fields:map,items:items};
}
/**
 * Applique un import lu par readCSV. opts : {account_id, replace (positions du compte remplacées), file, date}.
 * Renvoie {P, added, skipped, dup, replaced, customs}. Les opérations déjà présentes (même date, type, instrument, quantité, prix, montant) sont ignorées.
 */
function applyCSV(P,R,opts){
  opts=opts||{};var acc=opts.account_id,origin="Import CSV"+(opts.file?" « "+clean(opts.file,60)+" »":"")+" du "+fr(opts.date||today());
  var out={P:norm(JSON.parse(JSON.stringify(P))),added:0,skipped:0,dup:0,replaced:0,customs:0};var Q=out.P;
  if(!Q.accounts.some(function(a){return a.id===acc;}))return Object.assign(out,{error:"Compte de destination inconnu."});
  var addCustom=function(mi){if(!mi||!mi.draft)return;if(Q.instruments.some(function(x){return x.id===mi.id;}))return;Q.instruments.push(normCustom(mi.i));out.customs++;};
  if(R.mode==="positions"){
    if(opts.replace){var n0=Q.holdings.length;Q.holdings=Q.holdings.filter(function(h){return h.account_id!==acc;});out.replaced=n0-Q.holdings.length;}
    R.items.forEach(function(it){if(!it.ok){out.skipped++;return;}addCustom(it.inst);
      var i=it.inst.i,manual=it.manual!=null||!quotable(i);
      Q.holdings.push(normHold({account_id:acc,instrument_id:it.inst.id,quantity:it.qty,average_purchase_price:it.pru!=null?Math.abs(it.pru):null,
        price_source:manual?"manuel":"marche",manual_price:manual?(it.manual!=null?it.manual:it.price):null,manual_price_date:manual?(opts.date||today()):null,origin:origin,updated_at:opts.date||today()}));out.added++;});
  }else{
    var sig=function(t){return [t.account_id,t.date,t.type,t.instrument_id||"",round(t.quantity||0,8),round(t.price||0,8),round(t.amount||0,6)].join("|");},have=dict();
    Q.transactions.forEach(function(t){have[sig(t)]=1;});
    R.items.forEach(function(it){if(!it.ok){out.skipped++;return;}
      var t=normTx({account_id:acc,instrument_id:it.inst?it.inst.id:null,date:it.date,type:it.type,quantity:it.qty||0,price:it.price,fees:it.fees||0,
        amount:it.type==="achat"||it.type==="vente"?null:it.value!=null?it.value:it.price!=null&&it.qty?it.price*it.qty:null,
        currency:it.currency||(it.inst&&it.inst.i&&it.inst.i.currency)||"EUR",origin:origin});
      var s=sig(t);if(have[s]){out.dup++;return;}have[s]=1;addCustom(it.inst);Q.transactions.push(t);out.added++;});
  }
  return out;
}

/* ================================================================
   Sauvegarde JSON (fichier gardé par l'utilisateur)
   ================================================================ */
function exportJSON(P){
  var o={_doc:"Sauvegarde du portefeuille du Desk (Captain Trading). Ce fichier contient tes comptes et tes positions : garde-le pour toi. Pour le recharger : Portefeuille → Importer.",
    format:FORMAT,v:1,exported_at:new Date(now()).toISOString(),accounts:P.accounts,holdings:P.holdings,transactions:P.transactions,instruments:P.instruments.map(function(i){var c=Object.assign({},i);delete c.custom;return c;})};
  return JSON.stringify(o,null,1);
}
/** Lit une sauvegarde : refuse les clés dangereuses et tout autre format. {ok, P, error, counts}. */
function importJSON(text){
  var r=M().safeJSON?M().safeJSON(text):(function(){try{return {ok:true,value:JSON.parse(text)};}catch(e){return {ok:false,error:"Fichier JSON illisible."};}})();
  if(!r.ok)return {ok:false,error:r.error};
  var v=r.value;if(!v||typeof v!=="object"||v.format!==FORMAT||!Array.isArray(v.accounts))return {ok:false,error:"Ce fichier n'est pas une sauvegarde de portefeuille du Desk."};
  var P=norm(v);return {ok:true,P:P,counts:{accounts:P.accounts.length,holdings:P.holdings.length,transactions:P.transactions.length,instruments:P.instruments.length}};
}

/* ================================================================
   Risques (historiques datés, poids actuels constants, en euros)
   ================================================================ */
function round(v,d){if(v==null||!isFinite(v))return v;var p=Math.pow(10,d||0);return Math.round(v*p)/p;}
/** Lundi (AAAA-MM-JJ, UTC) de la semaine d'un instant. */
function weekKey(t){var d=new Date(t),w=(d.getUTCDay()+6)%7;return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-w)).toISOString().slice(0,10);}
/** Dernière clôture de chaque semaine, convertie en euros au fixing du jour (fx(ccy, "AAAA-MM-JJ") → EUR pour 1). {semaine: prix €}. */
function weeklyEUR(bars,ccy,fx){
  var out=dict();(Array.isArray(bars)?bars:[]).forEach(function(b){var t=b&&(b.timestamp!=null?b.timestamp:b.t),c=b&&(b.close!=null?b.close:b.c);
    if(!fin(t)||!(c>0))return;var d=new Date(t).toISOString().slice(0,10),r=ccy==="EUR"?1:fx?fx(ccy,d):null;if(!(r>0))return;out[weekKey(t)]={t:t,v:c*r};});
  var o=dict();Object.keys(out).forEach(function(k){o[k]=out[k].v;});return o;
}
function mean(a){var s=0;for(var i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:0;}
function cov(a,b){var n=a.length;if(n<2)return null;var ma=mean(a),mb=mean(b),s=0;for(var i=0;i<n;i++)s+=(a[i]-ma)*(b[i]-mb);return s/(n-1);}
/**
 * lines : [{id, label, w (part du portefeuille total), weekly:{semaine: prix €}}] ; cashW = part des espèces (volatilité nulle).
 * opts : {weeks (156 par défaut), minWeeks (52), maxCorr (8)}.
 * Retourne volatilité annuelle, perte maximale et pires semaines du portefeuille simulé (poids constants, rééquilibré chaque semaine),
 * contributions au risque (somme = 100 %), corrélations, concentration (HHI, nombre effectif de lignes), couverture.
 */
function risk(lines,cashW,opts){
  opts=opts||{};var W=opts.weeks||156,MIN=opts.minWeeks||52,MAXC=opts.maxCorr||8;cashW=Math.max(0,cashW||0);
  lines=(lines||[]).filter(function(l){return l&&l.w>0;});
  var conc=concentration(lines.map(function(l){return {id:l.id,label:l.label,w:l.w};}));
  /* fenêtre commune : on retire la ligne à l'historique le plus court tant qu'il manque des semaines */
  var cand=lines.filter(function(l){return l.weekly&&Object.keys(l.weekly).length>MIN;}),unmeasured=lines.filter(function(l){return cand.indexOf(l)<0;});
  var weeks=[],R=[];
  while(cand.length){
    var all=null;cand.forEach(function(l){var ks=Object.keys(l.weekly).sort().slice(-(W+1));all=all==null?ks:all.filter(function(k){return l.weekly[k]!=null;});});
    all=(all||[]).filter(function(k){return cand.every(function(l){return l.weekly[k]!=null;});}).sort().slice(-(W+1));
    if(all.length>MIN){weeks=all;break;}
    var short=cand.slice().sort(function(a,b){return Object.keys(a.weekly).length-Object.keys(b.weekly).length;})[0];unmeasured.push(short);cand.splice(cand.indexOf(short),1);
  }
  var res={ok:false,weeks:0,from:null,to:null,coverage:0,unmeasured:unmeasured.map(function(l){return {id:l.id,label:l.label,w:l.w};}),concentration:conc,
    vol:null,mdd:null,worst:null,best:null,contrib:[],corr:null,divRatio:null,lineVol:[]};
  var measW=cand.reduce(function(s,l){return s+l.w;},0),base=measW+cashW;res.coverage=Math.min(1,base);
  if(!cand.length||weeks.length<=MIN||!(base>0))return res;
  cand.forEach(function(l){var r=[];for(var k=1;k<weeks.length;k++)r.push(l.weekly[weeks[k]]/l.weekly[weeks[k-1]]-1);R.push(r);});
  var n=cand.length,w=cand.map(function(l){return l.w/base;}),S=[];
  for(var i=0;i<n;i++){S.push([]);for(var j=0;j<n;j++)S[i][j]=j<i?S[j][i]:cov(R[i],R[j]);}
  var Sw=S.map(function(row){return row.reduce(function(s,v,j){return s+v*w[j];},0);}),varP=w.reduce(function(s,v,i){return s+v*Sw[i];},0);
  var rp=[];for(var k=0;k<R[0].length;k++){var x=0;for(var q=0;q<n;q++)x+=w[q]*R[q][k];rp.push(x);}
  var idx=1,peak=1,mdd=0;rp.forEach(function(x){idx*=1+x;if(idx>peak)peak=idx;var dd=idx/peak-1;if(dd<mdd)mdd=dd;});
  res.ok=true;res.weeks=rp.length;res.from=weeks[0];res.to=weeks[weeks.length-1];
  res.vol=Math.sqrt(Math.max(0,varP))*Math.sqrt(52);res.mdd=mdd;res.worst=Math.min.apply(null,rp);res.best=Math.max.apply(null,rp);
  res.lineVol=cand.map(function(l,i){return {id:l.id,label:l.label,w:l.w,vol:Math.sqrt(Math.max(0,S[i][i]))*Math.sqrt(52)};});
  var sumWS=res.lineVol.reduce(function(s,x,i){return s+w[i]*x.vol;},0);res.divRatio=res.vol>0?sumWS/res.vol:null;
  res.contrib=cand.map(function(l,i){return {id:l.id,label:l.label,w:l.w,rc:varP>0?w[i]*Sw[i]/varP:null};}).sort(function(a,b){return (b.rc||0)-(a.rc||0);});
  var top=cand.map(function(l,i){return {l:l,i:i};}).sort(function(a,b){return b.l.w-a.l.w;}).slice(0,MAXC);
  res.corr={ids:top.map(function(o){return o.l.id;}),labels:top.map(function(o){return o.l.label;}),
    m:top.map(function(a){return top.map(function(b){var s=Math.sqrt(S[a.i][a.i]*S[b.i][b.i]);return s>0?S[a.i][b.i]/s:null;});})};
  return res;
}
/** Concentration sur les lignes (hors espèces) : HHI = Σ part², nombre effectif = 1 / HHI. */
function concentration(items){
  var tot=items.reduce(function(s,x){return s+(x.w>0?x.w:0);},0);if(!(tot>0))return {hhi:null,neff:null,top:[],level:null};
  var s=items.filter(function(x){return x.w>0;}).map(function(x){return {id:x.id,label:x.label,w:x.w,s:x.w/tot};}).sort(function(a,b){return b.s-a.s;});
  var h=s.reduce(function(a,x){return a+x.s*x.s;},0);
  return {hhi:h,neff:1/h,top:s.slice(0,5),level:h<0.1?"diversifié":h<0.25?"modérément concentré":"concentré",n:s.length};
}

/* ================================================================
   Exemple (pour découvrir l'espace : marqué « Exemple », supprimable)
   ================================================================ */
function demo(){
  var d=today(),y=function(n){var t=new Date(now()-n*365.25*DAY);return t.toISOString().slice(0,10);};
  var P=empty();
  P.accounts=[normAcc({id:"demo_pea",name:"PEA (exemple)",account_type:"PEA",broker:"Exemple",opened_at:y(3.2),cash_balance:420,deposits_total:18000,demo:true}),
    normAcc({id:"demo_cto",name:"Compte-titres (exemple)",account_type:"CTO",broker:"Exemple",opened_at:y(2),cash_balance:150,demo:true}),
    normAcc({id:"demo_av",name:"Assurance-vie (exemple)",account_type:"assurance_vie",broker:"Exemple",opened_at:y(6),demo:true}),
    normAcc({id:"demo_cr",name:"Crypto (exemple)",account_type:"crypto_wallet",currency:"EUR",demo:true})];
  var H=function(a,id,q,pru,extra){return normHold(Object.assign({account_id:a,instrument_id:id,quantity:q,average_purchase_price:pru,origin:"Exemple",updated_at:d,demo:true},extra||{}));};
  P.holdings=[H("demo_pea","isin:LU1681043599",22,480),H("demo_pea","isin:FR0011871128",310,22.5),H("demo_pea","isin:FR0000120271",40,55),
    H("demo_cto","isin:IE00B5BMR087",12,470),H("demo_cto","isin:IE00B4ND3602",60,38,{fx_rate_at_purchase:0.93}),
    H("demo_cto","isin:US0378331005",8,185,{fx_rate_at_purchase:0.92}),
    H("demo_av","perso:FONDS-EUROS-EXEMPLE",1,null,{price_source:"manuel",manual_price:15200,manual_price_date:d}),
    H("demo_cr","crypto:BTC",0.05,52000,{fx_rate_at_purchase:0.93}),H("demo_cr","crypto:ETH",0.8,2400,{fx_rate_at_purchase:0.92})];
  P.instruments=[normCustom({id:"perso:FONDS-EUROS-EXEMPLE",name:"Fonds en euros (exemple)",symbol:"FONDS €",asset_class:"liquidites",vehicle:"fonds",currency:"EUR",notes:"Ligne d'exemple : valeur saisie à la main."})];
  P.transactions=[normTx({account_id:"demo_pea",date:y(0.3),type:"dividende",instrument_id:"isin:FR0000120271",amount:96,currency:"EUR",origin:"Exemple",demo:true})];
  return P;
}
function removeDemo(P){
  var ids=dict();P.accounts.forEach(function(a){if(a.demo)ids[a.id]=1;});
  P.accounts=P.accounts.filter(function(a){return !ids[a.id];});P.holdings=P.holdings.filter(function(h){return !ids[h.account_id]&&!h.demo;});
  P.transactions=P.transactions.filter(function(t){return !ids[t.account_id]&&!t.demo;});
  var used=dict();P.holdings.forEach(function(h){used[h.instrument_id]=1;});P.transactions.forEach(function(t){if(t.instrument_id)used[t.instrument_id]=1;});
  P.instruments=P.instruments.filter(function(i){return used[i.id];});return P;
}

CK.pfc={
  KEY:KEY,FORMAT:FORMAT,GROUPS:GROUPS,LIM:LIM,
  empty:empty,norm:norm,load:load,save:save,clear:clear,uid:uid,normAcc:normAcc,normHold:normHold,normTx:normTx,normCustom:normCustom,
  instr:instr,quotable:quotable,groupOf:groupOf,fxRate:fxRate,compute:compute,value:value,breakdown:breakdown,checks:checks,
  decode:decode,parseCSV:parseCSV,mapHeader:mapHeader,csvNum:csvNum,csvDate:csvDate,txType:txType,guess:guess,matchInstr:matchInstr,readCSV:readCSV,applyCSV:applyCSV,
  exportJSON:exportJSON,importJSON:importJSON,weekKey:weekKey,weeklyEUR:weeklyEUR,risk:risk,concentration:concentration,demo:demo,removeDemo:removeDemo,
  _reset:function(){MEM=null;}
};
})();
