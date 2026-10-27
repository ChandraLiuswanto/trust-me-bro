---
name: web-scraping-blocked
description: Use when a real browser loads a site but the script gets a 403, a challenge page, or a captcha — and you have already confirmed the target is Tier 4+ on the difficulty ladder. Also use when you need to know which fingerprint layer (TLS, HTTP/2, JavaScript, behavioural) is actually refusing the request before changing anything.
---

# Web Scraping — When You Are Blocked

Distilled from Asad Ikram's guide (https://asadfix.github.io/scraping-guide/, 2026). Vendor and tool specifics age fast; the isolation procedure is durable.

## Core idea

**Block ≠ block.** A "bot detection" can be a TLS rejection, an HTTP/2 rejection, an IP-reputation rejection, a behaviour rejection, or a vendor check — and the same site can run all five at once. The cheapest wins come from the cheapest checks first. Vendor mechanics and proxy taxonomies live in `vendors.md` and `proxies.md` (this skill); the order in which to consult them is below.

## 0. Confirm you are actually at the right tier

Before doing anything else, place the target on the difficulty ladder. Tier 1 jobs don't need this skill at all; Tier 5 jobs need everything.

| Tier | Tell | Effort |
|---|---|---|
| 1 — Open | Data is in `view-source`. | Afternoon. |
| 2 — Light | Works at first; 429s under load. | Day or two. Honest headers, real rate control, not heavy machinery. |
| 3 — Dynamic | Empty in `view-source`, full in browser. | Real browser, or the API behind the page (preferred). |
| 4 — Fingerprinting | Blocked instantly; site loads fine in your own browser. | Engine-level stealth. Rotating proxies don't help — the block is about *who you look like*. |
| 5 — Behavioural | Passes once, flagged the moment you scale. | The hard rung. Looking human over the whole session beats being fast. |

The classic failure is quoting an afternoon for what is really a month because nobody checked which wall was there. Check the wall first.

> Only ~18.5% of the 24,898 most-visited sites carry no technical barrier at all, but 88% of landing pages sit in the two lowest tiers. The presence of a barrier tells you almost nothing about the effort required. **Probe the endpoint you actually need** — the landing page frequently isn't it.

## 1. The first thing to do: the same-IP browser-vs-script test

This is the diagnostic that saves the week. Before changing anything, compare a *real browser session* and your *scripted request* on the same network, with the same URL, the same headers if possible, and the same exit IP.

- **Script returns 403; real browser returns 200.** A fingerprint layer is refusing you. Walk §2 below.
- **Script and browser both return 403 from this network.** The IP is bad. Move to `proxies.md` — pick a different exit type (residential, mobile) and rerun the comparison.
- **Script and browser both return 200.** You weren't actually blocked; the page was Tier 3, not Tier 4. Load `web-scraping-data-sources` and look for the XHR endpoint.

> **Why this works.** It changes exactly one variable at a time. If the same script body, the same headers, and the same URL change outcome by changing only the transport, the transport is the variable. Hours spent tuning headers with a `requests` library, on a target that drops the TLS handshake at the load balancer, prove something that was already true.

## 2. The four questions a defender asks

A modern anti-bot stack scores you across four layers before a single byte of your JavaScript runs. Most blocks are decided here, not in the JS challenge. Hold these in mind when you read a 403 — it usually means one of the four is failing, not the page.

1. **What does the client claim to be?** User-Agent, declared identity, Client Hints (`sec-ch-*`).
2. **How does it connect?** TLS (JA3/JA4 from the ClientHello), HTTP/2 settings, ALPN, header order, pseudo-header order.
3. **Where does it connect from?** Address type (datacenter, residential, mobile), IP reputation, geo, ASN.
4. **How does it behave?** Pacing, scroll pattern, mouse movement, request rate, sequence of pages.

