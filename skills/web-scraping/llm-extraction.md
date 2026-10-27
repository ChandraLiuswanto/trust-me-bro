# Web Scraping with LLMs

The case for letting a model read the page, the cost of doing it on every row, and the failure modes to engineer around.

## Cross-refs

- `SKILL.md` for the decision ladder and build-vs-buy rung.
- `data-sources.md` for finding the API before reaching for an LLM.
- `blocked.md` for what to do when the LLM path is also getting 403s.
- `production.md` for monitoring, self-healing, and the silent-failure modes that hit LLM extractors too.

## 0. When to use this guide

- A page is messy enough that writing selectors costs more than the model call would.
- The schema is fuzzy, page-to-page, or undocumented — and you want the model to negotiate it.
- A multi-step UI flow (login, modal, paginated wizard) needs a real browser and a brain.
- You are building an agent that operates the web, not a one-shot extractor.

> If the data lives in `__NEXT_DATA__` or a GraphQL endpoint, you don't need an LLM. See `data-sources.md`. If the page is a clean static doc, an LLM is paying inference to read things a regex already handles.

## 1. The three reasons to put an LLM on the page

| Reason | What it replaces | When it pays |
|---|---|---|
| **Schema is fuzzy** | Hand-written selectors for every variant | Pages where layout changes, but content shape is constant |
| **Multi-step flow** | A pile of selectors per state in a wizard | Modals, logins, paginated navigations a static parser can't reach |
| **Document-mode reading** | Regex + boilerplate strip + manual parsing | PDFs, scans, weird tables, code samples intermingled with prose |

For (1) and (2), the model produces a *selector or script*; your code does the field extraction, so the model sees the page once and you ship its plan to thousands of rows. The expensive call is not per row. The biggest token wins come from this split, not from a smarter model.

## 2. The cost stack (where tokens actually go)

A single Amazon product page, three ways:

