/* ===================================================================== */
/*  MAIN  (instances, input, game loop, mission control)                 */
/* ===================================================================== */

let R3V  = null;             // out-the-window 3D renderer (#window)
let FHUD = null;             // flight HUD (#hud)  — adapted simple-hud
let MFDS = {};               // { left, center, right }

/* ---- MFD helpers referenced by mfd.js ---- */
function setActive(){
  for (const id in MFDS){
    const m = MFDS[id];
    if (m.frame) m.frame.classList.toggle('active', id===world.activeMfdId);
  }
}
function refreshAllMfd(){ for (const id in MFDS){ const m=MFDS[id]; m.refresh(); m.render(); } }

/* ---- control map (single source of truth: input handler + H popup) --- */
const CONTROLS = [
  ['FLIGHT', [
    ['\u2191 / \u2193', 'Throttle up / down  (\u2193 also brakes on ground)'],
    ['S / W', 'Pitch \u2014 pull up / push down'],
    ['A / D  \u00b7  \u2190 / \u2192', 'Roll left / right'],
    ['Q / E', 'Rudder yaw left / right'],
    ['G', 'Landing gear up / down'],
  ]],
  ['FIRE CONTROL', [
    ['M', 'Cycle master mode  (NAV \u2192 A-A \u2192 A-G \u2192 DGFT)'],
    ['B', 'Cycle master arm  (SAFE \u2192 ARM \u2192 SIM)'],
    ['X', 'Cycle selected weapon station'],
    ['V', 'Designate boresight point (optional \u2014 tapping a contact on FCR / SAR / HAD also slews the pod)'],
    ['SPACE', 'Pickle (A-G) / fire gun (A-A, DGFT)'],
    ['L', 'Launch air-to-air missile'],
    ['C', 'Dispense flares'],
    ['J', 'Toggle EW / ECM jamming pod (also B1 on the ECM page)'],
  ]],
  ['NAV / SYSTEM', [
    ['WALKTHROUGH', 'New here? Click \u25b8 WALKTHROUGH at the top of this manual for a short guided strike that shows every step.'],
    ['N', 'Next steerpoint'],
    ['H', 'Show / hide this manual'],
    ['P', 'Pause'],
    ['R', 'Restart mission (after win/loss)'],
    ['1 / 2 / 3 / 4', 'Difficulty: EASY / NORMAL / HARD / ACE (resets)'],
    ['F', 'Toggle FPS / frame-time meter'],
    ['\u2212 / =', 'Graphics quality down / up (LOW \u2192 MED \u2192 HIGH)'],
    ['U', 'Sound on / off'],
  ]],
  ['MOUSE', [
    ['Click OSB', 'MFD page / range / store / mode select'],
    ['Click FCR', 'Lock a radar contact (RWS)'],
    ['Top OSBs', 'Switch MFD page: FCR HSD SMS TGP DED'],
  ]],
];

/* ---- boot ---- */
function boot(){
  R3V  = new R3(document.getElementById('window'));
  FHUD = new FlightHUD(document.getElementById('hud'));
  // align the symbolic pitch ladder scale with the 3D projection
  FHUD.settings.pixelPerRad = R3V.f;

  // three MFDs : left=HSD, center=FCR, right=SMS
  MFDS.left   = new MFD('left',   document.getElementById('mfd-left'),   'HSD');
  MFDS.center = new MFD('center', document.getElementById('mfd-center'), 'FCR');
  MFDS.right  = new MFD('right',  document.getElementById('mfd-right'),  'SMS');
  world.activeMfdId = 'center';
  setActive();

  buildControlsModal();
  bindKeys();
  resizeView();
  window.addEventListener('resize', resizeView);
  banner('TAKEOFF RWY 36  \u2014  THROTTLE UP (\u2191)  \u00b7  H=CONTROLS  \u00b7  '+DIFFS[world.difficulty].name, 5);
  last = performance.now();
  requestAnimationFrame(loop);
}

/* size the #window / #hud canvas buffers to the displayed area (DPR-aware) so
   the front view fills whatever space it's given — incl. extra room when the
   browser is zoomed out — instead of being scaled from a fixed resolution. */
function resizeView(){
  const q = (typeof QUALITY_LEVELS!=='undefined') ? (QUALITY_LEVELS[world.quality]||QUALITY_LEVELS[1]) : {scale:1};
  const scale = Math.min(window.devicePixelRatio || 1, 2) * q.scale;
  for (const id of ['window','hud']){
    const c = document.getElementById(id);
    if (!c) continue;
    const w = Math.max(2, Math.round((c.clientWidth  || 1600) * scale));
    const h = Math.max(2, Math.round((c.clientHeight ||  600) * scale));
    if (c.width !== w)  c.width  = w;
    if (c.height !== h) c.height = h;
  }
  if (R3V){ R3V.resize(); FHUD.settings.pixelPerRad = R3V.f; }
}

function setQuality(i){
  world.quality = clamp(i, 0, QUALITY_LEVELS.length-1);
  banner('GRAPHICS: '+QUALITY_LEVELS[world.quality].name, 1.4);
  resizeView();
}

/* ---- keyboard input ---- */
const keys = {};
function bindKeys(){
  window.addEventListener('keydown', e=>{
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    if (keys[e.code]) return;       // ignore auto-repeat for one-shots
    keys[e.code] = true;
    onKeyDown(e.code);
  });
  window.addEventListener('keyup', e=>{ keys[e.code] = false; });
}

function onKeyDown(code){
  if (window.F16Audio && !F16Audio.ready) F16Audio.init();   // resume audio on first gesture
  switch(code){
    case 'KeyH':    toggleControls(); return;
    case 'Escape':  toggleControls(false); return;
    case 'Space':   pickle(); break;
    case 'KeyL':    launchAAM(); break;
    case 'KeyC':    dropFlares(); break;
    case 'KeyG':    if (!world.ac.onGround){ world.ac.gear=!world.ac.gear; banner('GEAR '+(world.ac.gear?'DOWN':'UP'),1);} beep('select'); break;
    case 'KeyB':    cycleArm(); beep('select'); break;
    case 'KeyM':    cycleMode(); beep('select'); break;
    case 'KeyX':    cycleStation(); beep('select'); break;
    case 'KeyN':    world.steerpoint = (world.steerpoint % world.waypoints.length)+1; banner('STPT '+world.steerpoint,1); refreshAllMfd(); beep('beep'); break;
    case 'KeyV':    designateTarget(); beep('beep'); break;
    case 'KeyU':    if (window.F16Audio){ banner('SOUND '+(F16Audio.toggle()?'ON':'OFF'),1); } break;
    case 'KeyJ':    world.ecm.on=!world.ecm.on; banner('ECM '+(world.ecm.on?'ACTIVE':'OFF'),1); refreshAllMfd(); beep('select'); break;
    case 'KeyP':    world.paused=!world.paused; banner(world.paused?'PAUSE':'',0.8); break;
    case 'KeyF':    world._showPerf=!world._showPerf; banner('PERF '+(world._showPerf?'ON':'OFF'),1); break;
    case 'Minus':   setQuality(world.quality-1); break;
    case 'Equal':   setQuality(world.quality+1); break;
    case 'Digit1':  setDifficulty(0); break;
    case 'Digit2':  setDifficulty(1); break;
    case 'Digit3':  setDifficulty(2); break;
    case 'Digit4':  setDifficulty(3); break;
    case 'KeyR':    if (world.outcome) restartMission(); break;
  }
}
function beep(kind){ if (window.F16Audio) F16Audio.event(kind); }

function cycleStation(){
  const ids = world.stations.map(s=>s.id);
  const cur = ids.indexOf(world.selectedStation);
  const next = ids[(cur+1)%ids.length];
  selectStation(next);
  const st = selectedStore();
  if (st) banner('STN '+st.id+'  '+st.wpn, 1);
}

function setDifficulty(i){
  world.difficulty = clamp(i, 0, DIFFS.length-1);
  banner('DIFFICULTY: '+DIFFS[world.difficulty].name+' \u2014 RESETTING', 2);
  restartMission();
}

