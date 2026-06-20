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
window.ReplaySettings=ReplaySettings; window.ReplayStore=ReplayStore;
