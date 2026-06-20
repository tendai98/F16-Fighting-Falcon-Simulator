/* =====================================================================
   HUD OVERLAY  +  WEAPONS  +  THREAT (SAM) LOGIC
   ===================================================================== */

/* ---------- mission/nav helpers ---------- */
function curWP(){ return world.waypoints.find(w=>w.id===world.steerpoint) || world.waypoints[0]; }
function bearingTo(x,y){            // true bearing from ownship (rad, from north CW)
  const dx = x - world.ac.pos.x, dy = y - world.ac.pos.y;
  return wrap2pi(Math.atan2(dx, dy));
}
function distTo(x,y){ return Math.hypot(x-world.ac.pos.x, y-world.ac.pos.y); }


/* ---------- combat dynamics helpers ---------- */
const GUN_MUZZLE_V = 1030;       // m/s, M61 approximate muzzle velocity
const GUN_MAX_RANGE = 2850;      // playable LCOS envelope; red cue uses stricter solution gates
const GUN_HARD_KILL_RANGE = 2300; // damage / pipper confidence is strongest inside this range
const GUN_DISPLAY_RANGE = 4.0 * NM; // show LCOS early so pilots can work into the envelope

function ensureCombatArrays(){
  if (!world.bullets) world.bullets=[];
  if (!world.decoys) world.decoys=[];
}
function banditPos(bd){ return {x:bd.x, y:bd.y, z:bd.alt}; }
function banditVel(bd){ return {x:Math.sin(bd.psi||0)*(bd.spd||0), y:Math.cos(bd.psi||0)*(bd.spd||0), z:bd.vz||0}; }
function objectVel(o){ return (o===world.ac) ? acVel(world.ac) : (o && o.alt!==undefined ? banditVel(o) : v3(0,0,0)); }
function isRadarMissile(m){ const w=String(m.weapon||m.kind||m.name||'').toUpperCase(); return m.team==='RED' || /120|AMRAAM|SAM|SA-|RED_AAM|RADAR/.test(w); }
function isIrMissile(m){ const w=String(m.weapon||m.kind||'').toUpperCase(); return /9X|AIM-9|FOX-2|IR/.test(w); }
function isBlueAam(m){ return m.team==='BLUE' && !m.groundPos && !!m.tgt; }
function missileProfile(m){
  const w=String(m.weapon||m.kind||'').toUpperCase();
  // Turn rates are deliberately bounded.  The previous values let missiles keep
  // wrapping around a jinking bandit after an overshoot, which looked arcade-like.
  // These profiles still make good shots dangerous, but they force bad-aspect or
  // post-merge shots to bleed energy and self-terminate instead of boomeranging.
  if (m.groundPos){
    return /HARM/.test(w) ? {name:'HARM',maxSpd:760,minSpd:210,accel:130,drag:46,burn:7.0,maxTurn:0.95,coastTurn:0.30,turnDrain:0.09,turnDrag:50,burnDrain:0.012,coastDrain:0.050,breakAng:112*DEG,breakTime:0.65,seekerLimit:82*DEG,prox:38}
                         : {name:'AGM', maxSpd:610,minSpd:180,accel:105,drag:42,burn:5.5,maxTurn:0.90,coastTurn:0.30,turnDrain:0.10,turnDrag:46,burnDrain:0.014,coastDrain:0.050,breakAng:112*DEG,breakTime:0.70,seekerLimit:78*DEG,prox:32};
  }
  if (/9X|AIM-9/.test(w)) return {name:'AIM-9X',seeker:'IR',maxSpd:830,minSpd:235,accel:235,drag:68,burn:4.6,maxTurn:1.75,coastTurn:0.28,turnDrain:0.30,turnDrag:130,burnDrain:0.016,coastDrain:0.088,breakAng:86*DEG,breakTime:0.24,seekerLimit:66*DEG,noReacquireT:0.12,prox:38};
  if (/120|AMRAAM/.test(w)) return {name:'AIM-120',seeker:'RADAR',maxSpd:920,minSpd:265,accel:245,drag:60,burn:6.6,maxTurn:1.18,coastTurn:0.24,turnDrain:0.26,turnDrag:120,burnDrain:0.014,coastDrain:0.074,breakAng:78*DEG,breakTime:0.27,seekerLimit:58*DEG,noReacquireT:0.14,prox:44};
  if (/RED_AAM/.test(w)) return {name:'RED_AAM',seeker:'RADAR',maxSpd:850,minSpd:250,accel:220,drag:62,burn:5.7,maxTurn:1.05,coastTurn:0.23,turnDrain:0.25,turnDrag:116,burnDrain:0.016,coastDrain:0.080,breakAng:78*DEG,breakTime:0.28,seekerLimit:56*DEG,noReacquireT:0.15,prox:44};
  return {name:'SAM',seeker:'RADAR',maxSpd:980,minSpd:285,accel:260,drag:68,burn:7.1,maxTurn:0.90,coastTurn:0.22,turnDrain:0.28,turnDrag:140,burnDrain:0.016,coastDrain:0.086,breakAng:72*DEG,breakTime:0.26,seekerLimit:54*DEG,noReacquireT:0.13,prox:46};
}
function seedMissile(m, profile){
  if (!m) return;
  const p=profile||missileProfile(m);
  if (m.energy===undefined) m.energy=1;
  if (m._pd===undefined) m._pd=1e9;
  if (m._lostT===undefined) m._lostT=0;
  if (m._divergeT===undefined) m._divergeT=0;
  if (m._behindT===undefined) m._behindT=0;
  if (m._prevTrueD===undefined) m._prevTrueD=1e9;
  if (!m.life) m.life = p.name==='SAM' ? 16 : p.name==='AIM-120' ? 16 : 12;
  if (!m.trail) m.trail=[];
}
function addCountermeasure(pos, vel, kind, team){
  ensureCombatArrays();
  const d={ id:'decoy_'+Math.random().toString(36).slice(2,9), kind:kind||'flare', team:team||'BLUE', pos:{...pos}, vel:{...vel}, t:0, life:(kind==='chaff'?4.2:2.6) };
  world.decoys.push(d);
  return d;
}
function dropCountermeasureBurst(origin, vel, team, opts){
  opts=opts||{}; ensureCombatArrays();
  const base={x:vel.x||0,y:vel.y||0,z:vel.z||0};
  const nF=opts.flares||0, nC=opts.chaff||0;
  for(let i=0;i<nF;i++) addCountermeasure(origin, {x:base.x*0.28+(Math.random()-0.5)*34, y:base.y*0.28+(Math.random()-0.5)*34, z:base.z*0.18-12-Math.random()*14}, 'flare', team);
  for(let i=0;i<nC;i++) addCountermeasure(origin, {x:base.x*0.18+(Math.random()-0.5)*42, y:base.y*0.18+(Math.random()-0.5)*42, z:base.z*0.12-3-Math.random()*7}, 'chaff', team);
}
function missileTargetObject(m){ return m.team==='RED' ? world.ac : (m.tgt||null); }
function liveTargetPos(m){
  if (m.team==='RED') return world.ac.pos;
  if (m.groundPos){
    if ((m.kind==='HARM' || /HARM/.test(m.kind||'')) && m.emitter && m.emitter.live) return {x:m.emitter.x, y:m.emitter.y, z:terrainH(m.emitter.x,m.emitter.y)+3};
    return m.groundPos;
  }
  return (m.tgt && m.tgt.hp>0) ? banditPos(m.tgt) : null;
}
function notchQuality(m, targetObj, tgtPos){
  if (!targetObj || !tgtPos || !isRadarMissile(m)) return 0;
  const tv=objectVel(targetObj), sp=vlen(tv); if (sp<80) return 0;
  const los=vnorm(vsub(m.pos, tgtPos));
  const radial=Math.abs(vdot(tv, los));
  const lateral=Math.sqrt(Math.max(0, sp*sp-radial*radial));
  const d=vlen(vsub(m.pos,tgtPos));
  const notch=clamp((115-radial)/115,0,1)*clamp((lateral-90)/170,0,1)*clamp((d-450)/3200,0,1);
  return notch;
}
function chooseDecoyTarget(m, targetObj, tgtPos, notch){
  ensureCombatArrays();
  const seeker=isIrMissile(m)?'flare':(isRadarMissile(m)?'chaff':null);
  if (!seeker) return null;
  if (m.decoyId){
    const cur=world.decoys.find(d=>d.id===m.decoyId && d.kind===seeker && d.team===(m.team==='RED'?'BLUE':'RED') && d.t<d.life);
    if (cur) return cur.pos;
    m.decoyId=null;
  }
  const team=m.team==='RED'?'BLUE':'RED';
  let best=null, bestScore=0;
  for (const d of world.decoys){
    if (!d || d.kind!==seeker || d.team!==team || d.t>=d.life) continue;
    const dt=vlen(vsub(d.pos, tgtPos));
    const dm=vlen(vsub(d.pos, m.pos));
    if (dt>1800 && dm>2600) continue;
    const age=clamp(1-d.t/d.life,0,1);
    const score=(seeker==='flare'?1.0:0.85)*age*(1/(1+dt/900))*(1/(0.8+dm/2600));
    if (score>bestScore){ bestScore=score; best=d; }
  }
  if (best){
    const base = seeker==='flare' ? 0.45 : 0.24 + 0.46*notch;
    const quality=clamp(bestScore*base*(m.t<1.0?0.35:1.0),0,0.78);
    if (Math.random()<quality){ m.decoyId=best.id; m._seekerDriftT=0.35+Math.random()*0.55; return best.pos; }
  }
  return null;
}
function selfDestructMissile(i, m, why){
  addEffect(m.pos, why==='decoy'?0.45:0.7, why==='decoy'?'launch':'blast');
  if (window.recordMissionEvent) recordMissionEvent('projectile_impact', { weapon:m.weapon||m.kind||'MISSILE', kind:why||'self_destruct', x:m.pos.x, y:m.pos.y, z:m.pos.z });
  world.sams.splice(i,1);
}
function distancePointSegment(p,a,b){
  const ab=vsub(b,a), ap=vsub(p,a); const l2=vdot(ab,ab)||1; const t=clamp(vdot(ap,ab)/l2,0,1); const q=vadd(a,vscale(ab,t)); return vlen(vsub(p,q));
}
function solveGunLead(target){
  if (!target || target.hp<=0) return null;
  const ac=world.ac, tp=banditPos(target), tv=banditVel(target), ov=acVel(ac);
  const rel=vsub(tp, ac.pos), rv=vsub(tv, ov), c=vdot(rel,rel);
  const a=vdot(rv,rv)-GUN_MUZZLE_V*GUN_MUZZLE_V, b=2*vdot(rel,rv);
  let t=0;
  const disc=b*b-4*a*c;
  if (Math.abs(a)<1e-6 || disc<0) t=Math.sqrt(c)/GUN_MUZZLE_V;
  else {
    const sq=Math.sqrt(disc), t1=(-b-sq)/(2*a), t2=(-b+sq)/(2*a);
    t=[t1,t2].filter(x=>x>0.02).sort((x,y)=>x-y)[0] || Math.sqrt(c)/GUN_MUZZLE_V;
  }
  if (!isFinite(t) || t<0 || t>5.2) return null;
  const aim=vadd(tp, vscale(tv,t));
  aim.z += 0.5*G0*t*t; // lift pipper for bullet drop compensation
  const dir=vnorm(vsub(aim, ac.pos));
  const range=Math.sqrt(c);
  const boreAng=Math.acos(clamp(vdot(dir, acBasis(ac).fwd),-1,1));
  const quality = clamp(1 - range/GUN_DISPLAY_RANGE, 0, 1) * clamp(1 - boreAng/(42*DEG), 0, 1);
  return {target, aimPoint:aim, dir, t, range, boreAng, quality, ready:range<GUN_HARD_KILL_RANGE && boreAng<3.2*DEG};
}
function bestGunSolution(){
  const ac=world.ac;
  let list=[];
  if (world.airLock && world.airLock.hp>0) list.push(world.airLock);
  for (const b of world.bandits) if (b.hp>0 && list.indexOf(b)<0) list.push(b);
  let best=null, score=1e9;
  for (const bd of list){
    const sol=solveGunLead(bd); if(!sol || sol.range>GUN_DISPLAY_RANGE || sol.boreAng>45*DEG) continue;
    const s=sol.boreAng*RAD*15 + sol.range/550 + (bd===world.airLock?-7:0);
    if(s<score){score=s;best=sol;}
  }
  return best;
}
function finishGunKill(target, weapon){
  if (!target || target._gunKilled) return;
  target._gunKilled = true;
  const bp=banditPos(target);
  addEffect(bp, 1.1);
  if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'air', targetName:target.kind||'BANDIT', targetId:target.id||null, weapon:weapon||'GUN' });
  banner('GUN KILL — '+(target.kind||'BANDIT'), 1.6);
}
function applyGunSolutionDamage(sol){
  // Projectile hits remain authoritative, but a short burst held on a valid LCOS
  // solution should reliably score damage in this arcade-scale sim.  This only
  // applies inside a tight boresight/range gate, so spraying near a target still
  // does not magically kill it.
  if (!sol || !sol.target || sol.target.hp<=0) return;
  const ac=world.ac;
  const gPenalty = clamp(Math.abs((ac.g||1)-1)/8, 0, 0.45);
  const rangeQ = clamp(1 - sol.range/GUN_HARD_KILL_RANGE, 0.16, 1.0);
  const boreQ = clamp(1 - sol.boreAng/(3.6*DEG), 0, 1);
  if (boreQ<=0) return;
  const damage = 0.075 * rangeQ * boreQ * (1-gPenalty);
  sol.target.hp -= damage;
  sol.target._lastGunHitT = world.t;
  if (sol.target.hp<=0) finishGunKill(sol.target, 'GUN');
}

