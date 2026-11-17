/* ================================================================
   COCKPIT — Données de marché multi-actifs (phase 1) : CK.mkt
   Registre de providers (crypto, actions/ETF, indices, matières premières, obligations),
   adaptateurs TradingView (scanner) et robot (historiques), historique crypto Binance.
   Tout le réseau passe par CK.dk (datakit.js). Aucun accès au DOM, aucune minuterie,
   aucun appel réseau au chargement : tout démarre par un appel explicite.
   Les cotations sont pour l'AFFICHAGE (src:"scan") : le moteur d'allocation ne s'en sert pas.
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};

var TV_URL="https://scanner.tradingview.com/global/scan?label-product=desk-marches";
var BIN_URL="https://data-api.binance.vision/api/v3/klines";
var DAY=864e5,H6=6*36e5,TV_MAX=200,BIN_LIMIT=1000,BIN_PAGES=20;
/** Colonnes du scanner, lues PAR POSITION : n'en ajouter qu'à la fin. */
var TV_COLS=["name","description","type","subtype","exchange","currency","isin","close","open","high","low","volume","change",
  "Perf.W","Perf.1M","Perf.3M","Perf.6M","Perf.Y","Perf.YTD","Value.Traded","update_mode","last_bar_update_time",
  "price_52_week_high","price_52_week_low","average_volume_10d_calc","aum","expense_ratio","country","sector"];
/** Réglages des providers CK.dk utilisés ici (déclarés au premier appel). */
var DK_CONF={
  tvscan2:{label:"TradingView (marchés)",rate:0.2,burst:2,budgetPerMin:4,pauseHidden:true,guard:["tvscan"],guardMs:600000,timeout:12000},
  robotdata:{label:"Robot (historiques)",rate:5,burst:10,timeout:15000},
  binhist:{label:"Binance (historique crypto)",rate:2,burst:5,timeout:15000}
};
var LBL={connectee:"Connectée",degradee:"Dégradée",hors_ligne:"Hors ligne",obsolete:"Données obsolètes",inactif:"Inactive"};
/* Tables sans prototype : un id ou une clé « toString », « constructor », « __proto__ » n'y est jamais trouvé par erreur. */
function dict(o){var d=Object.create(null);if(o)Object.keys(o).forEach(function(k){d[k]=o[k];});return d;}

/* ---------- Environnement et datakit, lus au moment de l'appel ----------
   Le provider CK.dk est (re)déclaré à chaque appel : après CK.dk._reset(), ses réglages (budget, pause onglet caché…)
   ne sont jamais perdus. La déclaration ne fait que recopier la configuration (aucun état remis à zéro). */
function dk(){var d=CK.dk;if(!d||typeof d.fetch!=="function")throw new Error("datakit absent");
  if(typeof d.provider==="function")Object.keys(DK_CONF).forEach(function(id){d.provider(id,DK_CONF[id]);});return d;}
function env(){return CK.dk&&CK.dk.env||{};}
function now(){var e=env();return e.now?e.now():Date.now();}
function hidden(){var e=env();if(e.hidden)return !!e.hidden();var d=window.document;return !!(d&&d.hidden);}
function later(f,ms){var st=env().setTimeout||window.setTimeout;return st(f,ms);}
function cancel(t){if(t==null)return;var ct=env().clearTimeout||window.clearTimeout;ct(t);}
function log(level,prov,msg,extra){try{if(CK.dk&&CK.dk.log)CK.dk.log(level,prov,msg,extra);}catch(e){}}
function dkStatus(id){try{if(CK.dk&&CK.dk.status)return CK.dk.status(id);}catch(e){}return {state:"inactif",label:LBL.inactif};}
function M(){return CK.models;}
function n(v){return M().num(v);}
function txt(v,max){return M().cleanText(v,max)||null;}
function why(e){return e&&e.message?e.message:String(e);}
/** Appelle f et renvoie toujours une promesse (une exception devient un rejet). */
function call(f){try{return Promise.resolve(f());}catch(e){return Promise.reject(e);}}
function is404(e){return !!e&&(e.status===404||e.code===404||/\b404\b/.test(String(e.message||"")));}

