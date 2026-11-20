/* ================================================================
   COCKPIT — Optimiseur d'allocation par profil (phase 9) : CK.opt
   Pour un profil, calcule la répartition entre classes qui maximise le rendement attendu sans
   dépasser la volatilité cible, dans les bornes du profil (allocation.json → profils.*.bornes).
     maximiser  μᵀw − (γ/2)·wᵀΣw   sous   Σw = 1,  min ≤ w ≤ max
   puis γ est ajusté par dichotomie pour que σ(w) atteigne la cible (sans la dépasser).
   Rendement attendu : μ_i = rf + sharpe_prior × σ_i × (1 + t_i), t_i = inclinaison × (score − 50) / 50.
   Même sharpe_prior pour toutes les classes : l'optimiseur ne parie pas sur une classe, il diversifie
   (corrélations) et suit la tendance (score de rotation, point-in-time). Les liquidités ont σ = 0 et μ = rf.
   Calcul déterministe (gradient projeté), aucun hasard : mêmes données → même allocation.
   Fonctions pures (aucun DOM, aucun réseau) : testables dans Node.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
function fin(x){return typeof x==="number"&&isFinite(x);}
function nz(v,d){return fin(v)?v:d;}
function M(){return CK.models||{};}
function cfg(){var d=M().data?M().data("allocation"):null;return d&&typeof d==="object"?d:{};}

/** Projection exacte sur {Σw = total, lo ≤ w ≤ hi} : w_i = clip(v_i − τ, lo_i, hi_i). La somme est linéaire par morceaux en τ,
    décroissante : on cherche le morceau qui contient « total » parmi les points de cassure v_i − lo_i et v_i − hi_i. */
function project(v,lo,hi,total){
  var n=v.length,i,clip=function(t){var o=[];for(var k=0;k<n;k++)o.push(Math.min(hi[k],Math.max(lo[k],v[k]-t)));return o;},s=function(t){var x=0;for(var k=0;k<n;k++)x+=Math.min(hi[k],Math.max(lo[k],v[k]-t));return x;};
  var bp=[];for(i=0;i<n;i++){bp.push(v[i]-lo[i]);bp.push(v[i]-hi[i]);}bp.sort(function(a,b){return a-b;});
  if(s(bp[0])<=total)return clip(bp[0]);if(s(bp[bp.length-1])>=total)return clip(bp[bp.length-1]);
  for(i=0;i<bp.length-1;i++){var sa=s(bp[i]),sb=s(bp[i+1]);if(sa>=total&&sb<=total){var t=sa===sb?bp[i]:bp[i]+(sa-total)/(sa-sb)*(bp[i+1]-bp[i]);return clip(t);}}
  return clip(bp[bp.length-1]);
}
function quad(S,w){var v=0;for(var i=0;i<w.length;i++)for(var j=0;j<w.length;j++)v+=w[i]*w[j]*S[i][j];return Math.max(0,v);}
/** Problème quadratique à γ fixé, par gradient projeté accéléré (FISTA ; pas = 1 / (γ·λmax), λmax majoré par la plus grande somme de ligne). */
function qp(mu,S,lo,hi,total,gamma,w0){
  var n=mu.length,L=0;for(var i=0;i<n;i++){var r=0;for(var j=0;j<n;j++)r+=Math.abs(S[i][j]);L=Math.max(L,r);}
  var step=1/(gamma*L+1e-12),w=w0?project(w0,lo,hi,total):project(mu.map(function(){return total/n;}),lo,hi,total),y=w.slice(),tk=1;
  for(var it=0;it<400;it++){
    var g=[];for(var a=0;a<n;a++){var s=0;for(var b=0;b<n;b++)s+=S[a][b]*y[b];g.push(mu[a]-gamma*s);}
    var nw=project(y.map(function(x,k){return x+step*g[k];}),lo,hi,total),t2=(1+Math.sqrt(1+4*tk*tk))/2,d=0;
    for(var c=0;c<n;c++){d=Math.max(d,Math.abs(nw[c]-w[c]));y[c]=nw[c]+(tk-1)/t2*(nw[c]-w[c]);}
    w=nw;tk=t2;if(d<1e-9)break;
  }
  return w;
}
/**
 * Résout pour une volatilité cible. ids : classes ; mu, sig : {id} ; cov : {ids, S} (annuelle) ; lo, hi : {id} en fraction ;
 * target : volatilité cible (fraction). Classes non mesurées par la covariance : variance prudente (σ² de leur série si connue, sinon 0).
 * Renvoie {w: {id}, sigma, gamma, reached (cible atteinte), minVol}.
 */
