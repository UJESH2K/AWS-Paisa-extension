// Service worker. Two jobs:
//  1. fetch and cache the USD->INR rate from public FX endpoints;
//  2. relay the panel's calls to the Paisa API and keep the session token.
// The token is Paisa's own per-user session token. No AWS credentials ever
// pass through, or are stored in, the extension.
"use strict";

importScripts("config.js");

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

var API_PATHS = /^\/(auth\/(start|verify|signout)|me|spend|settings|connect|email-summary)(\?refresh=1)?$/;

async function callApi(method, path, body) {
  var base = ((self.PAISA_CONFIG && self.PAISA_CONFIG.apiUrl) || "").replace(/\/$/, "");
  if (!base) return { ok: false, status: 0, error: "notconfigured" };
  if (!API_PATHS.test(path)) return { ok: false, status: 0, error: "Blocked request." };
  var stored = await chrome.storage.local.get({ session: null });
  var headers = { "Content-Type": "application/json" };
  if (stored.session && stored.session.token) headers.Authorization = "Bearer " + stored.session.token;
  var res;
  try {
    res = await fetch(base + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    return { ok: false, status: 0, error: "Couldn't reach the Paisa server. Check your connection and try again." };
  }
  var data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* non-JSON body */
  }
  if (res.ok) {
    if (path === "/auth/verify" && data && data.token) {
      await chrome.storage.local.set({ session: { token: data.token, email: data.email } });
      return { ok: true, status: res.status, data: { email: data.email } }; // the panel never needs the token
    }
    if (path === "/auth/signout") await chrome.storage.local.remove(["session", "lastBill"]);
    return { ok: true, status: res.status, data: data };
  }
  if (res.status === 401 && path !== "/auth/verify") await chrome.storage.local.remove(["session", "lastBill"]);
  return { ok: false, status: res.status, error: (data && data.error) || "Request failed (" + res.status + ")." };
}

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg && msg.type === "getFx") {
    getFx(!!msg.force).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === "config") {
    var cfg = self.PAISA_CONFIG || {};
    sendResponse({
      configured: !!(cfg.apiUrl || ""),
      region: cfg.region || "ap-south-1",
      roleTemplateUrl: cfg.roleTemplateUrl || "",
    });
    return false;
  }
  if (msg && msg.type === "api") {
    callApi(msg.method, msg.path, msg.body).then(sendResponse);
    return true;
  }
  return false;
});
