'use strict';
/* config.js — immutable game constants. Geometry NEVER changes with difficulty. */
window.ChaosConfig = (function () {
  var U = window.ChaosUtil;

  /* --- Mathematical invariants (do not tune) --- */
  var R_JUMP = 0.5;
  var ATTRACTOR_COUNT = 3;

  /* --- Difficulties: ONLY pressure changes, never geometry --- */
  var DIFFICULTIES = {
    zen:     { id: 'zen',     order: 0, name: 'ZEN',    radius: 72, timed: false, time: 0,  lives: 0, drift: 0,      goals: 1, desc: 'No timer. No lives. Breathe and explore the fractal.' },
    easy:    { id: 'easy',    order: 1, name: 'EASY',   radius: 58, timed: true,  time: 20, lives: 5, drift: 0,      goals: 1, desc: 'Generous targets. 20s per wave, 5 lives.' },
    normal:  { id: 'normal',  order: 2, name: 'NORMAL', radius: 44, timed: true,  time: 16, lives: 4, drift: 0.35,   goals: 1, desc: 'Tighter targets, slight drift, 16s waves.' },
    hard:    { id: 'hard',    order: 3, name: 'HARD',   radius: 32, timed: true,  time: 12, lives: 3, drift: 0.7,    goals: 1, desc: 'Small targets, moderate drift, 12s waves.' },
    insane:  { id: 'insane',  order: 4, name: 'INSANE', radius: 20, timed: true,  time: 9,  lives: 2, drift: 0.7,    goals: 2, desc: 'Tiny targets, TWO goals at once, 9s waves.' }
  };
  var DIFFICULTY_ORDER = ['zen', 'easy', 'normal', 'hard', 'insane'];

  /* --- Feel / scoring --- */
  var COMBO_WINDOW_MS = 3200;
  var MAX_COMBO = 8;
  var TRAIL_DURATION_MS = 6500;
  var JUMP_ANIM_MS = 120;
  var INPUT_BUFFER_MS = 100;
  var PERFECT_FRAC = 0.42;   /* distance < 0.42R -> perfect */
  var ROUTE_TOL_FRAC = 0.9;  /* route ends when d <= 0.9R */
  var BEAM_WIDTH = 8;
  var BEAM_DEPTH = 13;
  var TIME_BONUS_PER_SEC = 6;

  /* Radius scaling: visuals only, board math unchanged. */
  function viewScale(W, H) {
    return U.clamp(Math.min(W, H) / 760, 0.72, 1.35);
  }
  function effectiveRadius(baseRadius, W, H) {
    return baseRadius * viewScale(W, H);
  }

  var STORAGE_KEY = 'chaosEngine.v1';
  var SAVE_VERSION = 1;

  var DEBUG = {
    enabled: false,
    DRAW_HIT_CIRCLES: false,
    DRAW_NODE_IDS: false,
    SHOW_ROUTE_SEARCH: false,
    SHOW_ARENA_BOUNDS: false
  };

  return {
    R_JUMP: R_JUMP, ATTRACTOR_COUNT: ATTRACTOR_COUNT,
    DIFFICULTIES: DIFFICULTIES, DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    COMBO_WINDOW_MS: COMBO_WINDOW_MS, MAX_COMBO: MAX_COMBO,
    TRAIL_DURATION_MS: TRAIL_DURATION_MS, JUMP_ANIM_MS: JUMP_ANIM_MS,
    INPUT_BUFFER_MS: INPUT_BUFFER_MS, PERFECT_FRAC: PERFECT_FRAC,
    ROUTE_TOL_FRAC: ROUTE_TOL_FRAC, BEAM_WIDTH: BEAM_WIDTH, BEAM_DEPTH: BEAM_DEPTH,
    TIME_BONUS_PER_SEC: TIME_BONUS_PER_SEC,
    viewScale: viewScale, effectiveRadius: effectiveRadius,
    STORAGE_KEY: STORAGE_KEY, SAVE_VERSION: SAVE_VERSION, DEBUG: DEBUG
  };
})();
