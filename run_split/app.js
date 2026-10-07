/* Run Split - UI, GPS watch, voice, wake lock, history. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var SIM = qs.has("sim");
  var SIM_SPEED = Math.max(1, Number(qs.get("speed")) || 1);
  var HIST_KEY = "runsplit.history.v1", VOICE_KEY = "runsplit.voice";

  var state = "idle"; // idle | running | paused | done
  var tracker = new RunTracker.Tracker({ lapDist: 1000 });
  var lastFix = null, wakeLock = null, hiddenAt = null;
  var simT = 0;
  var now = function () { return SIM ? simT : Date.now(); };

  // ---------- formatting ----------
  function fmt(ms, withTenth) {
    if (ms == null || !isFinite(ms)) return "--:--";
    var s = Math.max(0, ms) / 1000;
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    var ss = withTenth ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss;
  }
  function fmtPace(secPerKm) {
    if (!secPerKm || secPerKm > 1800) return "--:--";
    var m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    if (s === 60) { m++; s = 0; }
    return m + ":" + String(s).padStart(2, "0");
  }
  function fmtDiff(ms) {
    var s = ms / 1000, sign = s < 0 ? "-" : "+";
    return sign + Math.abs(s).toFixed(1) + "s";
  }

  // ---------- storage (may be unavailable) ----------
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- voice ----------
  var voiceOn = load(VOICE_KEY, true);
  function renderVoice() { $("voiceBtn").classList.toggle("off", !voiceOn); $("voiceBtn").textContent = voiceOn ? "🔊" : "🔇"; }
  function speak(text) {
    if (!voiceOn || !("speechSynthesis" in window)) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP"; u.rate = 1.05;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) {}
  }
  function jaTime(ms) {
    var s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return (m ? m + "分" : "") + r + "秒";
  }

  // ---------- wake lock ----------
  async function lockScreen() {
    if (SIM || !("wakeLock" in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { wakeLock = null; }
  }
  function unlockScreen() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }

  // ---------- GPS ----------
  function onFix(fix) {
    lastFix = fix;
    var ev = tracker.addFix(fix);
    ev.forEach(function (e) { if (e.type === "lap") onLap(e.lap); });
    renderGps();
  }
  function renderGps() {
    var el = $("gps"), t = $("gpsText");
    if (!lastFix) return;
    var age = (now() - lastFix.t) / 1000, a = Math.round(lastFix.acc);
    el.className = "pill " + (age > 10 || a > 25 ? "bad" : a <= 10 ? "good" : "mid");
    t.textContent = age > 10 ? "GPS 途切れ中" : "GPS ±" + a + "m" + (a > 25 ? "（弱い）" : "");
  }
  function startGps() {
    if (SIM) return startSim();
    if (!("geolocation" in navigator)) { showWarn("この端末・ブラウザでは位置情報が使えません。"); return; }
    if (!window.isSecureContext) { showWarn("位置情報は https のページでしか使えません。公開URL（https://〜）から開いてください。"); return; }
    navigator.geolocation.watchPosition(function (p) {
      onFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() });
    }, function (err) {
      if (err.code === 1) showWarn("位置情報が許可されていません。設定 → プライバシーとセキュリティ → 位置情報サービス → Safari（またはこのアプリ）を「使用中のみ」＋「正確な位置情報 オン」にしてください。");
      else $("gpsText").textContent = "GPS 測位中…";
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function startSim() {
    var track = RunSim.makeTrack(Number(qs.get("km") || 3) * 1000, { noise: 1.5, seed: 3, paceSecPerKm: Number(qs.get("pace") || 270), standSec: 5 });
    var i = 0; simT = track[0].t;
    setInterval(function () {
      if (state === "idle" || state === "done") { simT += 1000; onFix(Object.assign({}, track[0], { t: simT })); return; }
      if (i < track.length) { var f = track[i++]; simT = f.t + simOffset; onFix(Object.assign({}, f, { t: simT })); }
    }, 1000 / SIM_SPEED);
    var simOffset = 0;
    window.__simStart = function () { simOffset = simT - track[0].t; i = 0; };
  }

  // ---------- warnings ----------
  function showWarn(msg) { var w = $("warn"); w.textContent = msg; w.hidden = !msg; }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { if (state === "running") hiddenAt = now(); return; }
    if (state === "running") {
      lockScreen();
      if (hiddenAt && now() - hiddenAt > 5000)
        showWarn("画面が消えていた約" + Math.round((now() - hiddenAt) / 1000) + "秒間はGPSが止まり、その区間は直線距離で補っています。計測中は画面を消さないでください。");
    }
    hiddenAt = null;
  });

  // ---------- laps ----------
  function onLap(lap) {
    renderLaps();
    var prev = tracker.laps[lap.n - 2];
    var label = tracker.lapDist === 1000 ? lap.n + "キロ" : "ラップ" + lap.n;
    var msg = label + "、" + jaTime(lap.time);
    if (prev) {
      var d = Math.round((lap.time - prev.time) / 1000);
      msg += d === 0 ? "。前と同じ" : d < 0 ? "。前より" + (-d) + "秒速い" : "。前より" + d + "秒遅い";
    }
    speak(msg);
  }
  function renderLaps(partial) {
    var laps = tracker.laps, body = $("lapBody");
    $("lapTable").hidden = !laps.length && !partial;
    var best = laps.length > 1 ? Math.min.apply(null, laps.map(function (l) { return l.time; })) : -1;
    var rows = laps.map(function (l, i) {
      var diff = i ? l.time - laps[i - 1].time : null;
      return "<tr class='" + (l.time === best ? "best" : "") + "'><td>" + l.n +
        (l.gap ? "<span class='flag' title='GPS途切れを含む'>⚠</span>" : "") + "</td><td class='t'>" + fmt(l.time, true) +
        "</td><td class='" + (diff == null ? "" : diff < 0 ? "faster" : "slower") + "'>" + (diff == null ? "" : fmtDiff(diff)) + "</td></tr>";
    });
    if (partial) rows.push("<tr class='partial'><td>端数 " + Math.round(partial.dist) + "m</td><td class='t'>" +
      fmt(partial.time, true) + "</td><td>" + fmtPace(partial.dist > 50 ? partial.time / partial.dist : 0) + "/km</td></tr>");
    body.innerHTML = rows.reverse().join("");
  }

  // ---------- main readout ----------
  function render() {
    var t = now(), e = state === "idle" ? 0 : tracker.elapsedAt(t);
    var dist = state === "idle" ? 0 : (state === "done" ? tracker.dist : tracker.liveDist());
    $("dist").textContent = (Math.floor(dist / 10) / 100).toFixed(2);
    $("time").textContent = fmt(e);
    $("pace").textContent = state === "running" ? fmtPace(tracker.currentPace()) : (state === "done" && dist > 50 ? fmtPace(e / dist) : "--:--");
    var lapD = state === "idle" ? 0 : Math.max(0, tracker.lapDistNow());
    var lapT = state === "idle" ? 0 : e - tracker.lapStartElapsed;
    $("lapNo").textContent = state === "done" ? "平均ペース" : "LAP " + (tracker.laps.length + 1);
    $("lapTime").textContent = state === "done" ? fmtPace(dist > 50 ? e / dist : 0) + " /km" : fmt(lapT);
    $("lapBar").style.width = Math.min(100, lapD / tracker.lapDist * 100) + "%";
    $("lapDist").textContent = Math.round(lapD) + " m";
    $("lapTarget").textContent = "/ " + tracker.lapDist + " m";
    renderGps();
  }
  setInterval(render, 200);

  // ---------- controls ----------
  function show(ids) {
    ["startBtn", "pauseBtn", "resumeBtn", "stopBtn", "newBtn"].forEach(function (id) { $(id).hidden = ids.indexOf(id) < 0; });
    $("setup").hidden = state !== "idle";
  }
  $("startBtn").onclick = function () {
    tracker = new RunTracker.Tracker({ lapDist: Number($("lapSel").value) });
    if (SIM && window.__simStart) window.__simStart();
    tracker.start(now());
    state = "running"; showWarn("");
    if (lastFix && lastFix.acc > 25) showWarn("GPSの精度がまだ低い状態です（±" + Math.round(lastFix.acc) + "m）。開けた場所で緑になるまで待つと正確になります。");
    speak("スタート"); // also unlocks speech on iOS (needs a user gesture)
    lockScreen(); renderLaps(); show(["pauseBtn", "stopBtn"]);
  };
  $("pauseBtn").onclick = function () { tracker.pause(now()); state = "paused"; speak("一時停止"); show(["resumeBtn", "stopBtn"]); };
  $("resumeBtn").onclick = function () { tracker.start(now()); state = "running"; speak("再開"); show(["pauseBtn", "stopBtn"]); };
  $("newBtn").onclick = function () { state = "idle"; tracker = new RunTracker.Tracker({ lapDist: Number($("lapSel").value) }); renderLaps(); showWarn(""); show(["startBtn"]); };

  // long-press to finish (prevents accidental stop while running)
  var holdStart = null, holdRaf = null;
  function holdTick() {
    var p = Math.min(1, (performance.now() - holdStart) / 900);
    $("stopBtn").querySelector(".fill").style.width = p * 100 + "%";
    if (p >= 1) { holdEnd(); finish(); return; }
    holdRaf = requestAnimationFrame(holdTick);
  }
  function holdEnd() { holdStart = null; cancelAnimationFrame(holdRaf); $("stopBtn").querySelector(".fill").style.width = "0"; }
  $("stopBtn").addEventListener("pointerdown", function (e) { e.preventDefault(); holdStart = performance.now(); holdTick(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (n) { $("stopBtn").addEventListener(n, function () { if (holdStart) holdEnd(); }); });
  $("stopBtn").addEventListener("contextmenu", function (e) { e.preventDefault(); });

  function finish() {
    tracker.pause(now()); state = "done"; unlockScreen();
    var e = tracker.elapsed, partial = { dist: tracker.lapDistNow(), time: e - tracker.lapStartElapsed };
    if (partial.dist < 1) partial = null;
    renderLaps(partial);
    speak("終了。" + (Math.floor(tracker.dist / 10) / 100).toFixed(2) + "キロ、" + jaTime(e));
    if (tracker.dist > 50) {
      var h = load(HIST_KEY, []);
      h.unshift({ at: Date.now(), lapDist: tracker.lapDist, dist: tracker.dist, time: e,
        laps: tracker.laps.map(function (l) { return Math.round(l.time); }), partial: partial });
      save(HIST_KEY, h.slice(0, 50));
    }
    show(["newBtn"]);
  }

  // ---------- history ----------
  function renderHist() {
    var h = load(HIST_KEY, []), el = $("histList");
    if (!h.length) { el.innerHTML = "<div class='empty'>まだ記録がありません</div>"; return; }
    el.innerHTML = h.map(function (r, i) {
      var d = new Date(r.at);
      var date = (d.getMonth() + 1) + "/" + d.getDate() + " " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
      var laps = r.laps.map(function (ms, j) { return (j + 1) + ": " + fmt(ms, true); }).join("　");
      return "<div class='hist'><div class='h1'><span>" + date + "</span><b>" + (Math.floor(r.dist / 10) / 100).toFixed(2) + " km / " + fmt(r.time) +
        "</b></div><div class='laps-s'>" + (r.lapDist === 1000 ? "" : r.lapDist + "mラップ　") + (laps || "ラップなし") +
        (r.partial ? "　端数" + Math.round(r.partial.dist) + "m " + fmt(r.partial.time, true) : "") +
        "</div><button class='del' data-i='" + i + "'>削除</button></div>";
    }).join("");
  }
  $("histBtn").onclick = function () { renderHist(); $("histDlg").showModal(); };
  $("histClose").onclick = function () { $("histDlg").close(); };
  $("histList").onclick = function (e) {
    var i = e.target.getAttribute && e.target.getAttribute("data-i");
    if (i == null || !confirm("この記録を削除しますか？")) return;
    var h = load(HIST_KEY, []); h.splice(Number(i), 1); save(HIST_KEY, h); renderHist();
  };
  $("voiceBtn").onclick = function () { voiceOn = !voiceOn; save(VOICE_KEY, voiceOn); renderVoice(); if (voiceOn) speak("音声オン"); };

  // ---------- boot ----------
  renderVoice(); show(["startBtn"]); startGps(); render();
  if ("serviceWorker" in navigator && !SIM) navigator.serviceWorker.register("sw.js").catch(function () {});
  window.__app = { get tracker() { return tracker; }, get state() { return state; } };
})();
