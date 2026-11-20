/* ================================================================
   COCKPIT — Backtest de la proposition mensuelle (phase 7) : CK.bt
   Rejoue « tes règles » mois par mois sur le passé, au niveau des classes d'actifs (séries de
   référence de allocation.json, en euros, dividendes réinvestis). Chaque classe entre dans l'univers
   à sa date de disponibilité (13 mois d'historique). Décision à la date de décision (dernière séance
   Euronext du mois, 22 h 30 Paris) avec les seules données connues ce jour-là, exécution à la clôture
   du jour ouvré suivant, valorisation quotidienne entre deux décisions.
   Comparaisons : allocation fixe (poids du profil rééquilibrés à chaque décision) et achat-conservation
   (poids du profil au départ, jamais rééquilibrés). Coûts par ordre (allocation.json → couts).
   Fiscalité optionnelle et simplifiée (fiscal.json) : compte-titres (PFU sur les gains nets de l'année,
   moins-values reportables 10 ans) ou PEA (impôt seulement à la sortie, selon l'ancienneté).
   Aucune optimisation : la configuration est figée ; la grille de sensibilité montre la dispersion.
   Fonctions pures (aucun DOM, aucun réseau) : testables dans Node. Calcul découpé (create → next)
   pour que l'interface reste fluide.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var DAY=864e5;
function M(){return CK.models||{};}
function A(){return CK.alloc;}
function IND(){return CK.ind;}
function fin(x){return typeof x==="number"&&isFinite(x);}
function nz(v,d){return fin(v)?v:d;}
function dict(){return Object.create(null);}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}
function fiscal(){var d=M().data?M().data("fiscal"):null;return d&&typeof d==="object"?d:{};}
function ymd(t){return new Date(t).toISOString().slice(0,10);}
function mean(a){var s=0;for(var i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:null;}
function std(a){var m=mean(a),s=0;for(var i=0;i<a.length;i++)s+=(a[i]-m)*(a[i]-m);return a.length>1?Math.sqrt(s/(a.length-1)):null;}

var PEA_OK={actions:1,liquidites:1};   // poches qu'un PEA peut détenir (au niveau des classes)
var MIN_HIST=400*DAY;                                         // ~13 mois d'historique avant d'entrer dans l'univers

/* ---------- Calendrier ---------- */
/** Dates de décision (une par mois, ou tous les `freq` mois) entre deux instants. */
function decisions(from,to,freq){
  var out=[],d=new Date(from),y=d.getUTCFullYear(),m=d.getUTCMonth()+1,n=0;freq=freq||1;
  for(var g=0;g<400;g++){var D=A().decision(Date.UTC(y,m,1)-1);if(D&&D.T>=from&&D.T<=to){if(n%freq===0)out.push(D.T);n++;}if(D&&D.T>to)break;m++;if(m>12){m=1;y++;}}
  return out;
}
/** Jours ouvrés (lundi-vendredi, UTC) entre deux instants, à 23 h 59 UTC (toutes les places ont clôturé). */
function days(from,to){var out=[],d=new Date(from),t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),23,59);for(;t<=to;t+=DAY){var w=new Date(t).getUTCDay();if(w!==0&&w!==6)out.push(t);}return out;}

/* ---------- Taux sans risque ---------- */
/** rf : {d: ["AAAA-MM"], v: [%]} → fonction (jour) → taux annuel (fraction) du mois, dernier connu sinon. */
function rfFn(rf){
  if(!rf||!Array.isArray(rf.d)||!Array.isArray(rf.v)||!rf.d.length)return function(){return 0;};
  var m=dict();rf.d.forEach(function(k,i){if(fin(rf.v[i]))m[String(k).slice(0,7)]=rf.v[i]/100;});var keys=Object.keys(m).sort();
  return function(t){var k=ymd(t).slice(0,7);if(m[k]!=null)return m[k];var v=0;for(var i=0;i<keys.length&&keys[i]<=k;i++)v=m[keys[i]];return k<keys[0]?m[keys[0]]:v;};
}

