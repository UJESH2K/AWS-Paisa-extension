// Shared by content.js and popup.js (classic script, no bundler).
// Mirrors backend/src/convert.py and web/lib/convert.ts. All outputs are estimates.
(function (root) {
  "use strict";

  var DEFAULT_SETTINGS = {
    entity: "AWS_INC", // "AWS_INC" (USD card charge) | "AISPL" (INR invoice)
    markupPct: 0.035, // card forex markup, fraction
    gstPct: 0.18, // fraction
    showAll: true, // put a small rupee figure next to every $ amount
    manualFx: null, // optional user-entered USD->INR rate overriding the fetched one
  };

  function multiplier(entity, markupPct, gstPct) {
    var m = entity === "AWS_INC" ? 1 + markupPct : 1;
    return m * (1 + gstPct);
  }

  function convert(i) {
    var base = i.usd * i.fx;
    var markup = 0;
    var gst;
    if (i.entity === "AWS_INC") {
      markup = base * i.markupPct;
      gst = (base + markup) * i.gstPct;
    } else {
      gst = base * i.gstPct;
    }
    var total = base + markup + gst;
    var out = { base: base, markup: markup, gst: gst, total: total, projection: null };
    if (i.daysElapsed >= 1 && i.daysInMonth >= i.daysElapsed) {
      out.projection = (total / i.daysElapsed) * i.daysInMonth;
    }
    return out;
  }

  // Splits the change in rupee cost between two readings into "you spent more"
  // and "the exchange rate moved". spend + fx === total exactly.
  function change(prev, now, s) {
    var mult = multiplier(s.entity, s.markupPct, s.gstPct);
    return {
      usd: now.usd - prev.usd,
      spend: (now.usd - prev.usd) * prev.fx * mult,
      fx: now.usd * (now.fx - prev.fx) * mult,
      total: now.usd * now.fx * mult - prev.usd * prev.fx * mult,
    };
  }

  var inrFmt = {};
  function inr(n, digits) {
    digits = digits || 0;
    if (!inrFmt[digits]) {
      inrFmt[digits] = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    return inrFmt[digits].format(n);
  }

  function usd(n) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  }

  function signed(n, fmt) {
    var s = fmt(Math.abs(n));
    return (n > 0.005 ? "+" : n < -0.005 ? "−" : "") + s;
  }

  function pct(f, d) {
    return (f * 100).toFixed(d === undefined ? 2 : d) + "%";
  }

  root.PaisaConvert = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    multiplier: multiplier,
    convert: convert,
    change: change,
    inr: inr,
    usd: usd,
    signed: signed,
    pct: pct,
  };
})(globalThis);