/** Borne de date : ms, Date ou "AAAA-MM-JJ" (jour UTC entier : début à 00:00, fin à 23:59:59,999). */
function bound(v,end){
  if(v==null||v==="")return null;if(typeof v==="number")return isFinite(v)?v:null;
  if(typeof v.getTime==="function"){var g=v.getTime();return isFinite(g)?g:null;}
  var s=String(v),t=/^\d{4}-\d{2}-\d{2}$/.test(s)?Date.parse(s+"T00:00:00Z"):Date.parse(s);
  if(isNaN(t))return null;return end&&/^\d{4}-\d{2}-\d{2}$/.test(s)?t+DAY-1:t;
}
function inRange(t,from,to){return (from==null||t>=from)&&(to==null||t<=to);}
function sortBars(a){var seen={};return a.sort(function(x,y){return x.timestamp-y.timestamp;}).filter(function(b){if(seen[b.timestamp])return false;seen[b.timestamp]=1;return true;});}
/** Regroupe des barres quotidiennes en semaines (lundi→dimanche, UTC) ou en mois : ouverture du premier jour, clôture et horodatage du dernier. */
function resample(bars,gran){
  if(gran!=="1w"&&gran!=="1M")return bars;var out=[],cur=null,key=null;
  bars.forEach(function(b){var d=Math.floor(b.timestamp/DAY),k=gran==="1w"?d-(d+3)%7:M().isoDate(b.timestamp).slice(0,7);
    if(k!==key){if(cur)out.push(cur);key=k;cur=Object.assign({},b,{granularity:gran});return;}
    cur.high=Math.max(cur.high,b.high);cur.low=Math.min(cur.low,b.low);cur.close=b.close;cur.timestamp=b.timestamp;
    cur.volume=cur.volume==null&&b.volume==null?null:(cur.volume||0)+(b.volume||0);});
  if(cur)out.push(cur);return out;
}

/* ================================================================
   TvScanAdapter : scanner TradingView, un POST groupé pour tous les instruments demandés
   dans le même tour de boucle (tous providers confondus), 200 tickers au plus par POST.
   ================================================================ */