/* ---------- Un portefeuille simulé ---------- */
/**
 * kind : "strategie" | "fixe" | "achat" ; tax : "aucune" | "CTO" | "PEA".
 * Positions en euros par poche (val), prix de revient (basis, compte-titres), espèces = poche « liquidites ».
 */
function book(kind,capital){return {kind:kind,val:dict(),basis:dict(),cost:0,tax:0,turn:0,trades:0,real:0,losses:[],curve:[],exp:dict(),nexp:0,started:false,first:null,yearReal:0};}
function total(b){var s=0;for(var k in b.val)s+=b.val[k];return s;}
function weightsOf(b){var V=total(b),o=dict();for(var k in b.val)o[k]=V>0?b.val[k]/V:0;return o;}
/** Rééquilibre vers w (somme 1) : coûts par ordre, gains réalisés (compte-titres). Renvoie {cost, sells}. */
function rebalance(b,w,ctx){
  var V=total(b);if(!(V>0))return {cost:0,sells:0};var cost=0,sells=0,keys=dict();Object.keys(b.val).forEach(function(k){keys[k]=1;});Object.keys(w).forEach(function(k){keys[k]=1;});
  // coûts estimés sur les ordres (la liquidité n'est pas un ordre)
  Object.keys(keys).forEach(function(p){if(p==="liquidites")return;var d=nz(w[p],0)*V-nz(b.val[p],0);if(Math.abs(d)<0.01)return;if(ctx.costs)cost+=CK.sel.orderCost(Math.abs(d),ctx.env,ctx.instr(p));if(d<0)sells+=-d;});
  var Vn=V-cost;
  Object.keys(keys).forEach(function(p){var cur=nz(b.val[p],0),tgt=nz(w[p],0)*Vn,d=tgt-cur;
    if(d<0&&cur>0){var share=Math.min(1,-d/cur),bs=nz(b.basis[p],cur);var gain=-d-bs*share;b.basis[p]=bs*(1-share);if(ctx.tax==="CTO")b.yearReal+=gain;b.real+=gain;}
    else if(d>0)b.basis[p]=nz(b.basis[p],cur)+d;
    if(tgt>1e-9)b.val[p]=tgt;else{delete b.val[p];delete b.basis[p];}});
  b.cost+=cost;b.turn+=V>0?sells/V:0;b.trades++;return {cost:cost,sells:sells};
}
/** Fin d'année au compte-titres : impôt sur les gains nets réalisés (après moins-values des 10 dernières années), prélevé au prorata. */
function yearEnd(b,year,rate,keepYears){
  var net=b.yearReal;b.yearReal=0;b.losses=b.losses.filter(function(l){return year-l.y<keepYears&&l.v>0;});
  if(net<0){b.losses.push({y:year,v:-net});return 0;}
  for(var i=0;i<b.losses.length&&net>0;i++){var u=Math.min(net,b.losses[i].v);b.losses[i].v-=u;net-=u;}
  var tax=net*rate;if(!(tax>0))return 0;var V=total(b);if(!(V>0))return 0;var k=Math.max(0,1-tax/V);
  for(var p in b.val){b.val[p]*=k;b.basis[p]=nz(b.basis[p],0)*k;}b.tax+=tax;return tax;
}

/* ---------- Métriques ---------- */
/**
 * curve : [[t, valeur]] quotidienne ; rf(t) → taux annuel. Rendement annualisé, volatilité, Sharpe (excès mensuels), Sortino
 * (baisse calculée sur TOUS les mois), perte maximale quotidienne et sa durée, Calmar, mois gagnants, intervalle de confiance du Sharpe.
 */
