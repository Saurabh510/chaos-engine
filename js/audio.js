'use strict';
/* audio.js — WebAudio-only synthesized SFX. No files. Never crashes without audio. */
window.ChaosAudio = (function () {
  var ctx = null;
  var muted = false;
  var unlocked = false;

  function ensure() {
    if (unlocked && ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(function () {});
      }
      unlocked = true;
      return ctx;
    } catch (e) { return null; }
  }
  function unlock() { ensure(); }

  function tone(freq, durMs, type, gain, slideTo) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    try {
      var t = c.currentTime;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + durMs / 1000);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + durMs / 1000 + 0.02);
    } catch (e) {}
  }

  var BASE = [329.63, 392.0, 493.88]; /* E4 G4 B4 — one pitch per attractor */
  function jump(i, combo) {
    var f = BASE[i] || 440;
    f = f * (1 + 0.06 * Math.min(combo || 1, 8)); /* pitch rises with combo */
    tone(f, 90, 'triangle', 0.10, f * 1.5);
  }
  function goal() { tone(660, 140, 'sine', 0.14, 990); }
  function perfect() { tone(880, 200, 'sine', 0.12, 1320); setTimeout(function(){ tone(1320, 160, 'sine', 0.08); }, 70); }
  function comboRise(n) { tone(440 + n * 60, 110, 'triangle', 0.09); }
  function lifeLost() { tone(220, 260, 'sawtooth', 0.07, 110); }
  function levelComplete() {
    tone(523, 140, 'triangle', 0.11);
    setTimeout(function(){ tone(659, 140, 'triangle', 0.11); }, 110);
    setTimeout(function(){ tone(784, 220, 'triangle', 0.12); }, 220);
  }
  function select() { tone(520, 60, 'square', 0.04); }
  function hint() { tone(740, 120, 'sine', 0.07, 920); }
  function denied() { tone(160, 120, 'square', 0.05); }

  function setMuted(m) { muted = !!m; }
  function isMuted() { return muted; }

  /* Unlock on first gesture (autoplay policy). */
  try {
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
  } catch (e) {}

  return {
    unlock: unlock, jump: jump, goal: goal, perfect: perfect,
    comboRise: comboRise, lifeLost: lifeLost, levelComplete: levelComplete,
    select: select, hint: hint, denied: denied,
    setMuted: setMuted, isMuted: isMuted
  };
})();
