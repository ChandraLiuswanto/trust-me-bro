---
name: web-scraping-production
description: Use when the scraper runs unattended (nightly, weekly, in a cron, or as a daemon) — architecture for self-healing, the verification that turns a model-rewritten selector into something safe to ship, and the silent-failure modes that page you (200 with zero rows, row-count drops, content drift, poisoned data, content-type shifts).
---

# Web Scraping in Production

The skills `web-scraping-data-sources`, `web-scraping-blocked`, and `web-scraping-llm-extraction` all assume a human is in the loop. This one assumes the run happens at 3 a.m. and the on-call is asleep.

## Cross-refs

- `web-scraping` (parent) for the decision ladder, build-vs-buy rung, and 429-vs-403 triage.
- `web-scraping-blocked` for what to do when 4 a.m. is also getting 403s.
- `web-scraping-llm-extraction` for the model-writes-code pattern, the 10 failure modes, and the prompt-injection surface.
- `web-scraping-data-sources` for the API-vs-HTML trade and the recon checklist.

## 0. The thesis

> **A scraper that runs perfectly can still be wrong.**

Two practitioners posted the same finding in the same week. One ran twelve requests, got 200 on every one, and collected zero rows. The other put it as a rule: a scraper can return 200 and still have collected the wrong page. The whole rest of this skill is what you build around that observation — so the failure pages you, not your customer.

A modern firewall rarely hard-blocks you. It returns `200 OK` with a degraded body: an empty list, sanitised prices, a tarpit, yesterday's snapshot frozen in place, an interstitial you mistook for content. **Status code is not a success signal. Coverage is.**

## 1. When to use this skill

- A scraper runs on a schedule (cron, K8s job, serverless schedule).
- You depend on its output downstream (BI, ML, RAG ingestion, alerts).
- It is signed in to a real account, has tokens, or holds state across runs.
- It is allowed to rewrite its own selectors (i.e. a model is in the loop).
- It collects from more than one page per run, so a single bad request can pollute the whole dataset.

> If you are doing a one-off browser session and you can see the result, you are in `web-scraping-blocked` and `web-scraping-llm-extraction` territory, not here.

## 2. The architecture that survives

Three pieces, composed:

1. **Page objects** hold the selector and parse logic per field, isolated from the crawl loop. Test them with saved fixtures, not against the live site.
2. **A field-coverage monitor** (Spidermon is the Scrapy-native one; the pattern is engine-agnostic) runs each cycle and **fails the run the moment coverage drifts** instead of at the end.
3. **A repair agent** gets the field name, the URL, the saved fixture, the failing sample, and the *test* to satisfy, and rewrites the one selector that owns the field. **The fix is targeted, not a regeneration of the whole scraper.**

The discipline: **the model proposes, but a deterministic gauntlet decides whether to trust it.** Without that structure, "healing" means regenerating everything and hoping. With it, healing is a targeted edit a monitor can request and a test can sign off.

The third piece is the *failure cost*, not the cool part. A vendor's parser agent reported shipping 59% of its changes to engineers' 87%, with 3.6 extra human changes per ship and 7 days median to production (against 20 hours for engineers), and its share fell to 14% the quarter after the target lapsed. **Judged on volume, the agent wins. Judged on the cost of landing changes, it loses.** Score the agent on time to fix; do not reward change-count.

## 3. The silent-failure modes (the alarm that matters)

The most expensive production failures all return a 200:

| Failure | What it looks like | Alarm |
|---|---|---|
| **Empty 200** | Status 200, body is `{"posts": [], "has_next_page": false}` | Before storing zero rows, run an *independent* call that confirms the entity you asked about exists and is non-empty |
| **Reduced 200** | 200 with 10% of yesterday's row count on the same schema | Alert on **count per endpoint per run**, not on status code |
| **Challenge-as-200** | 200 with a Cloudflare interstitial in the body | Run a content check on every 2xx; match the body case-insensitively for `cf_chl`, `cf-turnstile`, "Just a moment", "Checking your browser" |
| **Login wall as 200** | 200 with the login page served in place of a public feed (Facebook) | Empty feed on a live, populated group is a wall, not an empty group; raise, do not store |
| **Stale 200** | 200 with yesterday's snapshot | Record count and field total; alert on delta against last-N runs |
| **Content-type shift** | 200 with `text/markdown` instead of `text/html` (Cloudflare's edge conversion since Feb 2026) | Diff against a *browser-rendered* fetch, not just yesterday's run |
| **Poisoned data** | 200 with values that parse but mean something different (sanitised prices, persona-fit content) | Cross-check against a deterministic parse; reject values that don't appear in the source text |
| **Cross-tenant leakage** | Content matches a known prompt, not the page | Field that isn't locatable in the source HTML is suspect — probable LLM hallucination |
| **Font poisoning** | The page says one word, the font draws another | A "does this look like a price" classifier on the rendered text |
| **Coverage drift** | A field's fill-rate drops 90% on a stable schema | Spidermon or equivalent per-run check |

**The one rule that catches all of these:** *Gate every write on a content classification, never on the status code.* Classify into `challenge`, `ok`, `hard_block`, and give each its own action: reroute `challenge` to a render path, back off on `hard_block`, run the rerouted response through the same detector before storing it.

> An *empty result is only trustworthy once you have proved there was something to find.*

## 4. The challenge-page detector (a working pattern)

Keep the detector a pure function so saved challenge pages become regression fixtures, and chart the reroute rate, since a jump is usually the first sign a target changed its protection.

- Match the body for: `challenges.cloudflare.com/turnstile`, `cf-turnstile`, `__cf_chl_`, `cf_chl_opt`, `Just a moment`, `Checking your browser`.
- Treat the `cf-mitigated: challenge` header as decisive.
- `server: cloudflare` and `cf-ray` only say who fronts the site; they don't tell you what the response *is*.
- Re-check the marker list against a fresh challenge page before trusting it; the markers track the markup, which the vendor rolls forward.

## 5. Self-healing: yes, but with stop conditions

A self-healing loop has the right pattern for "selector moved a few classes": repair one field, prove it on a test, ship. It has the **wrong** pattern for legal and account-level events.

### Recovery (the loop can do this)

- 401 / 403 with refreshable token
- 429 with `Retry-After` and a backoff that respects it
- Cookie expiry within a 30-day window
- Network blip, transient 5xx
- Selector moved within a stable class prefix
- JSON `doc_id` rotation (re-derive from page)

### Halt (the loop must page a person, never recover)

- **Forced password reset** — operator action, often paired with a message
- **Account suspended** — service-side decision; re-login escalates it
- **Cease-and-desist letter received** — legal posture
- **Terms of service changed and re-acceptance required** — re-accepting auto-replays the original terms through the new ones
- **A consistent stream of 403s across rotating exit IPs** — likely a permanent fingerprint ban; rotating through it makes the legal case worse
- **Cross-tenant data appearing in responses** — your session is being routed to another account's view
- **Content that visibly matches a templated decoy** — site is serving bots a different site
- **A `sitemap.xml` that doesn't match the navigation** — see §9

Keep a record of every re-login, the timestamp, the reason, and the response codes around it. A timeline showing you stopped when told is the difference in this line of cases (`hiQ v. LinkedIn`, `Power Ventures v. LinkedIn`).

> The hiQ/Power Ventures split: hiQ logged in and accepted terms; Power Ventures kept going after being told to stop. A self-healing session that re-authenticates after a forced reset will, *by design*, keep logging in past the moment a platform has told you to stop. **Write halt conditions explicitly, separate from retry conditions.** The two share a name and look similar; only one is recoverable.

## 6. The verifier: what a model-written scraper must pass before it ships

A self-healing scraper is one unverified code-execution endpoint per field. The discipline:

1. **A saved fixture per field** (HTML + expected output). The repair agent runs against the fixture, not the live site.
2. **A deterministic parse step** that catches the two LLM failures that pass silently:
   - Field present in output but **not locatable in the source text** → suspect (probable hallucination).
   - Field absent or empty → missing.
3. **A field-level confidence gate** (per-field Beta distribution updated on each verified sample beats a single `confidence: 0.9` number — a point estimate of model confidence is not evidence about the page).
4. **A promotion gauntlet**: the rewritten selector must match the saved fixture *and* the live probe *and* the previous selector's run-overlap above a threshold. Miss any, roll back.
5. **An audit log** with the field, the URL, the before/after selector, the test, the live probe, the timestamp, and a human-readable diff. *Without it, the fix is not reproducible.*

The 7 binary failure-mode-per-field pattern (hallucinated / off-target / type mismatch / unreasonable / incomplete / format violation / name-desc mismatch), aggregated with `max` so a single confident flag escalates rather than averaging into silence, is the source guide's working example. *Never aggregate with `mean`.* A `mean` of seven zeros and one 0.99 is a 0.14, which looks like a pass.

## 7. The session rules that fail most often

These are not detection; these are correctness:

- **Same IP across the session.** A long-running authenticated scraper that swaps the exit IP mid-session re-auths (if you are lucky) or, if re-auth is silent, gets a 200 with the wrong account's view. Bind the session to a sticky exit, and bind the exit to the account for the account's life. When the exit dies, treat it as a planned re-login from the new location, not a continuation. See `web-scraping-blocked/proxies.md`.
- **Same IP across restarts.** A snapshot that returns from a new region on restart looks stale *and* suspicious. Plan a re-login.
- **Re-derive the mobile GraphQL `doc_id` on every run.** A pinned `doc_id` is the most common Facebook-feed-200-with-zero-rows cause. The token is a private schema that can shift without notice.
- **Detect navigation loops without conflating with bounces.** Page 10 → page 1 is a *bounce*, not a loop. Store the page where a record was *first* seen, not the latest page number; otherwise the same record looks like ten records and your row count is wrong by an order of magnitude.
- **Split publish time from observation time.** A social "trend" is your outage when you measure it by publish time. Keep `observed_at` and `published_at` separate in the record.
- **Don't carry the `IndexedDB` state from a Playwright `storageState` unless you asked for it.** It skips IndexedDB by default; restoring from one without re-injecting IndexedDB will silently lose part of the session.

## 8. The "did you ever have the whole thing" question

Every completeness idea in the source guide is *defensive* — did a field go missing, did coverage drop against the last run. **None of it answers the prior question: did you ever have all of it?**

A crawl that has silently been seeing 70% of a catalogue since the day it launched has no delta to alert on, because the baseline was already wrong.

**Sanity checks that do not require a baseline:**

- `sitemap.xml` total compared to the count you collected, with the gap accounted for (out-of-stock, removed listings). *If a site publishes a sitemap, the gap is measurable. If it doesn't, the absence of one is itself a signal.*
- A *single* sample of a high-entropy field ("max price", "earliest date in the index") per run, fetched independently and compared.
- A randomised 1% sample re-fetched and compared to last cycle.
- A reverse-DNS check on the URL space: list all subdomains the site has ever served (DNS history, Common Crawl) and compare to what you visited. *A 30% delta is data.*

## 9. Sitemap disagreement (the cheap early warning)

If the `sitemap.xml` doesn't match what the user-facing navigation shows, one of three things is true:

- The site has pages it doesn't list in the sitemap. Aka "blocked for being wasteful, not for crawling."
- The site has sitemaps for pages that don't exist.
- The site's CDN is geo-shaping the sitemap response.

Run a sitemap parse separately from your crawl. Disagreement is an early signal — often weeks before a content-type change is rolled forward to the pages you're collecting.

## 10. Crawler-side code-execution risk (the one to know about)

- **Scrapy 2.19's live debug endpoint** is on by default in every crawl. It is a real code-execution endpoint bound to the same user. If you scrape over a public network, you have a same-user remote code-execution surface. The fix is configuration, not a CVE patch. **Check the default on your crawl runner before the run starts.** The same class of risk applies to any framework that ships a "live" mode on by default.
- **Remote-CDP mode in some stealth plugins** binds an unauthenticated credential-injecting proxy relay to `0.0.0.0`. Don't expose crawl workers on a public port.
- **Dataset configs that load code.** A YAML config that names a "post-processing hook" can become a code-execution path. Treat configs as code.
- **A crawler that follows a page's instructions and visits a new domain is browsing as you.** If you point a coding agent at the open web, give it the narrowest credentials that let it finish, keep secrets outside the context the page can influence, and put a deterministic allowlist on which domains and actions are permitted. **The page gets a vote on your agent.** See `web-scraping-llm-extraction` for the prompt-injection surface.

## 11. Cost and rate (the second alarm)

- **Bandwidth is now the bill on hard scrapers.** Hard-tier build is roughly $112.50 in tokens per a published 2026 case, but at 1.7 MB per rendered page and $8/GB, bandwidth is roughly $0.0136 per request — *twelve times the token cost*, recurring every month. The hard site's bill is not the model.
- **Cost per 1,000 *usable* records, not per 1,000 requests.** A 200 with empty rows is a 200; it is not a record.
- **Throttling doesn't always 429.** Some limiters are documented to *queue* (Polymarket's public API is the named case), so the alarm is latency, not status. Watch both.
- **Cold start vs distance.** Cold start is paid once; the inter-region hop is paid every round trip. A browserbase run was measured at 152 ms Frankfurt→US West, 3 ms after the move. The same path-cost pattern shows up in any managed-browser API; the variable is which region you connect from.
- **`browser.close()` does not stop a cloud browser.** The 1,556 ms reconnect cost (against 6,046 ms after the provider's explicit `Stop`) suggests the worker is not being killed; it's idle. If you have a budget, this is the line to investigate.

## 12. Red flags

- A run that returns 200s and zero rows. **Pages you, do not flow downstream.**
- A run that returns 200s and 10% of yesterday's count on the same schema. Same.
- A run that returns 200s with a `text/markdown` content-type on a target whose other pages ship HTML. Same.
- A self-healing loop that has retried the same field three times in a single run. **Stop the run; the loop is now in a recovery cycle that is making things worse.** Page a human.
- An `IndexedDB`-dependent flow that survived a restart without re-injecting IndexedDB. **You're running a partial session.**
- A `sitemap.xml` count that disagrees with the navigation by more than 10%. **Investigation; not a paging alert.**
- A re-login rate above 5% per run. **Re-logins have a legal cost; investigate before it grows.**
- A model with `confidence: 0.9` returned. **Routing metadata, not evidence.** Verify before storing.
- A `storageState` saved on a public network. **Don't.**
- A Scrapy (or any framework) crawl running on a public port with the live debug endpoint on. **Stop the run.**

> See `web-scraping` (parent) for the decision ladder, `web-scraping-blocked/vendors.md` for the per-vendor mechanics, and `web-scraping-llm-extraction` for the agentic patterns this skill composes on top of.
