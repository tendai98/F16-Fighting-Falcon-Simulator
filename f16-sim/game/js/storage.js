/* =====================================================================
   REPLAY STORAGE — IndexedDB metadata/data split, localStorage fallback
   ---------------------------------------------------------------------
   Scoreboard listing reads compact metadata only. Full replay payloads are
   loaded only when Watch is selected, which keeps the replay list fast and
   reduces memory pressure from large mission logs.
   ===================================================================== */
var ReplaySettings={
  get:function(k,d){try{var v=localStorage.getItem('f16_'+k);return v===null?d:v;}catch(e){return d;}},
  set:function(k,v){try{localStorage.setItem('f16_'+k,String(v));}catch(e){}},
  remove:function(k){try{localStorage.removeItem('f16_'+k);}catch(e){}}
};

var ReplayStore={
  dbName:'f16_strike_replays_v1', version:2,
  dataStore:'replay_data', metaStore:'replay_meta', legacyStore:'replays',
  _db:null, _ls:'f16_replays_fallback_v1',

  _open:function(){
    var self=this;
    if(this._db) return this._db;
    this._db=new Promise(function(res,rej){
      if(!window.indexedDB){rej(new Error('no indexedDB'));return;}
      var r=indexedDB.open(self.dbName,self.version);
      r.onupgradeneeded=function(){
        var db=r.result;
        var hadLegacy=db.objectStoreNames.contains(self.legacyStore);
        if(!db.objectStoreNames.contains(self.dataStore)) db.createObjectStore(self.dataStore,{keyPath:'id'});
        if(!db.objectStoreNames.contains(self.metaStore)){
          var m=db.createObjectStore(self.metaStore,{keyPath:'id'});
          m.createIndex('createdAt','createdAt',{unique:false});
          m.createIndex('score','score',{unique:false});
        }
        // Keep the legacy store if it already exists. Create it only for older
        // fallback code paths in browsers that have existing v1 data.
        if(!db.objectStoreNames.contains(self.legacyStore)) db.createObjectStore(self.legacyStore,{keyPath:'id'});
        // Upgrade v1 single-store records into compact metadata so the first
        // scoreboard open after this patch does not have to read full replay
        // payloads. The full legacy records remain available for ReplayStore.get.
        if(hadLegacy){
          try{
            var tx=r.transaction, legacy=tx.objectStore(self.legacyStore), meta=tx.objectStore(self.metaStore);
            legacy.openCursor().onsuccess=function(ev){
              var cur=ev.target.result; if(!cur) return;
              try{ meta.put(self._meta(cur.value)); }catch(e){}
              cur.continue();
            };
          }catch(e){}
        }
      };
      r.onsuccess=function(){res(r.result);};
      r.onerror=function(){rej(r.error||new Error('open failed'));};
    });
    return this._db;
  },

  _meta:function(r){
    return {
      id:r.id, createdAt:r.createdAt,
      alias:r.player&&r.player.alias||r.alias||'', country:r.player&&r.player.country||r.country||'',
      level:r.mission&&r.mission.level!==undefined?r.mission.level:r.level,
      difficultyName:r.mission&&r.mission.difficultyName||r.difficultyName||'',
      outcome:r.mission&&r.mission.outcome||r.outcome||'',
      score:r.score&&r.score.total!==undefined?r.score.total:(r.score||0),
      durationSec:r.mission&&r.mission.durationSec!==undefined?r.mission.durationSec:(r.durationSec||0),
      syncStatus:r.syncStatus||'local_pending',
      replayVersion:r.replay&&r.replay.version||r.replayVersion||0,
      snapshotCount:r.replay&&r.replay.snapshots?r.replay.snapshots.length:(r.snapshotCount||0),
      eventCount:r.replay&&r.replay.events?r.replay.events.length:(r.eventCount||0)
    };
  },

  _sort:function(a){
    return (a||[]).sort(function(x,y){return (y.score-x.score)||String(y.createdAt).localeCompare(String(x.createdAt));});
  },

  _readLS:function(){try{return JSON.parse(localStorage.getItem(this._ls)||'[]');}catch(e){return[];}},
  _writeLS:function(a){try{localStorage.setItem(this._ls,JSON.stringify(a.slice(-50)));return Promise.resolve(true);}catch(e){return Promise.reject(e);}},

  save:function(rec){
    var self=this;
    if(!rec) return Promise.reject(new Error('No replay record'));
    rec.id=rec.id||('replay_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
    rec.createdAt=rec.createdAt||new Date().toISOString();
    rec.syncStatus=rec.syncStatus||'local_pending';
    var meta=this._meta(rec);
    return this._open().then(function(db){
      return new Promise(function(res,rej){
        var tx=db.transaction([self.dataStore,self.metaStore],'readwrite');
        tx.objectStore(self.dataStore).put(rec);
        tx.objectStore(self.metaStore).put(meta);
        tx.oncomplete=function(){res(rec);};
        tx.onerror=function(){rej(tx.error||new Error('save failed'));};
        tx.onabort=function(){rej(tx.error||new Error('save aborted'));};
      });
    }).catch(function(){
      var a=self._readLS().filter(function(x){return x.id!==rec.id;});
      a.push(rec);
      return self._writeLS(a).then(function(){return rec;});
    });
  },

  list:function(){
    var self=this;
    return this._open().then(function(db){
      return new Promise(function(res,rej){
        var tx=db.transaction([self.metaStore,self.legacyStore],'readonly');
        var q=tx.objectStore(self.metaStore).getAll();
        q.onsuccess=function(){
          var list=q.result||[];
          if(list.length){ res(self._sort(list)); return; }
          // One-time compatibility path for records saved by the original v1
          // single-store implementation. This only runs when the compact meta
          // store is empty.
          var lq=tx.objectStore(self.legacyStore).getAll();
          lq.onsuccess=function(){ res(self._sort((lq.result||[]).map(function(r){return self._meta(r);}))); };
          lq.onerror=function(){ rej(lq.error); };
        };
        q.onerror=function(){rej(q.error);};
      });
    }).catch(function(){
      return self._sort(self._readLS().map(function(r){return self._meta(r);}));
    });
  },

  get:function(id){
    var self=this;
    return this._open().then(function(db){
      return new Promise(function(res,rej){
        var tx=db.transaction([self.dataStore,self.legacyStore],'readonly');
        var q=tx.objectStore(self.dataStore).get(id);
        q.onsuccess=function(){
          if(q.result){res(q.result);return;}
          var lq=tx.objectStore(self.legacyStore).get(id);
          lq.onsuccess=function(){res(lq.result||null);};
          lq.onerror=function(){rej(lq.error);};
        };
        q.onerror=function(){rej(q.error);};
      });
    }).catch(function(){return self._readLS().find(function(r){return r.id===id;})||null;});
  },

  delete:function(id){
    var self=this;
    return this._open().then(function(db){
      return new Promise(function(res,rej){
        var tx=db.transaction([self.dataStore,self.metaStore,self.legacyStore],'readwrite');
        tx.objectStore(self.dataStore).delete(id);
        tx.objectStore(self.metaStore).delete(id);
        tx.objectStore(self.legacyStore).delete(id);
        tx.oncomplete=function(){res(true);};
        tx.onerror=function(){rej(tx.error||new Error('delete failed'));};
      });
    }).catch(function(){return self._writeLS(self._readLS().filter(function(r){return r.id!==id;}));});
  },

  clear:function(){
    var self=this;
    return this._open().then(function(db){
      return new Promise(function(res,rej){
        var tx=db.transaction([self.dataStore,self.metaStore,self.legacyStore],'readwrite');
        tx.objectStore(self.dataStore).clear();
        tx.objectStore(self.metaStore).clear();
        tx.objectStore(self.legacyStore).clear();
        tx.oncomplete=function(){res(true);};
        tx.onerror=function(){rej(tx.error||new Error('clear failed'));};
      });
    }).catch(function(){return self._writeLS([]);});
  }
};

/* ---------------------------------------------------------------------
   API + HYBRID REPLAY STORE
   ---------------------------------------------------------------------
   LocalReplayStore keeps the existing IndexedDB behavior. ApiReplayStore
   talks to a clean JS backend. HybridReplayStore probes /api/health and
   uses the backend when available, with local fallback when offline.
   --------------------------------------------------------------------- */
var LocalReplayStore = ReplayStore;

function _rsClone(o){ try{return JSON.parse(JSON.stringify(o));}catch(e){return o;} }
function _rsBase(){
  var raw='';
  try{ raw = (window.F16_API_BASE_URL || '').trim(); }catch(e){}
  if(!raw){ try{ raw = (localStorage.getItem('f16_api_base_url') || '').trim(); }catch(e){} }
  if(raw && /^off$/i.test(raw)) return null;
  if(raw){ return raw.replace(/\/+$/,''); }
  try{
    if(location && /^https?:$/i.test(location.protocol)) return '';
  }catch(e){}
  return null;
}
function _rsFetchJson(url, opts, timeoutMs){
  opts = opts || {};
  timeoutMs = timeoutMs || 4500;
  if(typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
  var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var to = ctl ? setTimeout(function(){ try{ctl.abort();}catch(e){} }, timeoutMs) : null;
  opts.headers = Object.assign({'Accept':'application/json'}, opts.headers || {});
  if(opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type']='application/json';
  if(ctl) opts.signal = ctl.signal;
  opts.credentials = opts.credentials || 'omit';
  return fetch(url, opts).then(function(res){
    if(to) clearTimeout(to);
    return res.text().then(function(txt){
      var json = txt ? JSON.parse(txt) : {};
      if(!res.ok || json.ok === false) throw new Error(json.error || ('HTTP '+res.status));
      return json;
    });
  }).catch(function(err){ if(to) clearTimeout(to); throw err; });
}
function _rsMergeList(remote, local){
  var m={}, out=[];
  (remote||[]).forEach(function(r){ if(r && r.id){ r.syncStatus=r.syncStatus||'synced'; m[r.id]=1; out.push(r); } });
  (local||[]).forEach(function(r){ if(r && r.id && !m[r.id] && r.syncStatus !== 'synced') out.push(r); });
  return out.sort(function(a,b){ return (Number(b.score||0)-Number(a.score||0)) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')); });
}

var ApiReplayStore = {
  timeoutMs:5500,
  healthTimeoutMs:1800,
  _lastProbeAt:0,
  _online:null,
  _lastError:'',
  _probePromise:null,

  base:function(){ return _rsBase(); },
  enabled:function(){ return this.base() !== null && typeof fetch === 'function'; },
  url:function(path){ var b=this.base(); return b===null ? null : b + path; },

  health:function(){
    var u=this.url('/api/health');
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'GET' }, this.healthTimeoutMs).then(function(j){ return !!(j && j.ok); });
  },

  probe:function(force){
    var now = Date.now();
    if(!force && this._online !== null && now - this._lastProbeAt < 25000) return Promise.resolve(this._online);
    if(this._probePromise && !force) return this._probePromise;
    var self=this;
    if(!this.enabled()){
      this._online=false; this._lastProbeAt=now; this._lastError='backend disabled';
      return Promise.resolve(false);
    }
    this._probePromise=this.health().then(function(ok){
      self._online=!!ok; self._lastError=''; self._lastProbeAt=Date.now(); self._probePromise=null; return self._online;
    }).catch(function(err){
      self._online=false; self._lastError=(err&&err.message)||'backend unavailable'; self._lastProbeAt=Date.now(); self._probePromise=null; return false;
    });
    return this._probePromise;
  },

  status:function(){ return { online:!!this._online, checked:this._online!==null, base:this.base() || 'same-origin', error:this._lastError || '' }; },

  save:function(rec){
    var self=this, u=this.url('/api/replays');
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'POST', body:JSON.stringify(rec) }, Math.max(this.timeoutMs, 12000)).then(function(j){
      var saved = _rsClone(rec) || {};
      var summary = j.summary || {};
      saved.id = summary.id || j.id || saved.id;
      saved.createdAt = summary.createdAt || saved.createdAt || new Date().toISOString();
      saved.syncStatus = 'synced';
      if(summary.alias || summary.country) saved.player = { alias:summary.alias || (saved.player&&saved.player.alias)||'', country:summary.country || (saved.player&&saved.player.country)||'' };
      if(saved.mission){
        saved.mission.level = summary.level || saved.mission.level;
        saved.mission.difficultyName = summary.difficultyName || saved.mission.difficultyName;
        saved.mission.outcome = summary.outcome || saved.mission.outcome;
        saved.mission.durationSec = summary.durationSec || saved.mission.durationSec;
      }
      if(j.score) saved.score = j.score;
      self._online=true; self._lastError=''; self._lastProbeAt=Date.now();
      return saved;
    });
  },

  list:function(){
    var u=this.url('/api/replays');
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'GET' }, this.timeoutMs).then(function(j){ return Array.isArray(j) ? j : (j.replays || []); });
  },

  get:function(id){
    var u=this.url('/api/replays/'+encodeURIComponent(id));
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'GET' }, Math.max(this.timeoutMs, 12000)).then(function(j){ return j.record || j.replay || j; });
  }
};

