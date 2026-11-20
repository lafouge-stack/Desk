/* ================================================================
   COCKPIT — Préférences d'investissement (phase 5) : CK.prefs
   « Mes règles » : classes d'actifs et types de produits cochés, profil (modèle public d'exemple,
   poids visibles et modifiables), horizon, mode PEA, versement mensuel, limites, filtres.
   Stockées dans ce navigateur seulement (CK.lsj("prefs")). Tant qu'elles ne sont pas enregistrées,
   aucune proposition n'est calculée. Rendu sans DOM (CK.prefs._t) : testable dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
function M(){return CK.models||{};}
function U(){return CK.u||{};}
function esc(s){var f=U().esc;return f?f(s):String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fin(x){return typeof x==="number"&&isFinite(x);}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function nfr(v){return fin(v)?String(Math.round(v*100)/100).replace(".",","):"";}
var KEY="prefs";

/* ---------- Stockage ---------- */
function get(){var raw=null;try{raw=CK.lsj?CK.lsj(KEY):null;}catch(e){raw=null;}return M().normPrefs?M().normPrefs(raw):raw||{};}
function save(p){var n=M().normPrefs(p);try{if(CK.lsj)CK.lsj(KEY,n);}catch(e){return null;}if(typeof CK.onPrefs==="function")try{CK.onPrefs(n);}catch(e){}return n;}

/* ---------- Ce qui est affiché ---------- */
var HIDDEN_CLASSES={devises:1};   // aucune poche d'allocation (devises : affichées dans les Marchés seulement)
var PEA_MODES=[{id:"off",label:"Sans effet",d:"Badges PEA affichés, aucun effet sur la proposition (l'enveloppe PEA reste toujours stricte)."},
  {id:"prioritaire",label:"Prioritaire",d:"Les instruments éligibles PEA sont favorisés, les non éligibles fortement déclassés."},
  {id:"strict",label:"Strict",d:"Rien d'autre que des instruments éligibles PEA dans la proposition (or, obligations, crypto disparaissent)."}];
var VEH_HELP={titre:"actions d'entreprises achetées une par une",etf:"fonds indiciels cotés",etc_etn:"titres de créance qui suivent l'or, le pétrole…",fonds:"OPCVM, unités de compte",spot_crypto:"bitcoin, ether… détenus en direct",cash:"espèces des comptes"};
var CCY=[{id:"EUR",label:"Euro"},{id:"USD",label:"Dollar"},{id:"autre",label:"Autres devises"}];

function chk(name,val,on,dis,extra){return '<input type="checkbox" name="'+name+'" value="'+esc(val)+'"'+(on?" checked":"")+(dis?" disabled":"")+(extra||"")+'>';}
function num(name,val,attrs){return '<input name="'+name+'" value="'+esc(val==null?"":val)+'" inputmode="decimal" '+(attrs||"")+'>';}
function sec(t,html,sub){return '<fieldset class="pr-sec"><legend>'+esc(t)+'</legend>'+(sub?'<p class="pr-sub">'+sub+'</p>':'')+html+'</fieldset>';}

/** Arbre des classes : un enfant n'est cochable que si son parent l'est. */
function classesHTML(p){
  var C=(M().CLASSES||[]).filter(function(c){return !HIDDEN_CLASSES[c.id];});
  var row=function(c,depth){var parentOn=!c.parent||M().isClassAllowed(c.parent,p.classes);
    return '<label class="pr-cl d'+depth+(parentOn?"":" off")+'">'+chk("cls",c.id,p.classes[c.id]===true&&parentOn,!parentOn,' data-parent="'+esc(c.parent||"")+'"')+'<span>'+esc(c.label)+'</span></label>';};
  var walk=function(id,depth){var o="";C.filter(function(c){return c.parent===id;}).forEach(function(c){o+=row(c,depth)+walk(c.id,depth+1);});return o;};
  // un bloc par grande classe, avec ses sous-classes en dessous
  return '<div class="pr-tree">'+C.filter(function(c){return !c.parent;}).map(function(c){return '<div class="pr-grp">'+row(c,0)+walk(c.id,1)+'</div>';}).join("")+'</div>';
}
function vehiclesHTML(p){return '<div class="pr-chips">'+(M().VEHICLES||[]).filter(function(v){return v.investable;}).map(function(v){
  return '<label class="pr-chip">'+chk("veh",v.id,p.vehicles[v.id]===true)+'<span><b>'+esc(v.label)+'</b><em>'+esc(VEH_HELP[v.id]||"")+'</em></span></label>';}).join("")+'</div>';}