/** Ticker TradingView d'un instrument (tickers.tv, ou id "tv:BOURSE:SYMBOLE"). */
function tvTicker(i){var t=i&&i.tickers&&i.tickers.tv;if(!t&&i&&/^tv:/i.test(i.id||""))t=String(i.id).slice(3);return t?String(t).trim().toUpperCase():null;}
function tvRow(d){var o={};TV_COLS.forEach(function(c,k){o[c]=Array.isArray(d)&&k<d.length?d[k]:null;});return o;}
/** Retard annoncé par update_mode : "delayed_streaming_900" → 900 s, "…_600" → 600 s, "streaming" → 0. */
function tvDelay(mode){var m=String(mode||""),x=m.match(/(\d+)\s*$/);return x?+x[1]:/streaming/i.test(m)?0:null;}
/** Ligne {s, d:[…]} du scanner → Quote (null si le cours manque). Les champs descriptifs vont dans q.info. */
function tvQuote(instr,row,stale){
  var r=tvRow(row&&row.d),c=n(r.close),ch=n(r.change),t=n(r.last_bar_update_time);
  if(c==null||c<=0)return null;
  var q=M().normQuote({instrument_id:instr.id,last:c,prev_close:ch!=null&&ch>-100?c/(1+ch/100):null,open:r.open,high:r.high,low:r.low,
    volume:r.volume,value_traded:r["Value.Traded"],change_pct:ch,
    perf:{w:r["Perf.W"],m1:r["Perf.1M"],m3:r["Perf.3M"],m6:r["Perf.6M"],y1:r["Perf.Y"],ytd:r["Perf.YTD"]},
    currency:r.currency||instr.currency,ts:t>0?t*1000:now(),delay_s:tvDelay(r.update_mode),source:"TradingView",stale:!!stale});
  q.info={ticker:txt(row.s,40),name:txt(r.name,40),description:txt(r.description,120),type:txt(r.type,20),subtype:txt(r.subtype,20),
    exchange:txt(r.exchange,20),isin:txt(r.isin,12),high_52w:n(r.price_52_week_high),low_52w:n(r.price_52_week_low),
    avg_volume_10d:n(r.average_volume_10d_calc),aum:n(r.aum),ter:n(r.expense_ratio),country:txt(r.country,40),sector:txt(r.sector,60)};
  return q;
}
function TvScanAdapter(){
  var batch=null;
  function post(syms,prio){return call(function(){return dk().fetch(TV_URL,{provider:"tvscan2",method:"POST",
    headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify({symbols:{tickers:syms},columns:TV_COLS}),
    parse:"json",ttl:60000,priority:prio,validate:function(d){return d&&Array.isArray(d.data)?true:"réponse sans tableau data";}});});}
  function flush(b){
    var syms=[],seen=dict();
    b.items.forEach(function(it){it.list.forEach(function(i){var s=tvTicker(i);if(s&&!seen[s]){seen[s]=1;syms.push(s);}});});
    syms.sort();var chunks=[];for(var k=0;k<syms.length;k+=TV_MAX)chunks.push(syms.slice(k,k+TV_MAX));
    var prio=b.items.some(function(it){return it.prio==="high";})?"high":b.items.every(function(it){return it.prio==="low";})?"low":undefined;
    var rows=dict(),failed=dict(),stale=dict();
    return Promise.all(chunks.map(function(ch){return post(ch,prio).then(function(r){
        var data=r&&r.data&&Array.isArray(r.data.data)?r.data.data:[];
        data.forEach(function(x){if(x&&x.s)rows[String(x.s).toUpperCase()]=x;});if(r&&r.stale)ch.forEach(function(s){stale[s]=1;});
      },function(e){ch.forEach(function(s){failed[s]=e;});log("warn","tvscan2","échec du scanner : "+why(e),{tickers:ch.length});});
    })).then(function(){b.items.forEach(function(it){
      var out=[],fail=null,asked=0;
      it.list.forEach(function(i){var s=tvTicker(i);if(!s)return;asked++;
        if(failed[s]){fail=failed[s];return;}
        var row=rows[s];if(!row){log("warn","tvscan2","symbole sans réponse",{symbol:s,id:i.id});return;}
        var q=tvQuote(i,row,stale[s]);if(q)out.push(q);else log("warn","tvscan2","cours absent dans la réponse",{symbol:s,id:i.id});});
      if(asked&&fail&&!out.length)it.reject(fail);else it.resolve(out);});});
  }
  return {id:"tvscan",label:"TradingView (scanner)",
    /** Cotations (Promise<Quote[]>). Les appels du même tour de boucle partagent le même POST. */
    getQuotes:function(list,opts){return new Promise(function(resolve,reject){
      list=(Array.isArray(list)?list:[]).filter(function(i){if(i&&tvTicker(i))return true;if(i)log("warn","tvscan2","aucun ticker TradingView",{id:i.id});return false;});
      if(!batch){var b=batch={items:[]};Promise.resolve().then(function(){batch=null;return flush(b);}).catch(function(e){
        log("error","tvscan2","scanner : "+why(e));b.items.forEach(function(it){it.reject(e);});});}
      batch.items.push({list:list,prio:opts&&opts.priority,resolve:resolve,reject:reject});});}};
}

/* ================================================================
   RobotHistAdapter : historiques quotidiens publiés par le robot GitHub.
   GET {base}/data/marches-meta.json (une fois) puis {base}/data/hist/{fichier}.json.
   marches-meta.json (facultatif dans son contenu) : {v|version|updated, files:{"<fichier>":{…}} | ["<fichier>", …]}
     - absent (404) → robot sans historiques : plus aucun appel pendant la session ;
     - files présent → seuls les fichiers listés sont demandés ; v/version/updated invalide le cache des fichiers.
   Fichier : {id, ccy, src, t:[ms], o:[], h:[], l:[], c:[], v:[], div:[[t,montant]], split:[[t,ratio]]}.
   ================================================================ */
