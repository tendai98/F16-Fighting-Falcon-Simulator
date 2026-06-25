/* ============================================================================
   audio.js — F-16-style sound using Tone.js (standalone; depends only on the
   global `Tone` from tone.js). Everything is wrapped in try/catch so audio can
   never break the sim. Web Audio runs on its own thread, so this is cheap.

   Public API (all safe to call any time):
     F16Audio.init()              resume the audio context (call on a gesture)
     F16Audio.toggle()            mute / unmute
     F16Audio.setEnabled(bool)
     F16Audio.event(name)         one-shot SFX: 'gun' 'missile' 'bomb' 'beep'
                                  'select' 'newguy' 'win' 'loss'
     F16Audio.update(state)       continuous sounds, driven each frame:
                                  { throttle, missile, lock, lowAlt, stall,
                                    caution, gun, paused }
   ========================================================================== */
(function(){
  const clamp = (v,a,b)=> v<a?a : v>b?b : v;
  const A = { ready:false, enabled:true, loops:{} };
  const T = ()=> window.Tone;

  A.init = function(){
    if (A.ready || !T()) return;
    try {
      const p = T().start();                 // needs a user gesture
      const go = ()=>{ try{ buildGraph(); A.ready = true; }catch(e){} };
      if (p && p.then) p.then(go); else go();
    } catch(e){ /* no audio */ }
  };

  function buildGraph(){
    const Tone = T();
    A.master = new Tone.Gain(A.enabled ? 0.85 : 0.0).toDestination();

    // --- tone synths for beeps / warnings ---
    A.beeper = new Tone.Synth({ oscillator:{type:'square'},
      envelope:{attack:0.002,decay:0.05,sustain:0.0,release:0.03} }).connect(A.master);
    A.toneB  = new Tone.Synth({ oscillator:{type:'sine'},
      envelope:{attack:0.004,decay:0.10,sustain:0.25,release:0.06} }).connect(A.master);
    A.warble = new Tone.Synth({ oscillator:{type:'sawtooth'},
      envelope:{attack:0.001,decay:0.03,sustain:0.0,release:0.01} }).connect(A.master);

    // --- gun: deep BRRRT with bass thump + controlled buzz/noise ---
    A.gunBus = new Tone.Gain(0.42).connect(A.master);
    A.gunFilt = new Tone.Filter(620,'bandpass').connect(A.gunBus);
    A.gun = new Tone.NoiseSynth({ noise:{type:'brown'},
      envelope:{attack:0.001,decay:0.075,sustain:0.0,release:0.025} }).connect(A.gunFilt);
    A.gunBuzzFilt = new Tone.Filter(1050,'bandpass').connect(A.gunBus);
    A.gunBuzz = new Tone.NoiseSynth({ noise:{type:'white'},
      envelope:{attack:0.001,decay:0.055,sustain:0.0,release:0.018} }).connect(A.gunBuzzFilt);
    A.gunBassFilt = new Tone.Filter(135,'lowpass').connect(A.gunBus);
    A.gunBass = new Tone.Synth({ oscillator:{type:'sawtooth'},
      envelope:{attack:0.001,decay:0.085,sustain:0.0,release:0.035} }).connect(A.gunBassFilt);

    // --- noise: missile whoosh (gain + filter sweep on a steady noise src) ---
    A.whFilt = new Tone.Filter(900,'lowpass').connect(A.master);
    A.whGain = new Tone.Gain(0.0).connect(A.whFilt);
    A.whoosh = new Tone.Noise('pink').connect(A.whGain).start();
  }

  /* simple JS-driven loops for repeating warnings (no Transport needed) */
  function startLoop(id, periodMs, fn){
    if (A.loops[id]) return;
    try { fn(); } catch(e){}
    A.loops[id] = setInterval(()=>{ if (A.ready && A.enabled){ try{ fn(); }catch(e){} } }, periodMs);
  }
  function stopLoop(id){ if (A.loops[id]){ clearInterval(A.loops[id]); A.loops[id]=null; } }

  function warbleHit(){
    const Tone=T(), t=Tone.now();
    A.warble.triggerAttackRelease(1600,0.035,t);
    A.warble.triggerAttackRelease(1250,0.035,t+0.06);
  }
  function missileWhoosh(){
    const t=T().now(), g=A.whGain.gain, f=A.whFilt.frequency;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001,t);
    g.linearRampToValueAtTime(0.28, t+0.04); g.linearRampToValueAtTime(0.0001, t+0.95);
    f.cancelScheduledValues(t); f.setValueAtTime(1400,t); f.linearRampToValueAtTime(280,t+0.95);
  }
  function jingle(freqs){
    const t=T().now();
    freqs.forEach((fr,i)=> A.toneB.triggerAttackRelease(fr, 0.18, t + i*0.16));
  }

  A.setEnabled = function(b){
    A.enabled = !!b;
    if (A.ready){ try{ A.master.gain.rampTo(A.enabled?0.85:0.0, 0.05); }catch(e){} }
    if (!A.enabled){ for (const k in A.loops) stopLoop(k); }
  };
  A.toggle = function(){ A.setEnabled(!A.enabled); return A.enabled; };

  /* one-shot effects */
  A.event = function(name){
    if (!A.ready || !A.enabled) return;
    const Tone=T(), t=Tone.now();
    try { switch(name){
      case 'gun': {
        // A compact A-10-like BRRRT: bass pulse plus dirty buzz, rate-limited so
        // hold-to-fire sounds like one continuous cannon instead of harsh clicks.
        if (A._lastGunT && t - A._lastGunT < 0.045) break;
        A._lastGunT = t;
        const seq = (A._gunSeq = (A._gunSeq||0)+1);
        const f0 = 64 + (seq%3)*7;
        A.gunBass.triggerAttackRelease(f0, 0.075, t);
        A.gun.triggerAttackRelease(0.075, t);
        A.gunBuzz.triggerAttackRelease(0.052, t+0.006);
        if (seq%2===0) A.gunBass.triggerAttackRelease(f0*0.5, 0.055, t+0.032);
        break;
      }
      case 'missile': missileWhoosh(); A.toneB.triggerAttackRelease(1200,0.09,t); break;
      case 'bomb':    A.beeper.triggerAttackRelease(200,0.10,t); break;
      case 'beep':    A.beeper.triggerAttackRelease(950,0.045,t); break;
      case 'select':  A.beeper.triggerAttackRelease(1450,0.03,t); break;
      case 'newguy':  A.toneB.triggerAttackRelease(440,0.12,t); break;
      case 'win':     jingle([523,659,784,1047]); break;
      case 'loss':    jingle([392,330,262,175]); break;
    } } catch(e){}
  };

  /* continuous / state-driven sounds, called every frame */
  A.update = function(s){
    if (!A.ready) return;
    s = s || {};
    try {
      const paused = !!s.paused;
      if (paused || !A.enabled){ for (const k in A.loops) stopLoop(k); return; }

      // missile launch warning (RWR warble) — highest priority
      s.missile ? startLoop('msl', 150, warbleHit) : stopLoop('msl');
      // SAM lock — steady-ish tone
      s.lock ? startLoop('lock', 460, ()=>A.toneB.triggerAttackRelease(880,0.34)) : stopLoop('lock');
      // ground-proximity "whoop"
      s.lowAlt ? startLoop('lowalt', 680, ()=>A.beeper.triggerAttackRelease(520,0.16)) : stopLoop('lowalt');
      // stall warning — clear repeating beep (like the SAM warning), not a tick
      s.stall ? startLoop('stall', 420, ()=>{
        const t=T().now(); A.toneB.triggerAttackRelease(700,0.11,t); A.toneB.triggerAttackRelease(700,0.11,t+0.15);
      }) : stopLoop('stall');
      // master caution two-tone
      s.caution ? startLoop('caution', 640, ()=>{
        const t=T().now(); A.beeper.triggerAttackRelease(720,0.10,t); A.beeper.triggerAttackRelease(610,0.10,t+0.12);
      }) : stopLoop('caution');
      // G-limit feedback is visual/HUD-only.  Do not add heartbeat, breathing,
      // blackout, or audio-muffling loops here; high-G training should not fight
      // the existing RWR, missile, stall, gun and caution cues.
      if (A.master && A.master.gain){ try{ A.master.gain.rampTo(A.enabled ? 0.85 : 0.0, 0.16); }catch(e){} }
      stopLoop('highg');
      stopLoop('gloc');
    } catch(e){}
  };

  window.F16Audio = A;
})();
