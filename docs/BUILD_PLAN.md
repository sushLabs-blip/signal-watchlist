# Smart Market Watchlist — Full Build Plan
### CODE by Groww · 72 hours · end-to-end

---

## 0. How to use this document

This is a **module map, not a spec**. Every module below defines *purpose, boundaries, inputs, outputs, key decisions, build steps, and done-criteria*. It deliberately contains **no schemas and no code** — those are implementation choices for whoever (or whatever) writes the code.

Rules while building:

1. **Modules are built in dependency order, not importance order.** M0–M5 are unglamorous and block everything.
2. **Every module has a "Done when" line. Do not move on until it's true.**
3. **Every module has "Defense notes."** These are the sentences you will say in the Top 40 / Top 20 rounds. If you can't say them honestly, you didn't build the module properly.
4. **At H+64, feature freeze.** The last 8 hours are for making it run on someone else's machine.

---

## 1. Product thesis

> Most watchlists answer *"what's the price?"* This one answers *"what should I care about?"*

Three commitments that everything downstream serves:

| Commitment | Consequence |
|---|---|
| Significance is relative to each stock's own behaviour, not an absolute % | Statistics module, not a threshold check |
| "Since you last checked" must be truthful even when data is later corrected | Bitemporal storage, watermarks |
| Attention is finite | Hard cap of 5 surfaced items; the app can say "nothing needs you" |

**The non-negotiable product behaviour:** when nothing meaningful happened, the app says so plainly and does not manufacture content.

---

## 2. Database decision — is TimescaleDB free?

**Yes, for your purposes. With one important trap.**

### The licensing reality

- **TimescaleDB Apache-2 Edition** — Apache 2.0. Fully open, no restrictions at all.
- **TimescaleDB Community Edition** — Timescale License (TSL). **Completely free when you manage your own service.** You may run it on-premises or on your own cloud infrastructure, modify the source, and use it in production. The *only* meaningful restriction is that you cannot resell it as a hosted Database-as-a-Service.
- Community Edition is where the good features live: continuous aggregates, compression policies, retention policies.
- Official Docker image exists. Company renamed from Timescale to **Tiger Data** in June 2025; docs now live under tigerdata.com.

**You are self-hosting in Docker. It is free. Full stop.**

### The trap: Supabase has dropped TimescaleDB

Do **not** plan on "Supabase + Timescale."

- Supabase's Postgres 17 bundle **no longer includes** `timescaledb` (along with `plv8`, `plls`, `plcoffee`, `pgjwt`).
- It was supported on Postgres 15 only, and that reached end of life around May 2026.
- Projects still on Postgres 14 get auto-upgraded, and **projects using removed extensions including `timescaledb` will be paused**.
- Supabase's official migration guidance is to convert hypertables to **native Postgres partitioning managed by `pg_partman`**.

Treat any other managed Postgres free tier the same way: **verify extension support before you depend on it.** Most serverless Postgres providers do not carry Timescale.

### The decision

**Primary: self-hosted TimescaleDB in Docker Compose.** Free, no account, works with no internet, judge-friendly.

**Provision: a storage-mode abstraction** so the app also runs on any plain Postgres free tier.

```
STORAGE_MODE=timescale   → hypertables, continuous aggregates, compression, retention
STORAGE_MODE=vanilla     → native declarative partitioning + scheduled rollup job
```

Same repository interface, two adapters. This is not busywork — it is a real architectural decision you can defend:

> *"Correctness never depends on a proprietary extension. Hypertables are a performance optimisation behind a feature flag, so the system runs on any Postgres. I found out the hard way that Supabase dropped the extension, and I didn't want a hosting decision to become a correctness decision."*

### Free-tier hosting options, ranked for this project

| Option | Timescale? | Verdict |
|---|---|---|
| **Docker Compose, local** | Yes | **Primary.** Zero cost, zero accounts, always works |
| **Single small VPS running the same Compose** | Yes | Best cloud provision. One box, one `docker compose up` |
| **Railway / Render / Fly** (Timescale as a container) | Yes | Works; free tiers are time- or resource-limited |
| **Tiger Cloud** (managed, by Tiger Data) | Yes | Free trial available; adds an account dependency |
| **Supabase / Neon / other serverless PG** | **No** | Only usable via `STORAGE_MODE=vanilla` |

---

## 3. Locked stack

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | Next.js 16.3+, React 19.2, React Compiler enabled, Turbopack |
| UI | Tailwind v4, headless component primitives, TanStack Virtual |
| Charts | lightweight-charts (TradingView open library) |
| Client state | Zustand with atomic per-symbol selectors |
| Cross-tab | BroadcastChannel API |
| Offline | IndexedDB operation log + service worker |
| Transport | NATS + JetStream; browsers connect over NATS WebSocket |
| Wire format | Protobuf, schema checked into the repo |
| API | Fastify + TypeScript |
| Workers | Same repo, separate entrypoints |
| DB | TimescaleDB (Community, Docker) with vanilla-Postgres fallback adapter |
| Cache | Redis + NATS KV for last-value |
| Migrations | SQL migration files, versioned, forward-only |
| Contracts | Zod schemas + `.proto`, shared package |
| Tests | Unit + property tests on the engine, one end-to-end journey |
| Observability | OpenTelemetry, Prometheus-format metrics, structured logs |
| Packaging | Docker Compose with profiles |

**Pin Next.js to a patched version.** There have been multiple React Server Components vulnerabilities in the 16.x line including a CVSS 10.0 remote-code-execution issue, with further critical patches shipped through August 2026. Pin explicitly in `package.json` and note it in the README — supply-chain awareness costs nothing and reads as maturity.

**Deliberately excluded:** Kafka, Kubernetes, microservices, ML prediction, LLM narration, order placement, portfolio P&L, social features. Each exclusion gets a line in `DECISIONS.md` with a stated threshold for when it would be justified.

---

## 4. Repository layout

