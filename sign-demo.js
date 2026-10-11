// Parent signing demo for the Agreements project page.
// The two pages are the real Admission Agreement rendered by the production
// designer, and every box below sits at the coordinates the template stores
// (PDF points, top-left origin). The flow mirrors the public signing page:
// disclosure, fill, adopt a signature, finish. Nothing leaves the browser.
(function () {
  var root = document.getElementById("sgd");
  if (!root) return;

  var PW = 612, PH = 792; // letter, in points
  var PAGES = ["/assets/projects/agreements/page1.png", "/assets/projects/agreements/page2.png"];
  var SIGNER = "James Jordan";
  var FONTS = [
    { label: "Dancing Script", css: "'Dancing Script', cursive" },
    { label: "Great Vibes", css: "'Great Vibes', cursive" },
    { label: "Caveat", css: "'Caveat', cursive" }
  ];

  // owner: "me" (Parent / Guardian), "facility" (signs after the parent), "sender" (filled at send)
  var TABS = [
    { id: "admit",   page: 1, x: 339, y: 105,   w: 84,  h: 15, type: "text", owner: "sender", value: "06/11/2026" },
    { id: "record",  page: 1, x: 438, y: 105,   w: 102, h: 15, type: "text", owner: "sender", value: "57921" },
    { id: "student", page: 1, x: 171, y: 212,   w: 186, h: 15, type: "text", owner: "me", required: true, ph: "Student's full legal name", fill: "Mason Jordan" },
    { id: "dob",     page: 1, x: 444, y: 213,   w: 90,  h: 15, type: "text", owner: "me", required: true, ph: "MM/DD/YYYY", fill: "05/27/2013" },
    { id: "program", page: 1, x: 321, y: 315.5, w: 180, h: 15, type: "dropdown", owner: "me", required: true, options: ["Residential", "Day Treatment", "Assessment Only"], fill: "Residential" },
    { id: "full",    page: 1, x: 75,  y: 399,   w: 9,   h: 9,  type: "checkbox", owner: "me", group: "participation" },
    { id: "std",     page: 1, x: 75,  y: 415,   w: 9,   h: 9,  type: "checkbox", owner: "me", group: "participation", fill: true },
    { id: "remote",  page: 1, x: 75,  y: 431,   w: 9,   h: 9,  type: "checkbox", owner: "me", group: "participation" },
    { id: "emerg",   page: 1, x: 75,  y: 500,   w: 9,   h: 9,  type: "checkbox", owner: "me", required: true, fill: true },
    { id: "photo",   page: 1, x: 75,  y: 531,   w: 9,   h: 9,  type: "checkbox", owner: "me", fill: true },
    { id: "ini1",    page: 1, x: 504, y: 702,   w: 42,  h: 18, type: "initials", owner: "me", required: true },
    { id: "sig",     page: 2, x: 63,  y: 447,   w: 237, h: 27, type: "signature", owner: "me", required: true },
    { id: "sigdate", page: 2, x: 328, y: 461,   w: 105, h: 12, type: "date", owner: "me" },
    { id: "pname",   page: 2, x: 65,  y: 491,   w: 234, h: 15, type: "text", owner: "me", required: true, ph: "Printed name", fill: SIGNER },
    { id: "rel",     page: 2, x: 328, y: 492,   w: 201, h: 15, type: "text", owner: "me", required: true, ph: "Relationship to student", fill: "Father" },
    { id: "fsig",    page: 2, x: 66,  y: 555,   w: 237, h: 27, type: "signature", owner: "facility" },
    { id: "fdate",   page: 2, x: 327, y: 570,   w: 105, h: 12, type: "text", owner: "facility" },
    { id: "fname",   page: 2, x: 66,  y: 600,   w: 234, h: 15, type: "text", owner: "facility" },
    { id: "ftitle",  page: 2, x: 327, y: 603,   w: 201, h: 15, type: "text", owner: "facility" },
    { id: "ini2",    page: 2, x: 504, y: 702,   w: 42,  h: 18, type: "initials", owner: "me", required: true }
  ];

  var state = { screen: "gate", values: {}, sig: null, consent: false, pendingBox: "" };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function today() { var d = new Date(); return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear(); }
  function initialsOf(name) { return (name || "").split(/\s+/).map(function (w) { return (w.replace(/[^A-Za-z]/g, "")[0] || ""); }).join("").toUpperCase().slice(0, 4); }
  function pct(v, of) { return (v / of * 100).toFixed(3) + "%"; }

  function filled(t) {
    if (t.type === "signature") return !!state.sig;
    if (t.type === "initials") return !!state.sig;
    if (t.type === "checkbox") return !!state.values[t.id];
    return !!(state.values[t.id] && String(state.values[t.id]).trim());
  }
  function requiredTabs() { return TABS.filter(function (t) { return t.owner === "me" && t.required; }); }
  function doneCount() { return requiredTabs().filter(filled).length; }

  // ---------------------------------------------------------------- screens
  function header(sub) {
    return '<div class="sgd-head"><div class="sgd-org">Summit Ridge Academy</div>' +
      '<h3 class="sgd-title">Admissions paperwork</h3>' +
      '<p class="sgd-hi">' + esc(sub || SIGNER + " · Parent / Guardian") + '</p></div>';
  }

  function renderGate() {
    root.innerHTML = header() +
      '<div class="sgd-disclosure"><b>Electronic records and signatures</b>' +
      '<p>Summit Ridge Academy would like you to review and sign these documents electronically. By continuing you agree that your typed or drawn signature carries the same weight as one on paper, that you can save or print a copy of anything you sign, and that you may decline and ask for a paper copy instead.</p>' +
      '<p class="sgd-muted">1 document · 2 pages · the Academy signs after you</p></div>' +
      '<div class="sgd-acts"><button type="button" class="sgd-btn primary" data-act="agree">I agree, continue</button>' +
      '<button type="button" class="sgd-btn ghost" data-act="decline">I do not consent</button></div>';
  }

  function renderDeclined() {
    root.innerHTML = header("") +
      '<div class="sgd-done"><h4>Thank you. The sender has been notified.</h4>' +
      '<p>Nothing was submitted. The admissions team can arrange a paper copy instead.</p>' +
      '<button type="button" class="sgd-btn ghost" data-act="restart">Start over</button></div>';
  }

  function tabHtml(t) {
    var style = 'left:' + pct(t.x, PW) + ';top:' + pct(t.y, PH) + ';width:' + pct(t.w, PW) + ';height:' + pct(t.h, PH) + ';';
    var cls = "sgd-tab" + (t.owner === "me" ? " mine" : "") + (t.type === "checkbox" ? " is-check" : "");
    var inner = "";
    if (t.owner === "sender") {
      inner = '<span class="sgd-ro">' + esc(t.value) + '</span>';
    } else if (t.owner === "facility") {
      inner = '<span class="sgd-wait">' + (t.type === "signature" ? "Academy signs next" : "") + '</span>';
    } else if (t.type === "text") {
      inner = '<input type="text" data-id="' + t.id + '" value="' + esc(state.values[t.id] || "") + '" placeholder="' + esc(t.ph || "") + '" aria-label="' + esc(t.ph || t.id) + '">';
    } else if (t.type === "date") {
      inner = '<span class="sgd-ro">' + esc(state.values[t.id] || "") + '</span>';
    } else if (t.type === "dropdown") {
      inner = '<select data-id="' + t.id + '" aria-label="Program"><option value="">Choose…</option>' +
        t.options.map(function (o) { return '<option' + (state.values[t.id] === o ? " selected" : "") + '>' + esc(o) + '</option>'; }).join("") + '</select>';
    } else if (t.type === "checkbox") {
      inner = '<input type="checkbox" data-id="' + t.id + '"' + (state.values[t.id] ? " checked" : "") + ' aria-label="' + t.id + '">';
    } else if (t.type === "signature" || t.type === "initials") {
      if (state.sig) {
        var ini = t.type === "initials";
        if (state.sig.img && !ini) inner = '<img class="sgd-sigimg" src="' + state.sig.img + '" alt="Signature" data-box="' + t.id + '">';
        else inner = '<span class="sgd-sigtxt' + (ini ? " ini" : "") + '" style="font-family:' + state.sig.font + '" data-box="' + t.id + '">' + esc(ini ? initialsOf(state.sig.name) : state.sig.name) + '</span>';
      } else {
        inner = '<button type="button" class="sgd-signbox" data-box="' + t.id + '">' + (t.type === "initials" ? "Initial" : "Sign") + '</button>';
      }
    }
    return '<div class="' + cls + '" style="' + style + '">' + inner + '</div>';
  }

  function renderSigning() {
    var html = header();
    html += '<div class="sgd-doclist">';
    html += '<div class="sgd-dochead"><span class="sgd-docnum">Document 1 of 1</span><span class="sgd-doctitle">SRA Admission Agreement</span><span class="sgd-docpages">2 pages</span></div>';
    for (var p = 1; p <= 2; p++) {
      html += '<div class="sgd-page"><img class="sgd-pageimg" src="' + PAGES[p - 1] + '" alt="Admission Agreement, page ' + p + '" width="857" height="1109" loading="lazy">' +
        '<div class="sgd-overlay">' + TABS.filter(function (t) { return t.page === p; }).map(tabHtml).join("") + '</div></div>';
    }
    html += '</div>';
    html += '<div class="sgd-bar">' +
      '<label class="sgd-consent"><input type="checkbox" data-act="consent"' + (state.consent ? " checked" : "") + '> <span>I agree to sign these documents electronically.</span></label>' +
      '<span class="sgd-progress" role="status"></span>' +
      '<button type="button" class="sgd-btn ghost" data-act="autofill">Fill it in for me</button>' +
      '<button type="button" class="sgd-btn primary" data-act="finish">Finish</button></div>';
    root.innerHTML = html;
    updateProgress();
  }

  function updateProgress() {
    var n = doneCount(), total = requiredTabs().length;
    var el = root.querySelector(".sgd-progress");
    var fin = root.querySelector('[data-act="finish"]');
    if (el) el.textContent = n === total ? "All " + total + " required fields complete" : n + " of " + total + " required fields complete";
    if (fin) fin.disabled = !(n === total && state.consent);
  }

  function renderDone() {
    root.innerHTML = header("") +
      '<div class="sgd-done"><div class="sgd-check" aria-hidden="true">✓</div><h4>Thanks, James. Your part is done.</h4>' +
      '<p>Here is what happens next, with no one copying anything by hand:</p>' +
      '<ol><li>The Academy representative gets their link and signs their fields.</li>' +
      '<li>The signed PDF is stamped with every signature, date and initial, plus a certificate of completion.</li>' +
      '<li>Copies are emailed to everyone who signed.</li>' +
      '<li>The agreement is filed in the student\'s record automatically.</li></ol>' +
      '<button type="button" class="sgd-btn ghost" data-act="restart">Start over</button></div>';
  }

  // ----------------------------------------------------------------- modal
  var padState = null;

  function openModal() {
    closeModal();
    var m = document.createElement("div");
    m.className = "sgd-modal-back";
    m.id = "sgd-modal";
    m.innerHTML = '<div class="sgd-modal" role="dialog" aria-modal="true" aria-label="Adopt your signature">' +
      '<div class="sgd-modal-h">Adopt your signature</div>' +
      '<div class="sgd-tabs"><button type="button" class="sgd-tabbtn active" data-tab="type">Type</button><button type="button" class="sgd-tabbtn" data-tab="draw">Draw</button></div>' +
      '<div class="sgd-pane" data-pane="type"><label class="sgd-lbl" for="sgd-name">Full name</label><input id="sgd-name" class="sgd-name" value="' + esc(SIGNER) + '"><div class="sgd-faces"></div></div>' +
      '<div class="sgd-pane" data-pane="draw" hidden><label class="sgd-lbl">Draw with your mouse or finger</label><canvas class="sgd-pad" width="560" height="150"></canvas><button type="button" class="sgd-clear" data-act="clearpad">Clear</button></div>' +
      '<div class="sgd-modal-f"><button type="button" class="sgd-btn ghost" data-act="cancel">Cancel</button><button type="button" class="sgd-btn primary" data-act="adopt">Adopt and sign</button></div></div>';
    document.body.appendChild(m);
    m.dataset.face = "0";
    m.dataset.mode = "type";
    renderFaces();
    setupPad(m.querySelector(".sgd-pad"));
    m.querySelector("#sgd-name").addEventListener("input", renderFaces);
    m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });
    setTimeout(function () { var n = m.querySelector("#sgd-name"); if (n) n.focus(); }, 0);
  }

  function renderFaces() {
    var m = document.getElementById("sgd-modal"); if (!m) return;
    var host = m.querySelector(".sgd-faces");
    var name = (m.querySelector("#sgd-name").value || "").trim() || "Your name";
    var cur = +m.dataset.face;
    host.innerHTML = FONTS.map(function (f, i) {
      return '<button type="button" class="sgd-face' + (i === cur ? " active" : "") + '" data-face="' + i + '" style="font-family:' + f.css + '"><span class="sgd-face-name">' + esc(name) + '</span><span class="sgd-face-ini">' + esc(initialsOf(name) || "··") + '</span></button>';
    }).join("") + '<div class="sgd-hint">The boxed mark is your initials. It fills the initials boxes.</div>';
  }

  function setupPad(canvas) {
    var ctx = canvas.getContext("2d");
    var ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var cssW = canvas.clientWidth || 560, cssH = 150;
    canvas.width = Math.round(cssW * ratio); canvas.height = Math.round(cssH * ratio);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#12325a";
    var drawing = false, lx = 0, ly = 0;
    padState = { drawn: false, canvas: canvas, clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); padState.drawn = false; } };
    function pos(e) { var r = canvas.getBoundingClientRect(); var t = (e.touches && e.touches[0]) || e; return { x: (t.clientX - r.left) * (cssW / r.width), y: (t.clientY - r.top) * (cssH / r.height) }; }
    function start(e) { drawing = true; var p = pos(e); lx = p.x; ly = p.y; e.preventDefault(); }
    function move(e) { if (!drawing) return; var p = pos(e); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke(); lx = p.x; ly = p.y; padState.drawn = true; e.preventDefault(); }
    function end() { drawing = false; }
    canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); document.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false }); canvas.addEventListener("touchend", end);
  }

  function closeModal() { var m = document.getElementById("sgd-modal"); if (m) m.remove(); padState = null; }

  function adopt() {
    var m = document.getElementById("sgd-modal"); if (!m) return;
    var name = (m.querySelector("#sgd-name").value || "").trim();
    if (m.dataset.mode === "draw" && padState && padState.drawn) {
      state.sig = { name: name || SIGNER, font: FONTS[0].css, img: padState.canvas.toDataURL("image/png") };
    } else {
      if (!name) { m.querySelector("#sgd-name").focus(); return; }
      state.sig = { name: name, font: FONTS[+m.dataset.face].css };
    }
    state.values.sigdate = today();
    closeModal();
    renderSigning();
    var box = root.querySelector('[data-box="' + state.pendingBox + '"]');
    if (box) box.closest(".sgd-tab").classList.add("pulse");
    state.pendingBox = "";
  }

  // ---------------------------------------------------------------- actions
  function autofill() {
    TABS.forEach(function (t) { if (t.owner === "me" && t.fill != null && !filled(t)) state.values[t.id] = t.fill; });
    state.consent = true;
    renderSigning();
    if (!state.sig) { state.pendingBox = "sig"; openModal(); }
  }

  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act], .sgd-signbox, [data-box]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "agree") { state.screen = "sign"; renderSigning(); return; }
    if (act === "decline") { renderDeclined(); return; }
    if (act === "restart") { state = { screen: "gate", values: {}, sig: null, consent: false, pendingBox: "" }; renderGate(); return; }
    if (act === "autofill") { autofill(); return; }
    if (act === "finish") { if (!el.disabled) renderDone(); return; }
    if (el.classList.contains("sgd-signbox") || el.hasAttribute("data-box")) { state.pendingBox = el.getAttribute("data-box"); openModal(); }
  });

  root.addEventListener("input", function (e) {
    var id = e.target.getAttribute("data-id");
    if (id) {
      var t = TABS.filter(function (x) { return x.id === id; })[0];
      if (t && t.type === "checkbox") {
        state.values[id] = e.target.checked;
        if (t.group && e.target.checked) TABS.forEach(function (o) { if (o.group === t.group && o.id !== id) { state.values[o.id] = false; var cb = root.querySelector('[data-id="' + o.id + '"]'); if (cb) cb.checked = false; } });
      } else state.values[id] = e.target.value;
      updateProgress();
    }
    if (e.target.getAttribute("data-act") === "consent") { state.consent = e.target.checked; updateProgress(); }
  });

  document.addEventListener("click", function (e) {
    var m = document.getElementById("sgd-modal"); if (!m || !m.contains(e.target)) return;
    var el = e.target.closest("[data-act], [data-tab], [data-face]");
    if (!el) return;
    if (el.hasAttribute("data-tab")) {
      var tab = el.getAttribute("data-tab");
      m.dataset.mode = tab;
      m.querySelectorAll(".sgd-tabbtn").forEach(function (b) { b.classList.toggle("active", b === el); });
      m.querySelectorAll(".sgd-pane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== tab; });
      return;
    }
    if (el.hasAttribute("data-face")) { m.dataset.face = el.getAttribute("data-face"); renderFaces(); return; }
    var act = el.getAttribute("data-act");
    if (act === "cancel") closeModal();
    else if (act === "adopt") adopt();
    else if (act === "clearpad" && padState) padState.clear();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  renderGate();
})();