/* ---------- weapons ---------- */
function isWeaponStation(s){ return !!s && ['aa','agm','ag','harm'].indexOf(s.kind)>=0; }
function weaponStations(){ return (world.stations||[]).filter(isWeaponStation); }
if (typeof window!=='undefined'){ window.isWeaponStation=isWeaponStation; window.weaponStations=weaponStations; }
function selectedStore(){ const st=(world.stations||[]).find(s=>s.id===world.selectedStation); return isWeaponStation(st) ? st : null; }

function pickle(){
  if (world.outcome) return;
  const ac = world.ac;
  if (world.masterArm === 'SAFE'){ banner('MASTER ARM — SAFE', 1.2); return; }
  const sim = world.masterArm==='SIM';
  const st = selectedStore();

  // In A-A / dogfight, SPACE is always the cannon trigger and L is the
  // missile-launch button.  Do not let a stale Mk-82/AGM station drop a bomb while
  // the pilot is trying to fire the gun.  Holding SPACE is handled by updateGunFire.
  if (world.masterMode==='A-A' || world.masterMode==='DGFT') return;
  if (!st || st.qty<=0){ banner('STORE QTY 0', 1.2); return; }

  if (st.kind==='ag'){                       // Mk-82: laser-guided if lasing, else CCIP ballistic
    st.qty--;
    const v = acVel(ac);
    const laze = laserDesignation();
    const bomb = { pos:{...ac.pos}, vel:{...v}, live: !sim, t:0, weapon: laze ? 'LGB' : 'MK-82', origin:{...ac.pos}, trail:[{...ac.pos}] };
    if (laze){ bomb.guided = true; bomb.target = {...laze}; }
    world.bombs.push(bomb);
    if (window.recordMissionEvent) recordMissionEvent('weapon_fired', { weapon:bomb.weapon, station:st.id, mode:world.masterMode });
    if (window.F16Audio) F16Audio.event('bomb');
    banner((sim?'SIM ':'') + (laze ? 'BOMB AWAY \u2014 LGB' : 'BOMB AWAY \u2014 CCIP'), 0.9);
  } else if (st.kind==='agm'){               // guided air-to-ground -> designation
    const tp = groundDesignation();
    if (!tp){ banner('AGM — NO GROUND LOCK (DESIGNATE w/ TGP/FCR)', 1.6); return; }
    st.qty--;
    fireGuided(tp, 'AGM', !sim, null, st.wpn);
    banner((sim?'SIM ':'')+'RIFLE', 1.3);
  } else if (st.kind==='harm'){              // anti-radiation -> emitter
    const em = harmDesignation();
    if (!em){ banner('HARM — NO EMITTER IN RANGE', 1.6); return; }
    st.qty--;
    fireGuided({x:em.x, y:em.y, z:terrainH(em.x,em.y)+3}, 'HARM', !sim, em, st.wpn);
    banner((sim?'SIM ':'')+'MAGNUM — '+em.name, 1.6);
  } else {
    banner('NO WEAPON SELECTED (X)', 1.2);
  }
}

/* the laser-spot ground point if the TGP is lasing a real designation (not the
   boresight default and not a destroyed contact) — otherwise null (=> CCIP). */
function laserDesignation(){
  if (!world.tgpLaser) return null;
  const ap = tgpAimPoint();
  if (ap.dom!=='GND' || ap.name==='BORE' || ap.name.indexOf('DESTROYED')>=0) return null;
  return { x:ap.x, y:ap.y, z:ap.z };
}

/* ground aim point for guided A-G: a locked ground contact, else the
   designated strike target, else nothing. */
function groundDesignation(){
  if (world.gndLock && world.gndLock.destroyed!==true){
    const g=world.gndLock; return {x:g.x, y:g.y, z:terrainH(g.x,g.y)+3};
  }
  if (world.designated && !world.target.destroyed){
    const t=world.target; return {x:t.x, y:t.y, z:terrainH(t.x,t.y)+3};
  }
  return null;
}

/* emitter for HARM: the HAD-designated emitter if live, else the highest
   lethality live emitter whose threat ring we are inside. */
function harmDesignation(){
  const ac=world.ac;
  if (world.harmLock && world.harmLock.live) return world.harmLock;
  let best=null, bestScore=-1;
  for (const t of world.threats){
    if (!t.live) continue;
    const d = Math.hypot(t.x-ac.pos.x, t.y-ac.pos.y);
    if (d > t.radius*1.15) continue;                 // must be within (just outside) its envelope
    const score = t.radius - d*0.5 + (t.tracking?4000:0);
    if (score>bestScore){ bestScore=score; best=t; }
  }
  return best;
}

/* launch a guided surface weapon toward a fixed ground point */
function fireGuided(tp, kind, live, emitter, weaponName){
  const ac = world.ac, b = acBasis(ac);
  world.sams.push({
    team:'BLUE', kind, weapon:weaponName||kind, groundPos:{...tp}, emitter: emitter||null, live,
    pos:{...ac.pos}, vel: vscale(b.fwd, ac.tas+120), origin:{...ac.pos},
    spd: kind==='HARM'?760:560, t:0, life: kind==='HARM'?22:18,
    color: kind==='HARM'?'#ffd14d':'#a8ffc0', trail:[{...ac.pos}],
  });
  addEffect(ac.pos, 0.5, 'launch');
  if (window.F16Audio) F16Audio.event('missile');
  world._mslAwayUntil = world.t + 2.8;
  if (window.recordMissionEvent) recordMissionEvent('weapon_fired', { weapon:weaponName||kind, kind:kind, targetId:emitter&&emitter.id||null, targetName:emitter&&emitter.name||'', targetType:kind==='HARM'?'sam_emitter':'ground_vehicle' });
}

