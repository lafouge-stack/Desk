/* ================================================================
   COCKPIT — Onglet « Allocation » du Portefeuille (phase 5) : CK.alui
   « Proposition du mois selon tes règles » : synthèse, allocation actuelle vs cible, décisions
   par classe (raisons, risques, confiance, instruments, alternatives PEA), ordres indicatifs
   par compte, classes écartées, journal des mois précédents, méthode.
   Charge seulement à l'ouverture de l'onglet : historiques du robot (≈ 10 fichiers, en cache),
   Binance pour la crypto, résumé du robot. Aucun appel au scanner TradingView.
   Les fonctions de rendu (CK.alui._t) n'utilisent pas le DOM : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5;
function U(){return CK.u||{};}
function M(){return CK.models||{};}
function A(){return CK.alloc;}
function esc(s){var f=U().esc;return f?f(s):String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fin(x){return typeof x==="number"&&isFinite(x);}
function nf(v,d){if(!fin(v))return "—";return Number(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function now(){var e=CK.dk&&CK.dk.env;return e&&typeof e.now==="function"?e.now():Date.now();}
function frDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
function share(v){return fin(v)?nf(v*100,1)+" %":"—";}
function pp(v){if(!fin(v))return "—";var r=Math.round(v*10)/10;return (r>0?"+":r<0?"−":"")+nf(Math.abs(r),1)+" pt"+(Math.abs(r)>=2?"s":"");}
var HIDE="•••";
function money(v,hide){if(!fin(v))return "—";if(hide)return HIDE+" €";var a=Math.abs(v);return nf(v,a>=1000?0:a>=10?0:2)+" €";}
function disclaimer(){return CK.DISCLAIMER||"";}

/* ---------- Libellés ---------- */
var ACT={"RENFORCER":["up","Renforcer"],"RÉDUIRE":["down","Réduire"],"BASCULER VERS UN AUTRE ACTIF":["sw","Basculer vers un autre actif"],
  "PASSER EN LIQUIDITÉS":["cash","Passer en liquidités"],"CONSERVER":["keep","Conserver"],"NE RIEN FAIRE":["none","Ne rien faire"]};
var REG_CL={risk_on:"up",neutre:"",risk_off:"down",haute_volatilite:"warn",inconnu:""};
function actBadge(a){var m=ACT[a]||["none",a];return '<span class="al-act al-act-'+m[0]+'">'+esc(m[1])+'</span>';}
function peaMini(x){if(!x)return "";return x.ok?'<span class="mk-pea ok" title="'+esc(x.reason||"Éligible PEA")+'">PEA</span>':'<span class="mk-pea no" title="'+esc(x.reason||"")+'">Hors PEA</span>';}
function confTxt(c){if(!c)return "—";return '<span class="al-conf al-conf-'+(c.n>=4?"hi":c.n>=2?"mid":"lo")+'" title="'+esc(c.checks.map(function(x){return (x.ok?"✓ ":"✗ ")+x.t;}).join("\n"))+'">'+esc(c.label)+'</span>';}

/* ================================================================
   Rendu (sans DOM)
   ================================================================ */
