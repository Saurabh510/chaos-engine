'use strict';
/* levels.js — data-driven level model. 14 primary levels + ENDLESS. */
window.ChaosLevels = (function () {
  /* Depth sequence mandated by spec. */
  var DEPTHS = [2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7];
  var NAMES = [
    'First Light', 'Three Doors', 'Halfway Home',
    'Branching', 'Small Worlds', 'The Gaps',
    'Deep Field', 'Honeycomb', 'Thin Air',
    'Ghost Lines', 'Fine Dust', 'Needlework',
    'Almost Dust', 'The Full Bloom'
  ];
  /* timeMul glides 1.8 -> 0.65 across the 14 levels. */
  var TIMEMUL = [1.8, 1.68, 1.56, 1.44, 1.32, 1.2, 1.1, 1.0, 0.92, 0.85, 0.78, 0.72, 0.68, 0.65];

  function buildLevels() {
    var out = [];
    for (var i = 0; i < 14; i++) {
      var id = i + 1;
      out.push({
        id: id,
        name: NAMES[i],
        depth: DEPTHS[i],
        waves: 3 + (i % 3 === 2 ? 1 : 0) + (i >= 9 ? 1 : 0), /* 3–5 */
        goals: (id >= 12) ? 2 : 1,
        routeTarget: 2 + (i % 4),                              /* 2–5 */
        wander: (i >= 5 && i % 2 === 1) ? 1 : 0,
        timeMul: TIMEMUL[i],
        timed: id >= 6,                                        /* 1–5 untimed, 6+ timed */
        par: 6 + i * 2,                                        /* jumps par for stars */
        perfectsFor3: 2 + Math.floor(i / 3)
      });
    }
    /* Clamp waves to 3..5. */
    out.forEach(function (L) {
      if (L.waves < 3) L.waves = 3;
      if (L.waves > 5) L.waves = 5;
      if (L.routeTarget < 2) L.routeTarget = 2;
      if (L.routeTarget > 5) L.routeTarget = 5;
    });
    return out;
  }
  var LEVELS = buildLevels();

  var ENDLESS = {
    id: 99, name: 'Endless Bloom', depth: 8, waves: 9999, goals: 1,
    routeTarget: 4, wander: 1, timeMul: 0.8, timed: true, endless: true,
    par: 10, perfectsFor3: 3
  };

  function getLevel(id) {
    if (id === 99 || id === 'endless') return ENDLESS;
    id = parseInt(id, 10);
    if (isNaN(id) || id < 1 || id > 14) return LEVELS[0];
    return LEVELS[id - 1];
  }
  /* ZEN forces every level untimed. */
  function isTimed(level, difficultyId) {
    if (difficultyId === 'zen') return false;
    return !!level.timed;
  }
  function levelTime(level, difficulty) {
    if (!isTimed(level, difficulty.id)) return 0;
    return Math.max(6, difficulty.time * level.timeMul);
  }
  function starsFor(level, jumpsUsed, perfects, cleared) {
    if (!cleared) return 0;
    var s = 1;
    if (jumpsUsed <= level.par) s = 2;
    if (jumpsUsed <= level.par && perfects >= level.perfectsFor3) s = 3;
    return s;
  }

  return {
    LEVELS: LEVELS, ENDLESS: ENDLESS,
    getLevel: getLevel, isTimed: isTimed, levelTime: levelTime, starsFor: starsFor
  };
})();
