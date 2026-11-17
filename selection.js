/* ================================================================
   COCKPIT — Sélection des instruments et placement par enveloppe (phase 5) : CK.sel
   Après le moteur d'allocation (allocation.js, poids par poche), choisit 1 à 3 instruments
   par poche puis les loge dans tes comptes, sans transfert entre enveloppes.
   Règles : CK.allow (classes et types cochés, levier, risque), enveloppe PEA toujours stricte
   (CK.pea.allowedIn), filtres zone / devise, données trop anciennes ou trop courtes refusées,
   poids maximum par instrument, liquidité minimale. Aucun ordre n'est jamais passé.
   Fonctions pures (aucun DOM, aucun réseau) : testables dans Node (vmkit.mjs).
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5;
function M(){return CK.models||{};}
function fin(x){return typeof x==="number"&&isFinite(x);}
function dict(){return Object.create(null);}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function selCfg(){return cfg().selection||{};}
function nz(v,d){return fin(v)?v:d;}
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function eur(v){return fin(v)?Math.round(v).toLocaleString("fr-FR")+" €":"—";}
function pctTxt(v){return fin(v)?(Math.round(v*1000)/10).toLocaleString("fr-FR")+" %":"—";}

/* ---------- Ce que chaque type de compte peut recevoir (achat proposé par le moteur) ---------- */
var TRADABLE={PEA:1,PEA_PME:1,CTO:1,crypto_wallet:1};
var ENV_ORDER={PEA:0,PEA_PME:1,CTO:2,crypto_wallet:3};
var ACC_LBL={PEA:"PEA",PEA_PME:"PEA-PME",CTO:"compte-titres",crypto_wallet:"portefeuille crypto",assurance_vie:"assurance-vie",bank_account:"compte bancaire",other:"autre compte"};
/** {ok, why} : un compte de ce type peut-il recevoir cet instrument ? Assurance-vie, banque et « autre » : univers manuel, jamais d'achat proposé. */
function accepts(type,i){
  if(!i)return {ok:false,why:"Instrument inconnu."};
  if(i.is_investable!==true)return {ok:false,why:"Non investissable."};
  if(!TRADABLE[type])return {ok:false,why:"Univers manuel ("+(ACC_LBL[type]||type)+") : aucun achat proposé."};
  if(type==="crypto_wallet")return i.vehicle==="spot_crypto"?{ok:true,why:""}:{ok:false,why:"Un portefeuille crypto ne détient que de la crypto au comptant."};
  if(i.vehicle==="spot_crypto")return {ok:false,why:"Crypto au comptant : seulement dans un portefeuille crypto."};
  if(i.vehicle==="cash")return {ok:false,why:"Liquidités : espèces du compte."};
  if(type==="PEA"||type==="PEA_PME"){var a=CK.pea&&CK.pea.allowedIn?CK.pea.allowedIn(i,type):{ok:false,reason:"Statut PEA inconnu."};return {ok:!!a.ok,why:a.ok?"":a.reason};}
  return {ok:true,why:""};
}

/* ---------- Coûts estimés (allocation.json → couts) ---------- */
/** Coût d'un ordre de N € : max(minimum, courtage) + (demi-spread + glissement) + change si l'instrument n'est pas en euros. */
function orderCost(N,type,i){
  var C=cfg().couts||{},c=C[type]||C.other||{},sp=C.spread_bps_defaut||{},a=Math.abs(nz(N,0));if(!(a>0))return 0;
  var spread=nz(i&&i.spread_bps,nz(sp[i&&i.vehicle],10)),fx=i&&i.currency&&i.currency!=="EUR"&&!(i.vehicle==="spot_crypto")?nz(c.fx_bps,0):0;
  return Math.max(nz(c.min_eur,0),a*nz(c.courtage_bps,0)/1e4)+a*(spread/2+nz(C.slippage_bps,0))/1e4+a*fx/1e4;
}
/** Impôt indicatif d'une vente (CTO, crypto : taux global de fiscal.json sur la part de plus-value ; PEA : rien tant que l'argent reste dans le plan). */
function saleTax(N,type,gainShare){
  var f=M().data?M().data("fiscal"):null,env=f&&f.enveloppes||{};if(!(N>0)||!(gainShare>0))return 0;
  if(type==="PEA"||type==="PEA_PME"||type==="assurance_vie"||type==="bank_account")return 0;
  var t=nz(env[type]&&env[type].taux_global,nz(env.CTO&&env.CTO.taux_global,31.4));return N*Math.min(1,gainShare)*t/100;
}

