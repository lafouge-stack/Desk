/* ================================================================
   COCKPIT — Kit données (phase 1) : CK.dk
   Réseau (limiteur à jetons, budget par minute, file à priorités, dédoublonnage, cache,
   nouvels essais, disjoncteurs), WebSocket robuste, IndexedDB avec repli mémoire,
   journal en anneau et statut de chaque source.
   Rien ne démarre au chargement : tout passe par CK.dk.env, lu à chaque appel (remplaçable par les tests).
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

/* ---------- Environnement : valeurs par défaut = globals du navigateur, lus au moment de l'appel ---------- */
var DEF={
  fetch:function(u,o){return window.fetch(u,o);},
  WebSocket:function(u){return new window.WebSocket(u);},
  now:function(){return Date.now();},
  random:function(){return Math.random();},
  setTimeout:function(f,ms){return window.setTimeout(f,ms);},
  clearTimeout:function(h){return window.clearTimeout(h);},
  hidden:function(){return !!(window.document&&window.document.hidden);},
  indexedDB:undefined, // undefined = window.indexedDB ; null = absent
  online:function(){return !(window.navigator&&window.navigator.onLine===false);}
};
/** Lit une dépendance : CK.dk.env[k] si défini, sinon la valeur par défaut. */
function E(k){var e=dk.env,v=e?e[k]:undefined;if(v!==undefined)return v;return k==="indexedDB"?window.indexedDB:DEF[k];}
function now(){return +E("now")();}
function later(f,ms){return E("setTimeout")(f,ms);}
function cancel(h){if(h!=null)E("clearTimeout")(h);return null;}
function sleep(ms){return new Promise(function(r){later(r,ms);});}
function msgOf(e){return String(e&&e.message||e||"Erreur");}

/* ---------- Journal : anneau de 500 entrées, plus récentes en dernier ---------- */
var LOGS=[],LOGMAX=500,LEVELS=["info","warn","error"];
function log(level,provider,msg,extra){
  var e={ts:now(),level:LEVELS.indexOf(level)>=0?level:"info",provider:provider==null?null:String(provider),msg:String(msg==null?"":msg),extra:extra===undefined?null:extra};
  LOGS.push(e);if(LOGS.length>LOGMAX)LOGS.splice(0,LOGS.length-LOGMAX);return e;
}
/** filtre : id de provider (chaîne), {provider, level, since} ou fonction. */
function logs(f){
  var out=LOGS.slice();if(!f)return out;if(typeof f==="function")return out.filter(f);if(typeof f==="string")f={provider:f};
  return out.filter(function(e){return (!f.provider||e.provider===f.provider)&&(!f.level||e.level===f.level)&&(!f.since||e.ts>=f.since);});
}

/* ---------- Providers ---------- */
var PDEF={label:"",rate:0,burst:0,budgetPerMin:0,pauseHidden:false,guard:[],guardMs:600000,timeout:12000,retries:3,staleMs:1800000,period:0};
var P=Object.create(null);
function prov(id,opts){
  id=String(id);var p=P[id];
  if(!p)p=P[id]={id:id,cfg:Object.assign({},PDEF,{label:id,guard:[]}),tokens:null,tsTok:0,stamps:[],q:[],timer:null,until:0,why:"",self:{},
    st:{calls:0,errors:0,lastOk:0,lastErr:0,msg:"",last:"",dataTs:0,ttl:0}};
  // Les réglages numériques sont convertis en nombres ("60000" + 1 ne doit pas donner "600001").
  if(opts&&typeof opts==="object")Object.keys(PDEF).forEach(function(k){var v=opts[k];if(v===undefined)return;
    p.cfg[k]=k==="guard"?[].concat(v).map(String):typeof PDEF[k]==="number"?(isFinite(+v)?+v:PDEF[k]):typeof PDEF[k]==="boolean"?!!v:String(v);});
  return p;
}
function burstOf(c){return c.burst>0?c.burst:Math.max(1,Math.ceil(c.rate));}

