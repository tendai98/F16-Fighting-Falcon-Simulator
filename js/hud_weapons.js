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

/* ---------- weapons ---------- */
function selectedStore(){ return world.stations.find(s=>s.id===world.selectedStation); }

function pickle(){
  if (world.outcome) return;
  const ac = world.ac;
  if (world.masterArm === 'SAFE'){ banner('MASTER ARM — SAFE', 1.2); return; }
  const sim = world.masterArm==='SIM';
  const st = selectedStore();

  // gun in A-A / dogfight is HOLD-to-fire: holding SPACE fires continuously
  // (handled each frame in updateGunFire). Pressing here only confirms arm state.
  if ((world.masterMode==='A-A' || world.masterMode==='DGFT') &&
      (!st || st.kind==='aa')){
    return;
  }
  if (!st || st.qty<=0){ banner('STORE QTY 0', 1.2); return; }

  if (st.kind==='ag'){                       // Mk-82: laser-guided if lasing, else CCIP ballistic
    st.qty--;
    const v = acVel(ac);
    const bomb = { pos:{...ac.pos}, vel:{...v}, live: !sim, t:0 };
    const laze = laserDesignation();
    if (laze){ bomb.guided = true; bomb.target = {...laze}; }
    world.bombs.push(bomb);
    if (window.F16Audio) F16Audio.event('bomb');
    banner((sim?'SIM ':'') + (laze ? 'BOMB AWAY \u2014 LGB' : 'BOMB AWAY \u2014 CCIP'), 0.9);
  } else if (st.kind==='agm'){               // guided air-to-ground -> designation
    const tp = groundDesignation();
    if (!tp){ banner('AGM — NO GROUND LOCK (DESIGNATE w/ TGP/FCR)', 1.6); return; }
    st.qty--;
    fireGuided(tp, 'AGM', !sim, null);
    banner((sim?'SIM ':'')+'RIFLE', 1.3);
  } else if (st.kind==='harm'){              // anti-radiation -> emitter
    const em = harmDesignation();
    if (!em){ banner('HARM — NO EMITTER IN RANGE', 1.6); return; }
    st.qty--;
    fireGuided({x:em.x, y:em.y, z:terrainH(em.x,em.y)+3}, 'HARM', !sim, em);
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
function fireGuided(tp, kind, live, emitter){
  const ac = world.ac, b = acBasis(ac);
  world.sams.push({
    team:'BLUE', kind, groundPos:{...tp}, emitter: emitter||null, live,
    pos:{...ac.pos}, vel: vscale(b.fwd, ac.tas+120),
    spd: kind==='HARM'?760:560, t:0, life: kind==='HARM'?22:18,
    color: kind==='HARM'?'#ffd14d':'#a8ffc0', trail:[],
  });
  addEffect(ac.pos, 0.5, 'launch');
  if (window.F16Audio) F16Audio.event('missile');
  world._mslAwayUntil = world.t + 2.8;
}

let _gunT = 0;
function fireGun(){
  const ac = world.ac;
  _gunT = 0.12;        // tracer flash
  if (window.F16Audio) F16Audio.event('gun');
  // hit test: bandit within cone of boresight & range
  const b = acBasis(ac);
  for (const bd of world.bandits){
    if (bd.hp<=0) continue;
    const rel = vsub({x:bd.x,y:bd.y,z:bd.alt}, ac.pos);
    const rng = vlen(rel);
    if (rng > 2200) continue;
    const ang = Math.acos(clamp(vdot(vnorm(rel), b.fwd),-1,1));
    if (ang < 3.2*DEG){
      bd.hp -= 0.12;                       // sustained fire whittles the target down
      if (bd.hp<=0){
        addEffect({x:bd.x,y:bd.y,z:bd.alt}, 1.1);
        banner('SPLASH — '+bd.kind, 1.6);
      }
    }
  }
}

/* hold-to-fire gun: while SPACE is held in A-A/DGFT, fire bursts at a fixed
   cadence; releasing stops. Called every active frame from the main loop. */
let _gunFireT = 0;
function updateGunFire(dt){
  const inGun = (world.masterMode==='A-A' || world.masterMode==='DGFT');
  const st = selectedStore();
  const ready = inGun && (!st || st.kind==='aa') && world.masterArm!=='SAFE' && !world.outcome;
  if (input.fire && ready){
    _gunFireT -= dt;
    if (_gunFireT <= 0){ fireGun(); _gunFireT = 0.09; }    // ~11 bursts/sec while held
  } else {
    _gunFireT = 0;
  }
}

function launchAAM(){
  const ac = world.ac;
  const st = selectedStore();
  if (!st || st.kind!=='aa' || st.qty<=0) { banner('NO A-A MISSILE', 1.2); return; }
  // find best bandit near boresight
  const b = acBasis(ac);
  let best=null, bestAng=25*DEG;
  for (const bd of world.bandits){
    if (bd.hp<=0) continue;
    const rel = vsub({x:bd.x,y:bd.y,z:bd.alt}, ac.pos);
    if (vlen(rel) > 14*NM) continue;
    const ang = Math.acos(clamp(vdot(vnorm(rel), b.fwd),-1,1));
    if (ang < bestAng){ bestAng=ang; best=bd; }
  }
  if (!best){ banner('NO TARGET IN RANGE', 1.2); return; }
  st.qty--;
  const arh = /120/.test(st.wpn);
  world.sams.push({ team:'BLUE', pos:{...ac.pos}, vel: vscale(b.fwd, ac.tas+140),
                    tgt:best, spd:620, t:0, life:16, color:'#a8ffc0', trail:[] });
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
    const g = terrainH(bm.pos.x, bm.pos.y);
    if (bm.pos.z <= g){
      addEffect({x:bm.pos.x,y:bm.pos.y,z:g}, 1.3);
      if (bm.live) bombImpact(bm.pos.x, bm.pos.y);
      world.bombs.splice(i,1);
    } else if (bm.t > 40){ world.bombs.splice(i,1); }
  }
}
function bombImpact(x,y){
  let hit=false;
  for (const b of world.target.buildings){
    if (b.destroyed) continue;
    if (Math.hypot(b.x-x, b.y-y) < 32){
      b.destroyed = true; b._deadT=world.t; hit=true;
      addEffect({x:b.x,y:b.y,z:terrainH(b.x,b.y)+b.h*0.5}, 2.2, 'kill');
      if (b.primary){
        world.target.destroyed = true;
        banner('★ SHACK — TARGET DESTROYED ★', 3);
        setTimeout(()=>{ if(!world.outcome) missionEnd('WIN','MISSION COMPLETE — RTB'); }, 1200);
      }
    }
  }
  // high-value stationary assets
  for (const v of world.hvts){
    if (v.destroyed) continue;
    if (Math.hypot(v.x-x, v.y-y) < 30){
      v.destroyed=true; v._deadT=world.t; hit=true;
      addEffect({x:v.x,y:v.y,z:terrainH(v.x,v.y)+6}, 2.2, 'kill');
      banner('HVT KILL \u2014 '+v.name, 1.8);
    }
  }
  // moving ground targets
  for (const m of world.groundMovers){
    if (m.destroyed) continue;
    if (Math.hypot(m.x-x, m.y-y) < 26){
      m.destroyed=true; m._deadT=world.t; if(m.live!==undefined) m.live=false; hit=true;
      addEffect({x:m.x,y:m.y,z:terrainH(m.x,m.y)+4}, 2.2, 'kill');
      banner('GROUND KILL \u2014 '+m.name, 1.6);
    }
  }
  // ground structures (bunkers / facilities) — also clears the dual-ref emitter
  for (const s of world.structures){
    if (s.destroyed) continue;
    if (Math.hypot(s.x-x, s.y-y) < 34){
      s.destroyed=true; s._deadT=world.t; if(s.live!==undefined) s.live=false; s.tracking=false; hit=true;
      addEffect({x:s.x,y:s.y,z:terrainH(s.x,s.y)+(s.geom?s.geom.h*0.5:6)}, 2.4, 'kill');
      banner('STRUCTURE KILL \u2014 '+(s.name||'FACILITY'), 1.8);
    }
  }
  // static SAM sites / launchers
  for (const t of world.threats){
    if (t.destroyed || t.mobile || t.structure || t.x===undefined) continue;   // movers & structures handled above
    if (Math.hypot(t.x-x, t.y-y) < 30){
      t.destroyed=true; t._deadT=world.t; t.live=false; t.tracking=false; hit=true;
      addEffect({x:t.x,y:t.y,z:terrainH(t.x,t.y)+5}, 2.2, 'kill');
      banner('SAM KILL \u2014 '+(t.name||'SAM'), 1.8);
    }
  }
  if (!hit) banner('MISS', 1.0);
}

function addEffect(pos, dur, kind){ world.effects.push({pos:{...pos}, t:0, dur, kind:kind||'blast'}); }
function updateEffects(dt){
  for (let i=world.effects.length-1;i>=0;i--){
    const e=world.effects[i]; e.t+=dt; if (e.t>=e.dur) world.effects.splice(i,1);
  }
}

/* ---------- guided missiles (RED SAM + BLUE AAM) ---------- */
function updateMissiles(dt){
  const ac = world.ac;
  for (let i=world.sams.length-1;i>=0;i--){
    const m = world.sams[i]; m.t+=dt;
    let tgtPos;
    if (m.team==='RED') tgtPos = ac.pos;
    else if (m.groundPos){
      // HARM keeps homing on a live emitter (follows small moves); else memory point
      if (m.kind==='HARM' && m.emitter && m.emitter.live)
        tgtPos = {x:m.emitter.x, y:m.emitter.y, z:terrainH(m.emitter.x,m.emitter.y)+3};
      else tgtPos = m.groundPos;
    }
    else tgtPos = (m.tgt && m.tgt.hp>0 ? {x:m.tgt.x,y:m.tgt.y,z:m.tgt.alt} : null);
    if (!tgtPos || m.t>m.life){ world.sams.splice(i,1); continue; }
    // proportional homing
    const desired = vnorm(vsub(tgtPos, m.pos));
    let dir = vnorm(m.vel);
    const turn = (m.team==='RED'?2.0:3.2)*dt;
    dir = vnorm(vadd(dir, vscale(vsub(desired,dir), Math.min(1,turn))));
    m.spd = Math.min(m.team==='RED'?700:780, m.spd + 120*dt);
    m.vel = vscale(dir, m.spd);
    m.pos = vadd(m.pos, vscale(m.vel, dt));
    if (m.trail){ m.trail.push({x:m.pos.x,y:m.pos.y,z:m.pos.z}); if (m.trail.length>16) m.trail.shift(); }
    const d = vlen(vsub(tgtPos, m.pos));
    const hitGround = m.pos.z < terrainH(m.pos.x, m.pos.y);

    if (m.groundPos){                          // guided surface attack (AGM / HARM)
      const prox = d<32 || (d<160 && m._pd!==undefined && d>m._pd);  // hit or closest-approach
      if (prox || hitGround){
        const ip = (d<200) ? tgtPos : {x:m.pos.x, y:m.pos.y, z:m.pos.z};
        addEffect(ip, 1.3);
        if (m.live!==false){
          if (m.kind==='HARM'){
            if (m.emitter && m.emitter.live){
              m.emitter.live=false; m.emitter.tracking=false;
              if (m.emitter.structure || m.emitter.mobile){ m.emitter.destroyed=true; m.emitter._deadT=world.t; }
              banner('HARM KILL \u2014 '+m.emitter.name, 2.0);
            } else banner('HARM IMPACT', 1.2);
          } else {
            bombImpact(ip.x, ip.y);            // AGM uses the same surface lethality
          }
        }
        world.sams.splice(i,1);
      } else { m._pd = d; }
      continue;
    }

    if (d < 40){
      addEffect(m.pos, 1.0);
      if (m.team==='RED'){
        // chance to defeat with high-G or flares
        let pHit = 0.8;
        if (ac.g>4) pHit -= 0.35;
        if (world._flareT>0) pHit -= 0.4;
        if (Math.random() < Math.max(0.1,pHit)) damage(ac, 38, 'SAM HIT');
        else banner('SAM DEFEATED', 1.4);
      } else if (m.tgt){
        m.tgt.hp = 0; addEffect({x:m.tgt.x,y:m.tgt.y,z:m.tgt.alt},1.2); banner('SPLASH — '+m.tgt.kind,1.6);
      }
      world.sams.splice(i,1);
    } else if (m.pos.z < terrainH(m.pos.x,m.pos.y)){
      world.sams.splice(i,1);
    }
  }
}

/* ---------- SAM site logic ---------- */
world._flareT = 0;
function dropFlares(){ if (world.ac.flares>0){ world.ac.flares--; world._flareT = 2.2; banner('FLARES',0.6);} }
function updateThreats(dt){
  if (world._flareT>0) world._flareT -= dt;
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
    const inRing = d < th.radius && agl > 120 && !world.outcome && th.hostile!==false && !nearBase && !jammed;
    th.tracking = inRing;
    if (inRing){
      anyTrack=true;
      th._dwell = (th._dwell||0) + dt;
      if (th._dwell > 4 && world.t - th.launchT > fireGap && redInAir < RED_CAP && (!world._tutorial || world._tutFire)){
        th.launchT = world.t; redInAir++;
        const z = terrainH(th.x,th.y);
        const dir = vnorm(vsub(ac.pos, {x:th.x,y:th.y,z:z+4}));
        world.sams.push({ team:'RED', pos:{x:th.x,y:th.y,z:z+4}, vel:vscale(dir,180), spd:180, t:0, life:16, color:th.color,
                          origin:{x:th.x,y:th.y,z:z+4}, src:th, name:th.name, trail:[{x:th.x,y:th.y,z:z+4}] });
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

/* ---------- bandit motion + (at HARD/ACE) firing AI ---------- */
function updateBandits(dt){
  const ac = world.ac;
  const shooters = (world.difficulty||0) >= 2;          // sim levels 3 & 4 (HARD, ACE)
  const RED_CAP = 8;
  let redInAir = 0; for (const s of world.sams) if (s.team==='RED') redInAir++;
  for (const bd of world.bandits){
    if (bd.hp<=0) continue;
    if (shooters && bd.kind==='HOSTILE'){
      // basic intercept: turn toward the player
      const want = Math.atan2(ac.pos.x-bd.x, ac.pos.y-bd.y);
      bd.psi = wrap2pi(bd.psi + angWrap(want-bd.psi)*clamp(1.2*dt,0,1));
    } else {
      bd.psi = wrap2pi(bd.psi + 0.05*dt*Math.sin(world.t*0.3+bd.x));   // idle wander
    }
    bd.x += Math.sin(bd.psi)*bd.spd*dt;
    bd.y += Math.cos(bd.psi)*bd.spd*dt;

    // weapons employment: shoot an AAM when in range and roughly nose-on
    if (shooters && bd.kind==='HOSTILE' && !world.outcome){
      const rel = vsub(ac.pos, {x:bd.x, y:bd.y, z:bd.alt});
      const rng = vlen(rel);
      const fwd = { x:Math.sin(bd.psi), y:Math.cos(bd.psi), z:0 };
      const ang = Math.acos(clamp(vdot(vnorm(rel), fwd), -1, 1));
      const cool = (world.difficulty>=3) ? 7 : 11;        // ACE shoots more often than HARD
      if (rng < 10*NM && rng > 1200 && ang < 28*DEG && redInAir < RED_CAP && (world.t - (bd._lastShot||-99)) > cool){
        bd._lastShot = world.t; redInAir++;
        const dir = vnorm(rel);
        world.sams.push({ team:'RED', pos:{x:bd.x,y:bd.y,z:bd.alt}, vel:vscale(dir, bd.spd+160),
                          spd:520, t:0, life:14, color:'#ff5050', trail:[] });
        banner('\u2605 MISSILE LAUNCH (AIR) \u2605', 1.4); flash(0.35);
      }
    }
  }
}

/* =====================================================================
   HUD
   ===================================================================== */
function drawCombatHUD(r3, ctx){
  const ac = world.ac, W=r3.W, H=r3.H;
  const cx=W/2, cy=H/2;
  ctx.save();
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

  /* ---- A-G aiming cue: LGB laser-spot when lasing, else CCIP pipper ---- */
  if (world.masterMode==='A-G' && !ac.onGround){
    const laze = (typeof laserDesignation==='function') ? laserDesignation() : null;
    if (laze){
      const p = r3.project({x:laze.x, y:laze.y, z:laze.z});
      if (p && p.z>1){
        ctx.strokeStyle = C_RED || '#ff5050'; ctx.lineWidth=1.6;
        ctx.beginPath();                                    // diamond on the laser spot
        ctx.moveTo(p.x,p.y-7); ctx.lineTo(p.x+7,p.y); ctx.lineTo(p.x,p.y+7); ctx.lineTo(p.x-7,p.y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x,p.y,11,0,2*Math.PI); ctx.stroke();
        ctx.fillStyle = C_RED || '#ff5050'; ctx.font='11px "Courier New"'; ctx.textAlign='left';
        const slant = Math.hypot(laze.x-ac.pos.x, laze.y-ac.pos.y, laze.z-ac.pos.z)/NM;
        ctx.fillText('LGB \u2014 LASER '+slant.toFixed(1)+'NM', p.x+13, p.y-8);
      }
    } else {
      const imp = predictImpact(ac);
      if (imp){
        const p = r3.project(imp);
        if (p && p.z>1){
          ctx.strokeStyle = NEONHI; ctx.lineWidth=1.6;
          ctx.beginPath(); ctx.arc(p.x,p.y,6,0,2*Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(p.x,p.y); ctx.stroke();
          const tb = world.target.buildings.find(b=>b.primary && !b.destroyed);
          if (tb){
            const miss = Math.hypot(tb.x-imp.x, tb.y-imp.y);
            ctx.fillStyle = miss<60?'#ffd24d':NEON; ctx.font='11px "Courier New"'; ctx.textAlign='left';
            ctx.fillText(miss<60?'IN RNG \u2014 PICKLE':'CCIP', p.x+10, p.y-8);
          }
        }
      }
    }
  }

  /* ---- gun tracers ---- */
  if (_gunT>0){
    _gunT-=1/60;
    ctx.strokeStyle='rgba(255,225,90,0.95)'; ctx.lineWidth=2; ctx.lineCap='round';
    for(let k=0;k<7;k++){
      const ox=(Math.random()-0.5)*7, p=Math.random();
      const y1=cy+150-p*168, y2=y1-24-Math.random()*20;       // short dashes streaming up
      ctx.beginPath();
      ctx.moveTo(cx+ox*(y1-cy)/150, y1);
      ctx.lineTo(cx+ox*(y2-cy)/150, y2);
      ctx.stroke();
    }
    ctx.lineCap='butt';
    ctx.fillStyle='rgba(255,240,170,0.9)';                    // muzzle sparkle at the pipper
    ctx.beginPath(); ctx.arc(cx,cy,2.6,0,2*Math.PI); ctx.fill();
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
    ctx.fillText('MISSILE  \u25b2  '+(world.ac.flares)+' FLARE', cx, cy-50);
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
