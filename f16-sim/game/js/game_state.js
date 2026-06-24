/* =====================================================================
   GAME STATE FLOW
   ===================================================================== */
var GAME_STATES = {
  MENU:'MENU',
  ACTIVE:'ACTIVE_MISSION',
  DEBRIEF:'MISSION_DEBRIEF',
  REPLAY_BROWSER:'REPLAY_BROWSER',
  REPLAY_PLAYBACK:'REPLAY_PLAYBACK',
  FLIGHT_SCHOOL:'FLIGHT_SCHOOL'
};

var GameFlow = {
  state: GAME_STATES.MENU,
  previousState: null,
  _ending: false,
  lastOutcome: null,
  lastOutcomeText: '',
  
  replayBrowserReturnState: GAME_STATES.MENU,

  init: function(){
    var saved = null;
    try { saved = localStorage.getItem('f16_selected_difficulty'); } catch(e) {}
    if (saved !== null && typeof world !== 'undefined' && typeof DIFFS !== 'undefined'){
      var n = parseInt(saved, 10);
      if (!isNaN(n)) world.difficulty = clamp(n, 0, DIFFS.length-1);
    }
    this.set(GAME_STATES.MENU);
    if (window.MenuUI) MenuUI.showMainMenu();
  },

  set: function(state, opts){
    opts = opts || {};
    if (this.state !== state) this.previousState = this.state;
    this.state = state;
    if (typeof world !== 'undefined'){
      world.gameState = state;
      world.paused = !(state === GAME_STATES.ACTIVE || state === GAME_STATES.FLIGHT_SCHOOL || state === GAME_STATES.REPLAY_PLAYBACK);
      if (opts.keepPause) world.paused = true;
    }
    if (document.body){
      document.body.setAttribute('data-game-state', state);
      document.body.setAttribute('data-game-mode', state);
    }
    if (window.MenuUI && MenuUI.onStateChange) MenuUI.onStateChange(state);
  },

  isMissionActive: function(){ return this.state === GAME_STATES.ACTIVE || this.state === GAME_STATES.FLIGHT_SCHOOL; },
  isTraining: function(){ return this.state === GAME_STATES.FLIGHT_SCHOOL; },
  isActiveMission: function(){ return this.isMissionActive(); },
  isReplay: function(){ return this.state === GAME_STATES.REPLAY_PLAYBACK && window.ReplayPlayback && ReplayPlayback.active; },

  setLevel: function(i){
    i = clamp(i|0, 0, DIFFS.length-1);
    world.difficulty = i;
    try { localStorage.setItem('f16_selected_difficulty', String(i)); } catch(e) {}
    if (window.MenuUI && MenuUI.refreshLevel) MenuUI.refreshLevel();
    return i;
  },

  startMission: function(training){
    if (window.ReplayPlayback && ReplayPlayback.active) ReplayPlayback.stop();
    this._ending = false;
    this.lastOutcome = null;
    this.lastOutcomeText = '';
    this.lastScore = null;
    if (window.MenuUI) MenuUI.hideAll();
    this.set(training ? GAME_STATES.FLIGHT_SCHOOL : GAME_STATES.ACTIVE);
    if (typeof removeIntroOffer === 'function') removeIntroOffer();
    if (typeof removeLessonMenu === 'function') removeLessonMenu();
    if (typeof restartMission === 'function') restartMission();
    if (window.ScoreTracker) ScoreTracker.start();
    if (window.ReplayRecorder){ if(training) ReplayRecorder.active=false; else ReplayRecorder.start(); }
    world._pendingReplayRecord = null;
    world._pendingReplaySaved = false;
    world.paused = false;
  },

  enterActiveFromLesson: function(opts){
    opts = opts || {};
    if (window.ReplayPlayback && ReplayPlayback.active) ReplayPlayback.stop();
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ clearOutcome:true, clearProjectiles:true, resetCockpit:!opts.preserveCockpit, invalidateMission:true });
    this._ending = false;
    this.lastOutcome = null;
    this.lastOutcomeText = '';
    this.lastScore = null;
    this.set(GAME_STATES.FLIGHT_SCHOOL);
    world.paused = false;
    if (window.ScoreTracker) ScoreTracker.start();
    if (window.ReplayRecorder) ReplayRecorder.active=false;
    world._pendingReplayRecord = null;
    world._pendingReplaySaved = false;
  },

  afterMissionRestart: function(){
    this._ending = false;
    if (!this.isMissionActive()) this.set(GAME_STATES.ACTIVE);
    if (window.ScoreTracker) ScoreTracker.start();
    if (window.ReplayRecorder){ if(this.state===GAME_STATES.FLIGHT_SCHOOL) ReplayRecorder.active=false; else ReplayRecorder.start(); }
    world._pendingReplayRecord = null;
    world._pendingReplaySaved = false;
    world.paused = false;
  },

  onMissionEnd: function(kind, txt){
    if (this._ending) return;
    this._ending = true;
    this.lastOutcome = kind || world.outcome || 'LOSS';
    this.lastOutcomeText = txt || world.outcomeReason || '';
    if (this.state === GAME_STATES.FLIGHT_SCHOOL){
      if (window.ReplayRecorder) ReplayRecorder.active=false;
      world._pendingReplayRecord = null; world._pendingReplaySaved = false;
      if (window.ScoreTracker) ScoreTracker.lastScore = null;
      if (typeof clearRuntimeState === 'function') clearRuntimeState({ keepMessage:false, clearProjectiles:true, pauseAudio:true });
      if (typeof endTutorial === 'function') endTutorial();
      this.set(GAME_STATES.MENU, { keepPause:true });
      if (window.MenuUI) MenuUI.showMainMenu();
      if (typeof banner === 'function') banner('TRAINING ENDED — NO REPLAY SAVED', 2.0);
      return;
    }
    if (window.ScoreTracker) this.lastScore = ScoreTracker.finish(this.lastOutcome, this.lastOutcomeText);
    else this.lastScore = { total:0, breakdown:{} };
    if (window.ReplayRecorder) world._pendingReplayRecord = ReplayRecorder.stop({ outcome:this.lastOutcome, reason:this.lastOutcomeText });
    world._pendingReplaySaved = false;
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ keepMessage:false, clearProjectiles:true, pauseAudio:true });
    this.set(GAME_STATES.DEBRIEF, { keepPause:true });
    if (window.MenuUI) MenuUI.showDebrief();
  },

  completeDebrief: function(player){
    var rec = world._pendingReplayRecord;
    if (!rec && window.ReplayRecorder) rec = ReplayRecorder.stop({ outcome:this.lastOutcome || world.outcome || 'LOSS', reason:this.lastOutcomeText || world.outcomeReason || '' });
    if (!rec) return Promise.reject(new Error('No replay record available'));
    rec.player = {
      alias: String(player.alias || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16),
      country: String(player.country || 'ZZ').toUpperCase().replace(/[^A-Z]/g,'').slice(0,2)
    };
    rec.score = this.lastScore || (window.ScoreTracker && ScoreTracker.lastScore) || rec.score || { total:0, breakdown:{} };
    if (rec.mission){
      rec.mission.outcome = this.lastOutcome || world.outcome || rec.mission.outcome || 'LOSS';
      rec.mission.outcomeReason = this.lastOutcomeText || world.outcomeReason || rec.mission.outcomeReason || '';
      rec.mission.durationSec = Math.round((world.t || rec.mission.durationSec || 0)*100)/100;
      rec.mission.level = (world.difficulty || 0) + 1;
      rec.mission.difficultyIndex = world.difficulty || 0;
      rec.mission.difficultyName = DIFFS[world.difficulty || 0].name;
    }
    world._pendingReplayRecord = rec;
    if (world._pendingReplaySaved) return Promise.resolve(rec);
    return ReplayStore.save(rec).then(function(saved){
      world._pendingReplayRecord = saved;
      world._pendingReplaySaved = true;
      return saved;
    });
  },

  openReplayBrowser: function(){
    this.replayBrowserReturnState = this.state;
    if (window.MenuUI) MenuUI.openReplayBrowser();
  },

  closeReplayBrowser: function(){
    if (window.MenuUI && MenuUI.hideAll) MenuUI.hideAll();
    var s = this.replayBrowserReturnState || GAME_STATES.MENU;
    if (s === GAME_STATES.ACTIVE || s === GAME_STATES.FLIGHT_SCHOOL){
      this.set(s);
      world.paused = false;
    } else {
      this.returnToMenu();
    }
  },

  watchReplayById: function(id){
    var self = this;
    return ReplayStore.get(id).then(function(rec){
      if (!rec){ if (typeof banner === 'function') banner('REPLAY NOT FOUND', 1.2); return null; }
      self.playReplay(rec);
      return rec;
    });
  },

  playReplay: function(rec){
    if (!rec || !window.ReplayPlayback) return false;
    if (window.ReplayRecorder && ReplayRecorder.active) ReplayRecorder.active = false;
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ clearOutcome:true, clearProjectiles:true, resetCockpit:true, invalidateMission:true, pauseAudio:true });
    if (window.MenuUI) MenuUI.hideAll();
    this.set(GAME_STATES.REPLAY_PLAYBACK, { keepPause:true });
    return ReplayPlayback.start(rec);
  },

  update: function(dt){
    if (window.ReplayPlayback && ReplayPlayback.active) ReplayPlayback.update(dt);
  },

  closeToMenu: function(){ this.returnToMenu(); },
  returnToMenu: function(){
    if (window.ReplayPlayback && ReplayPlayback.active) ReplayPlayback.stop();
    if (window.ReplayRecorder && ReplayRecorder.active) ReplayRecorder.active = false;
    if (typeof clearRuntimeState === 'function') clearRuntimeState({ clearOutcome:true, clearProjectiles:true, resetCockpit:true, invalidateMission:true, pauseAudio:true });
    if (typeof removeLessonMenu === 'function') removeLessonMenu();
    if (typeof removeIntroOffer === 'function') removeIntroOffer();
    world.outcome = null;
    world.outcomeReason = '';
    this._ending = false;
    this.set(GAME_STATES.MENU, { keepPause:true });
    if (window.MenuUI) MenuUI.showMainMenu();
  },

  handleKey: function(code){
    var ae = document.activeElement;
    var editing = ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName || '');
    if (editing){
      if (code === 'Escape'){ ae.blur(); return true; }
      return true;
    }
    if (code === 'Escape'){
      if (window.MenuUI && MenuUI.handleEscape && MenuUI.handleEscape()) return true;
      if (typeof toggleControls === 'function') toggleControls(true);
      return true;
    }
    if (this.isReplay()){
      if (code === 'Space' || code === 'KeyP') ReplayPlayback.toggle();
      else if (code === 'KeyR') ReplayPlayback.restart();
      else if (code === 'KeyH') this.openReplayBrowser();
      else return false;
      return true;
    }
    if (code === 'F1') return true;
    if (code === 'Slash'){
      if (typeof toggleControls === 'function') toggleControls();
      return true;
    }
    if (code === 'KeyH'){
      this.openReplayBrowser();
      return true;
    }
    if (!this.isMissionActive()){
      if (code === 'Digit1') this.setLevel(0);
      else if (code === 'Digit2') this.setLevel(1);
      else if (code === 'Digit3') this.setLevel(2);
      else if (code === 'Digit4') this.setLevel(3);
      else if (code === 'Digit5') this.setLevel(4);
      return true;
    }
    return false;
  }
};

function startGameMission(training){ GameFlow.startMission(!!training); }
window.startGameMission = startGameMission;
window.GAME_STATES = GAME_STATES;
window.GameFlow = GameFlow;

function difficultyName(i){ return (window.DIFFS && DIFFS[i] ? DIFFS[i].name : ['EASY','NORMAL','HARD','ACE','AIR SUPER'][i] || 'NORMAL'); }
function sanitizeAlias(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16); }
function sanitizeCountry(v){ v=String(v||'ZW').toUpperCase().replace(/[^A-Z]/g,'').slice(0,2); return v.length===2?v:'ZW'; }
window.difficultyName=difficultyName; window.sanitizeAlias=sanitizeAlias; window.sanitizeCountry=sanitizeCountry;