/** "isin:LU1681043599" → "isin_LU1681043599" (tout caractère hors [A-Za-z0-9_-] devient "_"). */
function fileOf(id){return String(id||"").replace(/[^A-Za-z0-9_-]/g,"_");}
function RobotHistAdapter(opts){
  opts=opts||{};var missing=dict(),metas=dict(),events=dict();
  function base(){var b=opts.base;if(!b)try{b=CK.cfg&&CK.cfg().data;}catch(e){b="";}return String(b).trim().replace(/\/+$/,"");}
  /** GET JSON ; null si 404 (mémorisé : l'adresse n'est plus jamais redemandée). */
  function get(url,validate,key){
    if(missing[url])return Promise.resolve(null);
    return call(function(){return dk().fetch(url,{provider:"robotdata",parse:"json",ttl:H6,validate:validate,cacheKey:key,accept:[404]});})
      .then(function(r){if(r&&r.data===null&&!r.stale){missing[url]=1;log("info","robotdata","fichier absent du robot (mémorisé)",{url:url});return null;}return r?r.data:null;},function(e){if(!is404(e))throw e;missing[url]=1;log("info","robotdata","fichier absent du robot (mémorisé)",{url:url});return null;});
  }
  /** marches-meta.json : relu au plus une fois par heure (une page ouverte longtemps voit les nouvelles versions). */
  function meta(b){
    var x=metas[b];if(x&&now()-x.ts<36e5)return x.p;
    var p=get(b+"/data/marches-meta.json",function(d){return d&&typeof d==="object"&&!Array.isArray(d)?true:"marches-meta.json invalide";})
      .catch(function(e){delete metas[b];log("warn","robotdata","marches-meta.json illisible : "+why(e));return undefined;});
    metas[b]={p:p,ts:now()};return p;
  }
  /* Copie longue des historiques dans IndexedDB (store "bars"), valable tant que la version du fichier ne change pas. */
  function store(){var d=dk();return d&&d.idb&&typeof d.idb.get==="function"?d.idb:null;}
  function fromStore(url,ver){var I=store();if(!I||ver==null)return Promise.resolve(null);
    return Promise.resolve().then(function(){return I.get("bars",url);}).then(function(x){return x&&x.ver===String(ver)&&x.data&&validHist(x.data)===true?x.data:null;},function(){return null;});}
  function toStore(url,ver,data){var I=store();if(!I||ver==null||!data)return;try{Promise.resolve(I.put("bars",url,{ver:String(ver),ts:now(),data:data})).then(null,function(){});}catch(e){}}
  /** Fichier simple du robot (resume.json, taux.json) : null si absent. */
  function file(name,check){var b=base();if(!b)return Promise.resolve(null);
    return get(b+"/data/"+name,function(d){return d&&typeof d==="object"&&!Array.isArray(d)&&check(d)?true:name+" invalide";}).then(null,function(e){log("warn","robotdata",name+" illisible : "+why(e));return null;});}
  function validHist(d){return d&&Array.isArray(d.t)&&Array.isArray(d.c)&&d.t.length===d.c.length?true:"historique invalide (t et c)";}
  function toBars(d,instr,o){
    var ccy=(txt(d.ccy,4)||"").toUpperCase()||instr.currency||null,src=txt(d.src,40)||"robot",from=bound(o.from),to=bound(o.to,true),out=[];
    var col=function(a,k){return Array.isArray(a)?a[k]:null;};
    for(var k=0;k<d.t.length;k++){var b=M().normBar({t:d.t[k],o:col(d.o,k),h:col(d.h,k),l:col(d.l,k),c:d.c[k],v:col(d.v,k)},instr.id,ccy,src,"1d");
      if(b&&inRange(b.timestamp,from,to))out.push(b);}
    var ev=function(a){return Array.isArray(a)?a.filter(function(x){return Array.isArray(x)&&n(x[0])!=null&&n(x[1])!=null;}).map(function(x){return [n(x[0]),n(x[1])];}):[];};
    events[instr.id]={div:ev(d.div),split:ev(d.split)};
    return resample(sortBars(out),o.granularity);
  }
  return {id:"robothist",label:"Robot (historiques)",fileOf:fileOf,
    url:function(instr){var b=base();return b?b+"/data/hist/"+fileOf(instr&&instr.id)+".json":null;},
    /** Résumé publié par le robot (resume.json) : {v, ts, items:{id:{d, c, p, vol1y, mdd1y, spark…}}} ou null. */
    resume:function(){return file("resume.json",function(d){return d.items&&typeof d.items==="object";});},
    /** Taux publiés par le robot (taux.json) : {estr, depo, ea, us} ou null. */
    taux:function(){return file("taux.json",function(){return true;});},
    /** Dividendes et divisions du dernier fichier lu pour cet instrument : {div, split} ou null. */
    events:function(instr){return events[instr&&instr.id||instr]||null;},
    /** Historique quotidien (Promise<PriceBar[]>), filtré par from/to ; [] si le robot ou le fichier manque. */
    getHistory:function(instr,o){o=o||{};var b=base();
      if(!instr||!instr.id)return Promise.resolve([]);
      if(!b){log("warn","robotdata","adresse du robot absente (réglage data)");return Promise.resolve([]);}
      var f=fileOf(instr.id),url=b+"/data/hist/"+f+".json";if(missing[url])return Promise.resolve([]);
      return meta(b).then(function(m){
        if(m===null)return [];
        var files=m&&m.files,names=Array.isArray(files)?files:files&&typeof files==="object"?Object.keys(files):null;
        var listed=!names||names.some(function(x){return x===f||x===f+".json";});
        if(!listed){log("info","robotdata","pas d'historique publié pour cet instrument",{id:instr.id});return [];}
        // version propre au fichier (dernière séance + nombre de séances) : les autres fichiers restent en cache
        var fm=files&&!Array.isArray(files)?files[f]||files[f+".json"]:null,ver=fm&&fm.last?fm.last+"."+(fm.n|0):m&&(m.v||m.version||m.updated);
        return fromStore(url,ver).then(function(hit){if(hit)return toBars(hit,instr,o);
          return get(url,validHist,ver!=null?"GET "+url+"#"+ver:undefined).then(function(d){if(d)toStore(url,ver,d);return d?toBars(d,instr,o):[];});});
      });}};
}