```
apps/
  web/            Next.js frontend
  api/            Fastify — command + query
  feed/           market data gateway worker
  engine/         signal detection worker
  batch/          scheduled correctness jobs
  replay/         deterministic replay harness + CLI

packages/
  contracts/      Zod schemas, .proto, shared types
  domain/         pure business logic — statistics, detectors, ranking
  storage/        repository interfaces + timescale/vanilla adapters
  messaging/      NATS client wrapper, subject constants, codecs
  observability/  tracing, metrics, logging setup
  config/         env parsing, feature flags, validation

infra/
  compose/        docker-compose files + profiles
  migrations/     versioned SQL
  seed/           bundled recorded market data
  grafana/        dashboards

docs/
  README.md  DECISIONS.md  ARCHITECTURE.md  RUNBOOK.md  adr/
```

**The `domain` package must have zero I/O.** No database, no network, no clock reads. Pure functions taking inputs and returning outputs. This is what makes the signal engine property-testable and what lets you produce a measured accuracy number later.

---

# MODULES

---

## M0 — Foundation & Developer Experience

**Purpose:** make everything after this cheap. Also the module that decides whether a judge can run your submission.

**Owns:** monorepo config, Docker Compose, environment handling, migration runner, CI, task scripts.

**Key decisions**
- **Docker-first from hour zero.** Never "works on my machine, I'll containerise later."
- **Zero-credential default.** `docker compose up` must produce a fully working app with no API keys, no accounts, no internet.
- Compose **profiles**: `core` (db, cache, nats, api, web), `feed` (live providers), `obs` (grafana/tempo/prometheus), `full`.
- Environment schema validated at boot; the process refuses to start on bad config rather than failing mysteriously later.
- Migrations are forward-only, versioned, and run automatically on API boot in dev.

**Build steps**
1. Initialise monorepo, workspace packages, shared TS config, linting.
2. Write Compose with named volumes and healthchecks on every service. Dependent services wait on healthy, not just started.
3. Wire the migration runner and prove it runs from empty.
4. Add `make dev`, `make seed`, `make replay`, `make test`, `make chaos` — a judge should never need to read Compose to run something.
5. Create both storage adapters as empty implementations behind the interface now, so the flag exists from the start.
6. Add a "clean machine" verification script that wipes volumes, rebuilds from scratch, boots, and hits a health endpoint.

**Done when:** on a machine that has never seen the repo, with no network access to any market data provider, `docker compose up` yields a browsable application.

**Defense notes:** *"The submission requirement was that it actually works. I made the offline path the default path, not a fallback, because a judge on a laptop with no broker account is the realistic case."*

---

## M1 — Reference Data & Symbology

**Purpose:** establish the canonical identity of an instrument. Everything else keys off this.

**Owns:** instrument master, ISIN↔ticker mapping over time, sector and industry classification, index membership, market calendar.

**Key decisions**
- **ISIN is the primary key. Ticker is a time-bounded alias.** Tickers get renamed and reassigned; a watchlist keyed on a ticker string silently breaks when that happens.
- Symbol resolution is a function of `(ticker, exchange, as_of_date)` — never a bare string lookup.
- Market calendar covers trading days, session times, and holidays. It is consulted by every module that reasons about elapsed time.
- Sector classification drives the peer-comparison logic in M6, so it must exist before the engine.

**Build steps**
1. Define the instrument, symbology-alias, sector-map, index-membership, and calendar entities.
2. Seed from bundled reference files covering roughly 60–100 liquid NSE names plus indices. Breadth is not the goal; correctness is.
3. Implement the resolution service with an in-memory cache, refreshed on reference-data change events.
4. Implement calendar helpers: is-trading-day, next-session-open, trading-minutes-between-two-instants.
5. Handle the alias-change case explicitly and write a test for it.

**Done when:** you can resolve a ticker to an ISIN as-of any historical date, and "trading time elapsed" across a weekend returns the correct non-wall-clock answer.

**Defense notes:** *"I keyed on ISIN because tickers are mutable. If a company renames, every watchlist referencing the old string is quietly orphaned — and you don't find out for months."*

---

## M2 — Market Data Gateway

**Purpose:** talk to the outside world and hide how unreliable it is.

**Owns:** provider adapters, connection lifecycle, rate budgeting, scheduling, failure isolation.

**Key decisions**
- One **provider interface**; multiple adapters. Nothing downstream knows which provider is live.
- Adapters to build, in priority order:
  1. **Replay adapter** — reads bundled recorded ticks, deterministic, speed-controllable. *Build this first.* It is your test fixture, your demo engine, and your offline default.
  2. **Broker WebSocket adapter** — Angel One SmartAPI or Upstox. Both are free but require a demat account. **Start the KYC before you write any code; it is the only blocking external dependency in the whole build.**
  3. **HTTP polling adapter** — Yahoo-style, heavily cached, treated as degraded quality.
  4. **Synthetic adapter** — generated price paths with injectable shocks, for tests.
- **Adaptive, budget-aware scheduling** for polling providers. Do not round-robin. Prioritise by recent volatility, subscriber count, proximity to a user threshold, and time since last poll, drawn against a token budget matching the provider's published rate limit.
- **Per-provider bulkheads** — separate connection and concurrency pools, so a slow provider cannot starve a healthy one.
- **Circuit breaker** per provider with exponential backoff and jitter; half-open probes.
- **Singleflight coalescing** — N concurrent requests for the same instrument collapse to one upstream call.
- Providers are **hot-swappable at runtime**, which is what makes the chaos demo possible.

**Build steps**
1. Define the interface: subscribe, unsubscribe, fetch-quote, fetch-history, capability descriptor, health.
2. Build the replay adapter and the recorder that produces its input files.
3. Build the scheduler as a pure priority function plus a token-bucket executor.
4. Build the circuit breaker, bulkhead, and singleflight wrappers as composable decorators.
5. Add the broker WebSocket adapter once credentials exist.
6. Add the HTTP polling adapter with aggressive caching and honest quality labelling.
7. Emit per-provider health to the messaging bus.

**Done when:** you can kill the primary provider at runtime and the system fails over without dropping a subscription or restarting a process.

**Defense notes:** *"Scheduling is a priority problem, not a round-robin problem. Under a three-requests-per-second budget you poll volatile and watched instruments often and dead ones rarely — the scheduler allocates attention the same way the product does."*

---

## M3 — Normalisation & Data Quality