function designateTarget(){
  const ac=world.ac;
  if (world.masterMode==='A-A' || world.masterMode==='DGFT'){
    const b=acBasis(ac); let best=null, bestAng=20*DEG;
    for (const bd of world.bandits){ if (bd.hp<=0) continue;
      const rel=vsub({x:bd.x,y:bd.y,z:bd.alt}, ac.pos);
      const ang=Math.acos(clamp(vdot(vnorm(rel), b.fwd),-1,1));
      if (ang<bestAng){ bestAng=ang; best=bd; } }
    if (best){ world.airLock=best; banner('AIR LOCK \u2014 '+(best.kind||'BANDIT'),1.2); }
    else banner('NO AIR TGT BORESIGHT',1.2);
  } else {
    const b=acBasis(ac);
    const cand=[...world.target.buildings.filter(o=>!o.destroyed),
                ...world.hvts.filter(v=>!v.destroyed),
                ...world.groundMovers.filter(g=>!g.destroyed&&!g.underground),
                ...world.structures.filter(s=>!s.destroyed)];
    // prefer a real ground target within the forward field of view, so V designates
    // whatever you're flying at (not just the patch of dirt directly under the nose)
    let best=null, bestScore=Infinity;
    for (const c of cand){
      const rel=vsub({x:c.x, y:c.y, z:terrainH(c.x,c.y)+3}, ac.pos);
      const dist=Math.hypot(rel.x, rel.y); if (dist>16000) continue;            // within ~16 km
      const ang=Math.acos(clamp(vdot(vnorm(rel), b.fwd), -1, 1)); if (ang>45*DEG) continue;  // forward cone
      const score=ang*6000 + dist*0.04;                                          // mostly boresight, then nearest
      if (score<bestScore){ bestScore=score; best=c; }
    }
    if (best){ world.gndLock=best; world.designated=true;
      banner('TGT DESIGNATED \u2014 '+(best.name||best.label||'GND'),1.2); }
    else {                                       // nothing ahead: fall back to a boresight ground point (CCIP-style)
      const ap=(typeof defaultTgpPoint==='function')?defaultTgpPoint():{x:ac.pos.x,y:ac.pos.y};
      world.gndLock={x:ap.x, y:ap.y, name:'GND PT', destroyed:false, _point:true}; world.designated=true;
      banner('POINT DESIGNATED',1.2); }
  }
  refreshAllMfd();
}

/* sample continuous controls into the shared `input` rate object */
function sampleInput(){
  // S = pull (nose up, +pitch), W = push (nose down, -pitch)
  input.pitch = (keys['KeyS']?1:0) - (keys['KeyW']?1:0);
  // D / Right = roll right (+), A / Left = roll left (-)
  // roll: D / Right = roll RIGHT, A / Left = roll LEFT
  input.roll  = ((keys['KeyA']||keys['ArrowLeft'])?1:0) - ((keys['KeyD']||keys['ArrowRight'])?1:0);
  input.yaw   = (keys['KeyE']?1:0) - (keys['KeyQ']?1:0);
  // Up / Down = throttle
  input.throttleUp   = !!keys['ArrowUp'];
  input.throttleDown = !!keys['ArrowDown'];
  input.fire         = !!keys['Space'];      // gun is hold-to-fire (A-A / DGFT)
}

