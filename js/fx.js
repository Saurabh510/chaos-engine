'use strict';
/* fx.js — pooled transient effects: particles, rings, popups, land marks, shake, flash. */
window.ChaosFX = (function () {
  var U = window.ChaosUtil;
  var C = window.ChaosConfig;

  var MAXP = 140, MAXR = 20, MAXPOP = 14, MAXMARK = 24;

  function makePool(n, factory) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(factory());
    return { items: a, cursor: 0 };
  }
  function take(pool) {
    var it = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.items.length;
    return it;
  }

  var particles = makePool(MAXP, function () { return { on: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 500, size: 2, color: '#0e5561' }; });
  var rings = makePool(MAXR, function () { return { on: false, x: 0, y: 0, age: 0, life: 450, r0: 4, r1: 26, color: '#0e5561' }; });
  var popups = makePool(MAXPOP, function () { return { on: false, x: 0, y: 0, age: 0, life: 1100, text: '' }; });
  var marks = makePool(MAXMARK, function () { return { on: false, x: 0, y: 0, age: 0, life: 900 }; });

  var shake = 0;
  var flash = 0;
  var reduced = false;
  var seed = 1234567;
  function frand() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return ((seed >>> 0) % 1000) / 1000; }

  function setReduced(b) { reduced = !!b; }

  function burst(x, y, n, color) {
    var count = reduced ? Math.min(3, n) : n;
    for (var k = 0; k < count; k++) {
      var p = take(particles);
      var a = frand() * Math.PI * 2;
      var sp = 40 + frand() * 130;
      p.on = true; p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 30;
      p.age = 0; p.life = 380 + frand() * 320;
      p.size = 1.5 + frand() * 2.5;
      p.color = color || '#0e5561';
    }
  }
  function ring(x, y, r1, color) {
    var r = take(rings);
    r.on = true; r.x = x; r.y = y; r.age = 0; r.life = reduced ? 220 : 450;
    r.r0 = 4; r.r1 = r1 || 26; r.color = color || '#0e5561';
  }
  function popup(x, y, text) {
    var p = take(popups);
    p.on = true; p.x = x; p.y = y; p.age = 0; p.life = 1100; p.text = text;
  }
  function mark(x, y) {
    var m = take(marks);
    m.on = true; m.x = x; m.y = y; m.age = 0; m.life = 900;
  }
  function kickShake(amt) { if (!reduced) shake = Math.min(7, shake + amt); }
  function kickFlash(amt) { if (!reduced) flash = Math.min(0.5, flash + amt); }

  function update(dtMs) {
    var dt = dtMs / 1000;
    var i, it;
    for (i = 0; i < particles.items.length; i++) {
      it = particles.items[i];
      if (!it.on) continue;
      it.age += dtMs;
      if (it.age >= it.life) { it.on = false; continue; }
      it.x += it.vx * dt; it.y += it.vy * dt;
      it.vx *= (1 - 2.2 * dt); it.vy *= (1 - 2.2 * dt);
    }
    for (i = 0; i < rings.items.length; i++) {
      it = rings.items[i];
      if (!it.on) continue;
      it.age += dtMs;
      if (it.age >= it.life) it.on = false;
    }
    for (i = 0; i < popups.items.length; i++) {
      it = popups.items[i];
      if (!it.on) continue;
      it.age += dtMs;
      if (it.age >= it.life) it.on = false;
    }
    for (i = 0; i < marks.items.length; i++) {
      it = marks.items[i];
      if (!it.on) continue;
      it.age += dtMs;
      if (it.age >= it.life) it.on = false;
    }
    shake = Math.max(0, shake - dtMs * 0.03);
    flash = Math.max(0, flash - dtMs * 0.002);
  }

  function reset() {
    var i;
    [particles, rings, popups, marks].forEach(function (pool) {
      for (i = 0; i < pool.items.length; i++) pool.items[i].on = false;
    });
    shake = 0; flash = 0;
  }

  return {
    burst: burst, ring: ring, popup: popup, mark: mark,
    kickShake: kickShake, kickFlash: kickFlash,
    update: update, reset: reset, setReduced: setReduced,
    particles: particles, rings: rings, popups: popups, marks: marks,
    shakeOf: function () { return shake; },
    flashOf: function () { return flash; }
  };
})();