function metrics(curve,rf){
  var out={n:curve.length};if(curve.length<2)return out;var v0=curve[0][1],v1=curve[curve.length-1][1],dt=(curve[curve.length-1][0]-curve[0][0])/DAY;
  out.total=v1/v0-1;out.cagr=dt>0&&v0>0&&v1>0?Math.pow(v1/v0,365.25/dt)-1:null;out.years=dt/365.25;
  var lr=[];for(var i=1;i<curve.length;i++)if(curve[i-1][1]>0&&curve[i][1]>0)lr.push(Math.log(curve[i][1]/curve[i-1][1]));out.vol=lr.length>20?std(lr)*Math.sqrt(252):null;
  var pk=-Infinity,pkT=curve[0][0],dd=0,ddFrom=null,ddTo=null,longest=0,curStart=null;
  curve.forEach(function(x){if(x[1]>=pk){if(curStart!=null){longest=Math.max(longest,(x[0]-curStart)/DAY);curStart=null;}pk=x[1];pkT=x[0];}else{if(curStart==null)curStart=pkT;var d=x[1]/pk-1;if(d<dd){dd=d;ddFrom=pkT;ddTo=x[0];}}});
  if(curStart!=null)longest=Math.max(longest,(curve[curve.length-1][0]-curStart)/DAY);
  out.mdd=dd;out.mddFrom=ddFrom?ymd(ddFrom):null;out.mddTo=ddTo?ymd(ddTo):null;out.mddDays=Math.round(longest);
  // rendements mensuels (dernière valeur de chaque mois)
  var me=[],key=null;curve.forEach(function(x){var k=ymd(x[0]).slice(0,7);if(k!==key){me.push(x);key=k;}else me[me.length-1]=x;});
  var rm=[],ex=[];for(var j=1;j<me.length;j++){var r=me[j][1]/me[j-1][1]-1,f=Math.pow(1+nz(rf(me[j][0]),0),1/12)-1;rm.push(r);ex.push(r-f);}
  out.months=rm.length;out.win=rm.length?rm.filter(function(r){return r>0;}).length/rm.length:null;
  var se=std(ex),me_=mean(ex);out.sharpe=se>0?me_*12/(se*Math.sqrt(12)):null;
  var dn=Math.sqrt(mean(ex.map(function(x){return x<0?x*x:0;}))||0);out.sortino=dn>0?me_*12/(dn*Math.sqrt(12)):null;
  out.calmar=fin(out.cagr)&&dd<0?out.cagr/Math.abs(dd):null;
  if(fin(out.sharpe)&&rm.length>2){var srm=out.sharpe/Math.sqrt(12),SE=Math.sqrt((1+0.5*srm*srm)/rm.length)*Math.sqrt(12);out.sharpeLo=out.sharpe-1.96*SE;out.sharpeHi=out.sharpe+1.96*SE;}
  out.monthly=me.map(function(x){return [ymd(x[0]).slice(0,7),x[1]];});
  return out;
}

/* ---------- Simulation ---------- */
/**
 * o : {prefs (enregistrées), series {poche: {t,c}} (€, rendement total), ref, vix, rf ({d,v}), from (ms, défaut : première date possible),
 *   to (ms, défaut : maintenant), freq (1 = mensuel, 3 = trimestriel), capital (€), costs (bool), tax ("aucune"|"CTO"|"PEA"),
 *   overrides ({tilt}), band (points, remplace la bande de tes règles), strategyOnly (grille), memo (partagé), now}.
 * Renvoie un calcul pas à pas : next() traite une décision (faux quand c'est fini), result() donne le résultat.
 */