let _gunT = 0, _gunScoreT = -99;
function fireGun(){
  ensureCombatArrays();
  const ac = world.ac, b = acBasis(ac), ov = acVel(ac);
  const sol = bestGunSolution();
  _gunT = 0.12;        // tracer flash
  if (window.F16Audio) F16Audio.event('gun');
  if (window.recordMissionEvent && (!fireGun._lastEvt || world.t-fireGun._lastEvt>0.5)){ fireGun._lastEvt=world.t; recordMissionEvent('weapon_fired', { weapon:'GUN', mode:world.masterMode }); }

  // Rounds inherit aircraft velocity and each round gets its own dispersion.
  // High-G maneuvering expands the cone, so hard turns do not create a perfect
  // laser beam.  When the LCOS is genuinely solved, a small convergence bias
  // keeps short tracking bursts playable without making the cannon steerable.
  const maneuver = Math.abs((ac.g||1)-1)*0.0048 + Math.abs(ac.phi||0)*0.0038 + Math.abs(ac.aoa||0)*0.00042;
  const stickSmear = ((input&&input.roll)||0)*0.0045 + ((input&&input.pitch)||0)*0.0035;
  const baseSpread = clamp(0.0026 + maneuver + Math.abs(stickSmear), 0.0026, 0.034);
  const assist = sol && sol.ready ? clamp((3.8*DEG-sol.boreAng)/(3.8*DEG), 0, 1) : 0;
  const aimBase = (sol && assist>0) ? vnorm(vadd(vscale(b.fwd, 1-assist*0.32), vscale(sol.dir, assist*0.32))) : b.fwd;
  if (sol && sol.ready) applyGunSolutionDamage(sol);
  for (let i=0;i<7;i++){
    const seq=(fireGun._seq=(fireGun._seq||0)+1);
    // During a hard pull/roll the stream smears in the instantaneous turn plane,
    // while each round still inherits ownship velocity.  Straight-and-level fire
    // remains tight enough for a useful shot.
    const yaw=(Math.random()-0.5)*baseSpread*2.2 + ((input&&input.roll)||0)*0.0025 + Math.sin(seq*0.73)*baseSpread*0.25;
    const pitch=(Math.random()-0.5)*baseSpread*2.0 - (ac.g||1)*0.0007 - ((input&&input.pitch)||0)*0.0018;
    let dir=vnorm(vadd(aimBase, vadd(vscale(b.right,yaw), vscale(b.up,pitch))));
    const muzzle=vadd(ac.pos, vadd(vscale(b.fwd, 18), vscale(b.right, -0.8)));
    world.bullets.push({ team:'BLUE', pos:{...muzzle}, prev:{...muzzle}, vel:vadd(ov, vscale(dir, GUN_MUZZLE_V)), t:0, life:2.9, damage:0.34, trail:[{...muzzle}] });
  }
}

function updateBullets(dt){
  ensureCombatArrays();
  for (let i=world.bullets.length-1;i>=0;i--){
    const bl=world.bullets[i]; bl.t+=dt; bl.prev={...bl.pos};
    bl.vel.z -= G0*dt;
    bl.pos.x += bl.vel.x*dt; bl.pos.y += bl.vel.y*dt; bl.pos.z += bl.vel.z*dt;
    if (!bl.trail) bl.trail=[]; bl.trail.push({x:bl.pos.x,y:bl.pos.y,z:bl.pos.z}); if (bl.trail.length>4) bl.trail.shift();
    let spent = bl.t>bl.life || bl.pos.z<terrainH(bl.pos.x,bl.pos.y);
    if (!spent && bl.team==='BLUE'){
      for (const bd of world.bandits){
        if (bd.hp<=0) continue;
        const bp=banditPos(bd);
        const d=distancePointSegment(bp, bl.prev, bl.pos);
        if (d < 44){
          const hitQ = clamp(1 - d/44, 0.18, 1.0);
          bd.hp -= bl.damage * (0.72 + hitQ*0.78);
          bd._lastGunHitT = world.t;
          spent=true;
          if (bd.hp<=0) finishGunKill(bd, 'GUN');
          break;
        }
      }
    }
    if (!spent && bl.team==='BLUE') {
      // Strafing: bullets are real world-space projectiles, so a low pass can
      // damage soft ground vehicles/SAM hardware when the trajectory actually
      // crosses the object footprint.
      const groundTargets = []
        .concat(world.groundMovers||[])
        .concat(world.hvts||[])
        .concat((world.threats||[]).filter(t=>t.x!==undefined && !t.mobile && !t.structure));
      for (const gt of groundTargets){
        if (!gt || gt.destroyed || gt.live===false) continue;
        const gp={x:gt.x, y:gt.y, z:terrainH(gt.x,gt.y)+4};
        if (distancePointSegment(gp, bl.prev, bl.pos) < 18){
          gt.hp = (gt.hp===undefined?1:gt.hp) - bl.damage*0.38;
          spent=true;
          if (gt.hp<=0){
            gt.destroyed=true; gt.live=false; gt.tracking=false; gt._deadT=world.t;
            addEffect(gp, 1.4, 'kill');
            if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:gt.mobile?'mover':'ground', targetName:gt.name||gt.label||'GROUND', targetId:gt.id||null, weapon:'GUN' });
            banner('GUN KILL — '+(gt.name||gt.label||'GROUND'), 1.4);
          }
          break;
        }
      }
    }
    if (spent) world.bullets.splice(i,1);
  }
}

/* hold-to-fire gun: while SPACE is held in A-A/DGFT, fire bursts at a fixed
   cadence; releasing stops. Called every active frame from the main loop. */
let _gunFireT = 0;
function updateGunFire(dt){
  const inGun = (world.masterMode==='A-A' || world.masterMode==='DGFT');
  // Cannon is internal, not a weapon station.  It must fire in A-A/DGFT even if
  // the SMS currently has bombs/AGMs selected from a previous A-G task.
  const ready = inGun && world.masterArm!=='SAFE' && !world.outcome;
  if (input.fire && ready){
    world._gunAudioUntil = world.t + 0.12;
    _gunFireT -= dt;
    if (_gunFireT <= 0){ fireGun(); _gunFireT = 0.075; }    // ballistic bursts; audio bed handles fast BRRRT
  } else {
    _gunFireT = 0;
  }
}

function launchAAM(){
  const ac = world.ac;
  const st = selectedStore();
  if (!st || st.kind!=='aa' || st.qty<=0) { banner('NO A-A MISSILE', 1.2); return; }
  const b = acBasis(ac);
  const prof = missileProfile({team:'BLUE',kind:st.wpn,weapon:st.wpn});
  const arh = /120/.test(st.wpn);
  const maxRange = arh ? 12*NM : 5.5*NM;
  const minRange = arh ? 0.65*NM : 0.20*NM;
  const cone = arh ? 28*DEG : 42*DEG;
  let best=null, bestAng=cone, bestRange=0;
  for (const bd of world.bandits){
    if (bd.hp<=0) continue;
    const rel = vsub({x:bd.x,y:bd.y,z:bd.alt}, ac.pos);
    const rng = vlen(rel);
    if (rng > maxRange || rng < minRange) continue;
    const ang = Math.acos(clamp(vdot(vnorm(rel), b.fwd),-1,1));
    if (ang < bestAng){ bestAng=ang; best=bd; bestRange=rng; }
  }
  if (!best){ banner(arh?'NO FOX-3 SHOT WINDOW':'NO FOX-2 SHOT WINDOW', 1.2); return; }
  st.qty--;
  if (window.recordMissionEvent) recordMissionEvent('weapon_fired', { weapon:st.wpn, station:st.id, targetId:best.id||null, targetName:best.kind||'BANDIT', targetType:'air', range:bestRange });
  const launchDir = vnorm(vsub(vadd(banditPos(best), vscale(banditVel(best), clamp(bestRange/Math.max(420, prof.maxSpd),0.15,2.2))), ac.pos));
  const initialDir = vnorm(vadd(vscale(b.fwd,0.72), vscale(launchDir,0.28)));
  world.sams.push({ team:'BLUE', kind:st.wpn, weapon:st.wpn, seeker:prof.seeker||'', pos:{...ac.pos}, vel: vscale(initialDir, Math.max(ac.tas+170, prof.minSpd)), origin:{...ac.pos},
                    tgt:best, spd:Math.max(ac.tas+170, prof.minSpd), t:0, life:prof.name==='AIM-120'?16:12, energy:1, color:'#a8ffc0', trail:[{...ac.pos}], _prevTrueD:bestRange });
  addEffect(ac.pos, 0.5, 'launch');                 // muzzle / motor flash
  if (window.F16Audio) F16Audio.event('missile');
  world._mslAwayUntil = world.t + 2.8;              // HUD "MSL AWAY" indicator
  banner(arh?'FOX-3':'FOX-2', 1.2);
}