/* ================================================================
   Crypto : cotations lues dans CK.S (flux OKX existant, puis tickers REST), sans aucun appel réseau ;
   historique Binance (data-api.binance.vision). N'ouvre aucun WebSocket, n'appelle jamais OKX.
   ================================================================ */
function cryptoBase(i){var t=i&&i.tickers||{},s=t.okx?String(t.okx).split("-")[0]:i&&i.symbol||String(i&&i.id||"").replace(/^crypto:/i,"");return (M().cleanText(s,20)||"").toUpperCase();}
function uniFind(U,b){var lists=Array.isArray(U)?[U]:U?[U.spot,U.perp]:[];
  for(var k=0;k<lists.length;k++){var a=lists[k];if(Array.isArray(a))for(var j=0;j<a.length;j++)if(a[j]&&a[j].base===b)return a[j];}return null;}
/** Quote crypto en USDT : S.tick["BTC-USDT"] (flux, delay 0 ; stale si plus de 5 min) sinon S.uni (REST, delay 60). */
function cryptoQuote(i){
  var b=cryptoBase(i),S=CK.S||{},T=now(),mq=M().normQuote;if(!b)return null;
  if(b==="USDT")return mq({instrument_id:i.id,last:1,prev_close:1,change_pct:0,currency:"USDT",ts:T,delay_s:0,source:"Parité"});
  var t=S.tick&&S.tick[b+"-USDT"];
  if(t&&n(t.last)>0){var o=n(t.open),ts=n(t.ts);
    return mq({instrument_id:i.id,last:t.last,open:o,high:t.high,low:t.low,prev_close:o,change_pct:o>0?(n(t.last)/o-1)*100:null,
      currency:"USDT",ts:ts||T,delay_s:0,source:"OKX (flux)",stale:ts>0&&T-ts>300000});}
  var u=uniFind(S.uni,b);
  if(u&&n(u.last)>0){var ch=n(u.chg);
    return mq({instrument_id:i.id,last:u.last,prev_close:ch!=null&&ch>-100?n(u.last)/(1+ch/100):null,change_pct:ch,value_traded:u.usd,
      currency:"USDT",ts:T,delay_s:60,source:"OKX"});}
  return null;
}
function binSymbol(i){var t=i&&i.tickers||{};if(t.binance)return String(t.binance).toUpperCase().replace(/[^A-Z0-9]/g,"")||null;var b=cryptoBase(i);return b&&b!=="USDT"?b+"USDT":null;}
var BIN_IV=dict({"1d":"1d","1w":"1w","1M":"1M"});
/** Historique Binance en USDT. Seules les bougies CLÔTURÉES (closeTime < maintenant) sont gardées.
   Horodatage de la barre = closeTime + 1 = instant exact de clôture (la bougie du jour J UTC porte J+1 00:00 UTC ;
   son jour est models.isoDate(timestamp − 1)). from/to filtrent l'ouverture de la bougie (comme startTime/endTime de Binance).
   Sans from : les 1000 dernières bougies ; avec from : pagination par startTime (1000 par page, 20 pages au plus). */
