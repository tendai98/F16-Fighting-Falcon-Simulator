/* =====================================================================
   F-16C STRIKE DEMO  —  core: math, world model, flight dynamics
   Coordinate frame:  X = East (m)   Y = North (m)   Z = Up (m)
   Heading psi: radians clockwise from North.  Pitch theta +up.  Roll phi +right-down.
   ===================================================================== */
'use strict';

/* ---------- constants ---------- */
const FT   = 3.280839895;       // m -> ft
const KT   = 1.943844;          // m/s -> knots
const NM   = 1852;              // m per nautical mile
const G0   = 9.80665;
const DEG  = Math.PI / 180;
const RAD  = 180 / Math.PI;

/* ---------- small math ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const wrap2pi = a => { a %= 2*Math.PI; return a < 0 ? a + 2*Math.PI : a; };
const angWrap = a => { a = (a + Math.PI) % (2*Math.PI); return (a < 0 ? a + 2*Math.PI : a) - Math.PI; };

function v3(x=0,y=0,z=0){ return {x,y,z}; }
const vsub = (a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const vadd = (a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const vscale=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const vdot = (a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const vcross=(a,b)=>({x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x});
const vlen = a=>Math.hypot(a.x,a.y,a.z);
function vnorm(a){ const l=vlen(a)||1; return {x:a.x/l,y:a.y/l,z:a.z/l}; }

/* ---------- deterministic value-noise terrain ---------- */
function hash2(ix, iy){
  let h = ix*374761393 + iy*668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;            // 0..1
}
function vnoise(x, y){
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy);
  const a = hash2(x0,   y0  ), b = hash2(x0+1, y0  );
  const c = hash2(x0,   y0+1), d = hash2(x0+1, y0+1);
  return lerp(lerp(a,b,u), lerp(c,d,u), v);
}
/* max ridge height (m) — dramatic peaks.  Terrain height scales by mission
   level: L1 x2, L2 x3, L3 x4, L4 x5, L5 x6.  Keep TERRAIN_PEAK as a global
   because the renderer/MFDs use it for vertical shading. */
const TERRAIN_BASE_PEAK = 1850;
const TERRAIN_LEVEL_MULTS = [2,3,4,5,6];
let TERRAIN_LEVEL_MULT = 3;
let TERRAIN_PEAK = TERRAIN_BASE_PEAK * TERRAIN_LEVEL_MULT;
function updateTerrainScaleForDifficulty(){
  const idx = (typeof world !== 'undefined' && world && Number.isFinite(world.difficulty)) ? world.difficulty : 1;
  const mult = TERRAIN_LEVEL_MULTS[clamp(idx,0,TERRAIN_LEVEL_MULTS.length-1)] || 3;
  if (mult !== TERRAIN_LEVEL_MULT){
    TERRAIN_LEVEL_MULT = mult;
    TERRAIN_PEAK = TERRAIN_BASE_PEAK * TERRAIN_LEVEL_MULT;
    if (typeof world !== 'undefined' && world) world.terrainGen = (world.terrainGen||0) + 1;
  }
}
/* per-run randomisation of the noise field (set by reseedTerrain) */
let TERRAIN_OFF = { x:0, y:0, s:1 };
/* structured terrain feature seed.  The renderer uses this so
   low-level routes are repeatable inside one mission/replay instead of pure
   random hill noise. */
let TERRAIN_FEATURES = { riverPhase:0, gorgePhase:0, ridgePhase:0 };
/* pads kept flat so these sites stay playable — {x,y,r outer, core inner-flat} */
let FLAT_SITES = [ {x:0,y:0,r:11000,core:2800}, {x:-3000,y:22000,r:6500,core:1500} ];

function _riverCenterX(Y){
  const f=TERRAIN_FEATURES||{};
  // winding river/valley corridor: broad enough to navigate, but with real bends
  return 4700*Math.sin((Y+(f.riverPhase||0))/9300)
       + 1700*Math.sin((Y-(f.riverPhase||0)*0.37)/3600)
       + 520*Math.sin((Y+(f.riverPhase||0)*0.21)/1450);
}
function _gorgeCenterX(Y){
  const f=TERRAIN_FEATURES||{};
  // tighter, more aggressive low-level route with sharper bends
  return -7600
       + 3000*Math.sin((Y+(f.gorgePhase||0))/6900)
       + 1300*Math.sin((Y+(f.gorgePhase||0)*0.31)/2600)
       + 430*Math.sin(Y/980);
}
function _ridgeSpineX(Y){
  const f=TERRAIN_FEATURES||{};
  return 8400 + 5200*Math.sin((Y+(f.ridgePhase||0))/14800) + 850*Math.sin((Y-(f.ridgePhase||0)*0.22)/3400);
}
function _gauss(d,w){ return Math.exp(-(d*d)/(2*w*w)); }
function terrainWaterInfo(X,Y){
  // Water bodies are disabled for performance and readability.  The terrain
  // still contains dry valleys, basins and gorge channels for low-level route
  // finding, but no cells are flattened or rendered as water.
  return null;
}
/* ground elevation (m) at world (X east, Y north) — structured mountains with
   valleys, gorges, basins and river channels for low-level ingress. */
function terrainH(X, Y){
  const s = (1/3000) * TERRAIN_OFF.s;       // feature scale (jittered per run)
  const ox = TERRAIN_OFF.x, oy = TERRAIN_OFF.y;
  let h = 0, amp = 1, freq = 1, norm = 0;
  for (let o=0;o<4;o++){
    h += vnoise((X+ox)*s*freq + 11.3, (Y+oy)*s*freq - 7.1) * amp;
    norm += amp; amp *= 0.5; freq *= 2.0;
  }
  h /= norm;                                            // 0..1 smooth
  let elev = Math.pow(h, 1.62) * TERRAIN_PEAK;          // high peaks, low valleys

  // mountain spine + cliff faces: pushes terrain into ranges rather than blobs
  const ridgeD = Math.abs(X - _ridgeSpineX(Y));
  elev += TERRAIN_PEAK*0.34*_gauss(ridgeD, 2500);
  elev += TERRAIN_PEAK*0.18*Math.max(0, Math.sin((X+TERRAIN_OFF.x)*0.00055 + (Y+TERRAIN_OFF.y)*0.00022));

  // river valley and tight gorge: tactical low-level corridors
  const riverD = Math.abs(X - _riverCenterX(Y));
  const gorgeD = Math.abs(X - _gorgeCenterX(Y));
  elev -= TERRAIN_PEAK*0.46*_gauss(riverD, 760);
  elev -= TERRAIN_PEAK*0.68*_gauss(gorgeD, 420);
  // steep walls beside the gorge create a tight, readable low-level route
  elev += TERRAIN_PEAK*0.22*_gauss(Math.abs(gorgeD-690), 210);

  // flatten pads: fully flat (0) inside `core`, smoothly blend to terrain by `r`
  let flat = 0;
  for (const st of FLAT_SITES){
    const d = Math.hypot(X-st.x, Y-st.y);
    const core = st.core || st.r*0.5;
    const ff = clamp((st.r - d)/Math.max(1,(st.r - core)), 0, 1);  // 1 in core -> 0 at r
    if (ff > flat) flat = ff;
  }
  elev *= (1 - flat);
  return Math.max(0,elev);
}

