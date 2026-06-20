/* =====================================================================
   MENU / DEBRIEF / SCOREBOARD / REPLAY UI
   ===================================================================== */
var MenuUI = {
  ready:false,
  savedDebriefRecord:null,
  countries:[
    ['ZW','Zimbabwe'],['ZA','South Africa'],['BW','Botswana'],['ZM','Zambia'],['MZ','Mozambique'],['NA','Namibia'],
    ['KE','Kenya'],['NG','Nigeria'],['GH','Ghana'],['TZ','Tanzania'],['UG','Uganda'],['EG','Egypt'],
    ['US','United States'],['GB','United Kingdom'],['CA','Canada'],['AU','Australia'],['FR','France'],['DE','Germany'],
    ['BR','Brazil'],['IN','India'],['JP','Japan'],['ZZ','Other']
  ],

  init:function(){
    if (this.ready) return;
    this.ready = true;
    var root = document.getElementById('game-ui');
    if (!root){
      root = document.createElement('div');
      root.id = 'game-ui';
      document.body.appendChild(root);
    }
    root.innerHTML = this.shellHTML();
    this.bind(root);
  },

  shellHTML:function(){
    return ''+
      '<div class="game-modal" id="modal-main">'+
        '<div class="game-card menu-card">'+
          '<div class="game-kicker">F-16C STRIKE MISSION SIMULATOR</div><h1>MISSION OPS</h1>'+
          '<div class="menu-level">SELECTED LEVEL: <b id="selected-level-label"></b></div>'+
          '<div class="level-buttons" id="level-buttons"></div>'+
          '<div class="menu-buttons">'+
            '<button data-action="start">START</button>'+
            '<button data-action="scoreboard">SCOREBOARD / REPLAYS <span>H</span></button>'+
            '<button data-action="help">HELP / CONTROLS <span>ESC</span></button>'+
            '<button data-action="school">FLIGHT SCHOOL</button>'+
          '</div>'+
          '<div class="menu-foot">Levels 1-5: terrain height scales x2, x3, x4, x5, x6.</div>'+
        '</div></div>'+
      '<div class="game-modal" id="modal-debrief"></div>'+
      '<div class="game-modal" id="modal-browser"></div>'+
      '<div class="replay-hud" id="replay-hud"></div>';
  },

  bind:function(root){
    var self = this;
    root.addEventListener('click', function(ev){
      var b = ev.target.closest && ev.target.closest('button[data-action]');
      if (!b) return;
      var a = b.dataset.action;
      if ((a === 'watch-current' || a === 'watch-replay' || a === 'replay-toggle') && window.F16Audio && !F16Audio.ready) F16Audio.init();
      if (a === 'level') self.selectLevel(+b.dataset.level);
      else if (a === 'start') GameFlow.startMission(false);
      else if (a === 'scoreboard') self.openReplayBrowser();
      else if (a === 'help') { if (typeof toggleControls === 'function') toggleControls(true); }
      else if (a === 'school') {
        if (typeof toggleControls === 'function') toggleControls(false);
        self.hideAll();
        if (typeof removeIntroOffer === 'function') removeIntroOffer();
        if (typeof buildLessonMenu === 'function') buildLessonMenu();
      }
      else if (a === 'continue') self.saveDebriefThen('menu');
      else if (a === 'watch-current') self.saveDebriefThen('watch');
      else if (a === 'main-menu') self.saveDebriefThen('menu');
      else if (a === 'close-browser') { if (GameFlow.closeReplayBrowser) GameFlow.closeReplayBrowser(); else GameFlow.returnToMenu(); }
      else if (a === 'watch-replay') { var old=b.textContent; b.disabled=true; b.textContent='LOADING'; GameFlow.watchReplayById(b.dataset.id).then(function(rec){ if(!rec){ b.disabled=false; b.textContent=old; } }).catch(function(){ b.disabled=false; b.textContent=old; }); }
      else if (a === 'replay-toggle') { ReplayPlayback.toggle(); self.updateReplayControls(); }
      else if (a === 'replay-restart') { ReplayPlayback.restart(); self.updateReplayControls(); }
      else if (a === 'replay-exit') GameFlow.returnToMenu();
    });
    root.addEventListener('input', function(ev){
      if (ev.target && ev.target.id === 'pilot-alias'){
        var v = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16);
        if (ev.target.value !== v) ev.target.value = v;
      }
    });
  },

  onStateChange:function(state){
    if (!this.ready) return;
    if (state !== GAME_STATES.REPLAY_PLAYBACK) this.hideReplayControls();
  },

  showModal:function(id){
    this.init();
    document.querySelectorAll('#game-ui .game-modal').forEach(function(m){ m.classList.remove('show'); });
    var m = document.getElementById(id);
    if (m) m.classList.add('show');
  },

  hideAll:function(){
    this.init();
    document.querySelectorAll('#game-ui .game-modal').forEach(function(m){ m.classList.remove('show'); });
    this.hideReplayControls();
  },

  showMainMenu:function(){
    this.init();
    this.savedDebriefRecord = null;
    this.refreshLevel();
    this.showModal('modal-main');
  },

  refreshLevel:function(){
    if (!this.ready) return;
    var box = document.getElementById('level-buttons');
    if (box && !box.children.length){
      for (var i=0;i<DIFFS.length;i++){
        var b = document.createElement('button');
        b.className = 'level-choice';
        b.dataset.action = 'level';
        b.dataset.level = String(i);
        b.textContent = (i+1)+'  '+DIFFS[i].name;
        box.appendChild(b);
      }
    }
    var label = document.getElementById('selected-level-label');
    if (label) label.textContent = (world.difficulty+1)+' - '+DIFFS[world.difficulty].name;
    document.querySelectorAll('#level-buttons .level-choice').forEach(function(b){
      b.classList.toggle('active', +b.dataset.level === world.difficulty);
    });
  },

  selectLevel:function(i){
    if (typeof setDifficulty === 'function') setDifficulty(i, { noRestart:true });
    else GameFlow.setLevel(i);
    this.refreshLevel();
  },
  refreshBackendStatus:function(){
    // Backend/local sync is intentionally silent for players.
    // The storage layer still probes and uploads pending mission records in the background.
  },


  showDebrief:function(){
    this.init();
    this.savedDebriefRecord = null;
    var modal = document.getElementById('modal-debrief');
    var sc = GameFlow.lastScore || (window.ScoreTracker && ScoreTracker.lastScore) || { total:0, breakdown:{} };
    var outcome = GameFlow.lastOutcome || world.outcome || 'LOSS';
    var reason = GameFlow.lastOutcomeText || world.outcomeReason || '';
    var opts = this.countries.map(function(c){ return '<option value="'+c[0]+'">'+c[0]+' - '+c[1]+'</option>'; }).join('');
    var alias = ReplaySettings.get('alias','PILOT');
    alias = String(alias || 'PILOT').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16) || 'PILOT';
    var country = ReplaySettings.get('country','ZW') || 'ZW';
    modal.innerHTML = ''+
      '<div class="game-card debrief-card">'+
        '<div class="game-kicker">MISSION DEBRIEF</div><h2 class="outcome-'+outcome+'">'+(outcome==='WIN'?'MISSION COMPLETE':'MISSION FAILED')+'</h2>'+
        '<div class="menu-foot">'+this.escape(reason || 'Mission ended')+'</div>'+
        '<div class="debrief-grid">'+
          '<div><div class="score-total">'+String(sc.total||0)+'</div>'+this.scoreTable(sc.breakdown||{})+'</div>'+
          '<div class="pilot-form">'+
            '<label>ALIAS<input id="pilot-alias" maxlength="16" value="'+this.escape(alias)+'" autocomplete="off" spellcheck="false"><span>Forced uppercase. A-Z and 0-9 only. Max 16 characters.</span></label>'+
            '<label>COUNTRY<select id="pilot-country">'+opts+'</select><span>Stored as a 2-letter country code.</span></label>'+
            '<div class="save-status" id="debrief-status">Mission result saves automatically.</div>'+
            '<button data-action="continue">CONTINUE</button>'+
            '<button data-action="watch-current" class="secondary">WATCH REPLAY</button>'+
            '<button data-action="main-menu" class="secondary">MAIN MENU</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    var csel = modal.querySelector('#pilot-country');
    if (csel) csel.value = /^[A-Z]{2}$/.test(country) ? country : 'ZZ';
    this.showModal('modal-debrief');
  },

  scoreTable:function(b){
    var rows = [
      ['primaryTargets','Primary Targets'],['secondaryTargets','Secondary Targets'],['enemyAircraft','Enemy Aircraft'],['samSites','SAM / Emitters'],
      ['waypointDiscipline','Waypoint Discipline'],['weaponDiscipline','Weapon Discipline'],['takeoff','Takeoff'],['survival','Survival'],['penalties','Penalties'],
      ['levelMultiplier','Level Multiplier'],['outcomeMultiplier','Outcome Multiplier']
    ];
    var h = '<table id="score-breakdown"><tbody>';
    rows.forEach(function(r){ if (b[r[0]] !== undefined) h += '<tr><td>'+r[1]+'</td><td>'+b[r[0]]+'</td></tr>'; });
    return h + '</tbody></table>';
  },

  readPilot:function(){
    var a = document.getElementById('pilot-alias');
    var c = document.getElementById('pilot-country');
    var alias = String(a && a.value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16);
    if (a) a.value = alias;
    var country = String(c && c.value || '').toUpperCase().replace(/[^A-Z]/g,'').slice(0,2);
    if (!/^[A-Z0-9]{1,16}$/.test(alias)) return { ok:false, error:'Alias must be 1-16 uppercase letters/numbers only.' };
    if (!/^[A-Z]{2}$/.test(country)) return { ok:false, error:'Select a country.' };
    return { ok:true, alias:alias, country:country };
  },

  saveDebriefThen:function(next){
    var self = this;
    var info = this.readPilot();
    var status = document.getElementById('debrief-status');
    if (!info.ok){ if (status) status.textContent = info.error; return; }
    ReplaySettings.set('alias', info.alias);
    ReplaySettings.set('country', info.country);
    if (status) status.textContent = 'Saving mission result...';
    var p = this.savedDebriefRecord ? Promise.resolve(this.savedDebriefRecord) : GameFlow.completeDebrief(info);
    p.then(function(record){
      self.savedDebriefRecord = record;
      if (status) status.textContent = 'Mission saved.';
      if (next === 'watch') GameFlow.playReplay(record);
      else GameFlow.returnToMenu();
    }).catch(function(err){
      if (status) status.textContent = 'Unable to save mission result: '+(err && err.message ? err.message : 'storage error');
    });
  },

  openReplayBrowser:function(){
    this.init();
    this.showModal('modal-browser');
    var modal = document.getElementById('modal-browser');
    modal.innerHTML = '<div class="game-card browser-card"><div class="browser-head"><div><div class="game-kicker">SCOREBOARD / REPLAYS</div><h2>PAST MISSIONS</h2></div><button data-action="close-browser">CLOSE</button></div><div class="replay-table-wrap"><div class="empty-replay">Loading...</div></div><div class="menu-foot">Full replay data is loaded only when Watch is selected.</div></div>';
    if (window.GameFlow) { GameFlow.replayBrowserReturnState = GameFlow.state; GameFlow.set(GAME_STATES.REPLAY_BROWSER, { keepPause:true }); }
    var self = this;
    ReplayStore.list().then(function(list){ self.renderReplayList(list); }).catch(function(){ self.renderReplayList([]); });
  },

  renderReplayList:function(list){
    var wrap = document.querySelector('#modal-browser .replay-table-wrap');
    if (!wrap) return;
    if (!list || !list.length){ wrap.innerHTML = '<div class="empty-replay">No mission replays available yet.</div>'; return; }
    var h = '<table class="replay-table"><thead><tr><th>Date</th><th>Alias</th><th>Country</th><th>Level</th><th>Outcome</th><th>Score</th><th>Time</th><th>Action</th></tr></thead><tbody>';
    for (var i=0;i<list.length;i++){
      var r = list[i];
      var d = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
      h += '<tr><td>'+this.escape(d)+'</td><td>'+this.escape(r.alias||'')+'</td><td>'+this.escape(r.country||'')+'</td><td>'+
        this.escape(r.difficultyName || String(r.level||''))+'</td><td class="outcome-'+this.escape(r.outcome||'')+'">'+this.escape(r.outcome||'')+'</td><td>'+Math.round(r.score||0)+'</td><td>'+this.formatTime(r.durationSec||0)+'</td><td><button data-action="watch-replay" data-id="'+this.escape(r.id)+'">WATCH</button></td></tr>';
    }
    wrap.innerHTML = h + '</tbody></table>';
  },

  showReplayControls:function(record){
    this.init();
    var hud = document.getElementById('replay-hud');
    if (!hud) return;
    var alias = record && record.player && record.player.alias ? record.player.alias : 'PILOT';
    alias = String(alias || 'PILOT').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16) || 'PILOT';
    var score = record && record.score ? Math.round(record.score.total || 0) : 0;
    hud.innerHTML = ''+
      '<div class="replay-core">'+
        '<div class="replay-tag">REPLAY</div>'+
        '<div class="replay-alias" id="replay-alias">'+this.escape(alias)+'</div>'+
        '<div class="replay-countdown" id="replay-countdown">T-00:00</div>'+
        '<div class="replay-elapsed" id="replay-elapsed">00:00 / 00:00</div>'+
        '<div class="replay-score">'+String(score)+'</div>'+
      '</div>'+
      '<button class="replay-arch replay-pause" data-action="replay-toggle">PAUSE</button>'+
      '<button class="replay-arch replay-restart" data-action="replay-restart">RESTART</button>'+
      '<button class="replay-arch replay-exit" data-action="replay-exit">EXIT</button>';
    hud.classList.add('show');
    this.updateReplayControls();
  },

  hideReplayControls:function(){ var hud=document.getElementById('replay-hud'); if (hud) hud.classList.remove('show'); },
  updateReplayControls:function(){
    var hud = document.getElementById('replay-hud');
    if (!hud || !ReplayPlayback || !ReplayPlayback.active) return;
    var remaining = Math.max(0, (ReplayPlayback.duration || 0) - (ReplayPlayback.time || 0));
    var cd = hud.querySelector('#replay-countdown');
    if (cd) cd.textContent = 'T-' + this.formatTime(remaining);
    var elapsed = hud.querySelector('#replay-elapsed');
    if (elapsed) elapsed.textContent = this.formatTime(ReplayPlayback.time)+' / '+this.formatTime(ReplayPlayback.duration);
    var b = hud.querySelector('button[data-action="replay-toggle"]');
    if (b) b.textContent = ReplayPlayback.playing ? 'PAUSE' : 'PLAY';
  },

  handleEscape:function(){
    if (ReplayPlayback && ReplayPlayback.active){ GameFlow.returnToMenu(); return true; }
    var controls = document.getElementById('controls-modal');
    if (controls && controls.classList.contains('show')){ toggleControls(false); return true; }
    if (document.getElementById('lesson-menu')){ if (typeof closeLessonMenu === 'function') closeLessonMenu(); else if (typeof removeLessonMenu === 'function') removeLessonMenu(); return true; }
    if (GameFlow.state === GAME_STATES.REPLAY_BROWSER){ if (GameFlow.closeReplayBrowser) GameFlow.closeReplayBrowser(); else GameFlow.returnToMenu(); return true; }
    if (GameFlow.state === GAME_STATES.DEBRIEF){ GameFlow.returnToMenu(); return true; }
    return false;
  },

  formatTime:function(sec){ sec=Math.max(0, sec||0); var m=Math.floor(sec/60), s=Math.floor(sec%60); return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); },
  escape:function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
};
window.MenuUI = MenuUI;
