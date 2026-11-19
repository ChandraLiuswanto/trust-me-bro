# Web Scraping — Finding the Data Source

Distilled from Asad Ikram's guide (https://asadfix.github.io/scraping-guide/, 2026). Vendor and tool specifics age fast; the order in which to look is durable.

## Core idea

**Stop parsing HTML if the site already has a JSON endpoint that returns the same data.** The cheapest scraper is the one that doesn't parse the page. Walk this ladder; stop at the first rung that works.

## 0. Recon first (5 minutes, before anything else)

Open Chrome DevTools → Network → Fetch/XHR, then **interact with the page**: scroll, paginate, filter, sort, open a detail view. The first HTML response is server-rendered, so the data call usually *doesn't fire on a plain reload*. You have to make the page ask for it.

A useful capture script (Playwright, ~20 lines) hooks `page.on("response", ...)` to record every `application/json` response, drops analytics hosts (Google, Facebook, OneTrust), deduplicates by method+base path, and writes the bodies to disk. Reading those bodies tells you the data layer the site is actually built on.

> This step costs minutes and regularly turns a Kasada or Akamai problem into a JSON problem. Don't skip it.

## 1. The ladder

### Rung 1 — Look for a sanctioned door

Before you scrape at all, ask whether the site wants to be queried:

- Official API, partner program, or developer docs.
- Sitemap (`/sitemap.xml`), RSS, Atom feed, `text/markdown` content negotiation.
- The site's own agent endpoint (WebMCP) if it advertises one.
- `Accept: application/json` on a normal page — some sites have a JSON view of the same URL.

### Rung 2 — Embedded JSON in the initial HTML

Many modern sites ship their data inside the first HTML response as a script tag, *before any JS runs*. Parse these patterns:

- Next.js: `<script id="__NEXT_DATA__" type="application/json">{...}</script>` — can be 50–500 KB and contain the full page state.
- Nuxt: `window.__NUXT__`
- Generic React: `self.__next_f.push(...)`, `__PRELOADED_STATE__`, `__INITIAL_STATE__`
- JSON-LD blocks (`<script type="application/ld+json">`) — schema.org structured data, often complete.
- Plain inline `<script>window.__INITIAL__ = {...}</script>`-style assignments.

Parsers: `chompjs`, `Parsel`, `BeautifulSoup4` with a regex on the script tag, or a one-liner that `json.loads` the contents after slicing the wrapper.

> **Worked example:** Grainger.com (DataDome-protected) shipped 110 KB of product data inside `__NEXT_DATA__`. The data was present in the very first response, so the DataDome challenge had nothing to do. The whole bypass was one `curl | chompjs`.

### Rung 3 — The internal XHR / GraphQL endpoint

Most SPAs fetch their data from one or a few JSON endpoints. To find them:

1. Open DevTools → Network → Fetch/XHR.
2. Reload, paginate, filter, sort, open detail views.
3. Right-click the JSON request → Copy → Copy as cURL.
4. Run the cURL command in a terminal. If the response is the same JSON, you have the endpoint.
5. Strip query parameters one at a time until you find the smallest request that still returns the data. This both documents the API and reveals hidden parameters.
6. Strip headers one at a time too — anti-bot sometimes lives in headers your browser sent, not in the URL.

Look for:
- REST: `GET /api/v2/products?page=3`
- GraphQL: `POST /graphql` with a query string in the body
- Internal RPC: positional JSON (see rung 4 below)
- Proxied third-party search (Algolia, Elasticsearch): same data, different host, credentials injected server-side. There may be no key to extract because the site is authenticating on your behalf.

### Rung 4 — Mobile app API

An authorized mobile API can expose useful structured data, but may have different authentication, coverage, signing and access restrictions. Compare its actual suitability rather than assuming weaker protection.

Trade-offs and tools live in `mobile-api.md`. On an authorized test device, interception may expose API traffic, but certificate pinning, custom transports, attestation and session binding can prevent capture or replay. A usable API can avoid HTML parsing; it does not remove access controls or guarantee equivalent coverage.