/* ===================================================================== */
/*  WORLD STATE                                                          */
/* ===================================================================== */
const world = {
  t: 0,
  paused: false,
  message: '',           // transient banner
  messageT: 0,
  outcome: null,         // 'WIN' | 'LOSS' | null
  outcomeReason: '',
  _missionGen: 0,          // increments on every mission reset/transition to invalidate delayed callbacks

  // ---- ownship flight state ----
  ac: {
    pos: v3(0, -1000, 0),  // start near south end of runway, on ground
    psi: 0,                // heading (north)
    theta: 0,              // pitch attitude (where the nose points)
    gamma: 0,              // flight-path angle (where the jet actually goes)
    alpha: 0,              // angle of attack (theta - gamma in pitch plane)
    phi: 0,                // roll
    tas: 0,                // true airspeed m/s
    throttle: 0.0,
    gear: true,
    onGround: true,
    g: 1.0,
    aoa: 0,
    vy: 0,                 // vertical speed m/s
    integrity: 100,
    flares: 30,
    chaff: 20,
  },

  // ---- runway / airbase ----
  runway: { x: 0, y: 0, len: 2400, w: 46, hdg: 0 },  // aligned to north
  groundAt0: 0,

  // ---- steerpoints (world meters; alt MSL m) ----
  waypoints: [
    { id:1, name:'TKOFF', x:     0, y:  1600, alt: 450 },
    { id:2, name:'WP02',  x:  4200, y:  6500, alt: 3200 },
    { id:3, name:'WP03',  x:  2200, y: 14000, alt: 4200 },
    { id:4, name:'TGT',   x: -3000, y: 22000, alt: 60   },
    { id:5, name:'WP05',  x:-12000, y: 16500, alt: 3200 },
    { id:6, name:'RTB',   x: -2000, y:   200, alt: 450  },
  ],
  steerpoint: 1,
  bullseye: { x: 2500, y: 12000 },

  // ---- SAM threat sites (ground) ----
  threats: [
    { name:'SA-3',  x:  6500, y: 12000, radius: 6500,  color:'#ff5050', live:true, launchT:-99, tracking:false },
    { name:'SA-8',  x:  -900, y: 23800, radius: 5500,  color:'#ff9a4d', live:true, launchT:-99, tracking:false },
    { name:'SA-3',  x: 10500, y: 19000, radius: 6500,  color:'#ff5050', live:true, launchT:-99, tracking:false },
  ],

  // ---- strike target complex (at TGT) ----
  target: {
    x: -3000, y: 22000,
    buildings: [],          // filled below
    destroyed: false,
  },

  // ---- airborne bandits ----
  bandits: [],
  // ---- new entity types ----
  groundMovers: [],   // moving ground targets (convoys / mobile TELs)
  hvts: [],           // high-value stationary ground assets
  friendlies: [],     // friendly data-acquisition assets (AWACS E-3 / E-2)
  structures: [],     // underground facilities — SAR-findable; armed at HARD/ACE
  airstrips: [],      // friendly FARPs — land & stop near the pad to rearm
  _reloadCD: 0,       // rearm cooldown so one pass reloads once
  difficulty: 1,      // index into DIFFS (set 0..4)
  quality: 1,         // index into QUALITY_LEVELS (0=LOW,1=MED,2=HIGH)
  lantirnOn: false,   // forward-look FLIR page state (optional / replay-safe)
  lantirnMode: 'OFF',  // OFF | FLIR — informational state for LANTIRN page
  infrastructure: { bridges:[], roads:[], powerlines:[] },

  // ---- in-flight weapons (bombs / missiles) ----
  bombs: [],
  sams:  [],     // missiles in flight (SAM, AAM, AGM, HARM)
  bullets: [],  // short-lived gun rounds/tracers
  decoys: [],   // flare/chaff countermeasure objects
  effects: [],   // explosions / smoke

  // ---- stores ----
  stations: [
    { id:1, pos:'LWT', wpn:'AIM-9X',  qty:2, sel:false, kind:'aa'   },  // 4 AAM
    { id:2, pos:'ROB', wpn:'AIM-120', qty:2, sel:false, kind:'aa'   },
    { id:3, pos:'LIB', wpn:'AGM-65',  qty:2, sel:false, kind:'agm'  },  // 4 guided A-G
    { id:4, pos:'RIB', wpn:'AGM-65',  qty:2, sel:false, kind:'agm'  },
    { id:5, pos:'LIN', wpn:'Mk-82',   qty:3, sel:true,  kind:'ag'   },  // 6 gravity bombs
    { id:6, pos:'RIN', wpn:'Mk-82',   qty:3, sel:false, kind:'ag'   },
    { id:7, pos:'LOB', wpn:'AGM-88',  qty:4, sel:false, kind:'harm' },  // 4 HARM
    { id:8, pos:'CT',  wpn:'TGP POD', qty:1, sel:false, kind:'pod'  },
  ],
  selectedStation: 5,
  masterArm: 'SAFE',   // SAFE | ARM | SIM
  masterMode: 'NAV',   // NAV | A-A | A-G | DGFT
  designated: false,   // ground target designated (TGP/FCR)
  tgpLaser: false,     // TGP laser firing (guides LGBs to the designated point)
  gndLock: null,       // locked ground contact (mover/hvt/target) for guided A-G
  airLock: null,       // locked air contact (bandit) for TGP A-A
  harmLock: null,      // designated radar emitter (HAD) for HARM
  ecm: { on:false, jam:[], cursor:50 },   // EW pod: master switch, locked jam frequencies (max JAM_SLOTS), spectrum cursor
  datalinkBroadcast: '124.85',  // freq the AWACS transmits on (tune the DED to match)
  datalinkTuned: '',            // freq the player has entered on the DED
  dlEntry: '',                  // DED scratchpad while typing a freq

  // BIT page
  bit: [
    {name:'FCC',s:'GO'},{name:'INS',s:'GO'},{name:'EGI',s:'GO'},{name:'FCR',s:'GO'},
    {name:'SMS',s:'GO'},{name:'TGP',s:'GO'},{name:'RWR',s:'GO'},{name:'CMDS',s:'GO'},
    {name:'HUD',s:'GO'},{name:'UFC',s:'GO'},{name:'MFD-L',s:'GO'},{name:'MFD-R',s:'GO'},
  ],

  activeMfdId: 'center',
  _seed: 1,
};

/* build a fresh, randomised mission: target location, route, buildings, SAM
   sites and the flat pads. Runway/takeoff stays fixed at the origin. */
function buildMission(){
  // --- strike target somewhere downrange ---
  const tx = (Math.random()*2-1)*12000;          // east/west spread
  const ty = 17000 + Math.random()*10000;        // 17..27 km north
  world.target.x = tx; world.target.y = ty; world.target.destroyed = false;

  // flat pads: runway (origin) + the target area
  FLAT_SITES = [ {x:0,y:0,r:11000,core:2800}, {x:tx,y:ty,r:6500,core:1500} ];

  // --- target complex buildings around the centre ---
  const defs = [
    { dx:  0,  dy:  0,  w:34, l:22, h:16, primary:true,  label:'CMD BUNKER' },
    { dx: 55,  dy: 18,  w:26, l:18, h:9 },
    { dx:-48,  dy: 22,  w:30, l:16, h:8 },
    { dx: 30,  dy:-46,  w:20, l:40, h:7 },
    { dx:-40,  dy:-40,  w:18, l:18, h:11 },
    { dx: 80,  dy:-20,  w:14, l:14, h:6 },
  ];
  world.target.buildings = defs.map(d=>({
    x: tx+d.dx, y: ty+d.dy, w:d.w, l:d.l, h:d.h,
    primary:!!d.primary, label:d.label||'', destroyed:false,
  }));

  // --- enroute steerpoints: takeoff -> 2 random waypoints -> target -> egress -> RTB ---
  const w2 = { x: rrange(-4000,6000),  y: rrange(5000,9000) };
  const w3 = { x: tx*0.4 + rrange(-3000,3000), y: (ty+9000)/2 + rrange(-1500,1500) };
  const eg = { x: tx - Math.sign(tx||1)*rrange(7000,11000), y: ty - rrange(4000,7000) };
  world.waypoints = [
    { id:1, name:'TKOFF', x:0,    y:1600,  alt:450 },
    { id:2, name:'WP02',  x:w2.x, y:w2.y,  alt:rrange(5500,7000) },
    { id:3, name:'WP03',  x:w3.x, y:w3.y,  alt:rrange(6500,8000) },
    { id:4, name:'TGT',   x:tx,   y:ty,    alt:60 },
    { id:5, name:'WP05',  x:eg.x, y:eg.y,  alt:rrange(5500,7000) },
    { id:6, name:'RTB',   x:-2000,y:200,   alt:450 },
  ];
  world.steerpoint = 1;
  spawnAirstrips();    // friendly FARPs to land & rearm (independent of threats)
  world.bullseye = { x: rrange(-3000,4000), y: rrange(9000,15000) };

  // --- air defence: corridor jammer + BASIC-heavy rings; advanced only at HARD/ACE ---
  world.threats = [];
  const lvl = world.difficulty || 0;                       // 0 EASY .. 3 ACE
  // run-in corridor site (basic SA-8 jammer) between the runway and the target
  world.threats.push({ name:'SA-8', x:rrange(-12000,12000), y:rrange(11000, Math.max(12000,ty-4000)),
                       radius:6000, color:'#ff9a4d', live:true, launchT:-99, tracking:false, jammer:true });
  // basic rings at every level; advanced rings layered on at HARD (+SA-6) and ACE (+SA-10,+SA-15)
  const baseLayers = [
    { name:'SA-3', radius:6500, color:'#ff5050', ring:4200 },   // basic, medium
    { name:'SA-8', radius:5500, color:'#ff9a4d', ring:2000 },   // basic, point
  ];
  const layers = baseLayers.slice();
  if (lvl>=2) layers.push({ name:'SA-6',  radius:9000,  color:'#ff9a4d', ring:5400 });   // HARD
  if (lvl>=3){ layers.push({ name:'SA-10', radius:14000, color:'#ff5050', ring:7200 });   // ACE
               layers.push({ name:'SA-15', radius:5000,  color:'#ff9a4d', ring:1500 }); }
  for (const L of layers){
    const a = rrange(0, 2*Math.PI);
    world.threats.push({ name:L.name, x:tx+Math.sin(a)*L.ring, y:ty+Math.cos(a)*L.ring,
                         radius:L.radius, color:L.color, live:true, launchT:-99, tracking:false });
  }
  // extra short-range BASIC point defence, a little denser at higher levels
  const extra = 1 + clamp(lvl,0,3);                        // EASY 1 ... ACE 4
  for (let i=0;i<extra;i++){
    const a = rrange(0,2*Math.PI), r = rrange(1100,3000);
    world.threats.push({ name: i%2?'SA-8':'SA-3', x:tx+Math.sin(a)*r, y:ty+Math.cos(a)*r,
                         radius: i%2?5500:6500, color:'#ff8a4d', live:true, launchT:-99, tracking:false });
  }
  scatterScenario();   // wide-area basic SAMs so the whole map has activity
  resetStream();       // arm procedural streaming of threats as the jet flies out
}