**Purpose:** turn hostile, inconsistent, occasionally wrong upstream data into trustworthy internal facts. **This module is where the "Edge Cases & Resilience" score is won.**

**Owns:** the ingest pipeline between raw provider payloads and stored facts.

**The pipeline, in strict order:**

1. **Decode & shape-validate** — reject malformed payloads loudly, with a counter.
2. **Identity resolution** — provider symbol → ISIN via M1. Unresolvable symbols are quarantined, not dropped silently.
3. **Monetary representation** — convert to integer minor units immediately. **Never floating point for money**, anywhere, ever.
4. **Out-of-order rejection** — per-instrument event-time high-water mark. Anything older is discarded. Providers replay and reorder more often than people expect.
5. **Bad-tick filter** — reject prices deviating beyond a wide multiple of recent volatility *unless* confirmed by a second independent observation within a short window. A single garbage print firing a "crashed 40%" alert destroys trust permanently.
6. **Multi-source reconciliation** — with two sources disagreeing beyond tolerance, mark `DISPUTED` and prefer the higher-priority feed; with three, take the median. **Never emit a significance event from disputed data** — hold until confirmed and show the disagreement rather than silently picking a winner.
7. **Freshness classification** — a state machine: live → delayed → stale → closed (per market calendar). Attached to the fact and carried all the way to the pixel.
8. **Bitemporal write** — every fact stored with *event time* (when it happened at the exchange), *ingestion time* (when we received it), and *knowledge time* (when this version became our belief). Corrections **supersede**; they never overwrite.

**Why bitemporality is load-bearing here, not academic:** the product's core claim is "here is what changed since you last looked." If a later correction silently rewrites a stored value, that diff is computed against a past that never existed. Bitemporal storage lets you ask *"what did we believe at 15:30 on Tuesday, which is what the user actually saw?"* — and it gives you a genuine feature for free: **telling the user when something you previously showed them was later corrected.**

**Build steps**
1. Define the internal canonical fact shape and the quality/confidence enums.
2. Implement each stage as an independently testable pure function; compose into a pipeline.
3. Instrument every stage with a rejection counter and a reason label.
4. Implement the supersede-vs-insert logic and the as-of read path.
5. Write adversarial tests: reordered ticks, duplicate ticks, a single wild outlier, two sources disagreeing, a tick arriving during a market holiday.

**Done when:** you can replay a deliberately corrupted feed and the system stores only defensible facts, with every rejection counted and attributable.

**Defense notes:** *"Three timestamps, not one. A correction that overwrites history turns the product's central claim into a lie, so corrections supersede and the user gets told."*

---

## M4 — Storage & Persistence

**Purpose:** durable state with an honest performance story.

**Owns:** repository interfaces, both storage adapters, retention, rollups.

**Key decisions**
- **Repository interfaces live in `packages/storage`; adapters implement them.** Nothing above this layer writes SQL.
- Data classes:
  - **Time-series**: raw ticks, candle rollups at several resolutions. High write volume, short retention for raw.
  - **Bitemporal facts**: superseding, append-heavy, queried as-of.
  - **Append-only user operation log**: never updated.
  - **Materialised read models**: rebuilt from the log, disposable.
  - **Reference data**: small, cached, slowly changing.
- **Timescale adapter** uses hypertables, continuous aggregates for rollups, compression policies for older data, and retention policies to expire raw ticks.
- **Vanilla adapter** uses native declarative partitioning with a scheduled rollup job and a partition-maintenance job.
- Raw ticks expire on a short horizon; rollups compress and persist. **Storage growth must be a bounded, stated number.**

**Build steps**
1. Define repository interfaces from the *consumers'* needs, not from the tables.
2. Implement the Timescale adapter with automatic rollup, compression, and retention.
3. Implement the vanilla adapter with equivalent semantics via partitioning plus a job.
4. Write one conformance test suite and run it against **both** adapters. This is what proves the abstraction is real rather than decorative.
5. Add a storage-growth estimator to the health surface.

**Done when:** the same conformance suite passes green against both adapters, and you can state storage growth per thousand instruments per day.

**Defense notes:** *"Hypertables are a performance optimisation behind a flag, not a correctness dependency. I discovered Supabase dropped the Timescale extension entirely, and I didn't want a hosting decision to become an architecture decision."*

---

## M5 — Messaging Backbone

**Purpose:** move data between processes and out to browsers, with routing, fanout and replay handled by infrastructure rather than by your code.

**Owns:** NATS topology, subject naming, codecs, delivery policies.

**Key decisions**
- **Subject-based pub/sub rather than a hand-rolled socket registry.** A per-socket subscription map is the first thing that falls over when one instrument becomes popular. Subject hierarchies give wildcard subscription, server-side fanout, reconnection and load balancing for free.
- **Hierarchical subject naming** across market ticks, market events, corrections, reference-data changes, per-user channels, and system health. Design the hierarchy once; wildcards must be useful at every level.
- **JetStream** for anything requiring durability or replay: events, corrections, the outbox.
- **NATS KV as a last-value cache** — this fixes a subtle bug almost every competing submission will ship: a user opening the app during a quiet period sees blank cells until the next tick, which could be minutes.
- **Binary encoding, not JSON.** Compact frames with a dirty-field bitfield so unchanged fields cost nothing, integer minor units for prices, and delta-encoded timestamps relative to session open. **Measure the reduction and put the number in the README.**
- **Snapshot-plus-delta protocol with sequence numbers.** On subscribe: full snapshot with a sequence. Then deltas. The client detects gaps by sequence and requests a fresh snapshot rather than guessing.
- **Conflation, not queuing, under backpressure.** For price state, a slow consumer should receive the *latest* value, not a backlog of stale ones — so buffer per instrument by overwrite and flush on an interval. For discrete events, **do not conflate**; those are facts and each one matters. Two policies for two data shapes.
- Browsers connect to NATS directly over WebSocket. No bespoke gateway process in the hot path.

**Build steps**
1. Define the subject hierarchy and freeze it in a shared constants module.
2. Define the wire schema; check the definition into the repo — it doubles as your schema registry.
3. Implement encode/decode with a round-trip property test.
4. Implement snapshot-plus-delta on the publisher and gap detection on the subscriber.
5. Implement conflation and the per-shape policy split.
6. Configure JetStream streams, retention and durable consumers.
7. Wire the last-value cache into the subscribe path.

