// Service worker: fetches and caches the USD->INR rate. No AWS credentials,
// no account data; the only network calls are to public FX endpoints.
"use strict";

var FX_TTL_MS = 6 * 60 * 60 * 1000;
var SOURCES = [
  {
    name: "frankfurter.dev (ECB)",
    url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR",
    parse: function (j) {
      return { rate: j.rates.INR, asOf: j.date };
    },
  },
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: function (j) {
      return { rate: j.rates.INR, asOf: new Date(j.time_last_update_unix * 1000).toISOString() };
    },
  },
];

function getCached() {
  return chrome.storage.local.get({ fx: null }).then(function (d) {
    return d.fx;
  });
}

async function fetchFresh() {
  for (var i = 0; i < SOURCES.length; i++) {
    try {
      var res = await fetch(SOURCES[i].url, { cache: "no-store" });
      if (!res.ok) continue;
      var p = SOURCES[i].parse(await res.json());
      if (typeof p.rate === "number" && p.rate > 0) {
        var fx = { rate: p.rate, asOf: p.asOf, fetchedAt: new Date().toISOString(), source: SOURCES[i].name };
        await chrome.storage.local.set({ fx: fx });
        return fx;
      }
    } catch (e) {
      /* try the next source */
    }
  }
  return null;
}

// Never blocks on the network when a cached rate exists: serves the cache and
// refreshes behind it. `force` is used by the popup's refresh button.
async function getFx(force) {
  var cached = await getCached();
  var fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < FX_TTL_MS;
  if (cached && fresh && !force) return { fx: cached, stale: false };
  var next = await fetchFresh();
  if (next) return { fx: next, stale: false };
  return cached ? { fx: cached, stale: true } : { fx: null, stale: true };
}

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg && msg.type === "getFx") {
    getFx(!!msg.force).then(sendResponse);
    return true; // async response
  }
  return false;
});