function updateBombs(dt){
  for (let i=world.bombs.length-1;i>=0;i--){
    const bm = world.bombs[i];
    bm.t += dt;
    // laser guidance: steer the velocity toward the spot, but with a capped turn
    // rate and with gravity unopposed — so it only reaches targets inside its
    // glide footprint (release too low / short / fast and it falls away).
    if (bm.guided && bm.target){
      const dx=bm.target.x-bm.pos.x, dy=bm.target.y-bm.pos.y, dz=bm.target.z-bm.pos.z;
      const dist=Math.hypot(dx,dy,dz)||1, sp=Math.hypot(bm.vel.x,bm.vel.y,bm.vel.z)||1;
      const ddx=dx/dist, ddy=dy/dist, ddz=dz/dist;          // desired unit dir
      let cdx=bm.vel.x/sp, cdy=bm.vel.y/sp, cdz=bm.vel.z/sp; // current unit dir
      const k = clamp(2.0*dt, 0, 1);                        // ~2 rad/s steering authority
      let ndx=cdx+(ddx-cdx)*k, ndy=cdy+(ddy-cdy)*k, ndz=cdz+(ddz-cdz)*k;
      if (ndz > 0.05) ndz = 0.05;                           // unpowered: can't pitch up to chase
      const nl=Math.hypot(ndx,ndy,ndz)||1;
      bm.vel.x=ndx/nl*sp; bm.vel.y=ndy/nl*sp; bm.vel.z=ndz/nl*sp;
    }
    bm.vel.z -= G0*dt;                                       // gravity always applies
    bm.pos.x += bm.vel.x*dt; bm.pos.y += bm.vel.y*dt; bm.pos.z += bm.vel.z*dt;
    if (!bm.trail) bm.trail=[]; bm.trail.push({x:bm.pos.x,y:bm.pos.y,z:bm.pos.z}); if (bm.trail.length>22) bm.trail.shift();
    const g = terrainH(bm.pos.x, bm.pos.y);
    if (bm.pos.z <= g){
      addEffect({x:bm.pos.x,y:bm.pos.y,z:g}, 1.3);
      if (window.recordMissionEvent) recordMissionEvent('projectile_impact', { weapon:bm.weapon||'MK82', kind:'bomb', x:bm.pos.x, y:bm.pos.y, z:g });
      if (bm.live) bombImpact(bm.pos.x, bm.pos.y, bm.weapon||'MK82');
      world.bombs.splice(i,1);
    } else if (bm.t > 40){ world.bombs.splice(i,1); }
  }
}
function bombImpact(x,y, weapon){
  weapon = weapon || 'MK82';
  let hit=false;
  for (const b of world.target.buildings){
    if (b.destroyed) continue;
    if (Math.hypot(b.x-x, b.y-y) < 32){
      b.destroyed = true; b._deadT=world.t; hit=true;
      addEffect({x:b.x,y:b.y,z:terrainH(b.x,b.y)+b.h*0.5}, 2.2, 'kill');
      if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:b.primary?'primary':'structure', targetName:b.label||'BUILDING', targetId:b.id||null, weapon:weapon||'UNKNOWN' });
      if (b.primary){
        world.target.destroyed = true;
        banner('★ SHACK — TARGET DESTROYED ★', 3);
        const gen = world._missionGen || 0;
        setTimeout(()=>{
          if ((world._missionGen || 0) === gen && !world.outcome && (!window.GameFlow || GameFlow.isActiveMission())) missionEnd('WIN','MISSION COMPLETE — RTB');
        }, 1200);
      }
    }
  }
  // high-value stationary assets
  for (const v of world.hvts){
    if (v.destroyed) continue;
    if (Math.hypot(v.x-x, v.y-y) < 30){
      v.destroyed=true; v._deadT=world.t; hit=true;
      addEffect({x:v.x,y:v.y,z:terrainH(v.x,v.y)+6}, 2.2, 'kill');
      if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'hvt', targetName:v.name||'HVT', targetId:v.id||null, weapon:weapon||'UNKNOWN' });
      banner('HVT KILL \u2014 '+v.name, 1.8);
    }
  }
  // moving ground targets
  for (const m of world.groundMovers){
    if (m.destroyed) continue;
    if (Math.hypot(m.x-x, m.y-y) < 26){
      m.destroyed=true; m._deadT=world.t; if(m.live!==undefined) m.live=false; hit=true;
      addEffect({x:m.x,y:m.y,z:terrainH(m.x,m.y)+4}, 2.2, 'kill');
      if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'mover', targetName:m.name||'GROUND', targetId:m.id||null, weapon:weapon||'UNKNOWN' });
      banner('GROUND KILL \u2014 '+m.name, 1.6);
    }
  }
  // ground structures (bunkers / facilities) — also clears the dual-ref emitter
  for (const s of world.structures){
    if (s.destroyed) continue;
    if (Math.hypot(s.x-x, s.y-y) < 34){
      s.destroyed=true; s._deadT=world.t; if(s.live!==undefined) s.live=false; s.tracking=false; hit=true;
      addEffect({x:s.x,y:s.y,z:terrainH(s.x,s.y)+(s.geom?s.geom.h*0.5:6)}, 2.4, 'kill');
      if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'structure', targetName:s.name||'FACILITY', targetId:s.id||null, weapon:weapon||'UNKNOWN' });
      banner('STRUCTURE KILL \u2014 '+(s.name||'FACILITY'), 1.8);
    }
  }
  // static SAM sites / launchers
  for (const t of world.threats){
    if (t.destroyed || t.mobile || t.structure || t.x===undefined) continue;   // movers & structures handled above
    if (Math.hypot(t.x-x, t.y-y) < 30){
      t.destroyed=true; t._deadT=world.t; t.live=false; t.tracking=false; hit=true;
      addEffect({x:t.x,y:t.y,z:terrainH(t.x,t.y)+5}, 2.2, 'kill');
      if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'sam', targetName:t.name||'SAM', targetId:t.id||null, weapon:weapon||'UNKNOWN' });
      banner('SAM KILL \u2014 '+(t.name||'SAM'), 1.8);
    }
  }
  if (!hit){ if (window.recordMissionEvent) recordMissionEvent('weapon_missed', { weapon:weapon||'UNKNOWN' }); banner('MISS', 1.0); }
}

function addEffect(pos, dur, kind){ world.effects.push({pos:{...pos}, t:0, dur, kind:kind||'blast'}); }
function updateEffects(dt){
  ensureCombatArrays();
  for (let i=world.effects.length-1;i>=0;i--){
    const e=world.effects[i]; e.t+=dt; if (e.t>=e.dur) world.effects.splice(i,1);
  }
  for (let i=world.decoys.length-1;i>=0;i--){
    const d=world.decoys[i]; d.t+=dt;
    const drag=d.kind==='chaff'?0.965:0.985;
    d.vel.x*=Math.pow(drag, dt*60); d.vel.y*=Math.pow(drag, dt*60);
    d.vel.z -= (d.kind==='flare'?4.5:1.1)*dt;
    d.pos.x+=d.vel.x*dt; d.pos.y+=d.vel.y*dt; d.pos.z+=d.vel.z*dt;
    if (d.pos.z<terrainH(d.pos.x,d.pos.y)+1 || d.t>=d.life) world.decoys.splice(i,1);
  }
}

/* ---------- guided missiles (RED SAM + BLUE AAM) ---------- */
function updateMissiles(dt){
  ensureCombatArrays();
  const ac = world.ac;
  for (let i=world.sams.length-1;i>=0;i--){
    const m = world.sams[i];
    m.t = (m.t||0) + dt;
    const prof = missileProfile(m);
    seedMissile(m, prof);

    let tgtPos = liveTargetPos(m);
    const trueTgtPos = tgtPos ? {...tgtPos} : null;
    const tgtObj = missileTargetObject(m);
    if (!tgtPos || m.t>m.life){ world.sams.splice(i,1); continue; }

    let notch = 0, decoyed = false;
    if (!m.groundPos){
      notch = notchQuality(m, tgtObj, tgtPos);
      const dpos = chooseDecoyTarget(m, tgtObj, tgtPos, notch);
      if (dpos){ tgtPos=dpos; decoyed=true; }
      else if (m._seekerDriftT>0 && m._lastTgtPos){
        m._seekerDriftT-=dt;
        const tv=objectVel(tgtObj||{});
        tgtPos=vadd(m._lastTgtPos, vscale(tv, Math.max(0,0.35-m._seekerDriftT)));
      } else {
        m._lastTgtPos={...trueTgtPos};
      }
    }

    const toTgt=vsub(tgtPos, m.pos);
    const d=vlen(toTgt);
    const desired=vnorm(toTgt);
    let dir=vnorm(m.vel && vlen(m.vel)>1 ? m.vel : desired);
    const off=Math.acos(clamp(vdot(dir, desired), -1, 1));
    const targetBehind = vdot(dir, desired) < -0.04;

    let maxTurn=prof.maxTurn * (m.t<=prof.burn ? 1 : prof.coastTurn);
    if (notch>0.55 && isRadarMissile(m)) maxTurn *= (1 - 0.55*notch);
    const maxStep=Math.max(0.0001, maxTurn*dt);
    const step=Math.min(off, maxStep);
    const frac=off>0.0005 ? step/off : 1;
    dir=vnorm(vadd(vscale(dir, 1-frac), vscale(desired, frac)));

    const turnLoad = clamp(step/maxStep,0,1);
    m.energy -= (m.t<=prof.burn ? prof.burnDrain : prof.coastDrain)*dt + turnLoad*prof.turnDrain*dt;
    if (off > (prof.seekerLimit||prof.breakAng) && m.t>0.45) m._lostT = (m._lostT||0) + dt*1.4;
    else if (off > prof.breakAng && m.t>0.75) m._lostT = (m._lostT||0) + dt;
    else m._lostT = Math.max(0,(m._lostT||0)-dt*0.65);
    if (targetBehind && m.t>0.55) m._behindT = (m._behindT||0) + dt; else m._behindT = Math.max(0,(m._behindT||0)-dt*0.5);
    if (notch>0.72 && isRadarMissile(m)) m._lostT += notch*0.28*dt;

    const accel = m.t<=prof.burn ? prof.accel : -prof.drag;
    m.spd = clamp((m.spd||prof.minSpd) + accel*dt - turnLoad*prof.turnDrag*dt, prof.minSpd, prof.maxSpd);
    if (m.t>prof.burn && m.spd <= prof.minSpd+8) m.energy -= 0.11*dt;
    m.vel = vscale(dir, m.spd);
    m.pos = vadd(m.pos, vscale(m.vel, dt));
    if (!m.trail) m.trail=[]; m.trail.push({x:m.pos.x,y:m.pos.y,z:m.pos.z}); if (m.trail.length>18) m.trail.shift();

    const newTrueD = trueTgtPos ? vlen(vsub(trueTgtPos, m.pos)) : d;
    const prevTrueD = isFinite(m._prevTrueD) ? m._prevTrueD : 1e9;
    const closingRate = (prevTrueD - newTrueD) / Math.max(0.001, dt);
    const closest = Math.min(m._pd===undefined?1e9:m._pd, newTrueD);
    const hasOvershot = closest < 1450 && newTrueD > closest + Math.max(160, prof.prox*2.5);
    if (!m.groundPos && m.t>0.75 && (hasOvershot || (closest < 2200 && closingRate < -35 && off > 38*DEG))) m._divergeT = (m._divergeT||0) + dt;
    else m._divergeT = Math.max(0,(m._divergeT||0)-dt*0.40);
    const passedClose = closest < prof.prox*1.9 && newTrueD > closest + prof.prox*1.25;
    m._pd = closest; m._prevTrueD = newTrueD;
    const hitGround = m.pos.z < terrainH(m.pos.x, m.pos.y);

    // Energy-maneuverability failure: once the target crosses behind the seeker or
    // the missile is diverging after closest approach, the missile goes safe.  It
    // must not turn around and reacquire like a boomerang.
    if (!m.groundPos && (m.energy<=0.05 || m._lostT>prof.breakTime || m._behindT>(prof.noReacquireT||0.22) || m._divergeT>0.18 || (m.t>1.2 && passedClose))){
      selfDestructMissile(i, m, 'self_destruct');
      continue;
    }

    if (m.groundPos){                          // guided surface attack (AGM / HARM)
      const gd = vlen(vsub(tgtPos, m.pos));
      const prox = gd<prof.prox || (gd<180 && m._gpd!==undefined && gd>m._gpd);  // hit or closest-approach
      if (prox || hitGround || m.energy<=0.03){
        const ip = (gd<220) ? tgtPos : {x:m.pos.x, y:m.pos.y, z:m.pos.z};
        addEffect(ip, 1.3);
        if (window.recordMissionEvent) recordMissionEvent('projectile_impact', { weapon:m.weapon||m.kind||'MISSILE', kind:m.kind||'missile', x:ip.x, y:ip.y, z:ip.z });
        if (m.live!==false && m.energy>0.02){
          if (m.kind==='HARM' || /HARM/.test(m.kind||'')){
            if (m.emitter && m.emitter.live){
              m.emitter.live=false; m.emitter.tracking=false;
              m.emitter.destroyed=true; m.emitter._deadT=world.t;
              if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'sam', targetName:m.emitter.name||'EMITTER', targetId:m.emitter.id||null, weapon:m.weapon||m.kind||'AGM-88 HARM' });
              banner('HARM KILL — '+m.emitter.name, 2.0);
            } else banner('HARM IMPACT', 1.2);
          } else {
            bombImpact(ip.x, ip.y, m.weapon||m.kind||'AGM');
          }
        }
        world.sams.splice(i,1);
      } else { m._gpd = gd; }
      continue;
    }

    const activeD = vlen(vsub(tgtPos, m.pos));
    if (decoyed && activeD < prof.prox){
      selfDestructMissile(i, m, 'decoy');
      continue;
    }
    if (newTrueD < prof.prox){
      addEffect(m.pos, 1.0);
      if (window.recordMissionEvent) recordMissionEvent('projectile_impact', { weapon:m.weapon||m.kind||'MISSILE', kind:m.kind||'missile', x:m.pos.x, y:m.pos.y, z:m.pos.z });
      if (m.team==='RED'){
        let pHit = 0.86;
        if (ac.g>4.5) pHit -= 0.16;
        if (isIrMissile(m) && world._flareT>0) pHit -= 0.22;
        if (isRadarMissile(m) && world._chaffT>0) pHit -= 0.20;
        pHit -= notch*0.26;
        if (m.energy<0.18) pHit -= 0.28;
        if (Math.random() < clamp(pHit,0.10,0.92)) damage(ac, 38, m.kind==='RED_AAM'?'AAM HIT':'SAM HIT');
        else banner('MISSILE DEFEATED', 1.4);
      } else if (m.tgt){
        if (m.energy>0.11){
          m.tgt.hp = 0;
          addEffect({x:m.tgt.x,y:m.tgt.y,z:m.tgt.alt},1.2);
          if (window.recordMissionEvent) recordMissionEvent('kill', { targetType:'air', targetName:m.tgt.kind||'BANDIT', targetId:m.tgt.id||null, weapon:m.kind||'AAM' });
          banner('SPLASH — '+m.tgt.kind,1.6);
        } else banner('MISSILE OUT OF ENERGY', 1.2);
      }
      world.sams.splice(i,1);
    } else if (hitGround){
      world.sams.splice(i,1);
    }
  }
}