**Done when:** a client subscribing during a completely silent period immediately renders correct values; and an artificially throttled client receives current prices rather than a backlog.

**Defense notes:** *"Market data is state, not events. Under backpressure you conflate by overwrite so a slow client gets the current price. Events are the opposite — those I never conflate, because each one is a distinct fact."*

---

## M6 — Signal Engine

**Purpose:** decide what counts as meaningful. **This is the core intellectual property of the submission.**

**Owns:** rolling statistics, move decomposition, all detectors, event emission.

**Key decisions**
- **Significance is relative, not absolute.** Normalise each move against that instrument's own recent volatility. A three-percent move means completely different things in a large-cap bank and a smallcap.
- **Decompose the move** into a market component, a sector component, and an idiosyncratic residual. **Surface the residual.** "This stock fell two percent but its sector fell more" is information; "this stock fell two percent" is not.
- **Volume must be compared against the same time-of-day bucket.** Intraday volume is strongly U-shaped; comparing mid-session volume to a flat daily average is simply wrong, and most implementations get this wrong.
- **Zero per-user work in this module.** Events are global facts about instruments, computed once, stored once. Personalisation happens at read time. This single decision is what decouples compute cost from user count.
- **Zero-allocation hot loop.** Pre-allocated numeric buffers indexed by instrument token; no object creation per tick, no closures in the inner loop. Shard by token across workers with a single writer per shard, so no locking.
- **Event-time processing with a watermark and a bounded lateness allowance**, not wall-clock processing.
- **Deterministic idempotency key** per event derived from instrument, type, time bucket and rounded magnitude, with a uniqueness constraint. Worker restarts and replays then cannot duplicate alerts.
- Events carry a **data-confidence level** inherited from M3. Disputed inputs never produce a confident event.

**Detector families to implement**

| Family | Detects |
|---|---|
| Relative price move | Move unusual against the instrument's own volatility |
| Idiosyncratic move | Residual after removing market and sector components |
| Volume anomaly | Volume unusual for that time-of-day bucket |
| Delivery-quality anomaly | High volume with high delivery share — accumulation rather than churn |
| Range break | New multi-month or 52-week extreme, with time since the last one |
| Session gap | Opening displacement beyond normal overnight variation |
| Streak / regime | Consecutive directional sessions beyond a threshold |
| Correlation break | Usually-correlated peer diverges |
| Institutional flow | Bulk or block deal recorded |
| Surveillance | Exchange surveillance flag, settlement-series change, derivatives ban |
| User threshold | A price the user personally set has been crossed |
| Corporate action | Split, bonus or dividend — **replaces** what would otherwise be a false crash alert |
| Correction | A previously-shown value was later revised |
| Upcoming | A scheduled event approaching, with historical reaction statistics |

**Build steps**
1. Build all statistics as pure functions in `packages/domain` — incremental variance, time-of-day baselines, beta estimation, extreme tracking.
2. Build the ring-buffer state layout and the sharded single-writer runtime.
3. Implement detectors one at a time, each with its own unit tests, each independently switchable.
4. Implement idempotent emission and the confidence-gating rule.
5. **Build the labelled evaluation set**: take one recorded session, hand-label roughly a hundred moments as meaningful or noise, and measure precision and recall.

**Done when:** the engine replays a recorded session deterministically, produces byte-identical output on a second run, and you have **a measured precision and recall number** with a confusion matrix.

**Defense notes:** *"Ask me how I know it isn't just noise, and I'll show you the confusion matrix rather than describing the formula. Precision is X percent at this threshold; here is exactly where it fails and why."*

> **This is the single highest-leverage thing in the entire build.** Every finalist will say "I used statistical thresholds." Almost none will have measured whether it works.

---

## M7 — Attribution Engine

**Purpose:** answer *why*. A change surfaced without a cause raises anxiety and sends the user to a search engine — you've asked a question and not answered it.

**Owns:** ingesting explanatory sources, joining them to detected events, scoring confidence.

**Key decisions**
- **Deterministic. No language model.** Attribution is a temporal join with a competing-explanation test, not a generation problem. A model inventing a plausible-sounding reason for a price move is a fatal credibility failure in a finance product.
- Explanatory sources, all free and structured: exchange corporate announcements, bulk and block deal records, delivery statistics, surveillance and settlement-series changes, corporate actions, index membership changes, scheduled corporate events.
- **The join:** for each significant event, look back over a bounded window for filings or records on that instrument, and classify by the announcement's own structured subject field.
- **The competing-explanation test:** before attributing to instrument-specific news, check whether the sector or index moved similarly. If it did, the correct attribution is "this is a market move," not a company story.
- **Confidence score** from time lag, source category, and exclusivity of the explanation.
- **When nothing is found, say so.** *"Unexplained move on unusually high volume"* is a more valuable and more honest output than a guess.

**Build steps**
1. Build ingesters for each source, writing into the bitemporal fact store with proper provenance.
2. Build the temporal join with a configurable lookback window.
3. Build the competing-explanation check using sector and index aggregates from M6.
4. Build confidence scoring and the explicit "unexplained" path.
5. Build deterministic natural-language templates for rendering. Templates, not generation.

**Done when:** replaying a session with known real-world news produces correct attributions on the events that had causes, and honest "unexplained" labels on the ones that didn't.

**Defense notes:** *"A language model would have produced a confident-sounding explanation for every single move, including the ones with no explanation. Mine says 'unexplained' and I think that's the more valuable output."*

---

## M8 — Correctness Path (scheduled)

**Purpose:** the streaming path is fast but lossy; the end-of-day official data is slow but authoritative. Real market data systems run both and reconcile.

**Owns:** scheduled ingestion of official files, baseline recomputation, corporate action adjustment, reconciliation.

