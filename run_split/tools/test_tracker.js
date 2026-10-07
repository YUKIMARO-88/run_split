const { Tracker, haversine } = require("../tracker.js");
const { makeTrack } = require("../sim.js");
let fail = 0;
function check(name, cond, msg) { if (!cond) fail++; console.log(`${cond ? "OK  " : "FAIL"} ${name}: ${msg}`); }
function run(name, total, opts, tolPct = 1.5, tolSec = 6) {
  const tr = new Tracker();
  const pts = makeTrack(total, opts);
  tr.start(pts[0].t);
  for (const p of pts) tr.addFix(p);
  const lapTrue = (opts.paceSecPerKm || 270);
  const err = (tr.dist - total) / total * 100;
  const lapErr = tr.laps.map((l, i) => l.time / 1000 - lapTrue - (i === 0 ? (opts.standSec || 0) : 0));
  check(name, Math.abs(err) < tolPct && lapErr.every(e => Math.abs(e) < tolSec),
    `true=${total}m measured=${tr.dist.toFixed(1)}m err=${err.toFixed(2)}% laps=${tr.laps.length} lapErr(s)=[${lapErr.map(e => e.toFixed(1))}]`);
  return tr;
}
run("realistic iPhone noise", 3000, { noise: 1.5, seed: 11 });
run("realistic 4:00/km", 5000, { noise: 1.5, seed: 12, paceSecPerKm: 240 });
for (const seed of [1, 2, 3]) run(`noisy GPS seed${seed}`, 3000, { noise: 4, seed });
run("stress: very noisy, weak acc", 3000, { noise: 8, seed: 5, acc: 12, paceSecPerKm: 300 }, 2, 10);
run("fast 3:30", 2000, { noise: 4, seed: 7, paceSecPerKm: 210 });
run("stress: standing 60s in noisy GPS", 2000, { noise: 5, seed: 9, standSec: 60 }, 2, 10);
run("standing 60s before running", 2000, { noise: 1.5, seed: 9, standSec: 60 });

// pause: stand 60 s while paused -> no distance, no time
{
  const tr = new Tracker(); const pts = makeTrack(1500, { noise: 2, seed: 4 });
  tr.start(pts[0].t);
  let paused = false;
  for (const p of pts) { if (!paused && p.trueS >= 700) { tr.pause(p.t); paused = true; } tr.addFix(p); }
  check("pause stops counting", tr.dist > 650 && tr.dist < 715, `dist at pause=${tr.dist.toFixed(1)} elapsed=${(tr.elapsedAt(pts.at(-1).t)/1000).toFixed(0)}s (expect ~189s)`);
}
// teleport jump is rejected
{
  const tr = new Tracker(); const pts = makeTrack(1000, { noise: 1.5, seed: 6 });
  pts[100] = { ...pts[100], lat: pts[100].lat + 0.003 }; // ~330 m spike
  tr.start(pts[0].t); pts.forEach(p => tr.addFix(p));
  check("GPS spike rejected", Math.abs(tr.dist - 1000) < 15, `dist=${tr.dist.toFixed(1)} jumps=${tr.stats.jumps}`);
}
// bad accuracy fixes ignored
{
  const tr = new Tracker(); const pts = makeTrack(1000, { noise: 1.5, seed: 8 });
  for (let i = 50; i < 60; i++) pts[i] = { ...pts[i], acc: 80, lat: pts[i].lat + 0.0005 };
  tr.start(pts[0].t); pts.forEach(p => tr.addFix(p));
  check("low-accuracy fixes ignored", Math.abs(tr.dist - 1000) < 30, `dist=${tr.dist.toFixed(1)} badAcc=${tr.stats.badAcc}`);
}
let raw = 0; const p0 = makeTrack(3000, { noise: 4, seed: 1 });
for (let i = 1; i < p0.length; i++) raw += haversine(p0[i - 1], p0[i]);
console.log(`(reference) unfiltered sum on noisy GPS = ${raw.toFixed(0)}m for a true 3000m`);
process.exit(fail ? 1 : 0);
