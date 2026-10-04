// Record with BlueIQ, simulated. Same UI and states as the production
// component; the recording, transcription and writing are scripted.
(function () {
  var root = document.getElementById("biq-demo");
  if (!root) return;

  var TRANSCRIPT =
    "Okay, evening shift. He had a rough start after his phone call home. Kind of shut down at dinner and didn't want to eat. " +
    "I sat with him for a while, we did some breathing, and he came back around and ended up playing cards with the group. " +
    "He was really kind to the new student, showed him how the point sheet works. Did all his chores without being asked. " +
    "Only thing is he mentioned he's not sleeping great, and he's worried about family session on Thursday.";

  var NOTE = {
    summary:
      "Resident appeared withdrawn following a scheduled phone call home and declined dinner. Staff provided one-on-one support and guided breathing exercises. Resident re-engaged with peers and participated appropriately in a group card game for the rest of the evening.",
    strengths:
      "Helped a newly admitted peer learn the point system. Completed assigned chores independently without prompting.",
    concerns:
      "Resident reported difficulty sleeping and expressed worry about Thursday's family session."
  };

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var launch = root.querySelector(".biq-launch");
  var overlay = root.querySelector(".biq-overlay");
  var closeBtn = root.querySelector(".biq-collapse");
  var recordBtn = root.querySelector("#biq-record");
  var recordLabel = recordBtn.querySelector(".biq-btn-label");
  var rerecordBtn = root.querySelector("#biq-rerecord");
  var timerEl = root.querySelector(".biq-timer");
  var statusEl = root.querySelector(".biq-status");
  var vizEl = root.querySelector(".biq-viz");
  var transcriptWrap = root.querySelector(".biq-transcript-wrap");
  var transcriptEl = root.querySelector(".biq-transcript");
  var replayBtn = document.getElementById("biq-replay");
  var fields = {
    summary: root.querySelector('[data-field="summary"]'),
    strengths: root.querySelector('[data-field="strengths"]'),
    concerns: root.querySelector('[data-field="concerns"]')
  };

  var bars = [];
  for (var i = 0; i < 14; i++) {
    var bar = document.createElement("span");
    bar.className = "biq-viz-bar";
    vizEl.appendChild(bar);
    bars.push(bar);
  }

  var recording = false, written = false, typed = false;
  var timers = [], tickTimer = null, vizTimer = null, autoStop = null, seconds = 0;

  function later(fn, ms) { var t = setTimeout(fn, reduced ? Math.min(ms, 300) : ms); timers.push(t); return t; }
  function clearAll() {
    timers.forEach(clearTimeout); timers = [];
    clearInterval(tickTimer); clearInterval(vizTimer); clearTimeout(autoStop);
  }

  function setStatus(text, kind, thinking) {
    statusEl.textContent = text;
    statusEl.className = "biq-status" + (kind ? " is-" + kind : "") + (thinking ? " biq-dots" : "");
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function open() {
    overlay.hidden = false;
    launch.classList.remove("is-nudge");
    recordBtn.focus();
  }

  function close() {
    if (recording) stop(true);
    overlay.hidden = true;
    launch.focus();
    if (written && !typed) typeNote();
  }

  function start() {
    recording = true;
    written = false;
    overlay.classList.add("is-recording");
    recordBtn.classList.add("is-recording");
    recordLabel.textContent = "Stop";
    recordBtn.hidden = false;
    rerecordBtn.hidden = true;
    transcriptWrap.hidden = true;
    seconds = 0;
    timerEl.textContent = "00:00";
    setStatus("Recording… click stop when you're done.", "rec");
    tickTimer = setInterval(function () {
      seconds++;
      timerEl.textContent = pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60);
    }, 1000);
    if (!reduced) {
      vizTimer = setInterval(function () {
        for (var i = 0; i < bars.length; i++) {
          bars[i].style.height = Math.round(3 + Math.random() * Math.random() * 23) + "px";
        }
      }, 90);
    }
    autoStop = setTimeout(function () { if (recording) stop(); }, 12000);
  }

  function stop(silent) {
    recording = false;
    clearInterval(tickTimer); clearInterval(vizTimer); clearTimeout(autoStop);
    bars.forEach(function (b) { b.style.height = "3px"; });
    overlay.classList.remove("is-recording");
    recordBtn.classList.remove("is-recording");
    recordLabel.textContent = "Record";
    if (silent) { setStatus("Idle"); return; }

    recordBtn.disabled = true;
    setStatus("Transcribing", "", true);
    later(function () {
      transcriptEl.textContent = TRANSCRIPT;
      transcriptWrap.hidden = false;
      setStatus("BlueIQ is writing your note", "", true);
      later(function () {
        written = true;
        typed = false;
        recordBtn.disabled = false;
        recordBtn.hidden = true;
        rerecordBtn.hidden = false;
        setStatus("Done. Close to review and save your note.", "ok");
      }, 2200);
    }, 1600);
  }

  function typeNote() {
    typed = true;
    var order = ["summary", "strengths", "concerns"];
    function fill(idx) {
      if (idx >= order.length) { replayBtn.hidden = false; return; }
      var el = fields[order[idx]], text = NOTE[order[idx]];
      el.classList.add("is-filled");
      if (reduced) { el.textContent = text; fill(idx + 1); return; }
      var pos = 0;
      (function step() {
        pos = Math.min(text.length, pos + 3);
        el.textContent = text.slice(0, pos);
        if (pos < text.length) later(step, 12);
        else later(function () { fill(idx + 1); }, 180);
      })();
    }
    later(function () { fill(0); }, 250);
  }

  function reset() {
    clearAll();
    recording = written = typed = false;
    Object.keys(fields).forEach(function (k) {
      fields[k].textContent = "";
      fields[k].classList.remove("is-filled");
    });
    recordBtn.hidden = false;
    recordBtn.disabled = false;
    rerecordBtn.hidden = true;
    transcriptWrap.hidden = true;
    timerEl.textContent = "00:00";
    setStatus("Idle");
    replayBtn.hidden = true;
  }

  launch.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  recordBtn.addEventListener("click", function () { recording ? stop() : start(); });
  rerecordBtn.addEventListener("click", function () {
    Object.keys(fields).forEach(function (k) { fields[k].textContent = ""; fields[k].classList.remove("is-filled"); });
    start();
  });
  overlay.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  replayBtn.addEventListener("click", function () {
    reset();
    launch.classList.add("is-nudge");
    launch.focus();
  });

  // Draw the eye to the launcher once the demo scrolls into view
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { launch.classList.add("is-nudge"); io.disconnect(); }
    }, { threshold: 0.6 });
    io.observe(root);
  }
})();
