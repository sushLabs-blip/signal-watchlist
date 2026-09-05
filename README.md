# Signal — a smart market watchlist

> Most watchlists answer "what's the price?" This one answers "what should I care about?"

Built for the brief: *create and manage a watchlist, view latest market info, return later
and see what changed.* This document explains what was built, why it was built that way,
and how to run it — including a straight path to Vercel.

---

## 1. The thesis

A watchlist that just shows live prices makes the user do all the work: scan every row,
remember what it looked like yesterday, guess whether a 2% move matters. That's not
tracking, it's homework.

Three decisions this app makes on the user's behalf:

| Decision | Why |
|---|---|
| Significance is relative to each stock's own normal behaviour, not a flat % threshold | A 2% move in a stable bank stock is a real signal. A 2% move in a small-cap is Tuesday. |
| The app has a hard cap on what it surfaces (5 items) | Attention is finite. A feed that never says "nothing changed" isn't doing its job. |
| Staleness is shown, never hidden | A four-hour-old price styled as live is a lie. In a finance product that's the worst class of bug. |

**The one behaviour everything else serves:** when nothing meaningful happened, the app
says so plainly instead of manufacturing content to fill the screen.

---

## 2. Architecture — the honest version, adapted for serverless

The original design for this product assumed a self-managed box: a persistent
TimescaleDB instance, an always-on NATS message bus, and long-running worker processes
polling the market continuously. That's the right architecture if you own the machine.

**Vercel doesn't give you a machine.** Functions are stateless, cold-started, and time
out. There is no place to run a background worker that stays alive between requests. So
the architecture below is deliberately different in its infrastructure layer while
keeping the same product logic — significance detection, staleness classification, and
the attention cap all still exist, they just live in different places.

```
┌─────────────────────────────────────────────────────────────┐
│  Vercel                                                      │
│                                                               │
│  ┌────────────────┐        ┌──────────────────────────────┐ │
│  │ Next.js app     │        │ API routes (serverless)      │ │
│  │ (App Router)    │───────▶│ /api/watchlist  /api/brief   │ │
│  │ React 19        │◀───────│ /api/instrument/[id]         │ │
│  │ Client polling  │  SSE   │ /api/ingest (cron target)     │ │
│  │  or SSE stream  │        └──────────────┬───────────────┘ │
│  └────────────────┘                        │                 │
│                                             ▼                 │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Vercel Cron → /api/ingest every 1 min                 │    │
│  │   fetches quotes → detects significance → writes DB   │    │
│  └──────────────────────────────────────────────────────┘    │
└───────────────────────────┬───────────────────────────────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Neon Postgres        │  (serverless, branchable,
                  │ (vanilla, no         │   works on Vercel's free tier)
                  │  Timescale extension)│
                  └─────────────────────┘
                             ▲
                  ┌─────────────────────┐
                  │ Upstash Redis        │  (serverless cache + rate limit,
                  │                       │   works on Vercel's free tier)
                  └─────────────────────┘
```

### What changed from a self-hosted design, and why

| Original (self-hosted) | Vercel version | Why |
|---|---|---|
| Self-hosted TimescaleDB, hypertables | **Neon Postgres**, plain tables + native partitioning if needed later | Vercel can't run Docker or a persistent DB process. Neon is serverless Postgres with a real free tier and a connection model built for edge/serverless functions. No Timescale extension is available here — same trap the original plan flagged for Supabase. |
| NATS + JetStream, browsers over WebSocket | **Polling (5–15s) or Server-Sent Events** from an API route | Vercel serverless functions can't hold a persistent WebSocket connection open indefinitely. SSE from an Edge function works for one-way server→client push and is enough for a watchlist (you don't need bidirectional low-latency ticks for this use case). |
| Always-on worker process polling the market continuously | **Vercel Cron** invoking an API route on a schedule (e.g. every 1 minute) | Cron on Vercel just hits an HTTP endpoint on a timer — no persistent process needed. This is the single biggest architecture simplification, and it's the correct one for this problem's actual latency requirements (a watchlist does not need sub-second ticks). |
| Redis + NATS KV | **Upstash Redis** (serverless, HTTP-based) | Same role (cache, rate limiting), but Upstash's client works over HTTP so it's compatible with serverless functions that can't hold long-lived TCP connections. |
| Bulk/local recorded-market replay for offline demo | Kept, unchanged | This still works — it's just static seed data loaded into Postgres on first deploy, no infra dependency. |

