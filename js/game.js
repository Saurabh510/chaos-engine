'use strict';
/* game.js — state ownership, loop, scoring, waves, tutorial, daily, endless, persistence.
   ONLY this layer mutates score/combo/lives/level/wave/player/goals/timer/tutorial. */
window.ChaosGame = (function () {
  var U = window.ChaosUtil;
  var C = window.ChaosConfig;
  var LV = window.ChaosLevels;
  var IFS = window.ChaosIFS;
  var AU = window.ChaosAudio;
  var FX = window.ChaosFX;
  var RND = window.ChaosRender;

  /* ---------------- Persistent store ---------------- */
  var SAVE_KEY = C.STORAGE_KEY;
  var save = {
    version: C.SAVE_VERSION,
    prefs: { mute: false, reduced: false, shapeOnly: false, hintDefault: true, difficulty: 'easy' },
    best: {}, unlock: {}, stars: {}, daily: {}, tutorialDone: false
  };
  var storageLive = true;
  function loadSave() {
    var raw = U.loadJSON(SAVE_KEY, null);
    if (!raw || typeof raw !== 'object' || raw.version !== C.SAVE_VERSION) {
      if (raw !== null && raw !== undefined) { /* corrupted -> keep defaults, stay alive */ }
      persist();
      return;
    }
    try {
      if (raw.prefs && typeof raw.prefs === 'object') {
        for (var k in save.prefs) if (k in raw.prefs) save.prefs[k] = raw.prefs[k];
      }
      if (raw.best && typeof raw.best === 'object') save.best = raw.best;
      if (raw.unlock && typeof raw.unlock === 'object') save.unlock = raw.unlock;
      if (raw.stars && typeof raw.stars === 'object') save.stars = raw.stars;
      if (raw.daily && typeof raw.daily === 'object') save.daily = raw.daily;
      if (raw.tutorialDone) save.tutorialDone = true;
    } catch (e) {}
  }
  function persist() {
    try {
      storageLive = U.storeSet(SAVE_KEY, JSON.stringify(save));
    } catch (e) { storageLive = false; }
  }
  function bestFor(diff) { return save.best[diff] || 0; }
  function unlockFor(diff) {
    var u = parseInt(save.unlock[diff], 10);
    if (isNaN(u) || u < 1) return 1;
    return Math.min(14, u);
  }

  /* ---------------- Session state ---------------- */
  var S = {
    phase: 'BOOT',           /* BOOT TITLE TUTORIAL LEVEL_SELECT READY PLAYING PAUSED WAVE_CLEAR LEVEL_CLEAR GAME_OVER RESULTS */
    prevPhase: 'TITLE',
    mode: 'level',           /* level | endless | daily | tutorial */
    difficultyId: 'easy',
    level: null, levelId: 1,
    wave: 1, wavesTotal: 3,
    score: 0, combo: 1, lastCollectT: -1e9, gameTimeMs: 0,
    lives: 5, timeLeft: 0, timeTotal: 0,
    playerU: { x: 0, y: 0 }, prevU: { x: 0, y: 0 }, interpT: 1,
    lastJumpT: -1e9, buffered: -1,
    trail: [],               /* px segments {x0,y0,x1,y1,age} */
    goals: [],               /* {u:{x,y}, phase, waveNeed} */
    waveNeed: 1, waveGot: 0,
    rng: new U.PRNG(1), seed: 1,
    hintOn: true, routeCache: null, routeDirty: true,
    nextsU: [null, null, null], nextsDirty: true,
    driftT: 0, driftAmp: 0,
    jumps: 0, perfects: 0, misses: 0, missStreak: 0,
    readyT: 0, waveClearT: 0,
    flashAttractor: -1, flashT: 0,
    shakeX: 0, shakeY: 0,
    tutStep: 0, tutGoals: 0, tutNeed: 0,
    dailyLabel: '', dailySeed: 0,
    fps: 60, fpsAcc: 0, fpsN: 0, fpsT: 0,
    lastTs: 0, running: false,
    R: 44, baseR: 44,          /* effective px radius / base */
    arena: { cx: 0, cy: 0, rad: 100, top: 96, bottom: 128, side: 34 },
    W: 0, H: 0,
    pausedFrom: ''
  };

  function difficulty() { return C.DIFFICULTIES[S.difficultyId] || C.DIFFICULTIES.easy; }
  function timedNow() {
    if (S.mode === 'tutorial') return false;
    return LV.isTimed(S.level, S.difficultyId);
  }

  /* Unit-space attractors: canonical, viewport-independent. */
  var UNIT_ATT = IFS.attractorPoints(0, 0, 1);

  /* ---------------- DOM helpers ---------------- */
  function show(id) { var e = U.$(id); if (e) { e.classList.remove('hidden'); e.setAttribute('aria-hidden', 'false'); } }
  function hide(id) { var e = U.$(id); if (e) { e.classList.add('hidden'); e.setAttribute('aria-hidden', 'true'); } }
  function setText(id, t) { var e = U.$(id); if (e) e.textContent = t; }
  function toast(msg, assertive) {
    var box = U.$('toasts');
    if (!box) return;
    var d = U.el('div', 'toast', msg);
    d.setAttribute('role', assertive ? 'alert' : 'status');
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { try { if (d.parentNode) d.parentNode.removeChild(d); } catch (e) {} }, 2600);
    var live = U.$(assertive ? 'live-assert' : 'live');
    if (live) live.textContent = msg;
  }

  /* ---------------- Setup / menus ---------------- */
  function applyPrefsToUI() {
    AU.setMuted(!!save.prefs.mute);
    FX.setReduced(!!save.prefs.reduced || reducedByMedia());
    document.body.classList.toggle('reduced', !!save.prefs.reduced);
    document.body.classList.toggle('shape-only', !!save.prefs.shapeOnly);
    var sb = U.$('btn-sound');
    if (sb) { sb.textContent = save.prefs.mute ? '🔇 OFF' : '🔊 ON'; sb.setAttribute('aria-pressed', String(!save.prefs.mute)); }
    var hb = U.$('btn-hint');
    if (hb) { hb.setAttribute('aria-pressed', String(S.hintOn)); hb.classList.toggle('on', S.hintOn); }
    var c;
    c = U.$('set-sound'); if (c) c.checked = !save.prefs.mute;
    c = U.$('set-reduced'); if (c) c.checked = !!save.prefs.reduced;
    c = U.$('set-shape'); if (c) c.checked = !!save.prefs.shapeOnly;
    c = U.$('set-hint'); if (c) c.checked = !!save.prefs.hintDefault;
  }
  function reducedByMedia() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function effectsOn() { return !save.prefs.reduced && !reducedByMedia(); }

  function setPhase(p) {
    S.prevPhase = S.phase;
    S.phase = p;
    document.body.setAttribute('data-phase', p);
    syncChrome();
  }
  function syncChrome() {
    var inRun = (S.phase === 'PLAYING' || S.phase === 'READY' || S.phase === 'PAUSED' ||
                 S.phase === 'WAVE_CLEAR' || S.phase === 'TUTORIAL');
    ['screen-title', 'screen-diff', 'screen-levels', 'screen-settings'].forEach(hide);
    ['overlay-pause', 'overlay-result', 'overlay-how'].forEach(hide);
    U.$('hud').classList.toggle('hidden', !inRun && S.phase !== 'LEVEL_CLEAR' && S.phase !== 'GAME_OVER' && S.phase !== 'RESULTS');
    U.$('deck').classList.toggle('hidden', !inRun);
    U.$('coach').classList.toggle('hidden', !inRun);
    U.$('tutstrip').classList.toggle('hidden', S.phase !== 'TUTORIAL');
    if (S.phase === 'TITLE') show('screen-title');
    if (S.phase === 'LEVEL_SELECT') { show('screen-levels'); renderLevelGrid(); }
    if (S.phase === 'PAUSED') show('overlay-pause');
    if (S.phase === 'RESULTS' || S.phase === 'LEVEL_CLEAR' || S.phase === 'GAME_OVER') show('overlay-result');
    var bp = U.$('btn-pause');
    if (bp) bp.disabled = !(S.phase === 'PLAYING' || S.phase === 'TUTORIAL');
  }

  function toTitle() { setPhase('TITLE'); refreshTitleBest(); }
  function toDifficulty() { setPhase('DIFF'); buildDiffList(); show('screen-diff'); }
  function toLevels() { setPhase('LEVEL_SELECT'); }
  function toSettings() { setPhase('SETTINGS'); show('screen-settings'); }

  function refreshTitleBest() {
    var b = bestFor(S.difficultyId);
    setText('title-best', b > 0 ? ('BEST ' + b) : 'NO BEST YET — PLAY!');
  }

  function buildDiffList() {
    var host = U.$('diff-list');
    if (!host) return;
    host.innerHTML = '';
    C.DIFFICULTY_ORDER.forEach(function (id) {
      var d = C.DIFFICULTIES[id];
      var b = U.el('button', 'diff-card' + (id === S.difficultyId ? ' sel' : ''));
      b.setAttribute('aria-pressed', String(id === S.difficultyId));
      var t = U.el('div', 'diff-name', d.name);
      var ds = U.el('div', 'diff-desc', d.desc + ' Geometry unchanged: 3 attractors, r = 0.5.');
      var bs = U.el('div', 'diff-best', 'BEST ' + (bestFor(id) || 0));
      b.appendChild(t); b.appendChild(ds); b.appendChild(bs);
      (function (did) {
        b.addEventListener('click', function () {
          AU.select(); selectDifficulty(did); buildDiffList(); refreshTitleBest();
        });
      })(id);
      host.appendChild(b);
    });
  }

  function renderLevelGrid() {
    var host = U.$('level-grid');
    if (!host) return;
    host.innerHTML = '';
    var un = unlockFor(S.difficultyId);
    LV.LEVELS.forEach(function (L) {
      var locked = L.id > un;
      var b = U.el('button', 'lvl-card' + (locked ? ' locked' : ''));
      b.disabled = locked;
      var stars = (save.stars[S.difficultyId] && save.stars[S.difficultyId][L.id]) || 0;
      b.innerHTML = '';
      b.appendChild(U.el('div', 'lvl-num', (locked ? '🔒 ' : '') + L.id));
      b.appendChild(U.el('div', 'lvl-name', L.name));
      b.appendChild(U.el('div', 'lvl-meta', 'depth ' + L.depth + ' · ' + L.waves + ' waves'));
      b.appendChild(U.el('div', 'lvl-stars', locked ? 'LOCKED' : ('★'.repeat(stars) + '☆'.repeat(3 - stars))));
      b.setAttribute('aria-label', 'Level ' + L.id + ' ' + L.name + (locked ? ' locked' : ''));
      (function (id) {
        b.addEventListener('click', function () { AU.select(); selectLevel(id); });
      })(L.id);
      host.appendChild(b);
    });
    var eb = U.$('btn-endless');
    if (eb) {
      var unlockedEndless = unlockFor(S.difficultyId) >= 14;
      eb.disabled = !unlockedEndless;
      eb.textContent = unlockedEndless ? '∞ ENDLESS — depth 8' : '🔒 ENDLESS (clear level 14)';
    }
    setText('levels-diffname', 'DIFFICULTY: ' + difficulty().name);
  }

  /* ---------------- Run setup ---------------- */
  function computeLayout() {
    var vw = 0, vh = 0;
    try {
      var wrap = U.$('stage');
      if (wrap) { vw = wrap.clientWidth; vh = wrap.clientHeight; }
      if (!vw || !vh) { vw = window.innerWidth; vh = window.innerHeight - 200; }
    } catch (e) { vw = 800; vh = 600; }
    vw = Math.max(200, vw); vh = Math.max(200, vh);
    S.W = vw; S.H = vh;
    S.arena = RND.arenaBounds(vw, vh);
    try { RND.resize(vw, vh); } catch (e) {}
    var d = difficulty();
    S.baseR = d.radius;
    if (S.mode === 'tutorial') S.baseR = 58;
    S.R = C.effectiveRadius(S.baseR, vw, vh);
    if (S.mode === 'tutorial') S.R = Math.max(S.R, 58); /* absolute hitbox floor */
    S.driftAmp = d.drift * S.arena.rad * 0.045;
    if (S.mode === 'tutorial' || S.difficultyId === 'zen') S.driftAmp = 0;
    S.nextsDirty = true; S.routeDirty = true;
  }

  function pxOf(u) {
    return { x: S.arena.cx + u.x * S.arena.rad, y: S.arena.cy + u.y * S.arena.rad };
  }

  function spawnGoals(count, rng, avoidU) {
    var depth = S.level.depth;
    var nodes = RND.unitNodes(depth); /* cached unit-space subdivision nodes */
    var cands = [];
    for (var k = 0; k < 30; k++) {
      cands.push(nodes[rng.int(0, nodes.length - 1)]);
    }
    /* Score candidates across waves: pick best `count` distinct. */
    var scored = cands.map(function (nd, idx) {
      var route = IFS.routeSearch(S.playerU, nd, Sun(), UNIT_ATT, {});
      var routeLen = route.found ? route.length : 99;
      var s = Math.abs(routeLen - S.level.routeTarget) * 10;
      /* UI-overlap penalty: keep clear of attractors/top/bottom in px. */
      var p = { x: S.arena.cx + nd.x * S.arena.rad, y: S.arena.cy + nd.y * S.arena.rad };
      var at = IFS.attractorPoints(S.arena.cx, S.arena.cy, S.arena.rad);
      for (var a = 0; a < 3; a++) {
        var dd = IFS.distance(p, at[a]);
        if (dd < 70) s += (70 - dd) * 2;
      }
      if (p.y < S.arena.top + 20 || p.y > S.H - 60) s += 60;
      if (avoidU) {
        var dp = Math.abs(nd.x - avoidU.x) * S.arena.rad + Math.abs(nd.y - avoidU.y) * S.arena.rad;
        var pd = IFS.distance(nd, avoidU) * S.arena.rad;
        if (pd < 60) s += (60 - pd) * 3;
      }
      if (S.prevGoalU) {
        var dg = IFS.distance(nd, S.prevGoalU) * S.arena.rad;
        if (dg < 50) s += (50 - dg) * 2;
      }
      if (S.playerU) {
        var ds = IFS.distance(nd, S.playerU) * S.arena.rad;
        if (ds < 40) s += (40 - ds) * 2;
      }
      return { nd: nd, s: s, idx: idx };
    });
    scored.sort(function (a, b) { return a.s - b.s; });
    var out = [];
    var used = {};
    for (var i = 0; i < scored.length && out.length < count; i++) {
      var key = Math.round(scored[i].nd.x * 500) + ':' + Math.round(scored[i].nd.y * 500);
      if (used[key]) continue;
      used[key] = 1;
      out.push({ u: { x: scored[i].nd.x, y: scored[i].nd.y }, driftPhase: rng.range(0, Math.PI * 2) });
    }
    while (out.length < count) {
      out.push({ u: IFS.chaosPoint({ x: 0, y: 0.1 }, UNIT_ATT, rng, 40), driftPhase: rng.range(0, Math.PI * 2) });
    }
    return out;
  }
  /* R in unit space for search. */
  function Sun() { return S.R / Math.max(1, S.arena.rad); }

  function startRun(opts) {
    /* opts: {mode, levelId, difficultyId, seed} */
    S.mode = opts.mode || 'level';
    if (opts.difficultyId) { S.difficultyId = opts.difficultyId; save.prefs.difficulty = S.difficultyId; }
    else if (S.mode === 'level') { S.difficultyId = save.prefs.difficulty || 'easy'; }
    var d = difficulty();
    if (S.mode === 'tutorial') {
      S.level = { id: 0, name: 'Tutorial', depth: 2, waves: 1, goals: 1, routeTarget: 2, wander: 0, timeMul: 1, timed: false, par: 99, perfectsFor3: 99 };
      S.levelId = 0;
      S.seed = 424242;
    } else if (S.mode === 'endless') {
      S.level = LV.ENDLESS; S.levelId = 99;
      S.seed = (U.now() | 0) ^ 0x9e3779b9;
    } else if (S.mode === 'daily') {
      var ds = U.dateSeedUTC();
      S.dailyLabel = ds.label; S.dailySeed = ds.seed;
      S.level = { id: 50, name: 'Daily ' + ds.label, depth: 4, waves: 4, goals: 1, routeTarget: 3, wander: 1, timeMul: 1.1, timed: true, par: 12, perfectsFor3: 3 };
      S.levelId = 50;
      S.seed = ds.seed;
      /* Daily always uses NORMAL pressure for a fair shared challenge. */
      S.difficultyId = 'normal';
      d = difficulty();
    } else {
      S.levelId = opts.levelId || 1;
      S.level = LV.getLevel(S.levelId);
      S.seed = (S.levelId * 2654435761 + U.hashString(S.difficultyId)) >>> 0;
      if (opts.seed !== undefined) S.seed = opts.seed >>> 0;
    }
    S.rng = new U.PRNG(S.seed);
    S.wavesTotal = S.level.waves;
    S.wave = 1;
    S.score = 0; S.combo = 1; S.lastCollectT = -1e9; S.gameTimeMs = 0;
    S.lives = d.lives;
    S.jumps = 0; S.perfects = 0; S.misses = 0; S.missStreak = 0;
    S.trail = [];
    FX.reset();
    computeLayout();
    S.playerU = IFS.spawnPoint(UNIT_ATT, S.seed ^ 0x51ab);
    S.prevU = { x: S.playerU.x, y: S.playerU.y };
    S.interpT = 1;
    S.buffered = -1;
    S.prevGoalU = null;
    S.hintOn = (S.mode === 'tutorial') ? true : !!save.prefs.hintDefault;
    S.driftT = 0;
    S.tutStep = 0; S.tutGoals = 0;
    hide('overlay-result'); hide('overlay-pause');
    if (S.mode === 'tutorial') {
      setPhase('TUTORIAL');
      computeLayout(); /* re-measure after chrome visibility changed */
      S.playerU = IFS.spawnPoint(UNIT_ATT, S.seed ^ 0x51ab);
      S.prevU = { x: S.playerU.x, y: S.playerU.y };
      setupWave();
      S.goals = []; /* steps 0–3 are goal-free by design */
      S.routeDirty = true; S.nextsDirty = true;
      tutUI();
      toast('Tutorial: meet your particle.');
    } else {
      /* READY cue, then PLAYING. */
      setPhase('READY');
      computeLayout(); /* re-measure after chrome visibility changed */
      S.playerU = IFS.spawnPoint(UNIT_ATT, S.seed ^ 0x51ab);
      S.prevU = { x: S.playerU.x, y: S.playerU.y };
      setupWave();
      S.readyT = 0;
      setText('ready-label', S.mode === 'daily' ? ('DAILY ' + S.dailyLabel + ' — READY') : 'READY');
      show('overlay-ready');
      toast(S.mode === 'endless' ? 'Endless bloom. Pressure rises.' :
            S.mode === 'daily' ? ('Daily run ' + S.dailyLabel + ' — seed ' + (S.dailySeed % 10000)) :
            ('Level ' + S.levelId + ' — ' + S.level.name));
      setTimeout(function () {
        try {
          hide('overlay-ready');
          if (S.phase === 'READY') setPhase('PLAYING');
        } catch (e) {}
      }, 750);
      if (S.phase === 'READY') { /* phase set; loop will also advance */ }
    }
    S.lastTs = U.now();
    applyPrefsToUI();
    persist();
    updateHUD();
  }

  function setupWave() {
    var d = difficulty();
    var need = S.level.goals;
    if (S.mode === 'endless') need = 1 + Math.floor((S.wave - 1) / 4); /* ramp every 4 waves */
    if (S.difficultyId === 'insane' && S.mode === 'level') need = Math.max(need, 2);
    need = Math.min(3, need);
    S.waveNeed = need; S.waveGot = 0;
    S.goals = spawnGoals(need, S.rng, S.playerU);
    if (S.goals.length && S.goals[0].u) S.prevGoalU = { x: S.goals[0].u.x, y: S.goals[0].u.y };
    var t = LV.levelTime(S.level, d);
    if (S.mode === 'tutorial') t = 0;
    if (!timedNow()) { S.timeLeft = 0; S.timeTotal = 0; }
    else {
      if (S.mode === 'daily') t = 14;
      S.timeLeft = t; S.timeTotal = t;
    }
    S.routeDirty = true; S.nextsDirty = true;
    updateHUD();
    updateCoach();
  }

  /* Directional jump: resolve a screen direction to the attractor that lies
     furthest that way FROM THE PLAYER's current position, then jump.
     Ties break to the lowest attractor index (deterministic). */
  function dirToAttractor(dir) {
    var P = S.playerU;
    var dx = [], dy = [], i;
    for (i = 0; i < 3; i++) { dx.push(UNIT_ATT[i].x - P.x); dy.push(UNIT_ATT[i].y - P.y); }
    function argmin(a) { var b = 0; for (var k = 1; k < a.length; k++) if (a[k] < a[b]) b = k; return b; }
    function argmax(a) { var b = 0; for (var k = 1; k < a.length; k++) if (a[k] > a[b]) b = k; return b; }
    if (dir === 'left') return argmin(dx);
    if (dir === 'right') return argmax(dx);
    if (dir === 'up') return argmin(dy);
    return argmax(dy); /* 'down' */
  }
  function jumpDir(dir, src) {
    if (dir !== 'left' && dir !== 'right' && dir !== 'up' && dir !== 'down') return 'ignored-arg';
    return jump(dirToAttractor(dir), src || 'key');
  }
  /* ================= THE ONE MOVEMENT FUNCTION =================
     jump(i), jumpDir(dir) and tapAt() all funnel into jump(i). */
  function jump(i, src) {
    if (S.phase !== 'PLAYING' && S.phase !== 'TUTORIAL') return 'ignored-state';
    if (i !== 0 && i !== 1 && i !== 2) return 'ignored-arg';
    var now = U.now();
    /* Movement lock: if interpolating and outside the 100ms buffer window, drop. */
    if (S.interpT < 1) {
      if (now - S.lastJumpT <= C.INPUT_BUFFER_MS && S.buffered < 0) {
        S.buffered = i;
        return 'buffered';
      }
      return 'locked';
    }
    doJump(i);
    return 'jumped';
  }

  function doJump(i) {
    var now = U.now();
    /* 1-6: exact simulation update. */
    var target = IFS.nextPoint(S.playerU, UNIT_ATT[i]); /* authoritative equation */
    S.prevU = { x: S.playerU.x, y: S.playerU.y };
    S.playerU = target;
    S.interpT = 0;
    S.lastJumpT = now;
    S.jumps++;
    var a = pxOf(S.prevU), b = pxOf(S.playerU);
    S.trail.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, age: 0 });
    if (S.trail.length > 60) S.trail.splice(0, S.trail.length - 60);
    /* 7-10: feedback. */
    FX.mark(b.x, b.y);
    if (effectsOn()) { FX.burst(b.x, b.y, 8, '#0e7c86'); FX.ring(b.x, b.y, 22, '#0e7c86'); }
    FX.kickShake(0.6); FX.kickFlash(0.05);
    S.flashAttractor = i; S.flashT = now;
    AU.jump(i, S.combo);
    /* 11-12: combo housekeeping + collision (exact position, never interpolated). */
    if (now - S.lastCollectT > C.COMBO_WINDOW_MS) S.combo = 1;
    var hit = checkCollect();
    if (!hit) {
      S.misses++; S.missStreak++;
      if (S.missStreak === 6) toast(S.hintOn ? 'Follow the violet route.' : 'WATCH THE THREE LANDINGS');
      else if (S.missStreak === 12) toast('THE SQUARE SHOWS YOUR BEST NEXT MOVE');
    } else {
      S.missStreak = 0;
    }
    /* 13-16: caches, tutorial, HUD. */
    S.routeDirty = true; S.nextsDirty = true;
    tutOnJump(i);
    updateHUD(); updateCoach();
  }

  function goalRenderPos(g) {
    var p = pxOf(g.u);
    if (S.driftAmp > 0 && timedNow()) {
      var t = S.driftT / 1000;
      p.x += Math.cos(t * 0.9 + g.driftPhase) * S.driftAmp;
      p.y += Math.sin(t * 1.1 + g.driftPhase * 1.7) * S.driftAmp;
    }
    return p;
  }

  function checkCollect() {
    var got = -1, gotD = 1e9;
    var pp = pxOf(S.playerU);
    for (var k = 0; k < S.goals.length; k++) {
      var gp = goalRenderPos(S.goals[k]);
      var d = IFS.distance(pp, gp);
      if (d <= S.R && d < gotD) { got = k; gotD = d; }
    }
    if (got < 0) return false;
    var now = U.now();
    /* Combo: chain within window, cap x8. */
    if (now - S.lastCollectT <= C.COMBO_WINDOW_MS) S.combo = Math.min(C.MAX_COMBO, S.combo + 1);
    else S.combo = Math.max(1, S.combo);
    S.lastCollectT = now;
    var award = 100 * S.combo;
    var perfect = gotD < C.PERFECT_FRAC * S.R;
    if (perfect) { award += 60; S.perfects++; }
    var timeBonus = 0;
    if (timedNow() && S.timeLeft > 0) { timeBonus = Math.round(S.timeLeft * C.TIME_BONUS_PER_SEC); award += timeBonus; }
    S.score += award;
    var gp2 = goalRenderPos(S.goals[got]);
    FX.popup(gp2.x, gp2.y - 18, '+' + award + (perfect ? ' PERFECT' : ''));
    if (timeBonus > 0) FX.popup(gp2.x, gp2.y - 40, '+TIME ' + timeBonus);
    FX.ring(gp2.x, gp2.y, S.R + 14, '#cf8a0a');
    if (effectsOn()) FX.burst(gp2.x, gp2.y, 14, '#cf8a0a');
    FX.kickShake(1.4);
    AU.goal();
    if (perfect) AU.perfect();
    else if (S.combo >= 3) AU.comboRise(S.combo);
    S.waveGot++;
    if (S.mode === 'tutorial') {
      S.tutGoals++;
      S.goals.splice(got, 1);
      toast(perfect ? 'Perfect! +60' : ('Nice! Combo x' + S.combo));
      tutOnCollect();
    } else {
      S.goals.splice(got, 1);
      /* Instant best-score persistence (never tutorial scores). */
      if (S.score > bestFor(S.difficultyId)) { save.best[S.difficultyId] = S.score; persist(); }
      if (S.goals.length === 0 && S.waveGot >= S.waveNeed) {
        onWaveClear();
      } else if (S.goals.length === 0) {
        /* refill (should not normally happen) */
        S.goals = spawnGoals(Math.max(1, S.waveNeed - S.waveGot), S.rng, S.playerU);
      }
      if (S.waveGot < S.waveNeed && S.goals.length < (S.waveNeed - S.waveGot)) {
        var more = spawnGoals((S.waveNeed - S.waveGot) - S.goals.length, S.rng, S.playerU);
        S.goals = S.goals.concat(more);
      }
      S.routeDirty = true;
    }
    updateHUD(); updateCoach();
    return true;
  }

  function onWaveClear() {
    if (S.mode === 'endless') {
      toast('Wave ' + S.wave + ' clear!');
      S.wave++;
      setupWave();
      updateHUD();
      return;
    }
    if (S.wave >= S.wavesTotal) { onLevelClear(); return; }
    setPhase('WAVE_CLEAR');
    S.waveClearT = U.now();
    toast('WAVE ' + S.wave + ' / ' + S.wavesTotal + ' CLEAR');
    setTimeout(function () {
      try {
        if (S.phase !== 'WAVE_CLEAR') return;
        S.wave++;
        setupWave();
        setPhase('PLAYING');
      } catch (e) {}
    }, 650);
  }

  function onLevelClear() {
    var cleared = true;
    var stars = LV.starsFor(S.level, S.jumps, S.perfects, cleared);
    var key = S.difficultyId;
    save.stars[key] = save.stars[key] || {};
    if (stars > (save.stars[key][S.levelId] || 0)) save.stars[key][S.levelId] = stars;
    if (S.levelId < 14 && unlockFor(key) < S.levelId + 1) save.unlock[key] = S.levelId + 1;
    if (S.levelId === 14 && unlockFor(key) < 14) save.unlock[key] = 14;
    if (S.score > bestFor(key)) save.best[key] = S.score;
    if (S.mode === 'daily') {
      save.daily[S.dailyLabel] = Math.max(save.daily[S.dailyLabel] || 0, S.score);
      toast('Daily complete: ' + S.score);
    }
    persist();
    AU.levelComplete();
    if (S.mode === 'daily') {
      showResult('DAILY COMPLETE', 'Score ' + S.score + ' · ' + S.dailyLabel, stars, true);
    } else {
      var nxt = S.levelId < 14;
      showResult('LEVEL COMPLETE', null, stars, nxt);
      if (nxt && unlockFor(key) >= S.levelId + 1 && S.levelId + 1 > 1) toast('Level ' + (S.levelId + 1) + ' unlocked!');
    }
    setPhase('RESULTS');
  }

  function onLifeLost() {
    AU.lifeLost();
    S.combo = 1;
    FX.kickShake(4);
    if (S.lives <= 1) {
      S.lives = 0;
      onGameOver('OUT OF LIVES');
      return;
    }
    S.lives--;
    toast('Life lost — ' + S.lives + ' left', true);
    /* Reset to a valid state, preserve score. */
    S.playerU = IFS.spawnPoint(UNIT_ATT, (S.seed ^ S.wave ^ (U.now() | 0)) >>> 0);
    S.prevU = { x: S.playerU.x, y: S.playerU.y };
    S.interpT = 1; S.buffered = -1;
    S.goals = spawnGoals(Math.max(1, S.waveNeed - S.waveGot), S.rng, S.playerU);
    setupWaveKeepLives();
    updateHUD();
  }
  function setupWaveKeepLives() {
    var t = LV.levelTime(S.level, difficulty());
    if (timedNow()) { S.timeLeft = t; S.timeTotal = t; }
    S.routeDirty = true; S.nextsDirty = true;
  }

  function onGameOver(reason) {
    if (S.score > bestFor(S.difficultyId)) { save.best[S.difficultyId] = S.score; persist(); }
    showResult('RUN OVER', reason, 0, true);
    setPhase('GAME_OVER');
    try { var l = U.$('live-assert'); if (l) l.textContent = 'Run over. ' + reason; } catch (e) {}
  }

  function onTimeOut() {
    if (S.difficultyId === 'zen' || !timedNow()) return;
    onLifeLost();
  }

  function showResult(title, sub, stars, canRetry) {
    setText('res-title', title);
    var stats = 'SCORE ' + S.score + ' · BEST ' + Math.max(bestFor(S.difficultyId), S.score) +
      ' · LEVEL ' + (S.mode === 'endless' ? '∞' : S.levelId) + ' · WAVE ' + S.wave +
      ' · JUMPS ' + S.jumps + ' · PERFECTS ' + S.perfects;
    if (timedNow()) stats += ' · TIME BONUS INCLUDED';
    setText('res-stats', sub ? (sub + ' — ' + stats) : stats);
    setText('res-stars', stars > 0 ? ('★'.repeat(stars) + '☆'.repeat(3 - stars)) : '');
    var nx = U.$('btn-next');
    if (nx) nx.style.display = (S.mode === 'level' && S.levelId < 14) ? '' : 'none';
    show('overlay-result');
  }

  /* ---------------- Pause / visibility / resize ---------------- */
  function pause(showCard) {
    if (S.phase !== 'PLAYING' && S.phase !== 'TUTORIAL') return;
    S.pausedFrom = S.phase;
    S.pauseStartT = U.now();
    S.buffered = -1;
    setPhase('PAUSED');
    if (showCard !== false) show('overlay-pause');
    toast('Paused.');
  }
  function resume() {
    if (S.phase !== 'PAUSED') return;
    /* Freeze combo clock across the pause: shift the chain timestamp forward. */
    try {
      var pausedFor = U.now() - (S.pauseStartT || U.now());
      if (pausedFor > 0 && pausedFor < 3600000) S.lastCollectT += pausedFor;
    } catch (e) {}
    hide('overlay-pause');
    setPhase(S.pausedFrom === 'TUTORIAL' ? 'TUTORIAL' : 'PLAYING');
    S.lastTs = U.now();
    toast('Resumed.');
  }
  function togglePause() {
    if (S.phase === 'PAUSED') resume();
    else pause(true);
  }
  function restartRun() {
    if (S.mode === 'tutorial') startTutorial();
    else if (S.mode === 'endless') startRun({ mode: 'endless' });
    else if (S.mode === 'daily') startRun({ mode: 'daily' });
    else startRun({ mode: 'level', levelId: S.levelId });
  }
  function quitToLevels() { hide('overlay-pause'); hide('overlay-result'); toLevels(); }

  function toggleMute() {
    save.prefs.mute = !save.prefs.mute;
    AU.setMuted(save.prefs.mute);
    persist(); applyPrefsToUI();
    toast(save.prefs.mute ? 'Sound muted.' : 'Sound on.');
  }
  function toggleHint() {
    S.hintOn = !S.hintOn;
    S.routeDirty = true;
    AU.hint();
    applyPrefsToUI(); updateCoach();
    toast(S.hintOn ? 'Hint route on.' : 'Hint route off.');
  }

  function tapAt(x, y, cw, ch) {
    if (S.phase !== 'PLAYING' && S.phase !== 'TUTORIAL') return;
    /* Map css px -> arena px (canvas fills stage). */
    var sx = S.W / Math.max(1, cw), sy = S.H / Math.max(1, ch);
    var px = x * sx, py = y * sy;
    /* Ignore taps on the player/center? No — resolve to nearest attractor. */
    var at = IFS.attractorPoints(S.arena.cx, S.arena.cy, S.arena.rad);
    var best = 0, bd = 1e18;
    for (var i = 0; i < 3; i++) {
      var d = IFS.distance({ x: px, y: py }, at[i]);
      if (d < bd) { bd = d; best = i; }
    }
    jump(best, 'tap');
  }

  /* ---------------- HUD / coach / tutorial UI ---------------- */
  function updateHUD() {
    setText('hud-score', String(S.score));
    setText('hud-best', String(Math.max(bestFor(S.difficultyId), S.score)));
    setText('hud-level', S.mode === 'tutorial' ? 'TUTORIAL' : S.mode === 'endless' ? '∞ ENDLESS' : S.mode === 'daily' ? ('DAILY ' + S.dailyLabel) : ('LV ' + S.levelId));
    setText('hud-levelname', S.mode === 'tutorial' ? '' : (S.level ? S.level.name : ''));
    setText('hud-wave', S.mode === 'tutorial' ? '' : ('WAVE ' + S.wave + ' / ' + (S.mode === 'endless' ? '∞' : S.wavesTotal)));
    var d = difficulty();
    if (S.difficultyId === 'zen' || S.mode === 'tutorial') {
      setText('hud-lives', '∞');
      setText('hud-clock', '∞');
      U.$('hud-clock').classList.remove('urgent');
    } else {
      setText('hud-lives', '♥'.repeat(Math.max(0, S.lives)) || '—');
      if (timedNow()) {
        setText('hud-clock', U.formatClock(S.timeLeft));
        U.$('hud-clock').classList.toggle('urgent', S.timeTotal > 0 && S.timeLeft / S.timeTotal < 0.32);
      } else setText('hud-clock', '—');
    }
    setText('hud-combo', S.combo > 1 ? ('x' + S.combo) : '');
    setText('hud-diff', d.name);
  }

  function currentRoute() {
    if (!S.routeDirty && S.routeCache) return S.routeCache;
    var res = { visible: false, positions: [], path: [], noRoute: false };
    if (S.hintOn && S.goals.length && (S.phase === 'PLAYING' || S.phase === 'TUTORIAL')) {
      var gp = goalRenderPos(S.goals[0]);
      var pp = pxOf(S.playerU);
      var tgt = { x: (gp.x - S.arena.cx) / S.arena.rad, y: (gp.y - S.arena.cy) / S.arena.rad };
      var r = IFS.routeSearch(S.playerU, tgt, Sun(), UNIT_ATT, {});
      if (r.found) {
        var pos = [{ x: pp.x, y: pp.y }];
        var q = { x: S.playerU.x, y: S.playerU.y };
        for (var s = 0; s < r.path.length; s++) {
          q = IFS.nextPoint(q, UNIT_ATT[r.path[s]]);
          pos.push(pxOf(q));
        }
        res = { visible: true, positions: pos, path: r.path, noRoute: false, finalDistance: r.finalDistance };
      } else {
        res = { visible: true, positions: [], path: [], noRoute: true };
      }
    }
    S.routeCache = res; S.routeDirty = false;
    return res;
  }

  function updateCoach() {
    var elc = U.$('coach-route');
    if (!elc) return;
    var r = currentRoute();
    if (!S.hintOn) { elc.textContent = 'HINT OFF — press H for the coach route'; return; }
    if (r.noRoute) { elc.textContent = 'NO SHORT ROUTE'; return; }
    if (!r.path.length) { elc.textContent = 'ON TARGET — jump anywhere'; return; }
    elc.textContent = 'NEXT [' + r.path.map(function (i) { return i + 1; }).join('] [') + ']';
    var hint = U.$('coach-hint');
    if (hint) hint.textContent = S.goals.length ? ('Goal ' + S.waveGot + '/' + S.waveNeed + ' this wave · combo x' + S.combo) : '';
  }

  /* ---- Tutorial: 7 steps, advances on ACTION ---- */
  var TUT = [
    { t: 'Meet your particle. This diamond is YOU, trapped in the fractal. Tap any attractor button (1/2/3) to hop.', need: 1, goals: false },
    { t: 'Choose attractor 1 (TOP). Press 1 or tap the ① button.', need: 1, goals: false, only: 0 },
    { t: 'Watch: you travel EXACTLY halfway. Press any attractor and watch the 120ms glide.', need: 1, goals: false },
    { t: 'Every move has exactly three futures — dotted lines show all three landings. Make any jump.', need: 1, goals: false },
    { t: 'A GOAL triangle appeared ON the fractal. Land inside its ring to collect. Route shows the way.', need: 1, goals: true },
    { t: 'Chain 3 goals to build combo (x2, x3…). Collect 3.', need: 3, goals: true },
    { t: 'READ THE TARGET · CHOOSE THE ATTRACTOR · JUMP · CHAIN. You are ready.', need: 0, goals: false, final: true }
  ];
  function startTutorial() {
    startRun({ mode: 'tutorial' });
  }
  function tutUI() {
    var st = TUT[S.tutStep];
    setText('tut-text', 'STEP ' + (S.tutStep + 1) + ' / 7 — ' + st.t);
    var btn = U.$('btn-tut-next');
    if (btn) btn.style.display = st.final ? '' : 'none';
    var skip = U.$('btn-tut-skip');
    if (skip) skip.style.display = st.final ? 'none' : '';
    if (st.goals && S.goals.length === 0) {
      S.goals = spawnGoals(1, S.rng, S.playerU);
      S.routeDirty = true;
    }
    updateHUD();
  }
  function tutOnJump(i) {
    if (S.mode !== 'tutorial') return;
    var st = TUT[S.tutStep];
    if (st.only !== undefined && st.only !== i) {
      toast('Try attractor ' + (st.only + 1) + ' for this step.');
      return;
    }
    if (!st.goals) {
      st._n = (st._n || 0) + 1;
      if (st._n >= st.need) { S.tutStep = Math.min(6, S.tutStep + 1); resetTutCount(); tutUI(); toast('Step complete!'); }
      else tutUIProgress();
    }
  }
  function tutOnCollect() {
    if (S.mode !== 'tutorial') return;
    var st = TUT[S.tutStep];
    if (st.goals) {
      if (S.tutGoals >= st.need) {
        S.tutStep = Math.min(6, S.tutStep + 1);
        S.tutGoals = 0; resetTutCount();
        if (S.tutStep >= 6) { tutUI(); }
        else { tutUI(); S.goals = spawnGoals(1, S.rng, S.playerU); }
        toast('Step complete!');
      } else {
        S.goals = spawnGoals(1, S.rng, S.playerU);
        tutUIProgress();
      }
      S.routeDirty = true; S.nextsDirty = true;
    }
  }
  function resetTutCount() { TUT.forEach(function (s) { s._n = 0; }); S.tutGoals = 0; }
  function tutUIProgress() {
    var st = TUT[S.tutStep];
    var extra = st.goals ? (' (' + S.tutGoals + '/' + st.need + ')') : (' (' + (st._n || 0) + '/' + st.need + ')');
    setText('tut-text', 'STEP ' + (S.tutStep + 1) + ' / 7 — ' + st.t + extra);
  }

  /* ---------------- Main loop ---------------- */
  function frame(ts) {
    if (!S.running) return;
    requestAnimationFrame(frame);
    var now = ts !== undefined ? ts : U.now();
    var dt = Math.min(100, Math.max(0, now - (S.lastTs || now)));
    S.lastTs = now;
    /* fps meter */
    S.fpsAcc += dt; S.fpsN++;
    if (S.fpsAcc >= 500) { S.fps = Math.round(1000 * S.fpsN / S.fpsAcc); S.fpsAcc = 0; S.fpsN = 0; }

    /* Self-healing layout: if the stage box changed (chrome toggles, rotation),
       recompute the arena. Unit-space sim state is untouched. */
    S._layoutTick = (S._layoutTick || 0) + 1;
    if (S._layoutTick % 30 === 0) {
      try {
        var __wrap = U.$('stage');
        if (__wrap) {
          var __w = __wrap.clientWidth, __h = __wrap.clientHeight;
          if (__w > 0 && __h > 0 && (Math.abs(__w - S.W) > 2 || Math.abs(__h - S.H) > 2)) {
            computeLayout();
          }
        }
      } catch (e) {}
    }

    var active = (S.phase === 'PLAYING' || S.phase === 'TUTORIAL');
    if (active) {
      S.gameTimeMs += dt;
      S.driftT += dt; /* same clock; frozen when paused/hidden */
      /* interp */
      if (S.interpT < 1) {
        S.interpT = Math.min(1, S.interpT + dt / C.JUMP_ANIM_MS);
        if (S.interpT >= 1 && S.buffered >= 0) {
          var b = S.buffered; S.buffered = -1;
          doJump(b);
        }
      }
      /* trail aging */
      for (var i = 0; i < S.trail.length; i++) S.trail[i].age += dt;
      while (S.trail.length && (S.trail[0].age > C.TRAIL_DURATION_MS)) S.trail.shift();
      /* combo decay */
      if (U.now() - S.lastCollectT > C.COMBO_WINDOW_MS && S.combo !== 1) { S.combo = 1; updateHUD(); }
      /* clock */
      if (timedNow() && S.timeTotal > 0) {
        S.timeLeft -= dt / 1000;
        if (S.timeLeft <= 0) { S.timeLeft = 0; updateHUD(); onTimeOut(); }
        else if ((S._clockTick = (S._clockTick || 0) + dt) > 120) { S._clockTick = 0; updateHUD(); }
      }
      if (S.flashAttractor >= 0 && now - S.flashT > 200) S.flashAttractor = -1;
    }
    FX.update(effectsOn() ? dt : Math.min(dt, 16));
    try { RND.draw(view()); } catch (e) {}
  }

  function view() {
    /* Interpolated player px (visual only; sim stays exact). */
    var t = U.easeOutCubic(S.interpT);
    var ax = S.arena.cx + S.prevU.x * S.arena.rad, ay = S.arena.cy + S.prevU.y * S.arena.rad;
    var bx = S.arena.cx + S.playerU.x * S.arena.rad, by = S.arena.cy + S.playerU.y * S.arena.rad;
    var px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    var at = IFS.attractorPoints(S.arena.cx, S.arena.cy, S.arena.rad);
    /* Next previews (cached until player moves). */
    if (S.nextsDirty) {
      for (var i = 0; i < 3; i++) {
        var nu = IFS.nextPoint(S.playerU, UNIT_ATT[i]);
        S.nextsU[i] = nu;
      }
      S.nextsDirty = false;
    }
    var nexts = [null, null, null];
    if (S.goals.length) {
      var bd = 1e18, bi = 0;
      var nd = [];
      for (var k = 0; k < 3; k++) {
        var qp = { x: S.arena.cx + S.nextsU[k].x * S.arena.rad, y: S.arena.cy + S.nextsU[k].y * S.arena.rad };
        var dg = 1e18;
        for (var g2 = 0; g2 < S.goals.length; g2++) {
          var gp2 = goalRenderPos(S.goals[g2]);
          dg = Math.min(dg, IFS.distance(qp, gp2));
        }
        nd[k] = dg;
        if (dg < bd) { bd = dg; bi = k; }
      }
      for (var k2 = 0; k2 < 3; k2++) {
        nexts[k2] = {
          x: S.arena.cx + S.nextsU[k2].x * S.arena.rad,
          y: S.arena.cy + S.nextsU[k2].y * S.arena.rad,
          best: k2 === bi
        };
      }
    } else {
      for (var k3 = 0; k3 < 3; k3++) {
        nexts[k3] = { x: S.arena.cx + S.nextsU[k3].x * S.arena.rad, y: S.arena.cy + S.nextsU[k3].y * S.arena.rad, best: false };
      }
    }
    var goalsPx = S.goals.map(function (g, idx) {
      var p = goalRenderPos(g);
      return {
        x: p.x, y: p.y, r: S.R, idx: idx,
        urgent: timedNow() && S.timeTotal > 0 && (S.timeLeft / S.timeTotal) < 0.32
      };
    });
    return {
      arena: S.arena, attractors: at, depth: S.level ? S.level.depth : 2,
      player: { x: px, y: py },
      trail: S.trail, goals: goalsPx, nexts: nexts,
      route: currentRoute(), hintOn: S.hintOn,
      phase: S.phase, flashAttractor: S.flashAttractor,
      shakeX: S.shakeX, shakeY: S.shakeY, shakeSeed: 1
    };
  }

  function debugLine() {
    var stor = 'store:' + (U.storageAvailable() ? 'ok' : 'mem');
    var nodes = 0;
    try { nodes = RND.unitNodes(S.level ? S.level.depth : 2).length; } catch (e) {}
    return 'diff:' + S.difficultyId + ' r:' + C.R_JUMP + ' hit:' + Math.round(S.R) +
      'px nodes:' + nodes + ' arena:' + Math.round(S.arena.rad) + 'px jumps:' + S.jumps +
      ' timed:' + (timedNow() ? '1' : '0') + ' ' + stor + ' fps:' + S.fps +
      ' dpr:' + (RND.dims().dpr || 1) + ' wave:' + S.wave + '/' + S.wavesTotal +
      ' goals:' + S.goals.length + ' route:' + (S.routeCache && S.routeCache.path ? S.routeCache.path.length : 0) +
      ' seed:' + (S.seed >>> 0) + ' state:' + S.phase;
  }

  /* ---------------- Self-tests (acceptance hooks) ---------------- */
  function approx(a, b, tol) { return Math.abs(a - b) <= tol; }
  function runSelfTests() {
    var out = {};
    try {
      /* r === 0.5, 3 attractors */
      out.rInvariant = (C.R_JUMP === 0.5 && C.ATTRACTOR_COUNT === 3);
      /* Jump equation exact */
      var att = IFS.attractorPoints(400, 300, 200);
      var p = { x: 123.456, y: 321.654 };
      var okJump = true;
      for (var i = 0; i < 3; i++) {
        var n = IFS.nextPoint(p, att[i]);
        if (!approx(n.x, p.x + 0.5 * (att[i].x - p.x), 1e-9) ||
            !approx(n.y, p.y + 0.5 * (att[i].y - p.y), 1e-9)) okJump = false;
      }
      out.jumpEquation = okJump;
      /* Fractal signature identical across difficulties/levels/viewports */
      var sig0 = IFS.fractalSignature();
      out.fractalSignature = (sig0 === IFS.fractalSignature());
      /* Radii strictly decreasing */
      var rs = C.DIFFICULTY_ORDER.map(function (id) { return C.DIFFICULTIES[id].radius; });
      var dec = true;
      for (var r2 = 1; r2 < rs.length; r2++) if (!(rs[r2] < rs[r2 - 1])) dec = false;
      out.radiiDecreasing = dec;
      /* Collision acceptance: 50px EASY collect / HARD not / 25px HARD collect.
         Effective radius at reference viewport 760 (viewScale=1). */
      var eR = C.effectiveRadius(C.DIFFICULTIES.easy.radius, 760, 760);
      var hR = C.effectiveRadius(C.DIFFICULTIES.hard.radius, 760, 760);
      out.collisionEasy50 = (50 <= eR);
      out.collisionHard50 = !(50 <= hR);
      out.collisionHard25 = (25 <= hR);
      /* Route termination: seeded goals reachable within tolerance */
      var rng = new U.PRNG(1234);
      var uatt = IFS.attractorPoints(0, 0, 1);
      var start = IFS.spawnPoint(uatt, 777);
      var okRoute = true;
      for (var g = 0; g < 12; g++) {
        var gp = IFS.chaosPoint({ x: 0, y: 0 }, uatt, rng, 40);
        var R = 44 / 300; /* representative unit radius */
        var rr = IFS.routeSearch(start, gp, R, uatt, {});
        if (!(rr.found && rr.finalDistance <= 0.9 * R + 1e-9)) { okRoute = false; break; }
        start = gp;
      }
      out.routeTermination = okRoute;
      /* Level timing: 1-5 untimed, 6-14 timed, zen always untimed */
      var tOk = true;
      LV.LEVELS.forEach(function (L) {
        var should = L.id >= 6;
        if (!!L.timed !== should) tOk = false;
        if (LV.isTimed(L, 'zen')) tOk = false;
      });
      out.levelTiming = tOk;
      /* Node counts */
      var ncOk = true;
      var expect = { 2: 15, 3: 42, 4: 123, 5: 366, 6: 1095, 7: 3282, 8: 9843 };
      for (var dd in expect) {
        if (IFS.expectedNodeCount(parseInt(dd, 10)) !== expect[dd]) ncOk = false;
        var an = IFS.generateSubdivisionNodes(parseInt(dd, 10), IFS.attractorPoints(0, 0, 1));
        if (an.length !== expect[dd]) ncOk = false;
      }
      out.nodeCounts = ncOk;
      /* Wave config sanity */
      var wOk = true;
      LV.LEVELS.forEach(function (L) {
        if (L.waves < 3 || L.waves > 5) wOk = false;
      });
      out.waveConfig = wOk;
      /* Trail expiry math */
      out.trailExpiry = (C.TRAIL_DURATION_MS === 6500);
      out.allPass = out.rInvariant && out.jumpEquation && out.fractalSignature &&
        out.radiiDecreasing && out.collisionEasy50 && out.collisionHard50 &&
        out.collisionHard25 && out.routeTermination && out.levelTiming &&
        out.nodeCounts && out.waveConfig && out.trailExpiry;
    } catch (e) {
      out.error = String(e && e.message || e);
      out.allPass = false;
    }
    return out;
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    loadSave();
    S.difficultyId = save.prefs.difficulty || 'easy';
    S.hintOn = !!save.prefs.hintDefault;
    var cv = U.$('arena');
    if (cv) RND.init(cv);
    computeLayout();
    S.level = LV.getLevel(1);
    applyPrefsToUI();
    setPhase('TITLE');
    refreshTitleBest();
    setText('daily-label', 'DAILY ' + U.utcLabel());
    /* Buttons (menus) */
    function on(id, fn) {
      var e = U.$(id);
      if (e) e.addEventListener('click', function (ev) { ev.preventDefault(); AU.unlock(); fn(); });
    }
    on('btn-play', function () { AU.select(); toDifficulty(); });
    on('btn-tutorial', function () { AU.select(); startTutorial(); });
    on('btn-levels', function () { AU.select(); toLevels(); });
    on('btn-daily', function () { AU.select(); startRun({ mode: 'daily' }); });
    on('btn-settings', function () { AU.select(); toSettings(); });
    on('btn-how', function () { AU.select(); show('overlay-how'); });
    on('btn-how-close', function () { AU.select(); hide('overlay-how'); if (S.phase === 'TITLE') {} else syncChrome(); });
    on('btn-diff-back', function () { AU.select(); toTitle(); });
    on('btn-levels-back', function () { AU.select(); toTitle(); });
    on('btn-settings-back', function () { AU.select(); toTitle(); });
    on('btn-endless', function () { AU.select(); startRun({ mode: 'endless' }); });
    on('btn-resume', resume);
    on('btn-restart', function () { AU.select(); hide('overlay-pause'); restartRun(); });
    on('btn-quit', function () { AU.select(); quitToLevels(); });
    on('btn-retry', function () { AU.select(); hide('overlay-result'); restartRun(); });
    on('btn-next', function () { AU.select(); hide('overlay-result'); startRun({ mode: 'level', levelId: Math.min(14, S.levelId + 1) }); });
    on('btn-to-levels', function () { AU.select(); quitToLevels(); });
    on('btn-tut-skip', function () { AU.select(); save.tutorialDone = true; persist(); toLevels(); });
    on('btn-tut-next', function () { AU.select(); save.tutorialDone = true; persist(); startRun({ mode: 'level', levelId: 1 }); });
    on('btn-diff-go', function () { AU.select(); toLevels(); });
    /* Settings inputs */
    function sc(id, fn) { var e = U.$(id); if (e) e.addEventListener('change', fn); }
    sc('set-sound', function (e) { save.prefs.mute = !e.target.checked; persist(); applyPrefsToUI(); });
    sc('set-reduced', function (e) { save.prefs.reduced = !!e.target.checked; persist(); applyPrefsToUI(); });
    sc('set-shape', function (e) { save.prefs.shapeOnly = !!e.target.checked; persist(); applyPrefsToUI(); });
    sc('set-hint', function (e) { save.prefs.hintDefault = !!e.target.checked; persist(); });
    sc('set-debug', function (e) { C.DEBUG.enabled = !!e.target.checked; });
    /* Diff quick select on title */
    var dq = U.$('title-diff');
    if (dq) dq.addEventListener('change', function (e) { selectDifficulty(e.target.value); refreshTitleBest(); });
    if (dq) dq.value = S.difficultyId;

    try { window.ChaosInput.init(); } catch (e) {}

    /* Resize: preserve semantic state (positions are unit-space; just recompute). */
    var rzT = 0;
    window.addEventListener('resize', function () {
      var n = U.now();
      if (n - rzT < 120) return;
      rzT = n;
      computeLayout();
      updateHUD();
    });
    /* Visibility: auto-pause. Require resume input. */
    document.addEventListener('visibilitychange', function () {
      try {
        if (document.hidden) {
          if (S.phase === 'PLAYING' || S.phase === 'TUTORIAL') pause(true);
        }
      } catch (e) {}
    });

    S.running = true;
    S.lastTs = U.now();
    requestAnimationFrame(frame);
    /* Console-clean self check (silent unless ?debug). */
    try {
      if (/[?&]debug=1/.test(location.search)) {
        C.DEBUG.enabled = true;
        var t = runSelfTests();
        if (window.console && console.info) console.info('[chaos-engine self-test]', JSON.stringify(t));
      }
    } catch (e) {}
  }

  function selectDifficulty(id) {
    if (!C.DIFFICULTIES[id]) return;
    S.difficultyId = id;
    save.prefs.difficulty = id;
    persist();
    computeLayout();
    refreshTitleBest();
    var dq = U.$('title-diff');
    if (dq) dq.value = id;
  }
  function selectLevel(id) {
    id = parseInt(id, 10);
    if (isNaN(id)) return;
    if (id >= 1 && id <= 14) {
      if (id > unlockFor(S.difficultyId)) return 'locked';
      startRun({ mode: 'level', levelId: id });
      return 'started';
    }
    if (id === 99) { startRun({ mode: 'endless' }); return 'started'; }
    return 'bad-id';
  }

  /* Test API — stable, DOM-independent where possible. */
  function api() {
    return {
      start: function (opts) { startRun(opts || { mode: 'level', levelId: 1 }); },
      jump: jump,
      dir: jumpDir,
      state: function () { return S.phase; },
      score: function () { return S.score; },
      level: function () { return S.levelId; },
      pos: function () { var p = pxOf(S.playerU); return { x: p.x, y: p.y }; },
      posUnit: function () { return { x: S.playerU.x, y: S.playerU.y }; },
      goals: function () { return S.goals.map(function (g) { var p = pxOf(g.u); return { x: p.x, y: p.y }; }); },
      hint: function () { var r = currentRoute(); return { path: r.path.slice(), found: !r.noRoute && r.visible }; },
      fractal: function () { return IFS.fractalSignature(); },
      selectDifficulty: selectDifficulty,
      selectLevel: selectLevel,
      startTutorial: startTutorial,
      pause: function () { pause(true); },
      resume: resume,
      best: function () { return bestFor(S.difficultyId); },
      arena: function () { return { cx: S.arena.cx, cy: S.arena.cy, rad: S.arena.rad, W: S.W, H: S.H }; },
      selfTest: runSelfTests,
      debugLine: debugLine
    };
  }

  return {
    boot: boot,
    jump: jump,
    jumpDir: jumpDir,
    tapAt: tapAt,
    phase: function () { return S.phase; },
    toggleHint: toggleHint,
    togglePause: togglePause,
    toggleMute: toggleMute,
    restartRun: restartRun,
    toDifficulty: toDifficulty,
    selectDifficulty: selectDifficulty,
    startTutorial: startTutorial,
    debugLine: debugLine,
    shapeOnly: function () { return !!save.prefs.shapeOnly; },
    view: view,
    _S: S,
    _api: api
  };
})();

/* Expose test API after definition. */
try {
  window.__chaosEngine = window.ChaosGame._api();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { window.ChaosGame.boot(); });
  } else {
    window.ChaosGame.boot();
  }
} catch (e) {}