/* spawn airborne bandits (n of them; optional high-value air target) */
/* --- graphics quality presets ---
   `scale` is the internal render-resolution multiplier (the biggest perf lever:
   fewer pixels to fill); R/step set the terrain mesh density + draw distance. */
const QUALITY_LEVELS = [
  { name:'LOW',  scale:0.6,  R:14, step:560 },
  { name:'MED',  scale:0.85, R:18, step:480 },
  { name:'HIGH', scale:1.0,  R:22, step:420 },
];

/* --- small RNG helpers --- */
const rrange = (a,b)=> a + Math.random()*(b-a);
const rpick  = arr => arr[(Math.random()*arr.length)|0];
/* reseed the procedural terrain so every run has different mountains */
function reseedTerrain(){
  TERRAIN_OFF = { x:(Math.random()*2-1)*80000, y:(Math.random()*2-1)*80000, s:0.85+Math.random()*0.35 };
  TERRAIN_FEATURES = {
    riverPhase: (Math.random()*2-1)*50000,
    gorgePhase: (Math.random()*2-1)*50000,
    ridgePhase: (Math.random()*2-1)*50000
  };
  world.terrainGen = (world.terrainGen||0) + 1;     // invalidates cached heightfields
}
function buildTerrainInfrastructure(){
  world.infrastructure = { bridges:[], roads:[], powerlines:[] };
  const ys=[20500,25500,31500,37500,43500];
  for (let i=0;i<ys.length;i++){
    const y=ys[i]+rrange(-900,900), rx=_riverCenterX(y);
    world.infrastructure.bridges.push({x:rx,y,hdg:Math.PI/2+rrange(-0.2,0.2),len:420,w:36,name:'BRIDGE'});
    const road=[];
    for (let k=-4;k<=4;k++){ const yy=y+k*1100; road.push({x:_riverCenterX(yy)+rrange(-350,350),y:yy,z:terrainH(_riverCenterX(yy),yy)+2}); }
    world.infrastructure.roads.push({pts:road,name:'VALLEY RD'});
  }
  for (let i=0;i<3;i++){
    const y=20500+i*8500+rrange(-1500,1500);
    world.infrastructure.powerlines.push({a:{x:_gorgeCenterX(y)-1200,y:y-2400},b:{x:_gorgeCenterX(y+3000)+1600,y:y+2600},name:'PWR'});
  }
}

/* spawn airborne bandits at random positions in the theatre */
function spawnBandits(n=3, hva=false){
  world.bandits = [];
  for (let i=0;i<clamp(n,0,8);i++){
    const bx=rrange(-16000,16000), by=rrange(9000,27000);
    world.bandits.push({
      x: bx, y: by, alt: Math.max(rrange(5500,9000), terrainH(bx,by)+900),
      psi: rrange(0,2*Math.PI), spd: rrange(180,260), hp:1,
      kind: (world.difficulty||0)>=4 ? 'HOSTILE' : (Math.random()<0.7?'HOSTILE':'UNKNOWN'),
    });
  }
  if (hva){
    const hx=rrange(12000,20000), hy=rrange(22000,28000);
    world.bandits.push({ x:hx, y:hy, alt:Math.max(rrange(9000,11000), terrainH(hx,hy)+1200),
                         psi:rrange(0,2*Math.PI), spd:rrange(130,160), hp:2, kind:'HVA-AIR', name:'MAINSTAY' });
  }
}

/* moving ground targets — random slow tracks across the deck */
/* no hostile ground emitter spawns inside this radius of the home runway, and
   SAMs won't engage while the jet is still inside it — so you can take off in peace */
const BASE_SAFE_R = 9000;
function farFromBase(x,y){ return Math.hypot(x,y) > BASE_SAFE_R; }
/* pick a random point that is clear of the base (bounded retries) */
function ptClearOfBase(xlo,xhi,ylo,yhi){
  for (let g=0; g<60; g++){ const x=rrange(xlo,xhi), y=rrange(ylo,yhi); if (farFromBase(x,y)) return {x,y}; }
  return { x:rrange(xlo,xhi), y:Math.max(ylo, BASE_SAFE_R+2000) };
}
/* randomized target geometry so every ground contact looks distinct on the TGP */
function mkGeom(types){
  const t = rpick(types);
  const base = { truck:{l:14,w:5,h:4}, tank:{l:9,w:6,h:3}, sam:{l:12,w:5,h:7},
                 radar:{l:8,w:8,h:10}, fuel:{l:11,w:7,h:6}, bunker:{l:24,w:16,h:7} }[t] || {l:10,w:6,h:5};
  const k = rrange(0.8,1.5);
  return { type:t, l:base.l*k, w:base.w*k, h:base.h*k, rot:rrange(0,2*Math.PI) };
}
function spawnGroundMovers(n){
  world.groundMovers = [];
  const lvl = world.difficulty||0;
  const convoyNames=['CONVOY','SUPPLY COL','ARMOR COL','FUEL COL'];
  n = clamp(n,0,6);
  for (let i=0;i<n;i++){
    // some movers are mobile TELs that emit (show on HAD, HARM-able, can shoot)
    const isTEL = (i%2===0) || (lvl>=1 && Math.random()<0.5);
    // hostile launchers stay clear of the base; harmless convoys can roam anywhere
    const p = isTEL ? ptClearOfBase(-30000,30000,6000,40000) : {x:rrange(-30000,30000), y:rrange(6000,40000)};
    const m = {
      x: p.x, y: p.y, psi: rrange(0,2*Math.PI), spd: rrange(9,20),
      hp:1, destroyed:false, underground:false, track:[],
    };
    if (isTEL){
      Object.assign(m, {
        name: rpick(lvl>=2 ? ['SA-15 TEL','SA-8 TEL','SCUD TEL'] : ['SA-8 TEL','SCUD TEL']), kind:'TEL',
        emits:true, mobile:true, radius: rrange(5000,7000), color:'#ff9a4d',
        live:true, launchT:-99, tracking:false, hostile:true,   // active at all levels (aggression scales)
        geom: mkGeom(['sam','sam','radar']),
      });
      world.threats.push(m);                 // one object, also seen as a radar emitter
    } else {
      Object.assign(m, { name: rpick(convoyNames), kind:'GROUND', geom: mkGeom(['truck','tank','fuel','truck']) });
    }
    if (world.structures.length && Math.random()<0.4){    // route ~40% to a cavern
      const s = rpick(world.structures); m.cavern = {x:s.x, y:s.y};
    }
    world.groundMovers.push(m);
  }
}
/* underground facilities — found with SAR; their launchers are live at HARD/ACE */
function spawnStructures(n, hostile){
  world.structures = [];
  for (let i=0;i<clamp(n,0,5);i++){
    const p = ptClearOfBase(-30000,30000,8000,38000);
    const s = { x:p.x, y:p.y, name:'UGF '+(i+1), hp:2, destroyed:false, hostile:!!hostile,
                depth:rrange(40,90), track:[], structure:true, geom: mkGeom(['bunker']) };
    if (hostile){                            // armed: its buried launcher emits (HAD / HARM / fire)
      Object.assign(s, { emits:true, radius:rrange(7000,11000), color:'#ff5050',
                         live:true, launchT:-99, tracking:false });
      world.threats.push(s);
    }
    world.structures.push(s);
  }
}
/* scatter extra SAM sites across a wide area so the whole map has activity */
function scatterScenario(){
  const lvl = world.difficulty||0;
  const basics = [{name:'SA-3',radius:6500,color:'#ff5050'},{name:'SA-8',radius:5500,color:'#ff9a4d'},{name:'SA-2',radius:7000,color:'#ff8a4d'}];
  const advs   = [{name:'SA-6',radius:9000,color:'#ff9a4d'},{name:'SA-15',radius:5000,color:'#ff9a4d'},{name:'SA-10',radius:14000,color:'#ff5050'}];
  const nBasic = 6 + lvl*2;                  // EASY 6 ... ACE 12 basic sites, spread wide
  const nAdv   = lvl>=2 ? (lvl-1) : 0;       // advanced only at HARD (1) and ACE (2)
  const put=(list)=>{ const t=rpick(list); let x,y,ok=false,g=0;
    while(!ok && g++<40){ x=rrange(-32000,32000); y=rrange(3000,44000); ok=farFromBase(x,y); }
    if(!ok) return;
    world.threats.push({ name:t.name, x, y, radius:t.radius, color:t.color, live:true, launchT:-99, tracking:false, hostile:true }); };
  for (let i=0;i<nBasic;i++) put(basics);
  for (let i=0;i<nAdv;i++)   put(advs);
}

