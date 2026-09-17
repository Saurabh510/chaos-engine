'use strict';
/* ifs.js — ALL fractal mathematics lives here. Single authoritative movement equation. */
window.ChaosIFS = (function () {
  var C = window.ChaosConfig;

  /* Canonical equilateral attractors for centroid (cx,cy), circumradius rad.
     Vertex 0 = top, 1 = bottom-left, 2 = bottom-right. */
  function attractorPoints(cx, cy, rad) {
    var pts = [];
    /* Explicit, readable angles: -90deg (top), 150deg (bottom-left), 30deg (bottom-right). */
    var a = [-Math.PI / 2, Math.PI * 5 / 6, Math.PI / 6];
    for (var i = 0; i < 3; i++) {
      pts.push({ x: cx + rad * Math.cos(a[i]), y: cy + rad * Math.sin(a[i]) });
    }
    return pts;
  }

  /* THE movement equation. Everything calls this. r is always 0.5. */
  function nextPoint(p, a, r) {
    if (r === undefined) r = C.R_JUMP;
    return { x: p.x + r * (a.x - p.x), y: p.y + r * (a.y - p.y) };
  }

  function distance(p, q) {
    var dx = p.x - q.x, dy = p.y - q.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Forward chaos-game point: burn-in >= 30 legal jumps from a start. */
  function chaosPoint(start, attractors, rng, burnIn) {
    var p = { x: start.x, y: start.y };
    var n = burnIn || 30;
    for (var k = 0; k < n; k++) {
      var i = rng.int(0, 2);
      p = nextPoint(p, attractors[i]);
    }
    return p;
  }

  function centroidOf(attractors) {
    return {
      x: (attractors[0].x + attractors[1].x + attractors[2].x) / 3,
      y: (attractors[0].y + attractors[1].y + attractors[2].y) / 3
    };
  }

  /* Depth-D Sierpinski subdivision nodes (unique vertices of kept triangles).
     Counts: D2=15 D3=42 D4=123 D5=366 D6=1095 D7=3282 D8=9843. */
  function nodeKey(x, y) { return Math.round(x * 4096) + ':' + Math.round(y * 4096); }

  function generateSubdivisionNodes(depth, attractors) {
    var seen = {};
    var nodes = [];
    function addPt(p) {
      var k = nodeKey(p.x, p.y);
      if (!seen[k]) { seen[k] = 1; nodes.push({ x: p.x, y: p.y }); }
    }
    function sub(tri, d) {
      if (d <= 0) { addPt(tri[0]); addPt(tri[1]); addPt(tri[2]); return; }
      var m01 = { x: (tri[0].x + tri[1].x) / 2, y: (tri[0].y + tri[1].y) / 2 };
      var m12 = { x: (tri[1].x + tri[2].x) / 2, y: (tri[1].y + tri[2].y) / 2 };
      var m20 = { x: (tri[2].x + tri[0].x) / 2, y: (tri[2].y + tri[0].y) / 2 };
      sub([tri[0], m01, m20], d - 1);
      sub([m01, tri[1], m12], d - 1);
      sub([m20, m12, tri[2]], d - 1);
    }
    sub([attractors[0], attractors[1], attractors[2]], depth);
    return nodes;
  }

  function expectedNodeCount(depth) {
    return Math.round((Math.pow(3, depth + 1) + 3) / 2);
  }

  /* Corner-subtriangle containment (barycentric, tolerant on shared edges). */
  function cornerContaining(tri, g) {
    for (var c = 0; c < 3; c++) {
      var A = tri[c], B = tri[(c + 1) % 3], Cc = tri[(c + 2) % 3];
      var cA = A;
      var cB = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      var cC = { x: (A.x + Cc.x) / 2, y: (A.y + Cc.y) / 2 };
      if (pointInTriangle(g, cA, cB, cC, 1e-7)) return c;
    }
    /* Off-gasket input (e.g. drifted marker): nearest corner region. */
    var best = 0, bd = 1e18;
    for (var k = 0; k < 3; k++) {
      var d = distance(g, tri[k]);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function pointInTriangle(p, a, b, c, eps) {
    var d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
    var neg = (d1 < -eps) || (d2 < -eps) || (d3 < -eps);
    var pos = (d1 > eps) || (d2 > eps) || (d3 > eps);
    return !(neg && pos);
  }
  function sign(p1, p2, p3) {
    return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  }

  /* Address digits of g: s_1 = corner of the FULL triangle containing g,
     s_{k+1} = corner containing the preimage 2*g^{(k)} - A_{s_k} (which stays
     in the full triangle). Applying s_1..s_k from ANY start converges to g
     with factor 2^-k (all maps contract by 1/2 around the preimage chain). */
  function addressDigits(goal, attractors, maxDepth) {
    var full = [
      { x: attractors[0].x, y: attractors[0].y },
      { x: attractors[1].x, y: attractors[1].y },
      { x: attractors[2].x, y: attractors[2].y }
    ];
    var gcur = { x: goal.x, y: goal.y };
    var digits = [];
    for (var k = 0; k < maxDepth; k++) {
      var c = cornerContaining(full, gcur);
      digits.push(c);
      gcur = { x: 2 * gcur.x - full[c].x, y: 2 * gcur.y - full[c].y };
    }
    return digits;
  }

  /* Beam search route: legal jumps only. Ends when d <= 0.9R.
     Primary pass is pure beam search (width 8, depth 13, distance scoring).
     If the beam gets trapped in a distance local minimum (e.g. a 2-cycle pocket),
     a second pass follows the goal's symbolic address — still legal jumps only —
     which converges from any start by contraction. Verified forward; never faked. */
  function routeSearch(start, goal, R, attractors, opts) {
    opts = opts || {};
    var width = opts.width || C.BEAM_WIDTH;
    var maxDepth = opts.maxDepth || C.BEAM_DEPTH;
    var tol = (opts.tol !== undefined) ? opts.tol : C.ROUTE_TOL_FRAC * R;
    var best0 = distance(start, goal);
    if (best0 <= tol) return { found: true, path: [], positions: [{ x: start.x, y: start.y }], finalDistance: best0, length: 0 };
    var beam = [{ p: { x: start.x, y: start.y }, path: [], d: best0 }];
    var visited = {};
    function vkey(p) { return Math.round(p.x * 64) + ':' + Math.round(p.y * 64); }
    visited[vkey(start)] = 1;
    for (var depth = 0; depth < maxDepth; depth++) {
      var cand = [];
      for (var b = 0; b < beam.length; b++) {
        var node = beam[b];
        for (var i = 0; i < 3; i++) {
          var np = nextPoint(node.p, attractors[i]);
          var d = distance(np, goal);
          if (d <= tol) {
            var path = node.path.concat([i]);
            var pos = [{ x: start.x, y: start.y }];
            var q = { x: start.x, y: start.y };
            for (var s = 0; s < path.length; s++) { q = nextPoint(q, attractors[path[s]]); pos.push({ x: q.x, y: q.y }); }
            return { found: true, path: path, positions: pos, finalDistance: d, length: path.length };
          }
          var k = vkey(np) + ':' + i;
          if (visited[k]) continue;
          visited[k] = 1;
          cand.push({ p: np, path: node.path.concat([i]), d: d });
        }
      }
      if (!cand.length) break;
      /* Best-first, shorter paths win ties; skip near-duplicates of an
         already-kept candidate so the beam cannot collapse into one pocket. */
      cand.sort(function (x, y) { return (x.d - y.d) || (x.path.length - y.path.length); });
      var divTol = tol * 0.15;
      var kept = [];
      for (var ci = 0; ci < cand.length && kept.length < width; ci++) {
        var dup = false;
        for (var ki = 0; ki < kept.length; ki++) {
          if (distance(cand[ci].p, kept[ki].p) < divTol) { dup = true; break; }
        }
        if (!dup) kept.push(cand[ci]);
      }
      beam = kept.length ? kept : cand.slice(0, width);
    }
    /* Second pass: address-steered rollout. The address digits run coarse->fine;
       played back fine->coarse (reversed), each step nests into the next
       depth cell containing the goal, converging with factor 1/2 per step.
       Legal jumps from the real start, truncated at first prefix in tolerance. */
    var digits = addressDigits(goal, attractors, maxDepth).reverse();
    var q = { x: start.x, y: start.y };
    var pos2 = [{ x: q.x, y: q.y }];
    var path2 = [];
    for (var s2 = 0; s2 < digits.length; s2++) {
      q = nextPoint(q, attractors[digits[s2]]);
      path2.push(digits[s2]);
      pos2.push({ x: q.x, y: q.y });
      var dd = distance(q, goal);
      if (dd <= tol) return { found: true, path: path2, positions: pos2, finalDistance: dd, length: path2.length };
    }
    var b0 = beam[0];
    return { found: false, path: b0 ? b0.path : [], positions: [], finalDistance: b0 ? b0.d : best0, length: b0 ? b0.path.length : 0 };
  }

  /* Mathematical signature: canonical unit-triangle geometry only.
     Byte-identical across difficulties, levels, viewports by construction. */
  function fractalSignature() {
    var unit = attractorPoints(0, 0, 1);
    function q(v) { return Math.round(v * 1e9) / 1e9; }
    return JSON.stringify({
      r: C.R_JUMP, n: C.ATTRACTOR_COUNT,
      a: unit.map(function (p) { return [q(p.x), q(p.y)]; })
    });
  }

  /* Deterministic player spawn: chaos point from centroid with fixed seed. */
  function spawnPoint(attractors, seed) {
    var U = window.ChaosUtil;
    var c = centroidOf(attractors);
    var rng = new U.PRNG(seed >>> 0);
    return chaosPoint(c, attractors, rng, 40);
  }

  return {
    attractorPoints: attractorPoints,
    nextPoint: nextPoint,
    distance: distance,
    chaosPoint: chaosPoint,
    centroidOf: centroidOf,
    generateSubdivisionNodes: generateSubdivisionNodes,
    expectedNodeCount: expectedNodeCount,
    routeSearch: routeSearch,
    fractalSignature: fractalSignature,
    spawnPoint: spawnPoint
  };
})();
