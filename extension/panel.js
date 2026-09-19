// The "₹ Bill" button and slide-in panel injected into every AWS console page,
// including the console home. Sign in with an email code, then see the whole bill
// in rupees: what you owe so far, the expected month-end bill with GST, the
// breakdown and the top services. Lives in a shadow root so the console's own
// styles can't touch it.
(function () {
  "use strict";
  var C = globalThis.PaisaConvert;
  if (!C || window.__paisaPanel || window !== window.top) return;
  window.__paisaPanel = true;

  // Tokens follow the AWS console's own (Cloudscape) palette so the panel reads
  // as part of the page rather than a bolt-on, in both its light and dark themes.
  var CSS = [
    ":host{all:initial;--bg:#ffffff;--raised:#fbfbfb;--line:#c6c6cd;--line-soft:#e9ebed;",
    "--fg:#0f141a;--muted:#424650;--faint:#656871;--accent:#006ce0;--accent-hover:#004b9a;",
    "--on-accent:#ffffff;--warn-fg:#8d6605;--warn-bg:#fffce9;--warn-line:#f0d17a;",
    "--err-fg:#d91515;--err-bg:#fff7f7;--err-line:#f5c4c4;--ok-fg:#00711f;--ok-bg:#f2fcf3;--ok-line:#9fe6a8;",
    "--shadow:0 4px 20px rgba(15,20,26,.18);--other:#8c8c94;",
    "--font:'Amazon Ember','Helvetica Neue',Roboto,Arial,sans-serif;font-family:var(--font)}",
    ':host([data-theme="dark"]){--bg:#161d26;--raised:#1b2530;--line:#424650;--line-soft:#232f3e;',
    "--fg:#d1d5db;--muted:#a4b0c0;--faint:#8c8c94;--accent:#42b4ff;--accent-hover:#89bdee;",
    "--on-accent:#000716;--warn-fg:#f2cd54;--warn-bg:#382a0d;--warn-line:#8d6605;",
    "--err-fg:#ff7a7a;--err-bg:#3b1a1a;--err-line:#8d2020;--ok-fg:#6bdb92;--ok-bg:#12261a;--ok-line:#1f6b33;",
    "--shadow:0 4px 20px rgba(0,7,22,.5);--other:#5f6b7a}",
    "*{box-sizing:border-box}",

    ".fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;",
    "height:40px;padding:0 16px 0 6px;border:1px solid var(--accent);border-radius:20px;background:var(--accent);",
    "color:var(--on-accent);font-family:var(--font);font-weight:700;font-size:14px;line-height:1;cursor:pointer;box-shadow:var(--shadow)}",
    ".fab:hover{background:var(--accent-hover);border-color:var(--accent-hover)}",
    ".fab .logo{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;",
    "border-radius:50%;background:var(--on-accent);color:var(--accent);font-size:15px;font-weight:700}",
    ".fab .amt{font-variant-numeric:tabular-nums;letter-spacing:.01em}",

    ".drawer{position:fixed;top:0;right:0;z-index:2147483001;display:flex;flex-direction:column;",
    "width:min(400px,100vw);height:100vh;background:var(--bg);color:var(--fg);border-left:1px solid var(--line);",
    "font-family:var(--font);font-weight:400;font-size:14px;line-height:1.45;box-shadow:var(--shadow);transform:translateX(105%);transition:transform .18s ease}",
    ".drawer.open{transform:none}",
    "@media (prefers-reduced-motion:reduce){.drawer{transition:none}}",

    "header{display:flex;align-items:center;gap:8px;padding:14px 20px;border-bottom:1px solid var(--line-soft)}",
    "header .logo{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;",
    "border-radius:4px;background:var(--accent);color:var(--on-accent);font-weight:700}",
    "header h1{flex:1;margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}",
    ".chip{padding:2px 8px;border:1px solid var(--warn-line);border-radius:4px;background:var(--warn-bg);",
    "color:var(--warn-fg);font-size:12px;font-weight:700}",
    ".x{width:30px;height:30px;border:0;border-radius:4px;background:none;color:var(--muted);font-size:20px;line-height:1;cursor:pointer}",
    ".x:hover{background:var(--raised);color:var(--fg)}",

    ".body{flex:1;overflow:auto;padding:20px}",
    ".card{margin-bottom:16px;padding:16px 20px;border:1px solid var(--line-soft);border-radius:8px;background:var(--raised)}",
    ".eyebrow{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.02em}",
    ".big{margin:6px 0 2px;font-size:36px;font-weight:700;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}",
    ".mid{margin:6px 0 2px;font-size:26px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums}",
    ".sub{color:var(--muted);font-size:13px}",
    ".note{color:var(--faint);font-size:12px;line-height:1.5}",

    "table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}",
    "td{padding:8px 0;border-top:1px solid var(--line-soft)}",
    "tr:first-child td{border-top:0}",
    "td:last-child{text-align:right}",
    "tr.total td{font-weight:700}",

    ".svc{margin-top:14px}",
    ".svc:first-of-type{margin-top:0}",
    ".svc .row{display:flex;justify-content:space-between;gap:10px}",
    ".svc .row span:last-child{font-variant-numeric:tabular-nums}",
    ".svc small{margin-left:6px;color:var(--muted)}",
    ".bar{height:6px;margin-top:6px;border-radius:2px;background:var(--line-soft);overflow:hidden}",
    ".bar i{display:block;height:100%;border-radius:2px;background:var(--accent)}",
    ".bar i.other{background:var(--other)}",

    ".actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}",
    "button.btn{height:32px;padding:0 20px;border:1px solid var(--accent);border-radius:20px;background:transparent;",
    "color:var(--accent);font-family:var(--font);font-weight:700;font-size:14px;line-height:1;cursor:pointer}",
    "button.btn:hover:not(:disabled){background:var(--raised)}",
    "button.primary{background:var(--accent);color:var(--on-accent)}",
    "button.primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover)}",
    "button:disabled{opacity:.45;cursor:not-allowed}",
    "button.link{padding:0;border:0;background:none;color:var(--accent);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer}",

    "label{display:block;margin-bottom:6px;color:var(--muted);font-size:13px}",
    "input{width:100%;height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;",
    "background:var(--bg);color:var(--fg);font:inherit;font-size:14px}",
    "input.code{letter-spacing:.4em;text-align:center;font-size:20px;font-variant-numeric:tabular-nums}",
    "input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",

    ".msg{margin-top:12px;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5}",
    ".msg.err{border:1px solid var(--err-line);background:var(--err-bg);color:var(--err-fg)}",
    ".msg.ok{border:1px solid var(--ok-line);background:var(--ok-bg);color:var(--ok-fg)}",
    ".msg.info{border:1px solid var(--line-soft);background:var(--raised);color:var(--muted)}",
    ".banner{margin-bottom:16px;padding:10px 12px;border:1px solid var(--warn-line);border-radius:8px;",
    "background:var(--warn-bg);color:var(--warn-fg);font-size:13px;font-weight:700}",
    ".foot{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:16px;color:var(--faint);font-size:12px}",
    "h2{margin:0 0 8px;font-size:18px;font-weight:700}",
    "p{margin:0 0 12px}",
    ".spin{color:var(--muted)}",
  ].join("\n");

  var state = { open: false, view: "loading", session: null, summary: null, sample: false, email: "", error: "", notice: "", noticeKind: "info", busy: false, last: null };
  var host, root, fabAmt, drawer, body, headChip;

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") e.className = v;
        else if (k === "style") e.style.cssText = v; // CSSOM, so a strict page CSP can't block it
        else if (k === "text") e.textContent = v;
        else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? "" : v);
      }
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function api(method, path, body) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: "api", method: method, path: path, body: body }, function (res) {
          if (chrome.runtime.lastError || !res) resolve({ ok: false, status: 0, error: "Couldn't reach the Paisa extension. Reload this page." });
          else resolve(res);
        });
      } catch (e) {
        resolve({ ok: false, status: 0, error: "The Paisa extension was updated. Reload this page." });
      }
    });
  }

  function monthName(ym) {
    var p = ym.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(p[0], p[1] - 1, 1)));
  }
  function nextMonthName(ym) {
    var p = ym.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(p[0], p[1], 1)));
  }
  function dayLabel(iso) {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
  }

  // ---- sample data (clearly labelled) -------------------------------------
  function sampleSummary() {
    var s = { entity: "AWS_INC", markup_pct: 0.035, gst_pct: 0.18 };
    var fx = 85;
    var r = C.convert({ usd: 47.3, fx: fx, entity: s.entity, markupPct: s.markup_pct, gstPct: s.gst_pct, daysElapsed: 18, daysInMonth: 30 });
    var per = r.total / 47.3;
    var svc = [["Amazon EC2", 18.62], ["Amazon RDS", 11.4], ["Amazon S3", 6.85], ["Amazon CloudFront", 4.1], ["AWS Lambda", 2.95]];
    return {
      month: "2026-09", asOf: "2026-09-18", usd: 47.3, daysElapsed: 18, daysInMonth: 30,
      fx: { rate: fx, fetchedAt: "2026-09-18T00:30:00+00:00", source: "sample" },
      settings: s, breakdown: { base: r.base, markup: r.markup, gst: r.gst, total: r.total }, projection: r.projection,
      services: svc.map(function (x) { return { name: x[0], usd: x[1], inr: x[1] * per }; }),
      otherUsd: 3.38, otherInr: 3.38 * per,
      providerNote: "Illustrative figures, not read from any AWS account.",
    };
  }

  // ---- views ----------------------------------------------------------------
  function msg(kind, text) {
    return text ? h("div", { class: "msg " + kind, role: kind === "err" ? "alert" : "status", text: text }) : null;
  }

  function viewLoading() {
    return [h("p", { class: "spin", text: "Loading your bill…" })];
  }

  function viewSetup() {
    return [
      h("h2", { text: "Not connected yet" }),
      h("p", { class: "sub", text: "This build of Paisa isn't linked to a server, so it can't read your account. You can still preview how your bill will look." }),
      h("button", { class: "btn primary", onclick: showSample, text: "See a sample bill" }),
    ];
  }

  function viewSignin() {
    var input = h("input", { id: "email", type: "email", placeholder: "you@example.com", autocomplete: "email", value: state.email });
    var send = function () {
      var email = input.value.trim();
      if (!email) return;
      state.email = email;
      run(function () {
        return api("POST", "/auth/start", { email: email }).then(function (r) {
          if (!r.ok) return fail(r);
          state.view = r.data.status === "code_sent" ? "code" : "confirm";
          state.error = "";
        });
      });
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
    return [
      h("h2", { text: "See your AWS bill in rupees" }),
      h("p", { class: "sub", text: "Sign in with your email. We send a 6-digit code, so there's no password and no AWS keys." }),
      h("label", { for: "email", text: "Email" }),
      input,
      msg("err", state.error) || msg(state.noticeKind, state.notice),
      h("div", { class: "actions" }, [
        h("button", { class: "btn primary", disabled: state.busy, onclick: send, text: state.busy ? "Sending…" : "Send me a code" }),
        h("button", { class: "btn", onclick: showSample, text: "See a sample" }),
      ]),
    ];
  }

  function viewConfirm() {
    return [
      h("h2", { text: "Confirm your email" }),
      h("p", { class: "sub", text: "AWS sent a message to " + state.email + " with a 'Confirm subscription' link. Click it (check spam), then come back here." }),
      msg("err", state.error),
      h("div", { class: "actions" }, [
        h("button", {
          class: "btn primary", disabled: state.busy, text: state.busy ? "Checking…" : "I've confirmed, send my code",
          onclick: function () {
            run(function () {
              return api("POST", "/auth/start", { email: state.email }).then(function (r) {
                if (!r.ok) return fail(r);
                if (r.data.status === "code_sent") { state.view = "code"; state.error = ""; }
                else state.error = "Not confirmed yet. Click the link in the AWS email, then try again.";
              });
            });
          },
        }),
        h("button", { class: "btn", onclick: function () { state.view = "signin"; state.error = ""; render(); }, text: "Back" }),
      ]),
    ];
  }

  function viewCode() {
    var input = h("input", { id: "code", class: "code", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code", placeholder: "000000" });
    var verify = function () {
      var code = input.value.trim();
      if (code.length !== 6) return;
      run(function () {
        return api("POST", "/auth/verify", { email: state.email, code: code }).then(function (r) {
          if (!r.ok) return fail(r);
          state.session = { email: r.data.email };
          state.error = "";
          state.notice = "";
          return loadBill(false);
        });
      });
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") verify(); });
    return [
      h("h2", { text: "Enter your code" }),
      h("p", { class: "sub", text: "We emailed a 6-digit code to " + state.email + ". It expires in 10 minutes." }),
      input,
      msg("err", state.error),
      h("div", { class: "actions" }, [
        h("button", { class: "btn primary", disabled: state.busy, onclick: verify, text: state.busy ? "Checking…" : "Sign in" }),
        h("button", { class: "btn", onclick: function () { state.view = "signin"; state.error = ""; render(); }, text: "Back" }),
      ]),
    ];
  }

  function viewConnect() {
    return [
      h("h2", { text: "Connect your AWS account" }),
      h("p", { class: "sub", text: "You're signed in as " + (state.session ? state.session.email : "") + ", but Paisa can't read your costs yet. Create the read-only role once (about a minute) using the Paisa dashboard." }),
      msg("info", state.error),
      h("div", { class: "actions" }, [
        h("button", { class: "btn", onclick: function () { signOut(); }, text: "Sign out" }),
      ]),
    ];
  }

  function viewError() {
    return [
      h("h2", { text: "Couldn't load your bill" }),
      h("p", { class: "sub", text: state.error || "Something went wrong." }),
      h("div", { class: "actions" }, [
        h("button", { class: "btn primary", onclick: function () { loadBill(false); }, text: "Try again" }),
        state.session ? h("button", { class: "btn", onclick: signOut, text: "Sign out" }) : null,
      ]),
    ];
  }

  function viewBill() {
    var s = state.summary;
    var b = s.breakdown;
    var st = s.settings;
    var inc = st.entity === "AWS_INC";
    var max = Math.max.apply(null, s.services.map(function (x) { return x.usd; }).concat([s.otherUsd, 0.0001]));
    var rows = s.services.map(function (x) { return { name: x.name, usd: x.usd, inr: x.inr, other: false }; });
    if (s.otherUsd > 0.005) rows.push({ name: "Everything else", usd: s.otherUsd, inr: s.otherInr, other: true });

    var out = [];
    if (state.sample) out.push(h("div", { class: "banner", text: "Sample data, not your account." }));
    out.push(
      h("div", { class: "card" }, [
        h("div", { class: "eyebrow", text: "So far · " + monthName(s.month) }),
        h("div", { class: "big", text: C.inr(b.total, 0) }),
        h("div", { class: "sub", text: C.usd(s.usd) + " on the AWS console · as of " + dayLabel(s.asOf) + " · day " + s.daysElapsed + " of " + s.daysInMonth }),
        s.usd === 0 ? h("p", { class: "note", style: "margin-top:8px", text: "No charges so far this month. This is gross usage before credits, so a free-plan account can show ₹0." }) : null,
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "eyebrow", text: "Expected bill this month" }),
        h("div", { class: "mid", text: C.inr(s.projection, 0) }),
        h("div", { class: "sub", text: "Includes " + C.pct(st.gst_pct, 0) + " GST" + (inc ? " and " + C.pct(st.markup_pct, 1) + " card markup" : "") + ". AWS issues it in early " + nextMonthName(s.month) + "." }),
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "eyebrow", text: "Where it comes from" }),
        h("table", null, [
          h("tbody", null, [
            h("tr", null, [h("td", { text: C.usd(s.usd) + " × " + C.inr(s.fx.rate, 2) }), h("td", { text: C.inr(b.base, 2) })]),
            h("tr", null, [h("td", { text: inc ? "Card forex markup " + C.pct(st.markup_pct) : "Card markup (AISPL: none)" }), h("td", { text: C.inr(b.markup, 2) })]),
            h("tr", null, [h("td", { text: "GST " + C.pct(st.gst_pct) }), h("td", { text: C.inr(b.gst, 2) })]),
            h("tr", { class: "total" }, [h("td", { text: "Total so far (estimate)" }), h("td", { text: C.inr(b.total, 2) })]),
          ]),
        ]),
      ]),
    );
    if (rows.length) {
      out.push(
        h("div", { class: "card" }, [h("div", { class: "eyebrow", style: "margin-bottom:10px", text: "Top services" })].concat(
          rows.map(function (x) {
            return h("div", { class: "svc" }, [
              h("div", { class: "row" }, [h("span", { text: x.name }), h("span", null, [C.inr(x.inr, 0), h("small", { text: C.usd(x.usd) })])]),
              h("div", { class: "bar" }, [h("i", { class: x.other ? "other" : "", style: "width:" + (x.usd / max) * 100 + "%" })]),
            ]);
          }),
        )),
      );
    }
    if (!state.sample) {
      out.push(
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", disabled: state.busy, onclick: emailSummary, text: state.busy ? "Working…" : "Email me this summary" }),
          h("button", { class: "btn", disabled: state.busy, onclick: function () { loadBill(true); }, text: "Refresh" }),
        ]),
        msg(state.noticeKind, state.notice),
      );
    } else {
      out.push(h("div", { class: "actions" }, [h("button", { class: "btn primary", onclick: function () { state.sample = false; state.summary = null; init(); }, text: state.session ? "Show my bill" : "Sign in for my real bill" })]));
    }
    var foot = [h("span", { text: "Rate " + C.inr(s.fx.rate, 2) + "/USD · " + (s.fx.source || "public source") })];
    if (state.session && !state.sample) {
      foot.push(h("span", { text: state.session.email }), h("button", { class: "link", onclick: signOut, text: "Sign out" }));
    }
    if (globalThis.PaisaScan) foot.push(h("button", { class: "link", onclick: copyReport, text: "Copy page report" }));
    out.push(h("div", { class: "foot" }, foot));
    if (s.providerNote) out.push(h("p", { class: "note", style: "margin-top:10px", text: s.providerNote }));
    out.push(h("p", { class: "note", style: "margin-top:6px", text: "Estimates only. Your bank's rate on the settlement date and your AWS entity decide the real figure." }));
    return out;
  }

  // ---- actions --------------------------------------------------------------
  function fail(r) {
    if (r.status === 0 && r.error === "notconfigured") { state.view = "setup"; return; }
    state.error = r.error || "Something went wrong.";
  }

  function run(fn) {
    state.busy = true;
    state.error = "";
    render();
    return Promise.resolve(fn()).then(function () {
      state.busy = false;
      render();
    });
  }

  function loadBill(force) {
    state.busy = true;
    if (!state.summary) state.view = "loading";
    state.notice = "";
    render();
    return api("GET", "/spend" + (force ? "?refresh=1" : ""), null).then(function (r) {
      state.busy = false;
      if (r.ok) {
        state.summary = r.data;
        state.view = "bill";
        var last = { total: r.data.breakdown.total, at: Date.now() };
        state.last = last;
        try { chrome.storage.local.set({ lastBill: last }); } catch (e) { /* ignore */ }
      } else if (r.status === 401) {
        state.session = null;
        state.summary = null;
        state.view = "signin";
        state.error = "Your session expired. Sign in again.";
      } else if (r.status === 409) {
        state.view = "connect";
        state.error = r.error;
      } else if (r.error === "notconfigured") {
        state.view = "setup";
      } else {
        state.view = "error";
        state.error = r.error;
      }
      render();
    });
  }

  function emailSummary() {
    state.busy = true;
    state.notice = "";
    render();
    api("POST", "/email-summary", null).then(function (r) {
      state.busy = false;
      state.noticeKind = r.ok ? "ok" : "err";
      state.notice = r.ok ? "Sent to " + r.data.sentTo + ". Check your inbox (and spam)." : r.error;
      render();
    });
  }

  function signOut() {
    api("POST", "/auth/signout", null).then(function () {
      state.session = null;
      state.summary = null;
      state.view = "signin";
      state.notice = "Signed out.";
      state.noticeKind = "info";
      render();
    });
  }

  function showSample() {
    state.sample = true;
    state.summary = sampleSummary();
    state.view = "bill";
    render();
  }

  function copyReport() {
    var text = JSON.stringify(globalThis.PaisaScan.report(), null, 2);
    var done = function () { state.notice = "Report copied."; state.noticeKind = "ok"; render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  }

  function init() {
    state.view = "loading";
    render();
    // Say so straight away if this build isn't linked to a server, rather than
    // showing a sign-in form that can't work.
    chrome.runtime.sendMessage({ type: "config" }, function (cfg) {
      if (!chrome.runtime.lastError && cfg && !cfg.configured) {
        state.view = "setup";
        render();
        return;
      }
      chrome.storage.local.get({ session: null }, function (d) {
        state.session = d.session;
        if (state.session) loadBill(false);
        else {
          state.view = "signin";
          render();
        }
      });
    });
  }

  // ---- shell ----------------------------------------------------------------
  function render() {
    if (!drawer) return;
    drawer.classList.toggle("open", state.open);
    drawer.setAttribute("aria-hidden", state.open ? "false" : "true");
    fabAmt.textContent = state.summary && !state.sample ? "≈ " + C.inr(state.summary.breakdown.total, 0) : state.last && state.session ? "≈ " + C.inr(state.last.total, 0) : "Bill";
    headChip.textContent = state.sample ? "Sample data" : "Estimate";
    if (!state.open) return;
    var views = { loading: viewLoading, setup: viewSetup, signin: viewSignin, confirm: viewConfirm, code: viewCode, connect: viewConnect, error: viewError, bill: function () { return state.summary ? viewBill() : viewLoading(); } };
    var focusId = root.activeElement && root.activeElement.id;
    var typed = focusId ? root.activeElement.value : null;
    body.textContent = "";
    (views[state.view] || viewLoading)().forEach(function (n) { if (n) body.appendChild(n); });
    if (focusId) {
      var again = root.getElementById(focusId);
      if (again) {
        if (typed !== null && again.value !== typed) again.value = typed;
        again.focus();
      }
    }
  }

  function toggle(open) {
    state.open = open === undefined ? !state.open : open;
    if (state.open && (state.view === "loading" || state.view === "signin") && !state.summary) init();
    render();
  }

  function build() {
    host = h("div", { "data-paisa": "panel-root" });
    root = host.attachShadow({ mode: "open" });
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      root.appendChild(h("style", { text: CSS }));
    }
    fabAmt = h("span", { class: "amt", text: "Bill" });
    var fab = h("button", { class: "fab", "aria-label": "Open Paisa: your AWS bill in rupees", onclick: function () { toggle(); } }, [h("span", { class: "logo", text: "₹" }), fabAmt]);
    headChip = h("span", { class: "chip", text: "Estimate" });
    body = h("div", { class: "body" });
    drawer = h("aside", { class: "drawer", role: "dialog", "aria-label": "Paisa: your AWS bill in rupees", "aria-hidden": "true" }, [
      h("header", null, [h("span", { class: "logo", text: "₹" }), h("h1", { text: "Paisa" }), headChip, h("button", { class: "x", "aria-label": "Close", onclick: function () { toggle(false); }, text: "×" })]),
      body,
    ]);
    // Keep the console's keyboard shortcuts from firing while typing here.
    ["keydown", "keyup", "keypress"].forEach(function (t) {
      drawer.addEventListener(t, function (e) {
        if (t === "keydown" && e.key === "Escape") toggle(false);
        else e.stopPropagation();
      });
    });
    root.appendChild(fab);
    root.appendChild(drawer);
    document.documentElement.appendChild(host);
  }

  // ---- fitting into the console --------------------------------------------
  // Match the console's theme rather than imposing our own. Cloudscape marks
  // dark mode with a class, but the name has changed across console versions,
  // so fall back to judging the page's own background luminance, then to the
  // OS preference.
  function detectTheme() {
    try {
      if (document.querySelector(".awsui-dark-mode, .awsui-polaris-dark-mode")) return "dark";
      var el = document.body || document.documentElement;
      if (el && el.getAttribute("data-awsui-theme") === "dark") return "dark";
      var bg = el ? getComputedStyle(el).backgroundColor : "";
      var m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(bg || "");
      var opaque = m && (m[4] === undefined || parseFloat(m[4]) > 0.1);
      if (opaque) {
        var lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
        return lum < 0.5 ? "dark" : "light";
      }
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  }

  function applyTheme() {
    if (!host) return;
    var t = detectTheme();
    if (host.getAttribute("data-theme") !== t) host.setAttribute("data-theme", t);
  }

  // The console re-renders large parts of the DOM as you navigate. If it takes
  // our host with it, put it back rather than disappearing silently.
  function keepAttached() {
    if (host && !host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  }

  function watchConsole() {
    var timer = null;
    var onMutation = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        keepAttached();
        applyTheme();
      }, 80);
    };
    var opts = { childList: true, attributes: true, attributeFilter: ["class", "data-awsui-theme", "data-theme"] };
    new MutationObserver(onMutation).observe(document.documentElement, opts);
    if (document.body) new MutationObserver(onMutation).observe(document.body, { attributes: true, attributeFilter: ["class", "data-awsui-theme"] });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", applyTheme);
    }
    setInterval(keepAttached, 5000); // last resort if a mutation is missed
  }

  function boot() {
    try {
      build();
      applyTheme();
      watchConsole();
      chrome.storage.local.get({ session: null, lastBill: null }, function (d) {
        state.session = d.session;
        state.last = d.lastBill;
        render();
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === "local" && changes.session && !changes.session.newValue && state.session) {
          state.session = null;
          state.summary = null;
          state.view = "signin";
          render();
        }
      });
    } catch (e) {
      /* never break the console */
    }
  }

  if (document.documentElement) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
