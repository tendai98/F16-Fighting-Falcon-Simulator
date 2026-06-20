/* =====================================================================
   SCORING - mission-quality score with detailed breakdown
   ===================================================================== */
(function(){
  'use strict';

  const LEVEL_MULT = [1.00, 1.20, 1.45, 1.75];
  function rt(v){ return Math.round((Number(v)||0)*100)/100; }
  function wpNow(){ return (typeof curWP === 'function') ? curWP() : null; }

  const ScoreTracker = {
    data:null,
    lastScore:null,

    start(){ this.reset(); },
    reset(){
      this.data = {
        startedAt: world.t || 0,
        takeoff:false,
        waypoints:{},
        samples:0,
        goodRouteSamples:0,
        weapons:[],
        kills:[],
        flareCount:0,
        ecmUseSec:0,
        damage:0,
        penalties:0,
        lastWeapon:''
      };
      this.lastScore = null;
      world._scoreData = this.data;
    },

    update(dt){
      if(!this.data) return;
      this.data.samples++;
      if(world.ecm && world.ecm.on) this.data.ecmUseSec += dt || 0;
      const wp = wpNow();
      if(wp && world.ac && !world.ac.onGround){
        const d = Math.hypot(world.ac.pos.x - wp.x, world.ac.pos.y - wp.y);
        if(d < (wp.name === 'TGT' ? 6500 : 4500)) this.data.goodRouteSamples++;
      }
    },

    _emit(type, data, silent){ if(!silent && window.ReplayRecorder) ReplayRecorder.recordEvent(type, data || {}); },

    takeoff(silent){
      if(!this.data) this.reset();
      if(!this.data.takeoff){ this.data.takeoff = true; this._emit('takeoff', {}, silent); }
    },
    waypoint(id, name, silent){
      if(!this.data) this.reset();
      this.data.waypoints[id] = { id:id, name:name || '', t:rt(world.t) };
      this._emit('waypoint', { id:id, name:name || '' }, silent);
    },
    weaponFired(weapon, targetType, silent){
      if(!this.data) this.reset();
      const w = { t:rt(world.t), weapon:String(weapon || 'UNKNOWN'), targetType:targetType || '' };
      this.data.weapons.push(w);
      this.data.lastWeapon = w.weapon;
      this._emit('weapon_fired', w, silent);
    },
    flare(silent){
      if(!this.data) this.reset();
      this.data.flareCount++;
      this._emit('flare', { count:this.data.flareCount }, silent);
    },
    damage(amount, reason, silent){
      if(!this.data) this.reset();
      this.data.damage += amount || 0;
      this._emit('player_damaged', { amount:amount || 0, reason:reason || '' }, silent);
    },
    penalty(points, reason, silent){
      if(!this.data) this.reset();
      this.data.penalties += Math.abs(points || 0);
      this._emit('penalty', { points:Math.abs(points || 0), reason:reason || '' }, silent);
    },
    kill(kind, weapon, opts, silent){
      if(!this.data) this.reset();
      opts = opts || {};
      const k = {
        t:rt(world.t),
        kind:kind || 'unknown',
        weapon:weapon || this.data.lastWeapon || 'UNKNOWN',
        primary:!!opts.primary,
        name:opts.name || '',
        correct:this.correctWeapon(kind, weapon || this.data.lastWeapon)
      };
      this.data.kills.push(k);
      this._emit('target_destroyed', k, silent);
    },

    correctWeapon(kind, weapon){
      kind = String(kind || '').toLowerCase();
      weapon = String(weapon || '').toUpperCase();
      if(/sam|emitter|radar|tel/.test(kind)) return /AGM-88|HARM/.test(weapon) ? 'full' : (/AGM|65|MK-82|BOMB|LGB/.test(weapon) ? 'partial' : 'wrong');
      if(/mover|ground|vehicle/.test(kind)) return /AGM-65|MAVERICK|65|LGB/.test(weapon) ? 'full' : (/MK-82|BOMB|HARM/.test(weapon) ? 'partial' : 'wrong');
      if(/hvt|structure|building|primary/.test(kind)) return /MK-82|BOMB|LGB|AGM-65|65/.test(weapon) ? 'full' : (/HARM/.test(weapon) ? 'partial' : 'wrong');
      if(/bandit|air/.test(kind)) return /AIM|9X|120|GUN/.test(weapon) ? 'full' : 'wrong';
      return 'partial';
    },

    applyEvent(type, data){
      data = data || {};
      if(type === 'weapon_fired'){
        if(data.weapon === 'RED_AAM' || (data.actor && data.actor !== 'player')) return true;
        this.weaponFired(data.weapon, data.targetType || data.kind || data.targetKind || '', true); return true;
      }
      if(type === 'kill' || type === 'target_destroyed'){
        this.kill(data.targetType || data.kind || 'target', data.weapon || this.data && this.data.lastWeapon || 'UNKNOWN', { primary:data.primary || data.targetType === 'primary', name:data.targetName || data.name || '' }, true);
        return true;
      }
      if(type === 'weapon_missed'){ this.penalty(80, 'missed '+(data.weapon || 'weapon'), true); return true; }
      if(type === 'flare'){ this.flare(true); return true; }
      if(type === 'waypoint' || type === 'waypoint_advanced'){ const wp = wpNow(); this.waypoint(data.steerpoint || data.id || world.steerpoint, data.name || (wp && wp.name) || '', true); return true; }
      if(type === 'takeoff'){ this.takeoff(true); return true; }
      if(type === 'player_damaged' || type === 'damage'){ this.damage(data.amount || 0, data.reason || '', true); return true; }
      return false;
    },

    recordTakeoff(){ this.takeoff(false); },
    recordWaypointAdvance(){ const wp = wpNow(); this.waypoint(world.steerpoint, (wp && wp.name) || '', false); },
    recordWeaponFire(weapon, meta){ meta = meta || {}; this.weaponFired(weapon, meta.targetType || meta.kind || meta.targetKind || '', false); },
    recordKill(kind, weapon, obj){ obj = obj || {}; this.kill(kind, weapon, { primary:!!obj.primary, name:obj.name || obj.label || obj.kind || '' }, false); },
    recordMiss(weapon){ this.penalty(80, 'missed '+(weapon || 'weapon'), false); },
    recordFlare(){ this.flare(false); },
    recordEcmToggle(){ this._emit('ecm_toggled', { on:!!(world.ecm && world.ecm.on) }, false); },
    recordSelection(field, value){ this._emit('selection_changed', { field:field, value:value }, false); },

    finish(outcome, reason){
      if(!this.data) this.reset();
      const d = this.data, kills = d.kills || [];
      let primary = 0, secondary = 0, air = 0, sam = 0, weaponDisc = 0;
      kills.forEach(k => {
        const kind = String(k.kind || '').toLowerCase();
        if(k.primary || /primary/.test(kind)) primary += 4000;
        else if(/bandit|air/.test(kind)) air += /HVA|MAINSTAY/i.test(k.name) ? 1200 : 800;
        else if(/sam|emitter|radar|tel/.test(kind)) sam += 850;
        else if(/hvt/.test(kind)) secondary += 800;
        else if(/mover|ground|vehicle/.test(kind)) secondary += 550;
        else if(/structure/.test(kind)) secondary += 700;
        else secondary += 300;
        weaponDisc += k.correct === 'full' ? 220 : (k.correct === 'partial' ? 90 : -140);
      });
      if(world.target && world.target.destroyed && primary === 0) primary = 4000;
      const routeRatio = d.samples ? d.goodRouteSamples / d.samples : 0;
      const waypointDiscipline = Math.round(routeRatio * 900) + Object.keys(d.waypoints).length * 160;
      const takeoff = d.takeoff ? 300 : 0;
      const survival = (world.ac && world.ac.integrity > 0) ? (outcome === 'WIN' ? 1000 : 250) : 0;
      const shots = d.weapons.filter(w => !/GUN|FLARE/.test(w.weapon)).length;
      const nonGunKills = kills.filter(k => !/GUN/.test(k.weapon)).length;
      const misses = Math.max(0, shots - nonGunKills);
      let penalties = 0;
      penalties -= misses * 140;
      penalties -= Math.max(0, d.flareCount - 8) * 15;
      penalties -= Math.round(d.ecmUseSec * 1.2);
      penalties -= Math.round((100 - (world.ac ? world.ac.integrity : 100)) * 8);
      penalties -= d.penalties;
      if(outcome !== 'WIN') penalties -= 300;
      if(/CRASH|TERRAIN|DESTROYED|LANDING|IMPACT/i.test(reason || '')) penalties -= 1200;

      const breakdown = { primaryTargets:primary, secondaryTargets:secondary, enemyAircraft:air, samSites:sam, waypointDiscipline, weaponDiscipline:weaponDisc, takeoff, survival, penalties };
      const raw = Math.max(0, Object.keys(breakdown).reduce((a,k) => a + (breakdown[k] || 0), 0));
      const levelMultiplier = LEVEL_MULT[world.difficulty || 0] || 1;
      const outcomeMultiplier = outcome === 'WIN' ? 1 : (/CRASH|TERRAIN|DESTROYED|LANDING|IMPACT/i.test(reason || '') ? 0.20 : 0.40);
      const total = Math.max(0, Math.round(raw * levelMultiplier * outcomeMultiplier));
      breakdown.raw = raw;
      breakdown.levelMultiplier = levelMultiplier;
      breakdown.outcomeMultiplier = outcomeMultiplier;
      this.lastScore = { total, breakdown, stats:JSON.parse(JSON.stringify(Object.assign({}, d, { waypoints:Object.values(d.waypoints) }))) };
      return this.lastScore;
    },

    ingest(type, data){ return this.applyEvent(type, data || {}); },
    event(type, data){ this._emit(type, data || {}, false); }
  };

  window.ScoreTracker = ScoreTracker;
})();