function profileHTML(p){
  var P=cfg().profils||{},ps=cfg().poches||[];
  var cards=Object.keys(P).map(function(k){var x=P[k],w=x.bornes||{},top=ps.filter(function(q){return w[q.id]&&w[q.id][1]>0;}).sort(function(a,b){return w[b.id][1]-w[a.id][1];}).slice(0,3);
    return '<label class="pr-prof">'+'<input type="radio" name="prof" value="'+esc(k)+'"'+(p.risk_profile===k?" checked":"")+'><span><b>'+esc(x.label||k)+'</b>'+
      '<em>volatilité visée '+esc(x.vol_cible)+' % · perte tolérée '+esc(x.validation&&x.validation.perte_max)+' % · risque max '+esc(x.risque_max_sri)+'/7</em><i>'+top.map(function(q){return esc(q.label.replace(/ \(.*\)$/,""))+" "+esc(w[q.id][0])+"-"+esc(w[q.id][1])+" %";}).join(" · ")+'</i></span></label>';}).join("");
  var H=cfg().horizons||{},hz='<select name="hor">'+Object.keys(H).filter(function(k){return k!=="_doc";}).map(function(k){return '<option value="'+esc(k)+'"'+(p.horizon===k?" selected":"")+'>'+esc(H[k].label||k)+'</option>';}).join("")+'</select>';
  var base=(P[p.risk_profile]||{}).poids_reference||{},pp=p.poids_perso,perso=!!pp;
  var grid='<div class="pr-wgrid">'+ps.map(function(q){var v=perso&&pp[q.id]!=null?pp[q.id]:base[q.id]||0;return '<label><span>'+esc(q.label)+'</span>'+num("w_"+q.id,nfr(v),'class="pr-w" data-def="'+esc(base[q.id]||0)+'"')+'<em>%</em></label>';}).join("")+
    '<p class="pr-wsum" data-pr="wsum"></p></div>';
  return '<div class="pr-profs">'+cards+'</div><div class="pr-row"><label class="pr-f"><span>Horizon d\'investissement</span>'+hz+'</label></div>'+
    '<label class="pr-inl">'+chk("perso","1",perso)+' Poids personnalisés (au lieu de l\'algorithme ; préremplis avec le modèle de référence du profil)</label><div class="pr-perso"'+(perso?"":" hidden")+'>'+grid+'</div>';
}
function peaHTML(p){return '<div class="pr-radios">'+PEA_MODES.map(function(m){return '<label class="pr-rad"><input type="radio" name="pea" value="'+m.id+'"'+(p.pea_mode===m.id?" checked":"")+'><span><b>'+esc(m.label)+'</b><em>'+esc(m.d)+'</em></span></label>';}).join("")+'</div>';}
function contribHTML(p,accounts){
  var tr=(accounts||[]).filter(function(a){return CK.sel&&CK.sel.TRADABLE[a.account_type];}),sp=p.contribution_split||{};
  return '<div class="pr-row"><label class="pr-f"><span>Versement mensuel prévu (€)</span>'+num("contrib",p.monthly_contribution_eur?nfr(p.monthly_contribution_eur):"",'placeholder="0"')+'</label></div>'+
    (tr.length?'<p class="pr-sub">Répartition entre tes comptes (facultatif, en %). Vide : le versement va là où il sert, PEA d\'abord dans la limite de son plafond.</p><div class="pr-wgrid">'+
      tr.map(function(a){return '<label><span>'+esc(a.name)+'</span>'+num("sp_"+a.id,sp[a.id]!=null?nfr(sp[a.id]):"",'placeholder="—"')+'<em>%</em></label>';}).join("")+'</div>':
      '<p class="pr-sub">Crée tes comptes dans le Portefeuille pour répartir le versement entre eux.</p>');
}
function limitsHTML(p){
  var L=p.limits,mpc=L.max_par_classe||{},tops=(M().CLASSES||[]).filter(function(c){return !c.parent&&!HIDDEN_CLASSES[c.id];});
  var f=function(lbl,name,v,help){return '<label class="pr-f pr-s"><span>'+esc(lbl)+'</span>'+num(name,nfr(v))+(help?'<em>'+esc(help)+'</em>':'')+'</label>';};
  var sri='<select name="sri"><option value="">Celui du profil</option>'+[1,2,3,4,5,6,7].map(function(n){return '<option value="'+n+'"'+(L.risque_max_sri===n?" selected":"")+'>'+n+' / 7</option>';}).join("")+'</select>';
  return '<div class="pr-row">'+f("Poids max par instrument (%)","mpi",L.max_par_instrument,"une seule ligne")+f("Crypto au plus (%)","mcr",L.max_crypto)+f("Liquidités au moins (%)","mli",L.min_liquidites)+
    f("Rotation max par mois (%)","mto",L.max_turnover_mensuel,"ventes / portefeuille")+f("Bande d'inaction (points)","bnd",L.bande_inaction_pp,"écart toléré")+
    '<label class="pr-f pr-s"><span>Niveau de risque max</span>'+sri+'</label></div>'+
    '<label class="pr-inl">'+chk("lev","1",L.levier_autorise===true)+' Autoriser les produits à levier ou inverses</label>'+
    '<p class="pr-sub">Plafond par classe (%, vide = aucun)</p><div class="pr-wgrid">'+tops.map(function(c){return '<label><span>'+esc(c.label)+'</span>'+num("mpc_"+c.id,mpc[c.id]!=null?nfr(mpc[c.id]):"",'placeholder="—"')+'<em>%</em></label>';}).join("")+'</div>';
}
function filtersHTML(p){
  var F=p.filters||{},R=M().REGIONS||[];
  return '<p class="pr-sub">Zones d\'exposition (rien de coché = toutes)</p><div class="pr-chips sm">'+R.map(function(r){return '<label class="pr-chip">'+chk("reg",r.id,(F.regions||[]).indexOf(r.id)>=0)+'<span><b>'+esc(r.label)+'</b></span></label>';}).join("")+'</div>'+
    '<p class="pr-sub">Devises de cotation (rien de coché = toutes)</p><div class="pr-chips sm">'+CCY.map(function(c){return '<label class="pr-chip">'+chk("ccy",c.id,(F.devises||[]).indexOf(c.id)>=0)+'<span><b>'+esc(c.label)+'</b></span></label>';}).join("")+'</div>';
}
function pochesHTML(p){var ex=p.poches_exclues||[];return '<p class="pr-sub">Affiner : décoche une poche pour l\'écarter (ex. garder l\'or sans le panier de matières premières).</p><div class="pr-chips sm">'+
  (cfg().poches||[]).map(function(q){return '<label class="pr-chip">'+chk("poche",q.id,ex.indexOf(q.id)<0)+'<span><b>'+esc(q.label)+'</b></span></label>';}).join("")+'</div>';}

