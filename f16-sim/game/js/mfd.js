/* =====================================================================
   MFD  —  multifunction displays, live-wired to the world
   ===================================================================== */
const C_GREEN='#27ff5e', C_DIM='rgba(39,255,94,0.45)', C_HOT='#a8ffc0',
      C_RED='#ff5b5b', C_YEL='#ffd24d', C_ORG='#ff9a4d';

let F16IMG = new Image();
let F16IMG_OK = false;
F16IMG.onload = ()=>{ F16IMG_OK = true; };
F16IMG.src = (typeof F16_SILHOUETTE_SRC!=='undefined') ? F16_SILHOUETTE_SRC : '';

class MFD {
  constructor(id, frameEl, page){
    this.id=id; this.frame=frameEl;
    this.canvas=frameEl.querySelector('canvas');
    this.ctx=this.canvas.getContext('2d');
    this.W=this.canvas.width; this.H=this.canvas.height;
    this.page=page; this.range=20; this.azScan=60;
    this.sweep=-60; this.sweepDir=1; this.sweepSpeed=80;
    this.locked=null;
    this.fcrMode='RWS';      // RWS (air-to-air) | SAR (ground map)
    this.tgpFov='WIDE';      // WIDE | NARO
    this.tgpZoom=2;          // 1..4 zoom stage (drives FOV)
    this.tgpTrack='AREA';    // AREA | POINT
    this.tgpPol='WHOT';      // WHOT (white-hot) | BHOT (black-hot)
    this.lantRange=10;       // LANTIRN forward-look depth (NM)
    this.lantFov='WIDE';     // WIDE | NAR, low-level navigation camera
    this.laser=false;        // TGP laser armed
    this.osbEls={};
    frameEl.querySelectorAll('.osb').forEach(b=>{
      this.osbEls[b.dataset.osb]=b;
      b.addEventListener('click',e=>{
        e.stopPropagation();
        if (window.GameFlow && !GameFlow.isActiveMission()) return;
        this.osb(b.dataset.osb); world.activeMfdId=this.id; setActive();
        if (window.ReplayRecorder) ReplayRecorder.recordCockpitAction('mfd_osb', { mfd:this.id, osb:b.dataset.osb, page:this.page });
      });
    });
    this.canvas.addEventListener('click', e=>{
      if (window.GameFlow && !GameFlow.isActiveMission()) return;
      world.activeMfdId=this.id; setActive();
      const r=this.canvas.getBoundingClientRect();
      const x=(e.clientX-r.left)*(this.W/r.width), y=(e.clientY-r.top)*(this.H/r.height);
      if (this.page==='FCR') this.tryLock(x,y);
      else if (this.page==='THR') this.thrTap(x,y);
      else if (this.page==='ECM') this.ecmTap(x,y);
      else if (this.page==='DED' && DED_PAGE==='TUNE') this.dedTap(x,y);
      if (window.ReplayRecorder) ReplayRecorder.recordCockpitAction('mfd_screen', { mfd:this.id, page:this.page, x:Math.round(x), y:Math.round(y) });
    });
    this.refresh();
  }
  setPage(p){
    this.page=p;
    const anyLant = (typeof MFDS!=='undefined') ? Object.keys(MFDS).some(k=>MFDS[k] && (k===this.id ? p : MFDS[k].page)==='LANT') : (p==='LANT');
    world.lantirnOn = anyLant; world.lantirnMode = anyLant ? 'FLIR' : 'OFF';
    if (window.ReplayRecorder) ReplayRecorder.recordEvent('mfd_page', { mfd:this.id, page:p });
    this.refresh();
  }
  setRange(r){ this.range=r; this.refresh(); }

  osb(k){
    const pg={T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED'};
    if (pg[k]){ this.setPage(pg[k]); return; }
    if (this.page==='FCR'){
      const rm={L1:10,L2:20,L3:40,L4:80};
      if (rm[k]){ this.setRange(rm[k]); return; }
      if (k==='B1'){ const o=['RWS','SAR','HAD']; this.fcrMode=o[(o.indexOf(this.fcrMode)+1)%o.length]; this.locked=null; this.refresh(); return; }
    }
    if (this.page==='HSD'){
      const rm={L1:10,L2:20,L3:40,L4:80};
      if (rm[k]){ this.setRange(rm[k]); return; }
      if (k==='B3'){ this.setPage('LANT'); return; }
      if (k==='B4'){ this.setPage('ECM'); return; }
      if (k==='B5'){ if(this.range<20) this.range=40; this.setPage('THR'); return; }
    }
    if (this.page==='ECM'){
      if (k==='B1'){ world.ecm.on=!world.ecm.on; banner('ECM '+(world.ecm.on?'ACTIVE':'OFF'),1.1); this.refresh(); refreshAllMfd(); return; }
      if (k==='B2'){ ecmClear(); banner('JAM SLOTS CLEARED',1.1); this.refresh(); refreshAllMfd(); return; }
      if (k==='L1'){ ecmMoveCursor(-3); this.refresh(); return; }
      if (k==='L2'){ ecmMoveCursor(+3); this.refresh(); return; }
      if (k==='L3'){ const r=ecmSelectCursor(); banner(r==='FULL'?'JAM SLOTS FULL':r==='NONE'?'NO PEAK NEAR CURSOR':r==='CLEARED'?'SLOT CLEARED':'FREQ LOCKED',1.1); this.refresh(); refreshAllMfd(); return; }
      if (k==='R1'){ const n=ecmAuto(); banner('AUTO-JAM \u2014 '+n+'/'+JAM_SLOTS+' SLOTS',1.2); this.refresh(); refreshAllMfd(); return; }
      return;
    }
    if (this.page==='THR'){
      const rm={L1:20,L2:40,L3:80,L4:160};
      if (rm[k]){ this.setRange(rm[k]); return; }
      if (k==='B1'){ this.setPage('HSD'); return; }
    }
    if (this.page==='LANT'){
      const rm={L1:2,L2:5,L3:10,L4:20};
      if (rm[k]){ this.lantRange=rm[k]; this.refresh(); return; }
      if (k==='B1'){ this.setPage('HSD'); return; }
      if (k==='R1'){ this.lantFov=this.lantFov==='WIDE'?'NAR':'WIDE'; this.refresh(); return; }
    }
    if (this.page==='SMS'){
      const sm={L1:1,L2:2,L3:3,L4:4,R1:5,R2:6,R3:7};
      if (sm[k]!==undefined){ selectStation(sm[k]); return; }
      if (k==='B1'){ cycleArm(); return; }
      if (k==='B2'){ cycleMode(); return; }
    }
    if (this.page==='TGP'){
      const zm={L1:1,L2:2,L3:3,L4:4};
      if (zm[k]){ this.tgpZoom=zm[k]; this.tgpFov=zm[k]<=2?'WIDE':'NARO'; this.refresh(); return; }
      if (k==='B1'){ world.designated=!world.designated; banner(world.designated?'TGT DESIGNATED':'TGP STBY',1); this.refresh(); return; }
      if (k==='R1'){ this.tgpFov = this.tgpFov==='WIDE'?'NARO':'WIDE'; this.tgpZoom = this.tgpFov==='NARO'?4:1; this.refresh(); return; }
      if (k==='R2'){ this.tgpTrack = this.tgpTrack==='AREA'?'POINT':'AREA'; this.refresh(); return; }
      if (k==='R3'){ this.laser = !this.laser; world.tgpLaser = this.laser; this.refresh(); return; }
      if (k==='R4'){ this.tgpPol = this.tgpPol==='WHOT'?'BHOT':'WHOT'; this.refresh(); return; }
    }
    if (this.page==='DED'){
      if (k==='B1'){ DED_PAGE='CNI'; this.refresh(); return; }
      if (k==='B2'){ DED_PAGE='STPT'; this.refresh(); return; }
      if (k==='B3'){ DED_PAGE='BIT'; this.refresh(); return; }
      if (k==='B4'){ DED_PAGE='TUNE'; this.refresh(); return; }
      if (k==='B5'){ this.setPage('DLNK'); return; }
      if (k==='R1'){ world.steerpoint=(world.steerpoint%world.waypoints.length)+1; banner('STPT '+world.steerpoint,1); refreshAllMfd(); return; }
      if (k==='L1'){ world.steerpoint=((world.steerpoint-2+world.waypoints.length)%world.waypoints.length)+1; banner('STPT '+world.steerpoint,1); refreshAllMfd(); return; }
      if (k==='R3'){ cycleMode(); return; }
    }
    if (this.page==='DLNK'){
      const rm={L1:20,L2:40,L3:80,L4:160};
      if (rm[k]){ this.dlRange=rm[k]; this.refresh(); return; }
      if (k==='B1'){ this.setPage('DED'); DED_PAGE='TUNE'; this.refresh(); return; }
    }
    this.refresh();
  }
  tryLock(x,y){
    if (this.fcrMode==='HAD'){                       // designate a radar emitter for HARM + slew the TGP onto it
      let best=22, sel=null;
      for (const t of world.threats){ if(!t.live) continue;
        const p=hadPlot(this,t); const d=Math.hypot(p.px-x,p.py-y);
        if (d<best){ best=d; sel=t; } }
      if (sel){
        const on = (world.harmLock!==sel);
        world.harmLock = on ? sel : null;
        if (on){ world.gndLock = sel; world.designated = true; }              // point the pod at the emitter too
        else if (world.gndLock===sel){ world.gndLock = null; world.designated = !!world.airLock; }
        banner(on?('HARM LOCK \u2014 '+sel.name+'  (TGP SLEW)'):'HARM LOCK CLEARED',1.4);
      }
      this.refresh(); refreshAllMfd(); return;
    }
    if (this.fcrMode==='SAR'){                       // designate a SAR/GMT contact for the TGP
      const hits=this._sarHits||[]; let best=18, sel=null;
      for (const h of hits){ const d=Math.hypot(h.sx-x,h.sy-y); if(d<best){best=d; sel=h;} }
      if (sel){
        world.gndLock=(world.gndLock===sel.obj)?null:sel.obj;
        world.designated=!!world.gndLock;
        banner(world.gndLock?('GND DESIG \u2014 '+(sel.name||'TARGET')):'DESIG CLEARED',1.2);
      }
      this.refresh(); refreshAllMfd(); return;
    }
    let best=18, selc=null;
    for (const c of fcrContacts(this)){
      const d=Math.hypot(c.sx-x,c.sy-y);
      if (d<best){ best=d; selc=c; }
    }
    if (!selc) return;
    const sel=selc.bd;
    this.locked = (this.locked===sel)?null:sel;
    if (this.locked){
      if (selc.dom==='GND'){ world.gndLock=sel; world.designated=true;
        banner('GND LOCK \u2014 '+(selc.name||'TARGET'),1.2); }
      else { world.airLock=sel; banner('AIR LOCK \u2014 '+(selc.name||'BANDIT'),1.0); }
    } else {
      if (selc.dom==='GND'){ world.gndLock=null; } else { world.airLock=null; }
    }
    refreshAllMfd();
  }
  thrTap(x,y){                      // THREAT page: tap a launch point / emitter to designate + slew the pod
    const hits=this._thrHits||[]; let best=22, sel=null;
    for (const h of hits){ const d=Math.hypot(h.sx-x,h.sy-y); if(d<best){best=d; sel=h;} }
    if (sel && sel.obj && sel.obj.x!==undefined){
      const o=sel.obj;
      world.gndLock = (world.gndLock===o)?null:o; world.designated=!!world.gndLock;
      if (world.gndLock && o.live){ world.harmLock=o; }
      else if (!world.gndLock && world.harmLock===o){ world.harmLock=null; }
      banner(world.gndLock?('DESIG \u2014 '+(sel.name||'THREAT')+'  (TGP SLEW)'):'DESIG CLEARED',1.3);
      this.refresh(); refreshAllMfd();
    }
  }
  ecmTap(x,y){                      // ECM spectrum: peak = jam, slot = clear, empty graph = move cursor
    for (const c of (this._ecmSlots||[])){ if (c.freq!=null && x>=c.x && x<=c.x+c.w && y>=c.y && y<=c.y+c.h){
      ecmLockFreq(c.freq); banner('SLOT CLEARED \u2014 '+c.freq.toFixed(1),1.0); this.refresh(); refreshAllMfd(); return; } }
    const sp=this._ecmSpec; if(!sp) return;
    if (y>=sp.yTop-6 && y<=sp.yBase+14){
      let best=null, bd=16;
      for (const pk of (sp.peaks||[])){ const dx=Math.abs(pk.sx-x); if (dx<bd){ bd=dx; best=pk; } }
      if (best){ const res=ecmLockFreq(best.f);
        banner(res==='FULL'?'JAM SLOTS FULL':res==='CLEARED'?('SLOT CLEARED \u2014 '+best.f.toFixed(1)):('JAMMING '+best.f.toFixed(1)+' \u2014 '+(best.th.name||'')),1.2);
        this.refresh(); refreshAllMfd(); return; }
      const f=clamp(((x-sp.x0)/Math.max(1,sp.x1-sp.x0))*100,0,100); world.ecm.cursor=Math.round(f*2)/2;
      this.refresh(); return;
    }
  }
  dedTap(x,y){                      // DED touch keypad (datalink-frequency entry)
    const keys=this._dedKeys||[];
    for (const k of keys){ if (x>=k.x && x<=k.x+k.w && y>=k.y && y<=k.y+k.h){ k.act(); break; } }
    if (window.F16Audio) F16Audio.event('select');
    this.refresh(); this.render();
  }
  refresh(){
    const L=OSB[this.page]||{};
    for (const k in this.osbEls){
      let v=L[k]||''; if (typeof v==='function') v=v(this);
      const el=this.osbEls[k];
      const enabled = !!v;
      el.textContent = v;
      el.disabled = !enabled;                       // physical button stays, just inert
      el.classList.toggle('disabled', !enabled);    // dimmed when not used on this page
      el.classList.toggle('active', enabled && this.osbActive(k));
    }
  }
  osbActive(k){
    const pg={T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED'};
    if (pg[k]) return this.page===pg[k];
    if (this.page==='FCR'){
      const rm={L1:10,L2:20,L3:40,L4:80}; if (rm[k]) return this.range===rm[k];
      if (k==='B1') return this.fcrMode!=='RWS';
    }
    if (this.page==='HSD'){
      const rm={L1:10,L2:20,L3:40,L4:80}; if (rm[k]) return this.range===rm[k];
      if (k==='B3') return false;
    }
    if (this.page==='THR'){
      const rm={L1:20,L2:40,L3:80,L4:160}; if (rm[k]) return this.range===rm[k];
    }
    if (this.page==='ECM'){
      if (k==='B1') return world.ecm.on;
    }
    if (this.page==='LANT'){
      const rm={L1:2,L2:5,L3:10,L4:20}; if (rm[k]) return (this.lantRange||10)===rm[k];
      if (k==='R1') return this.lantFov==='NAR';
    }
    if (this.page==='DLNK'){
      const rm={L1:20,L2:40,L3:80,L4:160}; if (rm[k]) return (this.dlRange||80)===rm[k];
    }
    if (this.page==='SMS'){
      const sm={L1:1,L2:2,L3:3,L4:4,R1:5,R2:6,R3:7};
      if (sm[k]!==undefined) return world.selectedStation===sm[k];
    }
    if (this.page==='TGP'){
      const zm={L1:1,L2:2,L3:3,L4:4}; if (zm[k]) return (this.tgpZoom||2)===zm[k];
      if (k==='B1') return world.designated;
      if (k==='R1') return this.tgpFov==='NARO';
      if (k==='R2') return this.tgpTrack==='POINT';
      if (k==='R3') return this.laser;
      if (k==='R4') return this.tgpPol==='BHOT';
    }
    if (this.page==='DED'){
      if (k==='B1') return DED_PAGE==='CNI';
      if (k==='B2') return DED_PAGE==='STPT';
      if (k==='B3') return DED_PAGE==='BIT';
      if (k==='B4') return DED_PAGE==='TUNE';
    }
    return false;
  }
  update(dt){
    if (this.page==='FCR' && this.fcrMode==='RWS'){
      this.sweep += this.sweepDir*this.sweepSpeed*dt;
      if (this.sweep>=this.azScan){this.sweep=this.azScan;this.sweepDir=-1;}
      if (this.sweep<=-this.azScan){this.sweep=-this.azScan;this.sweepDir=1;}
      for (const c of fcrContacts(this)){
        if (Math.abs(c.az - this.sweep) < this.sweepSpeed*dt*1.6) c.bd._det=world.t;
      }
    }
  }
  render(){
    const ctx=this.ctx;
    ctx.fillStyle='#01160a'; ctx.fillRect(0,0,this.W,this.H);
    (PAGES[this.page]||PAGES.DED).render(this,ctx);
    footer(this,ctx);
  }
}

/* ---------- OSB label tables (label present == button enabled on page) --- */
const OSB={
  FCR:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'10',L2:'20',L3:'40',L4:'80', B1:m=>m.fcrMode},
  HSD:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'10',L2:'20',L3:'40',L4:'80', B3:'LANT', B4:'ECM', B5:'THR'},
  LANT:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'2',L2:'5',L3:'10',L4:'20', B1:'HSD', R1:m=>m.lantFov},
  THR:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'20',L2:'40',L3:'80',L4:'160', B1:'HSD'},
  ECM:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       B1:m=>world.ecm.on?'ECM ON':'ECM OFF', B2:'CLR', L1:'\u25c4', L2:'\u25ba', L3:'SEL', R1:'AUTO'},
  SMS:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'9X',L2:'120',L3:'AGM',L4:'AGM',R1:'82',R2:'82',R3:'HARM',
       B1:m=>'ARM:'+world.masterArm, B2:m=>world.masterMode },
  TGP:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'Z1',L2:'Z2',L3:'Z3',L4:'Z4',
       B1:m=>world.designated?'DESIG':'STBY', R1:m=>m.tgpFov, R2:m=>m.tgpTrack, R3:m=>m.laser?'LZR\u25cf':'LZR', R4:m=>m.tgpPol},
  DED:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED',
       L1:'\u25bc', R1:'\u25b2', R3:m=>world.masterMode, B1:'CNI', B2:'STPT', B3:'BIT', B4:'TUNE', B5:'DLNK'},
  DLNK:{T1:'FCR',T2:'HSD',T3:'SMS',T4:'TGP',T5:'DED', L1:'20',L2:'40',L3:'80',L4:'160', B1:'TUNE'},
};