function binHistory(i,o){
  o=o||{};var sym=binSymbol(i);if(!sym){log("warn","binhist","pas de paire Binance",{id:i&&i.id});return Promise.resolve([]);}
  var iv=BIN_IV[o.granularity]||"1d",from=bound(o.from),to=bound(o.to,true),T=now(),out=[],pages=0;
  function page(start){
    var url=BIN_URL+"?symbol="+encodeURIComponent(sym)+"&interval="+iv+"&limit="+BIN_LIMIT+(start!=null?"&startTime="+start:"")+(to!=null?"&endTime="+to:"");
    return call(function(){return dk().fetch(url,{provider:"binhist",parse:"json",ttl:36e5,validate:function(d){return Array.isArray(d)?true:"réponse non tableau";}});})
      .then(function(r){var rows=r&&Array.isArray(r.data)?r.data:[];pages++;
        rows.forEach(function(k){var ot=n(k&&k[0]),ct=n(k&&k[6]);if(ot==null||ct==null||ct>=T||!inRange(ot,from,to))return;
          var b=M().normBar({t:ct+1,o:k[1],h:k[2],l:k[3],c:k[4],v:k[5]},i.id,"USDT","Binance",iv);if(b)out.push(b);});
        var next=rows.length?n(rows[rows.length-1][0])+1:null;
        if(start!=null&&rows.length>=BIN_LIMIT&&pages<BIN_PAGES&&next>start&&(to==null||next<=to))return page(next);
        return sortBars(out);});
  }
  return page(from);
}

/* ================================================================
   Providers (interface MarketDataProvider) et registre CK.mkt
   ================================================================ */
var TV=TvScanAdapter(),HIST=RobotHistAdapter();
var CRYPTO={id:"crypto",label:"Crypto (flux OKX, historique Binance)",classes:["crypto","stablecoin"],
  getQuotes:function(list){return Promise.resolve((list||[]).map(cryptoQuote).filter(Boolean));},
  getHistory:function(i,o){return binHistory(i,o);},
  /** Relit CK.S.tick toutes les 2 s ; onQuote({id:Quote}) reçoit seulement les cotations qui ont changé
     (cours, variation, plus haut/bas, source, fraîcheur ; horodatage pour le flux seulement : les cotations REST
     et la parité USDT portent « maintenant » et seraient sinon réémises toutes les 2 s). */
  subscribe:function(list,onQuote){var alive=true,tid=null,prev=dict();
    var sig=function(q){return [q.last,q.change_pct,q.high,q.low,q.source,q.stale,q.delay_s===0&&q.source!=="Parité"?q.ts:""].join("|");};
    function tick(){if(!alive)return;var m={},any=false;
      try{(list||[]).forEach(function(i){var q=cryptoQuote(i),s=q&&sig(q);if(q&&prev[i.id]!==s){prev[i.id]=s;m[i.id]=q;any=true;}});}
      catch(e){log("error","crypto","relecture des cotations : "+why(e));}
      if(any)try{onQuote(m);}catch(e){log("error","crypto","abonné : "+why(e));}
      if(alive)tid=later(tick,2000);}
    tick();return function(){alive=false;cancel(tid);tid=null;};},
  status:function(){var S=CK.S||{},T=now(),last=0;Object.keys(S.tick||{}).forEach(function(k){var t=n(S.tick[k]&&S.tick[k].ts);if(t>last)last=t;});
    var uni=!!(S.uni&&(Array.isArray(S.uni)?S.uni.length:(S.uni.spot||[]).length||(S.uni.perp||[]).length));
    var st=last&&T-last<120000?"connectee":uni?"degradee":last?"obsolete":"inactif";
    return {state:st,label:LBL[st],lastOk:last||null,hist:dkStatus("binhist"),
      msg:{connectee:"Flux OKX en direct",degradee:"Flux OKX interrompu : cotations REST (60 s)",obsolete:"Flux OKX arrêté",inactif:"Aucune cotation crypto reçue"}[st]};}};
function tvProvider(id,label,classes){return {id:id,label:label,classes:classes,
  getQuotes:function(list,o){return TV.getQuotes(list,o);},getHistory:function(i,o){return HIST.getHistory(i,o);},
  status:function(){return Object.assign({},dkStatus("tvscan2"),{hist:dkStatus("robotdata")});}};}

var PROV=dict(),ORDER=[],LAST=dict();
function register(p){if(!p||!p.id||typeof p.getQuotes!=="function")throw new Error("provider invalide");if(!PROV[p.id])ORDER.push(p.id);PROV[p.id]=p;return p;}
[CRYPTO,tvProvider("equity","Actions et ETF (TradingView)",["actions","immobilier_cote"]),tvProvider("index","Indices (TradingView)",["actions"]),
  tvProvider("commodity","Matières premières (TradingView)",["matieres_premieres","or","argent","energie","petrole","gaz","agricole"]),
  tvProvider("bond","Obligations et taux (TradingView)",["obligations","oblig_etat","oblig_entreprise"])].forEach(register);

