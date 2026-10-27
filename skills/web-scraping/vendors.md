# Vendor Cheat Sheet

What each major anti-bot vendor does, which fingerprint layers matter, and what to try first. **All of this ages in months** — re-test against your target before relying on any row.

## How to read this

A row's "Steps 1–2 viable?" column answers one question: is there a non-browser-stack path to this vendor's customer? "Yes" means you should walk the parent's decision ladder before touching a browser. "No" means the path is the engine stack itself.

| Vendor | Primary vector | Steps 1–2 viable? | First tool to try | Note |
|---|---|---|---|---|
| **Akamai** | JA4+ at edge + `sensor.js` + 60 extension probes + cross-layer coherence check | Often | `curl_cffi` + CloakBrowser | Find mobile / GraphQL endpoint first. The sensor probes 60 known Chrome extension resources — real users have a few installed. |
| **Cloudflare** | JA4 in Rust at edge + Turnstile | Sometimes | Camoufox | Origin IP via SecurityTrails often bypasses the edge entirely. |
| **DataDome** | 85K-feature ML + WASM `boring_challenge` | Yes | `curl_cffi` + mobile IP | **Check `__NEXT_DATA__` first** — Grainger had 110 KB of product data in the initial HTML and DataDome never saw it. |
| **PerimeterX** | 5-vector score | Sometimes | Camoufox + residential | Fresh session per domain. |
| **Kasada** | Polymorphic JS PoW + native `toString` checks | Rarely | PatchRight + residential | Never `playwright-stealth` — patches in JavaScript are read by `Function.prototype.toString`. |
| **F5 Shape** | Custom VM + minute-token expiry | No | Managed API | DIY is not practical. Cost-justify: >2 days/month maintenance → managed API wins. |

## What each one actually does

### Akamai

- **Where the block is decided.** At the edge, before any client JS runs. Akamai's `sensor.js` runs after the connection is allowed, but the gatekeeper is the TLS fingerprint (and the HTTP/2 SETTINGS frames, the pseudo-header order, the extension-probe list).
- **The 60-extension probe.** The sensor fetches ~60 known Chrome extension resource URLs (`fetch('chrome-extension://[id]/manifest.json')`). A real browser usually has a few installed (ad blocker, password manager). An automation stack has zero, and an empty extension surface is itself a tell.
- **The cross-layer trap.** The hardest deployments cross-check the layers. A real Chromium solving `sec-cpt` and serialising a perfect ~2.2 KB behavioural payload to validate `_abck` *still* gets a permanent 403 when the TLS fingerprint on that same connection reads as automation. Perfect behaviour over the wrong TLS escalates to a permanent block. **Every layer must agree at once.**
- **The hidden-iframe trick.** Stealth tools patch the visible window's native APIs. Akamai injects a zero-size iframe and pulls pristine references from `iframe.contentWindow`, so the page can call the original natives even when the main window is spoofed. It then does `Function.prototype.toString` checks, inspects `Object.getOwnPropertyDescriptor` on getters that shouldn't exist, and ships an integrity hash to a separate anti-hook endpoint. Patching the visible window is not enough.
- **The honest path.** `curl_cffi` impersonates Chrome's TLS profile; for the JS surface, use a real Chromium that ships with genuine password-manager extension profiles (the patchers can't fake the extension probe list, but a real profile can populate it).

### Cloudflare

- **Where the block is decided.** JA4 in a Rust crate at the CDN edge, before your request reaches origin. `cf_clearance` is the cookie that proves you passed the JS challenge.
- **Two bypasses that aren't' escalation.** Origin IP (often not behind Cloudflare — find it via SecurityTrails / DNS history / the `mx` records) and `Accept: text/markdown` (Cloudflare's edge-level markdown conversion, shipped in February 2026, returns a stripped document with no scripts).
- **The WAF warning.** A 200 with a Cloudflare interstitial in the body isn't a 200 — it's a challenge served as HTML. Compare against a real browser before accepting the response.
- **First try.** Camoufox. If it's on a permissive Cloudflare plan, `curl_cffi` with the right profile (`firefox144` reported as the most common winner behind DataDome in one 2026 sweep, but treat as a snapshot, not a rule).

### DataDome

- **Where the block is decided.** 85,000-feature ML model + WASM `boring_challenge`. Strong but specific.
- **The cheap win.** The vast majority of the page's data often arrives in the *first* HTML response as `__NEXT_DATA__`, which the DataDome challenge has nothing to do with. Before any engine work, `curl` the page, look for a `__NEXT_DATA__` script tag, parse it with `chompjs`. If the data is there, you're done.
- **The header-set trap.** DataDome is reported to *prefer* lean header sets over the full browser bundle. A "looks like a browser" `accept-language` / `sec-fetch-*` / `sec-ch-ua` set sent from a non-JS client is itself the tell. Cut the headers back to a handful the client can justify (user-agent, priority, cache-control) and the same endpoint returned 200 in a documented case.
- **What kills `playwright-stealth`.** Same as Kasada: a `Function.prototype.toString` check on the patched natives.
- **Mobile API.** DataDome's mobile-app coverage is typically weaker than the web stack; HTTPToolkit + Frida on a rooted emulator recovers the API, and the same data is callable directly.

### PerimeterX (HUMAN)

- **5-vector score.** Combines TLS, HTTP/2, behaviour, IP reputation, and request-graph signals. No single layer dominates; the cross-check is the point.
- **First try.** Camoufox + residential proxy. Fresh session per domain — PerimeterX's session signal is one of the better ones.
- **Watch the cookie.** `pxhd` is the device-id; rotating it on every request is the easiest mistake.

### Kasada

- **Polymorphic JS PoW.** Every request carries a proof-of-work, the challenge is regenerated continuously, and the JS that mints it patches dozens of native functions. Native `Function.prototype.toString` checks on those patches fail, by design.
- **Why `playwright-stealth` no longer works.** It patches natives in JavaScript. `toString()` reveals the patch. Done.
- **First try.** PatchRight (Chromium fork that patches in C++) + residential proxy. The patches must live below the JS, not in the JS.
- **What the source guide's author found.** A 2026 hands-on review of a patched-Firefox tool reported all five vendors passing on one site each; the **control was headful vanilla Playwright**, which already passed four of five (Cloudflare, Akamai, DataDome, PerimeterX) and only failed on Kasada. So the "five-for-five" claim rests on **one Kasada page, tested once from a home residential IP**. Don't generalise.

### F5 Shape

- **Custom VM + minute-token expiry.** Tokens rotate in minutes and the payload changes every rotation. Reverse-engineering the VM is the only DIY path, and the guide's author marks it as the only vendor where the recommended move is a managed API.
- **When this is the right answer.** If your team spends more than 2 days/month maintaining a Shape target, the cost of Zyte / Firecrawl / Bright Data is lower than your hours. **Cost-justify on cost per 1,000 *usable* records**, not cost per request — the gap is most of the bill.

## Two things to remember across all vendors

1. **The block page names a vendor different from the one your headers announced.** You fixed the wrong layer. Go back to the same-IP browser-vs-script test in `SKILL.md`.
2. **All vendor pass-rates are dated.** The same fingerprint can pass today and fail tomorrow. Re-test against your own target before quoting any number, including the ones in this table.
