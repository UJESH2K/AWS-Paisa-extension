// Runs on AWS Billing / Cost Management pages. Finds dollar amounts, puts an
// estimated rupee figure next to them, and records the headline figure so the
// popup can show how the cost changes. The console DOM is not ours and will
// change, so everything here fails silently rather than breaking the page.
(function () {
  "use strict";
  var C = globalThis.PaisaConvert;
  if (!C || window.__paisaLoaded) return;
  window.__paisaLoaded = true;

  var AMOUNT = /^\s*(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*$/;
  var LABELS = [
    { re: /month[-\s]to[-\s]date/i, name: "Month-to-date", score: 3 },
    { re: /cost to date|current month|total (?:estimated )?(?:cost|charges|bill|amount)/i, name: "Total cost", score: 2 },
    { re: /forecast|estimated/i, name: "Forecast", score: 1 },
  ];
  var HISTORY_MAX = 50;
  var RECORD_EVERY_MS = 12 * 60 * 60 * 1000;

  var state = { settings: C.DEFAULT_SETTINGS, fx: null };
  var badges = new Map(); // amount element -> badge element
  var timer = null;
  var popover = null;

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
    var m = AMOUNT.exec(text);
    return m ? parseFloat(m[1].replace(/,/g, "") + (m[2] || "")) : null;
  }

  function visible(el) {
    return el.getClientRects().length > 0;
  }

  function findAmounts() {
    var found = [];
    var seen = new Set();
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var tn = w.currentNode;
      if (tn.nodeValue.indexOf("$") === -1 || ours(tn)) continue;
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

  function row(label, value, strong) {
    var r = document.createElement("div");
    r.className = "paisa-row" + (strong ? " paisa-strong" : "");
    var a = document.createElement("span");
    a.textContent = label;
    var b = document.createElement("span");
    b.textContent = value;
    r.appendChild(a);
    r.appendChild(b);
    return r;
  }

  function openPopover(anchor, usd) {
    closePopover();
    var c = calc(usd);
    if (!c) return;
    var s = state.settings;
    var p = document.createElement("div");
    p.setAttribute("data-paisa", "pop");
    p.className = "paisa-pop";
    var h = document.createElement("div");
    h.className = "paisa-pop-title";
    h.textContent = "Paisa · estimate";
    p.appendChild(h);
    p.appendChild(row(C.usd(usd) + " × " + C.inr(c.fx.rate, 2), C.inr(c.r.base, 2)));
    p.appendChild(row(s.entity === "AWS_INC" ? "Card markup " + C.pct(s.markupPct) : "Card markup (AISPL: none)", C.inr(c.r.markup, 2)));
    p.appendChild(row("GST " + C.pct(s.gstPct), C.inr(c.r.gst, 2)));
    p.appendChild(row("Total", C.inr(c.r.total, 2), true));
    var f = document.createElement("div");
    f.className = "paisa-pop-foot";
    f.textContent =
      "Rate from " + c.fx.source + (c.fx.asOf ? " (" + String(c.fx.asOf).slice(0, 10) + ")" : "") + ". Open the Paisa popup for changes and settings.";
    p.appendChild(f);
    document.body.appendChild(p);
    var rect = anchor.getBoundingClientRect();
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - p.offsetWidth - 8);
    var top = rect.bottom + 6;
    if (top + p.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - p.offsetHeight - 6);
    p.style.left = left + "px";
    p.style.top = top + "px";
    popover = p;
  }

  function upsertBadge(el, usd, primary) {
    var c = calc(usd);
    if (!c) return;
    var text = "≈ " + C.inr(c.r.total);
    var b = badges.get(el);
    if (b && b.isConnected && (b.getAttribute("data-paisa") === "primary") === primary) {
      if (b.textContent !== text) b.textContent = text;
      b.__usd = usd;
      return;
    }
    if (b) b.remove();
    b = document.createElement("span");
    b.setAttribute("data-paisa", primary ? "primary" : "inline");
    b.className = primary ? "paisa-badge" : "paisa-inline";
    b.textContent = text;
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
    if (getComputedStyle(el).display.indexOf("inline") === 0) el.insertAdjacentElement("afterend", b);
    else el.appendChild(b);
    badges.set(el, b);
  }

  var record = safe(function (p) {
    var fx = fxRate();
    if (!fx) return;
    chrome.storage.local.get({ history: [] }, function (d) {
      var h = d.history || [];
      var last = null;
      for (var i = h.length - 1; i >= 0; i--) {
        if (h[i].src === "page" && h[i].label === p.label) {
          last = h[i];
          break;
        }
      }
      var now = Date.now();
      if (last && Math.abs(last.usd - p.usd) < 0.005 && now - last.t < RECORD_EVERY_MS) {
        if (now - (last.seenAt || last.t) > 60000) {
          last.seenAt = now;
          chrome.storage.local.set({ history: h });
        }
        return;
      }
      h.push({ t: now, seenAt: now, usd: p.usd, fx: fx.rate, label: p.label, src: "page" });
      chrome.storage.local.set({ history: h.slice(-HISTORY_MAX) });
    });
  });

  var run = safe(function () {
    if (!document.body || !state.fx && !(state.settings.manualFx > 0)) return;
    var found = findAmounts();
    var primary = pickPrimary(found);
    var live = new Set(found.map(function (f) { return f.el; }));
    badges.forEach(function (b, el) {
      if (!live.has(el) || !el.isConnected) {
        b.remove();
        badges.delete(el);
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

  try {
    start();
  } catch (e) {
    /* fail silently */
  }
})();