/* ---------- Limiteur : seau à jetons (rate/burst) + budget glissant sur 60 s ; les "high" passent avant les "low" ---------- */
function waitMs(p){
  var c=p.cfg,t=now(),w=0;
  if(c.rate>0){var b=burstOf(c);if(p.tokens==null){p.tokens=b;p.tsTok=t;}
    p.tokens=Math.min(b,p.tokens+Math.max(0,t-p.tsTok)*c.rate/1000);p.tsTok=t;
    if(p.tokens<1-1e-9)w=Math.ceil((1-p.tokens)*1000/c.rate);}
  if(c.budgetPerMin>0){while(p.stamps.length&&p.stamps[0]<=t-60000)p.stamps.shift();
    if(p.stamps.length>=c.budgetPerMin)w=Math.max(w,p.stamps[0]+60000-t);}
  return w;
}
function pump(p){
  if(p.timer!=null)return;
  while(p.q.length){
    var w=waitMs(p);
    if(w>0){p.timer=later(function(){p.timer=null;pump(p);},w);return;}
    if(p.cfg.rate>0)p.tokens-=1;if(p.cfg.budgetPerMin>0)p.stamps.push(now());
    var i=0;for(var j=0;j<p.q.length;j++)if(p.q[j].hi){i=j;break;}
    p.q.splice(i,1)[0].go();
  }
}
function slot(p,hi){return new Promise(function(go){p.q.push({hi:hi,go:go});pump(p);});}

/* ---------- Disjoncteurs : guard (CK.NET) et pause propre après un 429 ----------
   Le guard surveille les AUTRES modules (ex. le screener sur tvscan). Une erreur écrite dans CK.NET par ce provider
   lui-même (CK.netErr reconnaît aussi ses URL) est ignorée : sinon un simple 5xx le mettrait en pause guardMs.
   Ses propres 429 restent couverts par la pause propre. */
function pauseOf(p){
  var c=p.cfg,t=now(),until=p.until>t?p.until:0,why=until?p.why:"",N=CK.NET||{};
  (c.guard||[]).forEach(function(id){var r=N[id];if(!r||!r.lastErr||p.self[id]===r.lastErr)return;var end=r.lastErr+c.guardMs;
    if(end>t&&(r.code===429||r.lastErr>(r.lastOk||0))&&end>until){until=end;why="pause : "+id+" en difficulté";}});
  return {until:until,why:why};
}

/* ---------- Cache mémoire et requêtes en vol ---------- */
var C=new Map(),CMAX=500,INF=new Map();
function cachePut(k,data){C.delete(k);C.set(k,{data:data,ts:now()});if(C.size>CMAX)C.delete(C.keys().next().value);}

function err(msg,o){var e=new Error(msg);if(o)Object.keys(o).forEach(function(k){e[k]=o[k];});return e;}
function retryAfter(r){
  var h=r&&r.headers&&typeof r.headers.get==="function"?r.headers.get("retry-after"):null;if(h==null||h==="")return null;
  h=String(h).trim();if(/^\d+(\.\d+)?$/.test(h))return Math.round(+h*1000);
  var d=Date.parse(h);return isNaN(d)?null:Math.max(0,d-now());
}
/** Délai avant le nouvel essai k (0, 1, 2…) ; null = ne pas réessayer (Retry-After au-delà de 60 s). */
function delayFor(e,k){
  if(e.after!=null)return e.after>60000?null:e.after;
  return Math.round(Math.min(30000,1000*Math.pow(2,k))*(0.5+E("random")()));
}