/* ===================== PROCEDURAL WORLD STREAMING =====================
   Threats and movers are seeded into the grid cells around the jet as it flies, so
   the whole theatre is populated as you move out instead of one hotspot. Basic SAMs
   appear everywhere; advanced SAMs only at HARD/ACE. Far procedural objects are
   culled (and their cell freed) to keep the count modest; cells whose site you
   destroyed stay clear, untouched cells re-stream the same layout if you return. */
const STREAM_CELL=15000, STREAM_SPAWN_R=26000, STREAM_CULL_R=40000;
const STREAM_SAM_CAP=14, STREAM_MOVER_CAP=8;
function resetStream(){ world._cells=new Set(); world._deadCells=new Set(); world._streamSeed=(Math.random()*1e9)|0; world._streamT=0; }
function cellRand(cx,cy,salt){
  let h=(Math.imul(cx|0,73856093) ^ Math.imul(cy|0,19349663) ^ Math.imul(world._streamSeed||1,83492791) ^ Math.imul(salt|0,2654435761))>>>0;
  h^=h>>>13; h=Math.imul(h,1274126177)>>>0; h^=h>>>16; return (h>>>0)/4294967296;
}
function seedCell(cx,cy){
  const key=cx+'_'+cy;
  if (world._cells.has(key) || world._deadCells.has(key)) return;
  world._cells.add(key);
  const lvl=world.difficulty||0, ox=cx*STREAM_CELL, oy=cy*STREAM_CELL;
  if (Math.hypot(ox+STREAM_CELL/2, oy+STREAM_CELL/2) < BASE_SAFE_R+STREAM_CELL*0.4) return;   // keep takeoff clear
  // a SAM?
  if (world.threats.filter(t=>t._proc).length < STREAM_SAM_CAP && cellRand(cx,cy,1)<0.5){
    const x=ox+(0.2+0.6*cellRand(cx,cy,2))*STREAM_CELL, y=oy+(0.2+0.6*cellRand(cx,cy,3))*STREAM_CELL;
    if (farFromBase(x,y)){
      const adv = lvl>=2 && cellRand(cx,cy,4)<0.18;       // advanced only at HARD/ACE, and rare
      const list = adv ? [{name:'SA-6',radius:9000,color:'#ff9a4d'},{name:'SA-15',radius:5000,color:'#ff9a4d'},{name:'SA-10',radius:14000,color:'#ff5050'}]
                       : [{name:'SA-3',radius:6500,color:'#ff5050'},{name:'SA-8',radius:5500,color:'#ff9a4d'},{name:'SA-2',radius:7000,color:'#ff8a4d'}];
      const t=list[(cellRand(cx,cy,5)*list.length)|0];
      world.threats.push({ name:t.name, x, y, radius:t.radius, color:t.color, live:true, launchT:-99, tracking:false, hostile:true, _proc:true, _cell:key });
    }
  }
  // a ground mover / mobile TEL?
  if (world.groundMovers.filter(g=>g._proc).length < STREAM_MOVER_CAP && cellRand(cx,cy,6)<0.26){
    const x=ox+(0.2+0.6*cellRand(cx,cy,7))*STREAM_CELL, y=oy+(0.2+0.6*cellRand(cx,cy,8))*STREAM_CELL;
    if (farFromBase(x,y)){
      const pick=(arr,salt)=>arr[(cellRand(cx,cy,salt)*arr.length)|0];
      const isTEL = lvl>=1 && cellRand(cx,cy,9)<0.4;
      const m={ x, y, psi:cellRand(cx,cy,10)*6.283, spd:9+cellRand(cx,cy,11)*9, hp:1, destroyed:false, underground:false, track:[], _proc:true, _cell:key };
      if (isTEL){ Object.assign(m,{ name:pick(lvl>=2 ? ['SA-8 TEL','SA-15 TEL'] : ['SA-8 TEL','SCUD TEL'],12), kind:'TEL', emits:true, mobile:true, radius:5000+cellRand(cx,cy,13)*1500,
                    color:'#ff9a4d', live:true, launchT:-99, tracking:false, hostile:true, geom:mkGeom(['sam','radar']) });
                  world.threats.push(m); }
      else Object.assign(m,{ name:pick(['CONVOY','SUPPLY COL','ARMOR COL'],12), kind:'GROUND', geom:mkGeom(['truck','tank','fuel']) });
      world.groundMovers.push(m);
    }
  }
}
function streamWorld(dt){
  if (!world._cells) resetStream();
  world._streamT=(world._streamT||0)+dt; if (world._streamT<0.5) return; world._streamT=0;
  const ac=world.ac, pcx=Math.floor(ac.pos.x/STREAM_CELL), pcy=Math.floor(ac.pos.y/STREAM_CELL);
  const R=Math.ceil(STREAM_SPAWN_R/STREAM_CELL);
  for (let dx=-R;dx<=R;dx++) for (let dy=-R;dy<=R;dy++){
    const cx=pcx+dx, cy=pcy+dy, ccx=cx*STREAM_CELL+STREAM_CELL/2, ccy=cy*STREAM_CELL+STREAM_CELL/2;
    if (Math.hypot(ccx-ac.pos.x, ccy-ac.pos.y)<=STREAM_SPAWN_R) seedCell(cx,cy);
  }
  for (let i=world.threats.length-1;i>=0;i--){ const t=world.threats[i];
    if (t._proc && Math.hypot(t.x-ac.pos.x, t.y-ac.pos.y)>STREAM_CULL_R){
      if (t.destroyed||t.live===false) world._deadCells.add(t._cell);
      world._cells.delete(t._cell); world.threats.splice(i,1); } }
  for (let i=world.groundMovers.length-1;i>=0;i--){ const m=world.groundMovers[i];
    if (m._proc && Math.hypot(m.x-ac.pos.x, m.y-ac.pos.y)>STREAM_CULL_R){
      if (m.destroyed) world._deadCells.add(m._cell);
      world._cells.delete(m._cell); world.groundMovers.splice(i,1); } }
}
/* FARPs removed — rearm is now an automatic per-station cooldown (see checkReload) */
function spawnAirstrips(){ world.airstrips = []; }