/* ---------- Candidats d'une poche ---------- */
function regionOk(i,list){return !list||!list.length||list.indexOf(i.region)>=0;}
function ccyOk(i,list){if(!list||!list.length)return true;var c=i.currency==="USDT"?"USD":i.currency;return list.indexOf(c)>=0||(list.indexOf("autre")>=0&&c!=="EUR"&&c!=="USD");}
function sameDayOrBefore(a,b){return String(a)<=String(b);}
/**
 * Tous les instruments du référentiel qui relèvent de la poche, avec pour chacun ok / motif et un score de sélection.
 * ctx : {prefs (effectives), T (ms), resume ({id:{d, first, n}} ou null), held ({id: €}), accounts ([{account_type}]), pocheOf(i), pea_mode, vols ({id: vol})}
 * Le score n'utilise aucune donnée instantanée : détention (moins de rotation), devise, statut PEA, frais, profondeur d'historique.
 */
function candidates(pid,ctx){
  var ref=CK.ref&&CK.ref.all?CK.ref.all():[],sc=selCfg(),out=[],P=ctx.prefs||{},L=P.limits||{},F=P.filters||{};
  var Td=new Date(ctx.T||Date.now()).toISOString().slice(0,10),maxAge=nz(sc.donnees_max_jours,7),minN=nz(sc.historique_min_seances_monetaire,60);
  var accs=(ctx.accounts||[]).filter(function(a){return TRADABLE[a.account_type];}),hasAcc=accs.length>0;
  var hasPEA=accs.some(function(a){return a.account_type==="PEA"&&!a.pea_full;});
  ref.forEach(function(i){
    if(!i||ctx.pocheOf(i)!==pid)return;
    var o={i:i,id:i.id,ok:true,why:"",score:50,reasons:[],held:nz(ctx.held&&ctx.held[i.id],0)};
    var no=function(w){if(o.ok){o.ok=false;o.why=w;}};
    var w=CK.allow?CK.allow.why(i,P):"Garde-fou absent.";if(w)no(w);
    if(o.ok&&i.asset_class==="stablecoin"&&pid==="crypto"&&!(P.classes&&P.classes.stablecoin))no("Stablecoin non coché.");
    if(o.ok&&!regionOk(i,F.regions))no("Zone hors de tes filtres.");
    if(o.ok&&!ccyOk(i,F.devises))no("Devise hors de tes filtres ("+i.currency+").");
    var pa=CK.pea&&CK.pea.allowedIn?CK.pea.allowedIn(i,"PEA"):{ok:false},pst=CK.pea&&CK.pea.status?CK.pea.status(i).status:"unknown";
    if(o.ok&&ctx.pea_mode==="strict"&&!pa.ok)no("Mode PEA strict : "+(pa.reason||"non éligible PEA."));
    if(o.ok&&i.launch_date&&!sameDayOrBefore(i.launch_date,Td))no("Lancé après la date de décision.");
    if(o.ok&&i.vehicle!=="spot_crypto"&&ctx.resume){var r=ctx.resume[i.id];
      if(!r)no("Aucun historique publié par le robot.");
      else if(r.first&&!sameDayOrBefore(r.first,Td))no("Pas encore coté à la date de décision.");
      else if(r.d&&new Date(Date.parse(r.d+"T00:00:00Z")+maxAge*DAY).toISOString().slice(0,10)<Td)no("Données trop anciennes (dernière clôture le "+frDate(r.d)+").");
      else if(fin(r.n)&&r.n<minN)no("Historique trop court ("+r.n+" séances).");}
    // liquidité : ETF à faible encours ET spread large (les deux connus)
    if(o.ok&&i.vehicle==="etf"&&fin(i.market_cap_eur)&&i.market_cap_eur<nz(sc.etf_encours_min_eur,5e7)&&fin(i.spread_bps)&&i.spread_bps>nz(sc.etf_spread_max_bps,30))no("Liquidité insuffisante (encours et spread).");
    if(o.ok&&hasAcc&&!accs.some(function(a){return accepts(a.account_type,i).ok;}))no("Aucun de tes comptes ne peut le recevoir ("+accepts(accs[0].account_type,i).why.replace(/\.$/,"")+").");
    // score de sélection (affiché avec ses raisons)
    var add=function(v,t){if(!v)return;o.score+=v;o.reasons.push({v:v,t:t});};
    if(o.held>0)add(25,"déjà détenu (moins de rotation)");
    if(i.currency==="EUR")add(5,"coté en euros");
    if(ctx.pea_mode==="prioritaire"){if(pa.ok)add(15,"éligible PEA (mode prioritaire)");else if(pst==="not_eligible")add(-30,"non éligible PEA (mode prioritaire)");else add(-5,"éligibilité PEA à vérifier");}
    if(hasPEA&&pa.ok&&ctx.pea_mode!=="strict")add(8,"logeable dans ton PEA");
    if(fin(i.ter))add(-Math.round(i.ter*100)/10,"frais "+String(i.ter).replace(".",",")+" %/an");
    var sp=nz(i.spread_bps,nz((cfg().couts||{}).spread_bps_defaut&&(cfg().couts||{}).spread_bps_defaut[i.vehicle],10));if(sp)add(-Math.round(sp/10)/2,"spread estimé "+sp+" pb");
    var r2=ctx.resume&&ctx.resume[i.id];if(r2&&r2.first){var yrs=(Date.parse(Td)-Date.parse(r2.first))/365.25/DAY;if(yrs>0)add(Math.min(5,Math.floor(yrs)),"historique de "+Math.floor(yrs)+" ans");}
    o.score=Math.round(o.score*10)/10;out.push(o);
  });
  out.sort(function(a,b){return (b.ok-a.ok)||(b.score-a.score)||(b.held-a.held)||(a.id<b.id?-1:a.id>b.id?1:0);});
  return out;
}
/** Une poche en titres en direct (actions, foncières) : le moteur garde les titres détenus et n'en choisit pas de nouveaux
    (la sélection de titres arrivera avec le screener mensuel). */
