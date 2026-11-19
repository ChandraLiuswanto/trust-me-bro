# Scraper Repair and Coverage

Use when a scraper needs repair, a worker returns no changes, or a healthy run may be incomplete. A passing parser test proves neither discovery coverage nor production recovery.

## 1. Repair handoff contract

Record these fields before dispatching a repair. Mark unknowns explicitly rather than letting the worker invent defaults.

| Required field | What to record |
|---|---|
| Target | Site, endpoint, requested date/window, timezone, language/edition and expected record identity |
| Failure | Stage, timestamp, status/exception, sanitized response sample, last successful run and affected fleet fraction |
| Reproduction | Exact command, working directory, revision, configuration and saved fixture |
| Runtime | Interpreter/environment, available HTTP/browser tools, dependency versions and network access; never credentials |
| Authority | Exact writable files, prohibited operations, who can authorize a shared-code or scheduler change |
| Acceptance | Exact command with explicit date/window and timezone, independent expected IDs/count bounds, persistence checks and rollback condition |
| Budget | Maximum attempts, elapsed time and requests; the escalation destination when exhausted |
| History | Hypotheses already tested, evidence against them, artifacts and unresolved questions |

The coordinator must verify that its suggested command and final gate exercise the same date, configuration, runtime and scope. A default-today smoke test is not evidence for a historical-date repair.

## 2. Diagnose the failing stage

| Observation | Next discriminating check | Repair owner |
|---|---|---|
| Many sites fail together with resets, 5xx or pool timeouts | Compare timestamps and shared resources; bounded same-client probe, connection/pool telemetry | Transport/runtime owner, not automatically site config |
| Successful response lacks expected structure | Classify body, redirect target and content type; compare saved response with expected page | Fetch or parser owner, depending on evidence |
| Parser passes but IDs are missing | Reconcile discovery sets, pagination and date/language filters | Discovery owner |
| Records pass extraction but disappear | Follow identity through deduplication, filtering and database writes | Persistence/filter owner |
| Failed sites never run again | Trace actual recovery eligibility and queue transitions, including non-quarantined failures | Scheduler owner |
| Worker provider fails before generation | Inspect worker/provider outcome; no site diagnosis follows | Agent runtime owner |

Keep one hypothesis and one discriminating experiment per attempt. A valid later response weakens a persistent-block hypothesis; it does not prove all sites recovered. If the cause lies outside the writable files, return the evidence and request the correct owner instead of manufacturing a patch to satisfy a changed-files gate.

## 3. Worker outcome ledger

Record attempt ID, parent attempt, runtime/revision, stage reached, outcome, artifact paths, gate result and remaining uncertainty. Redact tokens and cookies.

- **Not executed / provider unavailable:** generation never began or no provider answered. Retry only within the runtime budget; do not label the site repaired or empty.
- **Executed, no diff:** inspect retained output and workspace identity. This may be a justified no-op, an incomplete attempt or a lost artifact; absence of a diff does not distinguish them.
- **Patch produced, rejected:** retain the diff and exact rejection: scope violation, test failure, requested-date failure or coverage gate. Rejection is not promotion.
- **Patch accepted:** the defined gate passed and the change was promoted. Record the gate's limits.
- **Recovery verified:** the actual intended run produced valid, persisted records with required coverage and freshness. Report unresolved sites separately.

Keep failed-attempt artifacts long enough for diagnosis under an access-controlled retention policy. Do not collapse provider failure, parse failure and a verified empty result into `[]` or one success boolean.

### Worker lifecycle contract

Persist the attempt's orchestrator handle, parent/child ownership, workspace identity, revision and runtime identity before dispatch. A PID alone is insufficient because it can be reused. On cancellation or SIGTERM, stop owned children through the orchestrator, await confirmed settlement within a deadline, and retain unresolved identities for reconciliation. Parent exit and a requested cancellation do not prove child exit.

