/*
 * Run Split - synthetic GPS track for testing (?sim=1 in the browser, or Node).
 * Runs laps of a 400 m-ish rounded rectangle at a given pace with GPS noise.
 */
(function (root) {
  "use strict";
  function gauss(rng) {
    var u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // position (x,y metres) at path length s on a 400 m stadium loop (100 m straights, r=31.83 m bends)
  function loopXY(s) {
    var L = 100, r = 100 / Math.PI, P = 400;
    s = ((s % P) + P) % P;
    if (s < L) return [s, 0];
    if (s < L + 100) { var a = (s - L) / r - Math.PI / 2; return [L + r * Math.cos(a), r + r * Math.sin(a)]; }
    if (s < 2 * L + 100) return [L - (s - L - 100), 2 * r];
    var b = (s - 2 * L - 100) / r + Math.PI / 2; return [r * Math.cos(b), r + r * Math.sin(b)];
  }
  // opts: {paceSecPerKm, noise(m), acc, hz, seed, lat0, lng0, t0, standSec}
  function makeTrack(totalM, opts) {
    opts = opts || {};
    var rng = mulberry(opts.seed || 1);
    var v = 1000 / (opts.paceSecPerKm || 270);
    var noise = opts.noise == null ? 4 : opts.noise;
    var hz = opts.hz || 1, lat0 = opts.lat0 || 35.38, lng0 = opts.lng0 || 139.92;
    var t0 = opts.t0 || 0, stand = opts.standSec || 0;
    var mLat = 111320, mLng = 111320 * Math.cos(lat0 * Math.PI / 180);
    var out = [], T = stand + totalM / v + 3;
    var bx = 0, by = 0; // slow multipath bias (random walk)
    for (var t = 0; t <= T; t += 1 / hz) {
      var s = Math.max(0, Math.min(totalM, (t - stand) * v));
      var xy = loopXY(s);
      bx = 0.98 * bx + 0.3 * gauss(rng); by = 0.98 * by + 0.3 * gauss(rng);
      var x = xy[0] + bx + noise * gauss(rng) * 0.7, y = xy[1] + by + noise * gauss(rng) * 0.7;
      out.push({ lat: lat0 + y / mLat, lng: lng0 + x / mLng, acc: opts.acc || 6, t: t0 + t * 1000, trueS: s });
    }
    return out;
  }
  var api = { makeTrack: makeTrack };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RunSim = api;
})(this);