A former CDN detection engineer summarises it as: *who, how, where, and how they act*. The first three resolve before the page loads; the fourth is what gets measured while you read. If the stack's checks "agree" on the same answer, the connection survives; if they disagree (e.g. headers say Chrome 140, TLS says Python's OpenSSL, IP says datacenter), the connection dies before your first `document.querySelector`. So a flawless in-page fingerprint cannot save a client whose network-layer story doesn't match.

> The JavaScript layer is the last thing a server learns about you, not the first. A scraper that only manages its in-page fingerprint has already lost the connection it never knew it was being judged on.

## 3. The escalation ladder (walk in order)

### Step 1 — Sweep the impersonation profile

Before you reach for a browser, change one variable at a time in the same library. The cheap win that almost nobody does:

- `curl_cffi` ships many profiles. A 2026 production run reported that against one Cloudflare deployment, the generic `chrome` profile returned almost no usable responses, while `firefox` reached ~80%. Behind DataDome, `chrome120` returned 0/6 usable, while `firefox144` returned ~7/10. **Same library, same everything else, different profile.**
- Treat those as a dated snapshot of two specific deployments, not a rule about Firefox. The procedural lesson is what matters: a protection provider rejects a *connection pattern*, not a library, and the pattern that fails today is not the only pattern the library can produce.
- **Keep the profile that worked in your target notes.** The next engineer on that domain will otherwise repeat the whole sweep.

### Step 2 — Fix the transport (TLS + HTTP/2 + header order)

If profile sweeping doesn't help, the next thing to try is a transport change, not a header change. The load balancers inspect the TLS handshake before anything reads an HTTP header, so `requests` and `httpx` are dropped on their fingerprints regardless of how carefully the headers were assembled.

- Switch to `curl_cffi` with `impersonate="chrome"` (or the profile that survived Step 1).
- For HTTP/3 / QUIC targets, use a client that speaks it with a browser-shaped fingerprint; `curl_cffi` now does QUIC impersonation with UDP proxying. This covers ~80% of targets without a 200 MB headless Chromium.
- Header **values** are only half the story. Header **order** is a fingerprint, sharpest on HTTP/2 where casing is normalised and pseudo-header order carries the weight. Chrome emits `:method :authority :scheme :path`; most libraries emit `:method :path :scheme :authority`. The reliable fix is a client that owns the whole emission path (`curl_cffi`, `wreck`, or a real browser). Setting headers in a dict doesn't help when urllib3 reorders them underneath you.

### Step 3 — Browser as a different identity

When the data is gated by client-side rendering, or the in-page fingerprint surface is itself the wall, escalate to a real browser. But treat it as a different identity, not a stronger one:

- **Headless is a tell.** Playwright's bundled headless Chromium reports `SwiftShader` (software WebGL), a headless artefact of the binary. Point every Chrome-based tool at the real installed Chrome via `channel="chrome"`.
- **Headful beats headless on most pages.** A October 2026 hands-on review: vanilla Playwright failed all five vendor-protected sites headless, but **headful** it loaded the Cloudflare, Akamai, DataDome, and PerimeterX sites and only failed on Kasada. The gap was the headless tell, not the engine. A stealth tool that "passes five-for-five" is only beating plain automation by the one Kasada page where the control fails.
- **Patch the engine, not the script.** Playwright-Stealth is no longer enough. Use a C++-level browser: Camoufox (Firefox 146 base as of July 2026), CloakBrowser (49 patches, C++), Patchright (Chromium fork), or `invisible_playwright` (Firefox 151 build, derives every fingerprint from a reproducible seed). Re-test vendor pass-rates on your target before believing any of them.
- **Drive a real browser, not its automation protocol.** Every parameter read through CDP can be silently corrupted by the transport's unwrap logic (truthiness checks drop `false`, `0`, `""` — exactly the values bot detectors traffic in). Wrap probes in `JSON.stringify(...)` on the page, `JSON.parse` the returned string, and treat a non-string result as an unusable signal.

### Step 4 — Match the IP to the identity