/* ---- reference content for the help menu (Controls is the default tab) ---- */
const HELP_REF = {
  WEAPONS: [
    ['AIR-TO-AIR', [
      ['GUN M61', '20mm cannon. A-A / DGFT only. Hold SPACE to fire (~510 rds).'],
      ['AIM-9X', 'Short-range IR missile. Designate (V) a boresight bandit, launch with L.'],
      ['AIM-120', 'Radar (BVR) missile. Lock a bandit on the FCR / V, launch with L.'],
      ['FLARES', 'C dispenses IR decoy flares (30) to defeat incoming heat-seekers.'],
    ]],
    ['AIR-TO-GROUND', [
      ['Mk-82 \u00d76', '500lb bomb. Laser OFF \u2192 CCIP (fly the pipper onto the target, SPACE). Laser ON \u2192 LGB, guides to the lased spot.'],
      ['AGM-65', 'Maverick, guided. Designate a ground target (TGP / FCR), SPACE = RIFLE.'],
      ['AGM-88', 'HARM anti-radiation. Fires at the designated / nearest live emitter, SPACE = MAGNUM.'],
    ]],
    ['RELEASE', [
      ['PICKLE (SPACE)', 'Releases the selected A-G store / fires the gun in A-A.'],
      ['MASTER ARM (B)', 'SAFE = inhibited  \u00b7  ARM = live  \u00b7  SIM = practice (no damage).'],
      ['STATION (X)', 'Cycles the selected weapon station (see the SMS page).'],
    ]],
  ],
  SENSORS: [
    ['RADAR / EO', [
      ['FCR', 'Fire Control Radar. B1 cycles RWS / SAR-GMT / HAD. L1-L4 set range.'],
      ['RWS', 'Range-While-Search air picture (B-scope). Lock bandits for AIM-120 / 9X.'],
      ['SAR / GMT', 'Ground map ahead of the jet. Tags moving vehicles, TELs and buried sites. Tap a contact to designate it \u2014 the TGP slews onto it automatically.'],
      ['TGP', 'Targeting Pod \u2014 IR/EO camera on the designated point. L1-L4 = 4 zoom stages, R1 WIDE/NARO, R2 AREA/POINT, R3 laser (LGB), R4 WHOT/BHOT. Footer shows SR (slant range) + DEP (look-down angle).'],
    ]],
    ['SITUATION', [
      ['HSD', 'Horizontal Situation Display \u2014 overhead nav map: route, threat rings, AWACS.  B4 \u2192 ECM,  B5 \u2192 THREAT.'],
      ['HAD', 'HARM Attack Display \u2014 live emitters by bearing / lethality. Tap one to lock it for HARM AND slew the TGP onto it.'],
      ['DATALINK', 'Off-board picture from an E-3 / E-2 AWACS. Tune the DED to a channel for that aircraft\u2019s 80NM picture.'],
      ['RWR', 'Radar Warning \u2014 HUD / audio cue when a SAM tracks or launches.'],
      ['EW / ECM POD', 'Spectrum jammer. Each SAM radiates on fixed frequencies (peaks on the ECM page). Lock up to 8 of them into jam slots; a SAM is suppressed only when EVERY one of its peaks is covered AND you\u2019re outside its burn-through range. Spreading the pod over more slots weakens each (burn-through sooner), and capable SAMs frequency-hop \u2014 so jam only what you need and re-lock hops.'],
      ['THREAT/EWS', 'Page that plots inbound SAMs, each missile\u2019s track and the launch point it came from. Tap a launch point to slew the TGP / HARM onto that launcher.'],
    ]],
  ],
  MODES: [
    ['MASTER MODE (M)', [
      ['NAV', 'Navigation. No weapon cues \u2014 fly the route.'],
      ['A-A', 'Air-to-Air. Gun + AIM-9X / 120; FCR in RWS.'],
      ['A-G', 'Air-to-Ground. Bombs / Mavericks / HARM; CCIP or LGB cue on the HUD.'],
      ['DGFT', 'Dogfight. Gun + AIM-9X, boresight auto-acquire.'],
    ]],
    ['MASTER ARM (B)', [
      ['SAFE', 'Weapons inhibited \u2014 nothing releases.'],
      ['ARM', 'Live \u2014 weapons release and do damage.'],
      ['SIM', 'Practice \u2014 full cues and release, but no damage.'],
    ]],
  ],
  PAGES: [
    ['MFD PAGES (top OSB)', [
      ['FCR', 'Radar page (RWS / SAR-GMT / HAD).'],
      ['HSD', 'Nav / situation map.  B5 \u2192 THREAT/EWS page.'],
      ['SMS', 'Stores Management \u2014 select & view weapon stations.'],
      ['TGP', 'Targeting-pod video + laser.'],
      ['DED', 'Data Entry \u2014 CNI, steerpoints, BIT, and the TUNE keypad.'],
      ['DLNK', 'Datalink picture (reached from the DED). L1-L4 zoom.'],
      ['THR', 'Threat/EWS \u2014 inbound-missile tracks + launch points (HSD \u2192 B5). Tap a launch point/emitter to designate it.'],
      ['ECM', 'Spectrum analyzer (HSD \u2192 B4). Peaks = SAM radar frequencies (taller = closer/stronger). Tap a peak to lock/clear its jam slot, or slide the \u25c4\u25ba cursor and press SEL. AUTO fills from the strongest peaks. B1 ECM on/off, B2 clears all slots. 8 slots max.'],
    ]],
    ['OSB BUTTONS', [
      ['TOP  T1-T5', 'Switch MFD pages.'],
      ['LEFT  L1-L4', 'Range / zoom on radar, HSD and datalink.'],
      ['BOTTOM / RIGHT', 'Page functions \u2014 mode, FOV, laser, stations, tune.'],
      ['DED \u2192 TUNE', 'Touch keypad to enter a datalink frequency.'],
      ['DED \u2192 DLNK', 'Open the datalink picture page.'],
    ]],
  ],
  ACRONYMS: [
    ['GLOSSARY  A\u2013H', [
      ['AGL', 'Above Ground Level (height over terrain).'],
      ['AOA', 'Angle of Attack.'],
      ['AWACS', 'Airborne Warning & Control System (E-3 Sentry).'],
      ['BRG / RNG', 'Bearing / Range to a point.'],
      ['BULLSEYE', 'Shared reference point for callouts.'],
      ['CCIP', 'Continuously Computed Impact Point \u2014 where an unguided bomb lands.'],
      ['DED', 'Data Entry Display.'],
      ['REARM', 'A weapon station that runs dry (WINCHESTER) auto-reloads after a 10s cooldown \u2014 watch the count on SMS. No landing needed.'],
      ['ECM', 'Electronic Counter-Measures \u2014 the EW jamming pod (page: HSD \u2192 B4, key J).'],
      ['BURN-THROUGH', 'Range at which a jammed SAM\u2019s radar overpowers the jam and reacquires you \u2014 it shrinks the more you stay back, grows as you close in.'],
      ['FREQ HOP', 'A capable SAM switching scan frequency to defeat your jamming after repeated denial.'],
      ['FCR', 'Fire Control Radar.'],
      ['GMT', 'Ground Moving Target.'],
      ['HARM', 'High-speed Anti-Radiation Missile (AGM-88).'],
      ['HAD', 'HARM Attack Display.'],
      ['HSD', 'Horizontal Situation Display.'],
      ['HVT', 'High-Value Target.'],
    ]],
    ['GLOSSARY  L\u2013Z', [
      ['LGB', 'Laser-Guided Bomb.'],
      ['MAGNUM', 'Radio call for a HARM launch.'],
      ['PICKLE', 'Press the weapon-release button (SPACE).'],
      ['RIFLE', 'Radio call for an AGM (Maverick) launch.'],
      ['RWR', 'Radar Warning Receiver.'],
      ['RWS', 'Range-While-Search (radar air mode).'],
      ['SAM', 'Surface-to-Air Missile.'],
      ['SAR', 'Synthetic Aperture Radar (ground map).'],
      ['SHACK', 'A direct hit on the target.'],
      ['SMS', 'Stores Management System.'],
      ['TAS', 'True Airspeed.'],
      ['TEL', 'Transporter-Erector-Launcher (mobile SAM).'],
      ['TGP', 'Targeting Pod.'],
      ['UGF', 'Underground Facility (SAR-found, buried launcher).'],
    ]],
  ],
};
const HELP_TABS = [
  ['CONTROLS','CONTROLS'], ['WEAPONS','WEAPONS'], ['SENSORS','SENSORS'],
  ['MODES','MODES'], ['PAGES','PAGES'], ['ACRONYMS','GLOSSARY'],
];
function helpGroups(id){ return id==='CONTROLS' ? CONTROLS : (HELP_REF[id]||[]); }
function helpBodyHTML(id){
  let h='<div class="cm-cols">';
  for (const [group, rows] of helpGroups(id)){
    h+='<div class="cm-group"><h4>'+group+'</h4><table>';
    for (const [k,d] of rows) h+='<tr><td class="cm-key">'+k+'</td><td>'+d+'</td></tr>';
    h+='</table></div>';
  }
  return h+'</div>';
}
function showHelpTab(modal, id){
  modal.querySelectorAll('.cm-tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  modal.querySelector('.cm-body').innerHTML = helpBodyHTML(id);
}
/* ---- help / reference menu (H) ---- */
function buildControlsModal(){
  if (document.getElementById('controls-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'controls-modal';
  let tabs='';
  for (const [id,label] of HELP_TABS) tabs+='<button class="cm-tab'+(id==='CONTROLS'?' active':'')+'" data-tab="'+id+'">'+label+'</button>';
  modal.innerHTML = '<div class="cm-panel"><div class="cm-title">F-16C FLIGHT MANUAL <button class="cm-walk">\u25b8 FLIGHT SCHOOL</button></div>'+
    '<div class="cm-tabs">'+tabs+'</div>'+
    '<div class="cm-body">'+helpBodyHTML('CONTROLS')+'</div>'+
    '<div class="cm-foot">click a tab \u00b7 press <b>H</b> or <b>Esc</b> to close</div></div>';
  modal.addEventListener('click', e=>{
    if (e.target.closest && e.target.closest('.cm-walk')){ toggleControls(false); buildLessonMenu(); return; }
    if (e.target===modal){ toggleControls(false); return; }
    const t = e.target.closest && e.target.closest('.cm-tab');
    if (t){ showHelpTab(modal, t.dataset.tab); }
  });
  document.body.appendChild(modal);
}
function toggleControls(force){
  const m = document.getElementById('controls-modal');
  if (!m) return;
  const show = (force===undefined) ? !m.classList.contains('show') : force;
  m.classList.toggle('show', show);
}

/* ---- mission control ---- */
function checkSteerpointAdvance(){
  const wp = curWP();
  if (!wp) return;
  const d = distTo(wp.x, wp.y);
  if (d < 900 && world.steerpoint < world.waypoints.length && wp.name!=='TGT'){
    world.steerpoint++;
    banner('STPT '+world.steerpoint+'  '+curWP().name, 1.4);
  }
}

function restartMission(){
  if (typeof TUT!=='undefined' && TUT.active){ TUT.active=false; if(TUT._paused){world.paused=false;TUT._paused=false;} ['tut-panel','tut-canvas'].forEach(id=>{const e=document.getElementById(id); if(e&&e.parentNode)e.parentNode.removeChild(e);}); }
  world._tutorial=false;
  const ac = world.ac;
  ac.pos = v3(0,-1000,0); ac.psi=0; ac.theta=0; ac.phi=0; ac.gamma=0; ac.alpha=0;
  ac.tas=0; ac.throttle=0; ac.gear=true; ac.onGround=true;
  ac.g=1; ac.aoa=0; ac.vy=0; ac.integrity=100; ac.flares=30;
  world.t=0; world.paused=false; world.outcome=null; world.message=''; world.messageT=0;
  world.steerpoint=1; world.designated=false;
  world.gndLock=null; world.airLock=null; world.harmLock=null; world.tgpLaser=false;
  for (const k in MFDS){ if (MFDS[k]) MFDS[k].laser=false; }
  world.masterArm='SAFE'; world.masterMode='NAV';
  world.bombs.length=0; world.sams.length=0; world.effects.length=0;
  world.groundMovers.length=0; world.hvts.length=0; world.friendlies.length=0;
  world.structures.length=0; world.airstrips.length=0; world._reloadCD=0; world.dlEntry='';
  const QTY={1:2,2:2,3:2,4:2,5:3,6:3,7:4,8:1};
  world.stations.forEach(s=>{ s.qty=QTY[s.id]||0; s.sel=(s.id===5); });
  world.selectedStation=5;
  world.threats.forEach(t=>{ t.tracking=false; t.live=true; t.launchT=-99; });
  world.target.destroyed=false;
  world.target.buildings.forEach(b=>b.destroyed=false);
  buildMission();
  reseedTerrain();
  applyDifficulty();
  DED_PAGE='CNI';
  banner('MISSION RESET \u2014 THROTTLE UP (\u2191)',3);
  refreshAllMfd();
}

/* ---- feed the flight HUD from world state ---- */
function updateFlightHUD(){
  const ac = world.ac;
  const v = acVel(ac);
  const horiz = Math.hypot(v.x, v.y);
  const gamma = Math.atan2(v.z, Math.max(0.01, horiz));      // climb angle
  let drift = Math.atan2(v.x, v.y) - ac.psi;                 // track vs nose
  drift = Math.atan2(Math.sin(drift), Math.cos(drift));      // signed wrap [-pi,pi]
  drift = clamp(drift, -10*DEG, 10*DEG);
  Object.assign(FHUD.data, {
    pitch: ac.theta,
    roll:  ac.phi,
    heading: ac.psi,
    speed: ac.tas*KT,
    altitude: ac.pos.z*FT,
    throtle: ac.throttle,
  });
  FHUD.data.flight.pitch   = gamma;
  FHUD.data.flight.heading = drift;
}

/* ---- main loop ---- */
let last = 0, _mfdTick = 0;
function loop(now){
  let dt = (now - last)/1000; last = now;
  if (dt > 0.05) dt = 0.05;            // clamp big frame gaps
  if (dt > 0) world._dtEMA = world._dtEMA ? world._dtEMA*0.9 + dt*0.1 : dt;

  try {
    if (!world.paused && !world.outcome){
      sampleInput();
      world.t += dt;
      updateFlight(world.ac, dt);
      updateBandits(dt);
      updateGunFire(dt);
      updateGroundMovers(dt);
      checkReload(dt);
      updateFriendlies(dt);
      updateThreats(dt);
      if (!world._tutorial) streamWorld(dt);   // populate the map procedurally as we fly out
      updateMissiles(dt);
      updateBombs(dt);
      updateEffects(dt);
      checkSteerpointAdvance();
      updateTutorial(dt);
    }

    // ---- out-the-window 3D + combat overlay (same canvas = pixel-aligned) ----
    R3V.render(world.ac);
    drawCombatHUD(R3V, R3V.ctx);

    // ---- flight HUD (separate overlay canvas) ----
    updateFlightHUD();
    FHUD.render();

    // ---- MFDs : instruments. Update all (cheap), but render ONE per frame
    //      (round-robin) so no single frame pays for all three at once. ----
    for (const id in MFDS) MFDS[id].update(dt);
    const ids = Object.keys(MFDS);
    if (ids.length){ MFDS[ids[_mfdTick % ids.length]].render(); _mfdTick++; }

    // ---- training overlay (pointers/rings) ----
    drawTutOverlay();

    // ---- audio: feed current state to the F-16 sound engine ----
    if (window.F16Audio && F16Audio.ready){
      const ac = world.ac;
      const agl = ac.pos.z - terrainH(ac.pos.x, ac.pos.y);
      F16Audio.update({
        throttle: ac.throttle,
        missile:  world.sams.some(s=>s.team==='RED'),
        lock:     world.threats.some(t=>t.tracking),
        lowAlt:   !ac.onGround && agl < 160 && ac.vy < 0,
        stall:    !ac.onGround && !!world._stall,
        caution:  world._cautionUntil && world.t < world._cautionUntil,
        paused:   world.paused || !!world.outcome,
      });
    }
  } catch (err){
    if (!loop._warned){ console.error('frame error (continuing):', err); loop._warned = true; }
  }

  requestAnimationFrame(loop);
}

/* ============================ INTERACTIVE FLIGHT SCHOOL ============================
   Staged lessons (Basics, TGP, SAR, A-A, Datalink, ECM). Each step points an on-screen
   arrow + ring at the exact button / instrument to use and advances only when you DO the
   action (no clicking "next" on action steps). Some steps pause the sim to highlight an
   instrument. SAMs hold fire while training so you can learn in peace. */

const HUD_LABELS = { throttle:'AIRSPEED (\u2191/\u2193 throttle)', speed:'AIRSPEED', alt:'ALTITUDE', mode:'MODE / ARM', steer:'FLIGHT PATH', rwr:'HUD TARGET BOX' };
const HUD_ALIAS  = { throttle:'speed', rwr:'steer' };
function tutRect(point){
  if (!point) return null;
  try {
    if (point.osb){ const m=MFDS[point.mfd||'center']; const el=m&&m.osbEls&&m.osbEls[point.osb];
      if (el){ const r=el.getBoundingClientRect(); if(r.width) return r; } return null; }
    if (point.mfd && point.screen){ const m=MFDS[point.mfd]; const el=m&&m.canvas;
      if (el){ const r=el.getBoundingClientRect(); if(r.width) return r; } return null; }
    if (point.el){ const el=document.querySelector(point.el); if(el){ const r=el.getBoundingClientRect(); if(r.width) return r; } return null; }
    if (point.hud){
      const key = HUD_ALIAS[point.hud] || point.hud;
      const a = world._hudAnchors && world._hudAnchors[key];
      if (a){ const cv=document.getElementById(a.canvas==='hud'?'hud':'window');
        if (cv){ const r=cv.getBoundingClientRect(); if(r.width){
          const w=a.fw*r.width, h=a.fh*r.height;
          return { left:r.left+a.fx*r.width-w/2, top:r.top+a.fy*r.height-h/2, width:w, height:h }; } } }
    }
  } catch(e){}
  return null;
}
function tutCaption(point){
  if (!point) return '';
  if (point.cap) return point.cap;
  if (point.hud) return HUD_LABELS[point.hud]||'';
  if (point.osb) return 'OSB '+point.osb;
  return '';
}

/* ---- overlay (ring + arrow) and hint panel ---- */
function buildTutOverlay(){
  if (!document.getElementById('tut-canvas')){
    const c=document.createElement('canvas'); c.id='tut-canvas'; document.body.appendChild(c);
  }
  buildTutPanel();
}
function rrPath(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawTutOverlay(){
  const c=document.getElementById('tut-canvas'); if(!c) return;
  const ctx=c.getContext('2d'); const W=window.innerWidth, H=window.innerHeight;
  if (c.width!==W) c.width=W; if (c.height!==H) c.height=H;
  ctx.clearRect(0,0,W,H);
  if (!TUT.active) return;
  const step=TUT_STEPS[TUT.step]; if(!step) return;
  const rect=tutRect(step.point); if(!rect) return;
  const t=performance.now()/1000, pulse=6+4*Math.sin(t*4.5);
  const x=rect.left-pulse, y=rect.top-pulse, w=rect.width+2*pulse, h=rect.height+2*pulse;
  ctx.save();
  ctx.strokeStyle='#39ff6e'; ctx.lineWidth=3; ctx.shadowColor='rgba(57,255,110,0.9)'; ctx.shadowBlur=14;
  rrPath(ctx,x,y,w,h,8); ctx.stroke(); ctx.restore();
  const cap=tutCaption(step.point);
  if (cap){ ctx.save(); ctx.fillStyle='#cfffdd'; ctx.font='bold 11px "Courier New"'; ctx.textAlign='center';
    const ty=y>34?y-9:y+h+17; ctx.fillText(cap, Math.min(W-50,Math.max(50,x+w/2)), ty); ctx.restore(); }
  const panel=document.getElementById('tut-panel');
  if (panel){ const pr=panel.getBoundingClientRect();
    const tcx=x+w/2, tcy=y+h/2;                              // ring centre
    const sx=Math.max(pr.left, Math.min(tcx, pr.right));     // nearest point on the panel box
    const sy=Math.max(pr.top,  Math.min(tcy, pr.bottom));
    const tx=Math.max(x,Math.min(sx,x+w)), tyy=Math.max(y,Math.min(sy,y+h));
    ctx.save(); ctx.strokeStyle='rgba(57,255,110,0.8)'; ctx.lineWidth=2; ctx.setLineDash([7,5]);
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(tx,tyy); ctx.stroke(); ctx.setLineDash([]);
    const ang=Math.atan2(tyy-sy,tx-sx); ctx.fillStyle='#39ff6e'; ctx.beginPath();
    ctx.moveTo(tx,tyy); ctx.lineTo(tx-13*Math.cos(ang-0.4),tyy-13*Math.sin(ang-0.4));
    ctx.lineTo(tx-13*Math.cos(ang+0.4),tyy-13*Math.sin(ang+0.4)); ctx.closePath(); ctx.fill(); ctx.restore(); }
}
function buildTutPanel(){
  if (document.getElementById('tut-panel')) return;
  const p=document.createElement('div'); p.id='tut-panel';
  p.innerHTML='<div class="tp-hd"><span class="tp-lesson"></span><span class="tp-step"></span><button class="tp-x" title="Exit training">\u2715</button></div>'+
    '<div class="tp-title"></div><div class="tp-body"></div><div class="tp-live"></div>'+
    '<div class="tp-foot"><span class="tp-key"></span>'+
    '<span class="tp-btns"><button class="tp-skip">SKIP \u25b8</button><button class="tp-next">NEXT \u25b8</button><button class="tp-got">GOT IT \u25b8</button></span></div>';
  document.body.appendChild(p);
  p.querySelector('.tp-x').addEventListener('click',()=>endTutorial());
  p.querySelector('.tp-next').addEventListener('click',tutAdvance);
  p.querySelector('.tp-skip').addEventListener('click',tutAdvance);
  p.querySelector('.tp-got').addEventListener('click',tutGotIt);
}
function renderTutPanel(){
  const p=document.getElementById('tut-panel'); if(!p) return;
  const s=TUT_STEPS[TUT.step], last=TUT.step===TUT_STEPS.length-1;
  p.querySelector('.tp-lesson').textContent=TUT.lessonTag||'';
  p.querySelector('.tp-step').textContent='STEP '+(TUT.step+1)+'/'+TUT_STEPS.length;
  p.querySelector('.tp-title').textContent=s.t;
  p.querySelector('.tp-body').textContent=s.b;
  p.querySelector('.tp-key').textContent=s.key?('KEY: '+s.key):'';
  const nb=p.querySelector('.tp-next'), sb=p.querySelector('.tp-skip'), gb=p.querySelector('.tp-got');
  nb.style.display=sb.style.display=gb.style.display='none';
  if (s.pause){ gb.textContent=last?'FINISH':'GOT IT \u25b8'; gb.style.display=''; }
  else if (s.done){ sb.style.display=''; }
  else { nb.textContent=last?'FINISH':'NEXT \u25b8'; nb.style.display=''; }
  p.querySelector('.tp-live').textContent = s.live?(s.live()||''):'';
}
function enterStep(){
  const s=TUT_STEPS[TUT.step]; TUT.okT=0;
  if (s && s.pause){ world.paused=true; TUT._paused=true; }
  else if (TUT._paused){ world.paused=false; TUT._paused=false; }
  if (s && s.enter){ try{ s.enter(); }catch(e){} }
  renderTutPanel();
}
function tutAdvance(){
  if (TUT.step>=TUT_STEPS.length-1){ endTutorial(); return; }
  TUT.step++; enterStep(); if (typeof beep==='function') beep('select');
}
function tutGotIt(){ if (TUT._paused){ world.paused=false; TUT._paused=false; } tutAdvance(); }
function updateTutorial(dt){
  if (!TUT.active) return;
  const s=TUT_STEPS[TUT.step]; if(!s) return;
  if (s.live){ const el=document.querySelector('#tut-panel .tp-live'); if(el) el.textContent=s.live()||''; }
  if (s.done && !s.pause){
    let ok=false; try{ ok=!!s.done(); }catch(e){}
    if (ok){ TUT.okT=(TUT.okT||0)+dt; if (TUT.okT>0.35){ banner('\u2713 '+s.t,1.0); tutAdvance(); } } else TUT.okT=0;
  }
}

/* ---- scenario setups ---- */
function tutResetEZ(){ world.difficulty=0; restartMission(); world._tutorial=true; world._tutFire=false; }
/* targeting lessons must NOT sit inside a SAM ring (the RWR alone confuses a new
   pilot) — strip the air defences so they can learn the strike loop in peace */
function clearThreats(){
  world.threats = [];
  if (world.groundMovers) world.groundMovers.forEach(g=>{ if(g.mobile){ g.live=false; g.tracking=false; } });
}
/* keep exactly ONE SAM of a given class (relocated to clear airspace) and drop the
   rest — used by the SEAD and ECM lessons so the picture is a single, clean threat */
function isolateSAM(name, ringMul, alt){
  let s = world.threats.find(t=>t.live && t.name===name && !t.mobile && !t.structure)
       || world.threats.find(t=>t.live && t.radius && !t.mobile && !t.structure)
       || world.threats.find(t=>t.live);
  const px=3000, py=20000;                          // clear of base and the target rings
  if (s){ s.name=name; s.x=px; s.y=py; s.live=true; s.destroyed=false; s.tracking=false;
    delete s.scanBands; if (typeof assignSamFreqs==='function') assignSamFreqs(s); }
  world.threats = s ? [s] : [];
  if (world.groundMovers) world.groundMovers.forEach(g=>{ if(g.mobile){ g.live=false; g.tracking=false; } });
  if (s) placeJetFacing(px, py, (s.radius||9000)*(ringMul||1.05), alt||3500);
  return s;
}
function placeJetFacing(tx,ty,standoff,alt){
  const ac=world.ac, L=Math.hypot(tx,ty)||1, ux=tx/L, uy=ty/L;
  const sx=tx-ux*standoff, sy=ty-uy*standoff;
  ac.pos=v3(sx,sy, terrainH(sx,sy)+alt);
  ac.psi=Math.atan2(ux,uy); ac.theta=0; ac.phi=0; ac.gamma=0; ac.alpha=0;
  ac.tas=220; ac.throttle=0.7; ac.onGround=false; ac.gear=false;
}
function setupBasics(){ tutResetEZ(); clearThreats();
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=1; world.stations.forEach(st=>st.sel=(st.id===1));
  const tw=world.waypoints.find(w=>w.name!=='RWY 36'&&w.id>1); if(tw) world.steerpoint=tw.id;
}
function setupApproach(){ tutResetEZ(); clearThreats();
  placeJetFacing(world.target.x, world.target.y, 12000, 3500);
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=5; world.stations.forEach(st=>st.sel=(st.id===5));
}
function setupSAR(){ tutResetEZ(); clearThreats();
  let mv=world.groundMovers.find(g=>!g.destroyed);
  const px=4000, py=18000;
  if (mv){ mv.x=px; mv.y=py; mv.underground=false; mv.destroyed=false; mv.cavern=null;
    mv.mobile=false; mv.emits=false; if(mv.live!==undefined) mv.live=false; mv.tracking=false;
    mv.kind='GROUND'; mv.name=mv.name||'CONVOY'; }
  else { mv={x:px,y:py,psi:0,spd:12,hp:1,destroyed:false,underground:false,track:[],kind:'GROUND',name:'CONVOY',geom:mkGeom(['truck','tank'])}; world.groundMovers.push(mv); }
  placeJetFacing(px,py,11000,3200);
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=5; world.stations.forEach(st=>st.sel=(st.id===5));
}
function setupSEAD(){ tutResetEZ();
  isolateSAM('SA-6', 1.70, 3500);                   // start well OUTSIDE the ring; lock + HARM as you fly in
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=7; world.stations.forEach(st=>st.sel=(st.id===7));   // HARM
}
function setupDefense(){ tutResetEZ();
  isolateSAM('SA-6', 1.60, 3500);                   // start well OUTSIDE; fly in to draw a shot
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=1; world.stations.forEach(st=>st.sel=(st.id===1));
  world.ac.flares=30;
  if (MFDS.left) MFDS.left.setPage('HSD');          // HSD on the left MFD -> B5 opens the THR page
}
function setupAA(){ tutResetEZ(); clearThreats();
  let b=world.bandits.find(x=>x.hp>0);
  const px=2000, py=16000, alt=6000;
  if (!b){ b={x:px,y:py,alt,psi:Math.PI,spd:200,hp:1,kind:'HOSTILE'}; world.bandits.push(b); }
  else { b.x=px; b.y=py; b.alt=alt; b.hp=1; b.kind='HOSTILE'; }
  placeJetFacing(px,py,14000,0); world.ac.pos.z=terrainH(px,py)+alt;
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=2; world.stations.forEach(st=>st.sel=(st.id===2));
}
function setupDatalink(){ tutResetEZ(); clearThreats();
  placeJetFacing(world.target.x, world.target.y, 14000, 4000);
  world.masterMode='NAV'; world.masterArm='SAFE';
}
function setupECM(){ tutResetEZ();
  isolateSAM('SA-3', 1.90, 3500);                   // basic single-band SAM; start well OUTSIDE, configure on the way in
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=7; world.stations.forEach(st=>st.sel=(st.id===7));
}
function setupECMStrike(){ tutResetEZ();
  isolateSAM('SA-6', 2.00, 3500);                   // 2-band SAM; start far out so you can set up the jam before the ring
  world.masterMode='NAV'; world.masterArm='SAFE';
  world.selectedStation=7; world.stations.forEach(st=>st.sel=(st.id===7));   // HARM ready
  world.ac.flares=30;
  world._tutFire=true;                              // this SAM WILL shoot if you fail to jam it
  if (MFDS.left) MFDS.left.setPage('ECM');          // spectrum up from the start
}

/* ---- lesson step lists ---- */
const L_BASICS = [
  {t:'WELCOME ABOARD', point:null, b:'The basics: take off, fly to a steerpoint, set up your weapon and put a bomb on target. A green arrow points at what to use \u2014 do the action and the next step appears.'},
  {t:'THROTTLE UP', key:'\u2191', point:{hud:'throttle'}, b:'Push the throttle up with the \u2191 key and accelerate down the runway.', done:()=>world.ac.throttle>0.5},
  {t:'ROTATE & LIFT OFF', key:'S', point:{hud:'speed'}, b:'As speed builds, ease back on the stick (hold S) to rotate and climb away. (W is nose-down \u2014 S pulls the nose up.)', done:()=>!world.ac.onGround && (world.ac.pos.z-terrainH(world.ac.pos.x,world.ac.pos.y))>120},
  {t:'GEAR UP', key:'G', point:{hud:'mode'}, b:'Raise the landing gear with G once you have a positive climb.', done:()=>!world.ac.gear},
  {t:'CLIMB OUT', key:'S', point:{hud:'alt'}, b:'Hold a steady climb (keep easing back on S). Watch the altitude tape on the right of the HUD.', live:()=>'ALT '+Math.round(world.ac.pos.z*FT)+' ft', done:()=>(world.ac.pos.z-terrainH(world.ac.pos.x,world.ac.pos.y))>1200},
  {t:'FOLLOW THE STEERPOINT', point:{hud:'steer'}, b:'The HUD steering cue and the HSD route point to your next steerpoint. Turn to put it on the nose.', done:()=>{ const w=(typeof curWP==='function')&&curWP(); if(!w) return true; const brg=Math.atan2(w.x-world.ac.pos.x,w.y-world.ac.pos.y); const e=Math.atan2(Math.sin(brg-world.ac.psi),Math.cos(brg-world.ac.psi)); return Math.abs(e)<22*DEG; }},
  {t:'JUMP TO THE TARGET', point:null, pause:true, b:'Nicely flown. To keep things short we\u2019ll jump you to the target area now to set up the attack. Press GOT IT.', enter:()=>{ placeJetFacing(world.target.x,world.target.y,11000,3200); }},
  {t:'MASTER MODE \u2192 A-G', key:'M', point:{hud:'mode'}, b:'Set the master mode to A-G (air-to-ground) \u2014 press M until the readout reads A-G.', done:()=>world.masterMode==='A-G'},
  {t:'MASTER ARM', key:'B', point:{hud:'mode'}, b:'Arm the weapons: press B for ARM (live) or SIM (practice). Nothing releases while SAFE.', done:()=>world.masterArm!=='SAFE'},
  {t:'SELECT A BOMB', key:'X', point:{mfd:'right',screen:true,cap:'SMS \u2014 STORES'}, b:'Cycle stations with X until you have Mk-82 bombs (station 5 or 6). The SMS page shows every store.', done:()=>{ const s=selectedStore(); return !!s&&s.kind==='ag'; }},
  {t:'SELECT THE TGP SENSOR', point:{osb:'T4',mfd:'center'}, b:'Bring up the Targeting Pod \u2014 click the TGP button (top OSB T4) on the center MFD.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='TGP')},
  {t:'FLY INTO RANGE', point:{hud:'steer'}, b:'Fly toward the target. Inside ~4 NM the CCIP pipper settles onto the HUD.', live:()=>'RNG '+(distTo(world.target.x,world.target.y)/NM).toFixed(1)+' NM', done:()=>distTo(world.target.x,world.target.y)<7000},
  {t:'DESIGNATE THE TARGET', key:'V', point:{mfd:'center',screen:true,cap:'TGP \u2014 designate'}, b:'Point your nose at the target and press V \u2014 or click/tap the target directly in the pod view. A diamond locks on and the pod tracks it.', done:()=>world.designated&&!!world.gndLock},
  {t:'RELEASE \u2014 PICKLE', key:'SPACE', point:{hud:'steer'}, b:'Designated and in range \u2014 press SPACE to release, and fly the CCIP onto the target.', done:()=>world.target.destroyed||world.bombs.length>0},
  {t:'STRIKE COMPLETE', point:null, b:'That is the whole loop: TAKEOFF \u2192 NAV \u2192 MODE \u2192 ARM \u2192 WEAPON \u2192 SENSOR \u2192 RANGE \u2192 DESIGNATE \u2192 RELEASE. Try the TGP, SAR, A-A, Datalink and ECM lessons next.'},
];
const L_TGP = [
  {t:'TARGETING POD', point:null, b:'The TGP finds, locks and lasers ground targets. You start airborne, lined up on the target.'},
  {t:'A-G + ARM', key:'M / B', point:{hud:'mode'}, b:'Set master mode A-G (M) and Master Arm to ARM or SIM (B).', done:()=>world.masterMode==='A-G'&&world.masterArm!=='SAFE'},
  {t:'OPEN THE POD', point:{osb:'T4',mfd:'center'}, b:'Click the TGP button (T4) to bring up the pod view.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='TGP')},
  {t:'STEP THE ZOOM', point:{osb:'L2',mfd:'center'}, b:'L1\u2013L4 set the pod zoom (Z1\u2013Z4). Zoom in to see the target clearly. (Optional \u2014 SKIP to move on.)', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='TGP'&&(MFDS[k].tgpZoom||2)>=3)},
  {t:'DESIGNATE', key:'V', point:{mfd:'center',screen:true,cap:'TGP VIEW'}, b:'Click/tap the target in the pod view to designate it \u2014 or point at it and press V. The crosshair diamond locks on and tracks.', done:()=>world.designated&&!!world.gndLock},
  {t:'INTO RANGE', point:{hud:'steer'}, b:'Close to release range \u2014 the pod footer shows slant range (SR).', live:()=>{const g=world.gndLock||world.target; return 'RNG '+(distTo(g.x,g.y)/NM).toFixed(1)+' NM';}, done:()=>{const g=world.gndLock||world.target; return distTo(g.x,g.y)<7000;}},
  {t:'RELEASE', key:'SPACE', point:{hud:'steer'}, b:'Press SPACE to drop on the designated point.', done:()=>world.bombs.length>0||world.target.destroyed},
  {t:'POD COMPLETE', point:null, b:'The pod holds the lock through the drop \u2014 and even after impact until you re-designate. That\u2019s your precision A-G workflow.'},
];
const L_SAR = [
  {t:'SAR-ASSISTED STRIKE', point:null, b:'Ground-mapping radar (SAR) finds moving vehicles the pod can\u2019t eyeball. A mobile launcher is ahead.'},
  {t:'A-G + ARM', key:'M / B', point:{hud:'mode'}, b:'Master mode A-G (M), Master Arm ARM or SIM (B).', done:()=>world.masterMode==='A-G'&&world.masterArm!=='SAFE'},
  {t:'OPEN THE FCR', point:{osb:'T1',mfd:'center'}, b:'Bring up the Fire-Control Radar \u2014 click FCR (T1).', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='FCR')},
  {t:'SELECT SAR MODE', point:{osb:'B1',mfd:'center'}, b:'Cycle the radar mode with B1 until it reads SAR. Moving vehicles show as blips.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='FCR'&&MFDS[k].fcrMode==='SAR')},
  {t:'DESIGNATE THE MOVER', point:{mfd:'center',screen:true,cap:'SAR \u2014 tap the blip'}, b:'Click the moving blip on the SAR display (or press V) to lock it. The TGP slews onto it.', done:()=>!!world.gndLock},
  {t:'WEAPON + RANGE', key:'X', point:{mfd:'right',screen:true,cap:'SMS'}, b:'Select a bomb with X and close to release range.', live:()=>{const g=world.gndLock; return g?('RNG '+(distTo(g.x,g.y)/NM).toFixed(1)+' NM'):'';}, done:()=>{const s=selectedStore(),g=world.gndLock; return !!s&&s.kind==='ag'&&g&&distTo(g.x,g.y)<7000;}},
  {t:'RELEASE', key:'SPACE', point:{hud:'steer'}, b:'Pickle (SPACE) on the locked launcher.', done:()=>world.bombs.length>0},
  {t:'SAR COMPLETE', point:null, b:'SAR + TGP is how you kill movers and pop-up TELs you can\u2019t see by eye \u2014 essential on the harder levels.'},
];
const L_AA = [
  {t:'AIR-TO-AIR INTERCEPT', point:null, b:'A bandit is ahead at your altitude. You\u2019ll lock it on radar and take a missile shot.'},
  {t:'A-A MODE', key:'M', point:{hud:'mode'}, b:'Set the master mode to A-A (press M).', done:()=>world.masterMode==='A-A'||world.masterMode==='DGFT'},
  {t:'ARM', key:'B', point:{hud:'mode'}, b:'Master Arm to ARM or SIM (B).', done:()=>world.masterArm!=='SAFE'},
  {t:'PICK THE MISSILE', key:'X', point:{mfd:'right',screen:true,cap:'SMS'}, b:'Select an AIM-120 radar missile with X (station 2).', done:()=>{const s=selectedStore(); return !!s&&s.kind==='aa';}},
  {t:'RADAR \u2014 FCR', point:{osb:'T1',mfd:'center'}, b:'Bring up the FCR (T1). The bandit appears as a contact.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='FCR')},
  {t:'LOCK THE BANDIT', key:'V', point:{hud:'rwr'}, b:'Put your nose on the bandit and press V (or click it on the FCR) to lock. A target box appears on the HUD.', done:()=>!!world.airLock},
  {t:'FIRE', key:'L', point:{hud:'steer'}, b:'Locked and in range \u2014 press L to launch, and keep the nose on him to support the missile.', live:()=>{const b=world.airLock; return b?('RNG '+(distTo(b.x,b.y)/NM).toFixed(1)+' NM'):'';}, done:()=>world.sams.some(s=>s.team==='BLUE'&&s.tgt)||world.bandits.every(b=>b.hp<=0)},
  {t:'SPLASH', point:null, b:'That\u2019s a beyond-visual-range shot: A-A \u2192 AIM-120 \u2192 radar lock \u2192 launch. Up close, L fires the AIM-9 and the gun is on SPACE in DGFT.'},
];
const L_SEAD = [
  {t:'SEAD \u2014 KILL A SAM', point:null, b:'Now take the fight to the air defences. A single SA-6 SAM site is ahead. You\u2019ll find its radar, lock it and destroy it with a HARM anti-radiation missile. (It won\u2019t fire during training.)'},
  {t:'A-G + ARM', key:'M / B', point:{hud:'mode'}, b:'Master mode A-G (M), Master Arm ARM or SIM (B).', done:()=>world.masterMode==='A-G'&&world.masterArm!=='SAFE'},
  {t:'SELECT HARM', key:'X', point:{mfd:'right',screen:true,cap:'SMS'}, b:'Select the AGM-88 HARM with X (station 7) \u2014 it homes on the SAM\u2019s radar emissions.', done:()=>{const s=selectedStore();return !!s&&s.kind==='harm';}},
  {t:'OPEN THE FCR', point:{osb:'T1',mfd:'center'}, b:'Bring up the Fire-Control Radar \u2014 click FCR (T1).', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='FCR')},
  {t:'SWITCH TO HAD', point:{osb:'B1',mfd:'center'}, b:'Cycle the radar mode with B1 to HAD \u2014 the threat scope that shows radar emitters.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='FCR'&&MFDS[k].fcrMode==='HAD')},
  {t:'LOCK THE EMITTER', point:{mfd:'center',screen:true,cap:'HAD \u2014 tap the SAM'}, b:'Tap the SAM symbol on the HAD scope to designate it (HARM lock). The TGP slews onto it as well.', done:()=>!!world.harmLock},
  {t:'MAGNUM \u2014 FIRE', key:'SPACE', point:{hud:'steer'}, b:'In range, press SPACE to launch the HARM. \u201cMAGNUM\u201d calls the shot; it rides the radar beam down.', live:()=>{const e=world.harmLock; return e?('RNG '+(distTo(e.x,e.y)/NM).toFixed(1)+' NM'):'';}, done:()=>world.sams.some(s=>s.kind==='HARM')||world.threats.every(t=>!t.live)},
  {t:'SEAD COMPLETE', point:null, b:'Find \u2192 HAD \u2192 lock \u2192 HARM. With the SAM down, the corridor opens. You can also kill SAMs with a TGP-lasered bomb \u2014 or just jam them, which the ECM lesson covers.'},
];
const L_DEF = [
  {t:'DEFENCE \u2014 THREATS & COUNTERMEASURES', point:null, b:'When a SAM shoots at you, the THREAT/EWS page shows who fired and the missile in the air \u2014 then you defeat it with flares and a hard break. A SA-6 is ahead; fly toward it.'},
  {t:'GET LOCKED', point:{hud:'steer'}, b:'Fly toward the SAM until your RWR warbles \u2014 it has radar lock on you. (Listen for the warble and watch the threat warning.)', live:()=>{const s=world.threats.find(t=>t.live&&t.radius); return s?('RNG '+(distTo(s.x,s.y)/NM).toFixed(1)+' NM'):'';}, done:()=>world.threats.some(t=>t.live&&t.tracking)},
  {t:'OPEN THE THREAT PAGE', point:{mfd:'left',osb:'B5',cap:'HSD \u2014 B5 \u2192 THR'}, b:'Bring up the Threat/EWS page: on the HSD (left MFD) press B5 \u2192 THR. It plots every emitter that can see you, track-up, with lethal rings.', done:()=>Object.values(MFDS).some(m=>m.page==='THR')},
  {t:'MISSILE \u2014 FLARES!', key:'C', point:{mfd:'left',screen:true,cap:'THR \u2014 inbound missile'}, b:'Launch! The THR page draws the inbound missile and its time-to-impact (TTI). Punch flares with C and break hard away to decoy the seeker.',
    enter:()=>{ const s=world.threats.find(t=>t.live&&t.radius); TUT._flareStart=world.ac.flares;
      if (s){ const ac=world.ac, z=terrainH(s.x,s.y), dir=vnorm(vsub(ac.pos,{x:s.x,y:s.y,z:z+4}));
        world.sams.push({team:'RED',pos:{x:s.x,y:s.y,z:z+4},vel:vscale(dir,180),spd:180,t:0,life:18,color:s.color||'#ff5050',origin:{x:s.x,y:s.y,z:z+4},src:s,name:s.name,trail:[{x:s.x,y:s.y,z:z+4}]});
        banner('\u2605 MISSILE LAUNCH \u2014 FLARES!',1.8); if(typeof flash==='function') flash(0.4); } },
    done:()=>world.ac.flares < (TUT._flareStart!=null?TUT._flareStart:30)},
  {t:'HOLD THE BREAK', point:{hud:'steer'}, b:'Keep the turn in and dispense more flares if it\u2019s still tracking. \u201cSAM DEFEATED\u201d means you spoofed the shot.', done:()=>!world.sams.some(s=>s.team==='RED')},
  {t:'DEFENCE COMPLETE', point:null, b:'The THR page is your survival picture \u2014 it shows who can shoot and what\u2019s inbound. Flares decoy the missile and the hard turn makes it overshoot. You carry 30; use them in pairs as a missile closes and keep some in reserve. Combine with terrain masking and jamming (ECM lesson) to survive the threat rings.'},
];
const L_DLNK = [
  {t:'DATALINK (AWACS)', point:null, b:'An AWACS shares its radar picture if you tune your datalink to its frequency \u2014 revealing contacts you can\u2019t see yourself.'},
  {t:'OPEN THE DED', point:{osb:'T5',mfd:'right'}, b:'Bring up the DED (T5) on the right MFD.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='DED')},
  {t:'TUNE THE FREQUENCY', point:{mfd:'right',screen:true,cap:'DED \u2014 TUNE (B4)'}, b:'Open TUNE (B4) and key in an AWACS frequency \u2014 124.85 (E-3) or 126.50 (E-2) \u2014 then ENTER.', done:()=>datalinkActive()},
  {t:'READ THE PICTURE', point:{mfd:'left',screen:true,cap:'HSD'}, pause:true, b:'Link up! The HSD now paints cyan rings on AWACS-known contacts and the DLNK page shows the feed. Press GOT IT.'},
  {t:'DATALINK COMPLETE', point:null, b:'Datalink extends your awareness well past your own radar \u2014 tune it early on HARD and ACE.'},
];
const L_ECM = [
  {t:'ECM \u2014 JAMMING A SAM', point:null, b:'A basic SA-3 is ahead. It radiates on a single radar frequency \u2014 perfect for learning to jam. You\u2019ll lock that frequency from stand-off, then fly in and watch it burn through. Open the ECM page.'},
  {t:'OPEN THE ECM PAGE', point:{osb:'B4',mfd:'left'}, b:'From the HSD, press B4 (ECM) to open the spectrum analyzer \u2014 it sweeps 0\u2013100 and shows a peak for every emitter\u2019s radar frequency.', done:()=>Object.keys(MFDS).some(k=>MFDS[k].page==='ECM')},
  {t:'POD ON', key:'J', point:{osb:'B1',mfd:'left'}, b:'Switch the EW pod ON \u2014 press B1 on the ECM page (or the J key).', done:()=>world.ecm.on},
  {t:'LOCK THE SA-3 FREQUENCY', point:{mfd:'left',screen:true,cap:'ECM \u2014 tap the peak'}, b:'The SA-3 is the tall peak on the spectrum. Tap it to lock its frequency into a jam slot \u2014 or slide the \u25c4\u25ba cursor onto it and press SEL. The peak turns blue (JAMMED) and it can\u2019t track you.', done:()=>{const s=world.threats.find(t=>t.live&&t.bands); return !!s && world.ecm.on && allBandsCovered(s);}},
  {t:'WATCH BURN-THROUGH', point:{hud:'steer'}, b:'Jammed, the SA-3 can\u2019t see you \u2014 fly in. As you cross its burn-through range (an inner ring, not drawn on the HSD) it reacquires and the peak goes red. Jamming buys stand-off, not invulnerability.', live:()=>{const s=world.threats.find(t=>t.live&&t.bands); return s?('nearest: '+(emitterJammed(s)?'JAMMED':'BURNED THROUGH')+'  '+(distTo(s.x,s.y)/NM).toFixed(1)+' NM'):'';}, done:()=>{const s=world.threats.find(t=>t.live&&t.bands); return !!s && distTo(s.x,s.y)<ecmBurnRange(s)*1.05;}},
  {t:'ECM COMPLETE', point:null, b:'You have 8 jam slots: a multi-band SAM (SA-6/SA-10) must have EVERY peak covered before it\u2019s suppressed, and spreading the pod over more slots weakens each, so burn-through comes sooner \u2014 jam only what you need. Capable SAMs frequency-HOP, so a peak will jump; find it and re-lock. When a SAM dies, hops a band away, or you fly out of its detection range, its peak drops and the stale jam slot frees itself \u2014 so your slots always reflect what\u2019s actually radiating. Pre-load a heavy SAM network\u2019s frequencies before you push in.'},
];
const L_ECMSTK = [
  {t:'EW STRIKE \u2014 ATTACK UNDER JAMMING', point:null, b:'ECM lets you walk into a SAM ring it can\u2019t shoot through, then kill it from inside. This SA-6 uses TWO frequencies and WILL fire if you don\u2019t jam it. You start well outside its ring \u2014 set up as you close. The ECM spectrum is already up on the left MFD.'},
  {t:'POD ON', key:'J', point:{osb:'B1',mfd:'left'}, b:'Switch the EW pod ON (J, or B1 on the ECM page) before you reach the ring.', done:()=>world.ecm.on},
  {t:'LOCK BOTH BANDS', point:{mfd:'left',screen:true,cap:'ECM \u2014 lock BOTH peaks'}, b:'The SA-6 shows TWO peaks. Lock BOTH \u2014 tap each peak (or slide the \u25c4\u25ba cursor and press SEL). One peak isn\u2019t enough; it\u2019s suppressed only when every band is covered.', live:()=>{const s=world.threats.find(t=>t.live&&t.bands); if(!s)return''; return 'COVERED '+s.bands.filter(f=>bandCovered(f)).length+'/'+s.bands.length;}, done:()=>{const s=world.threats.find(t=>t.live&&t.bands); return !!s && world.ecm.on && allBandsCovered(s);}},
  {t:'PENETRATE UNDER COVER', point:{hud:'steer'}, b:'Jammed, the SA-6 can\u2019t see you. Fly INTO the ring \u2014 the status holds JAMMED and it can\u2019t shoot. (If a peak hops to a new frequency, re-lock it.)', live:()=>{const s=world.threats.find(t=>t.live&&t.bands); return s?((emitterJammed(s)?'JAMMED':'EXPOSED!')+'  '+(distTo(s.x,s.y)/NM).toFixed(1)+' NM'):'';}, done:()=>{const s=world.threats.find(t=>t.live&&t.bands); return !!s && distTo(s.x,s.y)<s.radius*0.96 && emitterJammed(s);}},
  {t:'ARM THE HARM', key:'B', point:{hud:'mode'}, b:'Inside the ring and still jamming. Go ARM (B) \u2014 your AGM-88 HARM is selected. Don\u2019t overfly the site: get too close and it burns through the jam.', done:()=>world.masterArm==='ARM'},
  {t:'MAGNUM \u2014 KILL IT', key:'SPACE', point:{hud:'steer'}, b:'Fire the HARM with SPACE. It homes on the SA-6\u2019s radar \u2014 which is still radiating \u2014 and kills it while it\u2019s blind to you. MAGNUM!', done:()=>{const s=world.threats.find(t=>t.name==='SA-6'); return (!s||!s.live||s.destroyed) || world.sams.some(m=>m.kind==='HARM');}},
  {t:'EW STRIKE COMPLETE', point:null, b:'That\u2019s the play: jam every band to deny the shot, penetrate under cover, and kill from inside the ring before burn-through reaches you. Against a network, lock only the bands you must \u2014 fewer slots keeps the pod strong and burn-through tight. Pre-load known frequencies, push in jammed, and roll the SAMs up one at a time. Each kill drops that SAM’s peak and frees its jam slots automatically.'},
];

const LESSONS = [
  {id:'basics', tag:'1 \u00b7 BASICS',   name:'BASICS \u2014 Takeoff to First Strike', desc:'Take off, navigate, set up and drop your first bomb.', setup:setupBasics,  steps:L_BASICS},
  {id:'tgp',    tag:'2 \u00b7 TGP',      name:'TGP \u2014 Targeting-Pod Designation',  desc:'Find, lock and bomb a target with the pod.',          setup:setupApproach, steps:L_TGP},
  {id:'sar',    tag:'3 \u00b7 SAR',      name:'SAR \u2014 Radar-Mapped Strike',        desc:'Use ground radar to kill a moving vehicle.',          setup:setupSAR,     steps:L_SAR},
  {id:'sead',   tag:'4 \u00b7 SEAD',     name:'SEAD \u2014 Kill a SAM',                desc:'Find, lock and HARM a live SAM site.',                setup:setupSEAD,    steps:L_SEAD},
  {id:'def',    tag:'5 \u00b7 DEFENCE',  name:'DEFENCE \u2014 Threat Page & Countermeasures', desc:'Read the THREAT/EWS page, then beat the missile with flares + a hard break.', setup:setupDefense, steps:L_DEF},
  {id:'aa',     tag:'6 \u00b7 A-A',      name:'AIR-TO-AIR \u2014 Intercept',           desc:'Lock a bandit on radar and take a missile shot.',     setup:setupAA,      steps:L_AA},
  {id:'dlnk',   tag:'7 \u00b7 DATALINK', name:'DATALINK \u2014 AWACS Picture',         desc:'Tune the datalink and read the shared picture.',      setup:setupDatalink, steps:L_DLNK},
  {id:'ecm',    tag:'8 \u00b7 ECM',      name:'ECM \u2014 Jamming an SA-3',            desc:'Jam a basic SAM\u2019s radar and learn burn-through.',    setup:setupECM,     steps:L_ECM},
  {id:'ewstk',  tag:'9 \u00b7 EW STRIKE', name:'EW STRIKE \u2014 Attack Under Jamming',  desc:'Jam a 2-band SA-6, penetrate under cover, and HARM it from inside the ring.', setup:setupECMStrike, steps:L_ECMSTK},
];
let TUT_STEPS = L_BASICS;
let TUT = { active:false, step:0, okT:0, _paused:false, lessonTag:'', lessonName:'' };

function startLesson(id){
  const L=LESSONS.find(l=>l.id===id) || LESSONS[0];
  toggleControls(false); removeIntroOffer(); removeLessonMenu();
  L.setup();
  TUT_STEPS=L.steps; TUT.active=true; TUT.step=0; TUT.okT=0; TUT._paused=false;
  TUT.lessonTag=L.tag; TUT.lessonName=L.name;
  buildTutOverlay(); enterStep(); refreshAllMfd();
  banner(L.name,2.5);
}
function endTutorial(){
  if (TUT._paused){ world.paused=false; TUT._paused=false; }
  TUT.active=false; world._tutorial=false; world._tutFire=false;
  ['tut-panel','tut-canvas'].forEach(id=>{ const e=document.getElementById(id); if(e&&e.parentNode)e.parentNode.removeChild(e); });
  banner('TRAINING COMPLETE \u2014 fly free',3);
}

/* ---- lesson menu + first-launch offer ---- */
function removeLessonMenu(){ const m=document.getElementById('lesson-menu'); if(m&&m.parentNode)m.parentNode.removeChild(m); }
function buildLessonMenu(){
  removeIntroOffer();
  if (document.getElementById('lesson-menu')) return;
  const m=document.createElement('div'); m.id='lesson-menu';
  const items=LESSONS.map(l=>'<button class="lm-item" data-id="'+l.id+'"><span class="lm-n">'+l.tag+'</span><span class="lm-t">'+l.name.replace(/^[^\u2014]*\u2014\s*/,'')+'</span><span class="lm-d">'+l.desc+'</span></button>').join('');
  m.innerHTML='<div class="lm-card"><div class="lm-h">FLIGHT SCHOOL</div>'+
    '<div class="lm-sub">Pick a lesson. A green arrow points at the button or instrument to use \u2014 do the action and it advances on its own.</div>'+
    '<div class="lm-list">'+items+'</div>'+
    '<div class="lm-foot"><button class="lm-close">CLOSE</button></div></div>';
  document.body.appendChild(m);
  m.addEventListener('click',e=>{
    if (e.target===m){ removeLessonMenu(); return; }
    const b=e.target.closest&&e.target.closest('.lm-item'); if(b){ startLesson(b.dataset.id); return; }
    if (e.target.closest&&e.target.closest('.lm-close')) removeLessonMenu();
  });
}
let _introOffered=false;
function introSeen(){ try{ return localStorage.getItem('f16_intro_seen')==='1'; }catch(e){ return false; } }
function markIntroSeen(){ try{ localStorage.setItem('f16_intro_seen','1'); }catch(e){} }
function removeIntroOffer(){ const o=document.getElementById('intro-offer'); if(o&&o.parentNode)o.parentNode.removeChild(o); }
function buildIntroOffer(){
  if (document.getElementById('intro-offer')) return;
  const o=document.createElement('div'); o.id='intro-offer';
  o.innerHTML='<div class="io-card"><div class="io-h">NEW PILOT?</div>'+
    '<div class="io-b">Flight School has short, guided lessons \u2014 takeoff &amp; navigation, targeting-pod and SAR strikes, air-to-air, datalink and ECM jamming. Each one points you through the steps.</div>'+
    '<div class="io-btns"><button class="io-go">\u25b8 OPEN FLIGHT SCHOOL</button><button class="io-skip">SKIP FOR NOW</button></div>'+
    '<div class="io-foot">Replay any time from the <b>H</b> manual.</div></div>';
  document.body.appendChild(o);
  o.querySelector('.io-go').addEventListener('click',()=>{ markIntroSeen(); buildLessonMenu(); });
  o.querySelector('.io-skip').addEventListener('click',()=>{ markIntroSeen(); removeIntroOffer(); });
}
function maybeOfferTutorial(){ if(_introOffered) return; _introOffered=true; if(!introSeen()) buildIntroOffer(); }


/* ---- splash / loading: 7s, game initialises behind it, click to skip ---- */
let _splashDone = false;
function finishSplash(){
  if (_splashDone) return; _splashDone = true;
  const sp = document.getElementById('splash');
  if (sp){ sp.classList.add('hide'); setTimeout(()=>{ if (sp.parentNode) sp.parentNode.removeChild(sp); }, 700); }
  // re-issue the takeoff prompt so the player sees it once the splash clears
  banner('TAKEOFF RWY 36  \u2014  THROTTLE UP (\u2191)  \u00b7  H=MANUAL  \u00b7  '+DIFFS[world.difficulty].name, 6);
  maybeOfferTutorial();
}
function startup(){
  boot();                                  // build the sim & start rendering behind the splash
  const sp  = document.getElementById('splash');
  const bar = document.getElementById('splash-bar');
  const stat= document.getElementById('splash-status');
  const STEPS = ['INITIALIZING SYSTEMS\u2026','ALIGNING INS\u2026','LOADING TERRAIN\u2026','UPLINKING DATALINK\u2026','ARMING STORES\u2026','READY'];
  if (sp) sp.addEventListener('click', finishSplash);
  const DUR = 7000, t0 = performance.now();
  (function tick(){
    const p = Math.min(1, (performance.now()-t0)/DUR);
    if (bar)  bar.style.width = (p*100).toFixed(1)+'%';
    if (stat) stat.textContent = STEPS[Math.min(STEPS.length-1, Math.floor(p*STEPS.length))];
    if (p < 1 && !_splashDone) requestAnimationFrame(tick);
    else finishSplash();
  })();
}
window.addEventListener('DOMContentLoaded', startup);
