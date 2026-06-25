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
function _rsLogLevelValue(level){
  var map = { silent:0, error:1, warn:2, info:3, debug:4 };
  var key = String(level || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : map.error;
}
function _rsClientLogLevel(){
  try{
    var forced = (window.F16_CLIENT_LOG_LEVEL || '').toString().trim().toLowerCase();
    if(forced) return forced;
  }catch(e){}
  try{
    var stored = (localStorage.getItem('f16_client_log_level') || '').trim().toLowerCase();
    if(stored) return stored;
  }catch(e){}
  try{
    if(window.F16_REPLAY_DEBUG_LOGS === true) return 'info';
  }catch(e){}
  try{
    var debug = (localStorage.getItem('f16_replay_debug_logs') || '').trim();
    if(/^(1|true|yes|on)$/i.test(debug)) return 'info';
  }catch(e){}
  return 'error';
}
function _rsLog(level, msg, data){
  try{
    if(_rsLogLevelValue(_rsClientLogLevel()) < _rsLogLevelValue(level)) return;
    var c = window.console;
    if(c && c[level]) c[level](msg, data || '');
  }catch(e){}
}
function _rsBodyLength(body){
  if(!body) return 0;
  if(typeof body === 'string') return body.length;
  if(typeof Blob !== 'undefined' && body instanceof Blob) return body.size || 0;
  if(typeof body.byteLength === 'number') return body.byteLength;
  if(typeof body.length === 'number') return body.length;
  try{ return JSON.stringify(body).length; }catch(e){ return 0; }
}
function _rsUtf8Length(s){
  try{ if(typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s || '')).length; }catch(e){}
  return String(s || '').length;
}
function _rsGzipJsonBody(json){
  if(typeof CompressionStream === 'undefined' || typeof Blob === 'undefined' || typeof Response === 'undefined') return Promise.resolve(null);
  try{
    var stream = new Blob([json], { type:'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob().then(function(blob){
      if(!blob || !blob.size) return null;
      return {
        body: blob,
        encoding: 'gzip-json',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-F16-Replay-Encoding': 'gzip-json',
          'X-F16-Replay-JSON-Bytes': String(_rsUtf8Length(json)),
          'X-F16-Replay-Gzip-Bytes': String(blob.size)
        }
      };
    }).catch(function(err){
      _rsLog('warn', '[f16-replay] browser gzip failed; falling back to JSON upload', _rsDescribeError(err));
      return null;
    });
  }catch(err){
    _rsLog('warn', '[f16-replay] browser gzip unavailable; falling back to JSON upload', _rsDescribeError(err));
    return Promise.resolve(null);
  }
}
function _rsBuildReplayUpload(json){
  return _rsGzipJsonBody(json).then(function(gzip){
    if(gzip) return gzip;
    return {
      body: json,
      encoding: 'json',
      headers: {
        'Content-Type': 'application/json',
        'X-F16-Replay-Encoding': 'json',
        'X-F16-Replay-JSON-Bytes': String(_rsUtf8Length(json))
      }
    };
  });
}
function _rsDescribeError(err){
  err = err || {};
  return {
    name: err.name || '',
    message: err.message || String(err || 'error'),
    status: err.status || 0,
    statusText: err.statusText || '',
    requestId: err.requestId || (err.response && err.response.requestId) || '',
    stage: err.stage || (err.response && err.response.stage) || '',
    response: err.response || null,
    responseText: err.responseText || '',
    request: err.request || null
  };
}
function _rsDescribeRecord(rec){
  rec = rec || {};
  var replay = rec.replay || {};
  var snapshots = Array.isArray(replay.snapshots) ? replay.snapshots : [];
  var events = Array.isArray(replay.events) ? replay.events : [];
  var mission = rec.mission || {};
  var player = rec.player || {};
  var first = snapshots[0] || {};
  var last = snapshots[snapshots.length-1] || {};
  return {
    id: rec.id || '',
    createdAt: rec.createdAt || '',
    alias: player.alias || '',
    country: player.country || '',
    level: mission.level,
    difficultyName: mission.difficultyName || '',
    outcome: mission.outcome || '',
    durationSec: mission.durationSec,
    replayVersion: replay.version,
    tickRate: replay.tickRate,
    snapshotCount: snapshots.length,
    eventCount: events.length,
    firstSnapshotT: first.t,
    lastSnapshotT: last.t
  };
}
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
  var didTimeout = false;
  var method = String(opts.method || 'GET').toUpperCase();
  var to = ctl ? setTimeout(function(){ didTimeout = true; try{ctl.abort();}catch(e){} }, timeoutMs) : null;
  opts.headers = Object.assign({'Accept':'application/json'}, opts.headers || {});
  if(opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type']='application/json';
  if(ctl) opts.signal = ctl.signal;
  opts.credentials = opts.credentials || 'omit';
  return fetch(url, opts).then(function(res){
    if(to) clearTimeout(to);
    return res.text().then(function(txt){
      var requestId = '';
      try{ requestId = res.headers && res.headers.get ? (res.headers.get('x-request-id') || '') : ''; }catch(e){}
      var json = {};
      if(txt){ try{ json = JSON.parse(txt); }catch(e){ json = { ok:false, error:'Invalid backend response' }; } }
      if(!res.ok || json.ok === false){
        var err = new Error(json.error || ('HTTP '+res.status));
        err.status = res.status;
        err.statusText = res.statusText || '';
        err.requestId = requestId || json.requestId || '';
        err.response = json;
        err.responseText = txt ? txt.slice(0, 2000) : '';
        err.request = { method:method, url:url, timeoutMs:timeoutMs, bodyBytes:_rsBodyLength(opts.body) };
        _rsLog('error', '[f16-replay] API request failed', _rsDescribeError(err));
        throw err;
      }
      return json;
    });
  }).catch(function(err){
    if(to) clearTimeout(to);
    if(didTimeout && err && err.name === 'AbortError') err.message = 'Request timed out after '+timeoutMs+'ms';
    if(err && !err.request) err.request = { method:method, url:url, timeoutMs:timeoutMs, bodyBytes:_rsBodyLength(opts.body) };
    if(!err || !err.response) _rsLog('error', '[f16-replay] API/network request failed', _rsDescribeError(err));
    throw err;
  });
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
  uploadTimeoutMs:120000,
  healthTimeoutMs:8000,
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
      self._online=false; self._lastError=(err&&err.message)||'backend unavailable'; self._lastProbeAt=Date.now(); self._probePromise=null;
      if(force) _rsLog('warn', '[f16-replay] backend health probe failed', { base:self.base() || 'same-origin', error:_rsDescribeError(err) });
      return false;
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
    var body;
    try{ body = JSON.stringify(rec); }
    catch(stringifyErr){
      _rsLog('error', '[f16-replay] replay upload JSON serialization failed', { replay:_rsDescribeRecord(rec), error:_rsDescribeError(stringifyErr) });
      return Promise.reject(stringifyErr);
    }

    return _rsBuildReplayUpload(body).then(function(upload){
      _rsLog('info', '[f16-replay] replay upload start', {
        url:u || '/api/replays',
        timeoutMs:self.uploadTimeoutMs,
        encoding:upload.encoding,
        uploadBytes:_rsBodyLength(upload.body),
        jsonBytes:_rsUtf8Length(body),
        replay:_rsDescribeRecord(rec)
      });

      return _rsFetchJson(u, { method:'POST', body:upload.body, headers:upload.headers }, self.uploadTimeoutMs);
    }).then(function(j){
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
      _rsLog('info', '[f16-replay] replay upload succeeded', {
        requestId:j.requestId || '',
        id:saved.id,
        score:saved.score && saved.score.total !== undefined ? saved.score.total : saved.score,
        storage:j.storage || null,
        replay:_rsDescribeRecord(rec)
      });
      return saved;
    }).catch(function(err){
      _rsLog('error', '[f16-replay] replay upload failed', {
        replay:_rsDescribeRecord(rec),
        error:_rsDescribeError(err)
      });
      throw err;
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
            _rsLog('info', '[f16-replay] pending replay upload succeeded', { id:p.record && p.record.id, tries:p.tries });
            self._pending=self._pending.filter(function(x){ return x !== p; });
          }).catch(function(err){
            p.tries += 1;
            p.error = err && err.message || String(err || 'upload failed');
            p.nextAt = Date.now() + Math.min(60000, 5000 * p.tries);
            _rsLog('warn', '[f16-replay] pending replay upload retry failed', { id:p.record && p.record.id, tries:p.tries, nextAt:p.nextAt, error:_rsDescribeError(err) });
          });
        });
      });
      return chain;
    }).catch(function(err){
      self._lastError=err&&err.message || 'backend unavailable';
      _rsLog('warn', '[f16-replay] pending replay sync blocked', { pending:self._pending.length, error:_rsDescribeError(err) });
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
      _rsLog('error', '[f16-replay] replay save failed and was queued for retry', {
        pending:self._pending.length,
        replay:_rsDescribeRecord(rec),
        error:_rsDescribeError(err)
      });
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

window.F16Log=_rsLog;
window.F16DescribeReplayError=_rsDescribeError;
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