function create(o){
  var P=M().normPrefs(o.prefs);P.monthly_contribution_eur=0;P.contribution_split={};if(fin(o.band))P.limits.bande_inaction_pp=o.band;
  var C=cfg(),px=C.proxies||{},series=o.series||{},now=nz(o.now,Date.now()),flags=[],tax=o.tax==="CTO"||o.tax==="PEA"?o.tax:"aucune",env=tax==="PEA"?"PEA":"CTO";
  var F=fiscal().enveloppes||{},pfu=nz(F.CTO&&F.CTO.taux_global,31.4)/100,keep=nz(F.CTO&&F.CTO.moins_values_report_ans,10);
  var poch=A().poches().map(function(p){return p.id;}).filter(function(p){return p==="liquidites"||series[p]&&series[p].t&&series[p].t.length;});
  if(tax==="PEA"){var out_=poch.filter(function(p){return !PEA_OK[p];});if(out_.length)flags.push({level:"attention",msg:"Un PEA ne peut détenir ni "+out_.map(A().label).join(", ")+" : ces classes sont écartées du backtest en mode PEA."});poch=poch.filter(function(p){return PEA_OK[p];});}
  var avail=function(T){return poch.filter(function(p){return p==="liquidites"||(series[p].t[0]<=T-MIN_HIST&&IND().idxAt(series[p].t,T)>=0&&T-series[p].t[IND().idxAt(series[p].t,T)]<=10*DAY);});};
  var allowed=poch.filter(function(p){var q=A().poche(p);return q&&M().isClassAllowed(q.classe,P.classes)&&(p==="liquidites"||(q.vehicules||[]).some(function(v){return P.vehicles[v];}));});
  if(!allowed.some(function(p){return p!=="liquidites";}))return {error:"Aucune de tes classes cochées n'a d'historique mesurable."};
  // départ : première décision où au moins une de tes classes (hors liquidités) a 13 mois d'historique
  var first=Infinity;allowed.forEach(function(p){if(p!=="liquidites")first=Math.min(first,series[p].t[0]+MIN_HIST);});
  var from=Math.max(first,nz(o.from,first)),to=Math.min(now,nz(o.to,now));
  var dec=decisions(from,to,o.freq||1);if(dec.length<2)return {error:"Période trop courte pour un backtest (moins de deux dates de décision)."};
  var cal=days(dec[0],to),rf=rfFn(o.rf),capital=nz(o.capital,10000),memo=o.memo||{};
  if(!o.rf||!o.rf.d)flags.push({level:"info",msg:"Taux sans risque indisponible : liquidités à 0 % et Sharpe calculé sans taux sans risque."});
  var instr=function(p){var x=px[p];return x&&x.id?CK.ref.get(x.id):null;};
  var ctx={costs:o.costs!==false,env:env,tax:tax,instr:instr};
  var kinds=o.strategyOnly?["strategie"]:["strategie","fixe","achat"],B=dict();kinds.forEach(function(k){B[k]=book(k);B[k].val.liquidites=capital;B[k].basis.liquidites=capital;});
  // pointeurs de prix par poche (dernière clôture ≤ jour)
  var ptr=dict(),last=dict();poch.forEach(function(p){if(p!=="liquidites"){ptr[p]=-1;last[p]=null;}});
  var prev=dict(),journal=[],di=0,ci=0,pending=null,year=new Date(cal[0]).getUTCFullYear(),done=false,res=null,stepsN=dec.length;
  function priceAt(p,t){var S=series[p],k=ptr[p];while(k+1<S.t.length&&S.t[k+1]<=t)k++;ptr[p]=k;return k>=0?S.c[k]:null;}
  function advanceTo(t){   // valorise chaque jour ouvré jusqu'à t inclus ; exécute l'ordre en attente au jour suivant la décision
    while(ci<cal.length&&cal[ci]<=t){var d=cal[ci],y=new Date(d).getUTCFullYear();
      if(y!==year){if(tax==="CTO")kinds.forEach(function(k){yearEnd(B[k],year,pfu,keep);});year=y;}
      var r=rf(d),gross=Math.pow(1+r,1/252);
      poch.forEach(function(p){if(p==="liquidites")return;var px_=priceAt(p,d);if(px_==null)return;var pv=last[p];last[p]=px_;
        if(pv>0)kinds.forEach(function(k){if(B[k].val[p]!=null)B[k].val[p]*=px_/pv;});});
      kinds.forEach(function(k){if(B[k].val.liquidites!=null)B[k].val.liquidites*=gross;});
      if(pending&&ymd(d)>ymd(pending.T)){kinds.forEach(function(k){var w=pending.w[k];if(!w)return;var x=rebalance(B[k],w,ctx);
          if(k==="strategie"&&pending.j){pending.j.cost=x.cost;pending.j.turnover=total(B[k])>0?x.sells/(total(B[k])+x.cost):0;pending.j.exec=ymd(d);}
          var wt=weightsOf(B[k]);for(var p in wt){B[k].exp[p]=(B[k].exp[p]||0)+wt[p];}B[k].nexp++;});pending=null;}
      kinds.forEach(function(k){B[k].curve.push([d,total(B[k])]);});ci++;}
  }
  function decide(T){
    var U=avail(T),w=dict(),j=null;
    var R=A().run({prefs:P,now:T+1,series:series,ref:o.ref,vix:o.vix,current:{w0:weightsOf(B.strategie)},restrict:U,backtest:true,lite:true,memo:memo,overrides:o.overrides});
    if(!R.ok){flags.push({level:"info",msg:"Décision du "+ymd(T)+" impossible : "+R.why});return;}
    w.strategie=R.final;var sw=R.steps.reference||R.steps.strategic;   // références : le modèle fixe du profil
    if(B.fixe)w.fixe=sw;
    if(B.achat&&!B.achat.started){w.achat=sw;B.achat.started=true;}
    j={date:ymd(T),regime:R.regime&&R.regime.label,universe:R.universe.slice(),w:dict(),ws:dict(),frozen:R.frozen,alpha:R.alpha,sigma:R.sigma,algo:!!R.algo,target:R.target};
    Object.keys(R.steps.strategic).forEach(function(p){j.ws[p]=Math.round(R.steps.strategic[p]*1e4)/1e4;});
    Object.keys(R.final).forEach(function(p){if(R.final[p]>0.0005)j.w[p]=Math.round(R.final[p]*1e4)/1e4;});
    journal.push(j);pending={T:T,w:w,j:j};
  }
  return {
    total:stepsN,
    progress:function(){return di/stepsN;},
    next:function(){
      if(done)return false;
      if(di<dec.length){advanceTo(dec[di]);decide(dec[di]);di++;return true;}
      advanceTo(to);
      var fin_={};kinds.forEach(function(k){var b=B[k],V=total(b),m=metrics(b.curve,rf),exp=dict();for(var p in b.exp)exp[p]=b.nexp?b.exp[p]/b.nexp:0;
        var net=V,exitTax=0;
        if(tax==="CTO"){var unreal=0;for(var p2 in b.val)unreal+=b.val[p2]-nz(b.basis[p2],b.val[p2]);var carried=b.losses.reduce(function(s,l){return s+l.v;},0)+Math.max(0,-b.yearReal);
          exitTax=Math.max(0,(unreal+Math.max(0,b.yearReal)-carried))*pfu;}
        if(tax==="PEA"){var gain=V-capital,yrs=m.years||0,E=F.PEA||{},rate=(yrs>=nz(E.anciennete_exoneration_ans,5)?nz(E.taux_apres_5_ans,18.6):nz(E.taux_avant_5_ans,31.4))/100;exitTax=Math.max(0,gain)*rate;}
        net=V-exitTax;
        fin_[k]={value:V,net:net,exitTax:exitTax,costs:b.cost,taxes:b.tax,turnoverYear:m.years>0?b.turn/m.years:null,rebalances:b.trades,exposure:exp,metrics:m,
          curve:b.curve.filter(function(x,i){return i%5===0||i===b.curve.length-1;})};});
      res={ok:true,from:ymd(dec[0]),to:ymd(cal[cal.length-1]||to),decisions:dec.length,freq:o.freq||1,capital:capital,tax:tax,costs:ctx.costs,flags:flags,journal:journal,books:fin_,
        poches:poch,first:journal.length?journal[0].universe:[],profile:P.risk_profile};
      done=true;return false;
    },
    result:function(){return res;}
  };
}
/** Calcul complet d'un coup (tests, petits backtests). */
function run(o){var c=create(o);if(c.error)return {ok:false,why:c.error};while(c.next()){}return c.result();}
/** Grille de sensibilité : inclinaison {0, moitié, maximum du profil} × bande {1, 2, 4} points. Montre la dispersion, pas le meilleur. */
function grid(o){
  var prof=(cfg().profils||{})[(o.prefs||{}).risk_profile]||{},tm=nz(prof.inclinaison_max,0.25),out=[];
  [0,tm/2,tm].forEach(function(t){[1,2,4].forEach(function(b){out.push({tilt:t,band:b,o:Object.assign({},o,{overrides:{tilt:t},band:b,strategyOnly:true})});});});
  return out;
}
/* ---------- Contrôles automatiques des 4 profils ---------- */
var ORDER=["prudent","modere","dynamique","agressif"];
/** Pire baisse (depuis la valeur au début de la fenêtre ou un sommet atteint dedans) entre deux dates ; null si la période n'est pas couverte. */
function windowLoss(curve,from,to){var a=Date.parse(from+"T00:00:00Z"),b=Date.parse(to+"T23:59:59Z");if(!curve.length||curve[0][0]>a||curve[curve.length-1][0]<b)return null;
  var pk=null,dd=0;curve.forEach(function(x){if(x[0]<a-7*DAY||x[0]>b)return;if(pk==null||x[1]>pk)pk=x[1];var d=x[1]/pk-1;if(d<dd)dd=d;});return dd;}