**Key decisions**
- Official end-of-day data is the authority. Streaming output is **provisional** until reconciled.
- **Reconciliation emits correction events** where the provisional record was wrong. This is what closes the loop with M3's bitemporal model and produces the "we corrected something we told you" experience.
- **Corporate action adjustment is the highest-value edge case in the entire build.** A ten-for-one split makes a price fall by ninety percent; naive systems report a catastrophic crash and an absurd statistical reading. Correct handling requires back-adjusting stored history, recomputing volatility baselines, adjusting any user cost basis, and emitting a corporate-action event *instead of* a price-move event.
- Baseline recomputation is scheduled and idempotent — safe to re-run over any date range.
- Every job is resumable and records its own last-successful-watermark.

**Build steps**
1. Build official-file ingesters with checksum verification and idempotent upserts.
2. Build the baseline recomputation job: volatility, betas, average volumes, extremes.
3. Build corporate-action detection and the full back-adjustment cascade.
4. Build the reconciler: diff provisional against authoritative, emit corrections.
5. Build a job runner with locking, retry, and per-job observability.
6. Test the split scenario end to end: verify no false crash alert, verify baselines adjusted, verify the correct event type emitted.

**Done when:** injecting a corporate action into replay produces zero false alarms and one correctly-worded corporate-action card.

**Defense notes:** *"Streaming gives you speed and end-of-day gives you truth. Where they disagree, the user gets told. A split is the case that breaks naive systems — it looks like a ninety-percent crash and a forty-sigma event."*

---

## M9 — User State & Sync

**Purpose:** persist watchlists, thresholds, and — critically — **the watermark that defines "since you last checked."**

**Owns:** the append-only operation log, projections, sync protocol, watermark semantics.

**Key decisions**
- **User state is an append-only operation log, not mutable rows.** Watchlist edits, acknowledgements, snoozes, threshold changes — all appended.
- **The watermark is a monotonic counter.** Merging is `max()`, which is conflict-free by construction. There are no merge conflicts to reason about, ever.
- **Advance the watermark only on meaningful engagement**, never on page load. Opening the app for four hundred milliseconds and closing it must not burn unread state. Advance on explicit acknowledgement, on card expansion, or after a sustained foreground dwell.
- **Cross-device is server-authoritative**; reading on a phone marks it read on a desktop.
- **Cross-tab is client-local** via BroadcastChannel — acknowledging in one tab updates every other tab instantly, with no server round trip.
- **Offline**: operations buffer locally and replay on reconnect. Because operations are commutative and idempotent, replay is safe regardless of ordering.
- **Transactional outbox** so that appending an operation and publishing its effect are atomic.
- Read models are **projections** — disposable, rebuildable from the log. Include a rebuild command; being able to drop and rebuild a read model live is a strong demonstration.

**Build steps**
1. Define the operation vocabulary and its envelope, including client-supplied idempotency keys.
2. Build the append path with outbox publication in a single transaction.
3. Build the projector — idempotent, replayable, resumable.
4. Build the sync endpoint: client sends operations plus its sequence, server returns merged state plus new operations.
5. Build the client-side operation buffer with optimistic application and reconciliation on confirmation.
6. Build cross-tab propagation.
7. Build watermark advancement with the engagement rules.
8. Test: two clients, one offline, conflicting edits, reconnect, converge.

**Done when:** two browser windows stay in sync in real time; one can be taken offline, edited, and reconnected, converging without loss; and dropping the read model and rebuilding from the log yields identical state.

**Defense notes:** *"Watermark merging is `max()` on a monotonic counter, which is a conflict-free replicated data type in the trivial case — so device sync has no conflict resolution because it has no conflicts. And it only advances on engagement, because a four-hundred-millisecond app open shouldn't destroy your unread state."*

---

## M10 — Brief & Ranking Service

**Purpose:** turn global facts plus personal watermark into the ranked, capped answer to *"what should I care about?"*

**Owns:** the read path that composes the Brief, salience scoring, the attention budget.

**Key decisions**
- **All personalisation happens here, at read time.** Events are already computed. This module reads roughly a few dozen rows and ranks them in memory. **This is what makes cost scale with the market rather than with user count.**
- Salience combines: event-type weight, magnitude, recency decay, a per-user learned weight, a novelty penalty for already-acknowledged similar events, and optionally position weight where the user supplied a cost basis.
- **Hard cap on surfaced items.** Everything below the floor goes to a collapsed tray **with a visible suppression count**. Showing "nine changes suppressed as noise" proves the system made a judgement rather than failing to find anything.
- **The explicit empty state is a feature, not a fallback.** When nothing clears the bar, say so plainly.
- Per-user weights adjust from explicit feedback only — acknowledge, snooze, not-useful — and are **clamped to a bounded range**. This is honest, explainable personalisation. **Do not call it machine learning.** Saying *"it's a bounded multiplier on explicit feedback, because I had 72 hours and I'd rather ship something I can explain"* scores higher than an unexplainable model.
- Cache keyed on user plus watermark, so the cache invalidates naturally.
- **Forward-looking section** alongside the retrospective one — scheduled events in the coming week with historical reaction statistics. Everyone else will build a rear-view mirror only.

**Build steps**
1. Build the query: events for the user's instruments since their watermark, joined to attributions.
2. Build salience scoring as a pure function in `packages/domain` with unit tests.
3. Build budget application and the quiet-tray summary.
4. Build the feedback loop with clamped weight updates.
5. Build the forward calendar composition.
6. Build the as-of variant — the Brief as it would have appeared at an arbitrary past moment. This is both a feature and your debugging tool.
7. Cache and measure.

**Done when:** the Brief renders in well under a hundred milliseconds for a large watchlist, and the as-of variant reproduces exactly what a user would have seen at a chosen past time.

**Defense notes:** *"The hardest product decision was the cap. A feed would have been easier to build and worse to use. If nothing cleared the bar, the app says so — I'd rather it be trusted than busy."*

---

## M11 — API Layer

**Purpose:** the boundary. Thin, typed, and boring by design.

**Owns:** HTTP surface, authentication, rate limiting, validation, error contract.