function stockOnly(cands){var ok=cands.filter(function(c){return c.ok;});return ok.length>0&&ok.every(function(c){return c.i.vehicle==="titre";});}
/** La poche a-t-elle au moins un instrument proposable ? {ok, why} */
function viable(pid,cands){
  var ok=cands.filter(function(c){return c.ok;});
  if(!ok.length){var w=cands.length?cands[0].why:"Aucun instrument de cette poche dans le référentiel.";return {ok:false,why:"Aucun instrument proposable : "+w.replace(/\.$/,"").replace(/^./,function(c){return c.toLowerCase();})+"."};}
  if(stockOnly(cands)&&!ok.some(function(c){return c.held>0;}))return {ok:false,why:"Aucun titre détenu : le choix de nouveaux titres en direct viendra avec le screener mensuel."};
  return {ok:true,why:""};
}

/* ---------- Choix des instruments d'une poche (montant cible en €) ---------- */
/**
 * cands : résultat de candidates() ; target : € à détenir dans la poche ; B : base totale (€) ; ctx.prefs.limits.max_par_instrument (%).
 * Les instruments autorisés déjà détenus sont gardés (pas de bascule inutile), le surplus va au meilleur score,
 * sans doublon d'exposition (alt_group). Crypto : inverse de la volatilité. Renvoie {lines:[{i, amount, held, score, reasons}], flags:[]}.
 */