/* ---------- common footer ---------- */
function footer(m,ctx){
  ctx.fillStyle=C_GREEN; ctx.font='9px "Courier New"'; ctx.textAlign='left';
  ctx.fillText(world.masterMode, 6, m.H-6);
  ctx.textAlign='center';
  ctx.fillText('FL'+String(Math.round(world.ac.pos.z*FT/100)).padStart(3,'0'), m.W/2, m.H-6);
  ctx.textAlign='right';
  ctx.fillText(String(Math.round(world.ac.tas*KT))+'KT', m.W-6, m.H-6);
}

/* ---------- FCR contacts (live, track-up B-scope) ---------- */
function fcrAirMode(){ const m=world.masterMode; return m==='A-A'||m==='DGFT'||m==='NAV'; }
function fcrContacts(m){
  const out=[]; const ac=world.ac;
  const PADx=34, PADt=34, PADb=40;
  const FW=m.W-2*PADx, FH=m.H-PADt-PADb;
  const add=(ent,x,y,z,dom,sym,name,hostile)=>{
    if (dom==='AIR' && typeof fcrTerrainCanSee==='function' && !fcrTerrainCanSee({x,y,z})) return;
    const rel = vsub({x,y,z}, ac.pos);
    const brg = wrap2pi(Math.atan2(rel.x,rel.y));
    let az = angWrap(brg - ac.psi)*RAD;
    const rng = vlen(rel)/NM;
    if (Math.abs(az)>m.azScan || rng>m.range) return;
    const sx = PADx + ((az+m.azScan)/(2*m.azScan))*FW;
    const sy = PADt + FH - (rng/m.range)*FH;
    out.push({bd:ent, dom, sym, name, hostile, az, rng, sx, sy});
  };
  if (fcrAirMode()){                                   // A-A : air tracks only
    for (const bd of world.bandits){ if (bd.hp<=0) continue;
      add(bd, bd.x, bd.y, bd.alt, 'AIR', 'chev', bd.kind||'AIR', bd.kind==='HOSTILE'); }
  } else {                                             // A-G : ground targets only
    for (const v of world.hvts){ if (v.destroyed) continue;
      add(v, v.x, v.y, terrainH(v.x,v.y), 'GND', 'dia', v.name||'HVT', true); }
    for (const gm of world.groundMovers){ if (gm.destroyed) continue;
      add(gm, gm.x, gm.y, terrainH(gm.x,gm.y), 'GND', 'sq', gm.name||'GND', true); }
    if (!world.target.destroyed)
      add(world.target, world.target.x, world.target.y, terrainH(world.target.x,world.target.y),
          'GND', 'star', 'TARGET', true);
  }
  return out;
}

/* draw an FCR track symbol centred at (x,y) */
function fcrSym(ctx,x,y,sym){
  ctx.beginPath();
  if (sym==='chev'){ ctx.moveTo(x-5,y+4); ctx.lineTo(x,y-5); ctx.lineTo(x+5,y+4); ctx.stroke(); }
  else if (sym==='sq'){ ctx.strokeRect(x-4,y-4,8,8); }
  else if (sym==='dia'){ ctx.moveTo(x,y-6); ctx.lineTo(x+6,y); ctx.lineTo(x,y+6); ctx.lineTo(x-6,y); ctx.closePath(); ctx.stroke(); }
  else if (sym==='star'){ for(let i=0;i<5;i++){ const a=-Math.PI/2+i*4*Math.PI/5; const px=x+Math.cos(a)*7,py=y+Math.sin(a)*7; i?ctx.lineTo(px,py):ctx.moveTo(px,py);} ctx.closePath(); ctx.stroke(); }
  else { ctx.fillRect(x-3,y-3,6,6); }
}

/* screen plot of an emitter on the HAD scope (shared by render + click-lock) */
function hadPlot(m,t){
  const ac=world.ac, W=m.W, H=m.H;
  const cx=W/2, cy=H/2+10, R=Math.min(W,H)/2-30;
  const rel=vsub({x:t.x,y:t.y,z:0}, ac.pos);
  const relAz=angWrap(wrap2pi(Math.atan2(rel.x,rel.y))-ac.psi);
  const dist=Math.hypot(rel.x,rel.y);
  const rr=clamp(dist/((m.range||40)*NM),0,1);
  return { px:cx+Math.sin(relAz)*R*rr, py:cy-Math.cos(relAz)*R*rr, cx, cy, R };
}

