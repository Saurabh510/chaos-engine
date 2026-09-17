'use strict';
/* render.js — layered canvas renderer. Reads state, never mutates gameplay state. */
window.ChaosRender = (function () {
  var U = window.ChaosUtil;
  var C = window.ChaosConfig;
  var IFS = window.ChaosIFS;

  var INK = '#123f49', TEAL = '#0e7c86', VIOLET = '#6c4fd8',
      AMBER = '#cf8a0a', DANGER = '#c0392b', PALE = '#eef5f7';

  var canvas = null, ctx = null;
  var cssW = 0, cssH = 0, dpr = 1;

  /* Caches. */
  var unitNodesByDepth = {};   /* depth -> unit-space nodes */
  var unitEdgesByDepth = {};   /* depth -> unit-space edge list (depth<=6) */
  var unitGhostPts = null;     /* deterministic chaos dust in unit space */
  var boardCache = { key: '', layer: null, w: 0, h: 0 };  /* offscreen static layer */

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
  }

  /* Authoritative layout: reserves UI regions, returns equilateral arena. */
  function arenaBounds(W, H) {
    var top, bottom, side;
    if (H < 520) { top = 58; bottom = 96; side = 34; }
    else if (W < 560) { top = 116; bottom = 176; side = 14; }
    else { top = 96; bottom = 128; side = 34; }
    var availW = Math.max(80, W - side * 2);
    var availH = Math.max(80, H - top - bottom);
    /* Equilateral, circumradius rad: width = sqrt(3)*rad, height = 1.5*rad. */
    var rad = Math.min(availW / 1.7320508, availH / 1.5);
    var cx = W / 2;
    var cy = top + availH / 2 + rad * 0.06;
    return { cx: cx, cy: cy, rad: rad, top: top, bottom: bottom, side: side };
  }

  function resize(w, h) {
    cssW = Math.max(1, Math.floor(w));
    cssH = Math.max(1, Math.floor(h));
    try { dpr = U.clamp(window.devicePixelRatio || 1, 1, 2.5); } catch (e) { dpr = 1; }
    if (!canvas) return;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    boardCache.key = ''; /* invalidate static layer */
  }

  /* Unit-space geometry: unit triangle centroid origin, circumradius 1. */
  function unitAttractors() { return IFS.attractorPoints(0, 0, 1); }
  function unitNodes(depth) {
    if (!unitNodesByDepth[depth]) {
      unitNodesByDepth[depth] = IFS.generateSubdivisionNodes(depth, unitAttractors());
    }
    return unitNodesByDepth[depth];
  }
  function unitEdges(depth) {
    if (unitEdgesByDepth[depth]) return unitEdgesByDepth[depth];
    var att = unitAttractors();
    var edges = [];
    function sub(tri, d) {
      if (d <= 0) {
        edges.push(tri[0], tri[1], tri[1], tri[2], tri[2], tri[0]);
        return;
      }
      var m01 = { x: (tri[0].x + tri[1].x) / 2, y: (tri[0].y + tri[1].y) / 2 };
      var m12 = { x: (tri[1].x + tri[2].x) / 2, y: (tri[1].y + tri[2].y) / 2 };
      var m20 = { x: (tri[2].x + tri[0].x) / 2, y: (tri[2].y + tri[0].y) / 2 };
      sub([tri[0], m01, m20], d - 1);
      sub([m01, tri[1], m12], d - 1);
      sub([m20, m12, tri[2]], d - 1);
    }
    sub([att[0], att[1], att[2]], depth);
    unitEdgesByDepth[depth] = edges;
    return edges;
  }
  function ghostPts() {
    if (unitGhostPts) return unitGhostPts;
    var att = unitAttractors();
    var rng = new U.PRNG(987654321);
    var p = { x: 0, y: 0 };
    var pts = [];
    for (var k = 0; k < 9000; k++) {
      p = IFS.nextPoint(p, att[rng.int(0, 2)]);
      if (k > 40 && (k % 1 === 0)) pts.push({ x: p.x, y: p.y });
      if (pts.length >= 7000) break;
    }
    unitGhostPts = pts;
    return pts;
  }

  function mapUnit(arena, u) {
    return { x: arena.cx + u.x * arena.rad, y: arena.cy + u.y * arena.rad };
  }

  /* Build the static offscreen layer: halo + mesh + ghost. Keyed W x H @ depth. */
  function staticLayer(arena, depth, W, H) {
    var key = Math.round(W) + 'x' + Math.round(H) + '@' + depth;
    if (boardCache.key === key && boardCache.layer) return boardCache.layer;
    var off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(W * dpr));
    off.height = Math.max(1, Math.floor(H * dpr));
    var g = off.getContext('2d');
    g.scale(dpr, dpr);
    /* Soft halo behind arena (precomputed once per key — never ctx.filter per frame). */
    try {
      var halo = g.createRadialGradient(arena.cx, arena.cy, arena.rad * 0.1, arena.cx, arena.cy, arena.rad * 1.45);
      halo.addColorStop(0, 'rgba(255,255,255,0.85)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = halo;
      g.fillRect(arena.cx - arena.rad * 1.5, arena.cy - arena.rad * 1.5, arena.rad * 3, arena.rad * 3);
    } catch (e) {}

    /* Subdivision mesh. */
    if (depth <= 6) {
      var edges = unitEdges(depth);
      g.strokeStyle = 'rgba(18,63,73,0.20)';
      g.lineWidth = 1;
      g.beginPath();
      for (var i = 0; i < edges.length; i += 2) {
        var a = mapUnit(arena, edges[i]), b = mapUnit(arena, edges[i + 1]);
        g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
      }
      g.stroke();
    } else {
      /* Deep boards: stipple the node set instead of stroking thousands of edges. */
      var nodes = unitNodes(depth);
      g.fillStyle = 'rgba(18,63,73,0.30)';
      var step = depth >= 8 ? 2 : 1;
      for (var n = 0; n < nodes.length; n += step) {
        var q = mapUnit(arena, nodes[n]);
        g.fillRect(q.x - 0.5, q.y - 0.5, 1.4, 1.4);
      }
    }

    /* Ghost gasket: deterministic chaos dust. depth<=4 hidden; ramps to ~0.92 at 8. */
    if (depth >= 5) {
      var alpha = Math.min(0.92, 0.12 + (depth - 4) * 0.2);
      var pts = ghostPts();
      var lim = depth >= 8 ? pts.length : depth === 7 ? 4500 : depth === 6 ? 3000 : 1800;
      g.fillStyle = 'rgba(108,79,216,' + alpha.toFixed(2) + ')';
      var px = Math.max(1, arena.rad / 420);
      for (var k = 0; k < lim && k < pts.length; k++) {
        var m = mapUnit(arena, pts[k]);
        g.fillRect(m.x, m.y, px, px);
      }
    }
    boardCache = { key: key, layer: off, w: W, h: H };
    return off;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* Main draw: view snapshot from ChaosGame.view(). Pure read-only. */
  function draw(v) {
    if (!ctx || !v) return;
    var W = cssW, H = cssH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var FX = window.ChaosFX;
    ctx.save();
    var sh = FX ? FX.shakeOf() : 0;
    if (sh > 0.2) {
      var __t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      ctx.translate(Math.sin(__t * 0.09) * sh * 0.5, Math.cos(__t * 0.073) * sh * 0.5);
    }

    var arena = v.arena;
    /* Static layer blit. */
    try {
      var layer = staticLayer(arena, v.depth, W, H);
      ctx.drawImage(layer, 0, 0, W, H);
    } catch (e) {}

    if (C.DEBUG.SHOW_ARENA_BOUNDS) {
      ctx.strokeStyle = '#c0392b'; ctx.setLineDash([4, 4]);
      ctx.strokeRect(arena.cx - arena.rad * 0.87, arena.cy - arena.rad, arena.rad * 1.74, arena.rad * 1.5 + 20);
      ctx.setLineDash([]);
    }

    /* Attractors: numbered rings. */
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < 3; i++) {
      var A = v.attractors[i];
      var hot = v.flashAttractor === i;
      ctx.beginPath();
      ctx.arc(A.x, A.y, hot ? 20 : 16, 0, Math.PI * 2);
      ctx.fillStyle = hot ? '#0e7c86' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = hot ? '#ffffff' : INK;
      ctx.font = '700 13px system-ui, -apple-system, sans-serif';
      ctx.fillText(String(i + 1), A.x, A.y + 0.5);
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(18,63,73,0.75)';
      ctx.fillText(i === 0 ? 'TOP' : (i === 1 ? 'LEFT' : 'RIGHT'), A.x, A.y + 28);
    }

    /* Trail (behind player, fading). */
    if (v.trail) {
      for (var t = 0; t < v.trail.length; t++) {
        var s = v.trail[t];
        var a = Math.max(0, 1 - s.age / C.TRAIL_DURATION_MS) * 0.35;
        if (a <= 0.004) continue;
        ctx.strokeStyle = 'rgba(18,63,73,' + a.toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
      }
    }

    /* Route (violet dashed, numbered, subordinate). */
    if (v.route && v.route.visible && v.route.positions && v.route.positions.length > 1) {
      var rp = v.route.positions;
      ctx.save();
      ctx.strokeStyle = VIOLET; ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(rp[0].x, rp[0].y);
      for (var r2 = 1; r2 < rp.length; r2++) ctx.lineTo(rp[r2].x, rp[r2].y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (var rn = 1; rn < rp.length; rn++) {
        ctx.beginPath();
        ctx.arc(rp[rn].x, rp[rn].y, rn === 1 ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = rn === 1 ? VIOLET : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = VIOLET; ctx.stroke();
        ctx.fillStyle = rn === 1 ? '#ffffff' : VIOLET;
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillText(String(rn), rp[rn].x, rp[rn].y + 0.5);
      }
      ctx.restore();
    } else if (v.route && v.route.visible && v.route.noRoute) {
      ctx.fillStyle = 'rgba(108,79,216,0.9)';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText('NO SHORT ROUTE', arena.cx, arena.cy - arena.rad - 12);
    }

    /* Goals: triangle + ring + GOAL label, pale backing disc. */
    if (v.goals) {
      for (var gi = 0; gi < v.goals.length; gi++) {
        var G = v.goals[gi];
        ctx.beginPath(); ctx.arc(G.x, G.y, G.r * 0.55 + 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
        var col = G.urgent ? DANGER : AMBER;
        /* Ring (hit radius). */
        ctx.beginPath(); ctx.arc(G.x, G.y, G.r, 0, Math.PI * 2);
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
        if (C.DEBUG.DRAW_HIT_CIRCLES) {
          ctx.beginPath(); ctx.arc(G.x, G.y, G.r, 0, Math.PI * 2);
          ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1; ctx.stroke();
        }
        /* Triangle marker. */
        var ts = Math.max(10, G.r * 0.28 + 6);
        ctx.beginPath();
        ctx.moveTo(G.x, G.y - ts);
        ctx.lineTo(G.x + ts * 0.9, G.y + ts * 0.7);
        ctx.lineTo(G.x - ts * 0.9, G.y + ts * 0.7);
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.fillStyle = INK;
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillText(gi === 0 ? 'GOAL' : 'GOAL ' + (gi + 1), G.x, G.y - ts - 12);
      }
    }

    /* Next-landing previews: dotted lines; best = square + NEXT n. */
    if (v.nexts && (v.phase === 'PLAYING' || v.phase === 'TUTORIAL')) {
      for (var ni = 0; ni < 3; ni++) {
        var N = v.nexts[ni];
        if (!N) continue;
        ctx.save();
        ctx.strokeStyle = N.best ? INK : 'rgba(18,63,73,0.45)';
        ctx.lineWidth = N.best ? 2 : 1.2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(v.player.x, v.player.y); ctx.lineTo(N.x, N.y); ctx.stroke();
        ctx.setLineDash([]);
        if (N.best) {
          var bs = 9;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(N.x - bs / 2, N.y - bs / 2, bs, bs);
          ctx.lineWidth = 2.4; ctx.strokeStyle = INK;
          ctx.strokeRect(N.x - bs / 2, N.y - bs / 2, bs, bs);
          ctx.fillStyle = INK;
          ctx.font = '700 10px system-ui, sans-serif';
          ctx.fillText('NEXT ' + (ni + 1), N.x, N.y - 16);
        } else {
          ctx.beginPath(); ctx.arc(N.x, N.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff'; ctx.fill();
          ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(18,63,73,0.8)'; ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* Player: backing disc + diamond + dot + YOU. */
    if (v.player) {
      ctx.beginPath(); ctx.arc(v.player.x, v.player.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
      var ds = 11;
      ctx.beginPath();
      ctx.moveTo(v.player.x, v.player.y - ds);
      ctx.lineTo(v.player.x + ds, v.player.y);
      ctx.lineTo(v.player.x, v.player.y + ds);
      ctx.lineTo(v.player.x - ds, v.player.y);
      ctx.closePath();
      ctx.fillStyle = TEAL; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(v.player.x, v.player.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.fillText('YOU', v.player.x, v.player.y + 24);
    }

    /* Landing marks. */
    if (FX) {
      var mk;
      for (var mi = 0; mi < FX.marks.items.length; mi++) {
        mk = FX.marks.items[mi];
        if (!mk.on) continue;
        var ma = 1 - mk.age / mk.life;
        ctx.beginPath(); ctx.arc(mk.x, mk.y, 4 + (1 - ma) * 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(14,124,134,' + (ma * 0.7).toFixed(3) + ')';
        ctx.lineWidth = 2; ctx.stroke();
      }
      /* Particles. */
      for (var pi = 0; pi < FX.particles.items.length; pi++) {
        var P = FX.particles.items[pi];
        if (!P.on) continue;
        var pa = 1 - P.age / P.life;
        ctx.globalAlpha = Math.max(0, pa);
        ctx.fillStyle = P.color;
        ctx.fillRect(P.x - P.size / 2, P.y - P.size / 2, P.size, P.size);
        ctx.globalAlpha = 1;
      }
      /* Rings. */
      for (var gi2 = 0; gi2 < FX.rings.items.length; gi2++) {
        var R = FX.rings.items[gi2];
        if (!R.on) continue;
        var ra = 1 - R.age / R.life;
        var rr = R.r0 + (R.r1 - R.r0) * (1 - ra * ra);
        ctx.beginPath(); ctx.arc(R.x, R.y, rr, 0, Math.PI * 2);
        ctx.strokeStyle = R.color;
        ctx.globalAlpha = Math.max(0, ra * 0.8);
        ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /* Popups. */
      ctx.textAlign = 'center';
      for (var oi = 0; oi < FX.popups.items.length; oi++) {
        var O = FX.popups.items[oi];
        if (!O.on) continue;
        var oa = 1 - O.age / O.life;
        var oy = O.y - (1 - oa * oa) * 34;
        ctx.globalAlpha = Math.max(0, Math.min(1, oa * 1.6));
        ctx.font = '800 15px system-ui, sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(O.text, O.x, oy);
        ctx.fillStyle = INK;
        ctx.fillText(O.text, O.x, oy);
        ctx.globalAlpha = 1;
      }
    }

    /* Brief landing flash. */
    if (FX && FX.flashOf() > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + FX.flashOf().toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    if (C.DEBUG.enabled) {
      try {
        var G2 = window.ChaosGame;
        ctx.fillStyle = 'rgba(10,30,36,0.85)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(G2 ? G2.debugLine() : '', 8, H - 20);
      } catch (e) {}
    }
  }

  return {
    init: init, resize: resize, draw: draw, arenaBounds: arenaBounds,
    unitNodes: unitNodes,
    dims: function () { return { W: cssW, H: cssH, dpr: dpr }; }
  };
})();