function pick(pid,cands,target,B,ctx){
  var sc=selCfg(),NMAX=nz(sc.instruments_par_poche_max,3),cap=nz(ctx.prefs&&ctx.prefs.limits&&ctx.prefs.limits.max_par_instrument,100)/100*B,flags=[],used=ctx.used||{};
  var capOf=function(l){return Math.max(0,cap-nz(used[l.c.id],0));};
  var ok=cands.filter(function(c){return c.ok;});if(!(target>0)||!ok.length)return {lines:[],flags:flags};
  var grp=function(c){return c.i.alt_group||c.i.id;},chosen=[],seen=dict();
  var held=ok.filter(function(c){return c.held>0;}).sort(function(a,b){return b.held-a.held;});
  held.forEach(function(c){chosen.push(c);seen[grp(c)]=1;});
  var others=stockOnly(cands)?[]:ok.filter(function(c){return !(c.held>0);});
  if(pid==="crypto"){var pref=sc.cryptos_proposees||["crypto:BTC","crypto:ETH","crypto:SOL"];
    others=others.filter(function(c){return pref.indexOf(c.id)>=0||c.i.vehicle!=="spot_crypto";}).sort(function(a,b){
      var pa=pref.indexOf(a.id),pb=pref.indexOf(b.id);return (a.i.vehicle==="spot_crypto"?0:1)-(b.i.vehicle==="spot_crypto"?0:1)||(pa<0?99:pa)-(pb<0?99:pb)||b.score-a.score;});}
  var queue=others.filter(function(c){if(seen[grp(c)])return false;seen[grp(c)]=1;return true;});
  var lines=chosen.map(function(c){return {c:c,amount:0};}),addNext=function(){var c=queue.shift();if(!c)return null;var l={c:c,amount:0};lines.push(l);return l;};
  if(pid==="crypto"){
    // lignes détenues gardées (réduites au prorata si la cible baisse) ; le surplus va en inverse de la volatilité
    var sumC=lines.reduce(function(a,l){return a+l.c.held;},0);
    if(sumC>=target&&sumC>0)lines.forEach(function(l){l.amount=l.c.held*target/sumC;});
    else{
      while(lines.length<NMAX&&queue.length)addNext();
      var iv=lines.map(function(l){var v=ctx.vols&&ctx.vols[l.c.id];return v>0?1/v:1;}),s=iv.reduce(function(a,b){return a+b;},0),ex=target-sumC;
      lines.forEach(function(l,k){l.amount=l.c.held+ex*iv[k]/s;});
    }
    capFill(lines,capOf,flags,target,queue,NMAX);
  }else{
    var sumH=lines.reduce(function(a,l){return a+l.c.held;},0);
    if(sumH>=target&&sumH>0)lines.forEach(function(l){l.amount=l.c.held*target/sumH;});
    else{
      lines.forEach(function(l){l.amount=l.c.held;});var extra=target-sumH;
      if(!lines.length)addNext();
      // le surplus va d'abord à la meilleure ligne (score), jusqu'à son plafond
      var order=lines.slice().sort(function(a,b){return b.c.score-a.c.score;});
      order.forEach(function(l){if(extra<=0)return;var room=Math.max(0,capOf(l)-l.amount),x=Math.min(room,extra);l.amount+=x;extra-=x;});
      while(extra>1e-6&&lines.length<Math.max(NMAX,held.length)&&queue.length){var nl=addNext();var x2=Math.min(capOf(nl),extra);nl.amount=x2;extra-=x2;}
      if(extra>1e-6){var best=order[0]||lines[0];if(best){best.amount+=extra;flags.push({level:"attention",msg:"Plafond par instrument ("+pctTxt(cap/B)+") trop bas pour loger toute la poche : dépassé sur le meilleur instrument (élargis la limite ou coche d'autres types de produits)."});}}
    }
    capFill(lines,capOf,flags,target,queue,Math.max(NMAX,held.length));
  }
  return {lines:lines.filter(function(l){return l.amount>0.005||l.c.held>0;}).map(function(l){return {i:l.c.i,id:l.c.id,amount:l.amount,held:l.c.held,score:l.c.score,reasons:l.c.reasons};}),flags:flags};
}
/** Ramène chaque ligne à son plafond ; l'excédent va aux autres lignes, puis à de nouvelles lignes, sinon il reste sur la meilleure (signalé). */
function capFill(lines,capOf,flags,target,queue,nmax){
  var guard=0,over=0;
  lines.forEach(function(l){var c=capOf(l);if(l.amount>c+1e-6){over+=l.amount-c;l.amount=c;}});
  while(over>1e-6&&guard++<20){
    var room=lines.filter(function(l){return l.amount<capOf(l)-1e-6;});
    if(!room.length){if(lines.length<nmax&&queue.length){var c=queue.shift();lines.push({c:c,amount:0});continue;}break;}
    var tot=room.reduce(function(s,l){return s+(capOf(l)-l.amount);},0),give=Math.min(over,tot);
    room.forEach(function(l){var x=give*(capOf(l)-l.amount)/tot;l.amount+=x;});over-=give;
  }
  if(over>1e-6){var b=lines.slice().sort(function(a,b2){return b2.c.score-a.c.score;})[0];if(b)b.amount+=over;
    if(!flags.some(function(f){return /Plafond par instrument/.test(f.msg);}))flags.push({level:"attention",msg:"Plafond par instrument trop bas pour loger toute la poche : dépassé sur le meilleur instrument (élargis la limite ou coche d'autres types de produits)."});}
}