const PAGES={};
PAGES.FCR={
  render(m,ctx){
    if (m.fcrMode==='SAR'){ this.renderSAR(m,ctx); return; }
    if (m.fcrMode==='HAD'){ this.renderHAD(m,ctx); return; }
    const air=fcrAirMode();
    const ac=world.ac; const W=m.W,H=m.H;
    const PADx=34,PADt=34,PADb=40, FW=W-2*PADx, FH=H-PADt-PADb;
    // frame
    ctx.strokeStyle=C_GREEN; ctx.lineWidth=1; ctx.strokeRect(PADx,PADt,FW,FH);
    // range ticks
    ctx.fillStyle=C_GREEN; ctx.font='9px "Courier New"'; ctx.textAlign='right';
    for (let i=1;i<=4;i++){ const y=PADt+FH-(i/4)*FH;
      ctx.beginPath(); ctx.moveTo(PADx-4,y); ctx.lineTo(PADx,y); ctx.stroke();
      if(i%2===0) ctx.fillText((m.range*i/4|0),PADx-6,y+3); }
    // az center + ticks
    ctx.strokeStyle=C_DIM; ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.moveTo(PADx,PADt+FH/2); ctx.lineTo(PADx+FW,PADt+FH/2); ctx.stroke(); ctx.setLineDash([]);
    // sweep
    const sx=PADx+((m.sweep+m.azScan)/(2*m.azScan))*FW;
    const gr=ctx.createLinearGradient(sx-m.sweepDir*36,0,sx,0);
    gr.addColorStop(0,'rgba(39,255,94,0)'); gr.addColorStop(1,'rgba(39,255,94,0.18)');
    ctx.fillStyle=gr; ctx.fillRect(m.sweepDir>0?sx-36:sx,PADt,36,FH);
    ctx.strokeStyle='rgba(168,255,192,0.9)'; ctx.beginPath(); ctx.moveTo(sx,PADt); ctx.lineTo(sx,PADt+FH); ctx.stroke();
    // contacts (domain-filtered)
    for (const c of fcrContacts(m)){
      const fresh = c.dom!=='AIR' || (world.t - (c.bd._det||-99) < 2.2);
      const isLock = m.locked===c.bd;
      if (!fresh && !isLock) continue;
      const col = c.dom==='AIR' ? (c.hostile?C_RED:C_YEL)
                                : (c.sym==='star'?C_HOT : c.sym==='dia'?C_RED : C_ORG);
      ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=isLock?2:1.3;
      fcrSym(ctx,c.sx,c.sy,c.sym);
      if (isLock){
        ctx.strokeStyle=C_HOT; ctx.lineWidth=1.4; ctx.strokeRect(c.sx-8,c.sy-8,16,16);
        ctx.beginPath(); ctx.moveTo(c.sx,PADt); ctx.lineTo(c.sx,c.sy-8); ctx.stroke();
        ctx.fillStyle=C_HOT; ctx.font='8px "Courier New"'; ctx.textAlign='left';
        if (c.dom==='AIR') ctx.fillText(Math.round(c.bd.alt*FT/100)*100+'', c.sx+9, c.sy-2);
        ctx.fillText(Math.round(c.rng)+'NM', c.sx+9, c.sy+8);
      }
    }
    // header
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText(air?'FCR A-A':'FCR A-G', 6, 14);
    if (air && (world.difficulty||0)>=4){ ctx.fillStyle=C_YEL; ctx.textAlign='right'; ctx.fillText('TERRAIN MASK', W-6, 14); ctx.textAlign='left'; ctx.fillStyle=C_GREEN; }
    ctx.textAlign='right'; ctx.fillText('A'+m.range, W-6, 14);
    ctx.textAlign='center'; ctx.font='9px "Courier New"';
    ctx.fillText('±'+m.azScan+'°  '+(m.locked?(air?'STT':'GND TRK'):'SCAN'), W/2, PADt-6);
  },

  /* HAD : HARM Attack Display — radar emitters, jammers, HARM targeting */
  renderHAD(m,ctx){
    const ac=world.ac, W=m.W, H=m.H;
    const cx=W/2, cy=H/2+10, R=Math.min(W,H)/2-30;
    // range rings
    ctx.strokeStyle=C_DIM; ctx.lineWidth=1;
    for (let i=1;i<=3;i++){ ctx.beginPath(); ctx.arc(cx,cy,R*i/3,0,2*Math.PI); ctx.stroke(); }
    ctx.fillStyle=C_DIM; ctx.font='8px "Courier New"'; ctx.textAlign='left';
    const _r=m.range||40, r1=Math.round(_r/3), r2=Math.round(2*_r/3);
    ctx.fillText(''+r1, cx+2, cy-R/3+9); ctx.fillText(''+r2, cx+2, cy-2*R/3+9); ctx.fillText(''+_r, cx+2, cy-R+9);
    // nose line + ownship
    ctx.strokeStyle=C_DIM; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy-R); ctx.stroke();
    ctx.fillStyle=C_GREEN; ctx.beginPath(); ctx.moveTo(cx,cy-6); ctx.lineTo(cx-4,cy+5); ctx.lineTo(cx+4,cy+5); ctx.closePath(); ctx.fill();
    // emitters
    let anyLive=false;
    for (const t of world.threats){
      if (!t.live) continue; anyLive=true;
      const p=hadPlot(m,t);
      const desig=(world.harmLock===t);
      const col = t.tracking?C_RED:(t.color||C_ORG);
      ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=desig?2:1.3;
      // emitter glyph: half-circle 'radar' over a base + threat spike
      ctx.beginPath(); ctx.arc(p.px,p.py,desig?7:5,Math.PI,2*Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.px-5,p.py); ctx.lineTo(p.px+5,p.py); ctx.stroke();
      ctx.font='8px "Courier New"'; ctx.textAlign='center';
      ctx.fillText(t.name, p.px, p.py+15);
      if (t.tracking){ ctx.fillStyle=C_RED; ctx.fillText('TRK', p.px, p.py-9); }
      if (t.jammer){ ctx.fillStyle=C_YEL; ctx.fillText('JAM', p.px, p.py-(t.tracking?19:9)); }
      if (desig){ ctx.strokeStyle=C_HOT; ctx.lineWidth=1.4; ctx.strokeRect(p.px-10,p.py-10,20,20); }
    }
    if (!anyLive){ ctx.fillStyle=C_DIM; ctx.font='11px "Courier New"'; ctx.textAlign='center';
      ctx.fillText('NO EMITTERS', cx, cy-4); ctx.fillText('(threats destroyed)', cx, cy+12); }
    // header + HARM status
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('HAD  EW/HARM  R'+(m.range||40), 6, 14);
    const harm=world.stations.find(s=>s.kind==='harm');
    ctx.textAlign='right'; ctx.fillStyle=harm&&harm.qty>0?C_GREEN:C_DIM;
    ctx.fillText('HARM '+(harm?harm.qty:0), W-6, 14);
    ctx.textAlign='center'; ctx.font='9px "Courier New"'; ctx.fillStyle=C_HOT;
    if (world.harmLock && world.harmLock.live){
      ctx.fillText('LOCK '+world.harmLock.name+'  \u2014 SPACE=MAGNUM', W/2, H-12);
    }
  },

  /* SAR : synthetic-aperture ground map patch around the aircraft */
  renderSAR(m,ctx){
    // Track-up SAR/GMT tactical geography display.  The aircraft is now the
    // fixed reference point near the bottom of the display, so terrain/contacts
    // scroll down and rotate around ownship like HSD/HAD as you move.  This
    // keeps the synthetic aperture style while making the page useful for
    // low-level route judgement and target designation.
    const ac=world.ac, W=m.W, H=m.H, PADx=18, PADt=30, PADb=38;
    const FW=W-2*PADx, FH=H-PADt-PADb;
    const ownX=PADx+FW/2, ownY=PADt+FH*0.80;
    const rangeNM=m.range||20;
    const maxF=Math.max(4*NM, rangeNM*NM);
    const maxBack=Math.max(1.4*NM, maxF*0.16);
    const side=maxF*0.54;
    const scaleY=(ownY-PADt)/maxF;
    const scaleX=(FW*0.46)/side;
    const sn=Math.sin(ac.psi||0), cs=Math.cos(ac.psi||0);
    const pk=(typeof TERRAIN_PEAK!=='undefined'?TERRAIN_PEAK:1850);
    const sx0=PADx, sy0=PADt, sx1=PADx+FW, sy1=PADt+FH;

    const radarGreen=(level,alpha)=>{
      const v=clamp(level,0,1);
      const r=Math.round(8+92*v), g=Math.round(38+205*v), b=Math.round(18+92*v);
      return 'rgba('+r+','+g+','+b+','+((alpha==null)?1:alpha).toFixed(3)+')';
    };
    const worldAt=(sx,sy)=>{
      const right=(sx-ownX)/scaleX;
      const fwd=(ownY-sy)/scaleY;
      return {x:ac.pos.x+sn*fwd+cs*right, y:ac.pos.y+cs*fwd-sn*right, fwd, right};
    };
    const plot=(wx,wy)=>{
      const dx=wx-ac.pos.x, dy=wy-ac.pos.y;
      const fwd=dx*sn+dy*cs, right=dx*cs-dy*sn;
      return { sx:ownX+right*scaleX, sy:ownY-fwd*scaleY, fwd, right, d:Math.hypot(dx,dy)/NM };
    };
    const inF=p=> p.sx>=sx0&&p.sx<=sx1&&p.sy>=sy0&&p.sy<=sy1&&p.fwd>=-maxBack&&p.fwd<=maxF;
    const drawPoly=(pts,stroke,width,closed)=>{
      if(!pts||pts.length<2) return;
      ctx.strokeStyle=stroke; ctx.lineWidth=width||1; ctx.beginPath(); let started=false;
      for(const pt of pts){ const p=plot(pt.x,pt.y); if(!inF(p)){ started=false; continue; }
        if(!started){ ctx.moveTo(p.sx,p.sy); started=true; } else ctx.lineTo(p.sx,p.sy); }
      if(closed&&started) ctx.closePath(); ctx.stroke();
    };

    ctx.fillStyle='#001007'; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.beginPath(); ctx.rect(sx0,sy0,FW,FH); ctx.clip();
    ctx.fillStyle='rgba(0,20,8,0.92)'; ctx.fillRect(sx0,sy0,FW,FH);

    // Range grid is anchored on ownship, giving a clear reference frame.
    ctx.strokeStyle='rgba(80,255,130,0.17)'; ctx.lineWidth=1;
    for(let rn=0.25; rn<=1.0; rn+=0.25){
      const y=ownY-(maxF*rn)*scaleY;
      ctx.beginPath(); ctx.moveTo(sx0,y); ctx.lineTo(sx1,y); ctx.stroke();
      ctx.fillStyle='rgba(130,255,160,0.32)'; ctx.font='7px "Courier New"'; ctx.textAlign='right';
      ctx.fillText(Math.round(rangeNM*rn)+'', sx1-4, y-2);
    }
    for(let s=-0.5; s<=0.5; s+=0.25){
      const x=ownX+s*FW*0.92; ctx.beginPath(); ctx.moveTo(x,sy0); ctx.lineTo(x,sy1); ctx.stroke();
    }
    ctx.strokeStyle='rgba(140,255,170,0.24)'; ctx.beginPath(); ctx.moveTo(ownX,sy0); ctx.lineTo(ownX,sy1); ctx.stroke();

    // Per-cell SAR return: local elevation + slope + forward aspect. This gives
    // visible geography instead of the older confusing patch frame.
    const NX=58, NY=48, cw=FW/NX, ch=FH/NY;
    const sweep=(world.t*0.44)%1, sweepY=sy0+sweep*FH;
    for(let j=0;j<NY;j++) for(let i=0;i<NX;i++){
      const sx=sx0+(i+0.5)*cw, sy=sy0+(j+0.5)*ch;
      const q=worldAt(sx,sy);
      if(q.fwd<-maxBack || q.fwd>maxF || Math.abs(q.right)>side) continue;
      const h=terrainH(q.x,q.y);
      const dS=420;
      const hx=terrainH(q.x+dS,q.y)-terrainH(q.x-dS,q.y);
      const hy=terrainH(q.x,q.y+dS)-terrainH(q.x,q.y-dS);
      const slope=clamp(Math.hypot(hx,hy)/1700,0,1);
      const relief=clamp(h/Math.max(1,pk),0,1);
      const ahead=clamp(q.fwd/maxF,0,1);
      const aspect=clamp((terrainH(q.x+sn*dS,q.y+cs*dS)-terrainH(q.x-sn*dS,q.y-cs*dS))/700,0,1);
      let b=0.10 + relief*0.34 + slope*0.34 + aspect*0.18;
      if(q.fwd<0) b*=0.55;
      const noise=((((i*17+j*31+Math.floor(world.t*8))&15)/15)-0.5)*0.055;
      const pass=Math.abs((sy-sweepY)/FH); const sweepBoost=Math.max(0,1-pass*9)*0.16;
      ctx.fillStyle=radarGreen(clamp(b+noise+sweepBoost,0.045,0.94),0.86);
      ctx.fillRect(sx0+i*cw, sy0+j*ch, cw+0.7, ch+0.7);
    }

    // Ridge/valley detail: subtle contour-like SAR edge flashes without turning
    // the page into a topographic map.
    ctx.strokeStyle='rgba(180,255,190,0.14)'; ctx.lineWidth=0.8;
    for(let y=sy0+8;y<sy1-4;y+=11){
      ctx.beginPath(); let started=false;
      for(let x=sx0+2;x<=sx1-2;x+=8){
        const q=worldAt(x,y), h=terrainH(q.x,q.y), n=terrainH(q.x+360,q.y+360);
        if(Math.abs(h-n)<42){ if(!started){ctx.moveTo(x,y); started=true;} else ctx.lineTo(x,y); }
        else started=false;
      }
      ctx.stroke();
    }

    // Dry channel and infrastructure overlays are references for geography.
    if(typeof _riverCenterX==='function'){
      const pts=[];
      for(let k=-20;k<=120;k++){ const yy=ac.pos.y + (k/100)*maxF*1.25; pts.push({x:_riverCenterX(yy),y:yy}); }
      drawPoly(pts,'rgba(65,210,110,0.42)',1.35,false);
    }
    const inf=(world&&world.infrastructure)||{};
    for(const rd of (inf.roads||[])) drawPoly(rd.pts||[],'rgba(185,255,170,0.34)',1.1,false);
    for(const pl of (inf.powerlines||[])) drawPoly([pl.a,pl.b],'rgba(210,255,185,0.26)',0.9,false);
    ctx.strokeStyle='rgba(225,255,190,0.62)'; ctx.lineWidth=1.3;
    for(const br of (inf.bridges||[])){
      const len=br.len||420, hd=br.hdg||0, si=Math.sin(hd), co=Math.cos(hd);
      const a=plot(br.x-si*len/2, br.y-co*len/2), b=plot(br.x+si*len/2, br.y+co*len/2);
      if(inF(a)&&inF(b)){ ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b.sx,b.sy); ctx.stroke(); }
    }

    // Ownship trail in world space proves the SAR frame is moving/rotating with aircraft.
    if(!this._sarOwnTrail) this._sarOwnTrail=[];
    const tr=this._sarOwnTrail;
    if(!tr.length || Math.hypot(tr[tr.length-1].x-ac.pos.x,tr[tr.length-1].y-ac.pos.y)>350){ tr.push({x:ac.pos.x,y:ac.pos.y,t:world.t}); if(tr.length>28) tr.shift(); }
    ctx.strokeStyle='rgba(190,255,170,0.45)'; ctx.lineWidth=1; ctx.beginPath(); let began=false;
    for(const t of tr){ const p=plot(t.x,t.y); if(!inF(p)) continue; if(!began){ctx.moveTo(p.sx,p.sy); began=true;} else ctx.lineTo(p.sx,p.sy); }
    if(began) ctx.stroke();

    const hits=[];
    const recency=(p,o)=>{ if(Math.abs(p.sy-sweepY)<5) o._gmtT=world.t; return clamp(1-(world.t-(o._gmtT||-99))/2.0,0.2,1); };
    // strike-target buildings — fixed bright returns
    if (!world.target.destroyed){
      for (const bd of world.target.buildings){ if(bd.destroyed)continue; const p=plot(bd.x,bd.y); if(!inF(p))continue;
        ctx.fillStyle=bd.primary?C_HOT:'#d9ffe6'; ctx.fillRect(p.sx-3,p.sy-3,6,6);
        ctx.strokeStyle=bd.primary?C_RED:C_GREEN; ctx.lineWidth=1; ctx.strokeRect(p.sx-6,p.sy-6,12,12);
        if(bd.primary){ ctx.fillStyle=C_RED; ctx.font='8px "Courier New"'; ctx.textAlign='left'; ctx.fillText('TGT',p.sx+8,p.sy+3); }
        hits.push({sx:p.sx,sy:p.sy,obj:bd,name:bd.label||'TGT'});
      }
    }
    for (const st of world.structures){ if(st.destroyed)continue; const p=plot(st.x,st.y); if(!inF(p))continue;
      ctx.globalAlpha=recency(p,st); ctx.strokeStyle=st.hostile?C_RED:'#7fe0ff'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.sx,p.sy-6); ctx.lineTo(p.sx+6,p.sy); ctx.lineTo(p.sx,p.sy+6); ctx.lineTo(p.sx-6,p.sy); ctx.closePath(); ctx.stroke();
      ctx.fillStyle=st.hostile?C_RED:'#7fe0ff'; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText('UGF',p.sx+8,p.sy+2);
      ctx.globalAlpha=1; hits.push({sx:p.sx,sy:p.sy,obj:st,name:st.name});
    }
    for (const v of world.hvts){ if(v.destroyed)continue; const p=plot(v.x,v.y); if(!inF(p))continue;
      ctx.fillStyle=C_HOT; ctx.fillRect(p.sx-2,p.sy-2,5,5); ctx.strokeStyle=C_HOT; ctx.lineWidth=1; ctx.strokeRect(p.sx-5,p.sy-5,10,10);
      hits.push({sx:p.sx,sy:p.sy,obj:v,name:v.name}); }
    for (const gm of world.groundMovers){ if(gm.destroyed||gm.underground)continue; const p=plot(gm.x,gm.y); if(!inF(p))continue;
      if (gm.track&&gm.track.length>1){ ctx.strokeStyle='rgba(255,200,120,0.35)'; ctx.lineWidth=1; ctx.beginPath();
        let first=true; gm.track.forEach(t=>{ const q=plot(t.x,t.y); if(!inF(q))return; if(first){ctx.moveTo(q.sx,q.sy); first=false;} else ctx.lineTo(q.sx,q.sy); }); if(!first)ctx.stroke(); }
      ctx.globalAlpha=recency(p,gm); const tel=gm.kind==='TEL';
      ctx.fillStyle=tel?'#ff7a4d':'#ffd9a8'; ctx.fillRect(p.sx-3,p.sy-3,6,6);
      ctx.strokeStyle=tel?C_RED:C_ORG; ctx.lineWidth=1; ctx.strokeRect(p.sx-4,p.sy-4,8,8);
      const lead=plot(gm.x+Math.sin(gm.psi)*220, gm.y+Math.cos(gm.psi)*220);
      ctx.beginPath(); ctx.moveTo(p.sx,p.sy); ctx.lineTo(lead.sx,lead.sy); ctx.stroke(); ctx.globalAlpha=1;
      if (tel){ ctx.fillStyle=C_RED; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText('TEL',p.sx+6,p.sy-4); }
      hits.push({sx:p.sx,sy:p.sy,obj:gm,name:gm.name});
    }
    m._sarHits=hits;
    if (world.gndLock && !world.gndLock.destroyed){ const p=plot(world.gndLock.x,world.gndLock.y);
      if (inF(p)){ ctx.strokeStyle=C_HOT; ctx.lineWidth=1.5; ctx.strokeRect(p.sx-9,p.sy-9,18,18);
        ctx.fillStyle=C_HOT; ctx.font='8px "Courier New"'; ctx.textAlign='left'; ctx.fillText('DESIG',p.sx+11,p.sy+3); } }

    // Sweep line + ownship symbol
    ctx.strokeStyle='rgba(120,255,150,0.92)'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(sx0,sweepY); ctx.lineTo(sx1,sweepY); ctx.stroke();
    ctx.strokeStyle=C_HOT; ctx.fillStyle='rgba(168,255,192,0.10)'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(ownX,ownY-13); ctx.lineTo(ownX+9,ownY+8); ctx.lineTo(ownX,ownY+4); ctx.lineTo(ownX-9,ownY+8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle=C_HOT; ctx.font='7px "Courier New"'; ctx.textAlign='center'; ctx.fillText('OWN',ownX,ownY+20);
    ctx.restore();

    ctx.strokeStyle=C_GREEN; ctx.lineWidth=1; ctx.strokeRect(sx0,sy0,FW,FH);
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('FCR SAR/GMT', 6, 14);
    ctx.textAlign='right'; ctx.fillText('R'+rangeNM+'  TRK-UP', W-6, 14);
    ctx.textAlign='center'; ctx.font='9px "Courier New"';
    ctx.fillText('OWNSHIP REF  TERRAIN/GMT', W/2, PADt-6);
    const hdg=((ac.psi*180/Math.PI)%360+360)%360;
    ctx.textAlign='left'; ctx.fillText('HDG '+String(Math.round(hdg)).padStart(3,'0'), PADx, PADt+FH+14);
    const ntrk=world.groundMovers.filter(g=>!g.destroyed&&!g.underground).length;
    ctx.textAlign='right'; ctx.fillText('GMT '+ntrk+'  TAP=DESIG', PADx+FW, PADt+FH+14);
  }
};
/* ---------- HSD : top-down track-up map (same world) ---------- */
PAGES.HSD={
  render(m,ctx){
    const ac=world.ac, W=m.W, H=m.H, cx=W/2, cy=H*0.56, Rpx=Math.min(W,H)*0.42;
    const scale=Rpx/m.range;          // px per NM
    const toXY=(wx,wy)=>{
      const dx=(wx-ac.pos.x)/NM, dy=(wy-ac.pos.y)/NM;     // NM east/north
      const rel=angWrap(Math.atan2(dx,dy)-ac.psi);
      const d=Math.hypot(dx,dy);
      return { x: cx + d*Math.sin(rel)*scale, y: cy - d*Math.cos(rel)*scale, d };
    };
    // range rings
    ctx.strokeStyle=C_DIM; ctx.lineWidth=1;
    for (let i=1;i<=2;i++){ ctx.beginPath(); ctx.arc(cx,cy,Rpx*i/2,0,2*Math.PI); ctx.stroke(); }
    ctx.fillStyle=C_GREEN; ctx.font='8px "Courier New"'; ctx.textAlign='left';
    ctx.fillText((m.range/2|0)+'',cx+4,cy-Rpx/2+10); ctx.fillText(m.range+'',cx+4,cy-Rpx+10);
    // compass ticks (track-up)
    ctx.strokeStyle=C_DIM;
    for (let a=0;a<360;a+=30){ const r=angWrap((a-ac.psi*RAD)*DEG);
      const x1=cx+Math.sin(r)*Rpx, y1=cy-Math.cos(r)*Rpx, x2=cx+Math.sin(r)*(Rpx-6), y2=cy-Math.cos(r)*(Rpx-6);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
    // threats
    for (const th of world.threats){ if(!th.live)continue;
      const p=toXY(th.x,th.y);
      ctx.strokeStyle=th.tracking?th.color:'rgba(255,120,80,0.5)';
      ctx.lineWidth=th.tracking?1.6:1;
      ctx.beginPath(); ctx.arc(p.x,p.y,th.radius/NM*scale,0,2*Math.PI); ctx.stroke();
      ctx.fillStyle=th.color; ctx.fillText(th.name,p.x+3,p.y-3);
    }
    // route line + waypoints
    ctx.strokeStyle='rgba(39,255,94,0.6)'; ctx.lineWidth=1; ctx.beginPath();
    world.waypoints.forEach((w,i)=>{ const p=toXY(w.x,w.y); if(i===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
    ctx.stroke();
    for (const w of world.waypoints){ const p=toXY(w.x,w.y);
      const cur=w.id===world.steerpoint;
      ctx.strokeStyle=cur?C_HOT:C_GREEN; ctx.fillStyle=cur?C_HOT:C_GREEN; ctx.lineWidth=cur?1.6:1;
      ctx.beginPath(); ctx.moveTo(p.x,p.y-4); ctx.lineTo(p.x+4,p.y); ctx.lineTo(p.x,p.y+4); ctx.lineTo(p.x-4,p.y); ctx.closePath(); ctx.stroke();
      ctx.font='8px "Courier New"'; ctx.textAlign='left'; ctx.fillText(w.name,p.x+6,p.y+3);
    }
    // target
    if (!world.target.destroyed){ const p=toXY(world.target.x,world.target.y);
      ctx.strokeStyle=C_YEL; ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.arc(p.x,p.y,6,0,2*Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x-8,p.y); ctx.lineTo(p.x+8,p.y); ctx.moveTo(p.x,p.y-8); ctx.lineTo(p.x,p.y+8); ctx.stroke();
    }
    // bullseye
    { const p=toXY(world.bullseye.x,world.bullseye.y);
      ctx.strokeStyle=C_DIM; ctx.beginPath(); ctx.arc(p.x,p.y,5,0,2*Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x,p.y,2,0,2*Math.PI); ctx.stroke(); }
    // bandits
    for (const bd of world.bandits){ if(bd.hp<=0)continue; const p=toXY(bd.x,bd.y);
      if (p.d>m.range) continue;
      ctx.strokeStyle=bd.kind==='HOSTILE'?C_RED:C_YEL; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.x-4,p.y+3); ctx.lineTo(p.x,p.y-4); ctx.lineTo(p.x+4,p.y+3); ctx.stroke();
    }
    // moving ground targets (filled squares)
    for (const gm of world.groundMovers){ if(gm.destroyed||gm.underground)continue; const p=toXY(gm.x,gm.y); if(p.d>m.range)continue;
      ctx.strokeStyle=C_ORG; ctx.fillStyle='rgba(255,154,77,0.25)'; ctx.lineWidth=1.2;
      ctx.fillRect(p.x-3,p.y-3,6,6); ctx.strokeRect(p.x-3,p.y-3,6,6);
      ctx.fillStyle=C_ORG; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText(gm.name,p.x+5,p.y+2);
    }
    // high-value targets (diamond + cross)
    for (const v of world.hvts){ if(v.destroyed)continue; const p=toXY(v.x,v.y); if(p.d>m.range)continue;
      ctx.strokeStyle=C_RED; ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.moveTo(p.x,p.y-6); ctx.lineTo(p.x+6,p.y); ctx.lineTo(p.x,p.y+6); ctx.lineTo(p.x-6,p.y); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x-6,p.y-6); ctx.lineTo(p.x+6,p.y+6); ctx.moveTo(p.x+6,p.y-6); ctx.lineTo(p.x-6,p.y+6); ctx.stroke();
      ctx.fillStyle=C_RED; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText(v.name,p.x+7,p.y+2);
    }
    // friendly AWACS data assets (cyan)
    for (const f of world.friendlies){ if(!f.alive)continue; const p=toXY(f.x,f.y); if(p.d>m.range)continue;
      ctx.strokeStyle='#5bd6ff'; ctx.fillStyle='#5bd6ff'; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.arc(p.x,p.y,5,Math.PI,2*Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x,p.y,2,0,2*Math.PI); ctx.fill();
      ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText(f.type,p.x+7,p.y+2);
    }
    // datalink picture from AWACS — hollow cyan rings on known enemies
    if (datalinkActive()){
      ctx.strokeStyle='rgba(91,214,255,0.8)'; ctx.lineWidth=1;
      const ring=(wx,wy)=>{ const p=toXY(wx,wy); if(p.d>m.range)return; ctx.beginPath(); ctx.arc(p.x,p.y,7,0,2*Math.PI); ctx.stroke(); };
      for (const bd of world.bandits){ if(bd.hp>0) ring(bd.x,bd.y); }
      for (const gm of world.groundMovers){ if(!gm.destroyed) ring(gm.x,gm.y); }
      for (const v of world.hvts){ if(!v.destroyed) ring(v.x,v.y); }
      ctx.fillStyle='#5bd6ff'; ctx.font='bold 8px "Courier New"'; ctx.textAlign='right';
      ctx.fillText('AWACS LINK', W-6, 26);
    }
    // our weapons in flight — track on the radar toward their targets
    for (const s of world.sams){
      if (s.team!=='BLUE') continue;
      const p=toXY(s.pos.x,s.pos.y); if(p.d>m.range) continue;
      if (s.tgt){ const tp=toXY(s.tgt.x,s.tgt.y);
        ctx.strokeStyle='rgba(168,255,200,0.5)'; ctx.setLineDash([3,3]); ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(tp.x,tp.y); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle='#a8ffc0'; ctx.fillStyle='#a8ffc0'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.x-3,p.y);ctx.lineTo(p.x+3,p.y);ctx.moveTo(p.x,p.y-3);ctx.lineTo(p.x,p.y+3); ctx.stroke();
      ctx.fillRect(p.x-1,p.y-1,2,2);
    }
    // ownship
    ctx.strokeStyle=C_HOT; ctx.fillStyle='rgba(168,255,192,0.25)'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(cx,cy-7); ctx.lineTo(cx+5,cy+6); ctx.lineTo(cx,cy+3); ctx.lineTo(cx-5,cy+6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // header
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('HSD', 6,14);
    ctx.textAlign='right'; ctx.fillText('T-UP '+m.range+'NM', W-6,14);
  }
};

/* ---------- THREAT / EWS : inbound-missile tracking + launch origins ---------- */
PAGES.THR={
  render(m,ctx){
    const ac=world.ac, W=m.W, H=m.H, cx=W/2, cy=H*0.56, Rpx=Math.min(W,H)*0.42;
    const scale=Rpx/m.range;
    const toXY=(wx,wy)=>{ const dx=(wx-ac.pos.x)/NM, dy=(wy-ac.pos.y)/NM;
      const rel=angWrap(Math.atan2(dx,dy)-ac.psi); const d=Math.hypot(dx,dy);
      return { x:cx+d*Math.sin(rel)*scale, y:cy-d*Math.cos(rel)*scale, d }; };
    const hits=[]; m._thrHits=hits;
    // range rings + compass ticks (track-up)
    ctx.strokeStyle=C_DIM; ctx.lineWidth=1;
    for (let i=1;i<=2;i++){ ctx.beginPath(); ctx.arc(cx,cy,Rpx*i/2,0,2*Math.PI); ctx.stroke(); }
    ctx.fillStyle=C_GREEN; ctx.font='8px "Courier New"'; ctx.textAlign='left';
    ctx.fillText((m.range/2|0)+'',cx+4,cy-Rpx/2+10); ctx.fillText(m.range+'',cx+4,cy-Rpx+10);
    ctx.strokeStyle=C_DIM;
    for (let a=0;a<360;a+=30){ const r=angWrap((a-ac.psi*RAD)*DEG);
      const x1=cx+Math.sin(r)*Rpx, y1=cy-Math.cos(r)*Rpx, x2=cx+Math.sin(r)*(Rpx-6), y2=cy-Math.cos(r)*(Rpx-6);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }

    // live threat emitters — lethal ring + launcher box, tracking ones in red
    for (const th of world.threats){ if(!th.live||th.destroyed)continue; const p=toXY(th.x,th.y); if(p.d>m.range*1.05)continue;
      const desig=(th===world.gndLock||th===world.harmLock);
      ctx.strokeStyle=th.tracking?'rgba(255,60,60,0.9)':'rgba(255,120,80,0.4)'; ctx.lineWidth=th.tracking?1.5:1;
      ctx.beginPath(); ctx.arc(p.x,p.y, Math.min(Rpx, th.radius/NM*scale),0,2*Math.PI); ctx.stroke();
      ctx.strokeStyle=desig?C_HOT:(th.tracking?C_RED:C_ORG); ctx.lineWidth=desig?1.8:1.2;
      ctx.strokeRect(p.x-4,p.y-4,8,8);
      if (desig){ ctx.beginPath(); ctx.arc(p.x,p.y,8,0,2*Math.PI); ctx.stroke(); }
      ctx.fillStyle=th.tracking?C_RED:C_ORG; ctx.font='8px "Courier New"'; ctx.textAlign='left';
      ctx.fillText(th.name+(th.tracking?' *':''), p.x+7, p.y+2);
      hits.push({sx:p.x,sy:p.y,obj:th,kind:'EMITTER',name:th.name});
    }
    // bandits (air)
    for (const bd of world.bandits){ if(bd.hp<=0)continue; const p=toXY(bd.x,bd.y); if(p.d>m.range)continue;
      ctx.strokeStyle=bd.kind==='HOSTILE'?C_RED:C_YEL; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.x-4,p.y+3); ctx.lineTo(p.x,p.y-4); ctx.lineTo(p.x+4,p.y+3); ctx.stroke(); }

    // inbound RED missiles — origin marker (where it came from) + track + head + TTI
    let inbound=0, nearestTTI=Infinity;
    for (const s of world.sams){ if(s.team!=='RED')continue;
      const ph=toXY(s.pos.x,s.pos.y);
      if (s.origin){ const po=toXY(s.origin.x,s.origin.y);
        ctx.strokeStyle='rgba(255,80,80,0.9)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(po.x-4,po.y); ctx.lineTo(po.x+4,po.y); ctx.moveTo(po.x,po.y-4); ctx.lineTo(po.x,po.y+4);
        ctx.moveTo(po.x-3,po.y-3); ctx.lineTo(po.x+3,po.y+3); ctx.moveTo(po.x+3,po.y-3); ctx.lineTo(po.x-3,po.y+3); ctx.stroke();
        ctx.fillStyle='rgba(255,130,130,0.95)'; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText('LP '+(s.name||''),po.x+6,po.y-4);
        hits.push({sx:po.x,sy:po.y,obj:s.src||null,kind:'ORIGIN',name:(s.name||'LAUNCH')+' SITE'});
      }
      if (s.trail && s.trail.length>1){ ctx.strokeStyle='rgba(255,60,60,0.7)'; ctx.lineWidth=1.4; ctx.beginPath();
        s.trail.forEach((t,i)=>{ const p=toXY(t.x,t.y); if(i===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
        ctx.lineTo(ph.x,ph.y); ctx.stroke(); }
      ctx.fillStyle='#ff3b3b'; ctx.beginPath(); ctx.arc(ph.x,ph.y,3,0,2*Math.PI); ctx.fill();
      const dist=vlen(vsub({x:s.pos.x,y:s.pos.y,z:s.pos.z}, ac.pos));
      const tti=dist/Math.max(120,s.spd||300); inbound++; nearestTTI=Math.min(nearestTTI,tti);
      ctx.fillStyle='#ff8080'; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText(tti.toFixed(0)+'s', ph.x+5, ph.y+3);
    }

    // ownship
    ctx.strokeStyle=C_HOT; ctx.fillStyle='rgba(168,255,192,0.25)'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(cx,cy-7); ctx.lineTo(cx+5,cy+6); ctx.lineTo(cx,cy+3); ctx.lineTo(cx-5,cy+6); ctx.closePath(); ctx.fill(); ctx.stroke();

    // header + inbound banner
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left'; ctx.fillText('THREAT  EWS', 6,14);
    ctx.textAlign='right'; ctx.fillStyle=C_GREEN; ctx.fillText('T-UP '+m.range+'NM', W-6,14);
    if (inbound>0){
      ctx.textAlign='center'; ctx.fillStyle=(world.t%1<0.5)?'#ff3b3b':'#ff9a4d'; ctx.font='bold 12px "Courier New"';
      ctx.fillText('\u25b2 INBOUND '+inbound+'   TTI '+(isFinite(nearestTTI)?nearestTTI.toFixed(0):'-')+'s', cx, H-10);
    } else {
      ctx.textAlign='center'; ctx.fillStyle=C_DIM; ctx.font='8px "Courier New"';
      ctx.fillText('TAP A LAUNCH PT / EMITTER TO DESIGNATE  \u00b7  B1 \u2192 HSD', cx, H-8);
    }
  }
};

/* ---------- ECM / EW POD : spectrum analyzer — dancing trace, line markers, jam slots ---------- */
PAGES.ECM={
  render(m,ctx){
    const W=m.W, H=m.H, T=world.t||0;
    ctx.fillStyle=C_GREEN; ctx.font='bold 10px "Courier New"'; ctx.textAlign='left'; ctx.fillText('ECM SPECTRUM',6,12);
    const slots=world.ecm.jam||[];
    ctx.textAlign='center'; ctx.font='8px "Courier New"'; ctx.fillStyle=slots.length?'#5bd6ff':C_DIM; ctx.fillText('JAM '+slots.length+'/'+JAM_SLOTS, W/2, 12);
    ctx.textAlign='right'; ctx.fillStyle=world.ecm.on?'#5bd6ff':C_DIM; ctx.fillText(world.ecm.on?'ACTIVE':'STBY', W-6, 12);

    const sp=ecmSpectrum();
    // ===== SPECTRUM ANALYZER (top half) =====
    const gx0=8, gx1=W-8, gtop=18, gbase=Math.round(H*0.50), gh=gbase-gtop, gw=gx1-gx0;
    const fx=f=>gx0+(f/100)*gw;
    ctx.strokeStyle='#0d2a18'; ctx.lineWidth=1; ctx.strokeRect(gx0,gtop,gw,gh);
    ctx.strokeStyle='#0a2113'; ctx.fillStyle=C_DIM; ctx.font='7px "Courier New"'; ctx.textAlign='center';
    for (let f=12.5; f<100; f+=12.5){ const xx=fx(f); ctx.beginPath(); ctx.moveTo(xx,gtop); ctx.lineTo(xx,gbase); ctx.stroke(); }
    for (let f=0; f<=100; f+=25){ ctx.fillText(f, fx(f), gbase+8); }
    // jam-slot coverage shading (where the pod is denying)
    for (const j of slots){ const xa=fx(Math.max(0,j-JAM_TOL)), xb=fx(Math.min(100,j+JAM_TOL));
      ctx.fillStyle='rgba(91,214,255,0.14)'; ctx.fillRect(xa,gtop,xb-xa,gh); }
    // band markers — plain vertical lines (no arrowheads), coloured by status
    const peaks=[];
    for (const p of sp){ const xx=fx(p.f), ph=Math.max(5, gh*0.9*clamp(p.strength,0,1));
      const col=p.jammed?'#5bd6ff':p.th.tracking?C_RED:C_ORG;
      ctx.strokeStyle=col; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(xx,gbase); ctx.lineTo(xx,gbase-ph); ctx.stroke();
      peaks.push({sx:xx, f:p.f, th:p.th, ph, col}); }
    const tallest=new Map(); for (const pk of peaks){ const t=tallest.get(pk.th); if(!t||pk.ph>t.ph) tallest.set(pk.th,pk); }
    ctx.font='7px "Courier New"'; ctx.textAlign='center';
    for (const pk of tallest.values()){ ctx.fillStyle=pk.col; ctx.fillText((pk.th.name||'SAM').replace(/\s.*/,'').slice(0,5), pk.sx, gbase-pk.ph-3); }
    // live analyzer trace — dancing noise floor with gaussian bumps over each band
    const N=120, floor=gh*0.085, sig=2.6;
    ctx.strokeStyle='#39ff6e'; ctx.lineWidth=1; ctx.beginPath();
    for (let i=0;i<=N;i++){ const f=(i/N)*100, xx=fx(f);
      let v = floor*(0.5 + 0.4*Math.sin(f*0.55 + T*4.2) + 0.3*Math.sin(f*1.7 - T*6.7)); if(v<0) v=0;
      v += Math.random()*floor*0.55;                                  // grassy floor
      for (const p of sp){ const ph=gh*0.9*clamp(p.strength,0,1), dd=f-p.f; v += ph*Math.exp(-(dd*dd)/(2*sig*sig)); }
      v += (Math.random()-0.5)*floor*0.5;                             // shimmer over the peaks too
      const yy = gbase - clamp(v,0,gh);
      if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
    }
    ctx.stroke();
    // cursor (slider) — plain dashed line
    const cf=world.ecm.cursor||50, cx=fx(cf);
    ctx.strokeStyle='#eaff00'; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(cx,gtop); ctx.lineTo(cx,gbase); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#eaff00'; ctx.textAlign='left'; ctx.font='8px "Courier New"'; ctx.fillText('CUR '+cf.toFixed(1), gx0+2, gtop+9);
    m._ecmSpec={ x0:gx0, x1:gx1, yTop:gtop, yBase:gbase, peaks };

    // ===== JAM SLOTS + EMITTERS (bottom half) =====
    let y = gbase + 18;
    ctx.textAlign='left'; ctx.fillStyle=C_GREEN; ctx.font='8px "Courier New"'; ctx.fillText('JAM SLOTS', 6, y);
    const sw=(W-12)/JAM_SLOTS, sy=y+5, sh=22, cells=[];
    for (let i=0;i<JAM_SLOTS;i++){ const sx=6+i*sw, on=i<slots.length;
      ctx.strokeStyle=on?'#5bd6ff':'#14361f'; ctx.fillStyle=on?'rgba(91,214,255,0.22)':'transparent'; ctx.lineWidth=1;
      ctx.fillRect(sx+1,sy,sw-2,sh); ctx.strokeRect(sx+1,sy,sw-2,sh);
      ctx.fillStyle=on?'#9fe6ff':C_DIM; ctx.textAlign='center'; ctx.font='8px "Courier New"';
      ctx.fillText(on?slots[i].toFixed(0):'\u00b7', sx+sw/2, sy+14);
      cells.push({x:sx, y:sy, w:sw, h:sh, freq:on?slots[i]:null}); }
    m._ecmSlots=cells;
    // emitter list, spread to fill the rest of the bottom half
    const byTh=new Map(); for (const p of sp){ if(!byTh.has(p.th)) byTh.set(p.th,p); }
    const ems=[...byTh.keys()].sort((a,b)=>distTo(a.x,a.y)-distTo(b.x,b.y)).slice(0,5);
    let ey = sy+sh+14; const eRow = ems.length ? Math.min(15, Math.max(11, (H-12-ey)/ems.length)) : 12;
    ctx.font='8px "Courier New"';
    if(!ems.length){ ctx.fillStyle=C_DIM; ctx.textAlign='center'; ctx.fillText('NO EMITTERS IN RANGE', W/2, ey+4); }
    for (const th of ems){ const d=distTo(th.x,th.y), jammed=emitterJammed(th), burn=emitterBurnThru(th);
      const status=!world.ecm.on?'SEARCH':jammed?'JAMMED':burn?'BURN-THRU':(allBandsCovered(th)?'BURN-THRU':'SEARCH');
      const col=jammed?'#5bd6ff':burn?'#ffd24d':th.tracking?C_RED:C_ORG;
      ctx.textAlign='left'; ctx.fillStyle=col; ctx.fillText((th.name||'SAM').slice(0,7), 6, ey);
      ctx.fillStyle=C_DIM; ctx.fillText(th.bands.map(f=>f.toFixed(0)).join(' '), 78, ey);
      ctx.fillStyle=col; ctx.fillText(status, 150, ey);
      ctx.fillStyle=C_DIM; ctx.textAlign='right'; ctx.fillText((d/NM).toFixed(0)+'NM', W-6, ey);
      ey += eRow;
    }
    ctx.textAlign='center'; ctx.fillStyle=C_DIM; ctx.font='7px "Courier New"';
    ctx.fillText('TAP PEAK = JAM \u00b7 \u25c4\u25ba SLIDE \u00b7 SEL \u00b7 AUTO \u00b7 TAP SLOT = CLR', W/2, H-4);
  }
};

/* ---------- SMS : silhouette (uses f16.png) + stores ---------- */
const STN_NORM=[ // normalized over silhouette image
  {id:1,x:0.045,y:0.645},{id:2,x:0.205,y:0.700},{id:3,x:0.345,y:0.665},
  {id:4,x:0.430,y:0.625},{id:5,x:0.500,y:0.745},{id:6,x:0.570,y:0.625},
  {id:7,x:0.655,y:0.665},{id:8,x:0.795,y:0.700},{id:9,x:0.955,y:0.645},
];
PAGES.SMS={
  render(m,ctx){
    const W=m.W,H=m.H;
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('SMS',6,14);
    ctx.textAlign='right'; ctx.fillText(world.masterMode,W-6,14);
    ctx.textAlign='center';
    ctx.fillStyle = world.masterArm==='ARM'?C_RED:world.masterArm==='SIM'?C_YEL:C_GREEN;
    ctx.fillText('M-ARM '+world.masterArm,W/2,14);

    // silhouette draw rect (centered)
    const ih = H*0.62, iw = ih*(F16IMG.naturalWidth/Math.max(1,F16IMG.naturalHeight) || 0.748);
    const ix = W/2 - iw/2, iy = 26;
    if (F16IMG_OK){
      ctx.save(); ctx.globalAlpha=0.95;
      ctx.shadowColor=C_GREEN; ctx.shadowBlur=6;
      ctx.drawImage(F16IMG, ix, iy, iw, ih);
      ctx.restore();
    } else {
      ctx.strokeStyle=C_GREEN; ctx.strokeRect(ix,iy,iw,ih);
      ctx.fillStyle=C_DIM; ctx.fillText('LOADING SILHOUETTE…',W/2,iy+ih/2);
    }
    // station markers over the silhouette
    const sp=id=>{ const n=STN_NORM.find(s=>s.id===id); return {x:ix+n.x*iw, y:iy+n.y*ih}; };
    // peripheral labels
    ctx.font='8px "Courier New"';
    for (let i=0;i<world.stations.length;i++){
      const s=world.stations[i]; const p=sp(s.id);
      const left = s.id<=4 || s.id===5 && false; const leftSide = s.id<=4;
      const lx = leftSide?4:W-4; const ly = 30 + (leftSide? i: (i-5))*0 ;
      // stack labels: left ids 1-4 top-down, right ids 6-9, center 5 at bottom
      let labelX, labelY, align;
      if (s.id<=4){ align='left'; labelX=4; labelY=34 + (s.id-1)*22; }
      else { align='right'; labelX=W-4; labelY=34 + (s.id-5)*22; }
      ctx.textAlign=align;
      // marker
      const selectable = (typeof isWeaponStation==='function') ? isWeaponStation(s) : (s.kind!=='pod' && s.kind!=='tank');
      const seld = selectable && world.selectedStation===s.id;
      ctx.strokeStyle = seld?C_HOT: selectable&&s.qty>0?C_GREEN:C_DIM;
      ctx.fillStyle = seld?'rgba(168,255,192,0.3)':'transparent'; ctx.lineWidth=seld?2:1;
      ctx.fillRect(p.x-3,p.y-3,6,6); ctx.strokeRect(p.x-3,p.y-3,6,6);
      // label text (no connector line — that was the clutter we removed)
      ctx.fillStyle=seld?C_HOT:(selectable?C_GREEN:C_DIM); ctx.font='bold 8px "Courier New"';
      ctx.fillText('S'+s.id+' '+s.pos, labelX, labelY);
      const reloading = s.qty<=0 && s.reloadT>0;
      ctx.fillStyle = selectable ? (reloading?'#ffd24d':(s.qty>0?C_GREEN:'rgba(120,120,120,0.8)')) : C_DIM; ctx.font='8px "Courier New"';
      const qtyTxt = !selectable ? ''
                   : reloading ? ('  RLD '+Math.max(0,Math.ceil(s.reloadT-world.t))+'s') : (' x'+s.qty);
      const nameTxt = !selectable && s.kind==='pod' ? 'SENSOR POD' : s.wpn;
      ctx.fillText(nameTxt+qtyTxt, labelX, labelY+9);
    }
    // selected weapon box
    const sel=selectedStore();
    if (sel){
      const bw=150,bh=30,bx=W/2-bw/2,by=H-50;
      ctx.fillStyle='rgba(0,40,18,0.7)'; ctx.fillRect(bx,by,bw,bh);
      ctx.strokeStyle=C_HOT; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh);
      ctx.fillStyle=C_HOT; ctx.font='bold 10px "Courier New"'; ctx.textAlign='center';
      ctx.fillText('SEL '+sel.wpn, W/2, by+12);
      const selRld = sel.qty<=0 && sel.reloadT>0;
      ctx.fillStyle=selRld?'#ffd24d':C_GREEN; ctx.font='9px "Courier New"';
      ctx.fillText('STA'+sel.id+'  '+(selRld?('REARM '+Math.max(0,Math.ceil(sel.reloadT-world.t))+'s'):('QTY '+sel.qty))+'  '+(sel.kind==='ag'?'A-G':sel.kind==='aa'?'A-A':sel.kind.toUpperCase()), W/2, by+24);
    }
    // fuel
    ctx.fillStyle=C_GREEN; ctx.font='9px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('FLR '+world.ac.flares+'  CHF '+(world.ac.chaff||0), 6, H-18);
  }
};

/* ---------- TGP : synthetic FLIR on designated target ---------- */
/* ---------- TGP : 3D thermal sensor (FLIR mirror of the world) ----------
   Renders a grayscale view from the jet toward the designated point, with
   terrain relief, terrain occlusion (painter's order + LOS mask) and a
   WHITE-HOT / BLACK-HOT polarity toggle. Reuses the global vector helpers. */
/* TGP aim point depends on sensor domain: air lock in A-A, else a locked
   ground contact, else the fixed strike target. */
/* ground-stabilized boresight: depressed nose ray cast to the terrain.
   Used when nothing is designated, so the TGP never auto-snaps to a target. */
function defaultTgpPoint(){
  const ac=world.ac, b=acBasis(ac);
  let dx=b.fwd.x, dy=b.fwd.y, dz=b.fwd.z-0.45;          // forward, tilted down
  const dl=Math.hypot(dx,dy,dz)||1; dx/=dl; dy/=dl; dz/=dl;
  if (dz > -0.03) dz=-0.03;                              // always look at least a little down
  let px=ac.pos.x, py=ac.pos.y, pz=ac.pos.z;
  for (let s=0;s<140;s++){ px+=dx*300; py+=dy*300; pz+=dz*300; if (pz<=terrainH(px,py)) break; }
  return {x:px, y:py, z:terrainH(px,py)+4, dom:'GND', name:'BORE', desig:false};
}
function tgpAimPoint(){
  const air = (world.masterMode==='A-A' || world.masterMode==='DGFT');
  if (air && world.airLock){                  // hold the air target — incl. after the kill — until re-designated
    const b=world.airLock; return {x:b.x, y:b.y, z:b.alt, dom:'AIR', desig:true,
      name:(b.hp>0?(b.kind||'AIR')+' TGT':'\u2014 DESTROYED \u2014')};
  }
  if (world.gndLock){                         // hold the ground point — incl. after the kill — until re-designated
    const g=world.gndLock; return {x:g.x, y:g.y, z:terrainH(g.x,g.y)+6, dom:'GND', desig:true,
      name:(g.destroyed?'\u2014 DESTROYED \u2014':(g.name||'GND TGT'))};
  }
  return defaultTgpPoint();                    // nothing designated -> boresight, never the strike target
}
function tgpSensor(){
  const ac=world.ac;
  const a = tgpAimPoint();
  const tp  = { x:a.x, y:a.y, z:a.z };
  const eye = { x:ac.pos.x, y:ac.pos.y, z:ac.pos.z };
  const fwd = vnorm(vsub(tp, eye));
  let right = vcross(fwd, {x:0,y:0,z:1});
  // looking (near) straight down: cross product degenerates — fall back to a
  // frame whose "up" tracks the jet's nose, so the top-down picture stays sensible.
  if (vlen(right) < 1e-3) right = { x:Math.cos(ac.psi), y:-Math.sin(ac.psi), z:0 };
  right = vnorm(right);
  const up = vnorm(vcross(right, fwd));
  return { eye, tp, fwd, right, up, dom:a.dom, name:a.name };
}
function tgpMasked(eye, tp){            // terrain between us and the aim point?
  for (let s=1;s<40;s++){
    const f=s/40;
    const x=eye.x+(tp.x-eye.x)*f, y=eye.y+(tp.y-eye.y)*f, z=eye.z+(tp.z-eye.z)*f;
    if (terrainH(x,y) > z + 8) return true;
  }
  return false;
}
/* pod gimbal limits: it can't look much above the jet's own plane, nor far aft.
   Roll/pitch the jet to a crazy attitude and the look-angle runs out -> GIMBAL. */
function tgpGimbal(S){
  const b = acBasis(world.ac);
  const up = vdot(S.fwd, b.up);        // +ve => aim point is above the jet's plane
  const fw = vdot(S.fwd, b.fwd);       // -ve => aim point is behind the jet
  return (up > 0.18) || (fw < -0.80);  // ~10deg above plane, ~143deg off the nose
}
const TGP_FOV={1:8,2:5,3:3,4:1.5};      // zoom stage -> field of view (deg); higher stage = tighter zoom

/* Replay-safe TGP visuals -------------------------------------------------
   Replay playback rebuilds world objects from immutable snapshots many times
   per second. If the TGP renderer uses Math.random() when a replay object is
   drawn, installations appear to reshape/mutate every frame. These helpers use
   a deterministic seed derived from a stable object id/identity, so generated
   TGP geometry is identical every time the same replay snapshot is rendered. */
function tgpHashString(str){
  str=String(str||''); let h=2166136261>>>0;
  for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  return h>>>0;
}
function tgpObjectSeed(obj, salt){
  obj=obj||{};
  let key = String(salt||'tgp')+'|'+String(obj.id||obj.replayId||obj.name||obj.label||obj.kind||obj.type||'obj');
  if(!obj.id && !obj.replayId && !obj.mobile && obj.spd===undefined){
    key += '|'+Math.round((obj.x||0)/10)+'|'+Math.round((obj.y||0)/10);
  }
  if(obj.geom) key += '|'+String(obj.geom.type||'')+'|'+Math.round((obj.geom.l||0)*10)+'|'+Math.round((obj.geom.w||0)*10)+'|'+Math.round((obj.geom.h||0)*10);
  return tgpHashString(key);
}
function tgpRand(seed){
  let s=(seed>>>0)||0x9e3779b9;
  return function(){ s=(Math.imul(1664525,s)+1013904223)>>>0; return s/4294967296; };
}
function tgpRrange(r, a, b){ return a + (b-a)*r(); }
function tgpPick(r, arr){ return arr[Math.min(arr.length-1, Math.floor(r()*arr.length))]; }
function mkTgpGeomFor(obj, types){
  types=types&&types.length?types:['truck','tank','sam','radar','fuel','bunker'];
  const r=tgpRand(tgpObjectSeed(obj,'geom'));
  const t=tgpPick(r,types);
  const base={ truck:{l:14,w:5,h:4}, tank:{l:9,w:6,h:3}, sam:{l:12,w:5,h:7},
               radar:{l:8,w:8,h:10}, fuel:{l:11,w:7,h:6}, bunker:{l:24,w:16,h:7} }[t] || {l:10,w:6,h:5};
  const k=tgpRrange(r,0.8,1.5);
  return { type:t, l:base.l*k, w:base.w*k, h:base.h*k, rot:tgpRrange(r,0,Math.PI*2) };
}
function ensureTgpGeom(obj, types){
  if(!obj) return {l:10,w:6,h:5,rot:0,type:'generic'};
  if(!obj.geom) obj.geom=mkTgpGeomFor(obj,types);
  return obj.geom;
}

/* a small compound of 2-5 boxes (a main structure + satellites), sized off the
   target's overall geometry. Generated deterministically from the object seed
   and cached on obj._cluster so it is stable in live missions and replays. */
function mkCluster(g, seed){
  const r = seed===undefined ? Math.random : tgpRand(seed);
  const n = 2 + (r()*4|0);                                  // 2..5 boxes
  const boxes = [{ dx:0, dy:0, l:g.l*0.85, w:g.w*0.85, h:g.h, rot:0 }];
  for (let i=1;i<n;i++){
    boxes.push({
      dx: tgpRrange(r, -g.l*0.7, g.l*0.7),
      dy: tgpRrange(r, -g.w*0.8, g.w*0.8),
      l:  g.l*tgpRrange(r, 0.2,0.55),
      w:  g.w*tgpRrange(r, 0.25,0.7),
      h:  g.h*tgpRrange(r, 0.3,1.15),
      rot: tgpRrange(r, 0, Math.PI),
    });
  }
  return boxes;
}
function ensureTgpCluster(obj, g){
  if(!obj._cluster) obj._cluster = mkCluster(g, tgpObjectSeed(obj,'cluster'));
  return obj._cluster;
}
function ensureTgpVisuals(obj, types){
  const g=ensureTgpGeom(obj,types); ensureTgpCluster(obj,g); return obj;
}
if (typeof window!=='undefined') window.ensureTgpVisuals = ensureTgpVisuals;
PAGES.TGP={
  render(m,ctx){
    const W=m.W,H=m.H,PAD=20, vw=W-2*PAD, vh=H-2*PAD-22, x0=PAD, y0=PAD;
    const cx=W/2, cy=y0+vh/2;
    const desig=world.designated || !!world.airLock || !!world.gndLock;
    const whot = m.tgpPol!=='BHOT';
    const gray = h => { const v=Math.round(255*clamp(whot?h:1-h,0,1)); return 'rgb('+v+','+v+','+v+')'; };

    ctx.save(); ctx.beginPath(); ctx.rect(x0,y0,vw,vh); ctx.clip();
    let masked=false, gimbal=false, S=null, proj=null, f=0;
    if (false){                              // always render the sightline (boresight when not designated)
      ctx.fillStyle='#02160b'; ctx.fillRect(x0,y0,vw,vh);
    } else {
      S = tgpSensor();
      gimbal = tgpGimbal(S);
      const fov=(TGP_FOV[m.tgpZoom||2]||5)*DEG;
      f=(vh/2)/Math.tan(fov/2);
      proj=(P)=>{ const r=vsub(P,S.eye); const cz=vdot(r,S.fwd); if(cz<=1)return null;
        return { x:cx+f*vdot(r,S.right)/cz, y:cy-f*vdot(r,S.up)/cz, z:cz }; };
      if (gimbal){
        ctx.fillStyle=gray(0.18); ctx.fillRect(x0,y0,vw,vh);   // can't slew there
      } else {
        // sky / ground split (grayscale) from the sensor horizon
        ctx.fillStyle=gray(0.45); ctx.fillRect(x0,y0,vw,vh);
        const rz=S.right.z, uz=S.up.z, fz=S.fwd.z;
        if (Math.abs(uz)>1e-3){
          const yAt=sx=>{ const ccx=sx-cx; const ccy=-(ccx*rz+f*fz)/uz; return cy-ccy; };
          const yL=yAt(x0), yR=yAt(x0+vw);
          ctx.fillStyle=gray(0.12); ctx.beginPath();
          if (uz>0){ ctx.moveTo(x0,y0-2); ctx.lineTo(x0+vw,y0-2); ctx.lineTo(x0+vw,yR); ctx.lineTo(x0,yL); }
          else      { ctx.moveTo(x0,y0+vh+2); ctx.lineTo(x0+vw,y0+vh+2); ctx.lineTo(x0+vw,yR); ctx.lineTo(x0,yL); }
          ctx.closePath(); ctx.fill();
        }
        // terrain relief around the aim point as shaded polygons, painted
        // far->near so nearer ground occludes what's behind it (like the
        // out-the-window view). Heights are cached in world space (no per-frame noise).
        // patch widens with slant range (quantised to keep the height cache stable)
        // so when we're high / overhead the target we still see a sensible spread
        // of ground rather than a tiny square.
        const slant = Math.max(300, vlen(vsub(S.tp, S.eye)));
        const N=20, span=clamp(Math.round(slant*0.28/400)*400, 1800, 6500);
        let tz=m._tgpZ;
        if (!tz || tz.tx!==S.tp.x || tz.ty!==S.tp.y || tz.span!==span || tz.N!==N || tz.gen!==world.terrainGen){
          const Z=new Float32Array(N*N), GX=new Float32Array(N*N), GY=new Float32Array(N*N);
          for (let j=0;j<N;j++) for (let i=0;i<N;i++){
            const gx=S.tp.x+((i/(N-1)-0.5)*2)*span, gy=S.tp.y+((j/(N-1)-0.5)*2)*span, k=j*N+i;
            GX[k]=gx; GY[k]=gy; Z[k]=terrainH(gx,gy);
          }
          tz=m._tgpZ={tx:S.tp.x,ty:S.tp.y,span,N,Z,GX,GY,gen:world.terrainGen};
        }
        const PP=new Array(N*N);
        for (let k=0;k<N*N;k++) PP[k]=proj({x:tz.GX[k],y:tz.GY[k],z:tz.Z[k]});
        const quads=[];
        for (let j=0;j<N-1;j++) for (let i=0;i<N-1;i++){
          const k=j*N+i, a=PP[k], b2=PP[k+1], c2=PP[k+N+1], d2=PP[k+N];
          if(!a||!b2||!c2||!d2) continue;
          const hh=(tz.Z[k]+tz.Z[k+1]+tz.Z[k+N+1]+tz.Z[k+N])*0.25;
          const mx=(tz.GX[k]+tz.GX[k+1])*0.5, my=(tz.GY[k]+tz.GY[k+1])*0.5;
          const slope=(tz.Z[k+1]-tz.Z[k])+(tz.Z[k+N]-tz.Z[k]);
          quads.push({a,b:b2,c:c2,d:d2,hh,slope,dist:Math.hypot(mx-S.eye.x,my-S.eye.y)});
        }
        quads.sort((q1,q2)=>q2.dist-q1.dist);
        for (const q of quads){
          const sh = clamp(0.55 + q.slope*0.006, 0.6, 1.3);
          const bb = clamp((0.26 + clamp(q.hh/TERRAIN_PEAK,0,1)*0.5) * sh, 0.08, 0.82);
          ctx.fillStyle=gray(bb);
          ctx.beginPath(); ctx.moveTo(q.a.x,q.a.y); ctx.lineTo(q.b.x,q.b.y);
          ctx.lineTo(q.c.x,q.c.y); ctx.lineTo(q.d.x,q.d.y); ctx.closePath(); ctx.fill();
        }
        // hot targets + ID boxes (masked if a ridge blocks line-of-sight)
        masked = tgpMasked(S.eye, S.tp);
        const boxIt=(p,half,col,label)=>{
          ctx.strokeStyle=col; ctx.lineWidth=1; ctx.strokeRect(p.x-half,p.y-half,half*2,half*2);
          if (label){ ctx.fillStyle=col; ctx.font='8px "Courier New"'; ctx.textAlign='left'; ctx.fillText(label,p.x+half+2,p.y+3); }
        };
        // draw a ground target as a small COMPOUND of 2-5 projected boxes (a main
        // structure + satellites) so it reads as an installation, not a single cube.
        // Every box is projected through the live TGP camera, so the whole cluster
        // shifts perspective as the look-angle and range change.
        const drawGeom=(obj, rot, hot, col, label)=>{
          const g=ensureTgpGeom(obj, ['truck','tank','sam','radar','fuel','bunker']);
          const cluster=ensureTgpCluster(obj, g);
          const edge = whot ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
          const cR=Math.cos(rot), sR=Math.sin(rot);
          const drawn=[]; const allPts=[];
          for (const bx of cluster){
            const ox = obj.x + (cR*bx.dx - sR*bx.dy);          // box centre, offset rotated into the target frame
            const oy = obj.y + (sR*bx.dx + cR*bx.dy);
            const z = terrainH(ox,oy);
            const r = rot + bx.rot, c=Math.cos(r), si=Math.sin(r), hl=bx.l/2, hw=bx.w/2;
            const corn=[{x:ox+c*hl-si*hw,y:oy+si*hl+c*hw},{x:ox+c*hl+si*hw,y:oy+si*hl-c*hw},
                        {x:ox-c*hl+si*hw,y:oy-si*hl-c*hw},{x:ox-c*hl-si*hw,y:oy-si*hl+c*hw}];
            const pc=corn.map(q=>proj({x:q.x,y:q.y,z})); if(pc.some(p=>!p)) continue;
            const roof=corn.map(q=>proj({x:q.x,y:q.y,z:z+bx.h}));
            drawn.push({dist:Math.hypot(ox-S.eye.x,oy-S.eye.y), pc, roof});
            pc.forEach(p=>allPts.push(p)); if(!roof.some(p=>!p)) roof.forEach(p=>allPts.push(p));
          }
          if (!drawn.length) return;
          drawn.sort((a,b)=>b.dist-a.dist);                    // painter: far boxes first
          const poly=(pts,fill)=>{ ctx.fillStyle=fill; ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
            for(let k=1;k<4;k++) ctx.lineTo(pts[k].x,pts[k].y); ctx.closePath(); ctx.fill();
            ctx.strokeStyle=edge; ctx.lineWidth=1; ctx.stroke(); };
          for (const d of drawn){
            if(!d.roof.some(p=>!p)){
              // solid block: fill the four side walls, then cap with the roof
              const wall=gray(clamp(hot-0.06,0,1));
              for(let k=0;k<4;k++){ const a=d.pc[k], b=d.pc[(k+1)%4], c=d.roof[(k+1)%4], e=d.roof[k];
                ctx.fillStyle=wall; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.lineTo(e.x,e.y); ctx.closePath(); ctx.fill();
                ctx.strokeStyle=edge; ctx.lineWidth=1; ctx.stroke(); }
              poly(d.roof, gray(clamp(hot+0.10,0,1)));        // bright roof on top
            } else {
              poly(d.pc, gray(hot));                          // roof off-screen — at least fill the footprint
            }
          }
          const xs=allPts.map(p=>p.x), ys=allPts.map(p=>p.y);
          const cxp=(Math.min(...xs)+Math.max(...xs))/2, cyp=(Math.min(...ys)+Math.max(...ys))/2;
          ctx.fillStyle=gray(whot?1:0); ctx.beginPath(); ctx.arc(cxp,cyp,2.2,0,2*Math.PI); ctx.fill();
          const half=Math.max(9,(Math.max(...xs)-Math.min(...xs))/2+4,(Math.max(...ys)-Math.min(...ys))/2+4);
          boxIt({x:cxp,y:cyp}, half, col, label);
        };
        if (!masked && S.dom!=='AIR'){
          for (const b of world.target.buildings){ if(b.destroyed)continue;
            const z=terrainH(b.x,b.y); const pb=proj({x:b.x,y:b.y,z}); const pt=proj({x:b.x,y:b.y,z:z+b.h});
            if(!pb||!pt)continue; const wpx=Math.max(3,f*b.w/pb.z), hpx=Math.max(3,pb.y-pt.y);
            ctx.fillStyle=gray(b.primary?1.0:0.85); ctx.fillRect(pb.x-wpx/2, pb.y-hpx, wpx, hpx);
            ctx.strokeStyle=whot?'rgba(0,0,0,0.85)':'rgba(255,255,255,0.9)'; ctx.lineWidth=1;
            ctx.strokeRect(pb.x-wpx/2, pb.y-hpx, wpx, hpx);
            boxIt({x:pb.x,y:pb.y-hpx/2}, Math.max(9,wpx*0.8+4), b.primary?C_RED:C_GREEN, b.primary?'TGT':null);
          }
          for (const v of world.hvts){ if(v.destroyed)continue; drawGeom(v, (v.geom&&v.geom.rot)||0, 0.92, C_RED, 'HVT'); }
          for (const gm of world.groundMovers){ if(gm.destroyed||gm.underground)continue;
            drawGeom(gm, gm.psi||0, gm.kind==='TEL'?0.96:0.85, gm.kind==='TEL'?C_RED:C_ORG, gm.kind==='TEL'?'TEL':null); }
          // ground structures (bunkers / facilities)
          for (const s of world.structures){ if(s.destroyed||s.underground)continue;
            drawGeom(s, (s.geom&&s.geom.rot)||0, 0.9, C_RED, s.name||'BLDG'); }
          // static SAM sites / launchers — give each a launcher footprint so the pod sees it
          for (const t of world.threats){
            if (t.destroyed || t.mobile || t.structure || t.x===undefined) continue;   // TELs via movers, structures via their own loop
            if (!t.geom){ const g=mkTgpGeomFor(t, ['sam','radar']); t.geom={type:g.type, l:g.l*1.8, w:g.w*1.8, h:g.h*1.5, rot:g.rot}; }
            drawGeom(t, (t.geom&&t.geom.rot)||0, (t.live===false?0.45:0.96),
                     (t===world.gndLock||t.tracking)?C_RED:C_ORG, t.name||'SAM');
          }
        }
        // air target: the SAME dart we draw out-the-window, but solid and
        // projected through the TGP camera — so its aspect changes naturally as
        // it manoeuvres and as our look-angle moves.
        if (!masked && S.dom==='AIR' && world.airLock && world.airLock.hp>0){
          const b = world.airLock;
          const cP=Math.cos(b.psi), sP=Math.sin(b.psi);
          const fdir={x:sP,y:cP}, rdir={x:cP,y:-sP};
          const span=10, len=14;                              // matches render3d.drawBandits
          const nose={x:b.x+fdir.x*len,      y:b.y+fdir.y*len,      z:b.alt};
          const lw  ={x:b.x-fdir.x*4-rdir.x*span, y:b.y-fdir.y*4-rdir.y*span, z:b.alt};
          const rw  ={x:b.x-fdir.x*4+rdir.x*span, y:b.y-fdir.y*4+rdir.y*span, z:b.alt};
          const tail={x:b.x-fdir.x*8,        y:b.y-fdir.y*8,        z:b.alt};
          const pn=proj(nose), pl=proj(lw), pr=proj(rw), pt=proj(tail);
          if (pn&&pl&&pr&&pt){
            ctx.fillStyle=gray(0.97);                          // solid hot return
            ctx.beginPath();
            ctx.moveTo(pn.x,pn.y); ctx.lineTo(pl.x,pl.y);
            ctx.lineTo(pt.x,pt.y); ctx.lineTo(pr.x,pr.y); ctx.closePath(); ctx.fill();
            // ID box sized to the projected extent (with a sensible minimum)
            const xs=[pn.x,pl.x,pr.x,pt.x], ys=[pn.y,pl.y,pr.y,pt.y];
            const bx=Math.min(...xs), by=Math.min(...ys), ex=Math.max(...xs), ey=Math.max(...ys);
            const ccx=(bx+ex)/2, ccy=(by+ey)/2, half=Math.max(8,(ex-bx)/2+4,(ey-by)/2+4);
            const col=(b.kind==='HOSTILE')?C_RED:C_YEL;
            ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.strokeRect(ccx-half,ccy-half,half*2,half*2);
            ctx.fillStyle=col; ctx.font='8px "Courier New"'; ctx.textAlign='left';
            ctx.fillText(b.kind||'AIR', ccx+half+3, ccy-2);
            ctx.fillText(Math.round(b.alt*FT/100)*100+'FT', ccx+half+3, ccy+8);
          }
        }
        // inbound/released ordnance: render the actual missile/bomb body and its recent
        // path through the TGP camera. This gives replay and live pod video the
        // familiar fast streak/object arriving from the attack geometry instead
        // of only showing a sudden target explosion.
        const inFrame=(p)=>p && p.x>=x0-50 && p.x<=x0+vw+50 && p.y>=y0-50 && p.y<=y0+vh+50;
        const trailPts=(o, back)=>{
          const pts=((o&&o.trail)||[]).filter(Boolean).slice(-22).map(q=>({x:q.x,y:q.y,z:q.z}));
          if (o && o.pos){
            const lp=pts[pts.length-1];
            if (!lp || Math.hypot((lp.x||0)-o.pos.x,(lp.y||0)-o.pos.y,(lp.z||0)-o.pos.z)>2) pts.push({x:o.pos.x,y:o.pos.y,z:o.pos.z});
            if (pts.length<2 && o.vel){
              const d=vnorm(o.vel);
              pts.unshift(vadd(o.pos, vscale(d, -back)));
              pts.unshift(vadd(o.pos, vscale(d, -back*0.55)));
            }
          }
          return pts;
        };
        const drawOrdnance=(o, kind)=>{
          if(!o || !o.pos) return;
          const head=proj(o.pos); if(!head) return;
          const isMissile=kind==='missile';
          const pts=trailPts(o, isMissile?420:190);
          let any=inFrame(head), started=false;
          ctx.save();
          ctx.strokeStyle=gray(isMissile?0.98:0.88);
          ctx.fillStyle=gray(0.98);
          ctx.shadowColor=gray(1.0);
          ctx.shadowBlur=isMissile?7:4;
          ctx.globalAlpha=isMissile?0.9:0.72;
          ctx.lineWidth=isMissile?2.0:1.3;
          ctx.beginPath();
          for (const q of pts){
            const pp=proj(q);
            if(!pp){ started=false; continue; }
            any = any || inFrame(pp);
            if(!started){ ctx.moveTo(pp.x,pp.y); started=true; }
            else ctx.lineTo(pp.x,pp.y);
          }
          if(any) ctx.stroke();
          // A short bright body along the instantaneous velocity keeps the projectile
          // readable even when the historical trail is foreshortened by the sensor angle.
          if (any && o.vel){
            const dir=vnorm(o.vel);
            const tail=proj(vadd(o.pos, vscale(dir, isMissile?-30:-16)));
            if(tail){ ctx.globalAlpha=1; ctx.lineWidth=isMissile?2.4:1.7; ctx.beginPath(); ctx.moveTo(tail.x,tail.y); ctx.lineTo(head.x,head.y); ctx.stroke(); }
          }
          if(any){
            const r=clamp(f*(isMissile?3.2:2.3)/Math.max(1,head.z), 1.4, isMissile?4.5:3.2);
            ctx.globalAlpha=1;
            if(isMissile){
              ctx.beginPath(); ctx.moveTo(head.x,head.y-r*1.7); ctx.lineTo(head.x+r*1.2,head.y); ctx.lineTo(head.x,head.y+r*1.7); ctx.lineTo(head.x-r*1.2,head.y); ctx.closePath(); ctx.fill();
            } else {
              ctx.beginPath(); ctx.arc(head.x,head.y,r,0,Math.PI*2); ctx.fill();
            }
          }
          ctx.restore();
        };
        if (!masked){
          for (const bm of world.bombs){ drawOrdnance(bm,'bomb'); }
          for (const ms of world.sams){
            if (ms.team==='BLUE' || ms.groundPos || ms.kind==='AGM' || ms.kind==='HARM' || /AGM|HARM|MAVERICK/.test(ms.weapon||'')) drawOrdnance(ms,'missile');
          }
          // Defensive flares/chaff are visible in the pod video too.  Flares are
          // bright hot dots with a short streak; chaff is a cooler expanding bloom.
          for (const d of (world.decoys||[])){
            if(!d||!d.pos) continue;
            const head=proj(d.pos); if(!head || !inFrame(head)) continue;
            const age=clamp(1-(d.t||0)/(d.life||1),0,1);
            ctx.save();
            if(d.kind==='flare'){
              const vel=d.vel||{x:0,y:0,z:0};
              const tail=proj(vadd(d.pos, vscale(vnorm(vel), -50)));
              ctx.strokeStyle=gray(1.0); ctx.fillStyle=gray(1.0); ctx.globalAlpha=0.85*age; ctx.lineWidth=2;
              if(tail){ ctx.beginPath(); ctx.moveTo(tail.x,tail.y); ctx.lineTo(head.x,head.y); ctx.stroke(); }
              const r=clamp(f*5/Math.max(1,head.z),2,8); ctx.beginPath(); ctx.arc(head.x,head.y,r,0,Math.PI*2); ctx.fill();
              ctx.strokeStyle=C_YEL; ctx.globalAlpha=0.9*age; ctx.beginPath(); ctx.arc(head.x,head.y,r+4,0,Math.PI*2); ctx.stroke();
            } else {
              ctx.strokeStyle=gray(0.82); ctx.globalAlpha=0.55*age; ctx.lineWidth=1.2;
              const r=clamp(f*12/Math.max(1,head.z),3,18); ctx.beginPath(); ctx.arc(head.x,head.y,r,0,Math.PI*2); ctx.stroke();
            }
            ctx.restore();
          }
        }

        // explosions / hits flash on the FLIR
        for (const e of world.effects){
          const p=proj(e.pos); if(!p)continue;
          const k=e.t/e.dur, r=Math.max(2, f*(6+k*40)/p.z);
          ctx.fillStyle=gray(0.97); ctx.globalAlpha=clamp(1-k,0,1);
          ctx.beginPath(); ctx.arc(p.x,p.y,r,0,2*Math.PI); ctx.fill(); ctx.globalAlpha=1;
        }
      }
    }
    ctx.restore();

    // ---- instrument overlay (green) ----
    ctx.strokeStyle=C_GREEN; ctx.lineWidth=1; ctx.strokeRect(x0,y0,vw,vh);
    if (desig && !gimbal){
      ctx.strokeStyle=C_HOT; ctx.lineWidth=1; const s=16,g=5;
      ctx.beginPath(); ctx.moveTo(cx-s,cy);ctx.lineTo(cx-g,cy);ctx.moveTo(cx+g,cy);ctx.lineTo(cx+s,cy);
      ctx.moveTo(cx,cy-s);ctx.lineTo(cx,cy-g);ctx.moveTo(cx,cy+g);ctx.lineTo(cx,cy+s); ctx.stroke();
      const b = m.tgpTrack==='POINT'?13:20; ctx.strokeStyle=m.tgpTrack==='POINT'?C_HOT:C_YEL;
      ctx.beginPath();
      ctx.moveTo(cx-b,cy-b+5);ctx.lineTo(cx-b,cy-b);ctx.lineTo(cx-b+5,cy-b);
      ctx.moveTo(cx+b-5,cy-b);ctx.lineTo(cx+b,cy-b);ctx.lineTo(cx+b,cy-b+5);
      ctx.moveTo(cx+b,cy+b-5);ctx.lineTo(cx+b,cy+b);ctx.lineTo(cx+b-5,cy+b);
      ctx.moveTo(cx-b+5,cy+b);ctx.lineTo(cx-b,cy+b);ctx.lineTo(cx-b,cy+b-5); ctx.stroke();
      if (m.laser){ ctx.strokeStyle=C_RED; ctx.lineWidth=1.4; ctx.beginPath(); ctx.arc(cx,cy,b+6,0,2*Math.PI); ctx.stroke(); }
      if (masked){ ctx.fillStyle=C_YEL; ctx.font='bold 12px "Courier New"'; ctx.textAlign='center'; ctx.fillText('\u2014 MASKED \u2014', cx, cy-b-8); }
    } else if (desig && gimbal){
      ctx.fillStyle=C_RED; ctx.font='bold 13px "Courier New"'; ctx.textAlign='center';
      ctx.fillText('GIMBAL LIMIT', cx, cy); ctx.font='9px "Courier New"';
      ctx.fillStyle=C_YEL; ctx.fillText('pod cannot slew to target', cx, cy+16);
    } else {
      // boresight: a plain cross over the live ground scene (no auto-designation)
      ctx.strokeStyle=C_DIM; ctx.lineWidth=1; const s=14,g=5;
      ctx.beginPath(); ctx.moveTo(cx-s,cy);ctx.lineTo(cx-g,cy);ctx.moveTo(cx+g,cy);ctx.lineTo(cx+s,cy);
      ctx.moveTo(cx,cy-s);ctx.lineTo(cx,cy-g);ctx.moveTo(cx,cy+g);ctx.lineTo(cx,cy+s); ctx.stroke();
      ctx.fillStyle=C_DIM; ctx.textAlign='center'; ctx.font='9px "Courier New"';
      ctx.fillText('BORE \u2014 V / DESIG to lock', cx, y0+vh-8);
    }
    // header + status
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    const _trk = (world.gndLock && !world.gndLock.destroyed && world.gndLock.spd!==undefined);
    ctx.fillText('TGP '+(desig?(gimbal?'GMBL':(_trk?'TRK':(m.tgpTrack==='POINT'?'PT':'AREA'))):'STBY'), 6, 14);
    ctx.textAlign='right'; ctx.font='9px "Courier New"';
    ctx.fillText('Z'+(m.tgpZoom||2)+' '+(TGP_FOV[m.tgpZoom||2]||5)+'\u00b0  '+(whot?'WHOT':'BHOT'), W-6, 14);
    const _aim=tgpAimPoint();
    const sr=distTo(_aim.x,_aim.y)/NM;
    const horiz=distTo(_aim.x,_aim.y), dep=Math.atan2(world.ac.pos.z-_aim.z, Math.max(1,horiz))*180/Math.PI;
    ctx.font='9px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('SR '+sr.toFixed(1)+'NM  DEP '+dep.toFixed(0)+'\u00b0',6,H-12);
    ctx.textAlign='center'; ctx.fillStyle=(_aim.name==='TGT DESTROYED')?C_RED:(_aim.dom==='AIR'?C_YEL:C_GREEN);
    ctx.fillText(_aim.name,W/2,H-12);
    ctx.textAlign='right'; ctx.fillStyle=m.laser?C_RED:C_DIM;
    ctx.fillText(m.laser?'LZR 1688 \u25cf':'LZR 1688',W-6,H-12);
  }
};



/* ---------- LANTIRN : forward-looking low-level FLIR/TV terrain page ---------- */
PAGES.LANT={
  render(m,ctx){
    const ac=world.ac, W=m.W, H=m.H;
    // Full-bleed sensor window inside the MFD glass.  Keep only a tiny CRT edge
    // for labels so the terrain picture cannot appear as a narrow clipped slab.
    const x0=5, y0=22, VW=W-10, VH=H-42;
    const cx=x0+VW/2, cy=y0+VH*0.52;
    const rangeNM=m.lantRange||10, far=Math.max(2200, rangeNM*NM), near=45;
    const mode=m.lantFov||'WIDE';
    const hfov=(mode==='NAR'?46:68)*DEG, vfov=(mode==='NAR'?28:42)*DEG;
    const b=acBasis(ac);
    const dip=(mode==='NAR'?8:12)*DEG;
    const eye={x:ac.pos.x+b.fwd.x*5, y:ac.pos.y+b.fwd.y*5, z:Math.max(8,ac.pos.z-1.0)};
    let fwd=vnorm(vadd(vscale(b.fwd,Math.cos(dip)), vscale(b.up,-Math.sin(dip))));
    // Roll-stabilized camera axes: the page behaves like a sensor video, not a
    // terrain mesh pasted onto a vertical clipping plane.
    let right=vcross(fwd,{x:0,y:0,z:1});
    if(vlen(right)<1e-3) right={x:Math.cos(ac.psi),y:-Math.sin(ac.psi),z:0};
    right=vnorm(right);
    const up=vnorm(vcross(right,fwd));
    const tanH=Math.tan(hfov/2), tanV=Math.tan(vfov/2);
    const green=(v,a)=>{ const k=clamp(v,0,1), aa=(a==null?1:a); const r=Math.round(10+82*k), g=Math.round(48+215*k), bb=Math.round(8+78*k); return 'rgba('+r+','+g+','+bb+','+aa.toFixed(3)+')'; };
    const makeRay=(sx,sy)=>{
      const u=((sx-x0)/VW)*2-1;
      const v=1-((sy-y0)/VH)*2;
      return vnorm(vadd(vadd(fwd,vscale(right,u*tanH)),vscale(up,v*tanV)));
    };
    const proj=(P)=>{ const r=vsub(P,eye), cz=vdot(r,fwd); if(cz<=3) return null; const px=cx+(vdot(r,right)/cz/tanH)*VW/2, py=cy-(vdot(r,up)/cz/tanV)*VH/2; return {x:px,y:py,z:cz}; };
    // Allow generous overscan for projected overlays. The video image itself is
    // always filled by ray-cast cells; this only prevents reference lines from
    // being chopped at the edge of the sensor picture.
    const inFrame=p=>!!p && p.x>=x0-110 && p.x<=x0+VW+110 && p.y>=y0-80 && p.y<=y0+VH+80;
    const intersectTerrain=(ray)=>{
      let lastS=near, lastZ=eye.z+ray.z*lastS-terrainH(eye.x+ray.x*lastS,eye.y+ray.y*lastS);
      for(let s=near+70; s<=far; s+=clamp(s*0.052,70,480)){
        const x=eye.x+ray.x*s, y=eye.y+ray.y*s, z=eye.z+ray.z*s;
        const dz=z-terrainH(x,y);
        if(dz<=0){
          let lo=lastS, hi=s;
          for(let k=0;k<6;k++){
            const mid=(lo+hi)*0.5, mx=eye.x+ray.x*mid, my=eye.y+ray.y*mid, mz=eye.z+ray.z*mid;
            if(mz-terrainH(mx,my)>0) lo=mid; else hi=mid;
          }
          const hitS=hi, hx=eye.x+ray.x*hitS, hy=eye.y+ray.y*hitS;
          return {x:hx,y:hy,z:terrainH(hx,hy),d:hitS};
        }
        lastS=s; lastZ=dz;
      }
      return null;
    };
    const terrainLum=(hit,ray,cellJ,rows)=>{
      const ds=260, h=hit.z;
      const hx=terrainH(hit.x+ds,hit.y)-terrainH(hit.x-ds,hit.y);
      const hy=terrainH(hit.x,hit.y+ds)-terrainH(hit.x,hit.y-ds);
      const slope=clamp(Math.hypot(hx,hy)/1350,0,1);
      const relief=clamp(h/Math.max(1,TERRAIN_PEAK),0,1);
      const n=vnorm({x:-hx/(ds*2),y:-hy/(ds*2),z:1});
      const face=clamp(vdot(n,vscale(ray,-1)),0,1);
      const rangeFade=1-clamp(hit.d/far,0,1)*0.18;
      const sweep=Math.max(0,1-Math.abs(((world.t*0.38)%1)-cellJ/rows)*8)*0.075;
      return clamp((0.11 + relief*0.24 + slope*0.30 + face*0.30)*rangeFade + sweep,0.055,0.98);
    };
    const drawPolyLine=(pts,col,width)=>{
      if(!pts||pts.length<2) return;
      ctx.strokeStyle=col; ctx.lineWidth=width||1; ctx.beginPath(); let started=false;
      for(const pt of pts){ const p=proj({x:pt.x,y:pt.y,z:(pt.z!=null?pt.z:terrainH(pt.x,pt.y))+4});
        if(!inFrame(p)){ started=false; continue; }
        if(!started){ ctx.moveTo(p.x,p.y); started=true; } else ctx.lineTo(p.x,p.y);
      }
      if(started) ctx.stroke();
    };

    ctx.fillStyle='#001106'; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.beginPath(); ctx.rect(x0,y0,VW,VH); ctx.clip();
    const bg=ctx.createLinearGradient(0,y0,0,y0+VH);
    bg.addColorStop(0,'rgba(2,31,11,0.96)'); bg.addColorStop(0.5,'rgba(2,21,8,0.98)'); bg.addColorStop(1,'rgba(0,11,4,1)');
    ctx.fillStyle=bg; ctx.fillRect(x0,y0,VW,VH);

    // Ray-cast the video image cell-by-cell. Every MFD cell receives either a
    // terrain hit or a horizon fill, so the forward-looking camera cannot form
    // trapezoid side gaps or black clipped wedges when the aircraft pitches,
    // banks, or flies close to terrain.
    const NX=82, NY=66, cw=VW/NX, ch=VH/NY;
    for(let j=0;j<NY;j++) for(let i=0;i<NX;i++){
      const sx=x0+(i+0.5)*cw, sy=y0+(j+0.5)*ch, ray=makeRay(sx,sy);
      const hit=intersectTerrain(ray);
      if(hit){
        const noise=((((i*19+j*37+Math.floor(world.t*11))&15)/15)-0.5)*0.035;
        ctx.fillStyle=green(clamp(terrainLum(hit,ray,j,NY)+noise,0.05,1),1.00);
      } else {
        // No terrain hit: real forward video sky/deep horizon, not an empty gap.
        const sky=0.08 + (1-j/NY)*0.10;
        ctx.fillStyle=green(sky,0.92);
      }
      // Slight overlap between cells eliminates sub-pixel cracks from browser
      // scaling/zoom without changing the sensor geometry.
      ctx.fillRect(x0+i*cw-0.65, y0+j*ch-0.65, cw+1.9, ch+1.9);
    }

    // Dry valley/channel reference and man-made features remain overlaid, but
    // they are projected through the same camera instead of forcing mesh edges.
    if(typeof _riverCenterX==='function'){
      const pts=[];
      const hdgF={x:Math.sin(ac.psi),y:Math.cos(ac.psi)};
      for(let d=400; d<=far*1.05; d+=300){ const yy=eye.y+hdgF.y*d, xx=_riverCenterX(yy); pts.push({x:xx,y:yy,z:terrainH(xx,yy)+3}); }
      drawPolyLine(pts,'rgba(85,255,145,0.34)',1.2);
    }
    const inf=(world&&world.infrastructure)||{};
    for(const rd of (inf.roads||[])) drawPolyLine((rd.pts||[]).map(p=>({x:p.x,y:p.y,z:terrainH(p.x,p.y)+2})),'rgba(210,255,185,0.40)',1.0);
    for(const pl of (inf.powerlines||[])) drawPolyLine([{x:pl.a.x,y:pl.a.y,z:terrainH(pl.a.x,pl.a.y)+18},{x:pl.b.x,y:pl.b.y,z:terrainH(pl.b.x,pl.b.y)+18}],'rgba(200,255,170,0.20)',0.8);
    for(const br of (inf.bridges||[])){
      const len=br.len||420, hd=br.hdg||0, si=Math.sin(hd), co=Math.cos(hd);
      drawPolyLine([{x:br.x-si*len/2,y:br.y-co*len/2,z:terrainH(br.x-si*len/2,br.y-co*len/2)+6},{x:br.x+si*len/2,y:br.y+co*len/2,z:terrainH(br.x+si*len/2,br.y+co*len/2)+6}],'rgba(235,255,200,0.52)',1.3);
    }

    const markTarget=(obj,label,col)=>{ if(!obj||obj.destroyed) return; const p=proj({x:obj.x,y:obj.y,z:terrainH(obj.x,obj.y)+8}); if(!inFrame(p)) return; ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.strokeRect(p.x-6,p.y-6,12,12); ctx.fillStyle=col; ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText(label,p.x+8,p.y+2); };
    if(world.gndLock && !world.gndLock.destroyed) markTarget(world.gndLock,'DESIG',C_HOT);
    else { const gm=world.groundMovers.find(g=>!g.destroyed&&!g.underground&&distTo(g.x,g.y)<far*0.95); if(gm) markTarget(gm, gm.kind==='TEL'?'TEL':'MOVE', C_ORG); }

    const scanY=y0 + (((world.t*0.42)%1)*VH);
    ctx.strokeStyle='rgba(120,255,150,0.18)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x0,scanY); ctx.lineTo(x0+VW,scanY); ctx.stroke();
    ctx.strokeStyle='rgba(120,255,150,0.055)'; ctx.beginPath(); ctx.moveTo(cx,y0); ctx.lineTo(cx,y0+VH); ctx.stroke();
    ctx.restore();

    ctx.strokeStyle=C_GREEN; ctx.lineWidth=1; ctx.strokeRect(x0,y0,VW,VH);
    const hs=12, hg=5, hcy=y0+VH*0.59;
    ctx.strokeStyle=C_HOT; ctx.lineWidth=1.1; ctx.beginPath(); ctx.moveTo(cx-hs,hcy); ctx.lineTo(cx-hg,hcy); ctx.moveTo(cx+hg,hcy); ctx.lineTo(cx+hs,hcy); ctx.moveTo(cx,hcy-hs); ctx.lineTo(cx,hcy-hg); ctx.moveTo(cx,hcy+hg); ctx.lineTo(cx,hcy+hs); ctx.stroke();
    ctx.strokeStyle='rgba(168,255,192,0.70)'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(cx, y0+VH-22); ctx.lineTo(cx-9,y0+VH-8); ctx.lineTo(cx,y0+VH-12); ctx.lineTo(cx+9,y0+VH-8); ctx.stroke();

    const agl=Math.max(0, ac.pos.z-terrainH(ac.pos.x,ac.pos.y));
    const hdg=((ac.psi*RAD)%360+360)%360;
    ctx.fillStyle=C_GREEN; ctx.font='bold 10px "Courier New"'; ctx.textAlign='left'; ctx.fillText('LANTIRN FLIR', 6, 14);
    ctx.textAlign='right'; ctx.fillText('R'+rangeNM+'  '+mode, W-6, 14);
    ctx.textAlign='center'; ctx.font='8px "Courier New"'; ctx.fillText('FORWARD RAYCAST NAV VIDEO', W/2, y0-6);
    ctx.textAlign='left'; ctx.fillText('HDG '+String(Math.round(hdg)).padStart(3,'0')+'  AGL '+Math.round(agl)+'M', x0, H-12);
    ctx.textAlign='right'; ctx.fillText('DIP '+Math.round(dip*RAD)+'°  LLTV', x0+VW, H-12);
  }
};

/* ---------- DED : up-front controls / data entry (was the ICP) ---------- */
let DED_PAGE = 'CNI';     // CNI | STPT | BIT | TUNE
function dHdg(rad){ let d=(wrap2pi(rad)*180/Math.PI); d=((d%360)+360)%360; return String(Math.round(d)).padStart(3,'0'); }
function dNum(n,w){ return String(Math.round(n)).padStart(w,'0'); }
function dlFmt(e){ e=String(e||''); return e.length<=3 ? e : e.slice(0,3)+'.'+e.slice(3,6); }

PAGES.DED={
  render(m,ctx){
    const W=m.W,H=m.H,ac=world.ac;
    ctx.fillStyle=C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText('DED \u2217'+DED_PAGE+'\u2217', 6, 14);
    ctx.strokeStyle=C_DIM; ctx.beginPath(); ctx.moveTo(8,20); ctx.lineTo(W-8,20); ctx.stroke();
    if (DED_PAGE==='TUNE'){                       // touch keypad for the datalink frequency
      const pad=10, top=26;
      const sx=pad, sy=top, sw=W-2*pad, sh=24;
      ctx.strokeStyle=C_GREEN; ctx.lineWidth=1; ctx.strokeRect(sx,sy,sw,sh);
      ctx.fillStyle=C_HOT; ctx.font='bold 15px "Courier New"'; ctx.textAlign='left';
      ctx.fillText(world.dlEntry?dlFmt(world.dlEntry):'___.__', sx+8, sy+17);
      ctx.fillStyle=C_DIM; ctx.font='8px "Courier New"'; ctx.textAlign='right';
      ctx.fillText('DL FREQ', sx+sw-6, sy+10);
      const gy=sy+sh+16, gh=H-pad-gy, cols=5, rows=4, cw=(W-2*pad)/cols, rh=gh/rows;
      ctx.fillStyle=C_DIM; ctx.font='8px "Courier New"'; ctx.textAlign='left';
      ctx.fillText('E3 '+DL_CHANNELS[0].freq+'  E2 '+DL_CHANNELS[1].freq+'   TUNED '+(world.datalinkTuned||'---'), pad, gy-3);
      const keys=[];
      const commit=()=>{ if((world.dlEntry||'').length>=4){ world.datalinkTuned=dlFmt(world.dlEntry); banner('DL FREQ '+world.datalinkTuned,1.4); } };
      const dig=d=>()=>{ if((world.dlEntry||'').length<6) world.dlEntry=(world.dlEntry||'')+d; };
      const place=(c,r,label,act,hot)=>{ const bx=pad+c*cw+2, by=gy+r*rh+2, bw=cw-4, bh=rh-4;
        keys.push({x:bx,y:by,w:bw,h:bh,act});
        ctx.strokeStyle=hot?C_HOT:C_GREEN; ctx.lineWidth=hot?2:1; ctx.strokeRect(bx,by,bw,bh);
        ctx.fillStyle=hot?C_HOT:C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='center';
        ctx.fillText(label, bx+bw/2, by+bh/2+4); };
      const numRows=[['1','2','3'],['4','5','6'],['7','8','9'],['CLR','0','ENT']];
      for(let r=0;r<4;r++) for(let c=0;c<3;c++){ const lab=numRows[r][c];
        if(lab==='CLR') place(c,r,'CLR',()=>{ world.dlEntry=''; });
        else if(lab==='ENT') place(c,r,'ENT',commit,true);
        else place(c,r,lab,dig(lab)); }
      place(3,0,'GSPD',()=>{});  place(4,0,'CH M',()=>{ const cur=dlFmt(world.dlEntry);
        const idx=DL_CHANNELS.findIndex(c=>c.freq===cur); const nx=DL_CHANNELS[(idx+1)%DL_CHANNELS.length];
        world.dlEntry=nx.freq.replace('.',''); });
      place(3,1,'TGT',()=>{});   place(4,1,'TOT',()=>{});
      place(3,2,'INSERT',commit,true); place(4,2,'DELETE',()=>{ world.dlEntry=(world.dlEntry||'').slice(0,-1); });
      place(3,3,'GRID',()=>{});  place(4,3,'CNI',()=>{ DED_PAGE='CNI'; });
      m._dedKeys=keys;
      return;
    }
    ctx.font='12px "Courier New"';
    const x0=14, x1=W*0.54, y0=40, lh=22;
    const row=(i,a,b,c,d)=>{ const y=y0+i*lh;
      ctx.textAlign='left';
      ctx.fillStyle=C_DIM;   ctx.fillText(a,x0,y);
      ctx.fillStyle=C_GREEN; ctx.fillText(b,x0+58,y);
      if(c){ ctx.fillStyle=C_DIM;   ctx.fillText(c,x1,y); }
      if(d){ ctx.fillStyle=C_GREEN; ctx.fillText(d,x1+58,y); }
    };
    if (DED_PAGE==='CNI'){
      row(0,'UHF','305.00','STPT',dNum(world.steerpoint,2));
      row(1,'VHF','127.50','MODE',world.masterMode);
      row(2,'HDG',dHdg(ac.psi),'CAS',dNum(ac.tas*KT,3));
      row(3,'ALT',dNum(ac.pos.z*FT,5),'',''); 
      ctx.fillStyle = world.masterArm==='ARM'?C_RED:world.masterArm==='SIM'?C_YEL:C_GREEN;
      ctx.textAlign='left'; ctx.fillText('ARM', x1, y0+3*lh); ctx.fillText(world.masterArm, x1+58, y0+3*lh);
      row(4,'TIME',fmtMMSS(world.t),'G',ac.g.toFixed(1));
    } else if (DED_PAGE==='STPT'){
      const wp=curWP();
      const brg=bearingTo(wp.x,wp.y)*180/Math.PI;
      const dnm=distTo(wp.x,wp.y)/NM;
      const ete=ac.tas>20?distTo(wp.x,wp.y)/ac.tas:0;
      row(0,'STPT',dNum(world.steerpoint,2)+' '+wp.name,'','');
      row(1,'BRG',dNum(((brg%360)+360)%360,3)+'\u00b0','','');
      row(2,'RNG',dnm.toFixed(1)+' NM','','');
      row(3,'ETE',fmtMMSS(ete),'','');
      row(4,'ELEV',dNum(wp.alt||0,5)+'FT','','');
      ctx.fillStyle=C_DIM; ctx.textAlign='center'; ctx.font='9px "Courier New"';
      ctx.fillText('\u25b2/\u25bc OSB to change steerpoint', W/2, H-26);
    } else { // BIT (system + mission)
      ctx.font='9px "Courier New"';
      const rows=Math.ceil(world.bit.length/2), colW=(W-20)/2;
      for (let i=0;i<world.bit.length;i++){ const r=i%rows,c=(i/rows|0);
        const x=12+c*colW, y=30+r*13, it=world.bit[i];
        ctx.fillStyle=C_GREEN; ctx.textAlign='left'; ctx.fillText(it.name,x,y);
        ctx.fillStyle=it.s==='GO'?C_GREEN:C_RED; ctx.textAlign='right'; ctx.fillText(it.s,x+colW-10,y); }
      const my=30+rows*13+10;
      ctx.fillStyle=C_HOT; ctx.font='bold 9px "Courier New"'; ctx.textAlign='left'; ctx.fillText('MISSION',12,my);
      ctx.strokeStyle=C_HOT; ctx.beginPath(); ctx.moveTo(8,my+3); ctx.lineTo(W-8,my+3); ctx.stroke();
      const lines=[['MSN','STRIKE-074'],['CALL','VIPER 11'],['DEP','KEDW'],
        ['TGT',world.target.destroyed?'DESTROYED':'ACTIVE'],['ARM',world.masterArm],
        ['MODE',world.masterMode],['STPT',String(world.steerpoint)],['INTEG',Math.round(ac.integrity)+'%']];
      ctx.fillStyle=C_GREEN; ctx.font='9px "Courier New"';
      for (let i=0;i<lines.length;i++){ const r=i%4,c=(i/4|0), x=12+c*(W/2-12), y=my+16+r*13;
        ctx.textAlign='left'; ctx.fillText(lines[i][0],x,y); ctx.fillText(lines[i][1],x+50,y); }
    }
  }
};

/* ---------- DATALINK : a sensor whose data comes from the E-3 / E-2 ---------- */
PAGES.DLNK={
  render(m,ctx){
    const ac=world.ac, W=m.W, H=m.H;
    const src=datalinkSource(); const live=!!src;
    ctx.fillStyle=live?'#5bd6ff':C_GREEN; ctx.font='bold 11px "Courier New"'; ctx.textAlign='left';
    ctx.fillText(live ? (src.tag+'-DATALINK') : 'DATALINK', 6,14);
    ctx.textAlign='right'; ctx.fillStyle=live?'#5bd6ff':C_RED; ctx.fillText(live?'LINK UP':'NO LINK', W-6,14);
    if (!live){
      ctx.fillStyle=C_DIM; ctx.textAlign='center'; ctx.font='12px "Courier New"';
      ctx.fillText('NO DATALINK', W/2, 60);
      ctx.font='9px "Courier New"'; ctx.fillText('TUNE A CHANNEL ON THE DED (CH M)', W/2, 80);
      let yy=104;
      for (const ch of DL_CHANNELS){
        let dr=Infinity;
        for (const f of world.friendlies){ if(f.alive && f.tag===ch.tag){ dr=Math.min(dr, Math.hypot(f.x-ac.pos.x,f.y-ac.pos.y)); } }
        const airborne=isFinite(dr);
        ctx.fillStyle = (world.datalinkTuned===ch.freq)?'#ffd24d':(airborne?'#5bd6ff':C_DIM);
        const rngTxt = airborne ? ((dr/NM).toFixed(0)+'NM'+(dr<60000?'':' OUT')) : 'OFF STATION';
        ctx.fillText(ch.tag+'  '+ch.type+'   '+ch.freq+'   '+rngTxt, W/2, yy); yy+=16;
      }
      ctx.fillStyle=C_DIM; ctx.fillText('TUNED  '+(world.datalinkTuned||'---'), W/2, yy+8);
      ctx.font='8px "Courier New"'; ctx.fillText('B1 \u2192 DED TUNE KEYPAD', W/2, H-12);
      return;
    }
    // north-up link picture, wider than own sensors (the AWACS sees it all)
    const cx=W/2, cy=H*0.44, Rpx=Math.min(W,H)*0.38, rng=(m.dlRange||80), scale=Rpx/rng;
    const toXY=(wx,wy)=>{ const dx=(wx-ac.pos.x)/NM, dy=(wy-ac.pos.y)/NM; return {x:cx+dx*scale, y:cy-dy*scale, d:Math.hypot(dx,dy)}; };
    ctx.strokeStyle=C_DIM; ctx.lineWidth=1; for(let i=1;i<=2;i++){ ctx.beginPath(); ctx.arc(cx,cy,Rpx*i/2,0,2*Math.PI); ctx.stroke(); }
    ctx.fillStyle=C_DIM; ctx.font='8px "Courier New"'; ctx.textAlign='left';
    ctx.fillText((rng/2|0)+'', cx+3, cy-Rpx/2+9); ctx.fillText(rng+'', cx+3, cy-Rpx+9);
    ctx.textAlign='center'; ctx.fillText('N',cx,cy-Rpx-2);
    // emitters (rings) from the link
    for(const th of world.threats){ if(th.destroyed||!th.live)continue; const p=toXY(th.x,th.y); if(p.d>rng)continue;
      ctx.strokeStyle='rgba(91,214,255,0.55)'; ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(3,th.radius/NM*scale),0,2*Math.PI); ctx.stroke();
      ctx.fillStyle='#5bd6ff'; ctx.fillRect(p.x-2,p.y-2,4,4); }
    // ground movers / TELs
    for(const gm of world.groundMovers){ if(gm.destroyed||gm.underground)continue; const p=toXY(gm.x,gm.y); if(p.d>rng)continue;
      ctx.fillStyle=gm.kind==='TEL'?'#ff7a4d':'#ffd9a8'; ctx.fillRect(p.x-2,p.y-2,4,4); }
    // underground facilities
    for(const st of world.structures){ if(st.destroyed)continue; const p=toXY(st.x,st.y); if(p.d>rng)continue;
      ctx.strokeStyle=st.hostile?C_RED:'#7fe0ff'; ctx.beginPath(); ctx.moveTo(p.x,p.y-4);ctx.lineTo(p.x+4,p.y);ctx.lineTo(p.x,p.y+4);ctx.lineTo(p.x-4,p.y);ctx.closePath(); ctx.stroke(); }
    // HVTs
    for(const v of world.hvts){ if(v.destroyed)continue; const p=toXY(v.x,v.y); if(p.d>rng)continue;
      ctx.strokeStyle=C_RED; ctx.lineWidth=1.2; ctx.strokeRect(p.x-3,p.y-3,6,6); }
    // bandits
    for(const bd of world.bandits){ if(bd.hp<=0)continue; const p=toXY(bd.x,bd.y); if(p.d>rng)continue;
      ctx.strokeStyle=bd.kind==='HOSTILE'?C_RED:C_YEL; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.x-4,p.y+3);ctx.lineTo(p.x,p.y-4);ctx.lineTo(p.x+4,p.y+3); ctx.stroke(); }
    // strike target + bullseye + waypoints
    if(!world.target.destroyed){ const p=toXY(world.target.x,world.target.y);
      ctx.strokeStyle=C_YEL; ctx.lineWidth=1.3; ctx.beginPath(); ctx.arc(p.x,p.y,6,0,2*Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x-8,p.y);ctx.lineTo(p.x+8,p.y);ctx.moveTo(p.x,p.y-8);ctx.lineTo(p.x,p.y+8); ctx.stroke(); }
    { const p=toXY(world.bullseye.x,world.bullseye.y); ctx.strokeStyle=C_DIM;
      ctx.beginPath(); ctx.arc(p.x,p.y,5,0,2*Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x,p.y,1.5,0,2*Math.PI); ctx.stroke(); }
    // ownship + the source AWACS
    ctx.strokeStyle=C_HOT; ctx.lineWidth=1.3; ctx.beginPath(); ctx.moveTo(cx,cy-6);ctx.lineTo(cx+4,cy+5);ctx.lineTo(cx,cy+2);ctx.lineTo(cx-4,cy+5);ctx.closePath(); ctx.stroke();
    if(src){ const p=toXY(src.x,src.y); if(p.d<=rng){ ctx.fillStyle='#5bd6ff'; ctx.beginPath(); ctx.arc(p.x,p.y,4,0,2*Math.PI); ctx.fill();
      ctx.font='7px "Courier New"'; ctx.textAlign='left'; ctx.fillText(src.tag+' '+src.type,p.x+6,p.y+2); } }
    // data readout (targeting / counts), sourced from the link
    ctx.textAlign='left'; ctx.font='8px "Courier New"'; ctx.fillStyle='#5bd6ff';
    const aim=tgpAimPoint();
    const brg=((bearingTo(aim.x,aim.y)*180/Math.PI%360)+360)%360, rn=distTo(aim.x,aim.y)/NM;
    const nb=world.bandits.filter(b=>b.hp>0).length;
    const ne=world.threats.filter(t=>!t.destroyed&&t.live).length;
    const ng=world.groundMovers.filter(g=>!g.destroyed&&!g.underground).length;
    const bb=((bearingTo(world.bullseye.x,world.bullseye.y)*180/Math.PI%360)+360)%360;
    let yy=H-44;
    ctx.fillText('SRC '+(src?(src.tag+' '+src.type+'  '+src.freq):'-'), 8, yy); yy+=11;
    ctx.fillText('TGT BRG '+String(Math.round(brg)).padStart(3,'0')+'\u00b0 RNG '+rn.toFixed(1)+'NM  '+aim.name, 8, yy); yy+=11;
    ctx.fillText('AIR '+nb+'   EMITTERS '+ne+'   GMT '+ng, 8, yy); yy+=11;
    ctx.fillText('BULLS '+String(Math.round(bb)).padStart(3,'0')+'\u00b0 '+(distTo(world.bullseye.x,world.bullseye.y)/NM).toFixed(0)+'NM', 8, yy);
    ctx.textAlign='right'; ctx.fillText((m.dlRange||80)+'NM', W-6, H-12);
  }
};

/* ---------- store/mode helpers ---------- */
function selectStation(id){
  const st=(world.stations||[]).find(s=>s.id===id);
  if (!st || (typeof isWeaponStation==='function' ? !isWeaponStation(st) : (st.kind==='pod'||st.kind==='tank'))){
    if (st && st.kind==='pod') banner('TGP IS A SENSOR — USE TGP PAGE', 1.1);
    return;
  }
  world.selectedStation=id; world.stations.forEach(s=>s.sel=(s.id===id));
  if (window.ReplayRecorder) ReplayRecorder.recordEvent('selection_changed', { field:'station', value:id });
  refreshAllMfd();
}
function cycleArm(){ world.masterArm = world.masterArm==='SAFE'?'ARM':world.masterArm==='ARM'?'SIM':'SAFE'; if (window.ReplayRecorder) ReplayRecorder.recordEvent('selection_changed', { field:'masterArm', value:world.masterArm }); refreshAllMfd(); banner('M-ARM '+world.masterArm,1); }
function cycleMode(){ const M=['NAV','A-A','A-G','DGFT']; world.masterMode=M[(M.indexOf(world.masterMode)+1)%M.length]; if (window.ReplayRecorder) ReplayRecorder.recordEvent('selection_changed', { field:'masterMode', value:world.masterMode }); refreshAllMfd(); banner(world.masterMode,1); }