/** Formulaire complet. o : {accounts} (comptes du portefeuille, pour la répartition du versement). */
function formHTML(p,o){
  p=M().normPrefs(p);o=o||{};
  return '<form class="pr-form" data-pr-form="1">'+
    (p.saved?'':'<p class="pr-intro">Rien n\'est calculé tant que tu n\'as pas enregistré tes propres règles. Coche les classes d\'actifs et les types de produits dans lesquels tu acceptes d\'investir : le moteur ne proposera jamais rien d\'autre.</p>')+
    sec("1. Classes d'actifs autorisées",classesHTML(p)+pochesHTML(p),"Une sous-classe n'est autorisée que si sa classe parente est cochée.")+
    sec("2. Types de produits",vehiclesHTML(p),"Un instrument n'est proposé que si sa classe ET son type sont cochés.")+
    sec("3. Profil et horizon",profileHTML(p),"L'allocation de chaque profil est calculée par l'algorithme (volatilité visée, bornes par classe, tendance), puis contrôlée sur le passé. Bornes, seuils et modèles de référence sont publics, identiques pour tous et modifiables (allocation.json) : ce n'est pas un conseil personnalisé.")+
    sec("4. PEA",peaHTML(p))+
    sec("5. Versement du mois",contribHTML(p,o.accounts))+
    sec("6. Limites",limitsHTML(p))+
    sec("7. Filtres",filtersHTML(p))+
    '<p class="mk-disc">'+esc(CK.DISCLAIMER||"")+'</p>'+
    '<div class="pf-fb pr-fb"><button type="submit" class="btn sm primary">Enregistrer mes règles</button><button type="button" class="btn sm" data-close>Annuler</button></div></form>';
}