/**
 * results : {profil: résultat de run() (portefeuille « strategie » = algorithme, « fixe » = modèle de référence)}.
 * Contrôles : volatilité réalisée ≤ marge_vol × cible ; perte maximale ≤ perte_max du profil, aussi pendant chaque crise ;
 * Sharpe ≥ Sharpe du modèle de référence − ecart_sharpe_max ; allocation de l'algorithme dans les bornes du profil à chaque décision ;
 * profils rangés du moins au plus risqué (volatilité et perte maximale). Renvoie {profil: {ok, checks:[{k, label, ok, val, lim, txt}], m, ref}}.
 */
function checks(results){
  var C=cfg(),V=C.validation||{},mv=nz(V.marge_vol,1.35),es=nz(V.ecart_sharpe_max,0.25),cr=Array.isArray(V.crises)?V.crises:[],out={};
  var pct=function(x,d){return fin(x)?(Math.round(x*Math.pow(10,(d||1)+2))/Math.pow(10,d||1)).toLocaleString("fr-FR").replace(/^-/,"−")+" %":"—";};
  ORDER.forEach(function(p){var R=results[p];if(!R||!R.ok){out[p]={ok:false,checks:[{k:"calcul",label:"Calcul",ok:false,txt:R&&R.why||"Backtest impossible."}]};return;}
    var prof=(C.profils||{})[p]||{},s=R.books.strategie,m=s.metrics,f=R.books.fixe&&R.books.fixe.metrics,ck=[];
    var tgt=R.journal.length&&fin(R.journal[R.journal.length-1].target)?R.journal[R.journal.length-1].target:nz(prof.vol_cible,8)/100,lim=nz(prof.validation&&prof.validation.perte_max,50)/100;
    ck.push({k:"vol",label:"Risque tenu",ok:fin(m.vol)&&m.vol<=tgt*mv+1e-9,val:m.vol,lim:tgt*mv,txt:"volatilité réalisée "+pct(m.vol)+" pour une cible de "+pct(tgt)+" (tolérance "+pct(tgt*mv)+")"});
    ck.push({k:"perte",label:"Perte maximale",ok:fin(m.mdd)&&-m.mdd<=lim+1e-9,val:m.mdd,lim:-lim,txt:"pire baisse "+pct(m.mdd)+" (limite du profil : −"+pct(lim).replace(/^−/,"")+")"});
    cr.forEach(function(c){var l=windowLoss(s.curve,c.de,c.a);if(l==null){ck.push({k:"crise",label:c.label,ok:true,skip:true,txt:"période non couverte par le backtest"});return;}
      ck.push({k:"crise",label:c.label,ok:-l<=lim+1e-9,val:l,lim:-lim,txt:"baisse "+pct(l)+" pendant la crise (limite −"+pct(lim).replace(/^−/,"")+")"});});
    if(f&&fin(f.sharpe)&&fin(m.sharpe))ck.push({k:"sharpe",label:"Pas moins bon que la référence",ok:m.sharpe>=f.sharpe-es-1e-9,val:m.sharpe,lim:f.sharpe-es,
      txt:"Sharpe "+m.sharpe.toFixed(2).replace(".",",")+" contre "+f.sharpe.toFixed(2).replace(".",",")+" pour le modèle de référence (écart toléré "+String(es).replace(".",",")+")"});
    var B=prof.bornes||{},bad=0;R.journal.forEach(function(j){if(!j.algo)return;Object.keys(j.ws||{}).forEach(function(q){var b=B[q];if(!b)return;var x=j.ws[q];
      // bornes ramenées aux classes disponibles (somme 100 %) : tolérance d'un point
      if(x<nz(b[0],0)/100-0.01&&j.universe.length>2)bad++;if(x>nz(b[1],100)/100+0.01)bad++;});});
    ck.push({k:"bornes",label:"Bornes du profil",ok:bad===0,val:bad,txt:bad?bad+" dépassement(s) de borne sur "+R.journal.length+" décisions":"respectées à chacune des "+R.journal.length+" décisions"});
    out[p]={ok:ck.every(function(x){return x.ok;}),checks:ck,m:m,ref:f,value:s.value,target:tgt};});
  // rangement du moins au plus risqué (tolérance : 0,2 point de volatilité, 1 point de perte maximale)
  for(var k=1;k<ORDER.length;k++){var a=out[ORDER[k-1]],b=out[ORDER[k]];if(!a||!b||!a.m||!b.m)continue;
    var okv=b.m.vol>=a.m.vol-0.002,okd=-b.m.mdd>=-a.m.mdd-0.01,lbl=((C.profils||{})[ORDER[k-1]]||{}).label||ORDER[k-1];
    b.checks.push({k:"ordre",label:"Plus risqué que "+lbl,ok:okv&&okd,txt:okv&&okd?"volatilité "+pct(b.m.vol)+" ≥ "+pct(a.m.vol)+" et perte "+pct(b.m.mdd)+" ≤ "+pct(a.m.mdd):"profil pas plus risqué que "+lbl+" ("+pct(b.m.vol)+" / "+pct(a.m.vol)+")"});
    if(!(okv&&okd))b.ok=false;}
  return out;
}
function summarize(cells){
  var vals=function(k){return cells.map(function(c){return c.m&&c.m[k];}).filter(fin);};
  var r=function(k){var v=vals(k);return v.length?{min:Math.min.apply(null,v),max:Math.max.apply(null,v),med:v.slice().sort(function(a,b){return a-b;})[Math.floor(v.length/2)]}:null;};
  return {cagr:r("cagr"),vol:r("vol"),sharpe:r("sharpe"),mdd:r("mdd")};
}

CK.bt={checks:checks,windowLoss:windowLoss,ORDER:ORDER,create:create,run:run,grid:grid,summarize:summarize,metrics:metrics,decisions:decisions,days:days,rfFn:rfFn,rebalance:rebalance,yearEnd:yearEnd,book:book,total:total,PEA_OK:PEA_OK};
})();