/* ---------- SAM site logic ---------- */
world._flareT = 0;
world._chaffT = 0;
function dropFlares(){
  ensureCombatArrays();
  const ac=world.ac, b=acBasis(ac), v=acVel(ac);
  let used=false, flareUsed=false, chaffUsed=false;
  if (ac.flares>0){ ac.flares--; world._flareT = 2.2; used=true; flareUsed=true; }
  if (ac.chaff===undefined) ac.chaff=20;
  if (ac.chaff>0){ ac.chaff--; world._chaffT = 2.8; used=true; chaffUsed=true; }
  if (!used) return;
  const pos=vadd(ac.pos, vscale(b.fwd,-14));
  dropCountermeasureBurst(pos, vadd(v, vscale(b.fwd,-130)), 'BLUE', {flares: flareUsed?3:0, chaff: chaffUsed?3:0});
  if (window.recordMissionEvent) recordMissionEvent('countermeasure', { flares:ac.flares, chaff:ac.chaff, team:'BLUE' });
  banner('FLARE / CHAFF',0.7);
}

function updateThreats(dt){
  if (world._flareT>0) world._flareT -= dt;
  if (world._chaffT>0) world._chaffT -= dt;
  const ac = world.ac;
  const agl = ac.pos.z - terrainH(ac.pos.x, ac.pos.y);
  let anyTrack=false;
  // bound airborne RED missiles — a layered SAM zone would otherwise flood the
  // scene and tank the frame rate on slower machines.
  const RED_CAP = 8;
  let redInAir = 0; for (const s of world.sams) if (s.team==='RED') redInAir++;
  const nearBase = Math.hypot(ac.pos.x, ac.pos.y) < BASE_SAFE_R;   // safe corridor over home
  const fireGap = 9 / (world._aggr || 0.8);                        // EASY ~16s … ACE ~7s
  for (const th of world.threats){
    if (!th.live){ th.tracking=false; continue; }
    updateSamScan(th, dt);                              // advance scan pattern / handle frequency hops
    const jammed = emitterJammed(th);                   // EW pod suppressing this emitter?
    th.jammedNow = jammed;
    const d = distTo(th.x, th.y);
    const radarVisible = (typeof samRadarCanSee==='function') ? samRadarCanSee(th, ac.pos) : true;
    th._terrainMasked = !radarVisible;
    const inRing = d < th.radius && agl > 120 && radarVisible && !world.outcome && th.hostile!==false && !nearBase && !jammed;
    th.tracking = inRing;
    if (inRing){
      anyTrack=true;
      th._dwell = (th._dwell||0) + dt;
      if (th._dwell > 4 && world.t - th.launchT > fireGap && redInAir < RED_CAP && (!world._tutorial || world._tutFire)){
        th.launchT = world.t; redInAir++;
        const z = terrainH(th.x,th.y);
        const dir = vnorm(vsub(ac.pos, {x:th.x,y:th.y,z:z+4}));
        const sprof = missileProfile({team:'RED',kind:'SAM',weapon:th.name||'SAM'});
        world.sams.push({ team:'RED', kind:'SAM', weapon:th.name||'SAM', seeker:'RADAR', pos:{x:th.x,y:th.y,z:z+4}, vel:vscale(dir,Math.max(190,sprof.minSpd*0.72)), spd:Math.max(190,sprof.minSpd*0.72), t:0, life:18, energy:1, color:th.color,
                          origin:{x:th.x,y:th.y,z:z+4}, src:th, name:th.name, trail:[{x:th.x,y:th.y,z:z+4}] });
        if (window.ReplayRecorder) ReplayRecorder.recordEvent('missile_launch',{team:'RED',source:th.name||'SAM',kind:'SAM'});
        banner('★ MISSILE LAUNCH ★', 1.6); flash(0.4);
      }
    } else { th._dwell = 0; }
  }
  world._rwrActive = anyTrack;
  if (world.ecm.jam && world.ecm.jam.length){      // free jam slots whose emitter died or hopped its band away
    const freed = ecmSyncSlots();
    if (freed){ banner('JAM SLOT FREED \u2014 NO SIGNAL', 1.0); if (typeof refreshAllMfd==='function') refreshAllMfd(); }
  }
}