/* ---------- Placement dans les enveloppes et ordres indicatifs ---------- */
/**
 * Répartit la cible de chaque poche (€) entre tes comptes, SANS transfert entre enveloppes : chaque compte garde son argent
 * (espèces + lignes + sa part du versement) ; seul le versement non affecté peut aller là où il sert (PEA d'abord, dans la
 * limite du plafond de versements). Méthode : ajustement proportionnel itératif à partir de ce que tu détiens déjà, ce qui
 * respecte les budgets des comptes et les cibles des poches en bougeant le moins possible. Une poche qu'aucun compte ne peut
 * recevoir est redistribuée sur les autres (signalé). Puis, dans chaque compte, choix des instruments (pick) et ordres.
 *
 * targets : {poche: €} (liquidités = espèces des comptes) ; cands : {poche: candidates()} ;
 * pf : {accounts:[{id, name, account_type, cash_eur, pea_left}], holdings:[{account_id, instrument_id, value, price, fx, pru, fxb, i, locked, poche}]} ;
 * opts : {contribution, split ({compte: %}), min_order, B (base totale), ctx (pour pick), unit(id) → € par part}.
 * Renvoie {orders, assign ({compte:{id: €}}), byPoche ({poche:{compte: €}}), lines ({poche:[{id, i, amount, held}]}), cash, contrib, unmet ({poche: €}), flags, invariants}.
 */