/** Valeurs du formulaire ({nom: valeur | [valeurs]}) → préférences normalisées (saved = true). */
function fromValues(v,prev){
  var p=M().normPrefs(prev||{}),list=function(k){var x=v[k];return Array.isArray(x)?x:x!=null&&x!==""?[x]:[];},n=function(k){var s=v[k];if(s==null||s==="")return null;return M().num(String(s).replace(/[%€\s]/g,""));};
  var cls=list("cls");Object.keys(p.classes).forEach(function(k){p.classes[k]=cls.indexOf(k)>=0;});
  var veh=list("veh");Object.keys(p.vehicles).forEach(function(k){p.vehicles[k]=veh.indexOf(k)>=0;});
  if(p.classes.liquidites)p.vehicles.cash=true;   // les liquidités sont les espèces des comptes
  var keep=list("poche");p.poches_exclues=(cfg().poches||[]).map(function(q){return q.id;}).filter(function(id){return keep.indexOf(id)<0;});
  if(v.prof)p.risk_profile=v.prof;if(v.hor)p.horizon=v.hor;if(v.pea)p.pea_mode=v.pea;
  if(list("perso").length){var pp={};(cfg().poches||[]).forEach(function(q){var x=n("w_"+q.id);pp[q.id]=x==null?0:x;});p.poids_perso=pp;}else p.poids_perso=null;
  p.monthly_contribution_eur=Math.max(0,n("contrib")||0);
  var sp={};Object.keys(v).forEach(function(k){if(/^sp_/.test(k)){var x=n(k);if(x!=null&&x>0)sp[k.slice(3)]=x;}});p.contribution_split=sp;
  var L=p.limits,set=function(k,f){var x=n(f);if(x!=null)L[k]=x;};
  set("max_par_instrument","mpi");set("max_crypto","mcr");set("min_liquidites","mli");set("max_turnover_mensuel","mto");set("bande_inaction_pp","bnd");
  L.risque_max_sri=v.sri?Number(v.sri):null;L.levier_autorise=list("lev").length>0;
  var mpc={};Object.keys(v).forEach(function(k){if(/^mpc_/.test(k)){var x=n(k);if(x!=null)mpc[k.slice(4)]=x;}});L.max_par_classe=mpc;
  p.filters.regions=list("reg");p.filters.devises=list("ccy");
  p.saved=true;return M().normPrefs(p);
}
/** Contrôles avant d'enregistrer : [messages]. */
function problems(p){
  var out=[];if(!Object.keys(p.classes).some(function(k){return p.classes[k];}))out.push("Coche au moins une classe d'actifs.");
  if(!Object.keys(p.vehicles).some(function(k){return p.vehicles[k]&&k!=="cash";})&&!(p.classes.liquidites&&Object.keys(p.classes).filter(function(k){return p.classes[k];}).length===1))out.push("Coche au moins un type de produit (ETF, titres…).");
  if(p.poids_perso){var s=Object.keys(p.poids_perso).reduce(function(a,k){return a+(p.poids_perso[k]||0);},0);if(Math.abs(s-100)>0.5)out.push("Tes poids personnalisés font "+nfr(s)+" % : ils doivent totaliser 100 %.");}
  var sp=p.contribution_split||{},ss=Object.keys(sp).reduce(function(a,k){return a+sp[k];},0);if(ss>0&&Math.abs(ss-100)>0.5)out.push("La répartition du versement fait "+nfr(ss)+" % : elle doit totaliser 100 % (ou rester vide).");
  return out;
}
/** Résumé d'une ligne (affiché dans l'onglet Allocation). */
function summary(p){
  var on=(M().CLASSES||[]).filter(function(c){return M().isClassAllowed(c.id,p.classes)&&!HIDDEN_CLASSES[c.id];}),veh=(M().VEHICLES||[]).filter(function(v){return v.investable&&p.vehicles[v.id];});
  var prof=(cfg().profils||{})[p.risk_profile]||{},hz=((cfg().horizons||{})[p.horizon]||{}).label||p.horizon,pm=PEA_MODES.filter(function(m){return m.id===p.pea_mode;})[0];
  return {classes:on.map(function(c){return c.label;}),vehicles:veh.map(function(v){return v.label;}),profile:(prof.label||p.risk_profile)+(p.poids_perso?" (poids personnalisés)":""),horizon:hz,pea:pm?pm.label:p.pea_mode,
    contribution:p.monthly_contribution_eur};
}

/* ================================================================
   Fenêtre (DOM)
   ================================================================ */