/* high-value stationary ground assets — random sites near the route */
function spawnHVTs(n){
  const names=['EW RADAR','SAM HQ','FUEL DEPOT','C2 BUNKER','AMMO DUMP','POWER STN'];
  const pool=names.slice();
  world.hvts = [];
  for (let i=0;i<clamp(n,0,pool.length);i++){
    const name = pool.splice((Math.random()*pool.length)|0,1)[0];
    const p = ptClearOfBase(-9000,12000,11000,25000);
    world.hvts.push({ x:p.x, y:p.y, name, hp:1, kind:'HVT', destroyed:false, geom: mkGeom(['radar','bunker','fuel']) });
  }
}

/* friendly data-acquisition assets (AWACS) — random orbits behind the lines */
/* two off-board datalink channels — tune the DED to one to get that picture */
const DL_CHANNELS = [
  { type:'E-3 SENTRY',  tag:'E3', freq:'124.85', r:[50000,62000] },   // bigger radar -> longer link
  { type:'E-2 HAWKEYE', tag:'E2', freq:'126.50', r:[38000,50000] },
];
function spawnFriendlies(n){
  world.friendlies = [];
  n = clamp(n,0,2);
  for (let i=0;i<n;i++){
    const ch = DL_CHANNELS[i % DL_CHANNELS.length];                    // i=0 -> E-3, i=1 -> E-2
    const cx=rrange(-7000,9000), cy=rrange(-9000,1500), orbitR=rrange(1800,3000);
    world.friendlies.push({
      type: ch.type, tag: ch.tag, freq: ch.freq, cx, cy, orbitR,
      alt: Math.max(rrange(9000,11500), terrainH(cx,cy)+1500),
      datalinkR: rrange(ch.r[0], ch.r[1]),
      ang: rrange(0,2*Math.PI), rate: rrange(0.09,0.14),
      alive:true, x:cx+orbitR, y:cy, psi:0,
    });
  }
}

/* difficulty presets — scale how many of each entity spawn */
const DIFFS = [
  { name:'EASY',       bandits:1, movers:2, hvts:1, friendlies:2, hva:false, structures:2, airOnly:false },
  { name:'NORMAL',     bandits:3, movers:3, hvts:2, friendlies:2, hva:false, structures:2, airOnly:false },
  { name:'HARD',       bandits:5, movers:4, hvts:3, friendlies:1, hva:true,  structures:3, airOnly:false },
  { name:'ACE',        bandits:6, movers:5, hvts:3, friendlies:0, hva:true,  structures:4, airOnly:false },
  { name:'AIR SUPER',  bandits:8, movers:0, hvts:0, friendlies:0, hva:false, structures:0, airOnly:true  },
];
function applyDifficulty(){
  updateTerrainScaleForDifficulty();
  const d = DIFFS[world.difficulty] || DIFFS[1];
  // drop any previous mobile/structure emitters so re-applying never duplicates them
  world.threats = world.threats.filter(t=>!t.mobile && !t.structure);
  world.ecm = { on:false, jam:[], cursor:50 };               // clear any jamming from a prior mission
  world._aggr = [0.55,0.8,1.0,1.3,1.55][world.difficulty] || 0.8;   // fire-rate scale by level
  if (d.airOnly){
    world.groundMovers=[]; world.hvts=[]; world.structures=[];
    world.threats = []; // Level 5 is aircraft-only: no SAM/ground objective layer.
  } else {
    spawnStructures(d.structures, true);                  // present & armed at every level (aggression scales)
    spawnGroundMovers(d.movers);
    spawnHVTs(d.hvts);
    spawnFriendlies(d.friendlies);
  }
  spawnBandits(d.bandits, d.hva);
  if (d.airOnly){
    // Level 5 is an air-superiority mission: no ground target is required.
    world.target.destroyed = false;
    world.steerpoint = Math.min(world.steerpoint||2, world.waypoints.length);
  }
}

/* crawl the ground movers along the deck with a little wander */
function updateGroundMovers(dt){
  for (const m of world.groundMovers){
    if (m.destroyed || m.underground) continue;
    if (m.cavern){                            // head for the cavern, then go underground
      const dx=m.cavern.x-m.x, dy=m.cavern.y-m.y, d=Math.hypot(dx,dy);
      if (d < 60){ m.underground=true; if (m.live!==undefined) m.live=false; continue; }
      m.psi = wrap2pi(m.psi + angWrap(Math.atan2(dx,dy)-m.psi)*clamp(1.5*dt,0,1));
    } else {
      m.psi = wrap2pi(m.psi + 0.04*dt*Math.sin(world.t*0.2 + m.x*0.0003));
    }
    m.x += Math.sin(m.psi)*m.spd*dt;
    m.y += Math.cos(m.psi)*m.spd*dt;
    m._tt = (m._tt||0) + dt;                  // sampled track for the SAR GMT trail
    if (m._tt > 1.2){ m._tt=0; m.track.push({x:m.x,y:m.y}); if (m.track.length>10) m.track.shift(); }
  }
}
/* ===================== ELECTRONIC WARFARE (jamming) =====================
   The EW pod sweeps a 0..100 frequency spectrum. Every SAM within ECM_DET
   radiates on a small set of fixed frequencies (its "bands"); each return grows
   stronger as you close. On the ECM page you slide a cursor across the spectrum
   and lock up to JAM_SLOTS frequencies into the pod. A SAM is suppressed only
   when EVERY one of its bands is covered by a jam slot AND you are still outside
   its burn-through radius (an inner ring, not drawn on the HSD). Spreading the
   pod across more slots weakens each, pushing burn-through OUT — so blanket
   jamming is self-defeating; jam only the bands you need. Advanced SAMs
   frequency-HOP, shifting a band to a new peak you must find and re-lock. */
const ECM_DET   = 70000;     // spectrum detection range (well beyond any firing ring)
const JAM_SLOTS = 8;         // pod can lock up to 8 jam frequencies at once
const JAM_TOL   = 2.5;       // a slot covers a band within +/- this on the 0..100 scale
const ECM_POWER = 1.0;
const ECM_BANDS = [1,2,3,4,5,6,7,8];   // (legacy export kept for any external refs)
function samClassPow(th){ const n=th.name||''; if(/SA-10/.test(n))return 1.35; if(/SA-6|SA-15|SA-11/.test(n))return 1.0; return 0.78; }
function assignSamFreqs(th){
  let n=1, hop=false;
  if (/SA-10/.test(th.name||'')){ n=3; hop=true; }            // top-tier: 3 bands, hops
  else if (/SA-6|SA-15/.test(th.name||'')){ n=2; hop=true; }   // mid: 2 bands, hops
  else { n=1; hop=false; }                                     // basic: single band, no hop
  const bands=[]; let guard=0;
  while (bands.length<n && guard++<240){ const f=Math.round((6+Math.random()*88)*2)/2;   // 6..94 in 0.5 steps
    if (bands.every(b=>Math.abs(b-f)>=8)) bands.push(f); }                                // keep them apart
  th.bands=bands; th.scanBands=bands.slice();                  // scanBands kept for legacy reads
  th.hopCapable=hop; th.classPow=samClassPow(th);
  th._hopT = 9 + Math.random()*10; th._jamHold=0;
}
function bandCovered(f){ const J=world.ecm.jam||[]; for (let i=0;i<J.length;i++) if (Math.abs(J[i]-f)<=JAM_TOL) return true; return false; }
function allBandsCovered(th){ if(!th.bands||!th.bands.length) return false; for(const f of th.bands) if(!bandCovered(f)) return false; return true; }
function ecmBurnRange(th){
  const used=Math.max(1,(world.ecm.jam||[]).length);
  const perBand=ECM_POWER/used;                               // pod power split across locked slots
  return clamp(th.radius * 0.085 * (th.classPow||1) / perBand, 1400, th.radius*0.92);
}
/* every band covered, master on, and still OUTSIDE burn-through -> suppressed */
function emitterJammed(th){
  if (!world.ecm.on || !(world.ecm.jam||[]).length || !th.bands) return false;
  if (!allBandsCovered(th)) return false;
  return distTo(th.x, th.y) > ecmBurnRange(th);
}
/* pod is covering it but you're inside burn-through -> it sees you anyway */
function emitterBurnThru(th){
  if (!world.ecm.on || !th.bands || !allBandsCovered(th)) return false;
  return distTo(th.x, th.y) <= ecmBurnRange(th);
}
/* hopCapable SAMs shift one band to a fresh peak on a timer (sooner while fully
   jammed) so you must re-find and re-lock them on the spectrum */
