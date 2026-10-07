const { Tracker } = require("../tracker.js");
const { makeTrack } = require("../sim.js");
const cases = [
  [3000,{noise:1.5,seed:11}],[3000,{noise:1.5,seed:12,paceSecPerKm:240}],[3000,{noise:0.5,seed:13}],
  [3000,{noise:4,seed:1}],[3000,{noise:4,seed:2}],[3000,{noise:8,seed:5,acc:12,paceSecPerKm:300}],
  [2000,{noise:4,seed:7,paceSecPerKm:210}],[2000,{noise:5,seed:9,standSec:60}],[2000,{noise:1.5,seed:9,standSec:60}],
];
const out=[];
for (const mode of ["cv","pos"]) for (const q of (mode=="cv"?[2.5,3,4,5]:[6,8,10])) for (const minStep of [10,12,15,20]) for (const minSpeed of [1.0]) {
  const errs = cases.map(([tot,o]) => { const tr=new Tracker({mode,q,minStep,minSpeed}); const p=makeTrack(tot,o); tr.start(p[0].t); p.forEach(f=>tr.addFix(f)); return (tr.dist-tot)/tot*100; });
  out.push([Math.max(...errs.map(Math.abs)), `${mode} q=${q} step=${minStep} spd=${minSpeed}  `+errs.map(e=>e.toFixed(1)).join(" ")]);
}
out.sort((a,b)=>a[0]-b[0]).slice(0,10).forEach(([w,s])=>console.log(w.toFixed(2).padStart(6),s));
