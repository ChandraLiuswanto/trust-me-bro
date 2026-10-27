# Proxies

What type to reach for, when, and the rules that decide whether your pool is working. **Tested on your target, not on the vendor's dashboard.** All cost/quality numbers age in months.

## 0. Read this first

The same signal that decides "your IP is bad" is also the one you can't declare; it's measured server-side. So:

- A flagged datacenter IP is a flagged datacenter IP. **No amount of header spoofing will save the request** — the score is set before your headers are read. A plain HTTP client on a clean residential IP routinely outperforms a perfectly patched browser on a flagged datacenter IP.
- **Session rules dominate exit-IP rules.** Bind a session to one exit, not to one request.
- The right order is: **fix the network identity first, then worry about everything above it.**

## 1. The four proxy types

| Type | IP source | Cheap? | When to use | When to avoid |
|---|---|---|---|---|
| **Datacenter** | AWS, GCP, Azure, DigitalOcean, Linode, Vultr | Yes (cents/GB) | Sandbox, dev, test. Pages with no anti-bot. | Anything Tier 4+. ASN databases flag every major cloud range. |
| **ISP / static residential** | Datacentre-hosted but registered to a real residential ISP | Mid (single-digit $/GB) | Long-lived session-bound accounts. Trust accumulates on the IP. | Don't rotate mid-session; session trust dies with the IP. |
| **Residential (rotating)** | Consumer devices sharing bandwidth via SDK | High ($/GB) | One-off, low-volume requests that need a clean reputation. The most common recommendation. | Long sessions. Any flow that requires state to survive the rotation. |
| **Mobile / 4G / 5G** | Carrier-grade NAT, one public IP for many subscribers | High ($/GB) | The hardest doors. Mobile reputation is the cleanest. Carrier IPs share across users without penalty. | Anything cost-sensitive; verify the carrier, the country, and the IP type before paying. |

> **Verify before you buy.** Vendor marketing says "residential"; the wire may say otherwise. A 2026 investigation joining one such network as a node found transiting requests going into ad-fraud, account registration, scalping and spam — the pool is shared infrastructure and the IPs on it are on the hook for the other tenants. Even more: an FBI seizure of a NASDAQ-listed residential provider found the pool was partly a botnet. The IP is not clean just because a vendor labelled it residential.

## 2. Match the IP to the identity you claim

The five signals a coherence check reads across must agree:

- **IP country** ↔ **timezone** ↔ **Accept-Language** ↔ **WebRTC candidate** ↔ **DNS resolver location**
- A US proxy with `Accept-Language: ur-PK` fails immediately.
- A browser pointed at a US proxy but WebRTC reveals a Pakistani local address fails immediately.
- `WebRTC ICE candidates` can read your real local and public IP through a proxy unless the browser is configured to align them. In Camoufox this is `geoip=True` — it auto-configures all five signals to the proxy's exit country.

If the type can't be aligned (mobile carriers that don't issue a real DNS resolver, residential pools where the exit ASN doesn't match the geo), don't use that exit for a target that cross-checks.

## 3. Session binding (the rule that fails most often)

The single most common way a long-lived scraper breaks is to swap the IP mid-session. Three flows punish it:

- **Authenticated sessions.** Sign in from Paris, ask for data from Seoul — server sees a network change, re-verifies, or invalidates the session. Mid-flow IP change = instant red flag.
- **Stateful pagination.** Server-side cursor tied to your IP. Change between page 3 and page 4 → cursor lost, response is a block or silently wrong data.
- **Multi-step forms / checkouts.** State established at step one carried forward; mid-flow change is the same red flag.

> The rule: **all requests belonging to one logical session must exit through the same IP, or at minimum the same subnet, ASN, and geo.** For an account you keep logged in for days or weeks, **widen that rule**: bind the exit to the account for its whole life, across worker restarts and snapshot restores, not to a session TTL.

When the provider can no longer give you that exit, **treat it as a planned re-login from the new location** rather than silently continuing. A restored snapshot that suddenly arrives from a new region is both stale-looking and suspicious-looking at once.