function updateSamScan(th, dt){
  if (!th.bands) assignSamFreqs(th);
  if (!th.hopCapable) return;
  const fully = world.ecm.on && allBandsCovered(th);
  th._jamHold = fully ? (th._jamHold||0)+dt : 0;
  th._hopT -= dt + (fully?dt*1.6:0);
  if (th._hopT<=0){
    th._hopT = 10 + Math.random()*10;
    let idx = th.bands.findIndex(f=>bandCovered(f)); if (idx<0) idx=(Math.random()*th.bands.length)|0;
    let nf, guard=0;
    do { nf=Math.round((6+Math.random()*88)*2)/2; guard++; }
    while (guard<240 && (bandCovered(nf) || th.bands.some((b,j)=>j!==idx && Math.abs(b-nf)<8)));
    th.bands[idx]=nf; th.scanBands=th.bands.slice();
    if (distTo(th.x,th.y)<ECM_DET) banner((th.name||'SAM')+' FREQ HOP \u2014 REACQUIRE',1.6);
  }
}
/* spectrum peaks for every detected emitter (drives the ECM page + selection) */
function ecmSpectrum(){
  const out=[];
  for (const th of world.threats){ if(!th.live||th.destroyed||th.x===undefined) continue;
    const d=distTo(th.x,th.y); if (d>ECM_DET) continue;
    if (!th.bands) assignSamFreqs(th);
    const strength=clamp(1-(d/ECM_DET),0.05,1)*(th.classPow||1);     // closer / stronger -> taller peak
    for (const f of th.bands) out.push({ th, f, d, strength, jammed:bandCovered(f) });
  }
  return out;
}
/* toggle a jam slot at frequency f. returns 'JAMMING' | 'CLEARED' | 'FULL' */
function ecmLockFreq(f){
  const J=world.ecm.jam; f=Math.round(f*2)/2;
  const i=J.findIndex(j=>Math.abs(j-f)<=JAM_TOL);
  if (i>=0){ J.splice(i,1); if(!J.length) {} return 'CLEARED'; }
  if (J.length>=JAM_SLOTS) return 'FULL';
  J.push(f); world.ecm.on=true; return 'JAMMING';
}
/* lock the detected peak nearest the cursor (the slider "select") */
function ecmSelectCursor(){
  const sp=ecmSpectrum(); if(!sp.length) return 'NONE';
  let best=null, bd=6; for(const p of sp){ const dd=Math.abs(p.f-(world.ecm.cursor||50)); if(dd<bd){bd=dd;best=p;} }
  return best ? ecmLockFreq(best.f) : 'NONE';
}
/* convenience: fill slots from the strongest detected peaks */
function ecmAuto(){
  const sp=ecmSpectrum().sort((a,b)=>b.strength-a.strength);
  for (const p of sp){ if (world.ecm.jam.length>=JAM_SLOTS) break; if(!bandCovered(p.f)) ecmLockFreq(p.f); }
  world.ecm.on=true; return world.ecm.jam.length;
}
function ecmMoveCursor(dx){ world.ecm.cursor=clamp((world.ecm.cursor||50)+dx, 0, 100); }
function ecmClear(){ world.ecm.jam=[]; }
/* release any jam slot that no longer sits on a LIVE, DETECTABLE emitter's band —
   so a slot frees itself when its SAM is destroyed (its peak drops), hops a band
   away, OR you simply fly out of detection range of it. Returns slots cleared. */
function ecmSyncSlots(){
  const J=world.ecm.jam; if(!J||!J.length) return 0;
  let cleared=0;
  for (let i=J.length-1;i>=0;i--){ const f=J[i]; let covers=false;
    for (const th of world.threats){ if(!th.live||th.destroyed||!th.bands) continue;
      if (distTo(th.x,th.y) > ECM_DET) continue;        // out of detection range -> not "radiating" to us
      for (const b of th.bands){ if(Math.abs(b-f)<=JAM_TOL){ covers=true; break; } }
      if(covers) break; }
    if(!covers){ J.splice(i,1); cleared++; }
  }
  return cleared;
}

/* automatic rearm — when a weapon station goes WINCHESTER (qty 0) it reloads
   itself after a 10s cooldown. No landing required; the delay is the cost.
   The SMS page shows the countdown. (TGP pod & tanks never reload.) */
const REARM_QTY={1:2,2:2,3:2,4:2,5:3,6:3,7:4};   // station 8 (pod) excluded
const REARM_SECS=10;
function checkReload(dt){
  for (const st of world.stations){
    const max = REARM_QTY[st.id];
    if (max===undefined){ continue; }                 // pod / non-reloadable
    if (st.qty>0){ st.reloadT = 0; continue; }         // still has rounds
    if (!st.reloadT){                                  // just went empty -> start the clock
      st.reloadT = world.t + REARM_SECS;
      banner('STA '+st.id+' '+(st.wpn||'')+' WINCHESTER \u2014 REARMING '+REARM_SECS+'s', 1.8);
    } else if (world.t >= st.reloadT){                 // cooldown elapsed -> restock
      st.qty = max; st.reloadT = 0;
      banner('STA '+st.id+' '+(st.wpn||'')+' RELOADED', 1.8);
      if (window.F16Audio) F16Audio.event('select');
      refreshAllMfd();
    }
  }
}
/* orbit the friendly AWACS aircraft */
function updateFriendlies(dt){
  for (const f of world.friendlies){
    if (!f.alive) continue;
    f.ang = wrap2pi(f.ang + f.rate*dt);
    f.x = f.cx + Math.cos(f.ang)*f.orbitR;
    f.y = f.cy + Math.sin(f.ang)*f.orbitR;
    f.psi = wrap2pi(f.ang + Math.PI/2);
  }
}
/* datalink is up when a living AWACS is within its link range of us */
/* the AWACS currently providing the link: an alive friendly, in range, whose
   channel matches the DED-tuned frequency (nearest wins). null if no link. */
function datalinkSource(){
  const ac=world.ac; let best=null, bestD=Infinity;
  for (const f of world.friendlies){
    if (!f.alive || f.freq!==world.datalinkTuned) continue;
    const d=Math.hypot(f.x-ac.pos.x, f.y-ac.pos.y);
    if (d < f.datalinkR && d < bestD){ bestD=d; best=f; }
  }
  return best;
}
function datalinkActive(){ return !!datalinkSource(); }

buildMission();
reseedTerrain();
if (typeof buildTerrainInfrastructure==='function') buildTerrainInfrastructure();
applyDifficulty();

/* ---------- orientation basis from psi/theta/phi ---------- */
function acBasis(ac){
  const cT=Math.cos(ac.theta), sT=Math.sin(ac.theta);
  const cP=Math.cos(ac.psi),   sP=Math.sin(ac.psi);
  // forward: heading from north (+Y), east is +X, pitch raises Z
  const fwd = { x: cT*sP, y: cT*cP, z: sT };
  // level right (before roll): cross(fwd, worldUp)
  let right = vnorm(vcross(fwd, {x:0,y:0,z:1}));
  let up    = vnorm(vcross(right, fwd));
  // apply roll about forward axis
  const cR=Math.cos(ac.phi), sR=Math.sin(ac.phi);
  const r2 = { x: right.x*cR + up.x*sR, y: right.y*cR + up.y*sR, z: right.z*cR + up.z*sR };
  const u2 = { x: up.x*cR - right.x*sR, y: up.y*cR - right.y*sR, z: up.z*cR - right.z*sR };
  return { fwd, right:r2, up:u2 };
}

