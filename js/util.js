'use strict';
/* util.js — small shared helpers, PRNG, guarded storage, timing. */
window.ChaosUtil = (function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }

  /* Mulberry32 — deterministic seeded PRNG. */
  function PRNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  PRNG.prototype.next = function () {
    var s = this.s;
    s = (s + 0x6D2B79F5) | 0;
    this.s = s;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  PRNG.prototype.int = function (lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  };
  PRNG.prototype.pick = function (arr) {
    if (!arr || !arr.length) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  };
  PRNG.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  /* Deterministic UTC-date seed: YYYY-MM-DD -> uint32. */
  function dateSeedUTC(d) {
    d = d || new Date();
    var s = d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getUTCDate()).slice(-2);
    return { seed: hashString('chaos-engine:' + s), label: s };
  }
  function utcLabel(d) {
    d = d || new Date();
    return d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getUTCDate()).slice(-2);
  }

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }
  function formatClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    if (sec >= 60) {
      var m = Math.floor(sec / 60), s = sec - m * 60;
      return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
    }
    return sec.toFixed(1) + 's';
  }

  /* Guarded storage: never throws, falls back to memory. */
  var memStore = {};
  var storageOK = null;
  function storageAvailable() {
    if (storageOK !== null) return storageOK;
    try {
      if (typeof localStorage === 'undefined') { storageOK = false; return false; }
      localStorage.setItem('__ce_probe', '1');
      localStorage.removeItem('__ce_probe');
      storageOK = true;
    } catch (e) { storageOK = false; }
    return storageOK;
  }
  function storeGet(key) {
    try {
      if (!storageAvailable()) return (key in memStore) ? memStore[key] : null;
      return localStorage.getItem(key);
    } catch (e) { return (key in memStore) ? memStore[key] : null; }
  }
  function storeSet(key, val) {
    try {
      if (!storageAvailable()) { memStore[key] = String(val); return false; }
      localStorage.setItem(key, val);
      return true;
    } catch (e) {
      try { memStore[key] = String(val); } catch (e2) {}
      return false;
    }
  }
  function loadJSON(key, fallback) {
    var raw = storeGet(key);
    if (raw === null || raw === undefined) return fallback;
    try {
      var v = JSON.parse(raw);
      return (v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var a = arguments, self = this;
      var n = now();
      if (n - t >= ms) { t = n; fn.apply(self, a); }
    };
  }

  return {
    clamp: clamp, lerp: lerp, easeOutCubic: easeOutCubic,
    PRNG: PRNG, hashString: hashString, dateSeedUTC: dateSeedUTC, utcLabel: utcLabel,
    now: now, formatClock: formatClock,
    storageAvailable: storageAvailable, storeGet: storeGet, storeSet: storeSet, loadJSON: loadJSON,
    $: $, el: el, debounce: debounce
  };
})();