**Key decisions**
- **Command and query separation is visible in the API shape.** Commands append operations; queries read projections. No endpoint does both.
- Validation from shared schemas — one definition, both sides.
- **Idempotency keys on every mutating request.** Retries are safe.
- Rate limiting per user and per IP.
- **Structured error contract**: stable machine-readable code, human message, correlation ID. Never leak internals.
- Cursor pagination on anything unbounded.
- Health endpoint reports **per-dependency status and per-source data freshness**, not just liveness. This is a twenty-minute build and an excellent screenshot.

**Build steps**
1. Scaffold with schema-derived validation and typed responses.
2. Implement authentication with refresh, and session-to-device mapping for sync.
3. Implement the command endpoints (thin — append and return).
4. Implement the query endpoints: brief, grid snapshot, instrument detail, history, search.
5. Implement idempotency, rate limiting, and the error contract as middleware.
6. Implement the rich health endpoint.
7. Generate API documentation from the schemas.

**Done when:** every endpoint is typed end to end from schema to client, retries are provably safe, and health reports staleness per source.

---

## M12 — Frontend Shell & Design System

**Purpose:** a product that looks considered rather than templated, without spending design time you don't have.

**Owns:** app shell, routing, theming, primitives, layout.

**Key decisions**
- **Three screens only.** The Brief (landing), the Watchlist grid, and Instrument detail. Resist a fourth.
- Establish tokens first: type scale, spacing, semantic colour. **Never encode meaning in colour alone** — direction needs a glyph or sign, both for accessibility and for the significant portion of Indian users with colour-vision deficiency.
- **Density is a product decision.** Financial users scan; give them comfortable and compact modes.
- Deliberate empty, loading, error and stale states for every surface. **The empty state on the Brief is the most important screen in the app** — it is where the product's thesis is most visible. Design it properly rather than leaving a default.
- Enable the React Compiler; keep manual memoisation only where measurement justifies it.
- Skeletons that match final layout, so nothing reflows.

**Build steps**
1. Define tokens and the primitive component set.
2. Build the shell, navigation, and theme switching.
3. Build every state variant for every surface as isolated components before wiring data.
4. Build the freshness indicator as a shared primitive — it appears everywhere.
5. Accessibility pass: keyboard navigation, focus order, live regions for updating values, contrast.

**Done when:** every screen has a designed empty, loading, error and stale state, and the app is fully keyboard navigable.

---

## M13 — Realtime Client Runtime

**Purpose:** keep the interface fluid while hundreds of values update several times a second. **This is where a Groww frontend engineer will probe hardest, and where most submissions will have nothing to say.**

**Owns:** the client-side data path from socket to pixel.

**Key decisions — three tiers**

1. **Decode off the main thread.** A Web Worker owns the connection, decodes binary frames, applies conflation, and posts batched updates using transferable buffers for zero-copy handoff. The main thread never parses bytes.
2. **Atomic state selection.** Subscribe per cell to the smallest possible slice, so a single instrument's tick re-renders exactly one cell rather than the table.
3. **Direct DOM writes for the hottest path.** Price cells bypass the framework entirely via refs, batched into a single animation frame. Reconciliation cost approaches zero for the highest-frequency updates.

Plus:
- **Virtualise the list** — render what's visible, not what exists.
- **Subscribe only to what's visible**, plus instruments with active user thresholds. Viewport-scoped subscription is the difference between a watchlist that scales and one that doesn't.
- Keep off-screen panels mounted-but-idle rather than unmounting and losing state.
- Sequence-gap detection triggering re-snapshot.
- **Visual change must be legible**: brief directional flash on update, with a reduced-motion preference respected.
- Graceful reconnection with visible connection state — never a silently dead socket.

**Build steps**
1. Build the worker: connection, decode, conflation, gap detection, batched posting.
2. Build the store shape and atomic selectors.
3. Build the virtualised grid.
4. Build the direct-DOM price cell with animation-frame batching.
5. Build viewport-scoped subscription management.
6. Build connection-state UI and reconnection.
7. **Profile it.** Record a session at full load and capture the frame-time number.

**Done when:** a two-hundred-instrument watchlist updating several times per second holds a stable frame budget on a mid-range laptop, **and you have the profiler screenshot**.

**Defense notes:** *"Decoding happens in a worker, the store is selected atomically per cell, and the price cells write to the DOM directly inside one animation frame. Here's the main-thread profile at two hundred instruments."*

---

## M14 — The Brief

**Purpose:** the screen that *is* the product.

**Owns:** the returning-user experience.

**Key decisions**
- **Lead with elapsed time and the honest count.** "You were away two days. Three things worth your attention. Nine changes suppressed as noise."
- Each card carries: what happened, how unusual it was **in plain language, not statistical notation**, the attributed cause or an honest "unexplained," and actions.
- **Never show sigma notation to a user.** The statistics drive ranking and phrasing, then disappear. A user with fourteen stocks does not know what a standard deviation is, and showing one builds a quant terminal for someone who wanted an answer.
- Actions per card: open, acknowledge, snooze, not-useful. Feedback is the personalisation input.
- The collapsed quiet tray lists what was checked and found normal — **this is reassurance, and reassurance is the product for the majority of users.**
- Forward calendar section below, showing what's scheduled.
- Correction notices are visually distinct and phrased as accountability, not as an error.

**Build steps**
1. Build the card component with all event-type variants.
2. Build plain-language phrasing templates per event type.
3. Build the header with elapsed trading time and suppression count.
4. Build the quiet tray.
5. Build the forward calendar section.
6. Build the empty state — with real care.
7. Wire feedback actions with optimistic updates.

**Done when:** a returning user immediately understands what changed, why, and whether they need to act — without seeing a single statistical term.

---

## M15 — Watchlist Grid

**Purpose:** the daily-use surface. Dense, live, honest.

**Owns:** watchlist management and the live table.

**Key decisions**
- Multiple watchlists, reorderable, offline-capable.
- **Every cell carries provenance.** Live with age, delayed with age, stale, or closed with the last close time. **A stale number styled as a fresh one is a lie, and in a finance product that is the worst possible bug.**
- **Default sort is by significance, not alphabetical and not by percentage change.** The default ordering is a product statement.
- Inline threshold setting per instrument.
- Row expansion for a compact preview without navigation.
- Bulk operations, import and export.