/* velocity vector (world) */
function acVel(ac){
  const cG=Math.cos(ac.gamma), sG=Math.sin(ac.gamma);
  const cP=Math.cos(ac.psi),   sP=Math.sin(ac.psi);
  return { x: ac.tas*cG*sP, y: ac.tas*cG*cP, z: ac.tas*sG };
}

/* ===================================================================== */
/*  FLIGHT MODEL (arcade)                                                */
/* ===================================================================== */
const input = {
  pitch:0, roll:0, yaw:0, throttleUp:false, throttleDown:false,
};

/* Pitch sense: +1 => S pulls the nose UP (climb), W pushes it down.
   If pitch ever feels inverted on your setup, change this to -1. */
const PITCH_SIGN = 1;
/* Control smoothing time constant (seconds). Higher = softer / more delayed
   stick response (less twitchy). Lower = sharper. */
const CTRL_TAU = 0.24;
/* How hard a given bank angle turns the jet (arcade gain over true rate). */
const TURN_GAIN = 2.6;
/* smoothed stick state that lags toward `input` so controls aren't instant */
const ctrl = { pitch:0, roll:0, yaw:0 };

const FM = {
  Vr: 72,            // rotate speed m/s (~140 kt)
  maxThrust: 31,     // m/s^2 at full AB (arcade, stronger low-level acceleration)
  idleThrust: 1.5,
  dragK: 0.00032,    // (legacy, unused by aero model)
  vMax: 430,         // hard speed ceiling m/s
  rollRate: 3.35,    // rad/s — smoother low-level / gun tracking roll authority
  pitchRate: 0.95,   // rad/s (legacy)
  yawRate: 0.5,
};

/* --- simple-but-sensible aerodynamics (load-factor model) ---
   The wing can only pull so many g for a given speed: n_avail = N_K * V^2.
   Slow  -> n_avail < 1  -> can't even hold level flight -> you sink / stall.
   Fast  -> lots of g available -> tight, hard turns.
   Pulling g costs energy (induced drag), so sustained hard turns bleed speed. */
const AERO = {
  N_K:    3.05e-4,   // load-factor availability per V^2  (slightly stronger dogfight lift)
  NMAX:   10.2,      // structural g limit — strong but less twitchy pitch response
  CD0K:   1.96e-4,   // parasite drag accel = CD0K * V^2
  IND:    26200,     // induced drag accel = IND * n^2 / V^2
  STALL:  18*DEG,    // AoA at CLmax (display + buffet reference)
  ROT:    11*DEG,    // nose-up rotation AoA on the runway
};

function updateFlight(ac, dt){
  if (world.outcome) return;       // freeze on mission end

  // throttle
  if (input.throttleUp)   ac.throttle = clamp(ac.throttle + 0.45*dt, 0, 1);
  if (input.throttleDown) ac.throttle = clamp(ac.throttle - 0.55*dt, 0, 1);

  const groundElev = terrainH(ac.pos.x, ac.pos.y);
  // air thins with altitude: engine thrust and the wing's lift both fade, so the
  // jet has a service ceiling where it can no longer climb and starts to stall.
  const rho = clamp(1 - ac.pos.z/16000, 0.06, 1);

  /* ----- smooth the raw stick input so controls feel less twitchy ----- */
  const k = 1 - Math.exp(-dt/CTRL_TAU);
  ctrl.pitch += (input.pitch - ctrl.pitch) * k;
  ctrl.roll  += (input.roll  - ctrl.roll ) * k;
  ctrl.yaw   += (input.yaw   - ctrl.yaw  ) * k;
  const pitchCmd = PITCH_SIGN * ctrl.pitch;

  /* ----- roll (same for ground checks below) ----- */
  if (ac.onGround){
    ac.phi = lerp(ac.phi, 0, 1-Math.pow(0.001,dt));      // wings level on ground
  } else {
    ac.phi = clamp(ac.phi + ctrl.roll * FM.rollRate * dt, -125*DEG, 125*DEG);
    // Very light wing-leveler only near level flight.  Shallow/medium bank
    // angles should hold so the pilot is not fighting auto-roll during gun runs
    // or low-level route turns.
    if (Math.abs(ctrl.roll) < 0.025 && Math.abs(ac.phi) < 9*DEG)
      ac.phi = lerp(ac.phi, 0, 1-Math.pow(0.90,dt));
  }

  const thrust = lerp(FM.idleThrust, FM.maxThrust, ac.throttle) * rho;

  if (ac.onGround){
    /* ---- ground roll + rotation ---- */
    // pilot can raise the nose past ~60% Vr; lift must beat weight to fly
    const rotAlpha = (ac.tas > FM.Vr*0.6) ? clamp(pitchCmd,0,1)*AERO.ROT : 0;
    ac.alpha = lerp(ac.alpha, rotAlpha, 1-Math.pow(0.02,dt));
    ac.gamma = 0;
    ac.theta = ac.alpha;
    // available load factor at this speed, scaled by how much AoA we're pulling
    const nLift = AERO.N_K * ac.tas*ac.tas * (ac.alpha/AERO.STALL);
    // taxi steering
    ac.psi += ctrl.yaw * 0.5 * dt * clamp(1 - ac.tas/40, 0, 1);
    // speed: thrust vs rolling friction / aero drag / brakes
    let dv = thrust - 0.7 - AERO.CD0K*ac.tas*ac.tas;
    // parking / anti-creep brake: the jet holds still until you spool past idle
    const braking = (ac.throttle < 0.12) || (input.throttleDown && ac.throttle < 0.05);
    if (braking) dv -= 8.0;
    ac.tas = clamp(ac.tas + dv*dt, 0, FM.vMax);
    if (braking && ac.tas < 0.6) ac.tas = 0;                         // fully parked
    ac.pos.z = groundElev; ac.vy = 0;
    ac.g = 1; ac.aoa = ac.alpha*RAD; world._stall = false;
    if (nLift >= 1.0 && ac.tas > FM.Vr*0.9){                          // unstick
      ac.onGround = false;
      ac.pos.z = groundElev + 0.6;
      ac.gamma = 2*DEG;
      if (!world._takeoffOK){
        world._takeoffOK = true;
        if (window.recordMissionEvent) recordMissionEvent('takeoff', { tas:Math.round(ac.tas*KT), alt:Math.round(ac.pos.z*FT) });
        else if (window.ScoreTracker) ScoreTracker.recordTakeoff();
      }
    }
  } else {
    /* ---- airborne: load-factor aerodynamics ---- */
    const V  = Math.max(ac.tas, 12);
    const nAvail = clamp(AERO.N_K * V*V * rho, 0.05, AERO.NMAX);            // g the wing can make
    // commanded load factor from the smoothed stick.  A curved response makes
    // small gun-run / low-level corrections gentler while preserving full pull.
    const pitchEff = Math.sign(pitchCmd) * Math.pow(Math.abs(pitchCmd), 1.28);
    let nCmd = pitchEff >= 0 ? 1 + pitchEff*(AERO.NMAX-1) : 1 + pitchEff*2.2;
    // Low-level bank assist: when close to terrain and banked without a pitch
    // command, feed a little extra lift so ordinary turns do not dump altitude.
    const aglNow = Math.max(0, ac.pos.z-groundElev);
    const bankAssist = clamp((Math.abs(ac.phi)-8*DEG)/(58*DEG),0,1) *
                       clamp((720-aglNow)/620,0,1) *
                       clamp(1-Math.abs(pitchCmd)*1.35,0,1);
    nCmd += bankAssist*0.78;
    const n = clamp(nCmd, -1.5, nAvail);                             // wing can't exceed nAvail -> stall
    ac.g = n;
    const stalled = (nCmd > nAvail + 0.15);                          // demanding more than the wing can give
    // a genuine stall: either we're commanding more lift than the wing can make,
    // or the wing can't even sustain 1 g (too slow, or too high / thin air).
    // NB this is NOT just "low g" — a deliberate push-over to <1 g is fine.
    world._stall = stalled || (nAvail < 1.0);

    // angle of attack tracks the lift coefficient (display + camera)
    const aoaTarget = AERO.STALL * (n / Math.max(0.05,nAvail));
    ac.alpha = lerp(ac.alpha, aoaTarget, 1-Math.pow(0.02,dt));
    ac.aoa = ac.alpha*RAD;

    // flight-path angle: vertical part of lift vs gravity (lift tilts with bank)
    ac.gamma += (G0*(n*Math.cos(ac.phi) - Math.cos(ac.gamma)) / V) * dt;
    // below 1g stall speed the wing simply can't hold the nose up -> it drops
    if (nAvail < 1.0) ac.gamma -= (1.0 - nAvail) * 0.9 * dt;
    ac.gamma = clamp(ac.gamma, -85*DEG, 85*DEG);
    // heading: horizontal part of the (banked) lift turns the jet
    ac.psi  -= (G0 * n * Math.sin(ac.phi) / (V*Math.max(0.25,Math.cos(ac.gamma)))) * dt;
    // rudder nudge
    ac.psi  += ctrl.yaw * FM.yawRate * dt;
    // nose attitude = path + AoA (camera/HUD)
    ac.theta = clamp(ac.gamma + ac.alpha*Math.cos(ac.phi), -88*DEG, 88*DEG);

    // speed: thrust - drag - gravity-along-path. Induced drag (∝ n^2) bleeds energy.
    const drag = AERO.CD0K*V*V + AERO.IND*n*n/(V*V);
    let dv = (thrust - drag) - G0*Math.sin(ac.gamma);
    if (stalled) dv -= 2.0;                                          // extra drag in the stall
    ac.tas = clamp(ac.tas + dv*dt, 0, FM.vMax);
  }
  ac.psi = wrap2pi(ac.psi);

  /* ----- vertical position / ground contact ----- */
  const Vc = acVel(ac);
  if (!ac.onGround){
    ac.vy = Vc.z;
    ac.pos.z += ac.vy * dt;
    if (ac.pos.z <= groundElev + 0.5){                              // ground contact
      ac.pos.z = groundElev;
      const sink = Math.max(0, -ac.vy);
      // a valid landing needs a prepared pad (home runway or a FARP), gear down,
      // wings level and a gentle sink rate. Anything else — a slammed touchdown,
      // gear up, banked, or flying into terrain — wrecks the jet.
      const onHomeRwy = Math.abs(ac.pos.x - world.runway.x) < world.runway.w*1.5 &&
                        ac.pos.y > -world.runway.len/2 - 200 && ac.pos.y < world.runway.len/2 + 200;
      let onPad = onHomeRwy;
      if (!onPad) for (const s of world.airstrips){ if (Math.hypot(ac.pos.x-s.x, ac.pos.y-s.y) < 800){ onPad=true; break; } }
      const goodLanding = onPad && ac.gear && sink < 6 && Math.abs(ac.phi) < 12*DEG && ac.tas < 160;
      ac.onGround = true; ac.gamma = 0; ac.alpha = 0; ac.theta = 0;
      if (!goodLanding && !world.outcome){
        addEffect({x:ac.pos.x, y:ac.pos.y, z:groundElev+6}, 2.4, 'kill');
        flash(0.8);
        damage(ac, 1000, onPad ? 'CRASH ON LANDING' : 'TERRAIN IMPACT');   // fatal — lose the aircraft
      }
    }
  }

  /* ----- horizontal position ----- */
  ac.pos.x += Vc.x * dt;
  ac.pos.y += Vc.y * dt;
}


