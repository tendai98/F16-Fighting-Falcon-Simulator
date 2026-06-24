/* =====================================================================
   REPLAY RECORDER + INTERPOLATED PLAYBACK
   ---------------------------------------------------------------------
   Records authoritative world snapshots plus exact cockpit/action events.
   Playback renders from recorded state, interpolates movement, restores MFD
   and cockpit selections, and replays the same one-shot/continuous audio cues.
   ===================================================================== */
function _rr(v,p){p=p==null?2:p;var m=Math.pow(10,p);return Math.round((Number(v)||0)*m)/m;}
function _jc(o){return JSON.parse(JSON.stringify(o));}
function _uid(p){return p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
function _id(o,p){if(!o)return null;if(!o.id)o.id=_uid(p||'ent');return o.id;}
function _v(p){return p?{x:_rr(p.x,1),y:_rr(p.y,1),z:_rr(p.z,1)}:null;}
function _difficultyName(i){return(typeof DIFFS!=='undefined'&&DIFFS[i])?DIFFS[i].name:'';}
function _truthyLive(o){return o && o.live!==false && o.hp!==0 && !o.destroyed;}

var ReplayUtils={
  _visual:function(o, types){
    if(!o) return o;
    if(typeof ensureTgpVisuals==='function'){
      try{ ensureTgpVisuals(o, types); }catch(e){}
    }
    return o;
  },

  ensureIds:function(){
    if(!world || !world.ac) return;
    _id(world.ac,'player'); world.ac.id='player';
    if(world.target){
      _id(world.target,'target');
      (world.target.buildings||[]).forEach(function(b){ _id(b,'building'); ReplayUtils._visual(b,['bunker','fuel','radar']); });
    }
    (world.bandits||[]).forEach(function(o){ _id(o,'bandit'); });
    (world.groundMovers||[]).forEach(function(o){ _id(o,'mover'); ReplayUtils._visual(o, o.kind==='TEL'?['sam','radar']:['truck','tank','fuel']); });
    (world.hvts||[]).forEach(function(o){ _id(o,'hvt'); ReplayUtils._visual(o,['radar','bunker','fuel']); });
    (world.friendlies||[]).forEach(function(o){ _id(o,'friendly'); });
    (world.structures||[]).forEach(function(o){ _id(o,'structure'); ReplayUtils._visual(o,['bunker']); });
    (world.threats||[]).forEach(function(o){ _id(o,'threat'); if(!o.mobile && !o.structure) ReplayUtils._visual(o,['sam','radar']); });
    (world.bombs||[]).forEach(function(o){ _id(o,'bomb'); });
    (world.sams||[]).forEach(function(o){ _id(o,'missile'); });
    (world.bullets||[]).forEach(function(o){ _id(o,'bullet'); });
    (world.decoys||[]).forEach(function(o){ _id(o,'decoy'); });
    (world.effects||[]).forEach(function(o){ _id(o,'effect'); });
  },

  entityRef:function(o,p){ return o ? _id(o,p||'ent') : null; },

  findEntity:function(id){
    if(!id) return null;
    if(world.ac && world.ac.id===id) return world.ac;
    if(world.target){
      if(world.target.id===id) return world.target;
      var bs=world.target.buildings||[];
      for(var b=0;b<bs.length;b++) if(bs[b].id===id) return bs[b];
    }
    var lists=['bandits','groundMovers','hvts','friendlies','structures','threats','bombs','sams','effects'];
    for(var i=0;i<lists.length;i++){
      var arr=world[lists[i]]||[];
      for(var j=0;j<arr.length;j++) if(arr[j] && arr[j].id===id) return arr[j];
    }
    return null;
  },

  cockpit:function(){
    this.ensureIds();
    var mfds={};
    if(typeof MFDS!=='undefined'){
      for(var id in MFDS){
        var m=MFDS[id]; if(!m) continue;
        mfds[id]={
          page:m.page||'DED', range:_rr(m.range||20,1), azScan:_rr(m.azScan||60,1),
          sweep:_rr(m.sweep||0,2), sweepDir:m.sweepDir||1, fcrMode:m.fcrMode||'RWS',
          tgpFov:m.tgpFov||'WIDE', tgpZoom:m.tgpZoom||2, tgpTrack:m.tgpTrack||'AREA',
          tgpPol:m.tgpPol||'WHOT', laser:!!m.laser, dlRange:m.dlRange||80,
          lantRange:m.lantRange||10, lantFov:m.lantFov||'WIDE',
          lockedId:m.locked ? _id(m.locked,'lock') : null
        };
      }
    }
    var st=(world.stations||[]).map(function(s){return{id:s.id,qty:s.qty||0,sel:!!s.sel,wpn:s.wpn||'',kind:s.kind||''};});
    return{
      activeMfdId:world.activeMfdId||'center',
      steerpoint:world.steerpoint||1,
      masterArm:world.masterArm||'SAFE', masterMode:world.masterMode||'NAV',
      selectedStation:world.selectedStation||5, stations:st,
      designated:!!world.designated, tgpLaser:!!world.tgpLaser,
      lantirnOn:!!world.lantirnOn, lantirnMode:world.lantirnMode||'OFF',
      dlEntry:world.dlEntry||'', datalinkTuned:world.datalinkTuned||'',
      dedPage:(typeof DED_PAGE!=='undefined')?DED_PAGE:'CNI',
      ecm:{ on:!!(world.ecm&&world.ecm.on), cursor:world.ecm&&world.ecm.cursor||50, jam:_jc(world.ecm&&world.ecm.jam||[]) },
      locks:{
        gnd:this.entityRef(world.gndLock,'gnd'),
        air:this.entityRef(world.airLock,'air'),
        harm:this.entityRef(world.harmLock,'harm')
      },
      mfds:mfds
    };
  },

  snap:function(opts){
    opts = opts || {};
    this.ensureIds();
    var ac=world.ac;
    var out={
      t:_rr(world.t,3), outcome:world.outcome||null, outcomeReason:world.outcomeReason||'',
      ac:{ id:'player', x:_rr(ac.pos.x,1), y:_rr(ac.pos.y,1), z:_rr(ac.pos.z,1),
        psi:_rr(ac.psi,4), theta:_rr(ac.theta,4), phi:_rr(ac.phi,4), gamma:_rr(ac.gamma||0,4),
        tas:_rr(ac.tas,1), throttle:_rr(ac.throttle,3), gear:!!ac.gear, onGround:!!ac.onGround,
        g:_rr(ac.g||1,2), aoa:_rr(ac.aoa||0,1), vy:_rr(ac.vy||0,1),
        integrity:_rr(ac.integrity||0,1), flares:ac.flares|0, chaff:(ac.chaff||0)|0 },
      sel:{steerpoint:world.steerpoint,masterArm:world.masterArm,masterMode:world.masterMode,selectedStation:world.selectedStation,ecmOn:!!(world.ecm&&world.ecm.on),tgpLaser:!!world.tgpLaser},
      target:(opts.staticState===false?undefined:this.target()),
      bandits:world.bandits.map(this.air), groundMovers:world.groundMovers.map(this.mover),
      hvts:(opts.staticState===false?undefined:world.hvts.map(this.ground)), friendlies:(opts.staticState===false?undefined:world.friendlies.map(this.ground)), structures:(opts.staticState===false?undefined:world.structures.map(this.ground)), threats:(opts.staticState===false?undefined:world.threats.map(this.threat)),
      bombs:world.bombs.map(this.bomb), sams:world.sams.map(this.missile), bullets:(world.bullets||[]).map(this.bullet), decoys:(world.decoys||[]).map(this.decoy), effects:world.effects.map(this.effect)
    };
    if(opts.cockpit) out.cockpit=this.cockpit();
    return this.compactSnapshot(out, !!opts.keepVisuals);
  },

  initial:function(){
    this.ensureIds();
    return{
      terrainOff:(typeof TERRAIN_OFF!=='undefined')?_jc(TERRAIN_OFF):null,
      terrainFeatures:(typeof TERRAIN_FEATURES!=='undefined')?_jc(TERRAIN_FEATURES):null,
      flatSites:(typeof FLAT_SITES!=='undefined')?_jc(FLAT_SITES):null,
      runway:_jc(world.runway), waypoints:_jc(world.waypoints), bullseye:_jc(world.bullseye),
      airstrips:_jc(world.airstrips||[]), infrastructure:_jc(world.infrastructure||{}),
      stations:_jc(world.stations), difficulty:world.difficulty, difficultyName:_difficultyName(world.difficulty),
      missionSeed:world._missionSeed||0, cockpit:this.cockpit(), snapshot:this.snap({cockpit:true,keepVisuals:true})
    };
  },

  compactSnapshot:function(s, keepVisuals){
    // Replay files get large mainly from repeating static TGP geometry and
    // long projectile trails in every 10 Hz snapshot. Keep full visuals in
    // the initial/key snapshots and hydrate later snapshots from a playback
    // visual cache. Moving interpolation still has authoritative positions.
    function stripVisual(o){ if(!o || keepVisuals) return; delete o.geom; delete o._cluster; }
    function stripList(a){ (a||[]).forEach(stripVisual); }
    function trimProjectile(o){ if(!o) return; if(o.trail && o.trail.length>6) o.trail=o.trail.slice(-6); }
    if(s){
      if(s.target && s.target.buildings) stripList(s.target.buildings);
      stripList(s.groundMovers); stripList(s.hvts); stripList(s.friendlies); stripList(s.structures); stripList(s.threats);
      (s.bombs||[]).forEach(trimProjectile); (s.sams||[]).forEach(trimProjectile); (s.bullets||[]).forEach(trimProjectile);
    }
    return s;
  },

  target:function(){return world.target?{id:_id(world.target,'target'),x:_rr(world.target.x,1),y:_rr(world.target.y,1),destroyed:!!world.target.destroyed,buildings:(world.target.buildings||[]).map(this.ground)}:null;},
  air:function(b){return{id:_id(b,'bandit'),x:_rr(b.x,1),y:_rr(b.y,1),alt:_rr(b.alt,1),psi:_rr(b.psi||0,4),spd:_rr(b.spd||0,1),hp:_rr(b.hp||0,2),kind:b.kind||'',name:b.name||'',ai:b.aiState||'',live:_truthyLive(b)};},
  mover:function(m){return{id:_id(m,'mover'),x:_rr(m.x,1),y:_rr(m.y,1),psi:_rr(m.psi||0,4),spd:_rr(m.spd||0,1),hp:_rr(m.hp||0,1),kind:m.kind||'',name:m.name||'',destroyed:!!m.destroyed,live:m.live!==false,underground:!!m.underground,mobile:!!m.mobile,emits:!!m.emits,radius:m.radius||0,color:m.color||'',geom:m.geom?_jc(m.geom):null,_cluster:m._cluster?_jc(m._cluster):undefined};},
  ground:function(o){return{id:_id(o,'ground'),x:_rr(o.x,1),y:_rr(o.y,1),hp:_rr(o.hp||0,1),kind:o.kind||'',name:o.name||o.label||'',destroyed:!!o.destroyed,live:o.live!==false,alive:o.alive!==false,tracking:!!o.tracking,radius:o.radius||0,color:o.color||'',geom:o.geom?_jc(o.geom):null,_cluster:o._cluster?_jc(o._cluster):undefined,primary:!!o.primary,w:o.w,l:o.l,h:o.h,label:o.label||'',structure:!!o.structure,mobile:!!o.mobile,tag:o.tag||'',type:o.type||'',freq:o.freq||''};},
  threat:function(o){var g=ReplayUtils.ground(o);g.name=o.name||g.name;g.hostile=o.hostile!==false;g.bands=o.bands?_jc(o.bands):undefined;g.launchT=o.launchT;return g;},
  bomb:function(b){return{id:_id(b,'bomb'),pos:_v(b.pos),vel:_v(b.vel),trail:(b.trail||[]).slice(-6).map(_v),origin:_v(b.origin),live:b.live!==false,t:_rr(b.t||0,2),guided:!!b.guided,target:_v(b.target),weapon:b.weapon||'MK-82'};},
  missile:function(m){return{id:_id(m,'missile'),team:m.team||'',kind:m.kind||'',weapon:m.weapon||m.kind||'',seeker:m.seeker||'',pos:_v(m.pos),vel:_v(m.vel),trail:(m.trail||[]).slice(-6).map(_v),spd:_rr(m.spd||0,1),t:_rr(m.t||0,2),life:_rr(m.life||0,1),energy:_rr(m.energy==null?1:m.energy,3),color:m.color||'',live:m.live!==false,groundPos:_v(m.groundPos),origin:_v(m.origin),name:m.name||'',emitterId:m.emitter?_id(m.emitter,'emitter'):null,targetId:m.tgt?_id(m.tgt,'target'):null};},
  bullet:function(b){return{id:_id(b,'bullet'),team:b.team||'BLUE',pos:_v(b.pos),prev:_v(b.prev),vel:_v(b.vel),t:_rr(b.t||0,2),life:_rr(b.life||0,2),damage:_rr(b.damage||0,3),trail:(b.trail||[]).slice(-4).map(_v)};},
  decoy:function(d){return{id:_id(d,'decoy'),team:d.team||'',kind:d.kind||'flare',pos:_v(d.pos),vel:_v(d.vel),t:_rr(d.t||0,2),life:_rr(d.life||0,2)};},
  effect:function(e){return{id:_id(e,'effect'),pos:_v(e.pos),t:_rr(e.t||0,2),dur:_rr(e.dur||0,2),kind:e.kind||'blast'};}
};

var ReplayRecorder={
  active:false, tickRate:10, snapshots:[], events:[], initialState:null, nextT:0, lastCockpitSnapT:-999, lastStaticSnapT:-999, forceStaticNext:false,
  start:function(){
    this.active=true; this.snapshots=[]; this.events=[]; this.initialState=ReplayUtils.initial(); this.nextT=0; this.lastCockpitSnapT=-999; this.lastStaticSnapT=-999; this.forceStaticNext=false;
    this.recordSnapshot(true);
  },
  update:function(){ if(this.active && world.t>=this.nextT) this.recordSnapshot(false); },
  recordSnapshot:function(force){
    if(!this.active && !force) return;
    var now = world && typeof world.t==='number' ? world.t : 0;
    var first = !this.snapshots.length;
    var includeCockpit = first || !!force || (now - this.lastCockpitSnapT >= 2.0);
    var includeStatic = first || !!force || this.forceStaticNext || (now - this.lastStaticSnapT >= 0.5);
    var s=ReplayUtils.snap({cockpit:includeCockpit, staticState:includeStatic, keepVisuals:first});
    if(includeCockpit) this.lastCockpitSnapT=s.t||now;
    if(includeStatic){ this.lastStaticSnapT=s.t||now; this.forceStaticNext=false; }
    var last=this.snapshots[this.snapshots.length-1];
    if(last && Math.abs((last.t||0)-s.t)<0.0005) this.snapshots[this.snapshots.length-1]=s;
    else this.snapshots.push(s);
    this.nextT=s.t+1/this.tickRate;
  },
  recordEvent:function(type,data){
    if(!this.active) return;
    var d; try{ d=_jc(data||{}); }catch(e){ d={}; }
    var ev={ t:_rr(world.t,3), type:type, data:d, cockpit:ReplayUtils.cockpit() };
    this.events.push(ev);
    if(/kill|destroyed|impact|mission_end/.test(String(type||''))) this.forceStaticNext=true;
    // Do not force a full world snapshot for every cockpit/action event. The
    // event carries its cockpit state and playback overlays it until the next
    // authoritative snapshot, keeping replay fidelity without exploding file size.
  },
  recordCockpitAction:function(action,data){
    data=data||{}; data.action=action||'cockpit'; this.recordEvent('cockpit_action', data);
  },
  stop:function(meta){
    if(this.active) this.recordSnapshot(true);
    this.active=false; meta=meta||{};
    var sc=(window.ScoreTracker&&ScoreTracker.lastScore)||{total:0,breakdown:{}};
    return{
      version:1, id:_uid('replay'), createdAt:new Date().toISOString(), player:{alias:'',country:''},
      mission:{ level:(world.difficulty||0)+1, difficultyIndex:world.difficulty||0, difficultyName:_difficultyName(world.difficulty||0), outcome:meta.outcome||world.outcome||'LOSS', outcomeReason:meta.reason||world.outcomeReason||'', durationSec:_rr(world.t,2), seed:world._missionSeed||0 },
      score:sc,
      replay:{ version:3, tickRate:this.tickRate, initialState:this.initialState, snapshots:this.snapshots.slice(), events:this.events.slice() },
      syncStatus:'local_pending'
    };
  }
};

function recordMissionEvent(type,data){
  data = data || {};
  if (window.ReplayRecorder) ReplayRecorder.recordEvent(type, data);
  if (window.ScoreTracker){
    if (ScoreTracker.applyEvent) ScoreTracker.applyEvent(type, data);
    else if (ScoreTracker.ingest) ScoreTracker.ingest(type, data);
  }
}

var ReplayPlayback={
  active:false, playing:true, record:null, snapshots:[], events:[], time:0, duration:0, eventIndex:0, snapIndex:0, cockpitIndex:0, cockpitTrack:[], visuals:null, _lastDiscrete:null, _lastCockpitObj:null,

  start:function(rec){
    if(!rec||!rec.replay||!rec.replay.snapshots||!rec.replay.snapshots.length){ banner('REPLAY DATA UNAVAILABLE',1.5); return false; }
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ clearOutcome:true, clearProjectiles:true, resetCockpit:true, pauseAudio:false });
    else { world.message=''; world.messageT=0; world._mslAwayUntil=0; world._rwrActive=false; world._flareT=0; }
    this.record=rec; this.snapshots=rec.replay.snapshots;
    this.events=(rec.replay.events||[]).slice().sort(function(a,b){return a.t-b.t;});
    this.time=0; this.duration=this.snapshots[this.snapshots.length-1].t||0; this.eventIndex=0;
    this.snapIndex=0; this.cockpitIndex=0; this._lastDiscrete=null; this._lastCockpitObj=null;
    this._prepare(rec);
    this.playing=true; this.active=true;
    if(window.F16Audio && !F16Audio.ready) F16Audio.init();
    this._init(rec.replay.initialState||{}); this.applyAt(0);
    GameFlow.set(GAME_STATES.REPLAY_PLAYBACK,{keepPause:true});
    if(window.MenuUI) MenuUI.showReplayControls(rec);
    return true;
  },
  stop:function(){
    this.active=false; this.playing=false;
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ clearOutcome:true, clearProjectiles:true, resetCockpit:true, pauseAudio:true });
    else if(window.F16Audio && F16Audio.ready) F16Audio.update({paused:true});
    if(window.MenuUI) MenuUI.hideReplayControls();
    this.record=null; this.snapshots=[]; this.events=[]; this.cockpitTrack=[]; this.visuals=null; this._lastDiscrete=null; this._lastCockpitObj=null;
  },
  toggle:function(){ this.playing=!this.playing; if(window.MenuUI) MenuUI.updateReplayControls(); },
  restart:function(){
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ clearOutcome:true, clearProjectiles:true, resetCockpit:true, pauseAudio:false });
    this.time=0; this.eventIndex=0; this.snapIndex=0; this.cockpitIndex=0; this._lastDiscrete=null; this._lastCockpitObj=null; this.playing=true;
    this._init((this.record&&this.record.replay&&this.record.replay.initialState)||{});
    this.applyAt(0);
    if(window.MenuUI) MenuUI.updateReplayControls();
  },
  update:function(dt){
    if(!this.active) return;
    var old=this.time;
    if(this.playing){ this.time=Math.min(this.duration,this.time+dt); }
    this.applyAt(this.time);
    if(this.playing){ this._events(old,this.time); if(this.time>=this.duration) this.playing=false; }
    if(window.MenuUI) MenuUI.updateReplayControls();
  },

  _init:function(i){
    try{ if(i.terrainOff) TERRAIN_OFF=_jc(i.terrainOff); }catch(e){}
    try{ if(i.terrainFeatures) TERRAIN_FEATURES=_jc(i.terrainFeatures); }catch(e){}
    try{ if(i.flatSites) FLAT_SITES=_jc(i.flatSites); }catch(e){}
    if(i.runway) world.runway=_jc(i.runway);
    if(i.waypoints) world.waypoints=_jc(i.waypoints);
    if(i.bullseye) world.bullseye=_jc(i.bullseye);
    world.airstrips=_jc(i.airstrips||[]);
    world.infrastructure=_jc(i.infrastructure||{bridges:[],roads:[],powerlines:[]});
    if(i.stations) world.stations=_jc(i.stations);
    world.difficulty=i.difficulty||0;
    if(i.cockpit) this._applyCockpit(i.cockpit);
  },

  _prepare:function(rec){
    this.visuals={}; this.cockpitTrack=[];
    var self=this, order=0;
    function addVisual(o){ if(!o||!o.id) return; if(o.geom||o._cluster){ self.visuals[o.id]={geom:o.geom||null,_cluster:o._cluster||null}; } }
    function walkSnap(s){
      if(!s) return;
      if(s.target){ addVisual(s.target); (s.target.buildings||[]).forEach(addVisual); }
      ['groundMovers','hvts','friendlies','structures','threats'].forEach(function(k){ (s[k]||[]).forEach(addVisual); });
    }
    var init=(rec.replay&&rec.replay.initialState)||{};
    walkSnap(init.snapshot);
    (this.snapshots||[]).forEach(function(s){ walkSnap(s); if(s.cockpit) self.cockpitTrack.push({t:s.t||0,o:order++,cockpit:s.cockpit}); });
    if(init.cockpit) this.cockpitTrack.push({t:0,o:order++,cockpit:init.cockpit});
    (this.events||[]).forEach(function(ev){ if(ev.cockpit) self.cockpitTrack.push({t:ev.t||0,o:order++,cockpit:ev.cockpit}); });
    this.cockpitTrack.sort(function(a,b){return (a.t-b.t)||(a.o-b.o);});
  },

  _hydrateVisual:function(o){
    if(!o||!o.id||!this.visuals) return o;
    var v=this.visuals[o.id]; if(!v) return o;
    if(!o.geom && v.geom) o.geom=v.geom;
    if(!o._cluster && v._cluster) o._cluster=v._cluster;
    return o;
  },

  _copyObj:function(o){
    if(!o) return o;
    var n={}, k; for(k in o){ if(Object.prototype.hasOwnProperty.call(o,k)) n[k]=o[k]; }
    if(o.pos) n.pos={x:o.pos.x,y:o.pos.y,z:o.pos.z};
    if(o.vel) n.vel={x:o.vel.x,y:o.vel.y,z:o.vel.z};
    if(o.origin) n.origin={x:o.origin.x,y:o.origin.y,z:o.origin.z};
    if(o.target) n.target={x:o.target.x,y:o.target.y,z:o.target.z};
    return this._hydrateVisual(n);
  },

  _copyList:function(a){ var self=this; return (a||[]).map(function(o){return self._copyObj(o);}); },

  _copyTarget:function(t){
    if(!t) return null;
    var n=this._copyObj(t);
    n.buildings=this._copyList(t.buildings||[]);
    return n;
  },

  _events:function(oldT,newT){
    while(this.eventIndex<this.events.length && this.events[this.eventIndex].t<=newT){
      var ev=this.events[this.eventIndex++];
      if(ev.t+0.0005>=oldT){
        if(ev.cockpit) this._applyCockpit(ev.cockpit);
        this._announce(ev);
        this._sound(ev);
      }
    }
  },
  _announce:function(ev){
    if(typeof banner!=='function') return;
    var d=ev.data||{};
    if(ev.type==='weapon_fired') banner((d.weapon||'WEAPON')+' FIRED',.8);
    else if(ev.type==='kill'||ev.type==='target_destroyed') banner('KILL - '+(d.targetName||d.name||d.targetType||d.kind||'TARGET'),1);
    else if(ev.type==='mission_end') banner(d.reason||d.outcome||'MISSION END',1.2);
  },
  _sound:function(ev){
    var d=ev.data||{}, w=String(d.weapon||d.kind||'').toUpperCase();
    var missileCue = (ev.type==='missile_launch') || (ev.type==='weapon_fired' && /AIM|MISSILE|HARM|AGM-88|SAM|RED_AAM/.test(w));
    if (missileCue) world._mslAwayUntil = world.t + 2.8;
    if(!window.F16Audio || !F16Audio.ready) return;
    if(ev.type==='weapon_fired'){
      if(/GUN/.test(w)) F16Audio.event('gun');
      else if(missileCue) F16Audio.event('missile');
      else if(/BOMB|MK|82|LGB|AGM-65|MAVERICK/.test(w)) F16Audio.event('bomb');
      else F16Audio.event('beep');
    } else if(ev.type==='missile_launch') F16Audio.event('missile');
    else if(ev.type==='projectile_impact') F16Audio.event(/BOMB|MK|82|LGB/.test(w)?'bomb':'missile');
    else if(ev.type==='cockpit_action' || ev.type==='selection_changed' || ev.type==='mfd_page') F16Audio.event('select');
    else if(ev.type==='flare' || ev.type==='takeoff' || ev.type==='waypoint') F16Audio.event('beep');
    else if(ev.type==='player_damaged') F16Audio.event('newguy');
    else if(ev.type==='mission_end') F16Audio.event((d.outcome||'')==='WIN'?'win':'loss');
  },

  applyAt:function(t){
    var ss=this.snapshots; if(!ss.length) return;
    var i=this._snapIndexFor(t);
    var a=ss[i], b=ss[Math.min(i+1, ss.length-1)]||a;
    var u=clamp((t-a.t)/Math.max(.0001,b.t-a.t),0,1);
    this._apply(a,b,u);
  },
  _snapIndexFor:function(t){
    var ss=this.snapshots, n=ss.length; if(n<2) return 0;
    var i=this.snapIndex||0;
    if(i<0 || i>=n-1 || t<ss[i].t || t>ss[i+1].t){
      var lo=0, hi=n-1;
      while(lo<hi){ var mid=(lo+hi+1)>>1; if((ss[mid].t||0)<=t) lo=mid; else hi=mid-1; }
      i=Math.min(lo,n-2);
    }
    while(i<n-2 && t>ss[i+1].t) i++;
    this.snapIndex=i; return i;
  },
  _cockpitAt:function(t){
    var tr=this.cockpitTrack||[], n=tr.length; if(!n) return null;
    var i=this.cockpitIndex||0;
    if(i<0 || i>=n || tr[i].t>t || (i<n-1 && tr[i+1].t<=t)){
      var lo=0, hi=n-1;
      while(lo<hi){ var mid=(lo+hi+1)>>1; if((tr[mid].t||0)<=t) lo=mid; else hi=mid-1; }
      i=lo;
    }
    while(i<n-1 && tr[i+1].t<=t) i++;
    this.cockpitIndex=i; return tr[i].cockpit;
  },
  _ang:function(a,b,u){return wrap2pi((a||0)+angWrap((b||0)-(a||0))*u);},
  _num:function(a,b,u){return(typeof a==='number'&&typeof b==='number')?lerp(a,b,u):(b!==undefined?b:a);},
  _discrete:function(a,b){return (this.time+0.0005>=b.t)?b:a;},

  _apply:function(a,b,u){
    var d=this._discrete(a,b);
    world.t=this.time; world.outcome=d.outcome||null; world.outcomeReason=b.outcomeReason||a.outcomeReason||'';
    var A=a.ac||{}, B=b.ac||A, D=(d.ac||B), ac=world.ac;
    ac.pos={x:this._num(A.x,B.x,u),y:this._num(A.y,B.y,u),z:this._num(A.z,B.z,u)};
    ac.psi=this._ang(A.psi,B.psi,u); ac.theta=this._num(A.theta,B.theta,u); ac.phi=this._num(A.phi,B.phi,u); ac.gamma=this._num(A.gamma,B.gamma,u);
    ac.tas=this._num(A.tas,B.tas,u); ac.throttle=this._num(A.throttle,B.throttle,u); ac.gear=!!D.gear; ac.onGround=!!D.onGround;
    ac.g=this._num(A.g,B.g,u); ac.aoa=this._num(A.aoa,B.aoa,u); ac.vy=this._num(A.vy,B.vy,u); ac.integrity=this._num(A.integrity,B.integrity,u); ac.flares=Math.round(this._num(A.flares,B.flares,u)); ac.chaff=Math.round(this._num(A.chaff,B.chaff,u));

    world.bandits=this._list(a.bandits,b.bandits,u,'air');
    world.groundMovers=this._list(a.groundMovers,b.groundMovers,u,'mover');
    world.bombs=this._list(a.bombs,b.bombs,u,'proj');
    world.sams=this._list(a.sams,b.sams,u,'proj');
    world.bullets=this._list(a.bullets,b.bullets,u,'proj');
    world.decoys=this._list(a.decoys,b.decoys,u,'proj');
    this._applyDiscrete(d);
    world._rwrActive = world.threats.some(function(t){ return !!t.tracking; });

    // Cockpit/instrument state is driven by its own compact timeline. This
    // preserves exact MFD/selection actions without storing a full cockpit copy
    // in every world snapshot. Locks are resolved every frame because replay
    // world entities are freshly interpolated objects.
    var c=this._cockpitAt(this.time);
    if(c){ this._applyCockpit(c); this._applyLocks(c.locks||{}); this._applyMfdLocks(c.mfds||{}); }
    else if(d.sel) this._applyLegacySel(d.sel);
  },

  _applyDiscrete:function(d){
    if(d===this._lastDiscrete) return;
    this._lastDiscrete=d;
    if(d.hvts!==undefined) world.hvts=this._copyList(d.hvts||[]);
    if(d.friendlies!==undefined) world.friendlies=this._copyList(d.friendlies||[]);
    if(d.structures!==undefined) world.structures=this._copyList(d.structures||[]);
    if(d.threats!==undefined) world.threats=this._copyList(d.threats||[]);
    world.effects=this._copyList(d.effects||[]);
    if(d.target!==undefined) world.target=this._copyTarget(d.target||null);
  },

  _applyLegacySel:function(sel){
    if(!sel) return;
    world.steerpoint=sel.steerpoint||1; world.masterArm=sel.masterArm||'SAFE'; world.masterMode=sel.masterMode||'NAV'; world.selectedStation=sel.selectedStation||5;
    if(typeof isWeaponStation==='function'){ var st=(world.stations||[]).find(function(s){return s.id===world.selectedStation;}); if(!isWeaponStation(st)){ var first=(world.stations||[]).find(isWeaponStation); world.selectedStation=first?first.id:5; } }
    if(world.ecm) world.ecm.on=!!sel.ecmOn; world.tgpLaser=!!sel.tgpLaser;
  },

  _applyCockpit:function(c){
    if(!c) return;
    if(c===this._lastCockpitObj) return;
    this._lastCockpitObj=c;
    world.activeMfdId=c.activeMfdId||world.activeMfdId||'center';
    world.steerpoint=c.steerpoint||world.steerpoint||1; world.masterArm=c.masterArm||'SAFE'; world.masterMode=c.masterMode||'NAV'; world.selectedStation=c.selectedStation||world.selectedStation||5;
    if(typeof isWeaponStation==='function'){ var st=(world.stations||[]).find(function(s){return s.id===world.selectedStation;}); if(!isWeaponStation(st)){ var first=(world.stations||[]).find(isWeaponStation); world.selectedStation=first?first.id:5; } }
    world.designated=!!c.designated; world.tgpLaser=!!c.tgpLaser; world.lantirnOn=!!c.lantirnOn; world.lantirnMode=c.lantirnMode||'OFF'; world.dlEntry=c.dlEntry||''; world.datalinkTuned=c.datalinkTuned||'';
    if(world.ecm && c.ecm){ world.ecm.on=!!c.ecm.on; world.ecm.cursor=c.ecm.cursor||50; world.ecm.jam=_jc(c.ecm.jam||[]); }
    if(c.stations && world.stations){
      var by={}; c.stations.forEach(function(s){by[s.id]=s;});
      world.stations.forEach(function(s){ var r=by[s.id]; if(r){ s.qty=r.qty||0; s.sel=!!r.sel && (typeof isWeaponStation!=='function' || isWeaponStation(s)); } else s.sel=(s.id===world.selectedStation && (typeof isWeaponStation!=='function' || isWeaponStation(s))); });
    }
    // The targeting pod is carried on a station, but it is a sensor, not a selectable weapon.
    // Normalize legacy replay/state records that accidentally had the pod selected.
    var selSt=(world.stations||[]).find(function(s){return s.id===world.selectedStation;});
    var isW=(typeof isWeaponStation==='function')?isWeaponStation:function(s){return s && s.kind!=='pod' && s.kind!=='tank';};
    if(!isW(selSt)){
      var first=(world.stations||[]).find(isW);
      world.selectedStation=first?first.id:5;
      (world.stations||[]).forEach(function(s){s.sel=(s.id===world.selectedStation);});
    }
    try{ if(c.dedPage && typeof DED_PAGE!=='undefined') DED_PAGE=c.dedPage; }catch(e){}
    if(typeof MFDS!=='undefined' && c.mfds){
      for(var id in c.mfds){
        var m=MFDS[id], s=c.mfds[id]; if(!m||!s) continue;
        var pageChanged=(m.page!==s.page);
        m.page=s.page||m.page; m.range=s.range||m.range; m.azScan=s.azScan||m.azScan; m.sweep=s.sweep||0; m.sweepDir=s.sweepDir||1; m.fcrMode=s.fcrMode||m.fcrMode;
        m.tgpFov=s.tgpFov||m.tgpFov; m.tgpZoom=s.tgpZoom||m.tgpZoom; m.tgpTrack=s.tgpTrack||m.tgpTrack; m.tgpPol=s.tgpPol||m.tgpPol; m.laser=!!s.laser; m.dlRange=s.dlRange||m.dlRange||80;
        m.lantRange=s.lantRange||m.lantRange||10; m.lantFov=s.lantFov||m.lantFov||'WIDE';
        m.locked=s.lockedId?ReplayUtils.findEntity(s.lockedId):null;
        if(m.refresh) m.refresh();
      }
      world.lantirnOn=Object.keys(MFDS).some(function(k){return MFDS[k] && MFDS[k].page==='LANT';});
      world.lantirnMode=world.lantirnOn?'FLIR':'OFF';
    }
    if(typeof setActive==='function') setActive();
  },
  _applyLocks:function(l){ world.gndLock=ReplayUtils.findEntity(l&&l.gnd)||null; world.airLock=ReplayUtils.findEntity(l&&l.air)||null; world.harmLock=ReplayUtils.findEntity(l&&l.harm)||null; },
  _applyMfdLocks:function(mfds){
    if(typeof MFDS==='undefined' || !mfds) return;
    for(var id in mfds){ if(MFDS[id]) MFDS[id].locked = mfds[id].lockedId ? ReplayUtils.findEntity(mfds[id].lockedId) : null; }
  },

  _idx:function(l){var m={};(l||[]).forEach(function(o){if(o&&o.id)m[o.id]=o;});return m;},
  _list:function(al,bl,u,kind){
    al=al||[]; bl=bl||[]; var am=this._idx(al), bm=this._idx(bl), ids={}, out=[], self=this;
    al.forEach(function(o){if(o&&o.id)ids[o.id]=1;}); bl.forEach(function(o){if(o&&o.id)ids[o.id]=1;});
    Object.keys(ids).forEach(function(id){
      var a=am[id], b=bm[id]; if(!a){out.push(self._copyObj(b));return;} if(!b){out.push(self._copyObj(a));return;}
      var o=self._copyObj((u>.5)?b:a);
      if(kind==='air'){o.x=self._num(a.x,b.x,u);o.y=self._num(a.y,b.y,u);o.alt=self._num(a.alt,b.alt,u);o.psi=self._ang(a.psi,b.psi,u);o.spd=self._num(a.spd,b.spd,u);}
      else if(kind==='mover'){o.x=self._num(a.x,b.x,u);o.y=self._num(a.y,b.y,u);o.psi=self._ang(a.psi,b.psi,u);o.spd=self._num(a.spd,b.spd,u);}
      else if(kind==='proj'){
        if(a.pos&&b.pos)o.pos={x:self._num(a.pos.x,b.pos.x,u),y:self._num(a.pos.y,b.pos.y,u),z:self._num(a.pos.z,b.pos.z,u)};
        if(a.vel&&b.vel)o.vel={x:self._num(a.vel.x,b.vel.x,u),y:self._num(a.vel.y,b.vel.y,u),z:self._num(a.vel.z,b.vel.z,u)};
        o.spd=self._num(a.spd,b.spd,u); o.t=self._num(a.t,b.t,u);
      }
      out.push(o);
    });
    return out;
  }
};

window.ReplayUtils=ReplayUtils; window.ReplayRecorder=ReplayRecorder; window.ReplayPlayback=ReplayPlayback; window.recordMissionEvent=recordMissionEvent;