var ACCEPTED={};
/** Un appel réseau : délai maximal, statut HTTP, lecture, validation, journal. */
function once(p,url,o,init,tmo){
  var st=p.st,AC=window.AbortController,ctl=AC?new AC():null,perf=window.performance,t0=perf&&perf.now?perf.now():0;
  if(ctl)init=Object.assign({},init,{signal:ctl.signal});
  st.calls++;
  return new Promise(function(res,rej){
    var done=false,tm=null,end=function(f,v){if(done)return;done=true;tm=cancel(tm);f(v);};
    tm=later(function(){tm=null;if(done)return;try{if(ctl)ctl.abort();}catch(_){}end(rej,err("Délai dépassé",{retry:true,timeout:true}));},tmo);
    var fp;try{fp=Promise.resolve(E("fetch")(url,init));}catch(e){fp=Promise.reject(e);}
    fp.then(function(r){
      // opts.accept : codes HTTP attendus (ex. [404] pour un fichier que le robot n'a pas) → réponse normale, données null, aucune erreur.
      if(r&&!r.ok&&Array.isArray(o.accept)&&o.accept.indexOf(r.status|0)>=0)return ACCEPTED;
      if(!r||!r.ok){var s=r?r.status|0:0;throw err("HTTP "+s,{status:s,retry:s===429||s>=500||s===0,after:retryAfter(r)});}
      return Promise.resolve(o.parse==="text"?r.text():r.json()).then(null,function(){throw err("Réponse illisible",{retry:false});});
    },function(e){throw err(msgOf(e),{retry:true,net:true});}).then(function(d){end(res,d);},function(e){end(rej,e);});
  }).then(function(d){
    if(d===ACCEPTED)return null; // code attendu : pas de validation
    if(o.validate){var v;try{v=o.validate(d);}catch(e){v=msgOf(e);}
      if(v!==true)throw err("Réponse invalide"+(typeof v==="string"&&v?" : "+v:""),{retry:false,invalid:true});}
    return d;
  }).then(function(d){
    if(typeof CK.netOk==="function")try{CK.netOk(url,t0);}catch(_){}
    return d;
  },function(e){
    st.errors++;st.lastErr=now();st.msg=e.message;
    if(e.status===429){p.until=now()+Math.max(p.cfg.guardMs,e.after||0);p.why="pause : "+p.id+" en difficulté";log("warn",p.id,"trop de requêtes (429) : pause de "+Math.round((p.until-now())/60000)+" min",{until:p.until});}
    if(typeof CK.netErr==="function")try{
      var g=p.cfg.guard,N=CK.NET||{},b=g.map(function(id){return N[id]&&N[id].lastErr;});
      CK.netErr(url,e);N=CK.NET||{};
      g.forEach(function(id,i){var r=N[id];if(r&&r.lastErr&&r.lastErr!==b[i])p.self[id]=r.lastErr;}); // erreur écrite par nous
    }catch(_){}
    throw e;
  });
}

/** Échec ou blocage : sert le cache (même expiré) en stale, sinon rejette. quiet = onglet caché (n'abîme pas le statut). */
function fallback(p,key,e,quiet){
  var hit=C.get(key);
  if(hit){if(!quiet){p.st.last="stale";p.st.dataTs=hit.ts;}log(quiet?"info":"warn",p.id,"données en cache servies ("+e.message+")");
    return Promise.resolve({data:hit.data,stale:true,ts:hit.ts,from:"cache"});}
  if(!quiet)p.st.last="fail";log(quiet?"info":"error",p.id,e.message);
  return Promise.reject(e);
}