/* Terrain line-of-sight helper for visual occlusion and sensor displays.
   SAM gameplay no longer uses the low-altitude radar-horizon gate: if the
   aircraft enters a live SAM threat ring, the emitter can track and fire again.
   Terrain still occludes outside-window markers so overlays do not shine through
   solid mountains. */
function terrainLineClear(ax,ay,az,bx,by,bz, margin){
  margin = margin===undefined ? 70 : margin;
  const dx=bx-ax, dy=by-ay, dz=bz-az;
  const dist=Math.hypot(dx,dy);
  const steps=clamp(Math.ceil(dist/900), 7, 42);
  for(let i=1;i<steps;i++){
    const u=i/steps;
    const x=ax+dx*u, y=ay+dy*u, z=az+dz*u;
    if (terrainH(x,y)+margin > z) return false;
  }
  return true;
}

/* First terrain intersection along a sensor/weapon line.  Used by missile
   guidance so ridges act like solid masks rather than allowing weapons to
   guide through the mountain.  Returns null when the line is clear. */
function terrainLineBlockPoint(ax,ay,az,bx,by,bz, margin){
  margin = margin===undefined ? 35 : margin;
  const dx=bx-ax, dy=by-ay, dz=bz-az;
  const dist=Math.hypot(dx,dy);
  const steps=clamp(Math.ceil(dist/650), 10, 72);
  for(let i=1;i<steps;i++){
    const u=i/steps;
    const x=ax+dx*u, y=ay+dy*u, z=az+dz*u;
    const th=terrainH(x,y)+margin;
    if (th > z){
      return {x, y, z:terrainH(x,y)+2, u, terrainZ:terrainH(x,y)};
    }
  }
  return null;
}
function samRadarCanSee(th, pos){
  if (!th || !pos || !world || !world.ac) return false;
  const d = Math.hypot((pos.x||0)-th.x, (pos.y||0)-th.y);
  const agl = (pos.z||0) - terrainH(pos.x||0, pos.y||0);
  // Low-level ingress regains its tactical role: below ~400 m AGL, SAM radars
  // normally lose the aircraft to radar horizon / ground clutter until it is
  // dangerously close to the site.  Close-range burn-through/acquisition still
  // lets the launcher defend itself.
  const closeAcquire = Math.min(3200, Math.max(1800, (th.radius||7000)*0.22));
  if (agl < 400 && d > closeAcquire) return false;
  // At very low level, terrain ridges still matter even above the hard horizon
  // threshold.  This keeps valley masking useful without making SAMs inert.
  if (d > closeAcquire && !terrainLineClear(th.x, th.y, terrainH(th.x,th.y)+18, pos.x||0, pos.y||0, pos.z||0, 90)) return false;
  return true;
}
function fcrTerrainCanSee(pos){
  if (!pos || !world || !world.ac) return false;
  const ac=world.ac;
  const d=Math.hypot(pos.x-ac.pos.x,pos.y-ac.pos.y);
  if (d < 4500) return true;
  // AIR SUPER still lets terrain make radar pictures less perfect, but there is
  // no global AGL cutoff.  Contacts appear when the line of sight opens.
  if ((world.difficulty||0)>=4){
    if (!terrainLineClear(ac.pos.x,ac.pos.y,ac.pos.z,pos.x,pos.y,pos.z,90)) return false;
  }
  return true;
}

function damage(ac, amt, why){
  if (world.outcome) return;
  ac.integrity = clamp(ac.integrity - amt, 0, 100);
  flash(0.6);
  world._cautionUntil = world.t + 2.2;
  if (window.F16Audio) F16Audio.event('newguy');
  if (window.ScoreTracker) ScoreTracker.damage(amt, why || '');
  if (why) banner(why, 1.5);
  if (ac.integrity <= 0){
    ac.integrity = 0;
    missionEnd('LOSS', why || 'AIRCRAFT DESTROYED');
  }
}

/* transient banner + screen flash hooks (defined in render layer) */
let _flash = 0;
function flash(v){ _flash = Math.max(_flash, v); }
function banner(txt, dur=2.2){ world.message = txt; world.messageT = dur; }

function missionEnd(kind, txt){
  if (world.outcome) return;
  const gen = world._missionGen || 0;
  world.outcome = kind;
  world.outcomeReason = txt || kind;
  if (window.ReplayRecorder) ReplayRecorder.recordEvent('mission_end', { outcome:kind, reason:txt||kind, missionGen:gen });
  banner(txt || kind, 99);
  if (window.F16Audio) F16Audio.event(kind==='WIN'?'win':'loss');
  if (window.GameFlow && GameFlow.onMissionEnd) setTimeout(function(){
    if ((world._missionGen || 0) === gen && world.outcome === kind) GameFlow.onMissionEnd(kind, txt || kind);
  }, 650);
  else if (window.MenuUI && MenuUI.showDebrief) setTimeout(function(){
    if ((world._missionGen || 0) === gen && world.outcome === kind) MenuUI.showDebrief();
  }, 650);
}