/** Résumé de tes règles + bouton. */
function rulesHTML(p,hide){
  var s=CK.prefs?CK.prefs.summary(p):null;if(!s)return "";
  return '<div class="al-rules"><div><b>Tes règles</b> · '+esc(s.classes.join(", ")||"aucune classe")+'<br><span>'+esc(s.vehicles.join(", ")||"aucun type de produit")+' · profil '+esc(s.profile)+' · '+esc(s.horizon)+' · PEA '+esc(s.pea.toLowerCase())+
    (s.contribution>0?' · versement '+(hide?HIDE:esc(nf(s.contribution,0)))+' €/mois':'')+'</span></div><button type="button" class="btn sm" data-pf="al-prefs">Modifier mes règles</button></div>';
}
/** Avant tout calcul : définir ses règles. */
function setupHTML(){
  return '<div class="al-setup"><h3>Proposition du mois selon tes règles</h3>'+
    '<p>Chaque mois, le Desk peut te proposer une répartition de ton portefeuille et des mouvements indicatifs, calculés <b>uniquement</b> sur les classes d\'actifs et les types de produits que tu autorises, avec ton profil, ton horizon, tes limites et tes enveloppes (PEA, compte-titres…).</p>'+
    '<p>Rien n\'est calculé tant que tu n\'as pas enregistré tes propres règles. Aucun ordre n\'est jamais passé.</p>'+
    '<button type="button" class="btn primary" data-pf="al-prefs">Définir mes règles</button></div>';
}
/** Montants en euros d'un message masqués (« Masquer les montants »). */
function maskEUR(t,hide){return hide?String(t).replace(/[\u2212+-]?\d[\d\u00a0\u202f ]*(,\d+)? \u20ac/g,HIDE+" \u20ac"):t;}
function flagsHTML(list,hide){
  if(!list||!list.length)return "";var seen={},lv={attention:["warn","!","À vérifier"],info:["","i","Info"],alerte:["down","!","Alerte"]};
  var u=list.filter(function(f){if(seen[f.msg])return false;seen[f.msg]=1;return true;});
  return '<ul class="pf-checks al-flags">'+u.map(function(f){var m=lv[f.level]||lv.info;return '<li><i class="'+m[0]+'" aria-hidden="true">'+m[1]+'</i><span><b>'+esc(m[2])+'</b> · '+esc(maskEUR(f.msg,hide))+'</span></li>';}).join("")+'</ul>';
}
function tile(k,v,cls,sub){return '<div class="pf-kpi"><em>'+esc(k)+'</em><b class="'+(cls||"")+'">'+v+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</div>';}
/** En-tête : mois, date des données, régime, volatilité, rotation, coûts. */
function headHTML(R,o){
  var t=R.totals,h=!!(o&&o.hide),g=R.regime||{};
  return '<div class="al-head"><div><h3>Proposition de '+esc(R.monthLabel)+' selon tes règles</h3><p>'+esc(R.dataLabel)+' (dernière séance Euronext du mois, 22 h 30) · calculée le '+esc(frDate(new Date(R.computed_at).toISOString()))+
    ' · profil '+esc(R.profile.label)+(R.profile.perso?" (poids personnalisés)":"")+'</p></div><button type="button" class="btn sm" data-pf="al-run" title="Relire les historiques et recalculer">Recalculer</button></div>'+
    '<div class="pf-kpis">'+
    tile("Régime de marché",esc(g.label||"—"),REG_CL[g.id]||"",esc((g.reasons||[]).join(" · ")))+
    tile("Volatilité estimée",share(t.sigma_before)+' → '+share(t.sigma_after),"",R.profile.vol_cible?"cible du profil : "+share(R.profile.vol_cible):"")+
    tile("Rotation",share(t.turnover),"","ventes / portefeuille"+(R.portfolio?"":" (sans portefeuille)"))+
    tile("Coût estimé",money(t.cost,h),"",t.tax>0?"impôt indicatif : "+money(t.tax,h):"courtage, spread, change")+
    tile("Diversification",fin(t.neff_before)&&fin(t.neff_after)?nf(t.neff_before,1)+' → '+nf(t.neff_after,1):"—","","nombre effectif de classes (hors liquidités)")+'</div>';
}
/** Allocation actuelle vs cible : deux barres par poche (actuel en gris, cible en couleur), valeurs écrites au bout. */
function barsHTML(R){
  var rows=R.decisions.filter(function(d){return d.w0>0.0005||d.w_target>0.0005;});if(!rows.length)return "";
  var mx=Math.max.apply(null,rows.map(function(d){return Math.max(d.w0,d.w_target);}).concat([0.01]));
  var bar=function(v,c){return '<i class="'+c+'" style="width:'+(Math.max(0,v)/mx*100).toFixed(1)+'%"></i>';};
  return '<section class="al-card"><h4>Allocation actuelle et cible</h4><div class="al-leg"><span><i class="al-b0"></i>Actuelle</span><span><i class="al-b1"></i>Cible</span></div><div class="al-bars" role="table" aria-label="Allocation actuelle et cible">'+
    rows.map(function(d){return '<div class="al-br" role="row" title="'+esc(d.label+" : actuelle "+share(d.w0)+", cible "+share(d.w_target)+" ("+pp(d.delta_pp)+")")+'"><span role="rowheader">'+esc(d.label)+'</span>'+
      '<div class="al-bw" role="cell"><div>'+bar(d.w0,"al-b0")+'<em>'+share(d.w0)+'</em></div><div>'+bar(d.w_target,"al-b1")+'<em>'+share(d.w_target)+'</em></div></div><b role="cell" class="'+(d.delta_pp>0.05?"up":d.delta_pp<-0.05?"down":"")+'">'+pp(d.delta_pp)+'</b></div>';}).join("")+
    '</div></section>';
}
var DCOLS=["Classe","Actuelle","Cible","Écart","Score","Action","Confiance","Coût"];
/** Tableau des décisions ; un clic sur une ligne déplie le détail. */
function decisionsHTML(R,o){
  o=o||{};var h=!!o.hide,open=o.open||{};
  var rows=R.decisions.map(function(d){var k=d.poche,isO=!!open[k];
    var main='<tr class="clk al-dr'+(isO?" on":"")+'" data-pf="al-open" data-id="'+esc(k)+'" tabindex="0" aria-expanded="'+(isO?"true":"false")+'"><td><b>'+esc(d.label)+'</b></td><td class="r">'+share(d.w0)+'</td><td class="r">'+share(d.w_target)+'</td>'+
      '<td class="r '+(d.delta_pp>0.05?"up":d.delta_pp<-0.05?"down":"")+'">'+pp(d.delta_pp)+'</td><td class="r">'+(fin(d.score)?nf(d.score,0):"—")+'</td><td>'+actBadge(d.action)+'</td><td>'+confTxt(d.confiance)+'</td><td class="r">'+(d.cout_estime_eur>0?money(d.cout_estime_eur,h):"—")+'</td></tr>';
    if(!isO)return main;
    var ins=d.instruments_proposes.length?'<ul class="al-ins">'+d.instruments_proposes.map(function(l){return '<li><b>'+esc(l.symbol)+'</b> <span>'+esc(l.name)+'</span> '+peaMini(l.pea)+' <em>'+share(l.w)+(fin(l.amount)?' · '+money(l.amount,h):'')+'</em>'+
      (l.reasons&&l.reasons.length?'<small>'+esc(l.reasons.map(function(r){return r.t;}).join(" · "))+'</small>':'')+'</li>';}).join("")+'</ul>':'<p class="mk-note">Aucun instrument proposé.</p>';
    var alt=d.alternatives_pea.length?'<p class="al-alt"><b>Alternatives éligibles PEA</b> : '+d.alternatives_pea.map(function(a){return esc(a.symbol)+' ('+esc(a.name)+(fin(a.ter)?', frais '+nf(a.ter,2)+' %':'')+')';}).join(" · ")+'</p>':'';
    var m=d.metrics,mt=m&&!m.stale?'<p class="al-met">Momentum 1 / 3 / 6 / 12 mois : '+[m.mom1,m.mom3,m.mom6,m.mom12].map(function(x){return fin(x)?nf(x*100,1)+" %":"—";}).join(" / ")+
      ' · volatilité 60 j : '+share(m.vol60)+' · sous le plus haut d\'un an : '+(fin(m.dd)?nf(m.dd*100,1)+" %":"—")+' · tendance : '+(fin(m.trend)?Math.round(m.trend*4)+"/4 signaux haussiers":"—")+
      (fin(m.corrRef)?' · corrélation aux actions : '+nf(m.corrRef,2):'')+'</p>':'';
    var det='<tr class="al-det"><td colspan="'+DCOLS.length+'"><div class="al-detb">'+
      '<div><h5>Pourquoi</h5><ul>'+d.raisons.map(function(r){return '<li>'+esc(r)+'</li>';}).join("")+'</ul></div>'+
      '<div><h5>Risques</h5>'+(d.risques.length?'<ul>'+d.risques.map(function(r){return '<li>'+esc(r)+'</li>';}).join("")+'</ul>':'<p class="mk-note">Aucun risque particulier relevé.</p>')+
        (fin(d.impact_vol_pp)?'<p class="al-met">Effet estimé sur la volatilité du portefeuille : '+pp(d.impact_vol_pp)+'</p>':'')+'</div>'+
      '<div class="al-wide"><h5>Instruments proposés</h5>'+ins+alt+'</div>'+
      '<div class="al-wide al-foot">'+mt+'<p class="al-met">Données : '+esc(d.fenetre.proxy||"—")+(d.fenetre.from?' · du '+esc(frDate(d.fenetre.from))+' au '+esc(frDate(d.fenetre.to)):'')+' · calcul au '+esc(frDate(d.date_calcul))+'</p></div>'+
      '</div></td></tr>';
    return main+det;}).join("");
  return '<section class="al-card"><h4>Décisions proposées</h4><p class="mk-note">Clique sur une ligne pour voir les raisons, les risques et les instruments.</p><div class="tbl-wrap"><table class="scan mk-table pf-table pf-tb al-table"><thead><tr>'+
    DCOLS.map(function(c,k){return '<th'+(k>0&&k<5||k===7?' class="r"':'')+'>'+esc(c)+'</th>';}).join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}
/** Ordres indicatifs, par compte. */
function ordersHTML(R,o){
  var h=!!(o&&o.hide),list=R.orders||[];if(!R.portfolio)return '<section class="al-card"><h4>Mouvements indicatifs</h4><p class="mk-note">Ajoute tes comptes et tes positions dans le Portefeuille pour obtenir des mouvements compte par compte (sans transfert entre enveloppes).</p></section>';
  if(!list.length)return '<section class="al-card"><h4>Mouvements indicatifs</h4><p class="mk-note">Aucun mouvement proposé ce mois-ci.</p></section>';
  var by={},order=[];list.forEach(function(x){if(!by[x.account_id]){by[x.account_id]={name:x.account,type:x.account_type,list:[]};order.push(x.account_id);}by[x.account_id].list.push(x);});
  var ct=R.contrib||{};
  return '<section class="al-card"><h4>Mouvements indicatifs par compte</h4><p class="mk-note">Aucun ordre n\'est passé : ce sont des montants indicatifs, à toi de décider et d\'agir chez ton courtier. Quantités approximatives, au dernier cours connu.</p>'+
    order.map(function(k){var g=by[k];g.list.sort(function(a,b){return (a.side==="vente"?0:1)-(b.side==="vente"?0:1)||b.amount-a.amount;});
      return '<div class="al-acc"><h5>'+esc(g.name)+(ct[k]>0.5?' <span>· versement '+money(ct[k],h)+'</span>':'')+'</h5><ul class="al-ord">'+g.list.map(function(x){
        var sym=x.i?x.i.symbol:x.instrument_id,nm=x.i?x.i.name:"";
        return '<li class="'+(x.skipped?"skip":"")+'"><span class="al-side al-'+(x.side==="achat"?"buy":"sell")+'">'+(x.side==="achat"?"Acheter":"Vendre")+'</span><b>'+esc(sym)+'</b><span class="al-nm">'+esc(nm)+'</span>'+
          '<em>'+money(x.amount,h)+(fin(x.qty)&&!h?' · ≈ '+nf(x.qty,x.qty>=10?0:x.qty>=1?2:4)+' part'+(x.qty>=2?"s":""):'')+(x.all&&x.side==="vente"?' · toute la ligne':'')+'</em>'+
          '<small>'+(x.skipped?"ignoré (montant trop faible)":"coût ≈ "+money(x.cost,h)+(x.tax>0.5?" · impôt indicatif ≈ "+money(x.tax,h):x.side==="vente"&&(x.account_type==="PEA"||x.account_type==="PEA_PME")?" · sans impôt tant que l'argent reste dans le PEA":""))+'</small></li>';}).join("")+'</ul></div>';}).join("")+
    '</section>';
}
/** Classes écartées par tes règles, avec le motif. */
function excludedHTML(R){
  if(!R.excluded||!R.excluded.length)return "";
  return '<details class="al-card al-ex"><summary>Classes écartées ('+R.excluded.length+')</summary><ul>'+R.excluded.map(function(x){return '<li><b>'+esc(x.label)+'</b> · '+esc(x.why)+'</li>';}).join("")+'</ul></details>';
}
/** Positions non éligibles au PEA : alternatives de même exposition et coût d'une bascule (impôt estimé + versement consommé). */
function peaAltHTML(list,o){
  var h=!!(o&&o.hide);if(!list||!list.length)return "";
  return '<section class="al-card"><h4>Alternatives éligibles PEA</h4><ul class="al-ins">'+list.map(function(s){
    return '<li><b>'+esc(s.i.symbol)+'</b> <span>'+esc(s.i.name)+'</span> <span class="mk-pea no">Hors PEA</span>'+
      (s.alts.length?'<small>Même exposition dans un PEA : '+s.alts.map(function(a){return esc(a.symbol)+(fin(a.ter)?" ("+nf(a.ter,2)+" %)":"");}).join(", ")+
        ' · basculer depuis un compte-titres : impôt estimé ≈ '+money(s.tax,h)+' et '+money(s.deposit,h)+' de versement consommé sur le plafond du PEA</small>':'<small>Aucune alternative éligible de même exposition dans le référentiel.</small>')+'</li>';}).join("")+'</ul></section>';
}
/** Journal des mois précédents (une entrée figée par mois). */
function journalHTML(items,cur){
  var list=(items||[]).filter(function(x){return !cur||x.month!==cur;});if(!list.length)return "";
  return '<details class="al-card al-jr"><summary>Journal des mois précédents ('+list.length+')</summary><div class="tbl-wrap"><table class="scan mk-table pf-table pf-tb"><thead><tr><th>Mois</th><th>Profil</th><th>Régime</th><th>Mouvements</th><th class="r">Volatilité</th></tr></thead><tbody>'+
    list.map(function(x){var mv=(x.decisions||[]).filter(function(d){return d.a!=="CONSERVER"&&d.a!=="NE RIEN FAIRE";}).map(function(d){return (ACT[d.a]?ACT[d.a][1]:d.a)+" "+d.l;}).join(", ");
      return '<tr><td>'+esc(x.monthLabel||x.month)+'</td><td>'+esc(x.profile||"")+'</td><td>'+esc(x.regime||"")+'</td><td>'+esc(mv||"rien à faire")+'</td><td class="r">'+share(x.sigma_before)+' → '+share(x.sigma_after)+'</td></tr>';}).join("")+
    '</tbody></table></div></details>';
}
function methodHTML(R){
  return '<details class="al-card al-meth"><summary>Comment c\'est calculé</summary><ol>'+(R.log||[]).map(function(l){return '<li>'+esc(l)+'</li>';}).join("")+'</ol>'+
    '<p class="mk-note">Étapes : univers (tes classes et tes types de produits) → poids du profil et de l\'horizon → inclinaison selon le score de rotation de chaque classe (momentum ajusté du risque, tendance, baisse depuis le plus haut, volatilité, diversification, comparés à leur propre historique de 5 ans) → régime de marché → cible de volatilité → tes plafonds et ton plancher → bande d\'inaction et rotation maximale → placement dans tes comptes sans transfert → instruments.'+
    ' Seuls des historiques datés jusqu\'à la date de décision sont utilisés (aucune donnée instantanée). Corrélations : '+esc(R.totals.cov_weeks||0)+' semaines de rendements en euros'+(R.totals.cov_from?' ('+esc(frDate(R.totals.cov_from))+' au '+esc(frDate(R.totals.cov_to))+')':'')+'.</p></details>';
}
/** Les 4 profils côte à côte : allocation de l'algorithme, risque, résultats passés, contrôles, bouton pour choisir. */
function profilesHTML(st){
  var P=st.profiles,V=st.valid||{},cur=(st.prefs||{}).risk_profile;if(!P)return "";var ord=(CK.bt&&CK.bt.ORDER)||["prudent","modere","dynamique","agressif"];
  var ps=ord.filter(function(q){return P[q];}),rows=[];A().poches().forEach(function(q){if(ps.some(function(k){return P[k].ok&&(P[k].w[q.id]||0)>0.0005;}))rows.push(q);});
  var cell=function(k,html,cls){return '<td class="r'+(k===cur?" al-me":"")+(cls?" "+cls:"")+'">'+html+'</td>';};
  var head='<tr><th>Classe</th>'+ps.map(function(k){return '<th class="r'+(k===cur?" al-me":"")+'">'+esc(P[k].label||k)+(k===cur?' <em>(toi)</em>':'')+'</th>';}).join("")+'</tr>';
  var body=rows.map(function(q){return '<tr><td>'+esc(q.label)+'</td>'+ps.map(function(k){return cell(k,P[k].ok?share(P[k].w[q.id]||0):"—");}).join("")+'</tr>'+
      (q.id==="actions"&&ps.some(function(k){return P[k].direct>0.0005;})?'<tr class="al-sub"><td>dont actions françaises en direct</td>'+ps.map(function(k){return cell(k,P[k].ok?share(P[k].direct):"—");}).join("")+'</tr>':'');}).join("");
  var m=function(lbl,f){return '<tr class="al-pm"><td>'+esc(lbl)+'</td>'+ps.map(function(k){return cell(k,f(k));}).join("")+'</tr>';};
  var bt=function(k,key,fmt){var v=V[k]&&V[k].m;return v&&fin(v[key])?fmt(v[key]):"—";};
  var from=null;ps.forEach(function(k){if(V[k]&&V[k].m&&V[k].m.from&&(!from||V[k].m.from<from))from=V[k].m.from;});
  var foot=m("Volatilité visée",function(k){return P[k].ok?share(P[k].target):"—";})+
    m("Rendement annualisé"+(from?" (depuis "+from.slice(0,4)+")":""),function(k){return bt(k,"cagr",function(x){return pp(x*100).replace(/ pts?$/," %");});})+
    m("Volatilité réalisée",function(k){return bt(k,"vol",share);})+m("Perte maximale",function(k){return bt(k,"mdd",function(x){return pp(x*100).replace(/ pts?$/," %");});})+
    m("Contrôles",function(k){var v=V[k];return v?(v.ok?'<span class="al-ok">✓ validé</span>':'<span class="al-ko" title="'+esc(v.checks.filter(function(c){return !c.ok;}).map(function(c){return c.label+" : "+c.txt;}).join(" · "))+'">✗ refusé · modèle de référence</span>'):"—";})+
    '<tr class="al-pm"><td></td>'+ps.map(function(k){return cell(k,k===cur?'<span class="al-cur">Ton profil</span>':'<button type="button" class="btn sm" data-pf="al-profil" data-id="'+esc(k)+'">Choisir</button>');}).join("")+'</tr>';
  var det=ps.filter(function(k){return V[k];}).map(function(k){return '<div><h5>'+esc(P[k].label||k)+' · '+(V[k].ok?"validé":"refusé")+'</h5><ul>'+V[k].checks.map(function(c){return '<li class="'+(c.ok?"":"ko")+'">'+(c.ok?"✓ ":"✗ ")+'<b>'+esc(c.label)+'</b> · '+esc(c.txt)+'</li>';}).join("")+'</ul></div>';}).join("");
  return '<section class="al-card al-profiles"><h4>Les 4 profils, du moins au plus risqué</h4><p class="mk-note">Répartition calculée par l\'algorithme pour chaque profil (volatilité visée, bornes du profil, tendance des classes), avec tes classes cochées. Chaque profil passe des contrôles automatiques sur le passé avant d\'être affiché : s\'il échoue, son modèle de référence le remplace.</p>'+
    '<div class="tbl-wrap"><table class="scan mk-table pf-tb al-ptable"><thead>'+head+'</thead><tbody>'+body+foot+'</tbody></table></div>'+
    (det?'<details class="al-pdet"><summary>Détail des contrôles</summary><div class="al-pgrid">'+det+'</div></details>':'')+'</section>';
}
/** Vue complète. st : {prefs, R (proposition), busy, err, progress, journal, open, hide, peaAlt}. */
function viewHTML(st){
  var p=st.prefs||{};if(!p.saved)return setupHTML();
  var head=rulesHTML(p,st.hide);
  if(st.err&&!st.R)return head+'<div class="pf-banner warn">'+esc(st.err)+'</div>';
  if(!st.R)return head+'<div class="al-load"><span class="al-spin" aria-hidden="true"></span>Calcul de la proposition… '+esc(st.progress||"lecture des historiques")+'</div>';
  var R=st.R;if(!R.ok)return head+'<div class="pf-banner warn">'+esc(R.why||"Calcul impossible.")+'</div>'+(R.excluded?excludedHTML(R):"");
  return head+profilesHTML(st)+headHTML(R,st)+flagsHTML(R.flags,st.hide)+(st.busy?'<p class="mk-note">Mise à jour en cours…</p>':'')+barsHTML(R)+decisionsHTML(R,st)+ordersHTML(R,st)+peaAltHTML(st.peaAlt,st)+excludedHTML(R)+journalHTML(st.journal,R.month)+methodHTML(R)+
    '<p class="mk-disc">'+esc(disclaimer())+'</p>';
}

/* ================================================================
   Journal (CK.lsj("alloc:hist")) : une entrée par mois, figée à son premier calcul
   ================================================================ */
var JKEY="alloc:hist",JMAX=36;
function jRead(){var r=null;try{r=CK.lsj?CK.lsj(JKEY):null;}catch(e){r=null;}var it=r&&Array.isArray(r.items)?r.items:[];
  return it.filter(function(x){return x&&typeof x==="object"&&/^\d{4}-\d{2}$/.test(x.month||"");}).map(function(x){
    var cl=function(s,n){return M().cleanText?M().cleanText(s,n):String(s||"").slice(0,n);};
    return {month:x.month,monthLabel:cl(x.monthLabel,30),asOf:cl(x.asOf,10),profile:cl(x.profile,40),regime:cl(x.regime,40),sigma_before:fin(x.sigma_before)?x.sigma_before:null,sigma_after:fin(x.sigma_after)?x.sigma_after:null,
      prefs_hash:cl(x.prefs_hash,20),decisions:Array.isArray(x.decisions)?x.decisions.slice(0,20).map(function(d){return {p:cl(d&&d.p,30),l:cl(d&&d.l,60),a:cl(d&&d.a,40),w0:fin(d&&d.w0)?d.w0:null,wt:fin(d&&d.wt)?d.wt:null};}):[]};});}
function jEntry(R){return {month:R.month,monthLabel:R.monthLabel,asOf:R.asOf,profile:R.profile.label,regime:R.regime&&R.regime.label,sigma_before:R.totals.sigma_before,sigma_after:R.totals.sigma_after,prefs_hash:R.prefs_hash,
  decisions:R.decisions.map(function(d){return {p:d.poche,l:d.label,a:d.action,w0:Math.round(d.w0*1e4)/1e4,wt:Math.round(d.w_target*1e4)/1e4};})};}
/** Ajoute la proposition du mois au journal si le mois n'y est pas encore (replace = remplacer l'entrée du mois). */
function jAdd(R,replace){if(!R||!R.ok)return jRead();var it=jRead(),has=it.some(function(x){return x.month===R.month;});
  if(has&&!replace)return it;it=it.filter(function(x){return x.month!==R.month;});it.unshift(jEntry(R));it.sort(function(a,b){return a.month<b.month?1:-1;});it=it.slice(0,JMAX);
  try{if(CK.lsj)CK.lsj(JKEY,{v:1,items:it});}catch(e){}return it;}

/* ================================================================
   Données : historiques des poches, indice de référence, VIX, résumé du robot
   ================================================================ */
var ST={R:null,busy:false,err:null,progress:"",key:"",dataKey:"",data:null,dataTs:0,open:{},memo:{}},repaint=null;
function fxFn(eurusd){
  // € pour 1 unité à la date d : fixing BCE si disponible, sinon 1 / EURUSD du robot (même date ou avant), jamais une date future
  // (CK.fx.rate avec une date ne reprend jamais un taux postérieur ; CK.pfc.fxRate, lui, retombe sur le dernier taux connu)
  return function(ccy,d){if(ccy==="EUR")return 1;var r=CK.fx&&CK.fx.rate?CK.fx.rate(ccy,d):null;
    var al=CK.fx&&CK.fx.ALIAS&&CK.fx.ALIAS[ccy],base=al?al[0]:ccy;
    if(!(r>0)&&base==="USD"&&eurusd&&eurusd.t.length){var e=CK.ind.idxAt(eurusd.t,Date.parse(d+"T23:59:59Z"));if(e>=0&&eurusd.c[e]>0)r=1/eurusd.c[e];}
    return r>0?r:null;};
}
function needIds(p){
  var C=cfg(),px=C.proxies||{},ids=[],add=function(x){if(x&&ids.indexOf(x)<0)ids.push(x);};
  A().poches().forEach(function(q){if(!M().isClassAllowed(q.classe,p.classes||{}))return;var x=px[q.id];if(x&&x.id)add(x.id);});
  add((C.regime||{}).indice_reference);add((C.regime||{}).vix);
  return ids;
}
function cryptoIds(p,held){var sc=(cfg().selection||{}).cryptos_proposees||[],out=[];if(!M().isClassAllowed("crypto",p.classes||{}))return out;
  sc.concat(held||[]).forEach(function(id){if(/^crypto:/.test(id)&&out.indexOf(id)<0)out.push(id);});return out;}
/** Actions du CAC 40 à noter (seulement si les actions et les titres en direct sont cochés) et leurs indices de référence. */
function stockIds(p){var u=(cfg().selection||{}).univers_actions_directes||[];return p&&p.vehicles&&p.vehicles.titre&&M().isClassAllowed("actions",p.classes||{})?u.slice():[];}
function loadData(p,heldCrypto){
  var sids=stockIds(p),srefs=sids.length?["tv:EURONEXT:PX1","tv:STOXX:SXXP"]:[];
  var ids=needIds(p).concat(sids.concat(srefs).filter(function(x){return needIds(p).indexOf(x)<0;})),cids=cryptoIds(p,heldCrypto),key=ids.concat(cids).join(",")+"|"+new Date(now()).toISOString().slice(0,10);
  if(ST.data&&ST.dataKey===key&&now()-ST.dataTs<6*36e5)return Promise.resolve(ST.data);
  var usd="tv:FX_IDC:EURUSD",T=now(),done=0,total=ids.length+cids.length+2;
  var tick=function(){done++;ST.progress="historiques : "+done+" / "+total;if(repaint)repaint();};
  var hist=function(id,o){return CK.mkt&&CK.mkt.history?CK.mkt.history(id,o).then(function(b){tick();return b;},function(){tick();return [];}):Promise.resolve([]);};
  var fxp=CK.fx&&CK.fx.load?Promise.resolve(CK.fx.load()).then(null,function(){return null;}):Promise.resolve(null);
  return fxp.then(function(){return Promise.all([hist(usd,{}),CK.mkt&&CK.mkt.resume?CK.mkt.resume().then(function(r){tick();return r;}):Promise.resolve(null),CK.mkt&&CK.mkt.taux?CK.mkt.taux():null]);}).then(function(base){
    var eu=A().eurSeries(base[0],"EUR",null),fx=fxFn(eu),res=base[1]&&base[1].items||null;
    var jobs=ids.map(function(id){return hist(id,/^crypto:/.test(id)?{from:T-8*365*DAY}:{});});
    var cj=cids.filter(function(id){return ids.indexOf(id)<0;}).map(function(id){return hist(id,{});});
    return Promise.all(jobs.concat(cj)).then(function(all){
      var raw={},series={};ids.forEach(function(id,k){raw[id]=all[k];});cids.filter(function(id){return ids.indexOf(id)<0;}).forEach(function(id,k){raw[id]=all[ids.length+k];});
      // séries en euros, dividendes réinvestis à leur date de détachement (ETF distribuants, actions) ; le VIX est un niveau, pas un prix
      var conv=function(id){var b=raw[id]||[];if(!b.length)return null;var ccy=b[b.length-1].currency||"EUR",isVix=id===(cfg().regime||{}).vix,div=null;
        if(!isVix)try{var ev=CK.mkt.adapters().hist.events(CK.ref.get(id));div=ev&&ev.div||null;}catch(e){div=null;}
        var S=div&&div.length&&CK.ms?CK.ms.prep(b,div,ccy,fx):A().eurSeries(b,isVix?"EUR":ccy,fx);return S.t.length?S:null;};
      var C=cfg(),px=C.proxies||{};A().poches().forEach(function(q){var x=px[q.id];if(x&&x.id&&raw[x.id])series[q.id]=conv(x.id);});
      var vols={};cids.forEach(function(id){var S=conv(id);if(S&&S.t.length>130)vols[id]=CK.ind.vol(S.t,S.c,120,null,365);});
      var resume=null,closes={};if(res&&typeof res==="object"){resume={};Object.keys(res).forEach(function(k){var r=res[k];if(r&&typeof r==="object"){resume[k]={d:r.d,first:r.first,n:r.n};if(fin(r.c))closes[k]=r.c;}});}
      var stocks={};sids.concat(srefs).forEach(function(id){var S=conv(id);if(S)stocks[id]=S;});
      var rf=base[2]&&base[2].rf&&Array.isArray(base[2].rf.v)?base[2].rf:null,rf12=rf&&rf.v.length?rf.v[rf.v.length-1]/100:0;
      var d={series:series,ref:conv((C.regime||{}).indice_reference),vix:conv((C.regime||{}).vix),resume:resume,closes:closes,vols:vols,stocks:stocks,sids:sids,rf:rf,rf12:rf12,
        missing:ids.filter(function(id){return sids.indexOf(id)<0&&srefs.indexOf(id)<0&&(!raw[id]||!raw[id].length);}),missingStocks:sids.filter(function(id){return !stocks[id];})};
      ST.data=d;ST.dataKey=key;ST.dataTs=now();ST.memo={};return d;});
  });
}

/* ---------- Actions en direct : notes du screener mensuel (point-in-time, à la date de décision) ---------- */
function stockScores(d,p){
  if(!d.sids||!d.sids.length||!CK.ms)return null;var ids=d.sids.filter(function(id){return d.stocks[id];});if(!ids.length)return null;
  var R=CK.ms.run({T:A().decision(now()).T,series:d.stocks,ids:ids,prefs:p,rf12:d.rf12}),o={};
  R.rows.forEach(function(r){if(fin(r.score))o[r.id]={score:r.score,trend:r.sub&&r.sub.tendance,label:r.label};});return o;
}

/* ---------- Contrôles automatiques des 4 profils (backtest point-in-time), mémorisés pour le mois ---------- */
var VKEY="alloc:valid";
function hashOf(o){var s=JSON.stringify(o),h=5381;for(var i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36);}
function validKey(p,d){var C=cfg(),S=d.series.actions||d.ref,last=S&&S.t.length?new Date(S.t[S.t.length-1]).toISOString().slice(0,10):"";
  return (A().decision(now())||{}).month+"|"+hashOf({c:p.classes,v:p.vehicles,pm:p.pea_mode,h:p.horizon,l:p.limits,f:p.filters,x:p.poches_exclues})+"|"+hashOf({p:C.profils,o:C.optimiseur,v:C.validation,x:C.proxies})+"|"+last+"|"+(d.rf?1:0);}
function vRead(k){try{var v=CK.lsj?CK.lsj(VKEY):null;return v&&v.key===k&&v.out&&typeof v.out==="object"?v.out:null;}catch(e){return null;}}
function vWrite(k,out){try{if(CK.lsj)CK.lsj(VKEY,{key:k,ts:now(),out:out});}catch(e){}}
/** Lance les 4 backtests pas à pas (la page reste fluide), puis les contrôles. Renvoie une promesse {profil: {ok, checks, m, ref}}. */
function validate(p,d){
  var k=validKey(p,d),hit=vRead(k);if(hit)return Promise.resolve(hit);
  var res={},order=CK.bt.ORDER,i=0;
  return new Promise(function(done){
    var nextProfile=function(){
      if(i>=order.length){var V=CK.bt.checks(res),out={};
        order.forEach(function(q){var v=V[q]||{};var pick=function(m){return m?{cagr:m.cagr,vol:m.vol,mdd:m.mdd,sharpe:m.sharpe,from:m.monthly&&m.monthly.length?m.monthly[0][0]:null}:null;};
          out[q]={ok:!!v.ok,checks:(v.checks||[]).map(function(c){return {label:c.label,ok:!!c.ok,txt:c.txt,skip:!!c.skip};}),m:pick(v.m),ref:pick(v.ref),target:v.target};});
        vWrite(k,out);done(out);return;}
      var q=order[i++],c=CK.bt.create({prefs:Object.assign({},p,{risk_profile:q,poids_perso:null}),series:d.series,ref:d.ref,vix:d.vix,rf:d.rf,capital:10000,costs:true,tax:"aucune",freq:1,memo:ST.memo,now:now()});
      if(c.error){res[q]={ok:false,why:c.error};nextProfile();return;}
      var tick=function(){var t=Date.now();while(Date.now()-t<25){if(!c.next()){res[q]=c.result();ST.progress="contrôles des profils : "+i+" / 4";if(repaint)repaint();setTimeout(nextProfile,0);return;}}
        ST.progress="contrôles des profils : "+(i-1)+" / 4 ("+Math.round(c.progress()*100)+" %)";if(repaint)repaint();setTimeout(tick,0);};
      tick();};
    nextProfile();});
}
/** Allocation calculée de chaque profil aujourd'hui (même univers, sans ton portefeuille), avec repli si refusé par les contrôles. */
function profilesNow(p,d,valid,scores){
  var out={},sc=cfg().selection||{},smin=fin(sc.titres_score_min)?sc.titres_score_min:60,tmin=fin(sc.titres_tendance_min)?sc.titres_tendance_min:50;
  var good=scores?Object.keys(scores).filter(function(id){var x=scores[id];return x.score>=smin&&(x.trend||0)>=tmin&&x.label!=="RÉDUIRE"&&x.label!=="HORS";}).length:0;
  CK.bt.ORDER.forEach(function(q){var v=valid&&valid[q],R=A().run({prefs:Object.assign({},p,{risk_profile:q,poids_perso:null}),now:now(),series:d.series,ref:d.ref,vix:d.vix,current:{},lite:true,memo:ST.memo,rf:d.rf12,
      fallback:v&&!v.ok?"contrôles non passés":null});
    if(!R.ok){out[q]={ok:false,why:R.why};return;}
    var prof=(cfg().profils||{})[q]||{},tv=prof.titres_vifs||{},N=tv.nombre||0,share=p.vehicles&&p.vehicles.titre&&N?(tv.part_max||0)/100*Math.min(1,good/N):0;
    out[q]={ok:true,w:R.final,target:R.target,sigma:R.sigma,algo:R.algo,direct:(R.final.actions||0)*share,label:prof.label||q};});
  return out;
}

/* ---------- Calcul ---------- */
function unitFn(){return function(id){var q=CK.mkt&&CK.mkt.last?CK.mkt.last(id):null,px=q&&q.last>0?q.last:null,ccy=q&&q.currency;
  if(!px){var r0=ST.data&&ST.data.closes&&ST.data.closes[id],i=CK.ref&&CK.ref.get(id);if(r0>0){px=r0;ccy=i&&i.currency||"EUR";}}
  if(!px)return null;var r=CK.pfc&&CK.pfc.fxRate?CK.pfc.fxRate(ccy||"EUR"):1;return r>0?px*r:null;};}
function keyOf(P,p){return (CK.prefs?JSON.stringify(p):"")+"|"+(P&&P.updated_at||"")+"|"+(P&&P.accounts?P.accounts.length:0)+"|"+(A().decision(now())||{}).month;}
/** Lance le calcul si nécessaire (règles enregistrées, portefeuille ou règles changés, données de plus de 6 h). */
function ensure(P,V,cb,force){
  repaint=cb||repaint;var p=CK.prefs?CK.prefs.get():null;if(!p||!p.saved){ST.R=null;return;}
  var k=keyOf(P,p);if(ST.busy||(!force&&ST.key===k&&ST.R&&now()-ST.dataTs<6*36e5))return;
  ST.busy=true;ST.err=null;ST.key=k;if(force)ST.data=null;
  var heldC=(V&&V.lines||[]).filter(function(L){return L.value>0&&/^crypto:/.test(L.instrument_id||"");}).map(function(L){return L.instrument_id;});
  loadData(p,heldC).then(function(d){
    var scores=stockScores(d,p);ST.stocks=scores;
    return (CK.bt&&CK.bt.checks?validate(p,d):Promise.resolve(null)).then(function(valid){return {d:d,valid:valid,scores:scores};});
  }).then(function(x){
    var d=x.d,valid=x.valid,me=valid&&valid[p.risk_profile];ST.valid=valid;
    try{ST.profiles=profilesNow(p,d,valid,x.scores);}catch(e){ST.profiles=null;}
    var cur=A().current(P,V,p.monthly_contribution_eur);
    var R=A().run({prefs:p,now:now(),series:d.series,ref:d.ref,vix:d.vix,current:cur,resume:d.resume,vols:d.vols,unit:unitFn(),memo:ST.memo,rf:d.rf12,stocks:x.scores,
      fallback:!p.poids_perso&&me&&!me.ok?me.checks.filter(function(c){return !c.ok;}).map(function(c){return c.label.toLowerCase();}).join(", "):null});
    if(R.ok&&d.missingStocks&&d.missingStocks.length)R.flags.push({level:"info",msg:"Historique pas encore publié pour "+d.missingStocks.length+" action(s) du CAC 40 : elles ne peuvent pas être choisies ce mois-ci."});
    if(R.ok&&d.missing.length)R.flags.push({level:"info",msg:"Historique indisponible pour le moment ("+d.missing.length+" série(s)) : les classes concernées gardent leur poids de profil, sans inclinaison."});
    ST.R=R;ST.busy=false;ST.progress="";
    if(R.ok)ST.journal=jAdd(R,false);
    if(repaint)repaint();
  },function(e){ST.busy=false;ST.err="Calcul impossible : "+(e&&e.message?e.message:String(e));if(repaint)repaint();});
}
/** Alternatives PEA pour les lignes non éligibles détenues hors PEA (si tu as un PEA ou si le mode PEA est actif). */
function peaAlts(P,V,p){
  if(!V||!CK.sel)return [];var hasPEA=(P.accounts||[]).some(function(a){return a.account_type==="PEA";});if(!hasPEA&&(!p||p.pea_mode==="off"))return [];
  var acc={};(V.accounts||[]).forEach(function(a){acc[a.id]=a;});var seen={},out=[];
  (V.lines||[]).forEach(function(L){var a=acc[L.account_id];if(!(L.value>0)||!a||a.account_type==="PEA"||a.account_type==="PEA_PME"||!L.i||seen[L.instrument_id])return;
    if(L.i.vehicle!=="etf"&&L.i.vehicle!=="titre")return;var s=CK.sel.peaSwitch(Object.assign({},L,{account_type:a.account_type}),p&&p.saved?p:null);if(s&&s.alts.length){seen[L.instrument_id]=1;out.push(s);}});
  return out;
}
function html(P,V,o){
  o=o||{};var p=CK.prefs?CK.prefs.get():{};if(!ST.journal)ST.journal=jRead();
  return viewHTML({prefs:p,R:ST.R,busy:ST.busy,err:ST.err,progress:ST.progress,journal:ST.journal,open:ST.open,hide:!!o.hide,peaAlt:peaAlts(P,V,p),profiles:ST.profiles,valid:ST.valid});
}
function act(a,id,P,V){
  if(a==="al-prefs"){if(CK.prefs)CK.prefs.open();return true;}
  if(a==="al-run"){ensure(P,V,repaint,true);if(repaint)repaint();return true;}
  if(a==="al-open"){ST.open[id]=!ST.open[id];if(repaint)repaint();return true;}
  if(a==="al-profil"&&CK.prefs&&(CK.bt&&CK.bt.ORDER||[]).indexOf(id)>=0){var pr=CK.prefs.get();pr.risk_profile=id;CK.prefs.save(pr);if(CK.toast)CK.toast(esc("Profil choisi : "+(((cfg().profils||{})[id]||{}).label||id)+". La proposition est recalculée."));return true;}
  return false;
}

CK.alui={html:html,ensure:ensure,act:act,journal:jRead,state:function(){return {busy:ST.busy,err:ST.err,ok:!!(ST.R&&ST.R.ok),month:ST.R&&ST.R.month};},
  reset:function(){ST={R:null,busy:false,err:null,progress:"",key:"",dataKey:"",data:null,dataTs:0,open:{},memo:{}};},
  _t:{profilesHTML:profilesHTML,profilesNow:profilesNow,validate:validate,validKey:validKey,stockScores:stockScores,stockIds:stockIds,viewHTML:viewHTML,headHTML:headHTML,barsHTML:barsHTML,decisionsHTML:decisionsHTML,ordersHTML:ordersHTML,excludedHTML:excludedHTML,peaAltHTML:peaAltHTML,
    journalHTML:journalHTML,setupHTML:setupHTML,rulesHTML:rulesHTML,flagsHTML:flagsHTML,jAdd:jAdd,jRead:jRead,needIds:needIds,fxFn:fxFn,loadData:loadData}};
})();