/* ---------- bandit motion + firing AI ---------- */
function banditSetState(bd, state, dur){
  bd.aiState = state;
  bd._stateUntil = world.t + (dur || 2.5);
}
function banditTurnToward(bd, want, maxRate, dt){
  const step = clamp(angWrap(want - (bd.psi||0)), -maxRate*dt, maxRate*dt);
  bd.psi = wrap2pi((bd.psi||0) + step);
}
function banditAltitudeToward(bd, targetAlt, dt){
  const ground = terrainH(bd.x, bd.y) + 550;
  const wanted = Math.max(ground, targetAlt || ground);
  const climbRate = 38 + (world.difficulty||0)*7; // m/s, restrained to avoid vertical tornadoes
  bd.alt = (bd.alt||ground) + clamp(wanted-(bd.alt||ground), -climbRate*dt, climbRate*dt);
}
function incomingMissileForBandit(bd){
  let best=null, bestScore=0;
  for (const m of world.sams){
    if (!m || m.team!=='BLUE' || m.groundPos || m.tgt!==bd) continue;
    const mp=m.pos||v3(0,0,0), bp=banditPos(bd);
    const d=vlen(vsub(mp,bp));
    const closing=vdot(vnorm(m.vel||vsub(bp,mp)), vnorm(vsub(bp,mp)))*(m.spd||vlen(m.vel||v3()));
    if (d>13000 || closing<80) continue;
    const score=(13000-d)/13000 + closing/900;
    if(score>bestScore){bestScore=score;best=m;}
  }
  return best;
}
function banditDropDefensive(bd, threat){
  const diff=world.difficulty||0;
  if (diff<2 || !threat) return;
  if (bd.cmFlares===undefined){
    const base=[0,0,3,5,4][diff] || 3;
    bd.cmFlares = base + Math.floor(Math.random()*2);
    bd.cmChaff  = base + 1 + Math.floor(Math.random()*3);
    bd._cmSkill = clamp(([0,0,0.56,0.70,0.62][diff]||0.55) + (Math.random()-0.5)*0.18, 0.35, 0.84);
  }
  const radar=isRadarMissile(threat), ir=isIrMissile(threat);
  const d=vlen(vsub(threat.pos, banditPos(bd)));
  if (d>12000) return;
  const tti = d / Math.max(260, threat.spd || vlen(threat.vel||v3(0,0,0)) || 600);
  // Delayed / imperfect reactions make missile shots scoreable.  The bandit sets
  // a reaction clock for each inbound missile; some react late, some not at all.
  const tid = threat.id || threat._cmId || (threat._cmId = 'msl_'+Math.random().toString(36).slice(2,8));
  if (bd._cmThreatId !== tid){
    bd._cmThreatId = tid;
    bd._cmWillReact = Math.random() < bd._cmSkill;
    bd._cmReactAt = world.t + (diff>=3 ? (0.35+Math.random()*1.25) : (0.75+Math.random()*1.75));
    if (diff>=4) bd._cmReactAt += Math.random()*0.45; // level 5 keeps the fight fair, not invincible
  }
  if (!bd._cmWillReact || world.t < bd._cmReactAt) return;
  const cool=diff>=3?1.10:1.55;
  if (world.t-(bd._lastCm||-99)<cool) return;
  if (tti > 8.0 && d>7000) return;
  let flareCount = ir ? Math.min(bd.cmFlares||0, diff>=3?3:2) : Math.min(bd.cmFlares||0, 1);
  let chaffCount = radar ? Math.min(bd.cmChaff||0, diff>=3?4:3) : Math.min(bd.cmChaff||0, 1);
  if (flareCount<=0 && chaffCount<=0) return;
  bd.cmFlares -= flareCount; bd.cmChaff -= chaffCount; bd._lastCm=world.t;
  const f={x:Math.sin(bd.psi||0),y:Math.cos(bd.psi||0),z:0};
  const v=banditVel(bd);
  const pos={x:bd.x-f.x*22,y:bd.y-f.y*22,z:bd.alt-3};
  dropCountermeasureBurst(pos, vadd(v, vscale(f,-175)), 'RED', {flares:flareCount, chaff:chaffCount});
  addEffect(pos, 0.42, 'launch');
  if (window.recordMissionEvent) recordMissionEvent('countermeasure', { team:'RED', actor:bd.id||null, flares:flareCount, chaff:chaffCount, remainFlares:bd.cmFlares, remainChaff:bd.cmChaff });
}
function banditTargetState(bd, rng, verticalAbs){
  const now = world.t;
  if (bd._stateUntil && now < bd._stateUntil) return bd.aiState || 'INTERCEPT';
  if (rng < 1250 || (rng < 2500 && verticalAbs > 1600)){ banditSetState(bd, 'EXTEND', 3.8 + Math.random()*1.8); return bd.aiState; }
  if ((bd.hp||1) < 0.45 && rng < 9000){ banditSetState(bd, 'EVADE', 3.0 + Math.random()*2.0); return bd.aiState; }
  if (rng > 15000){ banditSetState(bd, 'INTERCEPT', 2.5); return bd.aiState; }
  if (rng > 4200){ banditSetState(bd, 'CHASE', 2.5); return bd.aiState; }
  if (rng > 1800){ banditSetState(bd, Math.random()<0.55?'EVADE':'CHASE', 2.0 + Math.random()*1.5); return bd.aiState; }
  banditSetState(bd, 'EXTEND', 4.0); return bd.aiState;
}
function updateBandits(dt){
  const ac = world.ac;
  const diff = world.difficulty || 0;
  const shooters = diff >= 2;          // HARD / ACE / AIR SUPER
  const RED_CAP = 8;
  let redInAir = 0; for (const s of world.sams) if (s.team==='RED') redInAir++;
  const acFwd = {x:Math.sin(ac.psi), y:Math.cos(ac.psi)};

  for (const bd of world.bandits){
    if (bd.hp<=0) continue;
    if (!bd.id && window.ReplayUtils) ReplayUtils.ensureIds();
    if (bd._phase===undefined) bd._phase = Math.random()*Math.PI*2;
    const hostile = bd.kind==='HOSTILE';
    const dx = ac.pos.x - bd.x, dy = ac.pos.y - bd.y;
    const range2 = Math.hypot(dx,dy);
    const dz = ac.pos.z - bd.alt;
    const away = wrap2pi(Math.atan2(-dx,-dy));
    let desiredPsi = bd.psi, desiredAlt = bd.alt, targetSpeed = bd.spd || 220;

    if (shooters && hostile && !world.outcome){
      const missileThreat = incomingMissileForBandit(bd);
      if (missileThreat){ bd._defThreat=missileThreat; banditDropDefensive(bd, missileThreat); }
      if (!bd.aiState) bd.aiState = 'INTERCEPT';
      if (missileThreat && bd.aiState!=='EVADE'){
        bd.aiState='EVADE'; bd._stateUntil=world.t + 4.5 + Math.random()*2.5; bd._evadeDir = Math.random()<0.5?-1:1;
      } else if ((range2 < 1300 || (range2 < 3400 && Math.abs(dz)>2300)) && bd.aiState!=='EXTEND'){
        bd.aiState='EXTEND'; bd._stateUntil=world.t + 4.0 + Math.random()*2.5; bd._extendPsi = away + (Math.random()*0.5-0.25);
      } else if ((bd.aiState==='EXTEND' || bd.aiState==='EVADE') && world.t > (bd._stateUntil||0)){
        bd.aiState='REATTACK'; bd._stateUntil=world.t + 2.4 + Math.random()*1.2;
      } else if (bd.aiState==='REATTACK' && world.t > (bd._stateUntil||0)){
        bd.aiState = range2 > 6500 ? 'INTERCEPT' : 'CHASE';
      } else if (bd.aiState!=='EXTEND' && bd.aiState!=='EVADE' && bd.aiState!=='REATTACK'){
        bd.aiState = range2 > 8500 ? 'INTERCEPT' : (range2 > 2300 ? 'CHASE' : 'EXTEND');
        if (bd.aiState==='EXTEND'){ bd._stateUntil=world.t+4.5; bd._extendPsi=away; }
      }

      if (bd.aiState==='INTERCEPT'){
        const lead = clamp(range2/5000,0.15,1.2);
        const tx = ac.pos.x + acFwd.x * ac.tas * lead;
        const ty = ac.pos.y + acFwd.y * ac.tas * lead;
        desiredPsi = Math.atan2(tx-bd.x, ty-bd.y);
        desiredAlt = diff>=4 ? Math.max(terrainH(bd.x,bd.y)+850, ac.pos.z + 120) : ac.pos.z + 250;
        targetSpeed = diff>=4 ? 285 : (diff>=3 ? 270 : 250);
      } else if (bd.aiState==='CHASE'){
        // Aim at the player's rear quarter instead of the exact aircraft position.
        const side = Math.sin(world.t*0.45 + bd._phase) > 0 ? 1 : -1;
        const tx = ac.pos.x - acFwd.x*2600 + Math.cos(ac.psi)*side*700;
        const ty = ac.pos.y - acFwd.y*2600 - Math.sin(ac.psi)*side*700;
        desiredPsi = Math.atan2(tx-bd.x, ty-bd.y) + Math.sin(world.t*0.8+bd._phase)*0.10;
        desiredAlt = ac.pos.z + Math.sin(world.t*0.55+bd._phase)*350;
        targetSpeed = diff>=4 ? 275 : (diff>=3 ? 255 : 240);
      } else if (bd.aiState==='EVADE'){
        const th=bd._defThreat && world.sams.indexOf(bd._defThreat)>=0 ? bd._defThreat : null;
        if (th){
          const awayM=wrap2pi(Math.atan2(bd.x-th.pos.x, bd.y-th.pos.y));
          if (isRadarMissile(th)) desiredPsi = awayM + (bd._evadeDir||1)*(Math.PI/2 + 0.18*Math.sin(world.t*1.6+bd._phase)); // notch beam
          else desiredPsi = awayM + (bd._evadeDir||1)*(0.42 + 0.22*Math.sin(world.t*1.2+bd._phase));                 // flare and drag away
          desiredAlt = bd.alt + (bd._evadeDir||1)*(diff>=3?420:300)*Math.sin(world.t*1.15+bd._phase);
        } else {
          desiredPsi = away + (bd._evadeDir||1)*(0.55 + 0.25*Math.sin(world.t*1.1+bd._phase));
          desiredAlt = ac.pos.z + (bd._evadeDir||1)*650*Math.sin(world.t*0.7+bd._phase);
        }
        targetSpeed = diff>=4 ? 305 : (diff>=3 ? 295 : 270);
      } else if (bd.aiState==='EXTEND'){
        desiredPsi = (bd._extendPsi!==undefined?bd._extendPsi:away) + Math.sin(world.t*0.65+bd._phase)*0.16;
        desiredAlt = ac.pos.z + Math.sin(world.t*0.35+bd._phase)*500;
        targetSpeed = diff>=4 ? 310 : (diff>=3 ? 295 : 275);
      } else { // REATTACK
        const tx = ac.pos.x - acFwd.x*1700;
        const ty = ac.pos.y - acFwd.y*1700;
        desiredPsi = Math.atan2(tx-bd.x, ty-bd.y);
        desiredAlt = ac.pos.z + 150;
        targetSpeed = diff>=4 ? 285 : 265;
      }
    } else {
      bd.aiState = bd.aiState || 'PATROL';
      desiredPsi = wrap2pi(bd.psi + 0.35*Math.sin(world.t*0.18+bd._phase));
      desiredAlt = bd.alt + Math.sin(world.t*0.25+bd._phase)*120;
      targetSpeed = bd.kind==='HVA-AIR' ? 150 : 210;
    }

    const close = range2 < 2400;
    const maxTurn = (shooters && hostile) ? (close ? 0.34 : (diff>=3 ? 0.52 : 0.44)) : 0.20;
    const dpsi = clamp(angWrap(desiredPsi-bd.psi), -maxTurn*dt, maxTurn*dt);
    bd.psi = wrap2pi(bd.psi + dpsi);

    const ground = terrainH(bd.x,bd.y);
    desiredAlt = clamp(desiredAlt, ground+700, 12000);
    // Avoid unrealistic top/bottom stacking at close range: extend laterally and converge altitude slowly.
    if (close && Math.abs(dz)>1800) desiredAlt = bd.alt + clamp(ac.pos.z-bd.alt, -250, 250);
    const climbRate = shooters && hostile ? 42 : 22;
    bd.alt += clamp(desiredAlt-bd.alt, -climbRate*dt, climbRate*dt);
    bd.alt = Math.max(bd.alt, terrainH(bd.x,bd.y)+500);

    bd.spd += clamp(targetSpeed-bd.spd, -35*dt, 30*dt);
    bd.spd = clamp(bd.spd, bd.kind==='HVA-AIR'?120:165, diff>=4?330:310);
    bd.x += Math.sin(bd.psi)*bd.spd*dt;
    bd.y += Math.cos(bd.psi)*bd.spd*dt;

    // Weapons employment: only in sane intercept/chase geometry, not while extending/evasive.
    if (shooters && hostile && !world.outcome && bd.aiState!=='EXTEND' && bd.aiState!=='EVADE'){
      const rel = vsub(ac.pos, {x:bd.x, y:bd.y, z:bd.alt});
      const rng = vlen(rel);
      const fwd = { x:Math.sin(bd.psi), y:Math.cos(bd.psi), z:0 };
      const ang = Math.acos(clamp(vdot(vnorm(rel), fwd), -1, 1));
      const cool = diff>=3 ? 8.5 : 12;
      if (rng < 10*NM && rng > 1800 && Math.abs(rel.z)<2600 && ang < 26*DEG && redInAir < RED_CAP && (world.t - (bd._lastShot||-99)) > cool){
        bd._lastShot = world.t; redInAir++;
        const dir = vnorm(rel);
        const rprof = missileProfile({team:'RED',kind:'RED_AAM',weapon:'RED_AAM'});
        world.sams.push({ team:'RED', kind:'RED_AAM', weapon:'RED_AAM', seeker:'RADAR', pos:{x:bd.x,y:bd.y,z:bd.alt}, vel:vscale(dir, bd.spd+180),
                          spd:Math.max(bd.spd+180,rprof.minSpd), t:0, life:15, energy:1, color:'#ff5050', origin:{x:bd.x,y:bd.y,z:bd.alt}, trail:[{x:bd.x,y:bd.y,z:bd.alt}] });
        if (window.recordMissionEvent) recordMissionEvent('missile_launch', { weapon:'RED_AAM', actor:bd.id||null, targetId:'player' });
        banner('★ MISSILE LAUNCH (AIR) ★', 1.4); flash(0.35);
      }
    }
  }
  if ((world.difficulty||0)>=4 && !world.outcome){
    const liveHostiles = world.bandits.filter(b=>b.kind==='HOSTILE' && b.hp>0).length;
    if (liveHostiles===0 && world.bandits.length){ missionEnd('WIN','AIR SUPERIORITY COMPLETE'); }
  }
}