/** Ne lève jamais : toute erreur synchrone (corps circulaire, environnement cassé…) devient un rejet. */
function dkFetch(url,o){try{return run(url,o);}catch(e){return Promise.reject(e instanceof Error?e:new Error(msgOf(e)));}}
function run(url,o){
  o=o||{};
  if(!o.provider)return Promise.reject(new Error("provider manquant"));
  var p=prov(o.provider),c=p.cfg,method=String(o.method||"GET").toUpperCase(),
    body=o.body==null?null:typeof o.body==="string"?o.body:JSON.stringify(o.body),
    key=o.cacheKey||method+" "+url+(body!=null?" "+body:""),ttl=Math.max(0,+o.ttl||0),hi=o.priority==="high";
  if(ttl)p.st.ttl=ttl;
  var hit=C.get(key);
  if(hit&&ttl&&now()-hit.ts<ttl)return Promise.resolve({data:hit.data,stale:false,ts:hit.ts,from:"cache"});
  if(INF.has(key))return INF.get(key);
  if(!hi&&c.pauseHidden&&E("hidden")())return fallback(p,key,new Error("onglet caché"),true);
  var ps=pauseOf(p);if(ps.until)return fallback(p,key,new Error(ps.why),false);
  if(!E("online")())return fallback(p,key,new Error("hors ligne"),false);
  var init={method:method};if(o.headers)init.headers=o.headers;if(body!=null)init.body=body;
  var max=Math.max(0,o.retries!=null?+o.retries:+c.retries||0),tmo=+o.timeout||+c.timeout||12000,k=0;
  function attempt(){
    // Après l'attente dans la file, les disjoncteurs sont revérifiés avant le PREMIER appel : un 429 reçu entre-temps
    // retient les requêtes en attente. Les nouveaux essais d'une requête déjà partie ne sont pas retenus.
    return slot(p,hi).then(function(){
      if(!k){var ps=pauseOf(p);if(ps.until)throw err(ps.why,{retry:false,paused:true});}
      return once(p,url,o,init,tmo);
    }).then(null,function(e){
      if(e.retry&&k<max&&E("online")()){var d=delayFor(e,k);
        if(d!=null){k++;log("warn",p.id,"nouvel essai "+k+"/"+max+" dans "+Math.round(d/100)/10+" s ("+e.message+")",{url:url});return sleep(d).then(attempt);}}
      throw e;
    });
  }
  var pr=attempt().then(function(d){
    var t=now();p.st.lastOk=t;p.st.last="ok";p.st.dataTs=t;p.until=0;if(ttl)cachePut(key,d);
    return {data:d,stale:false,ts:t,from:"net"};
  },function(e){return fallback(p,key,e,false);});
  INF.set(key,pr);
  var clear=function(){if(INF.get(key)===pr)INF.delete(key);};pr.then(clear,clear);
  return pr;
}

/* ---------- Statut d'une source ---------- */
var LBL={connectee:"Connectée",degradee:"Dégradée",hors_ligne:"Hors ligne",obsolete:"Données obsolètes",inactif:"Inactive"};
function status(id){
  var p=P[id];
  if(!p)return {state:"inactif",label:LBL.inactif,lastOk:0,lastErr:0,msg:"",calls:0,errors:0,paused:false,until:0};
  var s=p.st,c=p.cfg,t=now(),ps=pauseOf(p),per=c.period>0?c.period:s.ttl>0?s.ttl:300000,state;
  if(!s.last)state="inactif";
  else if(s.last==="fail")state="hors_ligne";
  else if(t-s.dataTs>c.staleMs)state="obsolete";
  else if(s.last==="stale"||t-s.lastOk>2*per||(s.lastErr&&t-s.lastErr<2*per))state="degradee";
  else state="connectee";
  return {state:state,label:LBL[state],lastOk:s.lastOk,lastErr:s.lastErr,msg:ps.until?ps.why:s.msg,calls:s.calls,errors:s.errors,paused:!!ps.until,until:ps.until};
}