function $(id){return typeof document!=="undefined"&&document.getElementById?document.getElementById(id):null;}
function toast(t){if(CK.toast)CK.toast(esc(t));}
var wired=false;
function values(form){var v={};[].forEach.call(form.elements,function(el){if(!el.name||el.disabled)return;
  if(el.type==="checkbox"){if(!el.checked)return;if(v[el.name]==null)v[el.name]=[];else if(!Array.isArray(v[el.name]))v[el.name]=[v[el.name]];v[el.name].push(el.value);return;}
  if(el.type==="radio"){if(el.checked)v[el.name]=el.value;return;}v[el.name]=el.value;});return v;}
function sync(form){
  // un enfant n'est cochable que si son parent est coché
  var boxes=[].slice.call(form.querySelectorAll('input[name="cls"]')),on={};boxes.forEach(function(b){on[b.value]=b.checked;});
  var ok=function(id){var b=boxes.filter(function(x){return x.value===id;})[0];if(!b)return true;var par=b.getAttribute("data-parent");return !par||(on[par]&&ok(par));};
  boxes.forEach(function(b){var par=b.getAttribute("data-parent"),en=!par||ok(par)&&on[par];b.disabled=!en;var l=b.closest("label");if(l)l.classList.toggle("off",!en);});
  var per=form.querySelector('input[name="perso"]'),box=form.querySelector(".pr-perso");if(per&&box)box.hidden=!per.checked;
  var s=0;[].forEach.call(form.querySelectorAll(".pr-w"),function(i){var x=M().num(String(i.value).replace(/[%\s]/g,""));s+=x||0;});
  var ws=form.querySelector('[data-pr="wsum"]');if(ws){ws.textContent="Total : "+nfr(s)+" %"+(Math.abs(s-100)>0.5?" (doit faire 100 %)":"");ws.classList.toggle("bad",Math.abs(s-100)>0.5);}
}
function open(){
  var b=$("prBody");if(!b)return;var acc=[];try{acc=CK.pfc?CK.pfc.load().accounts:[];}catch(e){acc=[];}
  b.innerHTML=formHTML(get(),{accounts:acc});var f=b.querySelector("form");if(f)sync(f);
  if(!wired){wired=true;
    b.addEventListener("change",function(e){var f2=e.target&&e.target.closest?e.target.closest("form"):null;if(!f2)return;
      // cocher une classe parente coche ses sous-classes (tu peux ensuite les décocher)
      // cocher une classe coche ses sous-classes (sauf les stablecoins) ; la décocher les décoche
      if(e.target.name==="cls"&&/^[a-z_]+$/.test(e.target.value)){var on=e.target.checked,stack=[e.target.value];
        while(stack.length){var id=stack.pop();[].forEach.call(f2.querySelectorAll('input[name="cls"][data-parent="'+id+'"]'),function(c){if(!on||c.value!=="stablecoin")c.checked=on;stack.push(c.value);});}}
      if(e.target.name==="prof"){var P=cfg().profils||{},w=(P[e.target.value]||{}).poids_reference||{},per=f2.querySelector('input[name="perso"]');
        if(per&&!per.checked)[].forEach.call(f2.querySelectorAll(".pr-w"),function(i){var k=i.name.slice(2);i.value=nfr(w[k]||0);});}
      sync(f2);});
    b.addEventListener("input",function(e){var f2=e.target&&e.target.closest?e.target.closest("form"):null;if(f2&&/^w_/.test(e.target.name||""))sync(f2);});
    b.addEventListener("submit",function(e){var f2=e.target;if(!f2||!f2.getAttribute||!f2.getAttribute("data-pr-form"))return;e.preventDefault();
      var p=fromValues(values(f2),get()),pb=problems(p);if(pb.length){toast(pb[0]);return;}
      if(!save(p)){toast("Enregistrement impossible : stockage du navigateur plein ou bloqué.");return;}
      var o=$("ovPrefs");if(o&&CK.closeOv)CK.closeOv(o);toast("Règles enregistrées. La proposition du mois est recalculée.");});
  }
  if(CK.openOv)CK.openOv("ovPrefs");
}

CK.prefs={KEY:KEY,get:get,save:save,open:open,summary:summary,problems:problems,fromValues:fromValues,PEA_MODES:PEA_MODES,
  _t:{formHTML:formHTML,classesHTML:classesHTML,fromValues:fromValues,problems:problems,summary:summary}};
})();