/* =====================================================================
   HUD
   ===================================================================== */
function drawCombatHUD(r3, ctx){
  const ac = world.ac, W=r3.W, H=r3.H;
  const cx=W/2, cy=H/2;
  ctx.save();
  const hudGroundLOS = (p,h=35)=>{
    if (!p || typeof terrainLineClear !== 'function') return true;
    return terrainLineClear(r3.cam.x,r3.cam.y,r3.cam.z,p.x,p.y,(p.z||terrainH(p.x,p.y))+h,45);
  };
  ctx.strokeStyle = NEON; ctx.fillStyle = NEON; ctx.lineWidth = 1.3;
  ctx.font = '12px "Courier New"'; ctx.textAlign='left';

  /* ---- gun boresight cross (waterline pipper) ---- */
  ctx.strokeStyle=NEON; ctx.lineWidth=1.3; ctx.beginPath();
  ctx.moveTo(cx-20, cy); ctx.lineTo(cx-7, cy);
  ctx.moveTo(cx+7, cy); ctx.lineTo(cx+20, cy);
  ctx.moveTo(cx, cy-20); ctx.lineTo(cx, cy-7);
  ctx.stroke();

  /* ---- steerpoint cue (nav) — FlightHUD has no steerpoint ---- */
  const wp = curWP();
  const brg = bearingTo(wp.x,wp.y)*RAD;
  const dnm = distTo(wp.x,wp.y)/NM;
  const vel = acVel(ac);
  const gs = Math.max(1, Math.hypot(vel.x,vel.y));
  const eta = distTo(wp.x,wp.y)/gs;
  ctx.fillStyle=NEON; ctx.font='12px "Courier New"'; ctx.textAlign='left';
  ctx.fillText('STPT '+wp.id+' '+wp.name, 70, H-66);
  ctx.fillText('BRG '+String(Math.round(brg)).padStart(3,'0')+'  '+dnm.toFixed(1)+'NM', 70, H-50);
  ctx.fillText('ETA '+fmtMMSS(eta), 70, H-34);

  /* ---- master mode / arm / store (combat) ---- */
  ctx.textAlign='right'; ctx.font='bold 13px "Courier New"';
  ctx.fillStyle = world.masterMode==='A-G' ? '#ffd24d' : (world.masterMode==='A-A'||world.masterMode==='DGFT') ? '#ff8a5b' : NEON;
  ctx.fillText(world.masterMode, W-70, H-82);
  ctx.fillStyle = world.masterArm==='ARM' ? '#ff5b5b' : world.masterArm==='SIM' ? '#ffd24d' : NEON;
  ctx.fillText('ARM '+world.masterArm, W-70, H-66);
  // publish HUD anchor boxes (fractions of this canvas) for the tutorial pointer
  { world._hudAnchors = world._hudAnchors || {};
    world._hudAnchors.mode  = { canvas:'window', fx:(W-42)/W, fy:(H-74)/H, fw:108/W, fh:52/H };
    world._hudAnchors.steer = { canvas:'window', fx:0.5,      fy:0.5,      fw:190/W, fh:190/H }; }
  const st = selectedStore();
  ctx.fillStyle=NEON; ctx.font='12px "Courier New"';
  if (st) ctx.fillText(st.wpn+'  x'+st.qty, W-70, H-50);
  ctx.fillText('G '+ac.g.toFixed(1)+'  AOA '+ac.aoa.toFixed(0), W-70, H-34);

  /* ---- gear flag ---- */
  ctx.textAlign='center'; ctx.font='11px "Courier New"';
  if (ac.gear){ ctx.fillStyle = ac.onGround?NEON:'#ffd24d'; ctx.fillText('GEAR DN', cx, H-100); }

  /* ---- A-G aiming cue: only Mk-82 gets CCIP, and only with no laser. ---- */
  if (world.masterMode==='A-G' && !ac.onGround){
    const agStore = selectedStore();
    const mk82 = !!(agStore && agStore.kind==='ag' && /MK-?82/i.test(agStore.wpn||''));
    const laze = (typeof laserDesignation==='function') ? laserDesignation() : null;
    if (mk82 && laze){
      const p = r3.project({x:laze.x, y:laze.y, z:laze.z});
      if (p && p.z>1 && hudGroundLOS(laze,45)){
        ctx.strokeStyle = C_RED || '#ff5050'; ctx.lineWidth=1.6;
        ctx.beginPath();                                    // diamond on the laser spot
        ctx.moveTo(p.x,p.y-7); ctx.lineTo(p.x+7,p.y); ctx.lineTo(p.x,p.y+7); ctx.lineTo(p.x-7,p.y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x,p.y,11,0,2*Math.PI); ctx.stroke();
        ctx.fillStyle = C_RED || '#ff5050'; ctx.font='11px "Courier New"'; ctx.textAlign='left';
        const slant = Math.hypot(laze.x-ac.pos.x, laze.y-ac.pos.y, laze.z-ac.pos.z)/NM;
        ctx.fillText('LGB — LASER '+slant.toFixed(1)+'NM', p.x+13, p.y-8);
      }
    } else if (mk82 && !laze){
      const imp = predictImpact(ac);
      if (imp){
        const p = r3.project(imp);
        if (p && p.z>1 && hudGroundLOS(imp,35)){
          ctx.strokeStyle = NEONHI; ctx.lineWidth=1.6;
          ctx.beginPath(); ctx.arc(p.x,p.y,6,0,2*Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(p.x,p.y); ctx.stroke();
          const tb = world.target.buildings.find(b=>b.primary && !b.destroyed);
          if (tb){
            const miss = Math.hypot(tb.x-imp.x, tb.y-imp.y);
            ctx.fillStyle = miss<60?'#ffd24d':NEON; ctx.font='11px "Courier New"'; ctx.textAlign='left';
            ctx.fillText(miss<60?'IN RNG — PICKLE':'CCIP MK-82', p.x+10, p.y-8);
          }
        }
      }
    }
  }


  /* ---- sensor designator cue in the outside view ----
     Sensor locks now get a dedicated HUD/POV symbol independent of weapon
     selection.  The TGP/FCR/HAD can designate a ground object or air target,
     and the pilot should be able to see that selected object out the window as
     soon as it is actually visible in the camera view. */
  {
    const red = (typeof C_RED!=='undefined') ? C_RED : '#ff5b5b';
    const yel = (typeof C_YEL!=='undefined') ? C_YEL : '#ffd24d';
    const hot = (typeof C_HOT!=='undefined') ? C_HOT : NEONHI;
    const drawGroundDesignator = (obj, label, color, laserOn)=>{
      if (!obj || obj.destroyed) return;
      const gz = (obj.z!==undefined) ? obj.z : terrainH(obj.x,obj.y);
      const h = obj.h || (obj.geom&&obj.geom.h) || 18;
      const p3 = {x:obj.x, y:obj.y, z:gz + h + 14};
      const p = r3.project(p3);
      if (!p || p.z<=1 || !hudGroundLOS(p3,35)) return;
      const pulse = 0.65 + 0.35*Math.sin(world.t*8);
      const s = laserOn ? 18 : 14;
      ctx.save();
      ctx.strokeStyle = laserOn ? red : color;
      ctx.fillStyle = laserOn ? red : color;
      ctx.lineWidth = laserOn ? 2.0 : 1.5;
      ctx.globalAlpha = laserOn ? 1 : pulse;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y-s); ctx.lineTo(p.x+s, p.y); ctx.lineTo(p.x, p.y+s); ctx.lineTo(p.x-s, p.y); ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x-s-10,p.y); ctx.lineTo(p.x-s-3,p.y);
      ctx.moveTo(p.x+s+3,p.y); ctx.lineTo(p.x+s+10,p.y);
      ctx.moveTo(p.x,p.y-s-10); ctx.lineTo(p.x,p.y-s-3);
      ctx.moveTo(p.x,p.y+s+3); ctx.lineTo(p.x,p.y+s+10); ctx.stroke();
      if (laserOn){ ctx.beginPath(); ctx.arc(p.x,p.y,s+8,0,2*Math.PI); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
      const rng = Math.hypot(obj.x-ac.pos.x, obj.y-ac.pos.y, p3.z-ac.pos.z)/NM;
      ctx.fillText((laserOn?'LZR ':'DESIG ')+label+' '+rng.toFixed(1)+'NM', p.x+s+13, p.y-5);
      ctx.restore();
    };
    const drawAirDesignator = (bd)=>{
      if (!bd || bd.hp<=0) return;
      const p3 = banditPos(bd), p = r3.project(p3);
      if (!p || p.z<=1) return;
      ctx.save();
      ctx.strokeStyle = yel; ctx.fillStyle = yel; ctx.lineWidth=1.5;
      const s=20;
      ctx.strokeRect(p.x-s,p.y-s,s*2,s*2);
      ctx.beginPath(); ctx.moveTo(p.x-s-10,p.y); ctx.lineTo(p.x-s-3,p.y); ctx.moveTo(p.x+s+3,p.y); ctx.lineTo(p.x+s+10,p.y); ctx.stroke();
      ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
      ctx.fillText('A-A DESIG '+(Math.hypot(bd.x-ac.pos.x,bd.y-ac.pos.y,bd.alt-ac.pos.z)/NM).toFixed(1)+'NM', p.x+s+12, p.y-6);
      ctx.restore();
    };
    const g = world.gndLock || world.harmLock;
    if (g) drawGroundDesignator(g, (g.name||g.label||'GND'), hot, !!world.tgpLaser && !!world.gndLock && g===world.gndLock);
    else if (world.designated && world.target && !world.target.destroyed) drawGroundDesignator(world.target, 'TGT', hot, !!world.tgpLaser);
    if (world.airLock) drawAirDesignator(world.airLock);
  }

  /* ---- A-A gun computed target-tracking reticle + lead cue ---- */
  if ((world.masterMode==='A-A' || world.masterMode==='DGFT') && !ac.onGround){
    const sol = bestGunSolution();
    ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    if (sol){
      const tgtP = r3.project(banditPos(sol.target));
      const leadP = r3.project(sol.aimPoint);
      const inRange = sol.range < GUN_MAX_RANGE;
      const shoot = sol.ready;
      const col = shoot ? '#ff3030' : (inRange ? '#ffd24d' : NEONHI);
      if (tgtP && tgtP.z>1){
        // The main circle tracks the aircraft itself, which is what the pilot
        // expects visually.  Color communicates envelope: green/blue work-in,
        // yellow in range, red shoot.
        const r = shoot ? 23 : (inRange ? 21 : 18);
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = shoot ? 2.5 : 1.7;
        ctx.beginPath(); ctx.arc(tgtP.x,tgtP.y,r,0,2*Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tgtP.x-r-12,tgtP.y); ctx.lineTo(tgtP.x-r-4,tgtP.y);
        ctx.moveTo(tgtP.x+r+4,tgtP.y); ctx.lineTo(tgtP.x+r+12,tgtP.y);
        ctx.moveTo(tgtP.x,tgtP.y-r-12); ctx.lineTo(tgtP.x,tgtP.y-r-4);
        ctx.moveTo(tgtP.x,tgtP.y+r+4); ctx.lineTo(tgtP.x,tgtP.y+r+12); ctx.stroke();
        ctx.fillText((shoot?'SHOOT':'GUN TRK')+' '+(sol.range/NM).toFixed(1)+'NM', tgtP.x+28, tgtP.y-18);
        if (inRange && !shoot) ctx.fillText('IN RNG', tgtP.x+28, tgtP.y-5);
      }
      if (leadP && leadP.z>1){
        // Small predicted impact/lead cue.  When this dot is near the target
        // tracking circle the burst has a valid ballistic solution.
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(leadP.x, leadP.y, 5, 0, 2*Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(leadP.x-9,leadP.y); ctx.lineTo(leadP.x+9,leadP.y);
        ctx.moveTo(leadP.x,leadP.y-9); ctx.lineTo(leadP.x,leadP.y+9); ctx.stroke();
        if (tgtP && tgtP.z>1){ ctx.globalAlpha=0.55; ctx.beginPath(); ctx.moveTo(tgtP.x,tgtP.y); ctx.lineTo(leadP.x,leadP.y); ctx.stroke(); ctx.globalAlpha=1; }
      }
    } else {
      ctx.strokeStyle=NEONHI; ctx.fillStyle=NEONHI; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.arc(cx,cy,24,0,2*Math.PI); ctx.stroke();
      ctx.fillText('GUN — NO LCOS', cx+30, cy-12);
    }
  }

  /* ---- gun tracers: project the actual ballistic rounds instead of fake HUD-only streaks ---- */
  if (_gunT>0){
    _gunT-=1/60;
    ctx.strokeStyle='rgba(255,225,90,0.95)'; ctx.lineWidth=1.8; ctx.lineCap='round';
    let drew=false;
    for (const bl of (world.bullets||[])){
      const a=r3.project(bl.prev||bl.pos), bpt=r3.project(bl.pos);
      if(a&&bpt&&a.z>1&&bpt.z>1){ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(bpt.x,bpt.y); ctx.stroke(); drew=true; }
    }
    ctx.lineCap='butt';
    if(!drew){ ctx.fillStyle='rgba(255,240,170,0.9)'; ctx.beginPath(); ctx.arc(cx,cy,2.6,0,2*Math.PI); ctx.fill(); }
  }

  /* ---- perf meter (toggle with F) ---- */
  if (world._showPerf){
    const ema = world._dtEMA || 0.016;
    const fps = Math.round(1/ema), ms = (ema*1000).toFixed(1);
    ctx.fillStyle = fps>=50?'#5bff9b':fps>=30?'#ffd24d':'#ff5b5b';
    ctx.font='bold 12px "Courier New"'; ctx.textAlign='left';
    ctx.fillText(fps+' FPS  '+ms+' ms', 12, 18);
    ctx.fillStyle=NEON; ctx.font='10px "Courier New"';
    const qn = (typeof QUALITY_LEVELS!=='undefined' && QUALITY_LEVELS[world.quality]) ? QUALITY_LEVELS[world.quality].name : '';
    ctx.fillText(qn+' '+W+'x'+H+'  ('+String.fromCharCode(8722)+'/= quality)', 12, 32);
    ctx.fillText('bandits '+world.bandits.length+'  mov '+world.groundMovers.length+'  hvt '+world.hvts.length+'  msl '+world.sams.length+'  fx '+world.effects.length, 12, 46);
  }

  /* ---- AWACS datalink + difficulty tag ---- */
  ctx.textAlign='left'; ctx.font='11px "Courier New"';
  if (world._mslAwayUntil && world.t < world._mslAwayUntil){
    ctx.fillStyle = (Math.floor(world.t*6)%2===0)?'#a8ffc0':'#5bff9b';
    ctx.font='bold 14px "Courier New"'; ctx.textAlign='center';
    ctx.fillText('MSL AWAY', cx, cy-92);
    ctx.textAlign='left'; ctx.font='11px "Courier New"';
  }
  if (typeof datalinkActive==='function' && datalinkActive()){
    ctx.fillStyle='#5bd6ff'; ctx.fillText('\u25c9 AWACS LINK', 70, H-100);
  }
  if (typeof DIFFS!=='undefined'){
    ctx.fillStyle=NEON; ctx.textAlign='left'; ctx.font='10px "Courier New"';
    ctx.fillText(DIFFS[world.difficulty].name, 70, H-18);
  }

  /* ---- RWR / launch warning ---- */
  if (world._rwrActive && Math.floor(world.t*4)%2===0){
    ctx.fillStyle='#ff5b5b'; ctx.font='bold 15px "Courier New"'; ctx.textAlign='center';
    ctx.fillText('\u25cf SAM', cx, cy-70);
  }
  if (world.sams.some(s=>s.team==='RED') && Math.floor(world.t*6)%2===0){
    ctx.fillStyle='#ff3b3b'; ctx.font='bold 16px "Courier New"'; ctx.textAlign='center';
    ctx.fillText('MISSILE  \u25b2  FLR '+(world.ac.flares)+'  CHF '+(world.ac.chaff||0), cx, cy-50);
  }

  if (world._stall && !ac.onGround && Math.floor(world.t*5)%2===0){
    ctx.fillStyle='#ff9a3b'; ctx.font='bold 18px "Courier New"'; ctx.textAlign='center';
    ctx.fillText('STALL', cx, cy+70);
  }

  /* ---- integrity bar ---- */
  ctx.fillStyle = ac.integrity>50?NEON:ac.integrity>25?'#ffd24d':'#ff5b5b';
  ctx.textAlign='center'; ctx.font='11px "Courier New"';
  ctx.fillText('INTEG '+Math.round(ac.integrity)+'%', cx, H-18);

  ctx.restore();

  /* ---- banner ---- */
  if (world.messageT>0){
    world.messageT -= 1/60;
    ctx.save();
    ctx.textAlign='center';
    ctx.font='bold 19px "Courier New"';
    ctx.fillStyle = world.outcome==='WIN'?'#ffd24d': world.outcome==='LOSS'?'#ff5b5b':NEONHI;
    ctx.fillText(world.message, cx, H*0.30);
    ctx.restore();
  }

  /* ---- screen flash on hit ---- */
  if (_flash>0){
    ctx.fillStyle = `rgba(255,40,40,${_flash*0.4})`;
    ctx.fillRect(0,0,W,H);
    _flash = Math.max(0, _flash - 2.2/60);
  }

  /* ---- end-of-mission overlay ---- */
  if (world.outcome){
    ctx.fillStyle='rgba(0,8,4,0.55)'; ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    ctx.fillStyle = world.outcome==='WIN'?'#ffd24d':'#ff5b5b';
    ctx.font='bold 30px "Courier New"';
    ctx.fillText(world.outcome==='WIN'?'MISSION COMPLETE':'AIRCRAFT LOST', cx, cy-6);
    ctx.fillStyle=NEON; ctx.font='13px "Courier New"';
    ctx.fillText('press  R  to restart mission', cx, cy+24);
  }
}

function predictImpact(ac){
  let p={...ac.pos}, v=acVel(ac); const dt=0.06;
  for (let i=0;i<800;i++){
    v.z -= G0*dt; p.x+=v.x*dt; p.y+=v.y*dt; p.z+=v.z*dt;
    if (p.z <= terrainH(p.x,p.y)) return {x:p.x,y:p.y,z:terrainH(p.x,p.y)+0.5};
  }
  return null;
}
function fmtMMSS(s){ s=Math.max(0,s|0); return String(s/60|0).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }
