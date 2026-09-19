// The toolbar popup. Two modes, one set of numbers:
//
//   signed in  - shows the same bill the console panel shows, from the API;
//   otherwise  - works standalone on readings the content script took from
//                the console page, plus the calculator.
//
// Settings are the subtle part. The content script's badges are drawn from
// chrome.storage, while the API computes the bill from server-side settings.
// If those two drifted, the badge on the page and the bill in the panel would
// disagree. So when signed in the server is the source of truth and every
// change is written to both; signed out, storage alone.
"use strict";
(function () {
  var C = globalThis.PaisaConvert;
  var $ = function (id) { return document.getElementById(id); };
  var HISTORY_MAX = 50;
  var st = {
    settings: Object.assign({}, C.DEFAULT_SETTINGS),
    fx: null,
    history: [],
    scan: null,
    stale: false,
    session: null,
    config: { configured: false },
    bill: null,
    authStage: "email",
    authEmail: "",
    busy: false,
  };

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          resolve(chrome.runtime.lastError || !res ? { ok: false, status: 0, error: "The extension needs a reload." } : res);
        });
      } catch (e) {
        resolve({ ok: false, status: 0, error: "The extension needs a reload." });
      }
    });
  }
  var api = function (method, path, body) { return send({ type: "api", method: method, path: path, body: body }); };

  function when(t) {
    return new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function dayLabel(iso) {
    var d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? iso : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  }
  function monthName(ym) {
    var p = String(ym || "").split("-").map(Number);
    if (!p[0] || !p[1]) return "";
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(p[0], p[1] - 1, 1)));
  }

  function activeFx() {
    var m = st.settings.manualFx;
    if (typeof m === "number" && m > 0) return { rate: m, source: "your override" };
    return st.fx ? { rate: st.fx.rate, source: st.fx.source, asOf: st.fx.asOf } : null;
  }

  function convertReading(rd) {
    var s = st.settings;
    var now = new Date();
    var dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return C.convert({
      usd: rd.usd, fx: rd.fx, entity: s.entity, markupPct: s.markupPct, gstPct: s.gstPct,
      daysElapsed: Math.max(1, now.getUTCDate()), daysInMonth: dim,
    });
  }

  // ---- the real bill -------------------------------------------------------
  function renderBill() {
    var b = st.bill;
    var signedIn = !!st.session;
    $("billSec").hidden = !b;
    $("authSec").hidden = signedIn || !st.config.configured;
    // Standalone readings are only interesting when there is no real bill.
    $("heroSec").hidden = !!b;
    $("chip").textContent = "Estimate";
    $("chip").className = "chip warn";
    $("who").textContent = st.session ? st.session.email : "";
    if (!b) return;

    var s = b.settings;
    var inc = s.entity === "AWS_INC";
    $("billLabel").textContent = "So far · " + monthName(b.month);
    $("billTotal").textContent = C.inr(b.breakdown.total, 0);
    $("billSub").textContent = C.usd(b.usd) + " on the AWS console · as of " + dayLabel(b.asOf) + " · day " + b.daysElapsed + " of " + b.daysInMonth;
    $("billProjection").hidden = false;
    $("billProjection").textContent = C.inr(b.projection, 0);
    $("billProjectionSub").hidden = false;
    $("billProjectionSub").textContent =
      "expected bill this month, including " + C.pct(s.gst_pct, 0) + " GST" + (inc ? " and " + C.pct(s.markup_pct, 1) + " card markup" : "");

    $("bBaseLabel").textContent = C.usd(b.usd) + " × " + C.inr(b.fx.rate, 2);
    $("bBase").textContent = C.inr(b.breakdown.base, 2);
    $("bMarkupLabel").textContent = inc ? "Card markup " + C.pct(s.markup_pct) : "Card markup (AISPL: none)";
    $("bMarkup").textContent = C.inr(b.breakdown.markup, 2);
    $("bGstLabel").textContent = "GST " + C.pct(s.gst_pct);
    $("bGst").textContent = C.inr(b.breakdown.gst, 2);
    $("bTotal").textContent = C.inr(b.breakdown.total, 2);

    var ul = $("billServices");
    ul.textContent = "";
    (b.services || []).forEach(function (svc) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = svc.name;
      var amt = document.createElement("span");
      amt.textContent = C.inr(svc.inr, 0);
      var sm = document.createElement("small");
      sm.textContent = C.usd(svc.usd);
      amt.appendChild(sm);
      li.appendChild(name);
      li.appendChild(amt);
      ul.appendChild(li);
    });
    $("billProvider").textContent = b.providerNote || "";
  }

  function loadBill(force) {
    if (!st.session || !st.config.configured) return Promise.resolve();
    return api("GET", "/spend" + (force ? "?refresh=1" : ""), null).then(function (r) {
      if (r.ok) {
        st.bill = r.data;
        // Keep the page badges on the same assumptions as the bill.
        var next = Object.assign({}, st.settings, {
          entity: r.data.settings.entity,
          markupPct: r.data.settings.markup_pct,
          gstPct: r.data.settings.gst_pct,
        });
        st.settings = next;
        chrome.storage.local.set({ settings: next });
      } else if (r.status === 401) {
        st.session = null;
        st.bill = null;
      } else if (r.status === 409) {
        st.bill = null;
        note("billMsg", false, "Connect your AWS account first — open your AWS console and use the ₹ Bill button there.");
      } else {
        note("billMsg", false, r.error);
      }
      render();
    });
  }

  function note(id, ok, text) {
    var el = $(id);
    el.hidden = !text;
    el.className = "msg " + (ok ? "ok" : "err");
    el.textContent = text || "";
  }

  // ---- sign in -------------------------------------------------------------
  function renderAuth() {
    var coding = st.authStage === "code";
    var confirming = st.authStage === "confirm";
    $("authEmail").hidden = coding;
    $("authEmailLabel").hidden = coding;
    $("authCode").hidden = !coding;
    $("authCodeLabel").hidden = !coding;
    $("authBack").hidden = st.authStage === "email";
    $("authTitle").textContent = coding ? "Enter your code" : confirming ? "Confirm your email" : "See your real bill";
    $("authNote").textContent = coding
      ? "We emailed a 6-digit code to " + st.authEmail + ". It expires in 10 minutes."
      : confirming
        ? "AWS emailed " + st.authEmail + " a “Confirm subscription” link. Click it (check spam), then continue."
        : "Sign in with your email. We send a 6-digit code, so there's no password and no AWS keys.";
    $("authGo").textContent = st.busy ? "Working…" : coding ? "Sign in" : confirming ? "I've confirmed, send my code" : "Send me a code";
    $("authGo").disabled = st.busy;
  }

  function authGo() {
    st.busy = true;
    note("authMsg", false, "");
    render();
    var done = function () { st.busy = false; render(); };
    if (st.authStage === "code") {
      return api("POST", "/auth/verify", { email: st.authEmail, code: $("authCode").value.trim() }).then(function (r) {
        if (!r.ok) { note("authMsg", false, r.error); return done(); }
        st.session = { email: r.data.email };
        st.authStage = "email";
        return loadBill(false).then(done);
      });
    }
    var email = st.authStage === "confirm" ? st.authEmail : $("authEmail").value.trim();
    if (!email) { st.busy = false; return render(); }
    st.authEmail = email;
    return api("POST", "/auth/start", { email: email }).then(function (r) {
      if (!r.ok) note("authMsg", false, r.error);
      else st.authStage = r.data.status === "code_sent" ? "code" : "confirm";
      done();
    });
  }

  // ---- standalone readings -------------------------------------------------
  function previousComparable(idx) {
    var cur = st.history[idx];
    for (var i = idx - 1; i >= 0; i--) {
      if (st.history[i].label === cur.label && st.history[i].src === cur.src) return st.history[i];
    }
    return null;
  }

  function renderHero() {
    if (st.bill) return;
    var idx = st.history.length - 1;
    var has = idx >= 0;
    $("heroTable").hidden = !has;
    $("heroEmpty").hidden = has;
    $("change").hidden = true;
    if (!has) {
      $("heroLabel").textContent = "Your AWS bill in rupees";
      $("heroInr").textContent = "—";
      $("heroSub").textContent = "No reading yet";
      return;
    }
    var rd = st.history[idx];
    var r = convertReading(rd);
    var s = st.settings;
    $("heroLabel").textContent = rd.src === "manual" ? "Manual reading" : rd.label + " · from your AWS page";
    $("heroInr").textContent = C.inr(r.total, 0);
    $("heroSub").textContent = "The console shows " + C.usd(rd.usd) + " · " + when(rd.seenAt || rd.t);
    $("hBaseLabel").textContent = C.usd(rd.usd) + " × " + C.inr(rd.fx, 2);
    $("hBase").textContent = C.inr(r.base, 2);
    $("hMarkupLabel").textContent = s.entity === "AWS_INC" ? "Card markup " + C.pct(s.markupPct) : "Card markup (AISPL: none)";
    $("hMarkup").textContent = C.inr(r.markup, 2);
    $("hGstLabel").textContent = "GST " + C.pct(s.gstPct);
    $("hGst").textContent = C.inr(r.gst, 2);
    $("hTotal").textContent = C.inr(r.total, 2);

    var prev = previousComparable(idx);
    var ch = $("change");
    ch.hidden = false;
    ch.textContent = "";
    if (!prev) {
      var p = document.createElement("p");
      p.className = "note";
      p.textContent = "No earlier reading to compare yet. Come back after your spend changes.";
      ch.appendChild(p);
      return;
    }
    var d = C.change(prev, rd, s);
    var head = document.createElement("div");
    head.className = "delta num " + (d.total > 0.005 ? "up" : d.total < -0.005 ? "down" : "");
    head.textContent = (d.total > 0.005 ? "▲ " : d.total < -0.005 ? "▼ " : "") + C.signed(d.total, function (n) { return C.inr(n, 2); }) + " since " + when(prev.t);
    var split = document.createElement("div");
    split.className = "split num";
    split.textContent =
      "Spend " + C.signed(d.spend, function (n) { return C.inr(n, 2); }) + " (" + C.signed(d.usd, C.usd) + ") · Exchange rate " + C.signed(d.fx, function (n) { return C.inr(n, 2); });
    ch.appendChild(head);
    ch.appendChild(split);
  }

  function renderScan() {
    var p = $("scanLine");
    var sc = st.scan;
    if (st.bill) { p.textContent = ""; return; }
    if (!sc) {
      p.className = "scan warn";
      p.textContent = "Paisa hasn't run on an AWS page yet. Open your AWS Billing page and reload it.";
      return;
    }
    p.className = "scan";
    p.textContent =
      "Last page scan " + when(sc.at) + " · " + sc.url.replace(/^https?:\/\//, "") + " · " + sc.count + " $ figure" + (sc.count === 1 ? "" : "s") +
      (sc.primary ? " · headline " + C.usd(sc.primary.usd) : "");
  }

  // ---- settings ------------------------------------------------------------
  function renderSettings() {
    var s = st.settings;
    document.querySelectorAll('input[name="entity"]').forEach(function (i) { i.checked = i.value === s.entity; });
    var inc = s.entity === "AWS_INC";
    $("markupCtl").classList.toggle("disabled", !inc);
    $("markup").disabled = !inc;
    $("markup").value = (s.markupPct * 100).toFixed(1);
    $("markupOut").textContent = (s.markupPct * 100).toFixed(1) + "%";
    $("gst").value = (s.gstPct * 100).toFixed(0);
    $("gstOut").textContent = (s.gstPct * 100).toFixed(0) + "%";
    $("showAll").checked = !!s.showAll;
    if (document.activeElement !== $("manualFx")) $("manualFx").value = s.manualFx || "";
    $("settingsScope").textContent = st.session
      ? "Saved to your Paisa account, so your bill, your emails and the figures on the page all agree."
      : "Saved in this browser. Sign in to use them for your real bill and emails too.";

    var fx = activeFx();
    $("fxRate").textContent = fx ? C.inr(fx.rate, 2) : "unavailable";
    $("fxNote").textContent = !fx
      ? "Couldn't fetch a rate. Check your connection, or enter one below."
      : "From " + fx.source + (fx.asOf ? ", as of " + String(fx.asOf).slice(0, 10) : "") + (st.stale ? " (may be out of date)" : "") + ". Mid-market; your bank's rate will differ.";
  }

  function saveSettings(patch) {
    st.settings = Object.assign({}, st.settings, patch);
    chrome.storage.local.set({ settings: st.settings });
    render();
    // When signed in the server owns these, so push the same change there and
    // re-read the bill with them applied.
    if (st.session && st.config.configured && ("entity" in patch || "markupPct" in patch || "gstPct" in patch)) {
      clearTimeout(saveSettings.timer);
      saveSettings.timer = setTimeout(function () {
        api("PUT", "/settings", {
          entity: st.settings.entity,
          markup_pct: st.settings.markupPct,
          gst_pct: st.settings.gstPct,
        }).then(function (r) {
          if (r.ok) loadBill(false);
        });
      }, 500);
    }
  }

  function renderCalc() {
    var v = parseFloat($("calcUsd").value);
    var fx = activeFx();
    var ok = isFinite(v) && v >= 0 && fx;
    $("calcRecord").disabled = !ok;
    $("calcOut").textContent = ok ? C.inr(convertReading({ usd: v, fx: fx.rate }).total, 2) : "—";
  }

  function renderHistory() {
    $("histSec").hidden = st.history.length === 0 || !!st.bill;
    var ul = $("history");
    ul.textContent = "";
    st.history.slice(-8).reverse().forEach(function (rd) {
      var li = document.createElement("li");
      var left = document.createElement("div");
      left.textContent = rd.src === "manual" ? "Manual" : rd.label;
      var w = document.createElement("div");
      w.className = "when";
      w.textContent = when(rd.t);
      left.appendChild(w);
      var right = document.createElement("div");
      right.className = "amt";
      right.textContent = C.inr(convertReading(rd).total, 0);
      var sm = document.createElement("small");
      sm.textContent = C.usd(rd.usd);
      right.appendChild(sm);
      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  function render() {
    renderBill();
    renderAuth();
    renderHero();
    renderScan();
    renderSettings();
    renderCalc();
    renderHistory();
  }

  function bind() {
    document.querySelectorAll('input[name="entity"]').forEach(function (i) {
      i.addEventListener("change", function () { saveSettings({ entity: i.value }); });
    });
    $("markup").addEventListener("input", function () { saveSettings({ markupPct: Number($("markup").value) / 100 }); });
    $("gst").addEventListener("input", function () { saveSettings({ gstPct: Number($("gst").value) / 100 }); });
    $("showAll").addEventListener("change", function () { saveSettings({ showAll: $("showAll").checked }); });
    $("manualFx").addEventListener("input", function () {
      var v = parseFloat($("manualFx").value);
      saveSettings({ manualFx: isFinite(v) && v > 0 ? v : null });
    });
    $("calcUsd").addEventListener("input", renderCalc);
    $("calcRecord").addEventListener("click", function () {
      var v = parseFloat($("calcUsd").value);
      var fx = activeFx();
      if (!isFinite(v) || !fx) return;
      st.history = st.history.concat({ t: Date.now(), seenAt: Date.now(), usd: v, fx: fx.rate, label: "manual", src: "manual" }).slice(-HISTORY_MAX);
      chrome.storage.local.set({ history: st.history });
      render();
    });
    $("histClear").addEventListener("click", function () {
      st.history = [];
      chrome.storage.local.set({ history: [] });
      render();
    });
    $("fxRefresh").addEventListener("click", function () { refreshFx(true); });
    $("billRefresh").addEventListener("click", function () {
      note("billMsg", true, "");
      $("billRefresh").disabled = true;
      loadBill(true).then(function () { $("billRefresh").disabled = false; });
    });
    $("billEmail").addEventListener("click", function () {
      $("billEmail").disabled = true;
      api("POST", "/email-summary", null).then(function (r) {
        $("billEmail").disabled = false;
        note("billMsg", r.ok, r.ok ? "Sent to " + r.data.sentTo + ". Check your inbox (and spam)." : r.error);
      });
    });
    $("authGo").addEventListener("click", authGo);
    $("authBack").addEventListener("click", function () { st.authStage = "email"; note("authMsg", false, ""); render(); });
    $("authCode").addEventListener("keydown", function (e) { if (e.key === "Enter") authGo(); });
    $("authEmail").addEventListener("keydown", function (e) { if (e.key === "Enter") authGo(); });
  }

  function refreshFx(force) {
    $("fxRefresh").disabled = true;
    send({ type: "getFx", force: force }).then(function (res) {
      $("fxRefresh").disabled = false;
      if (!res || res.ok === false) return;
      st.fx = res.fx;
      st.stale = res.stale;
      render();
    });
  }

  chrome.storage.local.get({ settings: null, fx: null, history: [], scan: null, session: null }, function (d) {
    st.settings = Object.assign({}, C.DEFAULT_SETTINGS, d.settings || {});
    st.fx = d.fx;
    st.history = d.history || [];
    st.scan = d.scan;
    st.session = d.session;
    bind();
    send({ type: "config" }).then(function (cfg) {
      if (cfg && typeof cfg.configured === "boolean") st.config = cfg;
      render();
      refreshFx(false);
      return loadBill(false);
    });
  });
})();