**Build steps**
1. Build watchlist CRUD wired to the operation log.
2. Build the virtualised grid with configurable columns.
3. Build the freshness-aware cell.
4. Build significance sorting and alternatives.
5. Build inline threshold editing.
6. Build the degraded-mode banner.

**Done when:** the grid never displays a number without its provenance, and remains fully usable with every upstream provider dead.

---

## M16 — Instrument Detail

**Purpose:** answer the follow-up question a Brief card raises.

**Owns:** the single-instrument view.

**Key decisions**
- **The chart carries a shaded band covering the period since the user last visited.** This is the visual proof of the entire product thesis — it makes an abstract idea concrete in one glance. Build this even if you cut something else.
- Event markers pinned to the timeline, clickable through to their attribution.
- An attribution panel showing sources with timestamps and confidence.
- Move decomposition displayed visibly: how much was market, how much was sector, how much was specific to this instrument.
- Full provenance and correction history for the instrument.
- Relevant scheduled events with historical reaction statistics.

**Build steps**
1. Integrate the chart with candle data at multiple resolutions.
2. Build the since-last-visit band.
3. Build event markers and their interaction.
4. Build the attribution panel.
5. Build the decomposition visual.
6. Build the correction history view.

**Done when:** clicking any Brief card lands on a detail view that fully answers "why," including honestly answering "we don't know" where that's the truth.

---

## M17 — Observability & SLO

**Purpose:** be able to answer "how do you know?" with a number rather than an adjective.

**Owns:** tracing, metrics, logging, dashboards, service objectives.

**Key decisions**
- **The headline metric is tick-to-glass** — the span from exchange timestamp to painted pixel. It is the only latency number that means anything to a user. Instrument it as a distribution and report percentiles.
- Trace context propagates through the message bus, not just HTTP, so a single trace covers ingest through render.
- **Data-quality metrics are first-class**: rejections by reason, disputed facts, corrections issued, per-source freshness, gap detections.
- Signal-engine metrics: throughput, per-detector latency, events emitted by type, suppression ratio.
- **Define an explicit freshness objective with an error budget**, and show current burn.
- Structured logs with correlation IDs; no unstructured logging anywhere.
- Bundled dashboards in the repo so a judge sees them without configuring anything.

**Build steps**
1. Wire tracing across all services including bus propagation.
2. Implement the tick-to-glass span, including the client-side terminal segment.
3. Implement metric collection across all modules.
4. Build dashboards and commit them.
5. Define objectives and implement budget tracking.
6. Add a load-generation script so the dashboards have data during a demo.

**Done when:** you can state tick-to-glass median and ninety-ninth percentile from your own dashboard, live.

---

## M18 — Chaos & Resilience Verification

**Purpose:** prove resilience by demonstration rather than assertion.

**Owns:** fault injection and the degradation ladder.

**Key decisions**
- **A runtime chaos API** — inject provider latency, kill a provider, inject a bad tick, force out-of-order delivery, partition a dependency, force source disagreement.
- **A defined degradation ladder**, each level visible in the UI: full → delayed → cached-only → read-only → static. **Never a blank screen and never a spinner of death.**
- Chaos is **enabled by an explicit flag** and prominently disabled by default.

**Build steps**
1. Build the injection interface as decorators over provider and storage clients.
2. Build the control endpoints behind the flag.
3. Define and implement each degradation level with its UI treatment.
4. Build an automated resilience suite that runs each scenario and asserts the ladder behaved.
5. Write the chaos demo script into the runbook.

**Done when:** you can break any single dependency live, on camera, and the app degrades visibly and recovers automatically.

**Defense notes:** *"Rather than describe resilience, let me break it. Which dependency would you like me to kill?"* — no other submission will offer this.

---

## M19 — Replay & Demo Harness

**Purpose:** determinism for tests, drama for demos, independence from live providers.

**Owns:** recording, replay, seeding, time travel.

**Key decisions**
- **Record real sessions to bundled files.** Real market data is more convincing than synthetic, and it makes your evaluation set legitimate.
- Replay supports variable speed, pause, seek and loop.
- **Seed a demo account whose watermark is set days in the past**, so the Brief is rich on first paint. **Never show a judge an empty state on load.**
- **Time travel**: render the app as of any past moment. This is simultaneously a feature, a debugging tool, and a demo device — it lets you show "you were away six hours" without waiting six hours.
- Scripted scenarios: a normal quiet day, a volatility event, a corporate action, a provider outage, a data correction.

**Build steps**
1. Build the recorder as a passive tap on the ingest pipeline.
2. Build the replay adapter with full transport controls.
3. Record and commit several sessions including at least one dramatic one.
4. Build the seeding command producing the demo account and watermark.
5. Build time travel end to end.
6. Script and rehearse each scenario.

**Done when:** a fresh clone plus one command produces a populated, compelling application state with no network access.

---

## M20 — Deployment

**Purpose:** it must run on someone else's machine. This is a stated submission requirement.

**Owns:** packaging, composition, cloud provision, operational docs.

### Docker composition (primary)

- **Multi-stage builds**, non-root users, minimal final images, `.dockerignore` discipline.
- **Profiles**: `core` for the offline default; `feed` for live providers; `obs` for the observability stack; `full` for everything.
- **Healthchecks on every service.** Dependent services wait on healthy, not merely started — this is the difference between a clean first boot and a confusing crash loop.
- Named volumes with sensible defaults; a documented reset command.
- Resource limits declared so it behaves on a modest laptop.
- **Migrations and seeding run automatically on first boot.** A judge should type one command and be looking at a working product.
- Boot time is a feature. Target under two minutes cold on a laptop; state the measured number in the README.

### Cloud provision (optional but designed for)

- **Same Compose file, one small VPS.** This is the recommended path — it keeps the local and deployed environments identical, which means the deployed environment cannot surprise you at hour seventy.
- A container-platform variant (Railway, Render, Fly) with per-service definitions for platforms that don't accept Compose directly.
- **Storage mode flag** enables managed-Postgres hosting for platforms without the Timescale extension — this is the provision that makes Supabase or similar viable.
- Externalised configuration; no baked-in secrets; a documented environment matrix.
- Optional persistent-volume configuration for the message bus where the platform supports it.

