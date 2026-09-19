"use strict";
(function () {
  var C = globalThis.PaisaConvert;
  var $ = function (id) { return document.getElementById(id); };
  var HISTORY_MAX = 50;
  var st = { settings: Object.assign({}, C.DEFAULT_SETTINGS), fx: null, history: [], stale: false };

  function when(t) {
    return new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
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

  function previousComparable(idx) {
    var cur = st.history[idx];
    for (var i = idx - 1; i >= 0; i--) {
      if (st.history[i].label === cur.label && st.history[i].src === cur.src) return st.history[i];
    }
    return null;
  }

  function renderHero() {
    var idx = st.history.length - 1;
    var has = idx >= 0;
    $("breakdownSec").hidden = !has;
    $("emptySec").hidden = has;
    $("change").hidden = true;
    $("projection").hidden = true;
    if (!has) {
      $("heroLabel").textContent = "Your AWS bill in rupees";
      $("heroInr").textContent = "—";
      $("heroSub").textContent = "No reading yet";
      return;
    }
    var rd = st.history[idx];
    var r = convertReading(rd);
    var s = st.settings;
    $("heroLabel").textContent = (rd.src === "manual" ? "Manual reading" : rd.label + " · from your AWS page");
    $("heroInr").textContent = C.inr(r.total);
    $("heroSub").textContent = "The console shows " + C.usd(rd.usd) + " · " + when(rd.seenAt || rd.t);

    $("bBaseLabel").textContent = C.usd(rd.usd) + " × " + C.inr(rd.fx, 2);
    $("bBase").textContent = C.inr(r.base, 2);
    $("bMarkupLabel").textContent = s.entity === "AWS_INC" ? "Card markup " + C.pct(s.markupPct) : "Card markup (AISPL: none)";
    $("bMarkup").textContent = C.inr(r.markup, 2);
    $("bGstLabel").textContent = "GST " + C.pct(s.gstPct);
    $("bGst").textContent = C.inr(r.gst, 2);
    $("bTotal").textContent = C.inr(r.total, 2);

    if (rd.label === "Month-to-date" && r.projection !== null) {
      $("projection").hidden = false;
      $("projection").textContent = "At this pace, about " + C.inr(r.projection) + " by month end (estimate).";
    }

    var prev = previousComparable(idx);
    var ch = $("change");
    ch.hidden = false;
    ch.textContent = "";
    if (!prev) {
      var none = document.createElement("p");
      none.className = "note";
      none.textContent = "No earlier reading to compare yet. Come back after your spend changes and Paisa will show the difference.";
      ch.appendChild(none);
      return;
    }
    var d = C.change(prev, rd, s);
    var head = document.createElement("div");
    head.className = "delta num " + (d.total > 0.005 ? "up" : d.total < -0.005 ? "down" : "");
    head.textContent = (d.total > 0.005 ? "▲ " : d.total < -0.005 ? "▼ " : "") + C.signed(d.total, function (n) { return C.inr(n, 2); }) + " since " + when(prev.t);
    var split = document.createElement("div");
    split.className = "split num";
    split.textContent =
      "Spend " + C.signed(d.spend, function (n) { return C.inr(n, 2); }) + " (" + C.signed(d.usd, C.usd) + ") · Exchange rate " +
      C.signed(d.fx, function (n) { return C.inr(n, 2); });
    ch.appendChild(head);
    ch.appendChild(split);
  }

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
    $("showHud").checked = s.showHud !== false;
    if (document.activeElement !== $("manualFx")) $("manualFx").value = s.manualFx || "";
    var fx = activeFx();
    $("fxRate").textContent = fx ? C.inr(fx.rate, 2) : "unavailable";
    $("fxNote").textContent = !fx
      ? "Couldn't fetch a rate. Check your connection, or enter one below."
      : "From " + fx.source + (fx.asOf ? ", as of " + String(fx.asOf).slice(0, 10) : "") + (st.stale ? " (may be out of date)" : "") + ". Mid-market; your bank's rate will differ.";
  }

  function renderCalc() {
    var v = parseFloat($("calcUsd").value);
    var fx = activeFx();
    var ok = isFinite(v) && v >= 0 && fx;
    $("calcRecord").disabled = !ok;
    if (!ok) { $("calcOut").textContent = "—"; return; }
    var r = convertReading({ usd: v, fx: fx.rate });
    $("calcOut").textContent = C.inr(r.total, 2);
  }

  function renderHistory() {
    var sec = $("histSec");
    sec.hidden = st.history.length === 0;
    var ul = $("history");
    ul.textContent = "";
    st.history.slice(-8).reverse().forEach(function (rd) {
      var r = convertReading(rd);
      var li = document.createElement("li");
      var left = document.createElement("div");
      left.textContent = rd.src === "manual" ? "Manual" : rd.label;
      var w = document.createElement("div");
      w.className = "when";
      w.textContent = when(rd.t);
      left.appendChild(w);
      var right = document.createElement("div");
      right.className = "amt num";
      right.textContent = C.inr(r.total);
      var sm = document.createElement("small");
      sm.textContent = C.usd(rd.usd);
      right.appendChild(sm);
      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  function renderScan() {
    var p = $("scanLine");
    var sc = st.scan;
    if (!sc) {
      p.className = "scan warn";
      p.textContent = "Paisa hasn't run on an AWS page yet. Open your AWS Billing page and reload it (Ctrl+R) now that Paisa is installed.";
      return;
    }
    var path = sc.url.replace(/^https?:\/\//, "");
    p.className = "scan ok";
    p.textContent =
      "Last page scan " + when(sc.at) + " · " + path + " · " + sc.count + " $ figure" + (sc.count === 1 ? "" : "s") +
      (sc.primary ? " · headline " + C.usd(sc.primary.usd) + " (" + sc.primary.label + ")" : " · no headline figure on that view");
  }

  function render() {
    renderScan();
    renderHero();
    renderSettings();
    renderCalc();
    renderHistory();
  }

  function saveSettings(patch) {
    st.settings = Object.assign({}, st.settings, patch);
    chrome.storage.local.set({ settings: st.settings });
    render();
  }

  function bind() {
    document.querySelectorAll('input[name="entity"]').forEach(function (i) {
      i.addEventListener("change", function () { saveSettings({ entity: i.value }); });
    });
    $("markup").addEventListener("input", function () { saveSettings({ markupPct: Number($("markup").value) / 100 }); });
    $("gst").addEventListener("input", function () { saveSettings({ gstPct: Number($("gst").value) / 100 }); });
    $("showAll").addEventListener("change", function () { saveSettings({ showAll: $("showAll").checked }); });
    $("showHud").addEventListener("change", function () { saveSettings({ showHud: $("showHud").checked }); });
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
  }

  function refreshFx(force) {
    $("fxRefresh").disabled = true;
    chrome.runtime.sendMessage({ type: "getFx", force: force }, function (res) {
      $("fxRefresh").disabled = false;
      if (chrome.runtime.lastError || !res) return;
      st.fx = res.fx;
      st.stale = res.stale;
      render();
    });
  }

  chrome.storage.local.get({ settings: null, fx: null, history: [], scan: null }, function (d) {
    st.settings = Object.assign({}, C.DEFAULT_SETTINGS, d.settings || {});
    st.fx = d.fx;
    st.scan = d.scan;
    st.history = d.history || [];
    bind();
    render();
    refreshFx(false);
  });
})();
