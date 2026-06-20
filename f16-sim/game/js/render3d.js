/* =====================================================================
   3D WIREFRAME RENDERER  —  out-the-window view
   Software projection on a 2D canvas. Green-line landscape, polygon objects.
   ===================================================================== */

const NEON   = '#27ff5e';
const NEONHI = '#a8ffc0';
const SKY_T  = '#03130c';
const SKY_B  = '#072c17';
const GND_T  = '#02160b';
const GND_B  = '#010a05';

class R3 {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }
  resize(){
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    const fovX = 88 * DEG;            // wide field of view — see much more of the world
    this.f = (this.W/2) / Math.tan(fovX/2);
  }
  setCamera(ac){
    // eye point: slightly above CG, a touch forward (pilot seat)
    const b = acBasis(ac);
    this.basis = b;
    this.cam = vadd(ac.pos, vadd(vscale(b.up, 2.0), vscale(b.fwd, 2.5)));
    this.cam.z += 0; // already in pos.z
  }
  // world -> camera space
  toCam(p){
    const r = vsub(p, this.cam);
    return { cx: vdot(r,this.basis.right), cy: vdot(r,this.basis.up), cz: vdot(r,this.basis.fwd) };
  }
  // camera space -> screen
  proj(c){
    return { x: this.W/2 + this.f*c.cx/c.cz, y: this.H/2 - this.f*c.cy/c.cz, z: c.cz };
  }
  // project a single world point (null if behind near plane)
  project(p){
    const c = this.toCam(p);
    if (c.cz < 1.0) return null;
    return this.proj(c);
  }
  // Terrain-aware visibility for outside-world overlays.  HSD/MFD pages can
  // still show tactical symbols, but the out-the-window view should not draw
  // SAM rings or ground target labels through mountains.
  visibleLOS(p, margin=45){
    const c = this.project(p);
    if (!c || c.z < 1) return null;
    if (typeof terrainLineClear === 'function' && !terrainLineClear(this.cam.x,this.cam.y,this.cam.z,p.x,p.y,p.z,margin)) return null;
    return c;
  }
  groundOverlayVisible(x,y,height=55){
    const z = terrainH(x,y);
    const top = {x,y,z:z+height};
    const c = this.project(top);
    if (!c || c.z < 1) return false;
    const d = Math.hypot(x-this.cam.x, y-this.cam.y);
    const ownAgl = this.cam.z - terrainH(this.cam.x,this.cam.y);
    const maxD = ownAgl < 1500 ? 14000 : ownAgl < 2500 ? 22000 : 38000;
    if (d > maxD) return false;
    if (typeof terrainLineClear !== 'function') return true;
    return terrainLineClear(this.cam.x,this.cam.y,this.cam.z,top.x,top.y,top.z,40);
  }
  visibleGroundSeg(A,B,height=70){
    if (typeof terrainLineClear !== 'function') return true;
    const At={x:A.x,y:A.y,z:terrainH(A.x,A.y)+height};
    const Bt={x:B.x,y:B.y,z:terrainH(B.x,B.y)+height};
    return !!(this.project(At) && this.project(Bt) &&
      terrainLineClear(this.cam.x,this.cam.y,this.cam.z,At.x,At.y,At.z,45) &&
      terrainLineClear(this.cam.x,this.cam.y,this.cam.z,Bt.x,Bt.y,Bt.z,45));
  }
  // clip a camera-space segment to cz>=near, return [A,B] screen or null
  clip(ca, cb){
    const near = 1.0;
    let a = ca, b = cb;
    if (a.cz < near && b.cz < near) return null;
    if (a.cz < near){
      const t = (near - a.cz) / (b.cz - a.cz);
      a = { cx: lerp(a.cx,b.cx,t), cy: lerp(a.cy,b.cy,t), cz: near };
    } else if (b.cz < near){
      const t = (near - b.cz) / (a.cz - b.cz);
      b = { cx: lerp(b.cx,a.cx,t), cy: lerp(b.cy,a.cy,t), cz: near };
    }
    return [this.proj(a), this.proj(b)];
  }
  // add a world segment to the current path (caller does begin/stroke)
  seg(A, B){
    const r = this.clip(this.toCam(A), this.toCam(B));
    if (!r) return;
    this.ctx.moveTo(r[0].x, r[0].y);
    this.ctx.lineTo(r[1].x, r[1].y);
  }

  /* ---------------- sky + ground fill with tilting horizon ---------------- */
  drawSky(){
    const ctx = this.ctx, W=this.W, H=this.H, f=this.f;
    const rz = this.basis.right.z, uz = this.basis.up.z, fz = this.basis.fwd.z;
    // horizon line: cx*rz + cy*uz + f*fz = 0  -> cy = -(cx*rz + f*fz)/uz
    const sky = ctx.createLinearGradient(0,0,0,H);
    sky.addColorStop(0, SKY_T); sky.addColorStop(1, SKY_B);
    const gnd = ctx.createLinearGradient(0,0,0,H);
    gnd.addColorStop(0, GND_T); gnd.addColorStop(1, GND_B);

    if (Math.abs(uz) < 1e-3){
      // near-90° bank: split vertically
      ctx.fillStyle = sky; ctx.fillRect(0,0,W,H);
      return;
    }
    const yAt = (sx)=>{
      const cx = sx - W/2;
      const cy = -(cx*rz + f*fz)/uz;
      return H/2 - cy;
    };
    let yL = yAt(0), yR = yAt(W);
    const groundBelow = uz > 0; // up vector tilts: which side is ground
    // sky polygon
    ctx.fillStyle = sky;
    ctx.beginPath();
    if (groundBelow){
      ctx.moveTo(0,-2); ctx.lineTo(W,-2); ctx.lineTo(W,yR); ctx.lineTo(0,yL);
    } else {
      ctx.moveTo(0,H+2); ctx.lineTo(W,H+2); ctx.lineTo(W,yR); ctx.lineTo(0,yL);
    }
    ctx.closePath(); ctx.fill();
    // ground polygon
    ctx.fillStyle = gnd;
    ctx.beginPath();
    if (groundBelow){
      ctx.moveTo(0,H+2); ctx.lineTo(W,H+2); ctx.lineTo(W,yR); ctx.lineTo(0,yL);
    } else {
      ctx.moveTo(0,-2); ctx.lineTo(W,-2); ctx.lineTo(W,yR); ctx.lineTo(0,yL);
    }
    ctx.closePath(); ctx.fill();
    // faint stars, fixed on the celestial sphere (kept above the horizon)
    this._drawStars(yAt);
  }
  _ensureStars(){
    if (this._stars) return this._stars;
    const s=[]; let seed=1337;
    const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
    for (let i=0;i<90;i++){
      const az=rnd()*Math.PI*2, el=(7+rnd()*75)*Math.PI/180, ce=Math.cos(el);
      s.push({ x:Math.sin(az)*ce, y:Math.cos(az)*ce, z:Math.sin(el), b:0.2+rnd()*0.7 });
    }
    return this._stars=s;
  }
  _drawStars(yAt){
    const ctx=this.ctx, W=this.W, H=this.H, f=this.f, b=this.basis;
    for (const st of this._ensureStars()){
      const fc = st.x*b.fwd.x + st.y*b.fwd.y + st.z*b.fwd.z;
      if (fc <= 0.03) continue;                         // behind us
      const rc = st.x*b.right.x + st.y*b.right.y + st.z*b.right.z;
      const uc = st.x*b.up.x + st.y*b.up.y + st.z*b.up.z;
      const sx = W/2 + f*rc/fc, sy = H/2 - f*uc/fc;
      if (sx<0||sx>W||sy<0||sy>H) continue;
      if (sy > yAt(sx)-2) continue;                     // only in the sky, above the horizon
      ctx.globalAlpha = st.b*0.6;
      ctx.fillStyle = '#bfe6d2';
      const r = st.b>0.72 ? 1.5 : 1.0;
      ctx.fillRect(sx, sy, r, r);
    }
    ctx.globalAlpha = 1;
  }
  /* faint atmospheric glow band along the (tilting) horizon */
  drawHaze(){
    const ctx=this.ctx, W=this.W, H=this.H, f=this.f;
    const rz=this.basis.right.z, uz=this.basis.up.z, fz=this.basis.fwd.z;
    if (Math.abs(uz) < 1e-3) return;
    const yAt=(sx)=>{ const cx=sx-W/2; return H/2 - (-(cx*rz + f*fz)/uz); };
    const yL=yAt(0), yR=yAt(W);
    for (const band of [[64,0.035],[34,0.045],[14,0.06]]){
      const hh=band[0];
      ctx.fillStyle='rgba(86,178,138,'+band[1]+')';
      ctx.beginPath();
      ctx.moveTo(0,yL-hh); ctx.lineTo(W,yR-hh); ctx.lineTo(W,yR+hh); ctx.lineTo(0,yL+hh);
      ctx.closePath(); ctx.fill();
    }
  }
  // One recentered, cached grid ring. Painted far->near for occlusion. The coarse
  // distant ring blends toward the haze so faraway land fades in instead of being
  // a hard wall; the fine near ring is crisp and overpaints the coarse in overlap.
  _terrainRing(ac, step, R, key, nearClip, farClip, coarse){
    const ctx = this.ctx, fwd = this.basis.fwd, cam = this.cam;
    const gx = Math.round(ac.pos.x/step)*step, gy = Math.round(ac.pos.y/step)*step;
    const cols = 2*R+1;
    let tg = this[key];
    if (!tg || tg.gx!==gx || tg.gy!==gy || tg.step!==step || tg.R!==R || tg.gen!==world.terrainGen){
      const X = new Array(cols), Y = new Array(cols), Hg = [];
      for (let i=0;i<cols;i++) X[i] = gx + (i-R)*step;
      for (let j=0;j<cols;j++) Y[j] = gy + (j-R)*step;
      for (let j=0;j<cols;j++){ Hg[j]=[]; for (let i=0;i<cols;i++) Hg[j][i]=terrainH(X[i],Y[j]); }
      tg = this[key] = { gx, gy, step, R, X, Y, Hg, gen:world.terrainGen };
    }
    const X=tg.X, Y=tg.Y, Hg=tg.Hg;
    const P = [];
    for (let j=0;j<cols;j++){ P[j]=[];
      for (let i=0;i<cols;i++) P[j][i] = this.project({x:X[i],y:Y[j],z:Hg[j][i]});
    }
    const quads = [];
    for (let j=0;j<cols-1;j++){
      for (let i=0;i<cols-1;i++){
        const a=P[j][i], b=P[j][i+1], c=P[j+1][i+1], d=P[j+1][i];
        if (!a||!b||!c||!d) continue;
        const mx=(X[i]+X[i+1])*0.5 - cam.x, my=(Y[j]+Y[j+1])*0.5 - cam.y;
        if (mx*fwd.x + my*fwd.y < 0) continue;          // behind camera
        const dist = Math.hypot(mx,my);
        if (dist < nearClip || dist > farClip) continue;
        const h = (Hg[j][i]+Hg[j][i+1]+Hg[j+1][i+1]+Hg[j+1][i])*0.25;
        const slope = (Hg[j][i+1]-Hg[j][i]) + (Hg[j+1][i]-Hg[j][i]);
        quads.push({a,b,c,d,dist,h,slope});
      }
    }
    quads.sort((q1,q2)=>q2.dist-q1.dist);
    for (const q of quads){
      const fog = clamp(1 - q.dist/farClip, 0, 1);
      const hN  = clamp(q.h/TERRAIN_PEAK, 0, 1);
      const sh  = clamp(0.5 + q.slope*0.004, 0.25, 1.0);
      let g = Math.round((26 + hN*120) * sh * (0.35 + 0.65*fog) + 8);
      let r = Math.round(g*0.28), bl = Math.round(g*0.42);
      if (coarse){                                       // fade distant land into the haze
        const m = clamp((q.dist - nearClip)/Math.max(1,(farClip - nearClip)), 0, 1)*0.85;
        r = Math.round(r*(1-m) + 12*m); g = Math.round(g*(1-m) + 44*m); bl = Math.round(bl*(1-m) + 30*m);
      }
      ctx.fillStyle = 'rgb('+r+','+g+','+bl+')';
      ctx.beginPath();
      ctx.moveTo(q.a.x,q.a.y); ctx.lineTo(q.b.x,q.b.y);
      ctx.lineTo(q.c.x,q.c.y); ctx.lineTo(q.d.x,q.d.y); ctx.closePath();
      ctx.fill();
    }
    return quads;
  }
  drawTerrain(ac){
    const q = (typeof QUALITY_LEVELS!=='undefined') ? (QUALITY_LEVELS[world.quality]||QUALITY_LEVELS[1]) : {R:20,step:600};
    const step = q.step, R = q.R, fineFar = R*step;
    const stepC = step*5, Rc = Math.max(8, Math.round(R*0.6)), farC = stepC*Rc;   // distant ring scales with quality
    // distant coarse ring first (fills the horizon, fades into haze)
    this._terrainRing(ac, stepC, Rc, '_tgFar', fineFar*0.7, farC, true);
    // crisp near ring on top
    const quads = this._terrainRing(ac, step, R, '_tg', 0, fineFar, false);
    // faint contour wash on the nearest cells for a little texture
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(39,255,94,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const q2 of quads){ if (q2.dist>3200) continue;
      ctx.moveTo(q2.a.x,q2.a.y); ctx.lineTo(q2.b.x,q2.b.y); ctx.lineTo(q2.c.x,q2.c.y);
    }
    ctx.stroke();
  }

  /* ---------------- runway + airbase ---------------- */
  drawRunway(){
    const ctx = this.ctx;
    const rw = world.runway;
    const hw = rw.w/2, hl = rw.len/2;
    const z = terrainH(rw.x, rw.y);
    const c = (dx,dy)=>({x:rw.x+dx, y:rw.y+dy, z:z+0.3});
    // surface fill
    const corners = [c(-hw,-hl), c(hw,-hl), c(hw,hl), c(-hw,hl)].map(p=>this.project(p));
    if (corners.every(Boolean)){
      ctx.fillStyle = 'rgba(10,40,20,0.55)';
      ctx.beginPath(); ctx.moveTo(corners[0].x,corners[0].y);
      for (let i=1;i<4;i++) ctx.lineTo(corners[i].x,corners[i].y);
      ctx.closePath(); ctx.fill();
    }
    // outline + markings
    ctx.strokeStyle = NEON; ctx.lineWidth = 1.4; ctx.beginPath();
    this.seg(c(-hw,-hl), c(hw,-hl)); this.seg(c(hw,-hl), c(hw,hl));
    this.seg(c(hw,hl), c(-hw,hl));   this.seg(c(-hw,hl), c(-hw,-hl));
    ctx.stroke();
    // centerline dashes
    ctx.strokeStyle = 'rgba(120,255,150,0.7)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let yy=-hl+40; yy<hl-40; yy+=120){ this.seg(c(0,yy), c(0,yy+60)); }
    ctx.stroke();
    // threshold bars
    ctx.strokeStyle = NEONHI; ctx.lineWidth = 1; ctx.beginPath();
    for (const ty of [hl-20, -hl+20]){
      for (let k=-3;k<=3;k++){ this.seg(c(k*5, ty), c(k*5, ty + (ty>0?-30:30))); }
    }
    ctx.stroke();
    // hangars on the apron (east side, south end)
    for (const h of [[120,-1050,34,22,12],[170,-1000,30,20,11],[120,-980,30,20,11]]){
      this.box(h[0], h[1], z, h[2], h[3], h[4], 'rgba(39,255,94,0.6)');
    }
    // taxiway line to runway
    ctx.strokeStyle='rgba(39,255,94,0.4)'; ctx.lineWidth=1; ctx.beginPath();
    this.seg({x:120,y:-1020,z:z+0.3},{x:hw+2,y:-hl+120,z:z+0.3}); ctx.stroke();
  }

  /* a wireframe box on the ground: cx,cy ground centre, base z, w(EW) l(NS) h(up) */
  box(cx, cy, z, w, l, h, color, lw=1.1){
    const ctx=this.ctx; const hw=w/2, hl=l/2;
    const P = [
      {x:cx-hw,y:cy-hl,z:z},     {x:cx+hw,y:cy-hl,z:z},
      {x:cx+hw,y:cy+hl,z:z},     {x:cx-hw,y:cy+hl,z:z},
      {x:cx-hw,y:cy-hl,z:z+h},   {x:cx+hw,y:cy-hl,z:z+h},
      {x:cx+hw,y:cy+hl,z:z+h},   {x:cx-hw,y:cy+hl,z:z+h},
    ];
    const E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.beginPath();
    for (const e of E) this.seg(P[e[0]], P[e[1]]);
    ctx.stroke();
  }

  /* ---------------- threat rings ---------------- */
  drawThreats(){
    const ctx=this.ctx;
    for (const th of world.threats){
      if (!th.live) continue;
      const z = terrainH(th.x, th.y);
      const N = 40;
      const centerVisible = this.groundOverlayVisible(th.x, th.y, 70);
      // Threat rings are tactical overlays, so never let them shine through
      // mountains.  Draw only the portions with terrain line-of-sight.
      ctx.strokeStyle = th.tracking ? th.color : 'rgba(255,120,80,0.32)';
      ctx.lineWidth = th.tracking ? 1.45 : 0.9;
      if (th.tracking) ctx.setLineDash([6,5]);
      ctx.beginPath();
      let prev=null;
      for (let k=0;k<=N;k++){
        const a = k/N*2*Math.PI;
        const p = { x: th.x + Math.cos(a)*th.radius, y: th.y + Math.sin(a)*th.radius, z: z+1 };
        if (prev && this.visibleGroundSeg(prev, p, 95)) this.seg(prev, p);
        prev = p;
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (centerVisible){
        this.box(th.x, th.y, z, 10, 10, 5, th.color, 1.2);
        this.label3d({x:th.x,y:th.y,z:z+18}, th.name, th.color, 11);
      }
    }
  }

  /* ---------------- waypoints ---------------- */
  drawWaypoints(){
    const ctx=this.ctx;
    for (const w of world.waypoints){
      const gz = terrainH(w.x,w.y);
      const cur = (w.id === world.steerpoint);
      const col = cur ? NEONHI : 'rgba(39,255,94,0.55)';
      // pole
      ctx.strokeStyle = col; ctx.lineWidth = cur?1.6:1; ctx.beginPath();
      this.seg({x:w.x,y:w.y,z:gz}, {x:w.x,y:w.y,z:w.alt}); ctx.stroke();
      // diamond at alt
      const c = this.project({x:w.x,y:w.y,z:w.alt});
      if (c && c.z>1){
        const s = clamp(2200/c.z, 4, 26);
        ctx.strokeStyle=col; ctx.lineWidth=cur?1.8:1.2;
        ctx.beginPath();
        ctx.moveTo(c.x,c.y-s); ctx.lineTo(c.x+s,c.y); ctx.lineTo(c.x,c.y+s); ctx.lineTo(c.x-s,c.y); ctx.closePath();
        ctx.stroke();
        ctx.fillStyle=col; ctx.font='10px "Courier New"'; ctx.textAlign='center';
        ctx.fillText(w.name, c.x, c.y - s - 4);
      }
    }
  }

  /* ---------------- target complex ---------------- */
  drawTarget(){
    for (const b of world.target.buildings){
      const z = terrainH(b.x,b.y);
      if (!this.groundOverlayVisible(b.x,b.y,(b.h||20)+35)) continue;
      if (b.destroyed){
        // rubble: low scattered boxes
        this.box(b.x, b.y, z, b.w, b.l, 2, 'rgba(120,120,120,0.5)', 1);
        continue;
      }
      let col = 'rgba(39,255,94,0.8)';
      if (b.primary){
        const pulse = 0.55 + 0.45*Math.sin(world.t*4);
        col = `rgba(255,210,90,${0.55+0.4*pulse})`;
      }
      this.box(b.x, b.y, z, b.w, b.l, b.h, col, b.primary?1.6:1.1);
      if (b.primary && !world.target.destroyed){
        this.label3d({x:b.x,y:b.y,z:z+b.h+10}, '◆ TGT '+b.label, '#ffd24d', 11);
      }
    }
  }

  /* ---------------- bandits (air) ---------------- */
  drawBandits(){
    const ctx=this.ctx;
    for (const bd of world.bandits){
      if (bd.hp<=0) continue;
      const cP=Math.cos(bd.psi), sP=Math.sin(bd.psi);
      const f={x:sP,y:cP}, r={x:cP,y:-sP};
      const span=10, len=14;
      const nose={x:bd.x+f.x*len, y:bd.y+f.y*len, z:bd.alt};
      const lw ={x:bd.x-f.x*4 - r.x*span, y:bd.y-f.y*4 - r.y*span, z:bd.alt};
      const rw ={x:bd.x-f.x*4 + r.x*span, y:bd.y-f.y*4 + r.y*span, z:bd.alt};
      const tail={x:bd.x-f.x*8, y:bd.y-f.y*8, z:bd.alt};
      const col = bd.kind==='HOSTILE' ? '#ff5b5b' : '#ffd24d';
      ctx.strokeStyle=col; ctx.lineWidth=1.3; ctx.beginPath();
      this.seg(nose,lw); this.seg(nose,rw); this.seg(lw,tail); this.seg(rw,tail);
      ctx.stroke();
    }
  }

  /* ---------------- SAM missiles + bombs + effects ---------------- */
  drawProjectiles(){
    const ctx=this.ctx;
    ctx.strokeStyle=NEONHI; ctx.lineWidth=1.2; ctx.beginPath();
    for (const b of world.bombs){
      const tail = vadd(b.pos, vscale(vnorm(b.vel), -8));
      this.seg(tail, b.pos);
    }
    for (const bl of (world.bullets||[])){
      const tail = bl.prev || vadd(bl.pos, vscale(vnorm(bl.vel), -24));
      this.seg(tail, bl.pos);
    }
    ctx.stroke();
    // missiles + smoke trails
    for (const s of world.sams){
      const col = s.color || (s.team==='RED' ? '#ff5050' : '#a8ffc0');
      if (s.trail && s.trail.length>1){
        ctx.strokeStyle = s.team==='RED' ? 'rgba(255,120,120,0.35)' : 'rgba(180,255,210,0.45)';
        ctx.lineWidth=1; ctx.beginPath(); let started=false;
        for (const tp of s.trail){ const c=this.project(tp); if(!c||c.z<1){started=false;continue;}
          if(!started){ctx.moveTo(c.x,c.y);started=true;} else ctx.lineTo(c.x,c.y); }
        ctx.stroke();
      }
      ctx.strokeStyle=col; ctx.lineWidth=1.8; ctx.beginPath();
      this.seg(vadd(s.pos, vscale(vnorm(s.vel), -22)), s.pos); ctx.stroke();
      const head=this.project(s.pos);
      if (head && head.z>1){ ctx.fillStyle=col; ctx.fillRect(head.x-1.5,head.y-1.5,3,3); }
    }
    // visible flare/chaff countermeasures.  These are intentionally drawn larger
    // than scale-perfect particles so defensive bandit CM is readable from the
    // cockpit during a merge or chase.
    for (const d of (world.decoys||[])){
      const c=this.project(d.pos); if(!c||c.z<1) continue;
      const age=clamp(1-(d.t||0)/(d.life||1),0,1);
      const vel=d.vel||{x:0,y:0,z:0};
      const tail=this.project(vadd(d.pos, vscale(vnorm(vel), d.kind==='flare'?-55:-28)));
      if (d.kind==='flare'){
        const r=clamp(6.5*age*(2200/c.z),2.2,18);
        if(tail&&tail.z>1){ ctx.strokeStyle=`rgba(255,170,70,${0.45*age})`; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(tail.x,tail.y); ctx.lineTo(c.x,c.y); ctx.stroke(); }
        ctx.fillStyle=`rgba(255,205,75,${0.95*age})`;
        ctx.beginPath(); ctx.arc(c.x,c.y,r,0,2*Math.PI); ctx.fill();
        ctx.fillStyle=`rgba(255,95,35,${0.55*age})`; ctx.beginPath(); ctx.arc(c.x,c.y,r*1.8,0,2*Math.PI); ctx.fill();
      } else {
        const r=clamp(9*age*(2200/c.z),3.5,28);
        ctx.strokeStyle=`rgba(215,240,255,${0.70*age})`; ctx.lineWidth=1.3;
        ctx.beginPath(); ctx.arc(c.x,c.y,r,0,2*Math.PI); ctx.stroke();
        ctx.strokeStyle=`rgba(215,240,255,${0.25*age})`; ctx.beginPath(); ctx.arc(c.x,c.y,r*1.7,0,2*Math.PI); ctx.stroke();
      }
    }
    // effects: launch flash (cool/white) vs blast (orange)
    for (const e of world.effects){
      const c = this.project(e.pos);
      if (!c || c.z<1) continue;
      const k = e.t/e.dur;
      if (e.kind==='launch'){
        const r = clamp((4 + k*30) * (2200/c.z)/8, 2, 60);
        ctx.fillStyle = `rgba(200,255,235,${0.7*(1-k)})`;
        ctx.beginPath(); ctx.arc(c.x,c.y,r,0,2*Math.PI); ctx.fill();
      } else {
        const r = clamp((6 + k*60) * (2200/c.z)/8, 3, 120);
        ctx.strokeStyle = `rgba(255,${150-100*k|0},60,${1-k})`;
        ctx.lineWidth = 2*(1-k)+0.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2*Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.arc(c.x, c.y, r*0.5, 0, 2*Math.PI); ctx.stroke();
      }
    }
  }

  label3d(p, txt, col, size){
    const c = this.project(p);
    if (!c || c.z<1 || c.z>30000) return;
    const ctx=this.ctx;
    ctx.fillStyle=col; ctx.font=size+'px "Courier New"'; ctx.textAlign='center';
    ctx.fillText(txt, c.x, c.y);
  }

  drawAssets(){
    const ctx=this.ctx;
    // high-value stationary assets — red box on the deck + mast + label
    for (const v of world.hvts){
      if (v.destroyed) continue;
      if (!this.groundOverlayVisible(v.x,v.y,70)) continue;
      const z=terrainH(v.x,v.y), s=10;
      const a={x:v.x-s,y:v.y-s,z},b={x:v.x+s,y:v.y-s,z},c={x:v.x+s,y:v.y+s,z},d={x:v.x-s,y:v.y+s,z};
      ctx.strokeStyle='#ff5b5b'; ctx.lineWidth=1.3; ctx.beginPath();
      this.seg(a,b); this.seg(b,c); this.seg(c,d); this.seg(d,a);
      this.seg({x:v.x,y:v.y,z},{x:v.x,y:v.y,z:z+14}); ctx.stroke();
      this.label3d({x:v.x,y:v.y,z:z+22}, '\u25c6 '+v.name, '#ff8a5b', 10);
    }
    // moving ground targets — orange box on the deck
    for (const m of world.groundMovers){
      if (m.destroyed || m.underground) continue;
      if (!this.groundOverlayVisible(m.x,m.y,55)) continue;
      const z=terrainH(m.x,m.y), s=6;
      const a={x:m.x-s,y:m.y-s,z},b={x:m.x+s,y:m.y-s,z},c={x:m.x+s,y:m.y+s,z},d={x:m.x-s,y:m.y+s,z};
      ctx.strokeStyle=m.kind==='TEL'?'#ff7a4d':'#ff9a4d'; ctx.lineWidth=1.2; ctx.beginPath();
      this.seg(a,b); this.seg(b,c); this.seg(c,d); this.seg(d,a); ctx.stroke();
      this.label3d({x:m.x,y:m.y,z:z+10}, m.name, m.kind==='TEL'?'#ff7a4d':'#ff9a4d', 9);
    }
    // friendly FARPs / reload strips (cyan) with a centre reload marker
    for (const s of world.airstrips){
      if (!this.groundOverlayVisible(s.x,s.y,40)) continue;
      const z=terrainH(s.x,s.y), chd=Math.cos(s.hdg), shd=Math.sin(s.hdg), hl=s.len/2, hw=60;
      const c1={x:s.x+shd*hl-chd*hw,y:s.y+chd*hl+shd*hw,z}, c2={x:s.x+shd*hl+chd*hw,y:s.y+chd*hl-shd*hw,z};
      const c3={x:s.x-shd*hl+chd*hw,y:s.y-chd*hl-shd*hw,z}, c4={x:s.x-shd*hl-chd*hw,y:s.y-chd*hl+shd*hw,z};
      ctx.strokeStyle='#5bd6ff'; ctx.lineWidth=1.3; ctx.beginPath();
      this.seg(c1,c2); this.seg(c2,c3); this.seg(c3,c4); this.seg(c4,c1);
      this.seg({x:s.rx-45,y:s.ry,z},{x:s.rx+45,y:s.ry,z}); this.seg({x:s.rx,y:s.ry-45,z},{x:s.rx,y:s.ry+45,z});
      ctx.stroke();
      this.label3d({x:s.x,y:s.y,z:z+22}, s.name+' \u25c8 RELOAD', '#5bd6ff', 10);
    }
    // friendly AWACS — cyan diamond at altitude
    for (const f of world.friendlies){
      if (!f.alive) continue;
      const s=16, A=f.alt;
      ctx.strokeStyle='#5bd6ff'; ctx.lineWidth=1.3; ctx.beginPath();
      this.seg({x:f.x-s,y:f.y,z:A},{x:f.x,y:f.y,z:A+s});
      this.seg({x:f.x,y:f.y,z:A+s},{x:f.x+s,y:f.y,z:A});
      this.seg({x:f.x+s,y:f.y,z:A},{x:f.x,y:f.y,z:A-s});
      this.seg({x:f.x,y:f.y,z:A-s},{x:f.x-s,y:f.y,z:A}); ctx.stroke();
      this.label3d({x:f.x,y:f.y,z:A+s+10}, f.type, '#5bd6ff', 10);
    }
  }

  render(ac){
    this.setCamera(ac);
    const ctx=this.ctx;
    ctx.save();
    ctx.lineJoin='round'; ctx.lineCap='round';
    this.drawSky();
    this.drawTerrain(ac);
    this.drawHaze();
    this.drawRunway();
    this.drawThreats();
    this.drawTarget();
    this.drawWaypoints();
    this.drawBandits();
    this.drawAssets();
    this.drawProjectiles();
    ctx.restore();
  }
}