var COMMO=dict({or:1,argent:1,energie:1,petrole:1,gaz:1,agricole:1,matieres_premieres:1});
var LISTED=dict({titre:1,etf:1,etc_etn:1,fonds:1});
/** Provider d'un instrument : data_source s'il est enregistré, puis la classe et le véhicule.
   Un produit coté (ETF, ETN…) sur la crypto avec un ticker TradingView passe par le scanner, pas par le flux OKX. */
function providerFor(i){
  if(!i)return null;var c=i.asset_class,v=i.vehicle,listedTv=!!(LISTED[v]&&tvTicker(i));
  if(i.data_source&&PROV[i.data_source]&&!(i.data_source==="crypto"&&listedTv))return PROV[i.data_source];
  var id=(c==="crypto"||c==="stablecoin")&&!listedTv?"crypto":v==="indice"?"index":v==="taux"||/^oblig/.test(c||"")?"bond":COMMO[c]?"commodity":"equity";
  return PROV[id]||PROV.equity||null;
}
/** Id ou instrument → instrument (référentiel, sinon "crypto:XXX" et "tv:BOURSE:SYMBOLE" sont reconnus). */
function resolve(x,quiet){
  if(!x)return null;if(typeof x==="object")return x.id?x:null;
  var id=String(x),r=CK.ref&&CK.ref.get?CK.ref.get(id):null;if(r)return r;
  if(/^crypto:[A-Za-z0-9]+$/.test(id))return M().normInstrument({id:id,symbol:id.slice(7),asset_class:"crypto",vehicle:"spot_crypto"});
  if(/^tv:[^:]+:.+$/i.test(id))return M().normInstrument({id:id,symbol:id.split(":").pop(),tickers:{tv:id.slice(3)}});
  if(!quiet)log("warn","mkt","instrument inconnu",{id:id});return null;
}
/** Instruments distincts ; out.alias = [[id demandé, id du référentiel]] quand un alias ("tv:…", "isin:…") a été résolu vers un autre id. */
function resolveAll(xs){var seen=dict(),out=[],alias=[];(Array.isArray(xs)?xs:[xs]).forEach(function(x){var i=resolve(x);if(!i)return;
  if(typeof x==="string"&&x!==i.id)alias.push([x,i.id]);if(!seen[i.id]){seen[i.id]=1;out.push(i);}});out.alias=alias;return out;}
/** Recopie chaque cotation sous l'id demandé : quotes(["tv:EURONEXT:CW8"]) donne bien m["tv:EURONEXT:CW8"]. */
function withAlias(m,alias){(alias||[]).forEach(function(a){if(m[a[1]])m[a[0]]=m[a[1]];});return m;}
function groups(list){var g=dict(),order=[];list.forEach(function(i){var p=providerFor(i);if(!p)return;if(!g[p.id]){g[p.id]={p:p,list:[]};order.push(p.id);}g[p.id].list.push(i);});return order.map(function(k){return g[k];});}
function staleLast(id,out){if(LAST[id])out[id]=Object.assign({},LAST[id],{stale:true});}

/** Cotations {id:Quote} ; un appel par provider ; ne rejette jamais (échec → dernières valeurs marquées stale, ou rien). */
function quotes(xs,opts){return new Promise(function(done){var out={},list=[];
  try{list=resolveAll(xs);Promise.all(groups(list).map(function(g){
      return call(function(){return g.p.getQuotes(g.list,opts);}).then(function(qs){var got={};
        (Array.isArray(qs)?qs:[]).forEach(function(q){if(q&&q.instrument_id){got[q.instrument_id]=1;LAST[q.instrument_id]=out[q.instrument_id]=q;}});
        g.list.forEach(function(i){if(!got[i.id])staleLast(i.id,out);});
      },function(e){log("warn",g.p.id,"cotations indisponibles : "+why(e),{n:g.list.length});g.list.forEach(function(i){staleLast(i.id,out);});});
    })).then(function(){done(withAlias(out,list.alias));},function(){done(withAlias(out,list.alias));});
  }catch(e){log("error","mkt","cotations : "+why(e));done(withAlias(out,list.alias));}});}

