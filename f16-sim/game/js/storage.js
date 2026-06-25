/* =====================================================================
   REPLAY STORAGE — backend-only replay source
   ---------------------------------------------------------------------
   The browser is not a replay database. It never stores full replay
   missions in IndexedDB/localStorage and never falls back to browser replay
   cache. The replay list comes from backend metadata only; a full replay is
   fetched only when the user selects WATCH. Failed uploads are retried only
   in memory while the current page remains open.
   ===================================================================== */
var ReplaySettings={
  get:function(k,d){try{var v=localStorage.getItem('f16_'+k);return v===null?d:v;}catch(e){return d;}},
  set:function(k,v){try{localStorage.setItem('f16_'+k,String(v));}catch(e){}},
  remove:function(k){try{localStorage.removeItem('f16_'+k);}catch(e){}}
};

function _rsClone(o){ try{return JSON.parse(JSON.stringify(o));}catch(e){return o;} }
function _rsBase(){
  var raw='';
  try{ raw = (window.F16_API_BASE_URL || '').trim(); }catch(e){}
  if(!raw){ try{ raw = (localStorage.getItem('f16_api_base_url') || '').trim(); }catch(e){} }
  if(raw && /^off$/i.test(raw)) return null;
  if(raw) return raw.replace(/\/+$/,'');
  try{ if(location && /^https?:$/i.test(location.protocol)) return ''; }catch(e){}
  return null;
}
function _rsFetchJson(url, opts, timeoutMs){
  opts = opts || {};
  timeoutMs = timeoutMs || 6500;
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
      var json = {};
      if(txt){ try{ json = JSON.parse(txt); }catch(e){ json = { ok:false, error:'Invalid backend response' }; } }
      if(!res.ok || json.ok === false){
        var err = new Error(json.error || ('HTTP '+res.status));
        err.status = res.status;
        err.response = json;
        throw err;
      }
      return json;
    });
  }).catch(function(err){ if(to) clearTimeout(to); throw err; });
}
function _rsMetaFromRecord(r){
  r = r || {};
  return {
    id:r.id,
    createdAt:r.createdAt || '',
    alias:r.player&&r.player.alias||r.alias||'',
    country:r.player&&r.player.country||r.country||'',
    level:r.mission&&r.mission.level!==undefined?r.mission.level:r.level,
    difficultyName:r.mission&&r.mission.difficultyName||r.difficultyName||'',
    outcome:r.mission&&r.mission.outcome||r.outcome||'',
    score:r.score&&r.score.total!==undefined?r.score.total:(r.score||0),
    durationSec:r.mission&&r.mission.durationSec!==undefined?r.mission.durationSec:(r.durationSec||0),
    replayVersion:r.replay&&r.replay.version||r.replayVersion||0,
    snapshotCount:r.replay&&r.replay.snapshots?r.replay.snapshots.length:(r.snapshotCount||0),
    eventCount:r.replay&&r.replay.events?r.replay.events.length:(r.eventCount||0),
    syncStatus:r.syncStatus || 'uploading'
  };
}
function _rsCleanupLegacyBrowserReplayCache(){
  try{ localStorage.removeItem('f16_replays_fallback_v1'); }catch(e){}
  try{ localStorage.removeItem('f16_replays_v1'); }catch(e){}
  try{ localStorage.removeItem('f16_replay_cache'); }catch(e){}
  try{
    if(window.indexedDB && indexedDB.deleteDatabase){
      indexedDB.deleteDatabase('f16_strike_replays_v1');
    }
  }catch(e){}
}