/* ---------- WebSocket : reconnexion sans fin, backoff plafonné, chien de garde sur le ping seulement ---------- */
var WS=new Set();
function ws(url,o){
  o=o||{};
  var name=String(o.provider||o.name||"ws"),pg=o.ping&&o.ping.msg!=null?o.ping:null,
    // Le silence est contrôlé à chaque ping : un délai plus court que 2 intervalles reconnecterait même avec des pongs réguliers.
    every=pg&&+pg.every||20000,ptmo=Math.max(pg&&+pg.timeout||90000,2*every),watch=!!(pg&&typeof pg.isPong==="function"),
    cto=+o.connectTimeout||10000,maxB=+o.maxBackoff||60000,p=o.provider?prov(o.provider):null;
  var sock=null,st="connexion",k=0,closed=false,tRetry=null,tConn=null,tPing=null,lastPong=0,h;
  function kill(){
    tConn=cancel(tConn);tPing=cancel(tPing);
    if(sock){var s=sock;sock=null;s.onopen=s.onmessage=s.onclose=s.onerror=null;try{s.close();}catch(_){}}
  }
  function retry(why){
    if(closed)return;var was=st;kill();st="reconnexion";
    // Échec avant l'ouverture : plus de flux → "hors ligne" ; coupure d'un flux ouvert : erreur récente → "dégradée".
    if(why){log("warn",name,why);if(p){p.st.errors++;p.st.lastErr=now();p.st.msg=why;if(was!=="ouvert")p.st.last="fail";}}
    if(tRetry!=null)return;
    var d=Math.round(Math.min(maxB,1500*Math.pow(2,k))*(0.5+E("random")()));k++;
    tRetry=later(function(){tRetry=null;connect();},d);
  }
  function beat(){
    tPing=null;if(closed||st!=="ouvert"||!sock)return;
    if(watch&&now()-lastPong>ptmo)return retry("pas de réponse au ping depuis "+Math.round(ptmo/1000)+" s");
    try{sock.send(typeof pg.msg==="string"?pg.msg:JSON.stringify(pg.msg));}catch(_){}
    tPing=later(beat,every);
  }
  function connect(){
    if(closed)return;kill();
    var s;try{s=new (E("WebSocket"))(url);}catch(e){return retry("connexion impossible : "+msgOf(e));}
    sock=s;if(p)p.st.calls++;
    tConn=later(function(){tConn=null;if(sock===s&&st!=="ouvert")retry("délai de connexion dépassé");},cto);
    s.onopen=function(){
      if(sock!==s)return;tConn=cancel(tConn);k=0;st="ouvert";lastPong=now();
      if(p){p.st.lastOk=lastPong;p.st.last="ok";p.st.dataTs=lastPong;}
      log("info",name,"connecté");
      if(o.onOpen)try{o.onOpen(s);}catch(e){log("error",name,"onOpen : "+msgOf(e));}
      if(pg&&st==="ouvert"&&sock===s)tPing=later(beat,every);
    };
    s.onmessage=function(ev){
      if(sock!==s)return;var d=ev&&typeof ev==="object"&&"data" in ev?ev.data:ev;
      if(watch){var pong=false;try{pong=!!pg.isPong(d);}catch(_){}if(pong){lastPong=now();return;}}
      if(p){p.st.lastOk=now();p.st.last="ok";p.st.dataTs=p.st.lastOk;}
      if(o.onMessage)try{o.onMessage(d);}catch(e){log("error",name,"onMessage : "+msgOf(e));}
    };
    s.onclose=function(ev){if(sock===s)retry("connexion fermée"+(ev&&ev.code?" ("+ev.code+")":""));};
    s.onerror=function(){}; // la fermeture suit (sinon le délai de connexion ou le ping prennent le relais)
  }
  h={
    send:function(m){if(st!=="ouvert"||!sock)return false;try{sock.send(typeof m==="string"?m:JSON.stringify(m));return true;}catch(_){return false;}},
    close:function(){if(closed)return;closed=true;tRetry=cancel(tRetry);kill();st="ferme";WS.delete(h);log("info",name,"fermé");},
    state:function(){return st;},
    /** À appeler sur l'événement 'online' : reconnecte tout de suite (sauf si déjà ouvert ou fermé). */
    online:function(){if(closed||st==="ouvert")return false;tRetry=cancel(tRetry);k=0;connect();return true;}
  };
  WS.add(h);connect();
  return h;
}
ws.online=function(){var n=0;WS.forEach(function(h){if(h.online())n++;});return n;};