/** Historique PriceBar[] ; ne rejette jamais ([] + journal). */
function history(x,o){return new Promise(function(done){
  try{var i=resolve(x),p=i&&providerFor(i);
    if(!p||typeof p.getHistory!=="function"){log("warn","mkt","historique impossible : instrument ou provider inconnu",{id:i?i.id:String(x)});return done([]);}
    call(function(){return p.getHistory(i,o||{});}).then(function(b){done(Array.isArray(b)?b:[]);},
      function(e){log("warn",p.id,"historique indisponible : "+why(e),{id:i.id});done([]);});
  }catch(e){log("error","mkt","historique : "+why(e));done([]);}});}

/** Abonnement : cb({id:Quote}). Crypto : relecture de CK.S.tick toutes les 2 s ; autres : quotes() toutes les 60 s,
   seulement si l'onglet est visible (premier rafraîchissement immédiat). Renvoie la fonction de désabonnement. */
function subscribe(xs,cb){
  var stops=[],poll=[],alive=true,tid=null,list=[];
  var give=function(m){if(!alive||!m||!Object.keys(m).length)return;try{cb(withAlias(Object.assign({},m),list.alias));}catch(e){log("error","mkt","abonné : "+why(e));}};
  var stop=function(){if(!alive)return;alive=false;cancel(tid);tid=null;stops.forEach(function(s){try{s();}catch(e){}});stops=[];};
  try{list=resolveAll(xs);
    groups(list).forEach(function(g){
      if(typeof g.p.subscribe!=="function"){poll=poll.concat(g.list);return;}
      // un provider en erreur n'empêche pas les autres de s'abonner ; arrêté aussitôt si stop() a déjà eu lieu
      try{var s=g.p.subscribe(g.list,function(m){if(!alive)return;Object.keys(m||{}).forEach(function(k){LAST[k]=m[k];});give(m);});
        if(typeof s==="function"){if(alive)stops.push(s);else s();}}catch(e){log("error",g.p.id,"abonnement impossible : "+why(e));}});
    if(poll.length&&alive){var tick=function(){if(!alive)return;
        try{if(!hidden())quotes(poll,{priority:"low"}).then(give);}catch(e){log("error","mkt","rafraîchissement : "+why(e));}
        tid=later(tick,60000);};
      tick();}
  }catch(e){log("error","mkt","abonnement : "+why(e));}
  return stop;
}

/** Statut d'un provider (id de provider ou d'instrument) ; sans argument : {provider:statut}. */
function status(id){
  var st=function(p){try{return p.status();}catch(e){return {state:"inactif",label:LBL.inactif,msg:why(e)};}};
  if(id==null){var o={};ORDER.forEach(function(k){o[k]=st(PROV[k]);});return o;}
  var p=PROV[id]||providerFor(resolve(id,true));return p?st(p):{state:"inactif",label:LBL.inactif};
}

CK.mkt={
  register:register,providers:function(){return ORDER.map(function(k){return PROV[k];});},providerFor:providerFor,
  quotes:quotes,history:history,subscribe:subscribe,status:status,
  /** Résumé des historiques (resume.json) et taux (taux.json) publiés par le robot ; ne rejettent jamais (null). */
  resume:function(){try{return HIST.resume().then(null,function(){return null;});}catch(e){return Promise.resolve(null);}},
  taux:function(){try{return HIST.taux().then(null,function(){return null;});}catch(e){return Promise.resolve(null);}},
  last:function(id){if(LAST[id])return LAST[id];var i=resolve(id,true);return i&&LAST[i.id]||null;},
  TvScanAdapter:TvScanAdapter,RobotHistAdapter:RobotHistAdapter,
  adapters:function(){return {tv:TV,hist:HIST};},
  TV_URL:TV_URL,TV_COLS:TV_COLS.slice(),
  /** Pour les tests : oublie cotations, absences mémorisées et lot TradingView en cours. */
  _reset:function(){LAST=dict();TV=TvScanAdapter();HIST=RobotHistAdapter();},
  _t:{tvQuote:tvQuote,tvRow:tvRow,tvDelay:tvDelay,tvTicker:tvTicker,cryptoQuote:cryptoQuote,binHistory:binHistory,binSymbol:binSymbol,fileOf:fileOf,bound:bound,resample:resample}
};
})();