**What this costs you:** true tick-by-tick real-time (multiple updates per second) isn't
achievable on this stack — you get near-real-time (updates every 5–60 seconds, on your
polling/cron interval). For a watchlist product (not a trading terminal) this is the
right tradeoff: the product's value is in *what changed and why*, not sub-second price
ticks. If real tick-level latency becomes a requirement, add a managed real-time layer
(Pusher, Ably, or Supabase Realtime) in front of the same Postgres — the domain logic
underneath doesn't change.

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19 | Deploys natively on Vercel, zero config |
| UI | Tailwind CSS | Utility-first, fast to theme |
| Charts | lightweight-charts (TradingView OSS) | Renders candles + the "since you last visited" band |
| Client state | Zustand | Simple, no boilerplate for watchlist state |
| API | Next.js API routes / Route Handlers | Runs as Vercel serverless functions, no separate backend to deploy |
| Scheduled jobs | Vercel Cron | Replaces the always-on worker |
| Database | Neon Postgres (serverless) | Free tier, branchable, works with Prisma or Drizzle |
| ORM | Drizzle ORM | Lightweight, typed, works well with serverless connection pooling |
| Cache / rate limit | Upstash Redis | HTTP-based, serverless-compatible |
| Validation | Zod | Shared schema between API routes and client forms |
| Auth | NextAuth (Auth.js) with email or OAuth | Needed for cross-device sync of watchlists |
| Market data | A free-tier quote API (e.g. Twelve Data, Finnhub, or Yahoo-style polling) with a bundled recorded-data fallback | Live data is an enhancement, never load-bearing — see §6 |
| Deployment | Vercel | See §8 |

---

## 4. Data model (conceptual)

```
instrument         — canonical symbol identity (ticker + exchange), sector, name
watchlist          — belongs to a user, has an ordered list of instruments
watchlist_item     — instrument + optional user-set price threshold
price_snapshot     — (instrument_id, timestamp, price, volume, source, freshness)
significance_event — (instrument_id, detected_at, type, magnitude, explanation, confidence)
user_watermark     — (user_id, last_seen_at) — defines "since you last checked"
```

Key modelling decisions carried over from the original plan, still true here:

- **Instruments are keyed by a stable identity (exchange + symbol pair), not a bare
  ticker string.** Tickers get renamed; watchlist rows keyed on a mutable string
  silently break.
- **The watermark is a single monotonic timestamp per user, not per-item state.**
  Merging across devices is just `max()` — there's nothing to reconcile.
- **Every price row carries its own freshness**, computed at write time from the ingest
  cron's last successful run and the market calendar (live / delayed / stale / closed).
  The frontend never infers freshness from "how does this look" — it reads a field.

---

## 5. What counts as a "meaningful change"

Defined relative to each instrument's own recent behaviour, not an absolute threshold:

1. **Relative price move** — a move beyond N standard deviations of that instrument's
   own recent volatility, not a flat "moved more than 2%" rule.
2. **Volume anomaly** — volume unusual for that time of day, not just "high volume."
3. **User threshold crossed** — a price level the user personally set.
4. **Corporate action** — a split/bonus/dividend is surfaced as its own explained event,
   never as a false crash.
5. **Unexplained move flag** — if a move is significant and no cause can be attributed
   (see below), the app says "unexplained move on high volume" rather than guessing.

