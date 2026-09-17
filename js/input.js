'use strict';
/* input.js — all DOM input funnels into ChaosGame.jump(i) / ChaosGame actions.
   Exactly one movement code path. Guards key-repeat, touch+click duplication. */
window.ChaosInput = (function () {
  var U = window.ChaosUtil;
  var lastPointerFire = 0;

  function game() { return window.ChaosGame; }

  function bindButton(id, fn) {
    var b = U.$(id);
    if (!b) return;
    /* Use pointerup-free click only; guard double-fire from touch+mouse. */
    var last = 0;
    b.addEventListener('click', function (ev) {
      var n = U.now();
      if (n - last < 250) { ev.preventDefault(); return; }
      last = n;
      ev.preventDefault();
      fn();
    });
  }

  function attractorIndexFromKey(key) {
    if (key === '1') return 0;
    if (key === '2') return 1;
    if (key === '3') return 2;
    return -1;
  }

  function init() {
    var G = game();
    if (!G) return;

    document.addEventListener('keydown', function (ev) {
      var k = ev.key;
      /* Ignore repeats for movement (held key). */
      var ai = attractorIndexFromKey(k);
      if (ai >= 0) {
        if (ev.repeat) { ev.preventDefault(); return; }
        ev.preventDefault();
        G.jump(ai, 'key');
        return;
      }
      /* Arrow/WASD keys are directional RELATIVE TO THE PLAYER: they resolve
         to whichever attractor lies furthest that way from YOU. */
      var lk = (k || '').toLowerCase();
      if (lk === 'arrowleft' || lk === 'a') { if (!ev.repeat) { ev.preventDefault(); G.jumpDir('left'); } return; }
      if (lk === 'arrowdown' || lk === 's') { if (!ev.repeat) { ev.preventDefault(); G.jumpDir('down'); } return; }
      if (lk === 'arrowright' || lk === 'd') { if (!ev.repeat) { ev.preventDefault(); G.jumpDir('right'); } return; }
      if (lk === 'arrowup' || lk === 'w') { if (!ev.repeat) { ev.preventDefault(); G.jumpDir('up'); } return; }
      if (lk === 'h') { G.toggleHint(); return; }
      if (lk === 'p' || k === 'Escape') { G.togglePause(); return; }
      if (lk === 'm') { G.toggleMute(); return; }
      if (lk === 'r') { G.restartRun(); return; }
      if (k === 'Enter' && G.phase() === 'TITLE') { G.toDifficulty(); return; }
    });

    bindButton('btn-a0', function () { G.jump(0, 'deck'); });
    bindButton('btn-a1', function () { G.jump(1, 'deck'); });
    bindButton('btn-a2', function () { G.jump(2, 'deck'); });
    bindButton('btn-hint', function () { G.toggleHint(); });
    bindButton('btn-pause', function () { G.togglePause(); });
    bindButton('btn-sound', function () { G.toggleMute(); });

    /* Tap-to-nearest-attractor on canvas. Uses pointerup with dedupe. */
    var cv = U.$('arena');
    if (cv) {
      cv.addEventListener('pointerup', function (ev) {
        var n = U.now();
        if (n - lastPointerFire < 180) return;
        lastPointerFire = n;
        try {
          var r = cv.getBoundingClientRect();
          var x = ev.clientX - r.left, y = ev.clientY - r.top;
          G.tapAt(x, y, r.width, r.height);
        } catch (e) {}
      });
      /* Prevent double-firing via synthetic click after touch: swallow click. */
      cv.addEventListener('click', function (ev) { ev.preventDefault(); });
    }

    /* Any first gesture unlocks audio. */
    document.addEventListener('pointerdown', function () {
      try { window.ChaosAudio.unlock(); } catch (e) {}
    }, { passive: true });
  }

  return { init: init };
})();