### Rung 5 — Non-obvious endpoints (endpoint enumeration)

Anti-bot is usually deployed as a *rule on a route*, not a property of a domain, and the rules are written by people under deadline. Read the JS bundles and list every route the frontend can call, then test each one cold with a plain HTTP client. Common places rules aren't applied:

- Map views (richer, because they need coordinates and metadata a list view doesn't)
- Autocomplete / typeahead
- Mobile-specific paths (`/m/`, `m.example.com`)
- Embed widgets
- Sitemap-adjacent JSON
- RSS / Atom / `text/markdown`
- Print views
- Search results before pagination

> This step costs an hour and regularly turns a Kasada or Akamai problem into a JSON problem. Do it before reaching for a browser.

## 2. Shape problems

Some endpoints return data, but in shapes that need work:

- **Private positional JSON arrays (not ProtoJSON).** Some endpoints return nested arrays without field names, sometimes prefixed with an anti-hijacking string such as `)]}'`. Standard [ProtoJSON](https://protobuf.dev/programming-guides/json/) is the Protocol Buffers JSON mapping, not a name for arbitrary positional arrays. Strip the prefix, `json.loads`, and then map indices to named constants. An LLM is genuinely good at this — give it a sample response + a rendered page, ask it to align visible values to array paths, then freeze the mapping into a parser. The mapping is a private schema, so it can shift; treat it like a brittle selector and put it behind the same self-healing triggers.
- **Advertised methods.** `Allow` lists supported methods; it does not prove authorization, response cacheability or the safety of every operation on an endpoint. For a documented `QUERY` interface, verify method semantics, request shape, authentication and cache controls against its current specification and actual responses.

## 3. Endpoint checklist (paste into your plan)

Before you accept a target needs a full browser stack, confirm:

- [ ] Sitemap / RSS / official API checked.
- [ ] `__NEXT_DATA__` / `__NUXT__` / `__PRELOADED_STATE__` / JSON-LD scanned.
- [ ] DevTools Fetch/XHR capture done, with **interaction** (not just reload).
- [ ] Smallest-request cURL produced a non-empty response.
- [ ] Map view, autocomplete, mobile path, embed, print-view, RSS, markdown tried.
- [ ] Mobile app API considered (see `mobile-api.md`).
- [ ] First-page parity check: the JSON you got back actually matches what's rendered (not a partial / cached / placeholder payload).

Treat this checklist as reconnaissance, not a shipping gate. Validate access, required fields, pagination, requested scope, persistence and independent coverage before acceptance.

## 4. Common mistakes

- **Reloaded, didn't interact.** The first HTML response is server-rendered, so the JSON call never fires on a plain load. You have to make the page ask for data it doesn't already have.
- **Skipped warm-up.** Navigating straight to page two of a protected listing gets you blocked with an HTTP/2 protocol error that looks like a network fault. Load the homepage first, let the session collect `_abck` / `bm_sz` / `cf_clearance`, then navigate. The cookie isn't decoration; it makes the next request legible.
- **Read `page.content()` and discarded every response.** A real browser launched with no `page.on("response")` listener throws away every XHR/GraphQL/JSON the page fetched to build itself. The HTML cleaner then strips `<script>`, deleting `__NEXT_DATA__` and friends. That is the most expensive single omission in modern scrapers.
- **Stripped the `<noscript>` and script tags too early.** The data often lives there.
- **Believed the dev's documentation.** Internal endpoints are undocumented by design; verify against a real capture.
- **Trusted a JSON response without spot-checking.** A 200 with the wrong shape, a 200 with a placeholder list, and a 200 with stale data are all common. Diff a sample against view-source before wiring it into the pipeline.

## 5. When this is the wrong skill

- The data is gated behind a JS-rendered SPA and **no embedded state** is shipped, and no XHR you can find returns the data → read `blocked.md` (or just the JS-rendered section of it).
- You have the data but it's in a 1,000-page document and you need a schema → read `llm-extraction.md`.
- The scraper needs to run unattended → read `production.md` once you have a source.

> See `SKILL.md` for the full ladder and the gating/ethics framing.