Every surfaced item on the Brief screen carries a plain-language reason, generated from
deterministic templates joined to structured facts (corporate filings, sector
performance) — **no LLM narration**. A model will confidently invent a reason for a move
that has no cause; in a finance product that's a credibility failure, not a feature.

---

## 6. Handling stale, delayed, and conflicting data

- **Freshness is a first-class field**, computed against the market calendar: live →
  delayed → stale → closed. It's attached to every price and rendered on every cell —
  never hidden behind a plain number.
- **Free-tier market data will occasionally fail or rate-limit.** The app degrades
  visibly (a banner: "showing delayed prices") rather than either crashing or silently
  showing wrong numbers.
- **Bundled recorded data is the offline default**, not a fallback bolted on later — the
  app is fully demoable and testable with zero live API keys.
- **Conflicting sources** (if more than one feed is used): prefer the higher-priority
  source; if two disagree beyond a tolerance, mark the fact `disputed` and never emit a
  significance event from disputed data until confirmed.

---

## 7. Scaling considerations

- **Personalization happens at read time, not write time.** Significance events are
  computed once, globally, by the cron job — ranking them for a specific user's
  watermark and watchlist is a cheap read. This means cost scales with the number of
  distinct instruments being tracked across all users, not with the number of users.
- **Cache the Brief response** keyed on `(user_id, watermark)` — it invalidates itself
  naturally since the key changes whenever the user's watermark advances.
- **Cursor-paginate** any endpoint returning an unbounded list (watchlist history,
  correction log).
- For larger watchlists, the ingest cron should prioritize which instruments to poll
  most often (recently volatile, widely watched, close to a user's threshold) rather
  than a flat round-robin — this becomes relevant well before it becomes urgent.

---

## 8. Deployment (Vercel)

1. Push this repo to GitHub.
2. Create a [Neon](https://neon.tech) project, copy the pooled connection string.
3. Create an [Upstash Redis](https://upstash.com) database, copy the REST URL and token.
4. In Vercel, import the repo. Set environment variables:
   ```
   DATABASE_URL=<neon pooled connection string>
   UPSTASH_REDIS_REST_URL=<...>
   UPSTASH_REDIS_REST_TOKEN=<...>
   NEXTAUTH_SECRET=<random string>
   MARKET_DATA_API_KEY=<optional — omit to run on bundled recorded data only>
   ```
5. Add a `vercel.json` cron entry (already in the repo) so `/api/ingest` runs on a
   schedule:
   ```json
   { "crons": [{ "path": "/api/ingest", "schedule": "*/5 * * * *" }] }
   ```
6. Deploy. First deploy runs migrations and seeds recorded market data automatically via
   a build-time script — no manual database setup step.
7. Visit the deployed URL — the app is populated and usable immediately, with no live
   market data account required.

**Local development** works the same way, against a local Postgres or a free Neon
branch: `pnpm install && pnpm dev`, with `.env.local` pointing at the same variables.

---

## 9. What was deliberately not built

Kafka, Kubernetes, microservices, ML price prediction, LLM-generated explanations, order
placement, portfolio P&L, social features. Each was either overkill for this problem's
actual scale, or actively wrong for a finance product (an LLM narrating "why" a stock
moved will confabulate a plausible-sounding lie when there is no real cause — that's
worse than saying nothing).

## 10. Honest weaknesses

- True sub-second real-time is not possible on this serverless stack — updates land on
  a polling/cron cadence (seconds, not milliseconds). Acceptable for a watchlist;
  not acceptable for a trading terminal.
- Free-tier market data APIs are rate-limited and occasionally unreliable — the app is
  designed to degrade honestly rather than hide this, but it does mean live data quality
  is genuinely lower than a paid feed.
- Significance detection thresholds are shipped with reasonable defaults, not tuned
  against a large labelled dataset — precision/recall should be measured against your
  own labelled sample before trusting the numbers in production.