The cheapest way to test the rule on your target: open a session, log in, then swap the exit IP, and see whether the server forces re-auth. Some applications revoke on exactly that pattern (network or location change outside the state you saved); test how tolerant your own target is before relying on it.

## 4. Two rotation rules that earn their keep

- **Stop rotating proxies round-robin; score each route on what happened after.** A request that returned a usable record is on a *better* exit for that route than one that returned a 200-but-empty body. Track per-route success per exit; let the score choose.
- **ISP / static residential: never rotate mid-session.** Trust accumulates on the IP. Rotation breaks it.

## 5. The proxy-detection layer you cannot declare

Latency is not a claim; it's a measurement the server takes. A proxy inserts a hop the server's transport clock never paid for, so the round trip it times and the one your traffic makes diverge. One edge detector scores exactly this in a few lines of Fastly VCL — `min RTT / smoothed RTT` — with bands: 1.0–0.7 normal, 0.7–0.3 unstable, 0.3–0.1 possibly proxied, < 0.1 blocked. The bands are chosen, not calibrated; no accuracy or false-positive rate is published.

What this means operationally: **rotating the pool moves this number not at all, because every exit in it sits equally far from your client, and the fix is a nearer exit, not a faster proxy.** A nearby residential pool (same region, same metro) will outscore a far-away "premium" one on latency-based scoring.

Because the counters live in TCP state, **an HTTP/3 connection often goes unscored** — the same route that scores 0.2 over HTTP/2 can be unobservable over HTTP/3. If your target negotiates HTTP/3, a `curl_cffi` profile that speaks it with a browser-shaped QUIC fingerprint (and UDP-proxy support) is the highest-leverage change you can make to a proxy setup.

## 6. Use the proxy's geography, don't buy it

Vendor marketing says "US residential." Verify on the wire:

- Curl the IP against `ipinfo.io` or `ip-api.com`. Confirm country, ASN, and the `org` field reads as a residential ISP or carrier, not a cloud provider.
- `tls.peet.ws` / `tls.browserleaks.com` — check the JA3 from the proxy's exit looks like the browser you claim.
- A two-tab test: same target, two exits, one US one UK. If the response content doesn't differ (currency, language, IP-disclosed product), the geo is decorative.

## 7. Cookie reuse as a cheap "split" (one specific case)

Some limiters earn a token via browser sensor then don't bind the token to the warm-up client. Imperva's `reese84` on at least one deployment was earnable in a real browser, then replayable from a plain TLS-impersonating client on a different network. On a September 2026 test, one retail site's `renewInSec` was 699 seconds (~11.5 min); a warmed jar returned full HTML from a residential IP, a datacenter IP, and a home line abroad. A captcha-assisted warm-up cost about a tenth of a cent.

**This is one site on one date. Binding can differ per deployment. Treat it as a test to run, not a rule to assume.** The general idea — "pay for the stealthy warm-up, spend the token on cheap infrastructure" — only works when the token is genuinely un-bound. Test before you commit.

## 8. Two-trap rule (proxies edition)

- **Don't trust the "residential" label.** Verify ASN, geo, and traffic class on the wire.
- **Don't trust a vendor success rate.** Run a small probe against your real target before paying. Pool health is a moving target.
- **Don't rotate mid-session.** It's the cheapest mistake and the most expensive to debug.
- **Don't reach for a proxy to fix a fingerprint problem.** A bad TLS profile stays bad behind a residential IP; the only thing that changes is the IP score. See `SKILL.md` for the order.

## 9. Red flags

- A 403 that's the same from a residential IP and a datacenter IP — the problem is your fingerprint, not the IP. See `SKILL.md` step 2.
- A clean run for hours that suddenly 403s in one region — your pool's geo distribution just hit a regional ASN that's flagged. Re-pull a sample and check the `org` field.
- A session that fails re-auth on a snapshot restore — your IP changed across the restore. Plan it as a re-login from the new location.
- A target where a captcha-warmed cookie replay works for hours then stops — the token's bound here, or the `renewInSec` got shorter. Re-warm and re-test; do not assume the cheat is permanent.

> See `web-scraping` (parent) for the decision ladder, and `vendors.md` (this skill) for the per-vendor mechanics.