function place(targets,cands,pf,opts){
  opts=opts||{};var flags=[],accs=(pf.accounts||[]).filter(function(a){return TRADABLE[a.account_type];});
  var C=Math.max(0,nz(opts.contribution,0)),minO=nz(opts.min_order,nz(selCfg().ordre_min_eur,50)),B=nz(opts.B,1);
  var heldE=dict(),heldP=dict(),hInfo=dict(),budget=dict(),cash0=dict(),contrib=dict(),room=dict(),assign=dict();
  accs.forEach(function(a){heldE[a.id]=dict();heldP[a.id]=dict();assign[a.id]=dict();contrib[a.id]=0;cash0[a.id]=Math.max(0,nz(a.cash_eur,0));budget[a.id]=cash0[a.id];
    room[a.id]=a.account_type==="PEA"||a.account_type==="PEA_PME"?(fin(a.pea_left)?Math.max(0,a.pea_left):Infinity):Infinity;});
  (pf.holdings||[]).forEach(function(h){if(!heldE[h.account_id]||h.locked||!(h.value>0))return;var a=h.account_id;
    heldE[a][h.instrument_id]=(heldE[a][h.instrument_id]||0)+h.value;budget[a]+=h.value;hInfo[a+"|"+h.instrument_id]=h;
    var p=h.poche||"autre";heldP[a][p]=(heldP[a][p]||0)+h.value;});
  // versement du mois : selon tes pourcentages, sinon libre
  var flex=0,split=opts.split||{},sk=Object.keys(split).filter(function(k){return heldE[k]&&split[k]>0;}),st=sk.reduce(function(s,k){return s+split[k];},0);
  if(C>0&&st>0)sk.forEach(function(k){var x=C*split[k]/st,ok=Math.min(x,room[k]);contrib[k]+=ok;budget[k]+=ok;room[k]-=ok;if(x-ok>0.005){flex+=x-ok;
      flags.push({level:"attention",msg:"Plafond de versements atteint sur "+nameOf(accs,k)+" : "+eur(x-ok)+" du versement vont vers un autre compte."});}});
  else flex=C;
  var canE=function(a,p){if(p==="liquidites")return true;var cs=cands[p]||[];
    if(stockOnly(cs))return (heldP[a.id][p]||0)>0;
    return cs.some(function(c){return c.ok&&accepts(a.account_type,c.i).ok;});};
  var rows=accs.map(function(a){return {id:a.id,a:a,cap:budget[a.id]};});
  if(flex>0.005)rows.push({id:"__flex",flex:true,cap:flex});
  var canR=function(r,p){return r.flex?accs.some(function(a){return room[a.id]>0.005&&canE(a,p);}):canE(r.a,p);};
  var tg=dict(),unmet=dict(),cols=[];
  Object.keys(targets).forEach(function(p){var v=Math.max(0,nz(targets[p],0));if(!(v>0.005))return;
    if(!rows.some(function(r){return canR(r,p);})){unmet[p]=v;return;}tg[p]=v;cols.push(p);});
  var capTot=rows.reduce(function(s,r){return s+r.cap;},0),tgTot=cols.reduce(function(s,p){return s+tg[p];},0);
  if(Object.keys(unmet).length)flags.push({level:"attention",msg:"Aucun de tes comptes ne peut recevoir "+Object.keys(unmet).map(function(p){return CK.alloc?CK.alloc.label(p):p;}).join(", ")+" : poids redistribué sur tes autres classes."});
  if(!cols.length&&capTot>0){cols=["liquidites"];tg.liquidites=capTot;tgTot=capTot;}
  if(tgTot>0&&capTot>0)cols.forEach(function(p){tg[p]*=capTot/tgTot;});   // les poches redistribuées remplissent la place laissée
  // ajustement proportionnel itératif, en partant des positions actuelles (+ une petite part neutre pour ouvrir de nouvelles lignes)
  var X=rows.map(function(r){var o=dict();cols.forEach(function(p){o[p]=canR(r,p)?(r.flex?0:nz(heldP[r.id]&&heldP[r.id][p],0))+0.05*r.cap*tg[p]/capTot+1e-6:0;});return o;});
  for(var it=0;it<400;it++){
    rows.forEach(function(r,k){var s=cols.reduce(function(a,p){return a+X[k][p];},0);if(s>0)cols.forEach(function(p){X[k][p]*=r.cap/s;});});
    var dev=0;cols.forEach(function(p){var s=X.reduce(function(a,row){return a+row[p];},0);if(s>0){X.forEach(function(row){row[p]*=tg[p]/s;});dev=Math.max(dev,Math.abs(s-tg[p]));}});
    if(dev<0.01)break;
  }
  rows.forEach(function(r,k){var s=cols.reduce(function(a,p){return a+X[k][p];},0);if(s>0)cols.forEach(function(p){X[k][p]*=r.cap/s;});});
  var gap=[];cols.forEach(function(p){var s=X.reduce(function(a,row){return a+row[p];},0),d=s-tg[p];if(Math.abs(d)>Math.max(50,0.02*tg[p]))gap.push({p:p,d:d});});
  if(gap.length)flags.push({level:"attention",msg:"Sans transfert entre comptes, la cible n'est pas atteinte exactement : "+gap.map(function(g){return (CK.alloc?CK.alloc.label(g.p):g.p)+" "+(g.d>0?"+":"−")+eur(Math.abs(g.d));}).join(", ")+"."});
  // le versement libre rejoint le compte qui peut recevoir chaque poche (PEA d'abord, dans la limite du plafond)
  var xE=dict();accs.forEach(function(a){xE[a.id]=dict();});
  rows.forEach(function(r,k){cols.forEach(function(p){var v=X[k][p];if(!(v>0.005))return;
    if(!r.flex){xE[r.id][p]=(xE[r.id][p]||0)+v;return;}
    accs.filter(function(a){return canE(a,p);}).sort(function(a,b){return ENV_ORDER[a.account_type]-ENV_ORDER[b.account_type];}).forEach(function(a){if(!(v>0.005))return;
      var y=Math.min(v,room[a.id]);if(!(y>0))return;xE[a.id][p]=(xE[a.id][p]||0)+y;contrib[a.id]+=y;room[a.id]-=y;v-=y;});
    if(v>0.005){var d=accs.filter(function(a){return room[a.id]>=v;}).sort(function(a,b){return ENV_ORDER[a.account_type]-ENV_ORDER[b.account_type];})[0];
      if(d){xE[d.id].liquidites=(xE[d.id].liquidites||0)+v;contrib[d.id]+=v;room[d.id]-=v;}}});});
  // instruments, compte par compte (lignes déjà détenues dans le compte d'abord)
  var lines=dict(),byPoche=dict(),used=dict(),ctx=Object.assign({},opts.ctx||{},{used:used});
  accs.forEach(function(a){Object.keys(xE[a.id]).forEach(function(p){var amt=xE[a.id][p];(byPoche[p]=byPoche[p]||dict())[a.id]=amt;if(p==="liquidites"||!(amt>0.5))return;
    var cs=(cands[p]||[]).map(function(c){var ok=c.ok&&accepts(a.account_type,c.i).ok;return Object.assign({},c,{ok:ok,why:ok?c.why:c.why||accepts(a.account_type,c.i).why,held:nz(heldE[a.id][c.id],0)});});
    var pk=pick(p,cs,amt,B,ctx);pk.flags.forEach(function(f){if(!flags.some(function(x){return x.msg===f.msg;}))flags.push(f);});
    var got=0;pk.lines.forEach(function(l){if(!(l.amount>0.005))return;assign[a.id][l.id]=(assign[a.id][l.id]||0)+l.amount;used[l.id]=(used[l.id]||0)+l.amount;got+=l.amount;
      var L=(lines[p]=lines[p]||[]),ex=L.filter(function(x){return x.id===l.id;})[0];if(ex){ex.amount+=l.amount;ex.held+=l.held;}else L.push({id:l.id,i:l.i,amount:l.amount,held:l.held,score:l.score,reasons:l.reasons});});
    if(amt-got>0.5)flags.push({level:"info",msg:eur(amt-got)+" de "+(CK.alloc?CK.alloc.label(p):p)+" restent en espèces dans "+a.name+" (aucun instrument logeable)."});});});
  // ordres = cible du compte − détenu ; petits ordres ignorés ; achats jamais au-delà des espèces + versement + ventes
  var orders=[],unit=opts.unit||function(){return null;},T=dict();
  Object.keys(lines).forEach(function(p){lines[p].forEach(function(l){T[l.id]=l.i;});});
  accs.forEach(function(a){
    var all=dict();Object.keys(heldE[a.id]).forEach(function(k){all[k]=1;});Object.keys(assign[a.id]).forEach(function(k){all[k]=1;});
    var buys=[],sells=0;
    Object.keys(all).sort().forEach(function(id){var cur=heldE[a.id][id]||0,tgt=assign[a.id][id]||0,d=tgt-cur;if(Math.abs(d)<0.005)return;
      var h=hInfo[a.id+"|"+id],i=T[id]||h&&h.i,o={account_id:a.id,account:a.name,account_type:a.account_type,instrument_id:id,i:i,side:d>0?"achat":"vente",amount:Math.abs(d),current:cur,target:tgt,all:tgt<0.005,tax:0};
      if(Math.abs(d)<minO&&!(o.all&&d<0))o.skipped=true;
      if(o.side==="vente"&&!o.skipped){sells+=o.amount;var px=h&&h.price,fx=h&&h.fx||1,pru=h&&h.pru,fxb=h&&h.fxb||fx;
        var gs=px>0&&pru!=null?(px*fx-pru*fxb)/(px*fx):0;o.gain_share=gs;o.tax=saleTax(o.amount,a.account_type,gs);}
      if(o.side==="achat")buys.push(o);orders.push(o);});
    var avail=cash0[a.id]+contrib[a.id]+sells,want=buys.filter(function(o){return !o.skipped;}).reduce(function(s,o){return s+o.amount;},0);
    if(want>avail+0.01&&want>0){var r=Math.max(0,avail)/want;buys.forEach(function(o){if(!o.skipped)o.amount*=r;});}
    buys.forEach(function(o){if(!o.skipped&&o.amount<minO)o.skipped=true;});
  });
  orders.forEach(function(o){o.cost=o.skipped?0:orderCost(o.amount,o.account_type,o.i);if(o.skipped)o.tax=0;
    var h=hInfo[o.account_id+"|"+o.instrument_id],p=h&&h.price>0?h.price*(h.fx||1):unit(o.instrument_id);o.unit_eur=p>0?p:null;o.qty=p>0?o.amount/p:null;});
  var cash=dict();accs.forEach(function(a){var c=cash0[a.id]+contrib[a.id];orders.forEach(function(o){if(o.account_id!==a.id||o.skipped)return;c+=o.side==="vente"?o.amount:-o.amount;});cash[a.id]=c;});
  var inv={buys_ok:accs.every(function(a){var b=0,s=0;orders.forEach(function(o){if(o.account_id!==a.id||o.skipped)return;if(o.side==="achat")b+=o.amount;else s+=o.amount;});return b<=cash0[a.id]+contrib[a.id]+s+0.01;}),
    no_transfer:true,contrib_total:Object.keys(contrib).reduce(function(s,k){return s+contrib[k];},0),pea_room_ok:accs.every(function(a){return room[a.id]>=-0.01;})};
  var small=orders.filter(function(o){return o.skipped;}).length;if(small)flags.push({level:"info",msg:small+" petit(s) mouvement(s) sous "+eur(minO)+" ignoré(s) pour éviter des frais inutiles."});
  return {orders:orders,assign:assign,byPoche:byPoche,lines:lines,cash:cash,contrib:contrib,unmet:unmet,flags:flags,invariants:inv};
}
function nameOf(accs,id){var a=accs.filter(function(x){return x.id===id;})[0];return a?a.name:id;}