function solve(ids,mu,cov,lo,hi,target){
  var n=ids.length,S=[],k=cov&&cov.ids||[];if(!n)return {w:{},sigma:0,reached:true};
  for(var i=0;i<n;i++){S.push([]);for(var j=0;j<n;j++){var a=k.indexOf(ids[i]),b=k.indexOf(ids[j]);S[i][j]=a>=0&&b>=0?cov.S[a][b]:0;}}
  var m=ids.map(function(x){return nz(mu[x],0);}),L=ids.map(function(x){return Math.max(0,nz(lo[x],0));}),H=ids.map(function(x){return Math.max(0,nz(hi[x],1));});
  // bornes compatibles : si les minimums dépassent 100 % on les réduit, si les maximums n'atteignent pas 100 % on les élargit
  var sl=L.reduce(function(s,x){return s+x;},0),sh=H.reduce(function(s,x){return s+x;},0);
  if(sl>1)L=L.map(function(x){return x/sl;});if(sh<1)H=H.map(function(x){return sh>0?x/sh:1/n;});H=H.map(function(x,q){return Math.max(x,L[q]);});
  var sol=function(g,w0){var w=qp(m,S,L,H,1,g,w0);return {w:w,s:Math.sqrt(quad(S,w))};};
  var hiG=1e4,loG=1e-4,minV=sol(hiG),maxR=sol(loG);
  var best;
  if(maxR.s<=target+1e-9){best={w:maxR.w,s:maxR.s,g:loG,reached:true};}
  else if(minV.s>target+1e-9){best={w:minV.w,s:minV.s,g:hiG,reached:false};}
  else{var a=Math.log(loG),b=Math.log(hiG),w=minV.w,cur=minV;
    for(var it=0;it<28;it++){var mid=(a+b)/2,r=sol(Math.exp(mid),w);if(r.s>target){a=mid;}else{b=mid;cur=r;w=r.w;}}
    best={w:cur.w,s:cur.s,g:Math.exp(b),reached:true};}
  var o={};ids.forEach(function(x,q){o[x]=Math.round(best.w[q]*1e6)/1e6;});var tot=0;ids.forEach(function(x){tot+=o[x];});if(tot>0)ids.forEach(function(x){o[x]/=tot;});
  return {w:o,sigma:best.s,gamma:best.g,reached:best.reached,minVol:minV.s};
}
/**
 * Allocation d'un profil sur l'univers U. ctx : {profile (id), horizonFactor, cov, sig ({poche: vol annuelle}), scores ({poche: 0-100}), rf,
 * fixed ({poche: poids imposé} pour les classes sans série fiable), tilt (remplace l'inclinaison du profil)}.
 * Renvoie {w, sigma, target, reached, mu, lo, hi, notes}.
 */
function allocate(U,ctx){
  var C=cfg(),prof=(C.profils||{})[ctx.profile]||{},bounds=prof.bornes||{},opt=C.optimiseur||{},sp=nz(opt.sharpe_prior,0.3),notes=[];
  var tilt=fin(ctx.tilt)?ctx.tilt:nz(prof.inclinaison_max,0.25),rf=nz(ctx.rf,0),target=nz(prof.vol_cible,8)/100*nz(ctx.horizonFactor,1);
  var fixed=ctx.fixed||{},free=U.filter(function(p){return !(p in fixed);}),fixedSum=0;U.forEach(function(p){if(p in fixed)fixedSum+=fixed[p];});
  var lo={},hi={},mu={};
  free.forEach(function(p){var b=bounds[p]||[0,100];lo[p]=nz(b[0],0)/100;hi[p]=nz(b[1],100)/100;
    var s=p==="liquidites"?0:nz(ctx.sig&&ctx.sig[p],null),sc=ctx.scores&&fin(ctx.scores[p])?ctx.scores[p]:50,t=Math.max(-0.5,Math.min(0.5,tilt*(sc-50)/50));
    mu[p]=p==="liquidites"?rf:s!=null?rf+sp*s*(1+t):rf;});
  var budget=Math.max(0,1-fixedSum);
  // les bornes s'appliquent au portefeuille entier : on les ramène à la part laissée libre
  if(budget>0&&budget<1)free.forEach(function(p){lo[p]=Math.min(1,lo[p]/budget);hi[p]=Math.min(1,hi[p]/budget);});
  var r=solve(free,mu,ctx.cov,lo,hi,budget>0?target/budget:target),w={};
  free.forEach(function(p){w[p]=(r.w[p]||0)*budget;});U.forEach(function(p){if(p in fixed)w[p]=fixed[p];});
  if(!r.reached)notes.push({code:"vol",msg:"Volatilité cible de "+(Math.round(target*1000)/10).toString().replace(".",",")+" % inatteignable dans les bornes du profil avec tes classes : allocation la moins volatile possible."});
  return {w:w,sigma:r.sigma*budget,target:target,reached:r.reached,mu:mu,lo:lo,hi:hi,notes:notes};
}

CK.opt={project:project,qp:qp,solve:solve,allocate:allocate};
})();
