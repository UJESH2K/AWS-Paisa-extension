// Runs on AWS Billing / Cost Management pages (including iframes). Finds dollar
// amounts, puts an estimated rupee figure next to them, and records the headline
// figure so the popup can show how the cost changes. The console DOM is not
// ours and will change, so everything here fails silently rather than breaking
// the page. A small corner card always says what Paisa found, so "nothing
// happened" is never a mystery.
(function () {
  "use strict";
  var C = globalThis.PaisaConvert;
  if (!C || window.__paisaLoaded) return;
  window.__paisaLoaded = true;

  var NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?";
  var AMOUNTS = [
    new RegExp("^\\s*(?:US\\s?)?\\$\\s?" + NUM + "\\s*$"), // $12.34, US$12
    new RegExp("^\\s*USD\\s?" + NUM + "\\s*$", "i"), // USD 12.34
    new RegExp("^\\s*" + NUM + "\\s?USD\\s*$", "i"), // 12.34 USD
  ];
  var HAS_CURRENCY = /\$|USD/i;
  var LABELS = [
    { re: /month[-\s]to[-\s]date/i, name: "Month-to-date", score: 3 },
    { re: /cost to date|current month|total (?:estimated )?(?:cost|charges|bill|amount)/i, name: "Total cost", score: 2 },
    { re: /forecast|estimated/i, name: "Forecast", score: 1 },
  ];
  var HISTORY_MAX = 50;
  var RECORD_EVERY_MS = 12 * 60 * 60 * 1000;
  var TOP = window === window.top;

  var state = { settings: C.DEFAULT_SETTINGS, fx: null };
  var badges = new Map(); // amount element -> badge element
  var timer = null;
  var popover = null;
  var hud = null;
  var lastScanKey = "";
  var lastScanAt = 0;
  var last = { found: 0, primary: null };

  function safe(fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        /* never break the console */
      }
    };
  }

  function ours(node) {
    var e = node && node.nodeType === 1 ? node : node && node.parentElement;
    return !!(e && e.closest && e.closest("[data-paisa]"));
  }

  // Text of an element with our own badges excluded, so injecting a badge
  // into an element doesn't stop us recognising it next time.
  function amountText(el) {
    if (el.textContent.length > 80) return "";
    if (!el.querySelector("[data-paisa]")) return el.textContent;
    var out = "";
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (!ours(w.currentNode)) out += w.currentNode.nodeValue;
    return out;
  }

  function parseAmount(text) {
    for (var i = 0; i < AMOUNTS.length; i++) {
      var m = AMOUNTS[i].exec(text);
      if (m) return parseFloat(m[1].replace(/,/g, "") + (m[2] || ""));
    }
    return null;
  }

  function visible(el) {
    return el.getClientRects().length > 0;
  }

  // All text nodes, including inside open shadow roots.
  function textNodes(root, out) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) out.push(w.currentNode);
    var els = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (var i = 0; i < els.length; i++) if (els[i].shadowRoot) textNodes(els[i].shadowRoot, out);
    return out;
  }

  function findAmounts() {
    var found = [];
    var seen = new Set();
    var nodes = textNodes(document.body, []);
    for (var n = 0; n < nodes.length; n++) {
      var tn = nodes[n];
      if (!HAS_CURRENCY.test(tn.nodeValue) || ours(tn)) continue;
      // Climb to the outermost element that still reads as one amount, so
      // "<span>$</span><span>47.30</span>" is treated as a single figure.
      var e = tn.parentElement;
      var best = null;
      for (var i = 0; e && i < 4; i++, e = e.parentElement) {
        var t = amountText(e);
        if (t && parseAmount(t) !== null) best = e;
        else if (best) break;
      }
      if (!best || seen.has(best) || !visible(best)) continue;
      seen.add(best);
      found.push({ el: best, usd: parseAmount(amountText(best)) });
    }
    return found;
  }

  function labelFor(el) {
    var e = el.parentElement;
    for (var i = 0; e && i < 5; i++, e = e.parentElement) {
      var text = e.textContent;
      if (text.length > 240) break;
      for (var j = 0; j < LABELS.length; j++) {
        if (LABELS[j].re.test(text)) return LABELS[j];
      }
    }
    return null;
  }

  // The headline figure: the amount sitting in a "Month-to-date" / "Total cost"
  // style card, else the largest-type amount on the page.
  function pickPrimary(found) {
    var best = null;
    found.forEach(function (f) {
      var lab = labelFor(f.el);
      var size = parseFloat(getComputedStyle(f.el).fontSize) || 0;
      var score = (lab ? lab.score : 0) * 1000 + size;
      if (!best || score > best.score) best = { el: f.el, usd: f.usd, label: lab ? lab.name : "Largest figure", score: score };
    });
    return best;
  }

  function fxRate() {
    var m = state.settings.manualFx;
    if (typeof m === "number" && m > 0) return { rate: m, source: "manual" };
    return state.fx ? { rate: state.fx.rate, source: state.fx.source, asOf: state.fx.asOf } : null;
  }

  function calc(usd) {
    var fx = fxRate();
    if (!fx) return null;
    var s = state.settings;
    var now = new Date();
    var dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return {
      fx: fx,
      r: C.convert({
        usd: usd,
        fx: fx.rate,
        entity: s.entity,
        markupPct: s.markupPct,
        gstPct: s.gstPct,
        daysElapsed: Math.max(1, now.getUTCDate()),
        daysInMonth: dim,
      }),
    };
  }

  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function row(label, value, strong) {
    var r = el("div", "paisa-row" + (strong ? " paisa-strong" : ""));
    r.appendChild(el("span", "", label));
    r.appendChild(el("span", "", value));
    return r;
  }

  function openPopover(anchor, usd) {
    closePopover();
    var c = calc(usd);
    if (!c) return;
    var s = state.settings;
    var p = el("div", "paisa-pop");
    p.setAttribute("data-paisa", "pop");
    p.appendChild(el("div", "paisa-pop-title", "Paisa · estimate"));
    p.appendChild(row(C.usd(usd) + " × " + C.inr(c.fx.rate, 2), C.inr(c.r.base, 2)));
    p.appendChild(row(s.entity === "AWS_INC" ? "Card markup " + C.pct(s.markupPct) : "Card markup (AISPL: none)", C.inr(c.r.markup, 2)));
    p.appendChild(row("GST " + C.pct(s.gstPct), C.inr(c.r.gst, 2)));
    p.appendChild(row("Total", C.inr(c.r.total, 2), true));
    p.appendChild(
      el(
        "div",
        "paisa-pop-foot",
        "Rate from " + c.fx.source + (c.fx.asOf ? " (" + String(c.fx.asOf).slice(0, 10) + ")" : "") + ". Open the Paisa popup for changes and settings.",
      ),
    );
    document.body.appendChild(p);
    var rect = anchor.getBoundingClientRect();
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - p.offsetWidth - 8);
    var top = rect.bottom + 6;
    if (top + p.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - p.offsetHeight - 6);
    p.style.left = left + "px";
    p.style.top = top + "px";
    popover = p;
  }

  function upsertBadge(elm, usd, primary) {
    var c = calc(usd);
    if (!c) return;
    var text = "≈ " + C.inr(c.r.total);
    var b = badges.get(elm);
    if (b && b.isConnected && (b.getAttribute("data-paisa") === "primary") === primary) {
      if (b.textContent !== text) b.textContent = text;
      b.__usd = usd;
      return;
    }
    if (b) b.remove();
    b = el("span", primary ? "paisa-badge" : "paisa-inline", text);
    b.setAttribute("data-paisa", primary ? "primary" : "inline");
    b.__usd = usd;
    if (primary) {
      b.setAttribute("role", "button");
      b.setAttribute("tabindex", "0");
      b.title = "Estimated cost in rupees after forex, card markup and GST. Click for the breakdown.";
      var open = safe(function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        if (popover) closePopover();
        else openPopover(b, b.__usd);
      });
      b.addEventListener("click", open);
      b.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") open(ev);
      });
    }
    // Inline elements get the badge as a sibling. Block-level containers (and
    // table cells) get it appended inside, so it sits on the figure's own line.
    if (getComputedStyle(elm).display.indexOf("inline") === 0) elm.insertAdjacentElement("afterend", b);
    else elm.appendChild(b);
    badges.set(elm, b);
  }

  var record = safe(function (p) {
    var fx = fxRate();
    if (!fx) return;
    chrome.storage.local.get({ history: [] }, function (d) {
      var h = d.history || [];
      var prev = null;
      for (var i = h.length - 1; i >= 0; i--) {
        if (h[i].src === "page" && h[i].label === p.label) {
          prev = h[i];
          break;
        }
      }
      var now = Date.now();
      if (prev && Math.abs(prev.usd - p.usd) < 0.005 && now - prev.t < RECORD_EVERY_MS) {
        if (now - (prev.seenAt || prev.t) > 60000) {
          prev.seenAt = now;
          chrome.storage.local.set({ history: h });
        }
        return;
      }
      h.push({ t: now, seenAt: now, usd: p.usd, fx: fx.rate, label: p.label, src: "page" });
      chrome.storage.local.set({ history: h.slice(-HISTORY_MAX) });
    });
  });

  // Tells the popup whether Paisa ran on an AWS page and what it found.
  var reportScan = safe(function (found, primary) {
    if (!TOP && found.length === 0) return;
    var info = {
      at: Date.now(),
      url: location.origin + location.pathname,
      frame: TOP ? "top" : "iframe",
      count: found.length,
      primary: primary ? { label: primary.label, usd: primary.usd } : null,
    };
    var key = JSON.stringify([info.url, info.frame, info.count, info.primary]);
    if (key === lastScanKey && Date.now() - lastScanAt < 30000) return;
    lastScanKey = key;
    lastScanAt = Date.now();
    chrome.storage.local.set({ scan: info });
  });

  // ---- corner card -------------------------------------------------------
  function hudDismissed() {
    try {
      return window.sessionStorage.getItem("paisa.hud.off") === "1";
    } catch (e) {
      return false;
    }
  }

  function buildReport() {
    var nodes = textNodes(document.body, []);
    var snippets = [];
    for (var i = 0; i < nodes.length && snippets.length < 30; i++) {
      var tn = nodes[i];
      if (!HAS_CURRENCY.test(tn.nodeValue) || ours(tn)) continue;
      var p = tn.parentElement;
      snippets.push({
        text: tn.nodeValue.trim().slice(0, 60),
        tag: p ? p.tagName : null,
        cls: p ? String(p.className || "").slice(0, 60) : null,
        parentText: p && p.parentElement ? p.parentElement.textContent.trim().slice(0, 80) : null,
        matched: parseAmount(tn.nodeValue.trim()) !== null,
      });
    }
    return {
      paisa: "0.1.1",
      page: location.origin + location.pathname,
      title: document.title,
      frame: TOP ? "top" : "iframe",
      hasFx: !!fxRate(),
      amountsFound: last.found,
      headline: last.primary,
      currencyTextNodes: snippets,
    };
  }

  function copyReport(btn) {
    var text = JSON.stringify(buildReport(), null, 2);
    var done = function () {
      btn.textContent = "Copied";
      setTimeout(function () {
        btn.textContent = "Copy report";
      }, 1500);
    };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("data-paisa", "tmp");
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (e) {
        /* ignore */
      }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function ensureHud() {
    if (hud && hud.isConnected) return hud;
    hud = el("div", "paisa-hud");
    hud.setAttribute("data-paisa", "hud");
    var head = el("div", "paisa-hud-head");
    head.appendChild(el("span", "paisa-hud-logo", "₹"));
    head.appendChild(el("span", "paisa-hud-title", "Paisa"));
    var x = el("button", "paisa-hud-x", "×");
    x.type = "button";
    x.title = "Hide for this tab";
    x.setAttribute("aria-label", "Hide Paisa card");
    x.addEventListener("click", function () {
      try {
        window.sessionStorage.setItem("paisa.hud.off", "1");
      } catch (e) {
        /* ignore */
      }
      hud.remove();
      hud = null;
    });
    head.appendChild(x);
    hud.appendChild(head);
    hud.appendChild(el("div", "paisa-hud-main"));
    hud.appendChild(el("div", "paisa-hud-sub"));
    var cp = el("button", "paisa-hud-copy", "Copy report");
    cp.type = "button";
    cp.addEventListener("click", function () {
      copyReport(cp);
    });
    hud.appendChild(cp);
    document.body.appendChild(hud);
    return hud;
  }

  function renderHud(found, primary) {
    if (!TOP) return;
    if (state.settings.showHud === false || hudDismissed()) {
      if (hud) {
        hud.remove();
        hud = null;
      }
      return;
    }
    var h = ensureHud();
    var main = h.querySelector(".paisa-hud-main");
    var sub = h.querySelector(".paisa-hud-sub");
    var c = primary ? calc(primary.usd) : null;
    var m, s;
    if (!fxRate()) {
      m = "Waiting for the exchange rate…";
      s = "Fetching USD to INR. Reload if this stays.";
    } else if (primary && c) {
      m = "≈ " + C.inr(c.r.total);
      s = primary.label + " " + C.usd(primary.usd) + " · " + found.length + " $ figure" + (found.length === 1 ? "" : "s") + " on this page";
    } else {
      m = "No $ figure found yet";
      s = "Paisa is running, but this view has no dollar amount. Open the Billing home or Cost Explorer.";
    }
    if (main.textContent !== m) main.textContent = m;
    if (sub.textContent !== s) sub.textContent = s;
  }

  var run = safe(function () {
    if (!document.body) return;
    var found = findAmounts();
    var primary = pickPrimary(found);
    last = { found: found.length, primary: primary ? { label: primary.label, usd: primary.usd } : null };
    reportScan(found, primary);
    renderHud(found, primary);
    if (!fxRate()) return;
    var live = new Set(found.map(function (f) { return f.el; }));
    badges.forEach(function (b, elm) {
      if (!live.has(elm) || !elm.isConnected) {
        b.remove();
        badges.delete(elm);
      }
    });
    found.forEach(function (f) {
      var isPrimary = !!primary && f.el === primary.el;
      if (!isPrimary && !state.settings.showAll) {
        var old = badges.get(f.el);
        if (old) {
          old.remove();
          badges.delete(f.el);
        }
        return;
      }
      upsertBadge(f.el, f.usd, isPrimary);
    });
    if (primary) record(primary);
  });

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 500);
  }

  function loadState(cb) {
    chrome.storage.local.get({ settings: null, fx: null }, function (d) {
      state.settings = Object.assign({}, C.DEFAULT_SETTINGS, d.settings || {});
      state.fx = d.fx;
      cb();
    });
  }

  function start() {
    loadState(function () {
      run();
      // Ask the service worker for a rate; it serves cache and refreshes behind it.
      chrome.runtime.sendMessage({ type: "getFx" }, function (res) {
        if (chrome.runtime.lastError || !res || !res.fx) return;
        state.fx = res.fx;
        run();
      });
    });

    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (ours(m.target)) continue;
        if (m.type === "childList" && Array.prototype.concat.call([], Array.from(m.addedNodes), Array.from(m.removedNodes)).every(ours)) continue;
        schedule();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    // The console is a single-page app that renders late and navigates without
    // reloading: re-scan on route changes and on a slow timer as a safety net.
    window.addEventListener("hashchange", schedule);
    window.addEventListener("popstate", schedule);
    setInterval(function () {
      if (document.visibilityState === "visible") schedule();
    }, 4000);

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local" || !(changes.settings || changes.fx)) return;
      loadState(function () {
        closePopover();
        run();
      });
    });

    document.addEventListener("click", function (ev) {
      if (popover && !ours(ev.target)) closePopover();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closePopover();
    });
  }

  function boot() {
    try {
      start();
    } catch (e) {
      /* fail silently */
    }
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