On startup, reconcile recorded unsettled attempts with the runtime before restarting or promoting work. Fence stale attempts from publishing even if cancellation cannot be confirmed; do not kill a process whose ownership is uncertain. Promote only from the intended attempt/workspace after all its writers have settled and the acceptance gate passed.

**Synthetic lifecycle check:** in an isolated temporary workspace, have a fake child attempt a delayed artifact write, terminate its parent, then restart the coordinator. Assert that the child is either confirmed stopped or recorded as unresolved and fenced; its late artifact cannot be promoted, and no duplicate attempt publishes concurrently. Test this through the project's actual lifecycle interface without production credentials or network access.

## 4. Date, language and discovery completeness

1. Define the population: date interval in a named timezone, language/edition, content types and inclusion rules. Track original publication, edition publication, modification, first observation and collection times separately. Sitemap `lastmod` is not necessarily publication time.
2. Inventory discovery surfaces: bounded RSS, paginated listings, sitemap indexes and dated archives. Record truncation, pagination/cursor termination, source coverage and the last validation time. News-specific sitemaps may contain only recent material; they are not historical archives.
3. Compare stable ID sets within the same scope, not just counts. Explain `reference_ids - collected_ids` and `collected_ids - reference_ids`. A sitemap is another fallible source, not ground truth by definition.
4. Reconcile editions using publisher IDs or explicit links where available. Keep language and edition identity. Similar titles alone do not prove equivalence; an original-language article is not evidence its translation exists.
5. Measure translation/publication lag and use a bounded overlapping lookback with idempotent writes. Validate around local midnight and UTC conversion. Do not hard-code a universal 48-hour delay.
6. Probe deep pages and known older IDs. Distinguish real empty days from an expired feed window, missing archive enumeration, filter error or failed fetch. Report coverage as unknown when no defensible denominator exists.

**Prospective repair is not backfill.** A fixed discovery rule improves future runs; missing historical records require a separately scoped date range, source availability check, rate/cost budget and idempotent backfill. Do not erase historical failure flags merely because today's probe passed.

## 5. Acceptance example

A daily news collector targets `2026-10-10`, `Asia/Jakarta`, English edition. Its smoke command defaults to today and returns three valid articles. A dated archive exposes additional source IDs; some translations appear later.

Acceptance requires an explicit requested-date run, fixture tests for date boundaries and pagination, and an ID reconciliation for that edition. Record missing translations separately from missed existing English URLs. Re-run after the measured lag window, verify database rows and deduplication, and report unresolved coverage. Schedule any older missing interval as backfill rather than declaring it repaired by the three-row smoke result.

For a handoff, include the real project's executable command and flags; do not invent a CLI from this example.

## 6. Reusable repair evidence and rollout

Key reusable findings by site engine/platform, observed version or fingerprint, client/runtime version and failure stage. Retain the minimal reproducer, evidence, rejected hypotheses, accepted patch, validation date and scope. Store no session secrets. Similar engines suggest a candidate fix, not proof that sites share the same defect.

Before reuse, verify the target matches those preconditions and run its own fixtures and requested-scope acceptance checks. Canary on a small authorized target set; monitor persisted coverage, freshness, error rate and resource cost against a baseline. Promote gradually only within approved change scope, with a rollback path. Invalidate or re-test evidence after engine/client changes or contradictory results instead of repeatedly applying a stale recipe.

Source context: [architecture](https://web-scraping-guide.com/#arch).

## 7. Common mistakes

- Changing selectors to fix a connection failure or recovery queue omission.
- Widening an agent's write scope without authorization.
- Calling a site healthy because a worker exited successfully.
- Comparing today's feed count with a historical archive count.
- Using English and original-language article counts as interchangeable denominators.
- Replacing production data with an empty result caused by an unavailable provider.

See [production.md](production.md) for content gates and [data-sources.md](data-sources.md) for endpoint discovery.
