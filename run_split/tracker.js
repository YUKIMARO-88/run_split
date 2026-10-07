/*
 * Run Split - GPS distance tracker core (DOM-free, testable in Node).
 *
 * Accuracy measures:
 *  1. Reject fixes whose reported accuracy is worse than maxAcc (m).
 *  2. Reject teleport jumps (implied speed > maxSpeed m/s).
 *  3. Kalman-smooth lat/lng so GPS zig-zag does not inflate distance.
 *  4. Anchor method: distance is added only once the smoothed position has
 *     moved >= minStep from the last counted point (kills standing jitter,
 *     loses nothing on a straight line because the anchor waits).
 *  5. Split time is interpolated at the exact crossing of each lap boundary,
 *     not taken from the next GPS fix.
 */
(function (root) {
  "use strict";
  var R = 6371008.8;
  function rad(d) { return d * Math.PI / 180; }
  function haversine(a, b) {
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var s = Math.sin(dLat / 2), t = Math.sin(dLng / 2);
    var h = s * s + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * t * t;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Constant-velocity Kalman filter on a local metric plane (x east, y north).
  // State per axis: [position, velocity]; sigmaA = assumed acceleration noise.
  function Kalman(sigmaA) { this.sa = sigmaA; this.ok = false; }
  Kalman.prototype.update = function (lat, lng, acc, t) {
    var r = Math.max(acc, 1); r = r * r * 0.5; // reported acc is a radius; per-axis variance
    if (!this.ok) {
      this.lat0 = lat; this.lng0 = lng;
      this.my = 111320; this.mx = 111320 * Math.cos(rad(lat));
      this.ax = { p: 0, v: 0, P: [r, 0, 0, 25] };
      this.ay = { p: 0, v: 0, P: [r, 0, 0, 25] };
      this.t = t; this.ok = true;
    } else {
      var dt = Math.max(0, (t - this.t) / 1000); this.t = t;
      var zx = (lng - this.lng0) * this.mx, zy = (lat - this.lat0) * this.my;
      step(this.ax, zx, dt, this.sa, r); step(this.ay, zy, dt, this.sa, r);
    }
    return {
      lat: this.lat0 + this.ay.p / this.my, lng: this.lng0 + this.ax.p / this.mx,
      speed: Math.sqrt(this.ax.v * this.ax.v + this.ay.v * this.ay.v)
    };
  };
  // Position-only Kalman (random-walk model, q in m/s). Lags slightly inward
  // on bends instead of overshooting outward. speed is from successive outputs.
  function KalmanPos(q) { this.q = q; this.v = -1; }
  KalmanPos.prototype.update = function (lat, lng, acc, t) {
    acc = Math.max(acc, 1);
    var sp = 0;
    if (this.v < 0) { this.lat = lat; this.lng = lng; this.v = acc * acc; this.t = t; this.sp = 0; }
    else {
      var dt = Math.max(0, (t - this.t) / 1000), prev = { lat: this.lat, lng: this.lng };
      if (dt > 0) { this.v += dt * this.q * this.q; this.t = t; }
      var k = this.v / (this.v + acc * acc);
      this.lat += k * (lat - this.lat); this.lng += k * (lng - this.lng);
      this.v = (1 - k) * this.v;
      if (dt > 0) this.sp = 0.7 * this.sp + 0.3 * haversine(prev, this) / dt;
    }
    return { lat: this.lat, lng: this.lng, speed: this.sp };
  };
  function step(a, z, dt, sa, r) {
    // predict
    var P = a.P, q = sa * sa;
    a.p += a.v * dt;
    var p00 = P[0] + dt * (P[1] + P[2]) + dt * dt * P[3] + q * dt * dt * dt * dt / 4;
    var p01 = P[1] + dt * P[3] + q * dt * dt * dt / 2;
    var p10 = P[2] + dt * P[3] + q * dt * dt * dt / 2;
    var p11 = P[3] + q * dt * dt;
    // update
    var S = p00 + r, k0 = p00 / S, k1 = p10 / S, y = z - a.p;
    a.p += k0 * y; a.v += k1 * y;
    a.P = [(1 - k0) * p00, (1 - k0) * p01, p10 - k1 * p00, p11 - k1 * p01];
  }

  function Tracker(opt) {
    opt = opt || {};
    this.lapDist = opt.lapDist || 1000;
    this.maxAcc = opt.maxAcc || 25;
    this.maxSpeed = opt.maxSpeed || 10;
    this.minStep = opt.minStep || 12;
    this.q = opt.q || 6;
    this.minSpeed = opt.minSpeed == null ? 1.0 : opt.minSpeed;
    this.mode = opt.mode || "pos";
    this.reset();
  }
  Tracker.prototype.mk = function () { return this.mode === "pos" ? new KalmanPos(this.q) : new Kalman(this.q); };
  Tracker.prototype.reset = function () {
    this.kf = this.mk();
    this.dist = 0;          // counted metres
    this.elapsed = 0;       // ms of running time (pauses excluded)
    this.running = false;
    this.startT = null;     // wall time of current running segment start
    this.anchor = null;     // last counted smoothed point {lat,lng,t,d}
    this.lastRaw = null;
    this.rejectSince = null;
    this.laps = [];         // {n, dist, time, cum, gap}
    this.lapStartElapsed = 0;
    this.nextLapAt = this.lapDist;
    this.lapGap = false;
    this.samples = [];      // {e: elapsed ms, d: dist} for rolling pace
    this.stats = { fixes: 0, badAcc: 0, jumps: 0 };
  };
  Tracker.prototype.elapsedAt = function (t) {
    return this.elapsed + (this.running && this.startT !== null ? Math.max(0, t - this.startT) : 0);
  };
  Tracker.prototype.start = function (t) {
    if (this.running) return;
    this.running = true; this.startT = t;
    this.anchor = null; // re-anchor on next fix (no distance across a pause)
  };
  Tracker.prototype.pause = function (t) {
    if (!this.running) return;
    this.elapsed = this.elapsedAt(t);
    this.running = false; this.startT = null;
  };

  // fix: {lat, lng, acc, t(ms)}. Returns array of events.
  Tracker.prototype.addFix = function (fix) {
    var ev = [];
    this.stats.fixes++;
    if (!(fix.acc <= this.maxAcc)) { this.stats.badAcc++; return ev; }
    if (this.lastRaw) {
      var dtr = (fix.t - this.lastRaw.t) / 1000;
      if (dtr <= 0) return ev;
      var sp = haversine(this.lastRaw, fix) / dtr;
      if (sp > this.maxSpeed && dtr < 30) {
        this.stats.jumps++;
        if (this.rejectSince === null) this.rejectSince = fix.t;
        // stuck on a bad reference for >15 s: accept the new location as truth
        if (fix.t - this.rejectSince < 15000) return ev;
        this.kf = this.mk(); this.anchor = null;
      }
    }
    this.rejectSince = null;
    this.lastRaw = fix;
    var p = this.kf.update(fix.lat, fix.lng, fix.acc, fix.t);
    this.last = p;
    if (!this.running) { this.anchor = null; return ev; }
    var e = this.elapsedAt(fix.t);
    if (!this.anchor) { this.anchor = { lat: p.lat, lng: p.lng, e: e }; return ev; }
    // standing still: slide the anchor along without counting the jitter
    if (p.speed < this.minSpeed) { this.anchor = { lat: p.lat, lng: p.lng, e: e }; return ev; }
    var d = haversine(this.anchor, p);
    if (d < this.minStep) return ev;
    var gap = (e - this.anchor.e) > 10000; // screen was off / GPS stalled
    if (gap) this.lapGap = true;
    var d0 = this.dist, d1 = d0 + d, e0 = this.anchor.e;
    while (d1 >= this.nextLapAt) {
      var f = (this.nextLapAt - d0) / (d1 - d0);
      var eCross = e0 + f * (e - e0);
      var lap = {
        n: this.laps.length + 1, dist: this.lapDist,
        time: eCross - this.lapStartElapsed, cum: eCross, gap: this.lapGap
      };
      this.laps.push(lap); ev.push({ type: "lap", lap: lap });
      this.lapStartElapsed = eCross; this.lapGap = gap; // crossing segment also runs into the next lap
      this.nextLapAt += this.lapDist;
    }
    this.dist = d1;
    this.anchor = { lat: p.lat, lng: p.lng, e: e };
    this.samples.push({ e: e, d: d1 });
    while (this.samples.length > 2 && e - this.samples[0].e > 30000) this.samples.shift();
    return ev;
  };
  // seconds per km over the last ~30 s, or null
  Tracker.prototype.currentPace = function () {
    var s = this.samples; if (s.length < 2) return null;
    var a = s[0], b = s[s.length - 1];
    var dd = b.d - a.d, de = (b.e - a.e) / 1000;
    if (dd < 20 || de < 5) return null;
    return de / dd * 1000;
  };
  // counted distance + not-yet-counted movement since the anchor (smooth display)
  Tracker.prototype.liveDist = function () {
    var extra = 0;
    if (this.running && this.anchor && this.last && this.last.speed >= this.minSpeed)
      extra = Math.min(haversine(this.anchor, this.last), this.minStep);
    return Math.min(this.dist + extra, this.nextLapAt - 0.01);
  };
  Tracker.prototype.lapDistNow = function () { return this.liveDist() - (this.nextLapAt - this.lapDist); };

  var api = { Tracker: Tracker, haversine: haversine, Kalman: Kalman };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RunTracker = api;
})(this);