| Form | Tokens |
|---|---|
| Raw HTML | ~17,000 |
| Markdown | ~17,000 (the page is so image-heavy markdown helps less than you'd think) |
| Clean structured record from a data API | ~3,600 |
| Trimmed to the seven fields you actually want | ~107 |

The biggest hop is not LLM magic, it's *picking seven fields out of the noise*. Pre-clean (strip `<style>`, `<svg>`, `<noscript>`, inline scripts — keep JSON-LD; that is data) shrinks HTML 3–5× before the model sees it.

The second-biggest cost is the **MCP / tool surface** the model carries in its context, not the page itself. Playwright MCP registers ~13.7K tokens of definitions before you click anything; Chrome DevTools MCP ~17K. A ten-step automation flow burns 7K tokens against 50K (CDP) and 114K (Playwright MCP). One vendor server that exposes only `scrape(url) → markdown` has nothing in the menu to cut; its bill is the page payload, which is the cost you should trim first.

> **Count your system-prompt tokens before the first user message.** Trim the payload (free) before you trim the tool surface (costs a sandbox).

## 3. The split that scales: model writes, code runs

The most-durable pattern in the source guide's hands-on work:

1. **Model proposes** selectors / page-object fields once, with confidence per field (`price=high`, `availability=fragile-with-fallback`).
2. **Your code** runs the selectors over every row, deterministically.
3. **Verifier** runs on a sample (~12% in one design) with a larger model, and only escalates rows where the deterministic parse looks off.

This is not glamorous. It scales because the model sees the page once and your row count is decoupled from model cost. An agent that re-reads a screenshot on every row is paying model inference for *every row it extracts*. The first scales; the second demos.

## 4. Three honest price benchmarks before you commit

- **Build-vs-buy crossover moved on cheap scrapers, not hard ones.** A 2026 rerun of the 2023 model found break-even volume fell about two-thirds on light HTML sites but only about a tenth on sites that need a full browser render. The inputs: hard-tier build ≈ $112.50 in tokens, but at 1.7 MB per rendered page and $8/GB, bandwidth is ≈ $0.0136 per request, twelve times the token cost, recurring every month. The hard site's bill is not the model.
- **A vendor "99.9% reduction" is a *definitions* number, not a *task* number.** Cloudflare's Code Mode: 2,500 endpoints reachable through two tools in ~1K tokens — counted against a 1.17M-token baseline of a one-tool-per-endpoint server nobody ever built. Anthropic's 150K → 2K is an illustrative calculation over a single snippet by the promoting party. The only task-level figures (32% on a simple job, 81% on a 31-event one) come from a single unrepeated demo of a much smaller calendar agent, and most of the 81% is batching rather than schemas. **No vendor publishes an error/retry rate for model-written code**, so the savings are never netted against the script the model got wrong.
- **Cost per 1,000 records ≠ cost per 1,000 requests.** When you switch from raw HTTP to LLM-structured records, the unit changes and so does the build-vs-buy line. Same data, 70× to 670× different crossover, depending on which side of that swap you measure on.

## 5. Ten failure modes in scrapers an agent wrote for you

Patterns the source guide saw across 34 findings in one vendor's open-source `claude-skills` plugin. None is specific to that vendor. **Run a check for each before you ship an agent-built scraper.**

1. **Selector that finds the wrong element.** Two adjacent nodes share a class; the agent picked the wrapper, not the value. Test on a held-out page set before accepting.
2. **Confidence assigned to the wrong field.** A `high` confidence tag on a field the model hallucinated a value for. Confidence is the model's own estimate; it does not predict correctness on out-of-schema text.
3. **Schema drift ignored.** The page changed; the agent did not. Add a "did the schema still match?" check on the next run.
4. **Generated code that no one ran end-to-end.** The agent built a function and stopped at "compiles." Run it on real rows.
5. **Pinned impersonation profile.** A frozen TLS / browser profile is itself a detection signal — re-test before relying.
6. **Cost-recovery loop that re-authenticates forever.** Same trap as production self-healing, but inside the agent: it re-logs in after a forced password reset, a suspension, or a cease-and-desist. **Halt on those**, do not recover.
7. **Selector that fails silently on a missing field.** The page no longer has the field; the agent returns `null` and the verifier does not flag it. Wire the verifier to count `null` against schema coverage.
8. **Token-window trim that drops the evidence.** A model that summarises a long list to fit context silently redefines the site. The user is reading a list that no longer corresponds to the page. Track tokens in/out per call; a trim that "saves" 80% of tokens is also dropping 80% of evidence.
9. **Prompt injection that looks like a record.** A page contains text in JSON-LD or a hidden `display:none` span the model reads as instructions. Treat structured data as untrusted text before any model call. See §7.
10. **Maintenance untracked.** "The agent fixed it" with no audit trail of which selector it picked, when it last passed, which samples supported it. Without a blackboard (`.scrape/site/`) the fix is not reproducible.

## 6. Browser agents: when to pay for them

- **Cost.** Computer-use agents are reported as 2.7–4.3× more steps than they need; a ten-step automation flow with Playwright MCP costs ~7K tokens in 2026, ~50K with Chrome DevTools MCP, ~114K with Playwright MCP. Two-thirds of the bill is the browser tool.
- **Where they pay off.** Multi-step, interaction-heavy tasks where request-based scraping was never going to reach. A "point an agent at the UI" path is a real option when the schema is undocumented *and* the flow is non-trivial.
- **Where they do not.** Bulk fetching on a request-based scraper built once is orders of magnitude cheaper. **Agents belong on the hard, low-volume, interaction-bound tail**, not on the bulk path.
- **The shifting line.** First-generation browser agents translated the page into something the model could digest (DOM, a11y tree, screenshot) and asked the model to choose an action against it. That representation is lossy. The newer pattern: the agent *writes code once and runs it*. Same compile-and-run pattern, arrived at from the other direction. The first scales, the second demos.

## 7. Prompt injection on the way in

This is now the highest-prevalence finding the source guide names for LLM-based scraping:

- A 2026 measurement of 1.2 billion URLs validated 15,387 prompt injections on 11,722 pages. Crawlers and data scrapers were the dominant target class.
- About 70% of injections sat in HTML that never renders: headers, comments, metadata. JSON-LD carried 26% of body-injected text.
- 87% are non-visible once you count rendering tricks (matching colours, occlusion, zero-size elements).
- 53% sit in headers or early HTML, where a model reads first.

**Operational rules:**

- **Never hand the model a flat plain-text page.** Across the study's 5,200 controlled trials, a page flattened to plain text was obeyed 3.9% of the time against 1.1% for HTML, because stripping the markup also strips the evidence that the text was hidden. Keep the structure.
- **Treat JSON-LD and response headers as untrusted text before any model call.** Parse them with code, screen for instruction-like text first.
- **Do not trust a client-side ID stored in `localStorage`** as a stable link; if it's gone, hardware signals (GPU renderer, screen, CPU + device memory) are the fallback.
- **The image-puzzle CAPTCHA is the wrong lever.** Image challenges are losing ground to small open-weight vision models; one unpublished, n=1 report says fine-tuning a 2B model on ~200k hCaptcha images reached 90%+ on unseen classes. Treat in-house image solving as an upkeep commitment the defender sets, not a one-shot build.
- **CAPTCHA-as-an-MCP-tool is the wrong pattern.** The agent "solves" by calling an external solver service; the work is proxies + partnerships + a dedicated classifier, not the agent's LLM.

## 8. Hallucination: the value that parses perfectly and means something else

The most expensive LLM-scraping failure is the one that *looks correct*. A model that confidently returns a plausible `price` is harder to catch than a `null`.

- **Cross-check with the deterministic path.** Where the LLM output and the regex output agree, trust; where they diverge, flag. Agreement is a far better signal than either confidence in isolation.
- **Anchor on a typed schema.** `pydantic` / `instructor` / `outlines` — give the model a typed output target. It does not stop hallucination but it does narrow the failure surface to one place you can test.
- **Bayesian confidence, not point estimates.** A Beta-distribution per field, updated on each verified sample, beats a single `confidence: 0.9` number. Source guide's architecture runs six math operations on a `scipy.stats.beta` over the verifier's row sample.
- **Where the model earns its place.** On pages the deterministic path can't parse — skewed scans, odd layouts, missing labels, tables the rules can't catch. **Run rules first; LLM only on the failures.**

## 9. When this is the wrong skill

- The data is in the initial HTML as JSON (`__NEXT_DATA__`, `__NUXT__`, `__INITIAL_STATE__`). You don't need a model. See `data-sources.md`.
- The page is clean static HTML. A regex + a Markdown converter (Firecrawl, MarkItDown, Crawl4AI) gets you 67% fewer tokens before the model ever reads it.
- The bottleneck is *not* parsing. It's rate limiting, captcha, or blocks. See `blocked.md`.
- The job is bulk extraction across millions of pages. Even with a small model, per-page inference is the wrong architecture; let the model propose selectors and your code runs them.
- You are doing production monitoring, self-healing, and silent-failure detection. That is its own discipline. See `production.md`.

## 10. Red flags

- A vendor success rate over 95% quoted without a verifier pass rate, without an error/retry rate for model-written code, and without a ground-truth dataset.
- A scraper whose model "auto-fixes" selectors on a schedule with no human-readable audit trail.
- A token-trim step that "saves" 80% of input. The same 80% is the page's evidence the user is now missing.
- An agent that re-logs in after a forced password reset, a suspension, or a cease-and-desist.
- A pipeline that flattens the page to plain text before the model reads it.
- A "99% reduction in input tokens" headline that doesn't name what task it actually finished.