/* ---------- IndexedDB (base "cockpit:<id>:marches") avec repli mémoire transparent ---------- */
var STORES=["bars","quotes","meta"],MEM=null,DBP=null,MODE=null;
function memStore(s){if(!MEM){MEM={};STORES.forEach(function(n){MEM[n]=new Map();});}return MEM[s];}
function clone(v){try{var sc=window.structuredClone;return sc?sc(v):JSON.parse(JSON.stringify(v));}catch(_){return v;}}
/** window.indexedDB peut lever à la simple lecture (iframe isolée, cookies bloqués) : null = absent. */
function idbApi(){try{return E("indexedDB")||null;}catch(_){return null;}}
function dbName(){var id="desk";try{var c=CK.cfg&&CK.cfg();if(c&&c.id)id=String(c.id);}catch(_){}return "cockpit:"+id+":marches";}
function openDB(){
  if(DBP)return DBP;
  DBP=new Promise(function(res){
    var I=idbApi(),done=false,tm=null,fin=function(db){if(done)return;done=true;tm=cancel(tm);MODE=db?"indexeddb":"memoire";
      if(!db)log("warn","idb","IndexedDB indisponible : stockage en mémoire");res(db||null);};
    if(!I||typeof I.open!=="function")return fin(null);
    try{
      var r=I.open(dbName(),1);
      r.onupgradeneeded=function(){var db=r.result;STORES.forEach(function(n){if(!db.objectStoreNames.contains(n))db.createObjectStore(n);});};
      // Base ouverte après le délai (déjà passé en mémoire) : on la referme pour ne pas bloquer une future mise à niveau.
      r.onsuccess=function(){if(done){try{r.result.close();}catch(_){}return;}fin(r.result);};r.onerror=function(){fin(null);};r.onblocked=function(){fin(null);};
      if(!done)tm=later(function(){tm=null;fin(null);},5000);
    }catch(e){fin(null);}
  });
  return DBP;
}
function op(store,mode,fn,mem){
  if(STORES.indexOf(store)<0)return Promise.reject(new Error("store inconnu : "+store));
  return openDB().then(function(db){
    if(!db)return mem(memStore(store));
    return new Promise(function(res,rej){var r=fn(db.transaction(store,mode).objectStore(store));
      r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error||new Error("IndexedDB"));};})
      .then(null,function(e){log("warn","idb","IndexedDB en erreur, repli mémoire : "+msgOf(e));MODE="memoire";DBP=Promise.resolve(null);return mem(memStore(store));});
  });
}
var idb={
  get:function(s,k){return op(s,"readonly",function(o){return o.get(k);},function(m){return m.has(k)?clone(m.get(k)):undefined;});},
  put:function(s,k,v){return op(s,"readwrite",function(o){return o.put(v,k);},function(m){m.set(k,clone(v));return k;});},
  del:function(s,k){return op(s,"readwrite",function(o){return o.delete(k);},function(m){m.delete(k);return undefined;});},
  keys:function(s){return op(s,"readonly",function(o){return o.getAllKeys();},function(m){return Array.from(m.keys());});},
  clear:function(s){return op(s,"readwrite",function(o){return o.clear();},function(m){m.clear();return undefined;});},
  mode:function(){return MODE||(idbApi()?"indexeddb":"memoire");},
  name:dbName
};

/* ---------- Remise à zéro (tests) ---------- */
function reset(){
  WS.forEach(function(h){h.close();});WS.clear();
  Object.keys(P).forEach(function(id){var p=P[id];if(p.timer!=null)try{cancel(p.timer);}catch(_){}});
  P=Object.create(null);C.clear();INF.clear();MEM=null;DBP=null;MODE=null;LOGS.length=0;
}

var dk=CK.dk={
  env:Object.assign({},DEF),
  provider:function(id,opts){var p=prov(id,opts);return Object.assign({id:p.id},p.cfg,{guard:p.cfg.guard.slice()});},
  fetch:dkFetch,status:status,log:log,logs:logs,ws:ws,idb:idb,_reset:reset
};
})();