Only after Steps 1–3 fail should you reach for proxies. If the stack's claims and behaviour pass but the IP doesn't, see `proxies.md` for the type that matches the identity you claim.

### Step 5 — Add behaviour

A pass on the first request that fails the moment you scale is a behaviour block. Looking human over the whole session beats being fast. The most useful things to fix:

- Don't navigate directly to a deep URL — load the homepage first, let the session collect `_abck` / `bm_sz` / `cf_clearance`, then navigate. The cookie makes the next request legible.
- Vary pacing with realistic jitter; the cadence matters more than the magnitude.
- Move the mouse, scroll, open a related item before the data URL. Mouse-movement synthesis without a target is itself a tell; hook into real input events on a real viewport.
- Many short sessions beat one long session. A lost connection mid-session is one of the real rough edges of remote browsers; opening, doing one page, and closing is more robust than one browser that runs 50 pages.
- The connection is yours to close — idle browsers bill until a timeout fires, so set the timeout and monitor it.

## 4. When to stop and re-think

- **Same headers succeed once the transport changes.** The headers were never the variable. Stop tuning them.
- **Same library, same everything, different profile → different outcome.** The profile is the variable; don't escalate to a browser yet.
- **Script and browser both blocked from the same network.** IP is the variable; don't tune headers or fingerprint, switch exit type.
- **Different endpoints on the same host require different headers / referers / UA.** Anti-bot is deployed per route by different teams, so a single profile that satisfies both can't exist. Stop looking for a better global profile and start diffing what you sent to each. This is the same reasoning that makes endpoint enumeration beat accepting the hardest one.
- **The page you're stuck on is a 200 with no useful data, not a 403.** You weren't blocked; you were served a JS-rendered page from a non-JS client. Load `web-scraping-data-sources` instead.
- **You have spent more than 2 days/month on maintenance for a single target.** Walk to the parent skill, rung 6, and price a managed API against your own hours. (See `vendors.md` for the cost-per-usable-record framing.)

## 5. Two-trap rule

- **Don't trust the cheat sheet's "best tool" column.** The same column in the source guide, by the author's own caveat, ages in months. Re-test on your target.
- **Don't trust vendor success rates.** Some are self-published, single-run, no methodology disclosed. Run a small probe against your real target before paying.

## 6. Common red flags

- A `User-Agent: python-requests/x.y.z` and TLS handshake that announces the same client — perfect, because the entire JS fingerprint is now redundant. (Replace the library default before you copy a browser string. On 472 popular homepages fetched once with `httpx`, the library default got a full page on 353, a copied Chrome string on 375, and a descriptive bot string with contact details on 378 — so the browser string bought nothing on average while several major domains refused it outright. Treat as a sensible default, not a guarantee.)
- A 200 with a `<noscript>` banner and a long inline challenge script — the curl got HTML, the browser would have got cookies. The fix is the cookie, not a fingerprint.
- A block page naming a vendor different from the one your headers announced — you fixed the wrong layer.
- A 403 only on the second page, never the first — a behaviour layer warmed up on the first page and fired on the second. The first request is often a courtesy; the second is the test.
- A clean run for hours that dies on a specific URL pattern — anti-bot is route-scoped, not domain-scoped. Sweep other routes, especially the data-light ones (search, autocomplete, mobile, embed, sitemap-adjacent JSON, RSS, print view).

## 7. When this is the wrong skill

- You can see the data in `view-source` → load `web-scraping-data-sources` (the data was already there).
- The page is empty until JS runs and you're not blocked → load `web-scraping-data-sources` (it's Tier 3, not Tier 4).
- The scraper is unreliable, returns empty / wrong / poisoned data → load `web-scraping-production` (it's a silent-failure problem, not a block problem).
- The data is buried in unstructured text and you need a schema → load `web-scraping-llm-extraction`.

> See `web-scraping` (parent) for the full decision ladder and the gating/ethics framing.