var ApiReplayStore = {
  timeoutMs:6500,
  uploadTimeoutMs:16000,
  healthTimeoutMs:2200,
  _lastProbeAt:0,
  _online:null,
  _lastError:'',
  _probePromise:null,
  _pending:[],
  _syncing:false,
  _retryTimer:null,

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
      self._online=!!ok; self._lastError=''; self._lastProbeAt=Date.now(); self._probePromise=null;
      if(self._online) self._scheduleRetry(250);
      return self._online;
    }).catch(function(err){
      self._online=false; self._lastError=(err&&err.message)||'backend unavailable'; self._lastProbeAt=Date.now(); self._probePromise=null; return false;
    });
    return this._probePromise;
  },

  status:function(){ return { online:!!this._online, checked:this._online!==null, base:this.base() || 'same-origin', error:this._lastError || '', pending:this._pending.length }; },

  _prepareRecord:function(rec){
    if(!rec) throw new Error('No replay record');
    rec.id=rec.id||('client_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
    rec.createdAt=rec.createdAt||new Date().toISOString();
    return rec;
  },

  _upload:function(rec){
    var self=this, u=this.url('/api/replays');
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'POST', body:JSON.stringify(rec) }, this.uploadTimeoutMs).then(function(j){
      var summary = j.summary || {};
      var saved = {
        id: summary.id || j.id || rec.id,
        createdAt: summary.createdAt || rec.createdAt || new Date().toISOString(),
        player: {
          alias: summary.alias || (rec.player&&rec.player.alias) || '',
          country: summary.country || (rec.player&&rec.player.country) || ''
        },
        mission: {
          level: summary.level || (rec.mission&&rec.mission.level) || 1,
          difficultyName: summary.difficultyName || (rec.mission&&rec.mission.difficultyName) || '',
          outcome: summary.outcome || (rec.mission&&rec.mission.outcome) || '',
          durationSec: summary.durationSec || (rec.mission&&rec.mission.durationSec) || 0
        },
        score: j.score || rec.score || { total:summary.score || 0, breakdown:{} },
        syncStatus: 'synced'
      };
      // Intentionally do not return or retain saved.replay here. Full replay
      // payloads are fetched from the backend only when WATCH is selected.
      self._online=true; self._lastError=''; self._lastProbeAt=Date.now();
      return saved;
    });
  },

  _queuePending:function(rec, err){
    var id = rec && rec.id;
    if(!id) return;
    for(var i=0;i<this._pending.length;i++){
      if(this._pending[i].record && this._pending[i].record.id === id){
        this._pending[i].error = err && err.message || String(err || 'upload failed');
        this._pending[i].tries += 1;
        this._pending[i].nextAt = Date.now() + Math.min(60000, 5000 * this._pending[i].tries);
        this._scheduleRetry(this._pending[i].nextAt - Date.now());
        return;
      }
    }
    this._pending.push({ record:rec, tries:1, error:err && err.message || String(err || 'upload failed'), nextAt:Date.now()+5000 });
    this._scheduleRetry(5000);
  },

  _scheduleRetry:function(delay){
    var self=this;
    if(this._retryTimer) return;
    this._retryTimer=setTimeout(function(){ self._retryTimer=null; self.syncPending(); }, Math.max(250, delay||250));
  },

  syncPending:function(){
    var self=this;
    if(this._syncing || !this._pending.length) return Promise.resolve(false);
    if(!this.enabled()) return Promise.resolve(false);
    this._syncing=true;
    return this.probe(true).then(function(ok){
      if(!ok) throw new Error(self._lastError || 'backend unavailable');
      var now=Date.now();
      var ready=self._pending.filter(function(p){ return !p.nextAt || p.nextAt <= now; }).slice(0,3);
      var chain=Promise.resolve();
      ready.forEach(function(p){
        chain=chain.then(function(){
          return self._upload(p.record).then(function(){
            self._pending=self._pending.filter(function(x){ return x !== p; });
          }).catch(function(err){
            p.tries += 1;
            p.error = err && err.message || String(err || 'upload failed');
            p.nextAt = Date.now() + Math.min(60000, 5000 * p.tries);
          });
        });
      });
      return chain;
    }).catch(function(err){
      self._lastError=err&&err.message || 'backend unavailable';
    }).then(function(){
      self._syncing=false;
      if(self._pending.length){
        var next=self._pending.reduce(function(a,p){ return Math.min(a, p.nextAt || Date.now()+5000); }, Date.now()+15000);
        self._scheduleRetry(Math.max(1000, next-Date.now()));
      }
      return true;
    });
  },

  save:function(rec){
    var self=this;
    try{ rec=this._prepareRecord(rec); }catch(e){ return Promise.reject(e); }
    return this.probe(true).then(function(ok){
      if(!ok) throw new Error(self._lastError || 'backend unavailable');
      return self._upload(rec);
    }).catch(function(err){
      self._lastError=err && err.message || 'upload failed';
      self._queuePending(rec, err);
      var e = new Error('Replay upload failed; retrying in memory while this page remains open. '+self._lastError);
      e.cause = err;
      throw e;
    });
  },

  list:function(){
    var self=this, u=this.url('/api/replays');
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'GET' }, this.timeoutMs).then(function(j){
      self._online=true; self._lastError=''; self._lastProbeAt=Date.now();
      var list = Array.isArray(j) ? j : (j.replays || []);
      return (list||[]).filter(function(r){ return r && r.id; });
    });
  },

  get:function(id){
    var self=this, u=this.url('/api/replays/'+encodeURIComponent(id));
    if(!u && u !== '') return Promise.reject(new Error('backend disabled'));
    return _rsFetchJson(u, { method:'GET' }, Math.max(this.timeoutMs, 16000)).then(function(j){
      self._online=true; self._lastError=''; self._lastProbeAt=Date.now();
      return j.record || j.replay || null;
    }).catch(function(err){
      if(err && err.status === 404) return null;
      throw err;
    });
  },

  delete:function(){ return Promise.reject(new Error('Replay deletion is backend-admin only')); },
  clear:function(){ return Promise.reject(new Error('Replay clearing is backend-admin only')); }
};

var ReplayStore = ApiReplayStore;
var LocalReplayStore = null;
var HybridReplayStore = null;

window.ReplaySettings=ReplaySettings;
window.ApiReplayStore=ApiReplayStore;
window.ReplayStore=ReplayStore;
window.LocalReplayStore=LocalReplayStore;
window.HybridReplayStore=HybridReplayStore;
try{
  _rsCleanupLegacyBrowserReplayCache();
  setTimeout(function(){ if(window.ReplayStore && ReplayStore.probe) ReplayStore.probe(true); }, 80);
  setInterval(function(){ if(window.ReplayStore && ReplayStore.probe) ReplayStore.probe(true); }, 60000);
}catch(e){}
