/* ================================================================
   COCKPIT — Espace « Portefeuille » (phase 4) : CK.pf
   Synthèse (valeur, plus-value prix / change, jour, espèces, comptes), onglets Positions ·
   Opérations · Répartition · Allocation (allocui.js, proposition du mois) · Backtest (btui.js) · Risques · Comptes, fenêtres de saisie, import CSV / sauvegarde.
   Le portefeuille reste dans ce navigateur (CK.pfc) : jamais envoyé sur internet.
   Rien n'est chargé avant la première ouverture de l'espace : cotations seulement des lignes
   détenues (un abonnement CK.mkt, arrêté à la sortie), historiques seulement dans l'onglet Risques.
   Les fonctions de rendu (CK.pf._t) n'utilisent pas le DOM : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

/* ---------- Petits outils ---------- */
function U(){return CK.u||{};}
function esc(s){var f=U().esc;return f?f(s):String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function nf(v,d){if(v==null||!isFinite(v))return "—";return Number(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});}
function fin(x){return typeof x==="number"&&isFinite(x)?x:null;}
function F(){return CK.pfc;}
function M(){return CK.models||{};}
function dict(){return Object.create(null);}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function today(){return new Date(now()).toISOString().slice(0,10);}
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function hhmm(ts){try{return new Date(ts).toLocaleTimeString("fr-FR",{timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit"});}catch(e){return "";}}
function disclaimer(){return CK.DISCLAIMER||M().DISCLAIMER||"";}
function cl(v){return v>0.005?"up":v<-0.005?"down":"";}
var HIDE="•••";
/** Montant en euros (masqué si « Masquer les montants »). */
function money(v,hide,dec){if(v==null||!isFinite(v))return "—";if(hide)return HIDE+" €";var a=Math.abs(v);dec=dec!=null?dec:a>=1000?0:2;return nf(v,dec)+" €";}
function smoney(v,hide){if(v==null||!isFinite(v))return "—";if(hide)return (v>=0?"+":"−")+HIDE+" €";var a=Math.abs(v);return (v>0.005?"+":v<-0.005?"−":"")+nf(a,a>=1000?0:2)+" €";}
function pct(v,d){if(v==null||!isFinite(v))return "—";d=d==null?1:d;var r=Math.abs(v*100)<Math.pow(10,-d)/2?0:v*100;return (r>0?"+":r<0?"−":"")+nf(Math.abs(r),d)+" %";}
function share(v){return v==null||!isFinite(v)?"—":nf(v*100,1)+" %";}
function qtyTxt(q){if(q==null)return "—";var a=Math.abs(q);return nf(q,a>=1000||a===Math.round(a)?0:a>=1?2:6);}
function pxTxt(v){if(v==null||!isFinite(v))return "—";var a=Math.abs(v);return nf(v,a>=1?2:a>=0.01?4:6);}
function accType(t){var l=(M().ACCOUNT_TYPES||[]).filter(function(x){return x.id===t;})[0];return l?l.label:t;}
var ACC_SHORT={PEA:"PEA",PEA_PME:"PEA-PME",CTO:"CTO",assurance_vie:"AV",crypto_wallet:"Crypto",bank_account:"Banque",other:"Autre"};

/* ---------- Onglets ---------- */
var TABS=[{id:"positions",label:"Positions"},{id:"operations",label:"Opérations"},{id:"repartition",label:"Répartition"},{id:"allocation",label:"Allocation"},{id:"backtest",label:"Backtest"},{id:"risques",label:"Risques"},{id:"comptes",label:"Comptes"}];
var TAB_IDS=TABS.map(function(t){return t.id;});
var PEAF=[{id:"tous",label:"Tous"},{id:"eligibles",label:"Éligibles PEA"},{id:"verifier",label:"+ à vérifier"}];
var PEA_UI={eligible:["ok","PEA"],eligible_regle:["rule","PEA (règle)"],not_eligible:["no","Non PEA"],unknown:["unk","À vérifier"]};
function peaOf(i){return i&&CK.pea&&CK.pea.status?CK.pea.status(i):{status:"unknown",label:"Éligibilité à vérifier",source:null,checked_at:null,by:"inconnu"};}
/** Même filtre que l'espace Marchés (réglage commun « mk:pea ») : une ligne non éligible n'est jamais affichée avec « Éligibles PEA ». */
function peaPass(i,f){if(!f||f==="tous")return true;var s=peaOf(i).status;return s==="eligible"||s==="eligible_regle"||(f==="verifier"&&s==="unknown");}
function peaBadge(i){
  if(!i)return '<span class="mk-pea unk">?</span>';var s=peaOf(i),m=PEA_UI[s.status]||PEA_UI.unknown;
  var t=s.label+(s.source?" · source : "+s.source:"")+(s.checked_at?" · vérifié le "+frDate(s.checked_at):"");
  return '<span class="mk-pea '+m[0]+'" title="'+esc(t)+'">'+esc(m[1])+'</span>';
}

/* ================================================================
   Rendu (sans DOM)
   ================================================================ */
function tile(k,v,cls,sub){return '<div class="pf-kpi"><em>'+esc(k)+'</em><b class="'+(cls||"")+'">'+v+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</div>';}
/** Bandeau de synthèse. */
function resumeHTML(P,V,o){
  o=o||{};var h=!!o.hide,t=V.total,demo=P.accounts.length&&P.accounts.every(function(a){return a.demo;});
  if(!P.accounts.length)return emptyHTML();
  var px=t.pnl_px,fx=t.pnl_fx,real=t.realized+t.dividends;
  var head='<div class="pf-kpis">'+
    tile("Valeur totale",money(t.value,h,0),"pf-big",t.unpriced||t.unconvertible?'<i class="warn">'+(t.unpriced+t.unconvertible)+' ligne'+(t.unpriced+t.unconvertible>1?"s":"")+' sans cours</i>':esc(nf(V.lines.filter(function(L){return L.value!=null;}).length,0))+" lignes · "+esc(V.accounts.length)+" compte"+(V.accounts.length>1?"s":""))+
    tile("Plus-value latente",smoney(t.pnl,h),cl(t.pnl),pct(t.pnl_pct)+' · dont prix '+smoney(px,h)+' · change '+smoney(fx,h))+
    tile("Aujourd'hui",t.dayBase>0?smoney(t.day,h):"—",cl(t.day),t.dayBase>0?pct(t.day_pct,2)+" sur les lignes cotées":"marchés fermés ou cours en attente")+
    tile("Espèces",money(t.cash,h),"",share(t.value>0?t.cash/t.value:null)+" du total")+
    tile("Réalisé + dividendes",smoney(real,h),cl(real),"frais : "+money(t.fees,h))+'</div>';
  var accs='<div class="pf-accs">'+V.accounts.map(function(a){var on=o.acc===a.id;
    return '<button type="button" class="pf-acc'+(on?" on":"")+'" data-pf="acc" data-id="'+esc(a.id)+'" aria-pressed="'+(on?"true":"false")+'" title="Afficher seulement ce compte">'+
      '<span class="pf-acct">'+esc(ACC_SHORT[a.account_type]||"")+'</span><b>'+esc(a.name)+'</b><em>'+money(a.value,h,0)+' · '+share(a.weight)+'</em></button>';}).join("")+'</div>';
  var acts='<div class="pf-acts">'+
    '<button type="button" class="btn sm primary" data-pf="add-pos">+ Position</button>'+
    '<button type="button" class="btn sm" data-pf="add-tx">+ Opération</button>'+
    '<button type="button" class="btn sm" data-pf="add-acc">+ Compte</button>'+
    '<button type="button" class="btn sm" data-pf="import">Importer</button>'+
    '<button type="button" class="btn sm" data-pf="export">Sauvegarder</button>'+
    '<button type="button" class="btn sm" data-pf="al-prefs" title="Classes d\'actifs autorisées, profil, PEA, versement, limites">Mes règles</button>'+
    '<button type="button" class="btn sm" data-pf="hide" aria-pressed="'+(h?"true":"false")+'" title="Pour partager ton écran sans montrer tes montants">'+(h?"Afficher les montants":"Masquer les montants")+'</button></div>';
  return (demo?'<div class="pf-banner info"><b>Exemple</b> : ces comptes sont fictifs, pour découvrir l\'espace. <button type="button" class="btn sm" data-pf="undemo">Retirer l\'exemple</button></div>':'')+
    backupHTML(P,o)+head+accs+acts+
    '<p class="pf-priv">🔒 Ton portefeuille reste dans ce navigateur : il n\'est envoyé nulle part (ni internet, ni GitHub). Seuls les cours des lignes sont demandés aux sources de marché, sans tes quantités.</p>';
}
function emptyHTML(){
  return '<div class="pf-empty"><h3>Ton portefeuille, tous comptes réunis</h3>'+
    '<p>PEA, PEA-PME, compte-titres, assurance-vie, crypto, compte bancaire : valorisation en euros, plus-value (prix et change), répartition et risques.</p>'+
    '<div class="pf-acts"><button type="button" class="btn sm primary" data-pf="add-acc">Créer un compte</button><button type="button" class="btn sm" data-pf="import">Importer un fichier de mon courtier</button>'+
    '<button type="button" class="btn sm" data-pf="demo">Voir un exemple</button></div>'+
    '<p class="pf-priv">🔒 Tout reste dans ce navigateur : rien n\'est envoyé sur internet. Pense à sauvegarder ton portefeuille dans un fichier (bouton « Sauvegarder »).</p></div>';
}
/** Rappel de sauvegarde : le stockage du navigateur peut être effacé (nettoyage, autre appareil). */
function backupHTML(P,o){
  if(!P.accounts.length||P.accounts.every(function(a){return a.demo;}))return "";
  var up=Date.parse(P.updated_at||""),ex=Date.parse(P.exported_at||""),T=o&&o.now||now();
  var msg=!isFinite(ex)?"Ton portefeuille n'existe que dans ce navigateur : sauvegarde-le dans un fichier.":
    isFinite(up)&&up>ex+6e4&&T-ex>7*864e5?"Modifié depuis ta dernière sauvegarde du "+frDate(new Date(ex).toISOString())+".":"";
  return msg?'<div class="pf-banner warn">'+esc(msg)+' <button type="button" class="btn sm" data-pf="export">Sauvegarder maintenant</button></div>':"";
}
function checksHTML(list,max){
  if(!list.length)return "";var lv={alerte:["down","!"],attention:["warn","!"],info:["","i"]};
  var shown=list.slice(0,max||6),more=list.length-shown.length;
  return '<ul class="pf-checks">'+shown.map(function(c){var m=lv[c.level]||lv.info;return '<li class="pf-ck-'+esc(c.level)+'"><i class="'+m[0]+'" aria-hidden="true">'+m[1]+'</i><span><b>'+esc(c.level==="alerte"?"Alerte":c.level==="attention"?"À vérifier":"Info")+'</b> · '+esc(c.text)+'</span></li>';}).join("")+
    (more>0?'<li class="pf-ck-more"><button type="button" class="btn sm" data-pf="tab" data-id="comptes">'+more+' autre'+(more>1?"s":"")+' contrôle'+(more>1?"s":"")+'</button></li>':'')+'</ul>';
}

/* ---------- Positions ---------- */
var PCOLS=["Instrument","Quantité","PRU","Cours","Valeur","Poids","Plus-value","dont change","Jour","PEA","Origine"];
function lineName(L){var i=L.i;return i?{s:i.symbol||"",n:i.name||"",ccy:i.currency||L.currency}:{s:L.instrument_id,n:"Instrument inconnu",ccy:L.currency};}
function posRow(L,h){
  var n=lineName(L),i=L.i,src=L.kind==="marche"?esc(L.src||"")+(L.ts?" · "+esc(hhmm(L.ts)):"")+(L.stale?' · <em class="warn">ancien</em>':""):
    L.kind==="cloture"?"clôture du "+esc(frDate(new Date(L.ts||0).toISOString())):L.kind==="manuel"?"prix manuel"+(L.manual_price_date?" du "+esc(frDate(L.manual_price_date)):""):L.kind==="pru"?'<em class="warn">cours indisponible</em>':"—";
  var tag=i&&i.custom?' <em class="pf-tag" title="Hors référentiel : prix saisi à la main">perso</em>':"";
  return '<tr class="clk pf-row" data-pf="edit-pos" data-id="'+esc(L.key)+'" tabindex="0">'+
    '<td class="mk-nm"><b>'+esc(n.s)+tag+'<em>'+esc(n.ccy||"")+'</em></b><span>'+esc(n.n)+'</span></td>'+
    '<td class="r">'+(h?HIDE:qtyTxt(L.quantity))+'</td>'+
    '<td class="r">'+pxTxt(L.pru)+'</td>'+
    '<td class="r"><span class="pf-px">'+pxTxt(L.price)+'</span><small class="pf-src">'+src+'</small></td>'+
    '<td class="r"><b>'+money(L.value,h)+'</b></td>'+
    '<td class="r">'+share(L.weight)+'</td>'+
    '<td class="r '+cl(L.pnl)+'">'+smoney(L.pnl,h)+'<small>'+pct(L.pnl_pct)+'</small></td>'+
    '<td class="r '+cl(L.pnl_fx)+'">'+(L.currency&&L.currency!=="EUR"&&L.pnl_fx!=null?smoney(L.pnl_fx,h):'<span class="mk-dim">—</span>')+'</td>'+
    '<td class="r '+cl(L.day)+'">'+(L.day!=null?smoney(L.day,h):'<span class="mk-dim">—</span>')+'</td>'+
    '<td>'+peaBadge(i)+'</td>'+
    '<td class="pf-orig">'+esc(L.origins.join(" + "))+'</td></tr>';
}
function cashRow(a,h){
  return '<tr class="pf-cash"><td class="mk-nm"><b>Espèces<em>'+esc(a.currency)+'</em></b><span>solde du compte</span></td><td></td><td></td><td></td>'+
    '<td class="r"><b>'+money(a.cash_eur,h)+'</b></td><td class="r">'+share(a.weight&&a.value?a.cash_eur/a.value*a.weight:null)+'</td><td></td><td></td><td></td><td></td><td class="pf-orig">'+(a.cash<-0.005?'<em class="warn">négatif</em>':"compte")+'</td></tr>';
}
/** Tableau des positions, groupé par compte (sous-total), filtres compte et PEA. */
function positionsHTML(V,o){
  o=o||{};var h=!!o.hide,f=o.peaf||"tous",hidden=0;
  var accs=V.accounts.filter(function(a){return !o.acc||a.id===o.acc;});
  var body=accs.map(function(a){
    var ls=V.lines.filter(function(L){return L.account_id===a.id&&L.quantity>0;}).sort(function(x,y){return (y.value||0)-(x.value||0);});
    var vis=ls.filter(function(L){var ok=peaPass(L.i,f);if(!ok)hidden++;return ok;});
    return '<tr class="mk-grp pf-grp"><th colspan="'+PCOLS.length+'"><span>'+esc(a.name)+' <em>'+esc(accType(a.account_type))+(a.broker?" · "+esc(a.broker):"")+'</em></span><span class="pf-gv">'+money(a.value,h,0)+(a.cost>0?' · <i class="'+cl(a.pnl)+'">'+smoney(a.pnl,h)+'</i>':'')+'</span></th></tr>'+
      vis.map(function(L){return posRow(L,h);}).join("")+(a.cash_eur||a.cash?cashRow(a,h):"")+
      (!ls.length&&!a.cash?'<tr><td colspan="'+PCOLS.length+'" class="mk-empty">Aucune ligne. <button type="button" class="btn sm" data-pf="add-pos" data-id="'+esc(a.id)+'">+ Position</button></td></tr>':'');
  }).join("");
  var head='<thead><tr>'+PCOLS.map(function(c,k){return '<th'+(k&&k<9?' class="r"':'')+'>'+esc(c)+'</th>';}).join("")+'</tr></thead>';
  return '<div class="tablewrap mk-tw"><table class="scan mk-table pf-table pf-tb">'+head+'<tbody>'+(body||'<tr><td colspan="'+PCOLS.length+'" class="mk-empty">Aucun compte.</td></tr>')+'</tbody></table></div>'+
    (hidden?'<p class="mk-note">'+hidden+' ligne'+(hidden>1?"s":"")+' masquée'+(hidden>1?"s":"")+' par le filtre PEA (les totaux les comptent toujours).</p>':'')+
    '<p class="mk-note">PRU = prix de revient unitaire, frais inclus, dans la devise de cotation. « dont change » = effet de l\'euro depuis l\'achat. Clique sur une ligne pour la modifier.</p>';
}

/* ---------- Opérations ---------- */
var TXL={achat:"Achat",vente:"Vente",dividende:"Dividende",versement:"Versement",retrait:"Retrait",frais:"Frais"};
function opsHTML(P,o){
  o=o||{};var h=!!o.hide,A=dict();P.accounts.forEach(function(a){A[a.id]=a;});var err=dict();(o.errors||[]).forEach(function(e){err[e.id]=e.msg;});
  var list=P.transactions.filter(function(t){return !o.acc||t.account_id===o.acc;}).map(function(t,n){return {t:t,n:n};})
    .sort(function(a,b){return a.t.date<b.t.date?1:a.t.date>b.t.date?-1:b.n-a.n;}).map(function(x){return x.t;});
  var rows=list.slice(0,o.max||400).map(function(t){
    var i=t.instrument_id?F().instr(P,t.instrument_id):null,amt=t.type==="achat"||t.type==="vente"?t.quantity*(t.price||0)+(t.type==="achat"?t.fees:-t.fees):t.amount;
    var sign=t.type==="achat"||t.type==="retrait"||t.type==="frais"?-1:1;
    return '<tr class="clk'+(err[t.id]?" pf-err":"")+'" data-pf="edit-tx" data-id="'+esc(t.id)+'" tabindex="0"'+(err[t.id]?' title="'+esc(err[t.id])+'"':'')+'>'+
      '<td>'+esc(frDate(t.date))+'</td><td>'+esc(A[t.account_id]?A[t.account_id].name:"?")+'</td><td><span class="pf-tx pf-tx-'+esc(t.type)+'">'+esc(TXL[t.type]||t.type)+'</span>'+(err[t.id]?' <em class="warn">ignorée</em>':'')+'</td>'+
      '<td>'+(i?'<b>'+esc(i.symbol)+'</b> '+esc(i.name):'<span class="mk-dim">—</span>')+'</td>'+
      '<td class="r">'+(t.quantity?(h?HIDE:qtyTxt(t.quantity)):"")+'</td><td class="r">'+(t.price!=null&&(t.type==="achat"||t.type==="vente")?pxTxt(t.price):"")+'</td>'+
      '<td class="r">'+(t.fees?nf(t.fees,2):"")+'</td><td class="r '+(sign<0?"down":"up")+'">'+(amt!=null?(h?HIDE:(sign<0?"−":"+")+nf(Math.abs(amt),2))+" "+esc(t.currency):"—")+'</td>'+
      '<td class="pf-orig">'+esc(t.origin)+(t.cash?"":" · sans espèces")+'</td></tr>';}).join("");
  return '<div class="pf-bar2"><button type="button" class="btn sm primary" data-pf="add-tx">+ Opération</button><button type="button" class="btn sm" data-pf="import">Importer des opérations (CSV)</button></div>'+
    (list.length?'<div class="tablewrap mk-tw"><table class="scan mk-table pf-ops pf-tb"><thead><tr><th>Date</th><th>Compte</th><th>Type</th><th>Instrument</th><th class="r">Quantité</th><th class="r">Prix</th><th class="r">Frais</th><th class="r">Montant</th><th>Origine</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      (list.length>(o.max||400)?'<p class="mk-note">'+(o.max||400)+' opérations les plus récentes sur '+list.length+'.</p>':''):
      '<p class="mk-note">Aucune opération. Tu peux t\'en passer : les positions saisies directement suffisent. Les opérations (achats, ventes, dividendes, versements) mettent à jour les quantités, le prix de revient, les espèces et le réalisé.</p>');
}

/* ---------- Répartition : anneau (SVG maison) et barres empilées ---------- */
function donutSVG(groups,o){
  o=o||{};var R=o.r||80,W=o.w||18,S=(R+W)*2+4,c=S/2,C=2*Math.PI*R,tot=groups.reduce(function(s,g){return s+(g.v>0?g.v:0);},0);
  var s='<svg class="pf-donut" viewBox="0 0 '+S+' '+S+'" width="'+S+'" height="'+S+'" role="img" aria-label="'+esc(o.label||"Répartition par famille d\'actifs")+'">'+
    '<circle class="pf-dtrack" cx="'+c+'" cy="'+c+'" r="'+R+'" stroke-width="'+W+'"/>';
  if(tot>0){var off=0,n=groups.filter(function(g){return g.v>0;}).length,gap=n>1?2:0;
    groups.forEach(function(g){if(!(g.v>0))return;var len=g.v/tot*C,d=Math.max(0.01,len-gap);
      s+='<circle class="pf-seg pf-c-'+esc(g.k)+'" cx="'+c+'" cy="'+c+'" r="'+R+'" stroke-width="'+W+'" stroke-dasharray="'+d.toFixed(2)+' '+(C-d).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 '+c+' '+c+')"><title>'+esc(g.label+" : "+share(g.v/tot))+'</title></circle>';off+=len;});}
  if(o.center)s+='<text class="pf-dc" x="'+c+'" y="'+(c-2)+'" text-anchor="middle">'+esc(o.center)+'</text>'+(o.sub?'<text class="pf-ds" x="'+c+'" y="'+(c+16)+'" text-anchor="middle">'+esc(o.sub)+'</text>':'');
  return s+'</svg>';
}
function legendHTML(groups,tot,h){
  return '<table class="pf-leg"><tbody>'+groups.map(function(g){return '<tr'+(g.v>0?'':' class="pf-zero"')+'><td><i class="pf-sw pf-c-'+esc(g.k)+'" aria-hidden="true"></i>'+esc(g.label)+'</td><td class="r">'+share(tot>0?g.v/tot:null)+'</td><td class="r">'+money(g.v,h,0)+'</td></tr>';}).join("")+'</tbody></table>';
}
var REG_LBL={france:"France",europe:"Europe",etats_unis:"États-Unis",monde:"Monde",emergents:"Émergents",japon:"Japon",asie:"Asie",autre:"Autre ou non renseigné",liquidites:"Liquidités",crypto:"Crypto",zone_euro:"Zone euro"};
var PEA_LBL={eligible:"Éligible PEA (source)",eligible_regle:"Éligible PEA (règle)",not_eligible:"Non éligible PEA",unknown:"À vérifier",cash:"Espèces"};
function hbars(list,lbl,h){
  var mx=list.reduce(function(m,x){return Math.max(m,x.w||0);},0)||1;
  return '<div class="pf-hb">'+list.map(function(x){return '<div class="pf-hbr"><span>'+esc(lbl(x.k))+'</span><i style="width:'+((x.w||0)/mx*100).toFixed(1)+'%"></i><b>'+share(x.w)+'</b><em>'+money(x.v,h,0)+'</em></div>';}).join("")+'</div>';
}
function repartHTML(V,o){
  o=o||{};var h=!!o.hide,B=V.breakdown,tot=V.total.value,G=F().GROUPS;
  if(!(tot>0))return '<p class="mk-note">Rien à répartir pour l\'instant : ajoute une position ou des espèces.</p>';
  var stacks=V.accounts.filter(function(a){return a.value>0;}).map(function(a){var m=B.byAccount[a.id]||{},segs=G.filter(function(g){return m[g.id]>0;});
    return '<div class="pf-st"><span class="pf-stn">'+esc(a.name)+'<em>'+money(a.value,h,0)+' · '+share(a.weight)+'</em></span><div class="pf-stb" role="img" aria-label="'+esc(a.name+" : "+segs.map(function(g){return g.label+" "+share(m[g.id]/a.value);}).join(", "))+'">'+
      segs.map(function(g){return '<i class="pf-c-'+g.id+'" style="flex-grow:'+(m[g.id]/a.value*1000).toFixed(0)+'" title="'+esc(g.label+" : "+share(m[g.id]/a.value)+(h?"":" · "+money(m[g.id],false,0)))+'"></i>';}).join("")+'</div></div>';}).join("");
  return '<div class="pf-rep"><section class="pf-rep1"><h4>Par famille d\'actifs</h4><div class="pf-dwrap">'+donutSVG(B.groups,{center:h?HIDE:money(tot,false,0),sub:"total"})+legendHTML(B.groups,tot,h)+'</div>'+
      '<p class="mk-note">Répartition actuelle, espèces comprises. La comparaison avec ta cible viendra avec tes préférences d\'investissement.</p></section>'+
    '<section><h4>Par compte</h4>'+stacks+'<div class="pf-legi">'+G.map(function(g){return '<span><i class="pf-sw pf-c-'+g.id+'"></i>'+esc(g.label)+'</span>';}).join("")+'</div></section>'+
    '<section><h4>Par zone d\'exposition</h4>'+hbars(B.regions,function(k){return REG_LBL[k]||k;},h)+'</section>'+
    '<section><h4>Par devise de cotation</h4>'+hbars(B.currencies,function(k){return k;},h)+'<p class="mk-note">Devise dans laquelle la ligne est cotée. Un ETF en euros peut être exposé au dollar par ses actions.</p></section>'+
    '<section><h4>Par statut PEA</h4>'+hbars(B.pea,function(k){return PEA_LBL[k]||k;},h)+'</section></div>';
}

/* ---------- Risques ---------- */
function riskHTML(R,V,o){
  o=o||{};var h=!!o.hide;
  if(!R)return '<p class="mk-dim">Chargement des historiques des lignes…</p>';
  var C=R.concentration||{},cov=R.coverage;
  var kpi='<div class="pf-kpis">'+
    tile("Volatilité annuelle",R.vol!=null?nf(R.vol*100,1)+" %":"—","",R.ok?"sur "+R.weeks+" semaines":"historiques insuffisants")+
    tile("Perte maximale",R.mdd!=null?pct(R.mdd):"—",R.mdd!=null?"down":"",R.ok?"du "+esc(frDate(R.from))+" au "+esc(frDate(R.to)):"")+
    tile("Pire semaine",R.worst!=null?pct(R.worst):"—",R.worst!=null?"down":"",R.best!=null?"meilleure : "+pct(R.best):"")+
    tile("Nombre effectif de lignes",C.neff!=null?nf(C.neff,1):"—","",C.n?esc(C.level)+" · "+C.n+" lignes":"")+
    tile("Effet de diversification",R.divRatio!=null?"× "+nf(R.divRatio,2):"—","",R.divRatio!=null?"risque des lignes / risque du portefeuille":"")+'</div>';
  var top=(C.top||[]).map(function(x){return '<div class="pf-hbr"><span>'+esc(x.label)+'</span><i style="width:'+(x.s*100).toFixed(1)+'%"></i><b>'+share(x.s)+'</b><em></em></div>';}).join("");
  var rc=R.contrib.slice(0,10).map(function(x){var w=x.w/(cov||1);return '<tr><td>'+esc(x.label)+'</td><td class="r">'+share(x.w)+'</td><td class="r"><b>'+share(x.rc)+'</b></td>'+
    '<td class="pf-rcb"><i class="pf-rw" style="width:'+Math.min(100,w*100).toFixed(1)+'%"></i><i class="pf-rr" style="width:'+Math.min(100,Math.max(0,x.rc||0)*100).toFixed(1)+'%"></i></td></tr>';}).join("");
  var corr="";if(R.corr&&R.corr.ids.length>1){var L=R.corr.labels;
    corr='<div class="tablewrap"><table class="pf-corr"><thead><tr><th></th>'+L.map(function(l){return '<th title="'+esc(l)+'">'+esc(String(l).slice(0,8))+'</th>';}).join("")+'</tr></thead><tbody>'+
      R.corr.m.map(function(row,a){return '<tr><th title="'+esc(L[a])+'">'+esc(L[a])+'</th>'+row.map(function(v,b){var x=v==null?0:Math.max(-1,Math.min(1,v));
        return '<td style="--pfv:'+(Math.abs(x)*85).toFixed(0)+'%" class="'+(a===b?"pf-cd":x>=0?"pf-cp":"pf-cn")+'" title="'+esc(L[a]+" / "+L[b]+" : "+(v==null?"—":nf(v,2)))+'">'+(v==null?"—":nf(v,2))+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table></div>'+
      '<p class="mk-note">Corrélation des rendements hebdomadaires en euros : 1 = les deux lignes bougent ensemble, 0 = sans lien, négatif = elles se compensent.</p>';}
  return kpi+(R.unmeasured.length?'<p class="mk-note"><span class="warn">Non mesuré</span> : '+R.unmeasured.map(function(u){return esc(u.label)+" ("+share(u.w)+")";}).join(", ")+' : pas assez d\'historique publié (prix manuel ou ligne récente).</p>':'')+
    '<div class="pf-rk"><section><h4>Plus grosses lignes <em>hors espèces</em></h4><div class="pf-hb">'+top+'</div></section>'+
      (rc?'<section><h4>Contributions au risque</h4><table class="pf-rct"><thead><tr><th>Ligne</th><th class="r">Poids</th><th class="r">Part du risque</th><th><span class="pf-k pf-rw"></span>poids <span class="pf-k pf-rr"></span>risque</th></tr></thead><tbody>'+rc+'</tbody></table>'+
        '<p class="mk-note">Une ligne dont la part du risque dépasse nettement son poids pèse plus que sa taille ne le laisse penser.</p></section>':'')+'</div>'+
    (corr?'<section class="pf-rkc"><h4>Corrélations <em>8 plus grosses lignes</em></h4>'+corr+'</section>':'')+
    '<p class="mk-note">Calculé par le Desk sur les clôtures hebdomadaires publiées (Yahoo Finance via ton robot, Binance pour la crypto), converties en euros aux fixings de la BCE, avec les poids actuels gardés constants'+
      (cov!=null&&cov<0.999?" ; couvre "+share(cov)+" du portefeuille":"")+'. Les espèces comptent avec une volatilité nulle.</p>';
}

/* ---------- Comptes et contrôles ---------- */
function accountsHTML(P,V,checks,o){
  o=o||{};var h=!!o.hide,F0=M().data?M().data("fiscal"):null,E=F0&&F0.enveloppes||{};
  var rows=V.accounts.map(function(a){var lim=a.account_type==="PEA"?(E.PEA&&E.PEA.plafond_versements_eur||150000):null,u=lim?Math.min(1,(a.deposits||0)/lim):null;
    var y=a.opened_at?(now()-Date.parse(a.opened_at+"T00:00:00Z"))/(365.25*864e5):null;
    return '<tr class="clk" data-pf="edit-acc" data-id="'+esc(a.id)+'" tabindex="0"><td><b>'+esc(a.name)+'</b>'+(a.demo?' <em class="pf-tag">exemple</em>':'')+'<small>'+esc(accType(a.account_type))+(a.broker?" · "+esc(a.broker):"")+'</small></td>'+
      '<td>'+(a.opened_at?esc(frDate(a.opened_at))+'<small>'+nf(y,1)+' an'+(y>=2?"s":"")+'</small>':'<span class="mk-dim">—</span>')+'</td>'+
      '<td class="r">'+money(a.deposits,h,0)+(lim?'<span class="pf-cap" title="Plafond de versements : '+esc(nf(lim,0))+' €"><i style="width:'+(u*100).toFixed(1)+'%"></i></span><small>'+share(u)+' du plafond</small>':'')+'</td>'+
      '<td class="r">'+money(a.cash_eur,h)+'</td><td class="r"><b>'+money(a.value,h,0)+'</b></td><td class="r '+cl(a.pnl)+'">'+(a.cost>0?smoney(a.pnl,h):"—")+'</td></tr>';}).join("");
  return '<div class="pf-bar2"><button type="button" class="btn sm primary" data-pf="add-acc">+ Compte</button><button type="button" class="btn sm" data-pf="export-csv">Exporter les positions (tableur)</button></div>'+
    '<div class="tablewrap mk-tw"><table class="scan mk-table pf-accts pf-tb"><thead><tr><th>Compte</th><th>Ouvert le</th><th class="r">Versements</th><th class="r">Espèces</th><th class="r">Valeur</th><th class="r">Plus-value</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<h4 class="pf-h4">Contrôles</h4>'+(checks.length?checksHTML(checks,50):'<p class="mk-note">Aucun point à signaler.</p>')+
    '<p class="mk-note">Règles indicatives (fiscal.json, sources service-public.gouv.fr) : plafond PEA 150 000 € de versements, plafond commun PEA + PEA-PME 225 000 €, 5 ans pour le PEA, 8 ans pour l\'assurance-vie. Le PEA n\'accepte que des titres éligibles confirmés : un fonds n\'est jamais déclaré éligible par déduction.</p>'+
    '<div class="pf-danger"><button type="button" class="btn sm" data-pf="wipe">Effacer tout le portefeuille de ce navigateur</button></div>';
}

/* ---------- Fenêtres de saisie ---------- */
function opt(v,l,sel){return '<option value="'+esc(v)+'"'+(sel?" selected":"")+'>'+esc(l)+'</option>';}
function field(label,html,cls){return '<label class="pf-f'+(cls?" "+cls:"")+'"><span>'+esc(label)+'</span>'+html+'</label>';}
function inp(name,val,attrs){return '<input name="'+name+'" value="'+esc(val==null?"":val)+'" '+(attrs||"")+'>';}
function accForm(a){
  a=a||{};var isNew=!a.id;
  return '<form class="pf-form" data-pf-form="acc" data-id="'+esc(a.id||"")+'">'+
    field("Nom",inp("name",a.name||"",'maxlength="60" required placeholder="Mon PEA"'))+
    field("Type",'<select name="type">'+(M().ACCOUNT_TYPES||[]).map(function(t){return opt(t.id,t.label,t.id===(a.account_type||"PEA"));}).join("")+'</select>')+
    field("Courtier ou banque",inp("broker",a.broker||"",'maxlength="60" placeholder="facultatif"'))+
    field("Devise du compte",inp("ccy",a.currency||"EUR",'maxlength="3" pattern="[A-Za-z]{3}"'),"pf-s")+
    field("Date d'ouverture",inp("opened",a.opened_at||"",'type="date"'),"pf-s")+
    field("Espèces sur le compte",inp("cash",a.cash_balance!=null?String(a.cash_balance).replace(".",","):"0",'inputmode="decimal"'),"pf-s")+
    field("Versements déjà effectués (€)",inp("dep",a.deposits_total!=null?String(a.deposits_total).replace(".",","):"",'inputmode="decimal" placeholder="pour le plafond PEA"'),"pf-s")+
    field("Note",inp("note",a.note||"",'maxlength="200"'))+
    '<p class="mk-note">Les espèces et les versements sont les montants de départ : les opérations que tu ajoutes les mettent à jour.</p>'+
    '<div class="pf-fb"><button type="submit" class="btn sm primary">'+(isNew?"Créer le compte":"Enregistrer")+'</button>'+(isNew?'':'<button type="button" class="btn sm" data-pf="del-acc" data-id="'+esc(a.id)+'">Supprimer le compte</button>')+'</div></form>';
}
function accSelect(P,sel,dis){return '<select name="acc"'+(dis?" disabled":"")+'>'+P.accounts.map(function(a){return opt(a.id,a.name+" · "+(ACC_SHORT[a.account_type]||""),a.id===sel);}).join("")+'</select>';}
function instPicker(P,cur){
  var i=cur?F().instr(P,cur):null;
  return '<div class="pf-pick" data-pf-pick>'+inp("inst",cur||"",'type="hidden"')+
    '<div class="pf-picked"'+(i?'':' hidden')+'><b>'+esc(i?i.symbol:"")+'</b> <span>'+esc(i?i.name:"")+'</span> <em>'+esc(i?(i.currency||""):"")+'</em> <button type="button" class="btn sm" data-pf="unpick">Changer</button></div>'+
    '<div class="pf-search"'+(i?' hidden':'')+'>'+inp("q","",'placeholder="Nom, symbole ou ISIN (ex. CW8, LU1681043599, BTC)" autocomplete="off"')+'<div class="pf-sug" role="listbox"></div></div></div>';
}
/** Suggestions : référentiel investissable, lignes perso, crypto (cours OKX), ou « hors liste ». */
function suggest(P,q){
  q=String(q||"").trim();if(q.length<2)return [];
  var out=[],seen=dict(),add=function(i,k){if(!i||seen[i.id])return;seen[i.id]=1;out.push({id:i.id,s:i.symbol,n:i.name,c:i.currency,k:k});};
  var Q=q.toUpperCase(),nq=q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  (CK.ref&&CK.ref.search?CK.ref.search(q,{investable:true}):[]).slice(0,8).forEach(function(i){add(i,i.vehicle==="spot_crypto"?"crypto":"référentiel");});
  P.instruments.forEach(function(i){var n=String(i.name||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");if(n.indexOf(nq)>=0||i.symbol===Q||i.isin===Q)add(i,"ligne perso");});
  if(/^[A-Z0-9]{2,10}$/.test(Q)&&!seen["crypto:"+Q])out.push({id:"crypto:"+Q,s:Q,n:"Crypto "+Q+" (cours OKX en USDT)",c:"USDT",k:"crypto"});
  return out.slice(0,10);
}
function sugHTML(list,q){
  return list.map(function(x){return '<button type="button" class="pf-sgi" data-pf="pick" data-id="'+esc(x.id)+'"><b>'+esc(x.s)+'</b> <span>'+esc(x.n)+'</span> <em>'+esc([x.c,x.k].filter(Boolean).join(" · "))+'</em></button>';}).join("")+
    (String(q||"").trim().length>=2?'<button type="button" class="pf-sgi pf-sgx" data-pf="custom"><b>+</b> <span>Ajouter « '+esc(String(q).trim().slice(0,60))+' » hors liste (prix saisi à la main)</span></button>':'');
}
function customFields(){
  var C=(M().CLASSES||[]).map(function(c){return opt(c.id,(c.parent?"  · ":"")+c.label,c.id==="actions");}).join("");
  var Vh=(M().VEHICLES||[]).filter(function(v){return v.investable;}).map(function(v){return opt(v.id,v.label,v.id==="fonds");}).join("");
  var Rg=[opt("","Non renseignée")].concat((M().REGIONS||[]).map(function(r){return opt(r.id,r.label);})).join("");
  return '<fieldset class="pf-custom" hidden><legend>Ligne hors référentiel</legend>'+field("Nom",inp("cname","",'maxlength="120"'))+field("ISIN",inp("cisin","",'maxlength="12" placeholder="facultatif"'),"pf-s")+
    field("Devise",inp("cccy","EUR",'maxlength="3"'),"pf-s")+field("Famille",'<select name="ccls">'+C+'</select>',"pf-s")+field("Type",'<select name="cveh">'+Vh+'</select>',"pf-s")+field("Zone",'<select name="creg">'+Rg+'</select>',"pf-s")+
    '<p class="mk-note">Pas de cours automatique pour cette ligne : indique son prix à la main (et mets-le à jour de temps en temps).</p></fieldset>';
}
function posForm(P,L,accId){
  L=L||null;var isNew=!L,ntx=L?L.tx:0;
  var h=null;if(L){var hs=P.holdings.filter(function(x){return L.holding_ids.indexOf(x.id)>=0;});h=hs[0]||null;}
  var q0=h?hs.reduce(function(s,x){return s+x.quantity;},0):"",i=L?L.i:null,ccy=i&&i.currency||"EUR",man=L?L.price_source==="manuel":false;
  var fr=function(v){return v==null||v===""?"":String(v).replace(".",",");};
  return '<form class="pf-form" data-pf-form="pos" data-id="'+esc(L?L.key:"")+'">'+
    field("Compte",accSelect(P,L?L.account_id:accId||(P.accounts[0]||{}).id,!!L))+
    field("Instrument",instPicker(P,L?L.instrument_id:""))+(isNew?customFields():"")+
    (ntx?'<p class="mk-note">Cette ligne a '+ntx+' opération'+(ntx>1?"s":"")+' : la quantité et le PRU ci-dessous sont ceux <b>de départ</b>, avant tes opérations.</p>':'')+
    field("Quantité",inp("qty",fr(q0),'inputmode="decimal" required'),"pf-s")+
    field("Prix de revient unitaire (PRU)",inp("pru",fr(h?h.average_purchase_price:""),'inputmode="decimal" placeholder="frais inclus"'),"pf-s")+
    field("Taux € à l'achat (€ pour 1 "+esc(ccy)+")",inp("fxb",fr(h?h.fx_rate_at_purchase:""),'inputmode="decimal" placeholder="taux du jour si vide"'),"pf-s pf-fxb"+(ccy==="EUR"?" pf-hid":""))+
    '<label class="pf-chk"><input type="checkbox" name="manual"'+(man||(i&&i.custom)?" checked":"")+'> Prix saisi à la main (assurance-vie, fonds sans cours)</label>'+
    '<div class="pf-man"'+(man||(i&&i.custom)?'':' hidden')+'>'+field("Prix actuel",inp("mpx",fr(L?L.manual_price:""),'inputmode="decimal"'),"pf-s")+field("Date du prix",inp("mdate",L&&L.manual_price_date||today(),'type="date"'),"pf-s")+'</div>'+
    field("Note",inp("note",L&&L.note||"",'maxlength="200"'))+
    '<div class="pf-fb"><button type="submit" class="btn sm primary">'+(isNew?"Ajouter la position":"Enregistrer")+'</button>'+
      (isNew?'':'<button type="button" class="btn sm" data-pf="del-pos" data-id="'+esc(L.key)+'">Supprimer la ligne</button>')+
      (L&&i&&!i.custom&&CK.mk&&i.vehicle!=="spot_crypto"?'<button type="button" class="btn sm" data-pf="fiche" data-id="'+esc(i.id)+'">Fiche</button>':'')+'</div>'+
    (L?'<p class="mk-note">Origine : '+esc(L.origins.join(" + "))+'.</p>':'')+'</form>';
}
function txForm(P,t){
  t=t||{};var isNew=!t.id,ty=t.type||"achat",fr=function(v){return v==null?"":String(v).replace(".",",");};
  return '<form class="pf-form" data-pf-form="tx" data-id="'+esc(t.id||"")+'">'+
    field("Date",inp("date",t.date||today(),'type="date" required'),"pf-s")+
    field("Type",'<select name="type">'+Object.keys(TXL).map(function(k){return opt(k,TXL[k],k===ty);}).join("")+'</select>',"pf-s")+
    field("Compte",accSelect(P,t.account_id||(P.accounts[0]||{}).id))+
    '<div class="pf-tx-i">'+field("Instrument",instPicker(P,t.instrument_id||""))+'</div>'+
    '<div class="pf-tx-q">'+field("Quantité",inp("qty",fr(t.quantity||""),'inputmode="decimal"'),"pf-s")+field("Prix unitaire",inp("price",fr(t.price),'inputmode="decimal"'),"pf-s")+'</div>'+
    '<div class="pf-tx-a">'+field("Montant",inp("amount",fr(t.amount),'inputmode="decimal"'),"pf-s")+'</div>'+
    field("Frais",inp("fees",fr(t.fees||""),'inputmode="decimal" placeholder="0"'),"pf-s")+
    field("Devise",inp("ccy",t.currency||"",'maxlength="4" placeholder="celle de l\'instrument"'),"pf-s")+
    field("Taux € du jour (€ pour 1 unité)",inp("fx",fr(t.fx_rate),'inputmode="decimal" placeholder="fixing BCE si vide"'),"pf-s")+
    '<label class="pf-chk"><input type="checkbox" name="cash"'+(t.cash===false?"":" checked")+'> Mettre à jour les espèces du compte</label>'+
    field("Note",inp("note",t.note||"",'maxlength="200"'))+
    '<div class="pf-fb"><button type="submit" class="btn sm primary">'+(isNew?"Ajouter l'opération":"Enregistrer")+'</button>'+(isNew?'':'<button type="button" class="btn sm" data-pf="del-tx" data-id="'+esc(t.id)+'">Supprimer</button>')+'</div>'+
    (t.origin?'<p class="mk-note">Origine : '+esc(t.origin)+'.</p>':'')+'</form>';
}
function importStartHTML(){
  return '<div class="pf-imp"><p>Choisis un fichier exporté par ton courtier ou ta banque (<b>CSV</b>), ou une <b>sauvegarde</b> du Desk (JSON).</p>'+
    '<label class="pf-file"><input type="file" name="file" accept=".csv,.txt,.tsv,.json,text/csv,application/json" data-pf-file> <span>Choisir un fichier…</span></label>'+
    '<ul class="pf-hlp"><li><b>Positions</b> : une colonne Quantité et une colonne ISIN ou Libellé (PRU, Cours, Devise si présents).</li>'+
    '<li><b>Opérations</b> : colonnes Date et Sens (ou Opération), puis ISIN, Quantité, Cours, Frais, Montant.</li>'+
    '<li>Séparateur « ; » ou « , », virgule décimale, accents Windows : reconnus automatiquement. Un aperçu s\'affiche avant tout import.</li></ul>'+
    '<p class="pf-priv">🔒 Le fichier est lu dans ton navigateur : rien n\'est envoyé.</p></div>';
}
var SEP={";":"point-virgule","\t":"tabulation",",":"virgule","|":"barre verticale"};
function importPreviewHTML(P,R,meta){
  if(!R.ok)return '<p class="pf-banner warn">'+esc(R.error)+'</p>'+importStartHTML();
  var ok=R.items.filter(function(x){return x.ok;}).length,ko=R.items.length-ok,pos=R.mode==="positions";
  var FLD={isin:"ISIN",name:"Libellé",symbol:"Ticker",qty:"Quantité",pru:"PRU",price:"Cours",value:"Montant",currency:"Devise",date:"Date",type:"Sens",fees:"Frais"};
  var rows=R.items.slice(0,40).map(function(x){var i=x.inst&&x.inst.i;
    return '<tr class="'+(x.ok?"":"pf-err")+'"><td>'+x.line+'</td>'+(pos?'':'<td>'+esc(frDate(x.date))+'</td><td>'+esc(TXL[x.type]||x.raw_type||"")+'</td>')+
      '<td>'+(i?'<b>'+esc(i.symbol)+'</b> '+esc(i.name):esc(x.name||x.isin||""))+'</td><td>'+(x.inst?esc(x.inst.draft?"nouvelle ligne perso (à vérifier)":"reconnu par "+x.inst.how):"")+'</td>'+
      '<td class="r">'+(x.qty!=null?qtyTxt(x.qty):"")+'</td><td class="r">'+(pos?pxTxt(x.pru):pxTxt(x.price))+'</td><td>'+(x.ok?esc(x.note||"ok"):'<span class="warn">'+esc(x.err)+'</span>')+'</td></tr>';}).join("");
  return '<div class="pf-imp"><p><b>'+esc(meta.file||"Fichier")+'</b> · '+esc(meta.encoding||"")+' · séparateur '+esc(SEP[R.delim]||R.delim)+' · <b>'+(pos?"positions":"opérations")+'</b> · colonnes reconnues : '+
      esc(Object.keys(R.fields).map(function(k){return FLD[k]||k;}).join(", "))+'</p>'+
    '<p>'+ok+' ligne'+(ok>1?"s":"")+' prête'+(ok>1?"s":"")+(ko?' · <span class="warn">'+ko+' ignorée'+(ko>1?"s":"")+'</span>':'')+(R.items.length>40?' · aperçu des 40 premières':'')+'.</p>'+
    '<div class="tablewrap"><table class="scan pf-prev"><thead><tr><th>Ligne</th>'+(pos?'':'<th>Date</th><th>Sens</th>')+'<th>Instrument</th><th>Reconnaissance</th><th class="r">Qté</th><th class="r">'+(pos?"PRU":"Prix")+'</th><th>État</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<form class="pf-form" data-pf-form="imp">'+field("Dans le compte",'<select name="acc">'+P.accounts.map(function(a){return opt(a.id,a.name);}).join("")+opt("__new","Nouveau compte…",!P.accounts.length)+'</select>')+
      '<div class="pf-newacc"'+(P.accounts.length?' hidden':'')+'>'+field("Nom du nouveau compte",inp("nname","",'maxlength="60" placeholder="Mon PEA"'))+field("Type",'<select name="ntype">'+(M().ACCOUNT_TYPES||[]).map(function(t){return opt(t.id,t.label);}).join("")+'</select>',"pf-s")+'</div>'+
      (pos?'<label class="pf-chk"><input type="checkbox" name="replace" checked> Remplacer les positions actuelles de ce compte (sinon, ajouter)</label>':'<p class="mk-note">Les opérations déjà présentes (même date, sens, instrument, quantité et prix) ne sont pas ajoutées deux fois.</p>')+
      '<div class="pf-fb"><button type="submit" class="btn sm primary"'+(ok?"":" disabled")+'>Importer '+ok+' ligne'+(ok>1?"s":"")+'</button><button type="button" class="btn sm" data-pf="import">Choisir un autre fichier</button></div></form></div>';
}
function jsonPreviewHTML(r,meta){
  if(!r.ok)return '<p class="pf-banner warn">'+esc(r.error)+'</p>'+importStartHTML();
  var c=r.counts;
  return '<div class="pf-imp"><p>Sauvegarde <b>'+esc(meta.file||"")+'</b> : '+c.accounts+' compte(s), '+c.holdings+' position(s), '+c.transactions+' opération(s).</p>'+
    '<p class="pf-banner warn">Charger cette sauvegarde remplace tout le portefeuille de ce navigateur.</p>'+
    '<div class="pf-fb"><button type="button" class="btn sm primary" data-pf="restore">Remplacer par cette sauvegarde</button><button type="button" class="btn sm" data-pf="import">Choisir un autre fichier</button></div></div>';
}
/** Positions au format tableur (« ; », virgule décimale, UTF-8 avec BOM pour Excel). */
function positionsCSV(V,P){
  var A=dict();P.accounts.forEach(function(a){A[a.id]=a.name;});
  var q=function(s){s=String(s==null?"":s);return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;},n=function(v,d){return v==null||!isFinite(v)?"":v.toFixed(d).replace(".",",");};
  var lines=[["Compte","Symbole","Libellé","ISIN","Quantité","PRU","Devise","Cours","Valeur EUR","Plus-value EUR","Origine"].join(";")];
  V.lines.forEach(function(L){if(!(L.quantity>0))return;var i=L.i||{};
    /* une cellule qui commence par = + - @ serait lue comme une formule par le tableur */
    var t=function(s){s=String(s==null?"":s);return /^[=+\-@]/.test(s)?"'"+s:s;};
    lines.push([q(t(A[L.account_id])),q(t(i.symbol)),q(t(i.name)),q(i.isin||""),n(L.quantity,8),n(L.pru,6),q(L.currency),n(L.price,6),n(L.value,2),n(L.pnl,2),q(t(L.origins.join(" + ")))].join(";"));});
  return "﻿"+lines.join("\r\n")+"\r\n";
}

/* ---------- Accueil : lecture du stockage et du cache seulement (aucun appel réseau) ---------- */
function home(){
  var Fc=F();if(!Fc)return {has:false};
  var P=Fc.load();if(!P.accounts.length)return {has:false};
  var V=Fc.value(P,function(id){return Q[id]||(CK.mkt&&CK.mkt.last?CK.mkt.last(id):null);},{close:closeOf});
  var top=V.lines.filter(function(L){return L.value>0;}).sort(function(a,b){return b.value-a.value;}).slice(0,3);
  return {has:true,hide:hideOn(),total:V.total.value,pnl:V.total.pnl,pnl_pct:V.total.pnl_pct,day:V.total.dayBase>0?V.total.day:null,n:V.lines.filter(function(L){return L.quantity>0;}).length,
    groups:V.breakdown.groups,accounts:V.accounts.length,top:top.map(function(L){return {s:L.i?L.i.symbol:L.instrument_id,w:L.weight,pnl_pct:L.pnl_pct};}),
    alerts:Fc.checks(P,V).filter(function(c){return c.level==="alerte";}).length,demo:P.accounts.every(function(a){return a.demo;}),prop:propOfMonth()};
}
/** Proposition du mois déjà calculée (journal du navigateur, aucune requête) : {label, moves} ou null. */
function propOfMonth(){
  try{if(!CK.alui||!CK.alloc)return null;var D=CK.alloc.decision(now()),j=CK.alui.journal().filter(function(x){return D&&x.month===D.month;})[0];if(!j)return null;
    var mv=j.decisions.filter(function(d){return d.a&&d.a!=="CONSERVER"&&d.a!=="NE RIEN FAIRE";}).length;return {label:j.monthLabel||j.month,moves:mv};}catch(e){return null;}
}

/* ================================================================
   Interface (DOM)
   ================================================================ */
var P=null,Q=dict(),RES=dict(),tab="positions",accF=null,unsub=null,subKey="",built=false,loopT=null,paintQ=false,fxAsked=false,robotTs=0,seen=false;
var RISK={key:"",res:null,busy:false,ts:0},IMP=null;
function $(id){return typeof document!=="undefined"&&document.getElementById?document.getElementById(id):null;}
function lsGet(k){try{return CK.ls?CK.ls(k):null;}catch(e){return null;}}
function lsSet(k,v){try{if(CK.ls)CK.ls(k,v);}catch(e){}}
function hideOn(){return lsGet("pf:hide")==="1";}
function peaF(){var p=lsGet("mk:pea");return p==="eligibles"||p==="verifier"?p:"tous";}
function toast(t){if(CK.toast)CK.toast(esc(t));}
function closeOf(id){var r=RES[id];return r&&fin(r.c)?{c:r.c,d:r.d}:null;}
function quoteOf(id){return Q[id]||(CK.mkt&&CK.mkt.last?CK.mkt.last(id):null);}
function state(){if(!P)P=F().load();return P;}
function commit(msg){if(!F().save(P)){toast("Enregistrement impossible : le stockage du navigateur est plein ou bloqué. Sauvegarde dans un fichier.");}else if(msg)toast(msg);RISK.key="";resub();paint();}
function V(){return F().value(state(),quoteOf,{close:closeOf});}

function build(){
  var host=$("pfMain");if(!host||built)return;built=true;
  var t=lsGet("pf:tab");if(TAB_IDS.indexOf(t)>=0)tab=t;
  host.innerHTML='<div class="mk-bar"><div class="seg mk-tabs" role="tablist" aria-label="Portefeuille">'+TABS.map(function(x){return '<button type="button" role="tab" data-pf="tab" data-id="'+x.id+'">'+esc(x.label)+'</button>';}).join("")+'</div>'+
    '<span class="pf-flt" id="pfFlt"></span></div><div id="pfChecks"></div><div id="pfTab"></div><p class="mk-disc">'+esc(disclaimer())+'</p>';
  [host,$("pfResume"),$("pfmBody")].forEach(function(el){if(!el)return;el.addEventListener("click",onClick);el.addEventListener("keydown",function(e){
    if(e.key!=="Enter"||!e.target.closest)return;var r=e.target.closest("tr[data-pf]");if(r){e.preventDefault();act(r.getAttribute("data-pf"),r.getAttribute("data-id"),r);}});});
  if(CK.btui)CK.btui.wire(host,schedule);
  var mb=$("pfmBody");if(mb){mb.addEventListener("submit",onSubmit);mb.addEventListener("input",onInput);mb.addEventListener("change",onChange);}
}
function onClick(e){var t=e.target;if(!t||!t.closest)return;var b=t.closest("[data-pf]");if(!b||b.tagName==="FORM")return;
  if(b.tagName==="TR"&&t.closest("button,a"))return;act(b.getAttribute("data-pf"),b.getAttribute("data-id"),b);}
function act(a,id,el){
  var S=state();
  switch(a){
    case "tab":if(TAB_IDS.indexOf(id)>=0){tab=id;lsSet("pf:tab",id);paint();}return;
    case "acc":accF=accF===id?null:id;paint();return;
    case "accall":accF=null;paint();return;
    case "peaf":lsSet("mk:pea",id);paint();return;
    case "hide":lsSet("pf:hide",hideOn()?"0":"1");paint();if(CK.worlds&&CK.worlds.refresh)try{CK.worlds.refresh();}catch(e){}return;
    case "add-acc":modal("Nouveau compte",accForm(null));return;
    case "edit-acc":var ac=S.accounts.filter(function(x){return x.id===id;})[0];if(ac)modal("Compte · "+ac.name,accForm(ac));return;
    case "add-pos":if(!S.accounts.length){modal("Nouveau compte",'<p class="mk-note">Crée d\'abord le compte qui détient cette position.</p>'+accForm(null));return;}modal("Nouvelle position",posForm(S,null,id));return;
    case "edit-pos":var L=V().lines.filter(function(x){return x.key===id;})[0];if(L)modal((L.i?L.i.symbol+" · ":"")+"Position",posForm(S,L));return;
    case "add-tx":if(!S.accounts.length){modal("Nouveau compte",'<p class="mk-note">Crée d\'abord un compte.</p>'+accForm(null));return;}modal("Nouvelle opération",txForm(S,null));syncTx();return;
    case "edit-tx":var tx=S.transactions.filter(function(x){return x.id===id;})[0];if(tx){modal("Opération du "+frDate(tx.date),txForm(S,tx));syncTx();}return;
    case "del-acc":delAcc(id);return;
    case "del-pos":delPos(id);return;
    case "del-tx":S.transactions=S.transactions.filter(function(x){return x.id!==id;});closeModal();commit("Opération supprimée.");return;
    case "import":IMP=null;modal("Importer",importStartHTML());return;
    case "restore":if(IMP&&IMP.json&&IMP.json.ok){P=IMP.json.P;P.exported_at=new Date(now()).toISOString();IMP=null;closeModal();commit("Sauvegarde chargée.");}return;
    case "export":download("desk-portefeuille-"+today()+".json",F().exportJSON(S),"application/json");S.exported_at=new Date(now()).toISOString();F().save(S,true);paint();toast("Fichier de sauvegarde téléchargé. Garde-le en lieu sûr.");return;
    case "export-csv":download("desk-positions-"+today()+".csv",positionsCSV(V(),S),"text/csv;charset=utf-8");return;
    case "demo":P=F().demo();commit("Exemple chargé : retire-le quand tu veux.");return;
    case "undemo":F().removeDemo(S);accF=null;commit("Exemple retiré.");return;
    case "wipe":if(typeof confirm==="function"&&!confirm("Effacer tout le portefeuille de ce navigateur ? Pense à le sauvegarder d'abord (fichier)."))return;F().clear();P=F().empty();accF=null;RISK={key:"",res:null,busy:false,ts:0};resub();paint();toast("Portefeuille effacé de ce navigateur.");return;
    case "pick":pick(el,id);return;
    case "unpick":unpick(el);return;
    case "custom":showCustom(el);return;
    case "fiche":closeModal();if(CK.mk&&CK.mk.fiche)setTimeout(function(){CK.mk.fiche(id);},220);return;
    default:if(CK.alui&&CK.alui.act(a,id,S,V()))return;
  }
}
function delAcc(id){
  var S=state(),a=S.accounts.filter(function(x){return x.id===id;})[0];if(!a)return;
  var n=S.holdings.filter(function(h){return h.account_id===id;}).length+S.transactions.filter(function(t){return t.account_id===id;}).length;
  if(typeof confirm==="function"&&!confirm("Supprimer le compte « "+a.name+" »"+(n?" et ses "+n+" lignes et opérations":"")+" ?"))return;
  S.accounts=S.accounts.filter(function(x){return x.id!==id;});S.holdings=S.holdings.filter(function(h){return h.account_id!==id;});S.transactions=S.transactions.filter(function(t){return t.account_id!==id;});
  if(accF===id)accF=null;closeModal();commit("Compte supprimé.");
}
function delPos(key){
  var S=state(),p=key.split("|"),acc=p[0],ins=p.slice(1).join("|"),tx=S.transactions.filter(function(t){return t.account_id===acc&&t.instrument_id===ins;});
  if(tx.length&&typeof confirm==="function"&&!confirm("Cette ligne a "+tx.length+" opération(s). Les supprimer aussi ?"))return;
  S.holdings=S.holdings.filter(function(h){return !(h.account_id===acc&&h.instrument_id===ins);});
  S.transactions=S.transactions.filter(function(t){return !(t.account_id===acc&&t.instrument_id===ins);});closeModal();commit("Ligne supprimée.");
}
/* ---------- Fenêtre ---------- */
function modal(title,html){var ti=$("pfmTitle"),b=$("pfmBody");if(!b)return;build();if(ti)ti.textContent=title;b.innerHTML=html;if(CK.openOv)CK.openOv("ovPf");
  setTimeout(function(){var f=b.querySelector("input:not([type=hidden]):not([type=checkbox]),select");if(f)try{f.focus();}catch(e){}},60);}
function closeModal(){var o=$("ovPf");if(o&&CK.closeOv)CK.closeOv(o);}
function formOf(el){return el&&el.closest?el.closest("form"):null;}
function pick(el,id){var f=formOf(el),S=state();if(!f)return;var i=F().instr(S,id);if(!i)return;f.inst.value=id;
  var w=f.querySelector(".pf-picked"),s=f.querySelector(".pf-search"),c=f.querySelector(".pf-custom");
  if(w){w.hidden=false;w.innerHTML='<b>'+esc(i.symbol)+'</b> <span>'+esc(i.name)+'</span> <em>'+esc(i.currency||"")+'</em> <button type="button" class="btn sm" data-pf="unpick">Changer</button>';}
  if(s)s.hidden=true;if(c)c.hidden=true;
  var fx=f.querySelector(".pf-fxb");if(fx){fx.classList.toggle("pf-hid",(i.currency||"EUR")==="EUR");var sp=fx.querySelector("span");if(sp)sp.textContent="Taux € à l'achat (€ pour 1 "+(i.currency||"EUR")+")";}
  if(f.manual){var man=!!i.custom||!F().quotable(i);f.manual.checked=man;var m=f.querySelector(".pf-man");if(m)m.hidden=!man;}
  if(f.ccy&&!f.ccy.value)f.ccy.placeholder=i.currency||"EUR";
}
function unpick(el){var f=formOf(el);if(!f)return;f.inst.value="";var w=f.querySelector(".pf-picked"),s=f.querySelector(".pf-search");if(w)w.hidden=true;if(s){s.hidden=false;var q=s.querySelector("input");if(q){q.value="";q.focus();}}}
function showCustom(el){var f=formOf(el);if(!f)return;var c=f.querySelector(".pf-custom");if(!c){toast("Ajoute la ligne hors liste depuis « + Position ».");return;}
  c.hidden=false;f.inst.value="__custom";if(f.cname&&f.q)f.cname.value=f.q.value.trim();var sg=f.querySelector(".pf-sug");if(sg)sg.innerHTML="";
  if(f.manual){f.manual.checked=true;var m=f.querySelector(".pf-man");if(m)m.hidden=false;}
  var fx=f.querySelector(".pf-fxb");if(fx)fx.classList.add("pf-hid");}
function onInput(e){var t=e.target;if(!t||t.name!=="q")return;var f=formOf(t),sg=f&&f.querySelector(".pf-sug");if(!sg)return;sg.innerHTML=sugHTML(suggest(state(),t.value),t.value);}
function onChange(e){var t=e.target;if(!t)return;
  if(t.hasAttribute&&t.hasAttribute("data-pf-file")){readFile(t);return;}
  var f=formOf(t);if(!f)return;
  if(t.name==="manual"){var m=f.querySelector(".pf-man");if(m)m.hidden=!t.checked;}
  if(t.name==="type"&&f.getAttribute("data-pf-form")==="tx")syncTx();
  if(t.name==="acc"&&f.getAttribute("data-pf-form")==="imp"){var n=f.querySelector(".pf-newacc");if(n)n.hidden=t.value!=="__new";}
  if(t.name==="cccy"){var fx=f.querySelector(".pf-fxb");if(fx)fx.classList.toggle("pf-hid",String(t.value).toUpperCase()==="EUR");}
}
/** Champs utiles selon le type d'opération. */
function syncTx(){var b=$("pfmBody"),f=b&&b.querySelector('form[data-pf-form="tx"]');if(!f)return;var ty=f.type.value,trade=ty==="achat"||ty==="vente";
  var s=function(sel,on){var x=f.querySelector(sel);if(x)x.hidden=!on;};s(".pf-tx-i",trade||ty==="dividende");s(".pf-tx-q",trade);s(".pf-tx-a",!trade);}
function n(v){return M().num?M().num(String(v==null?"":v).replace(/[€\s]/g,"")):null;}
function onSubmit(e){
  var f=e.target;if(!f||!f.getAttribute)return;var k=f.getAttribute("data-pf-form");if(!k)return;e.preventDefault();var S=state();
  if(k==="acc"){var id=f.getAttribute("data-id"),o={id:id||F().uid("acc"),name:f.name.value.trim()||"Compte",account_type:f.type.value,broker:f.broker.value,currency:(f.ccy.value||"EUR").toUpperCase(),
      opened_at:f.opened.value||null,cash_balance:n(f.cash.value)||0,deposits_total:n(f.dep.value),note:f.note.value};
    if(!/^[A-Z]{3}$/.test(o.currency)){toast("Devise du compte : 3 lettres (EUR, USD…).");return;}
    var a=F().normAcc(o);if(id){S.accounts=S.accounts.map(function(x){return x.id===id?Object.assign(a,{demo:x.demo}):x;});}else S.accounts.push(a);
    closeModal();commit(id?"Compte enregistré.":"Compte créé.");return;}
  if(k==="pos"){var key=f.getAttribute("data-id"),acc=f.acc.value,ins=f.inst.value,q=n(f.qty.value),pru=n(f.pru.value),fxb=n(f.fxb.value),man=!!f.manual.checked,mpx=n(f.mpx&&f.mpx.value);
    if(key){var kp=key.split("|");acc=kp[0];ins=kp.slice(1).join("|");}
    if(ins==="__custom"){var nm=(f.cname.value||"").trim();if(!nm){toast("Donne un nom à la ligne.");return;}
      var isin=(f.cisin.value||"").toUpperCase().replace(/[\s-]/g,"");if(isin&&!(M().isinValid&&M().isinValid(isin))){toast("ISIN invalide (12 caractères, clé de contrôle).");return;}
      var ci=F().normCustom({id:"perso:"+(isin||nm),name:nm,isin:isin||null,currency:(f.cccy.value||"EUR").toUpperCase(),asset_class:f.ccls.value,vehicle:f.cveh.value,region:f.creg.value||null});
      if(!S.instruments.some(function(x){return x.id===ci.id;}))S.instruments.push(ci);ins=ci.id;man=true;}
    if(!ins){toast("Choisis un instrument dans la liste (ou « hors liste »).");return;}
    if(!(q>=0)||q==null){toast("Quantité invalide.");return;}
    if(man&&!(mpx>0)){toast("Indique le prix actuel (prix saisi à la main).");return;}
    var h=F().normHold({account_id:acc,instrument_id:ins,quantity:q,average_purchase_price:pru,fx_rate_at_purchase:fxb,price_source:man?"manuel":"marche",manual_price:man?mpx:null,
      manual_price_date:man?(f.mdate.value||today()):null,note:f.note.value,origin:"Saisie",updated_at:today()});
    if(key){var old=S.holdings.filter(function(x){return x.account_id===acc&&x.instrument_id===ins;});if(old[0]){h.origin=old[0].origin;h.id=old[0].id;h.demo=old[0].demo;}
      S.holdings=S.holdings.filter(function(x){return !(x.account_id===acc&&x.instrument_id===ins);});}
    var acct=S.accounts.filter(function(x){return x.id===acc;})[0],ii=F().instr(S,ins);
    var chk=acct&&ii&&CK.pea&&(acct.account_type==="PEA"||acct.account_type==="PEA_PME")?CK.pea.allowedIn(ii,acct.account_type):{ok:true};
    S.holdings.push(h);closeModal();commit(key?"Position enregistrée.":"Position ajoutée.");
    if(!chk.ok)toast("Attention : "+chk.reason);return;}
  if(k==="tx"){var id2=f.getAttribute("data-id"),ty=f.type.value,trade=ty==="achat"||ty==="vente",ins2=f.inst.value;
    if((trade)&&(!ins2||ins2==="__custom")){toast("Choisis l'instrument (il doit exister : ajoute d'abord une ligne hors liste depuis « + Position » si besoin).");return;}
    var i2=ins2?F().instr(S,ins2):null,acc2=S.accounts.filter(function(x){return x.id===f.acc.value;})[0];
    var t={id:id2||F().uid("op"),account_id:f.acc.value,instrument_id:trade||ty==="dividende"?ins2||null:null,date:f.date.value,type:ty,quantity:trade?n(f.qty.value):0,price:trade?n(f.price.value):null,
      amount:trade?null:n(f.amount.value),fees:n(f.fees.value)||0,currency:(f.ccy.value||(i2&&trade?i2.currency:null)||(acc2&&acc2.currency)||"EUR").toUpperCase(),fx_rate:n(f.fx.value),cash:!!f.cash.checked,note:f.note.value};
    if(!M().isoDate(t.date)){toast("Date invalide.");return;}
    if(trade&&(!(t.quantity>0)||t.price==null)){toast("Quantité et prix unitaire requis.");return;}
    if(!trade&&!(t.amount>0)){toast("Montant requis.");return;}
    var nt=F().normTx(t),o2=id2?S.transactions.filter(function(x){return x.id===id2;})[0]:null;if(o2)nt.origin=o2.origin;
    var next=id2?S.transactions.map(function(x){return x.id===id2?nt:x;}):S.transactions.concat([nt]);
    /* une opération impossible (vente au-delà de la quantité détenue, devise inconnue…) n'est pas enregistrée */
    var err=F().compute(Object.assign({},S,{transactions:next})).errors.filter(function(x){return x.id===nt.id;})[0];
    if(err){toast(err.msg.replace(/ : opération ignorée\.$/,"."));return;}
    S.transactions=next;closeModal();commit(id2?"Opération enregistrée.":"Opération ajoutée.");return;}
  if(k==="imp"){if(!IMP||!IMP.csv||!IMP.csv.ok)return;var target=f.acc.value;
    if(target==="__new"){var na=F().normAcc({name:(f.nname.value||"").trim()||"Compte importé",account_type:f.ntype.value});S.accounts.push(na);target=na.id;}
    var out=F().applyCSV(S,IMP.csv,{account_id:target,replace:f.replace?!!f.replace.checked:false,file:IMP.file,date:today()});
    if(out.error){toast(out.error);return;}var mode=IMP.mode;P=out.P;IMP=null;accF=target;if(mode==="operations")tab="operations";closeModal();
    commit(out.added+" ligne"+(out.added>1?"s":"")+" importée"+(out.added>1?"s":"")+(out.dup?" · "+out.dup+" déjà présente"+(out.dup>1?"s":""):"")+(out.skipped?" · "+out.skipped+" ignorée"+(out.skipped>1?"s":""):"")+(out.customs?" · "+out.customs+" ligne(s) perso à vérifier":"")+".");return;}
}
function readFile(input){
  var file=input.files&&input.files[0];if(!file)return;if(file.size>2*1024*1024){toast("Fichier trop gros (2 Mo au plus).");return;}
  var r=new FileReader();r.onerror=function(){toast("Lecture du fichier impossible.");};
  r.onload=function(){var d=F().decode(new Uint8Array(r.result)),S=state(),b=$("pfmBody");
    var isJson=/\.json$/i.test(file.name)||/^\s*\{/.test(d.text);
    if(isJson){var j=F().importJSON(d.text);IMP={json:j,file:file.name};if(b)b.innerHTML=jsonPreviewHTML(j,{file:file.name});return;}
    var R=F().readCSV(S,d.text);IMP={csv:R,file:file.name,mode:R.mode};if(b)b.innerHTML=importPreviewHTML(S,R,{file:file.name,encoding:d.encoding});};
  r.readAsArrayBuffer(file);
}
function download(name,text,type){
  try{var blob=new Blob([text],{type:type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(url);a.remove();},500);}catch(e){toast("Téléchargement impossible dans ce navigateur.");}
}

/* ---------- Peinture ---------- */
function schedule(){if(paintQ)return;paintQ=true;var f=typeof requestAnimationFrame==="function"&&!(typeof document!=="undefined"&&document.hidden)?requestAnimationFrame:function(cb){setTimeout(cb,50);};f(function(){paintQ=false;paint();});}
function set(id,html){var el=$(id);if(el&&el._h!==html){el.innerHTML=html;el._h=html;}}
function paint(){
  if(!built)return;var S=state(),v=V(),h=hideOn(),ck=F().checks(S,v);
  if(accF&&!S.accounts.some(function(a){return a.id===accF;}))accF=null;
  set("pfResume",resumeHTML(S,v,{hide:h,acc:accF}));
  var meta=$("pfMeta"),mt=S.accounts.length?(h?"montants masqués":money(v.total.value,false,0))+" · "+S.accounts.length+" compte"+(S.accounts.length>1?"s":""):"";if(meta&&meta.textContent!==mt)meta.textContent=mt;
  [].forEach.call(document.querySelectorAll('#pfMain [data-pf="tab"]'),function(b){var on=b.getAttribute("data-id")===tab;b.setAttribute("aria-selected",on?"true":"false");b.setAttribute("aria-pressed",on?"true":"false");});
  var pf=peaF(),fa=accF?S.accounts.filter(function(a){return a.id===accF;})[0]:null;
  set("pfFlt",(fa?'<button type="button" class="chip" data-pf="accall" title="Afficher tous les comptes">'+esc(fa.name)+' ×</button>':'')+
    (tab==="positions"?'<span class="seg" role="group" aria-label="Filtre PEA">'+PEAF.map(function(p){return '<button type="button" data-pf="peaf" data-id="'+p.id+'" aria-pressed="'+(p.id===pf?"true":"false")+'">'+esc(p.label)+'</button>';}).join("")+'</span>':''));
  set("pfChecks",S.accounts.length&&tab!=="comptes"&&tab!=="allocation"&&tab!=="backtest"?checksHTML(ck.filter(function(c){return c.level!=="info"&&(!accF||!c.account_id||c.account_id===accF);}),4):"");
  var body="";
  if(tab==="allocation"&&CK.alui){CK.alui.ensure(S,v,schedule);body=CK.alui.html(S,v,{hide:h});}
  else if(tab==="backtest"&&CK.btui)body=CK.btui.html(S,v,{hide:h});
  else if(!S.accounts.length)body='<p class="mk-note">Crée un compte, importe un fichier ou charge l\'exemple depuis le bloc du dessus.</p>';
  else if(tab==="positions")body=positionsHTML(v,{hide:h,acc:accF,peaf:pf});
  else if(tab==="operations")body=opsHTML(S,{hide:h,acc:accF,errors:v.errors});
  else if(tab==="repartition")body=repartHTML(v,{hide:h});
  else if(tab==="risques"){runRisk(v);body=riskHTML(RISK.res,v,{hide:h});}
  else if(tab==="comptes")body=accountsHTML(S,v,ck,{hide:h});
  set("pfTab",body);
}
/* ---------- Cotations : seulement les lignes détenues, tant que l'espace est ouvert ---------- */
function heldIds(){var S=state(),C=F().compute(S),ids=[];C.positions.forEach(function(p){if(p.quantity>0&&p.price_source!=="manuel"){var i=F().instr(S,p.instrument_id);if(F().quotable(i)&&ids.indexOf(p.instrument_id)<0)ids.push(p.instrument_id);}});return ids;}
function onQuotes(m){Object.keys(m||{}).forEach(function(k){if(m[k])Q[k]=m[k];});schedule();}
function resub(){
  if(!seen||!loopT)return;var ids=heldIds(),k=ids.slice().sort().join(",");if(k===subKey&&unsub)return;
  if(unsub){try{unsub();}catch(e){}unsub=null;}subKey=k;if(ids.length&&CK.mkt&&CK.mkt.subscribe)unsub=CK.mkt.subscribe(ids,onQuotes);
}
function start(){
  if(loopT)return;
  loopT=setInterval(function(){if(typeof document==="undefined"||!document.hidden){paint();loadRobot();}},15000);
  resub();
  if(!fxAsked&&CK.fx&&CK.fx.load){fxAsked=true;try{CK.fx.load().then(function(){RISK.key="";schedule();},function(){});}catch(e){}}
  loadRobot();paint();
}
function loadRobot(){if(!CK.mkt||!CK.mkt.resume||now()-robotTs<18e5)return;robotTs=now();
  CK.mkt.resume().then(function(r){var it=r&&r.items;if(it&&typeof it==="object"){RES=dict();Object.keys(it).forEach(function(k){if(it[k]&&typeof it[k]==="object")RES[k]=it[k];});schedule();}});}
function stop(){if(unsub){try{unsub();}catch(e){}unsub=null;}subKey="";clearInterval(loopT);loopT=null;}
function onView(on){if(on){seen=true;P=F().load();build();start();}else stop();}

/* ---------- Risques : historiques chargés seulement dans l'onglet ---------- */
function runRisk(v){
  var S=state(),lines=v.lines.filter(function(L){return L.value>0;}).sort(function(a,b){return b.value-a.value;});
  var key=lines.map(function(L){return L.instrument_id+":"+(L.weight||0).toFixed(3);}).join(",")+"|"+(v.total.cash/v.total.value||0).toFixed(3);
  if(RISK.busy||(RISK.key===key&&now()-RISK.ts<6e5))return;RISK.busy=true;RISK.key=key;
  /* une ligne = un instrument (deux comptes qui détiennent CW8 forment une seule ligne de risque) */
  var by=dict(),uniq=[];lines.forEach(function(L){var k=L.instrument_id;if(!by[k]){by[k]={id:k,label:L.i?L.i.symbol:k,w:0,ccy:L.currency,i:L.i};uniq.push(by[k]);}by[k].w+=L.weight;});
  var cashW=v.total.value>0?Math.max(0,v.total.cash)/v.total.value:0;
  var load=uniq.slice(0,25).map(function(u){
    if(!F().quotable(u.i)||!CK.mkt||!CK.mkt.history)return Promise.resolve(Object.assign(u,{weekly:null}));
    return CK.mkt.history(u.id).then(function(b){var c=b&&b.length&&b[b.length-1].currency||u.ccy;u.weekly=F().weeklyEUR(b,c,function(cc,d){return F().fxRate(cc,d);});return u;},function(){u.weekly=null;return u;});});
  Promise.all(load).then(function(us){var rest=uniq.slice(25);RISK.res=F().risk(us.concat(rest),cashW);RISK.ts=now();RISK.busy=false;schedule();},function(){RISK.busy=false;});
}
function open(t){if(t&&TAB_IDS.indexOf(t)>=0){tab=t;lsSet("pf:tab",t);}if(CK.layout&&CK.layout.show)CK.layout.show("portefeuille");if(built)paint();}
function fromHash(){var h=typeof location!=="undefined"?String(location.hash||""):"",m=/^#portefeuille(?:\/([a-z]+))?$/.exec(h);if(!m)return;open(m[1]);}

CK.pf={
  boot:function(){if(CK.onView)CK.onView("portefeuille",onView);
    CK.onPrefs=function(){if(built)schedule();if(CK.worlds&&CK.worlds.refresh)try{CK.worlds.refresh();}catch(e){}};fromHash();if(typeof window!=="undefined"&&window.addEventListener)window.addEventListener("hashchange",fromHash);},
  open:open,home:home,start:start,stop:stop,TABS:TABS,
  add:function(){open();setTimeout(function(){act("add-pos");},300);},
  importer:function(){open();setTimeout(function(){act("import");},300);},
  state:function(){return {tab:tab,acc:accF,running:!!loopT,subscribed:subKey,seen:seen,quotes:Object.keys(Q).length};},
  _t:{resumeHTML:resumeHTML,positionsHTML:positionsHTML,opsHTML:opsHTML,repartHTML:repartHTML,riskHTML:riskHTML,accountsHTML:accountsHTML,checksHTML:checksHTML,
    donutSVG:donutSVG,accForm:accForm,posForm:posForm,txForm:txForm,importPreviewHTML:importPreviewHTML,jsonPreviewHTML:jsonPreviewHTML,positionsCSV:positionsCSV,
    suggest:suggest,sugHTML:sugHTML,peaPass:peaPass,backupHTML:backupHTML,money:money,heldIds:heldIds,
    setQ:function(m){Q=dict();Object.keys(m||{}).forEach(function(k){Q[k]=m[k];});},setRes:function(r){RES=r||dict();},
    reset:function(){stop();if(CK.alui&&CK.alui.reset)CK.alui.reset();if(CK.btui&&CK.btui.reset)CK.btui.reset();P=null;Q=dict();RES=dict();tab="positions";accF=null;built=false;fxAsked=false;robotTs=0;seen=false;RISK={key:"",res:null,busy:false,ts:0};IMP=null;}}
};
})();