**Build steps**
1. Write Dockerfiles for each service; optimise layer caching for fast rebuilds.
2. Write the Compose files with profiles and healthchecks.
3. Build the automatic migrate-and-seed boot path.
4. **Verify on a genuinely clean machine** — fresh volumes, no cache, no network to any provider.
5. Write the cloud variant and deploy once to prove it.
6. Write the runbook: start, stop, reset, common failures, how to enable live data, how to run chaos.

**Done when:** a person who has never seen the repository runs one command and, within two minutes, is looking at a working, populated application.

---

## M21 — Submission Package

**Purpose:** the artefacts that are actually judged.

**Required by the brief:** source code as a repository or archive, a README with clear setup instructions, and **a hundred-word product pitch**.

**Owns:** documentation and narrative.

- **README** — what it is, the setup instructions that actually work from a clean clone, the demo path, and where to look for the interesting parts. Keep it short and functional.
- **DECISIONS.md** — the most important document in the submission. Structure as decision records: context, options considered, choice, consequences, and when you would revisit. Cover at minimum: significance as relative rather than absolute; ISIN over ticker; bitemporal storage; subject-based messaging over a socket registry; binary over JSON; conflation over queuing; the attention cap; **why no Kafka**; **why no language model**; storage-mode abstraction; and a frank list of what you deliberately did not build.
- **ARCHITECTURE.md** — the diagram and the data-flow narrative.
- **RUNBOOK.md** — operating it, including the chaos demo.
- **The hundred-word pitch** — write this last, in your own voice, and be prepared to expand every single sentence of it under questioning.
- **The measured numbers**, collected in one place: tick-to-glass percentiles, wire-size reduction, engine throughput, frame time under load, and **detector precision and recall**.

**Done when:** someone can understand what you built, why you built it that way, and how to run it, without you present.

---

# BUILD ORDER

Modules in dependency order, mapped to the 72 hours. Parallelisable seams marked `‖`.

### Before hour zero
**Start the broker KYC.** It is the only blocking external dependency and it gates M2's live adapter.

### Day 1 — Foundations (0–24h)

| Hours | Modules | Outcome |
|---|---|---|
| 0–2 | M0 | Compose boots, deployed skeleton |
| 2–5 | M1, M4 (interfaces) | Identity and storage contracts exist |
| 5–9 | M2 (replay + interface), M3 | Clean facts flowing from recorded data |
| 9–13 | M5 | Messaging backbone, binary codec, snapshot+delta |
| 13–17 | M6 (statistics + first detectors) | First real events emitted |
| 17–21 | M9, M11 | User state, sync, API surface ‖ M12 shell |
| 21–24 | M15, M13 (basic) | **Checkpoint: working live watchlist. Tag it. This is insurance.** |

### Day 2 — Differentiation (24–48h)

| Hours | Modules | Outcome |
|---|---|---|
| 24–28 | M10 | Brief service, ranking, attention budget |
| 28–32 | M14 | **The Brief UI — first moment the thesis is visible** |
| 32–36 | M8 | Correctness path, corporate actions, baselines |
| 36–40 | M7 | Attribution engine |
| 40–44 | M6 (remaining detectors) | Full detector coverage ‖ M16 detail view |
| 44–48 | M16, M19 | Detail view complete, replay harness, seeded demo |

### Day 3 — Depth & defence (48–72h)

| Hours | Modules | Outcome |
|---|---|---|
| 48–52 | M13 (full) | Worker decode, direct DOM, profiled |
| 52–56 | M17, M18 | Observability, SLO, chaos API, degradation ladder |
| 56–60 | M6 (evaluation) | **Labelled set, precision and recall measured** |
| 60–64 | M2 (live adapter), M4 (vanilla adapter) | Live data ‖ storage conformance both modes |
| 64–68 | M20 | **FEATURE FREEZE.** Clean-machine verification, cloud deploy |
| 68–71 | M21 | Documentation, pitch, numbers collected |
| 71–72 | — | Submit. Buffer. |

---

# RISK REGISTER

| Risk | Likelihood | Mitigation |
|---|---|---|
| Broker KYC not approved in time | High | Replay is the default path; live is an enhancement. Nothing blocks. |
| Free data source blocks your IP | High | Bundled recorded data; live sources labelled degraded, never load-bearing. |
| Judge can't run the submission | Medium | **Fatal if it happens.** Clean-machine verification at H+64 and again at H+70. |
| Signal engine tuning consumes the schedule | Medium | Ship default parameters at H+40; tune only inside the evaluation window. |
| Frontend performance work overruns | Medium | Tier 1 and 2 are sufficient. Tier 3 is optional polish. |
| Scope creep | High | Three screens. Feature freeze at H+64 is absolute. |
| Cannot defend something you shipped | Medium | If you cannot explain a module in the Top 20 round, **cut it**. Unexplainable code is a liability, not an asset. |

---

# DEFENCE PREPARATION

Expect these. Have answers with numbers.

- *Why is a two-percent move meaningful for one stock and not another?* → relative volatility normalisation, with a worked example.
- *How do you know your detector isn't just noise?* → the confusion matrix.
- *What happens when your data source lies?* → the M3 pipeline, stage by stage.
- *What happens on a stock split?* → M8, demonstrated live in replay.
- *Why not Kafka?* → stated throughput threshold for switching.
- *Why not use a language model to explain moves?* → because it would confabulate, and in finance that is fatal.
- *How does the UI not die at two hundred instruments?* → the profiler screenshot.
- *What breaks first at ten times the users?* → name the component and the shard key.
- *What did you deliberately not build?* → have eight items ready.
- *Where is this wrong?* → **name two real weaknesses unprompted.** Nothing builds credibility faster.
- *Would you use this?* → have a real, personal answer.

---

## The three things that matter most

If everything slips, protect these:

1. **M6's measured evaluation.** Precision and recall on a labelled set. Nobody else will have it.
2. **M0 + M20's clean-machine guarantee.** A submission that doesn't run scores zero regardless of what's inside it.
3. **M14's empty state.** The screen where the app tells you nothing needs your attention is the clearest expression of the product's thesis, and it is the one thing no competitor will have the nerve to build.