/* ---------- Alternatives éligibles PEA (positions non éligibles ou demandées hors PEA) ---------- */
/** Pour une ligne non éligible détenue en CTO : alternatives (même exposition) et coût d'une bascule (impôt estimé + versement consommé). */
function peaSwitch(line,prefs){
  var i=line&&line.i;if(!i||!CK.pea)return null;var st=CK.pea.status(i);if(st.status==="eligible"||st.status==="eligible_regle")return null;
  var alts=CK.pea.alternatives(i).filter(function(x){return !prefs||CK.allow(x,prefs);}).slice(0,3);if(!alts.length)return {i:i,line:line,alts:[],why:st.reason};
  var gs=line.price>0&&line.pru!=null?(line.price*(line.fx||1)-line.pru*(line.fxb||line.fx||1))/(line.price*(line.fx||1)):0;
  return {i:i,line:line,alts:alts,why:st.reason,tax:saleTax(line.value,line.account_type||"CTO",gs),deposit:line.value};
}

CK.sel={TRADABLE:TRADABLE,nameOf:nameOf,ENV_ORDER:ENV_ORDER,accepts:accepts,orderCost:orderCost,saleTax:saleTax,candidates:candidates,viable:viable,stockOnly:stockOnly,pick:pick,place:place,peaSwitch:peaSwitch};
})();