var HybridReplayStore = {
  _syncing:false,
  probe:function(force){
    var self=this;
    return ApiReplayStore.probe(force).then(function(ok){ if(ok) self.syncPending(); return ok; });
  },
  status:function(){ return ApiReplayStore.status(); },

  save:function(rec){
    var self=this;
    return ApiReplayStore.probe(false).then(function(ok){
      if(!ok) throw new Error(ApiReplayStore._lastError || 'backend unavailable');
      return ApiReplayStore.save(rec).then(function(saved){
        return LocalReplayStore.save(saved).catch(function(){ return saved; });
      });
    }).catch(function(){
      rec = rec || {}; rec.syncStatus = rec.syncStatus || 'local_pending';
      return LocalReplayStore.save(rec);
    });
  },

  list:function(){
    return ApiReplayStore.probe(false).then(function(ok){
      if(!ok) throw new Error(ApiReplayStore._lastError || 'backend unavailable');
      return Promise.all([ApiReplayStore.list(), LocalReplayStore.list().catch(function(){return[];})]).then(function(pair){
        return _rsMergeList(pair[0], pair[1]);
      });
    }).catch(function(){ return LocalReplayStore.list(); });
  },

  get:function(id){
    return ApiReplayStore.probe(false).then(function(ok){
      if(!ok) throw new Error(ApiReplayStore._lastError || 'backend unavailable');
      return ApiReplayStore.get(id).then(function(rec){
        if(rec) return LocalReplayStore.save(rec).catch(function(){ return rec; });
        return rec;
      });
    }).catch(function(){ return LocalReplayStore.get(id); });
  },

  delete:function(id){ return LocalReplayStore.delete(id); },
  clear:function(){ return LocalReplayStore.clear(); },

  syncPending:function(){
    var self=this;
    if(this._syncing) return Promise.resolve(false);
    if(!ApiReplayStore._online) return Promise.resolve(false);
    this._syncing=true;
    return LocalReplayStore.list().then(function(list){
      var pending=(list||[]).filter(function(m){ return m && m.id && m.syncStatus !== 'synced'; }).slice(0,5);
      var chain=Promise.resolve();
      pending.forEach(function(meta){
        chain=chain.then(function(){
          return LocalReplayStore.get(meta.id).then(function(rec){
            if(!rec) return null;
            var oldId = rec.id;
            return ApiReplayStore.save(rec).then(function(saved){
              return LocalReplayStore.save(saved).then(function(){
                if(oldId && saved && saved.id && oldId !== saved.id) return LocalReplayStore.delete(oldId).catch(function(){return saved;}).then(function(){return saved;});
                return saved;
              });
            }).catch(function(){ return null; });
          });
        });
      });
      return chain;
    }).then(function(){ self._syncing=false; return true; }).catch(function(){ self._syncing=false; return false; });
  }
};

window.ReplaySettings=ReplaySettings;
window.LocalReplayStore=LocalReplayStore;
window.ApiReplayStore=ApiReplayStore;
window.HybridReplayStore=HybridReplayStore;
window.ReplayStore=HybridReplayStore;
try{ setTimeout(function(){ if(window.ReplayStore && ReplayStore.probe) ReplayStore.probe(true); }, 80); }catch(e){}
