# GigSetu — India's Cooperative Workforce Operating System

> **Positioning:** *GigSetu doesn't fight the gig economy — it organizes it.* A single digital operating system that turns informal gig workers into members of registered cooperative societies, giving them identity, welfare, fair pricing and collective bargaining power, while giving customers an instant, transparent, on-demand service experience.

A Smart India Hackathon prototype that models the full cooperative workforce ecosystem end to end: a household customer books a verified plumber/electrician/cleaner in seconds; the booking is matched, priced, dispatched and settled through the worker's **primary cooperative society**; societies roll up into **talukas → districts → state/national federations**; and every governance-relevant mutation — pricing policy, AI weights, complaint lifecycles, capacity exchanges — is written to a transparent **audit log** whose actor is resolved from a **signed session cookie**, never from the request body.

Everything runs on **one Next.js route (`/`) + an API layer (`/api/*`) + one shared SQLite database** — every role looks at the same live data, so a booking created by the customer immediately appears on the worker's phone, the cooperative's register, the district dashboard and the audit trail.

---
## Prototype Has Been Deployed To Vercel
If You Want A Quick View How The Prototype Actually Works (DEMO MODE SUPPORTED) You Can View It On :
https://sih-prototype-self.vercel.app/

## Quickstart

```bash
# Node 20.9+ (npm, pnpm or bun all work)
npm install                 # postinstall runs `prisma generate` automatically
cp .env.example .env        # then set AUTH_SECRET (see below)
npm run setup               # prisma generate + db push + full seed (idempotent)
npm run dev                 # http://localhost:3000
```

`npm run setup` is safe to re-run at any time — the seed clears every table in
foreign-key order and rebuilds the whole demo dataset.

### Environment variables

Everything is documented in **`.env.example`**.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `file:../db/custom.db` locally, or `libsql://…` on serverless (see below) |
| `AUTH_SECRET` | yes | HMAC key for the signed session cookie. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATABASE_AUTH_TOKEN` | serverless only | Turso/libSQL auth token |
| `GEOAPIFY_*_KEY` | no | Five optional map products; offline fallback otherwise |

Check any environment at runtime with **`GET /api/health`** — it reports which
variables are present (never their values) and returns `503` with a fix if the
database is unreachable. The UI shows a banner for the same condition.

---

## Deploying to Vercel

> **Read this before deploying.** A `file:` SQLite database **cannot** run on
> Vercel. Serverless instances have a read-only filesystem that is not shared
> between them, so the file is neither writable nor present. Every API route
> will fail. The app detects this and says so, but you still need a real
> database.

The schema and every query are plain SQLite, so a **libSQL / Turso** database
works with no code and no query changes — only the transport is different
(handled automatically by `src/lib/db.ts`).

**1. Create a free database in the browser (~2 min)**

Go to **https://app.turso.co** → sign in with GitHub:

1. **Create database** → copy the `libsql://…` URL it shows
2. **Settings → API Tokens → Create Token** → copy the token (shown once)

> The Turso CLI is deliberately *not* part of this flow. As of `turso-cli`
> v1.0.32 the published binaries are macOS/Linux only — there is no Windows.
> build, and the docs tell Windows users to install WSL first. The
> `turso_cli-installer.ps1` in the `tursodatabase/turso` repo installs
> `tursodb.exe`, which is the *embedded* database and has no `db create`
> subcommand at all. The dashboard avoids all of that.

**2. Push the schema and seed it, once, from your machine**

```bash
npm run db:push-remote      # pastes the URL + token, then pushes, seeds and verifies
```

It validates the URL, tests connectivity, creates the schema, seeds the full
demo dataset, then re-verifies and prints the exact Vercel variables.

> **`prisma db push` cannot target a `libsql://` URL.** The Prisma CLI only
> accepts `file:` for the sqlite provider and rejects the URL during config
> validation (P1012) — the driver adapter that makes libSQL work is a *runtime*
> concern the CLI does not know about. So the schema is created by generating the
> DDL locally and executing it over the wire:
>
> ```bash
> npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
> # → 25 CREATE TABLE + 3 CREATE UNIQUE INDEX, applied via @prisma/adapter-libsql
> ```
>
> `prisma/seed.ts` selects its client the same way the app does, so the identical
> seed runs against a local file or a remote libSQL database.

**3. Add environment variables in Vercel**

Project → **Settings → Environment Variables** (add to *all* environments, then
redeploy — changing env vars does not rebuild an existing deployment):

| Key | Value |
|---|---|
| `DATABASE_URL` | `libsql://your-db.turso.io` |
| `DATABASE_AUTH_TOKEN` | your Turso token |
| `AUTH_SECRET` | a 96-char random hex string |
| `GEOAPIFY_*_KEY` | *(optional — the demo falls back to the built-in grid)* |

**4. Verify the deployment**

```bash
curl -i https://your-app.vercel.app/api/health
```

`200` with `"status":"healthy"` means it is wired up. A `503` response names the
exact variable to set.

> `.env` is gitignored on purpose, so it is **not** deployed. That is why a
> fresh Vercel deploy has no `DATABASE_URL` until you add it above. Never commit
> real keys.

### Other hosts

Anything with a writable, persistent filesystem (a VPS, Railway with a volume,
Docker) works with the plain `file:../db/custom.db` — no adapter involved.

### Optional: GeoApify (spec §42)

Five per-product keys, all optional. Copy them into `.env`:

```
GEOAPIFY_AUTOCOMPIFY_KEY=        # Address Autocomplete  -> /api/geo/autocomplete
GEOAPIFY_GEOCODING_KEY=          # Geocoding             -> /api/geo/geocode
GEOAPIFY_REVERSE_GEOCODING_KEY=  # Reverse Geocoding     -> /api/geo/reverse
GEOAPIFY_ROUTE_MATRIX_KEY=       # Route Matrix          -> /api/geo/route-matrix
GEOAPIFY_ROUTING_KEY=            # Routing               -> /api/geo/route
GEOAPIFY_ENABLED=1               # set to 0 to force the offline fallback
```

**The demo never depends on them.** Every GeoApify call has a 6 s timeout and
falls back to a deterministic built-in Pune service grid, so an offline judging
hall, a missing key or a rate limit degrades gracefully instead of breaking.
The UI tells you which source answered (`Verified by GeoApify` vs
`Offline service-grid fallback in use`).

When keys are present, real road distance and turn-by-turn duration replace the straight-line estimate in the matching engine, and the customer's booking flow gets type-ahead address search plus a working "use current location" (reverse geocoded to a named locality, not thrown away).


---

## Verification

```bash
npm run verify     # typecheck + lint + static audit + production build
npm run db:seed    # re-seed (idempotent)
npm run e2e        # 114-assertion end-to-end check (needs the dev server running)
npm run audit      # static audit only: routes + UI wiring
```

`scripts/e2e-verify.ts` exercises the full spec §87 path plus every security
control: role escalation, price manipulation, rating without payment,
notification ownership, privileged operations, the negotiation floor, the
WhatsApp mass-assignment attempt, and all five GeoApify products.

It also contains two sections that exist because real bugs shipped past a green
suite:

* **§1b client sign-in contract** — every role button, the role switcher, the
  platform console and the demo launcher sign in through `POST /api/auth`. They
  once used `GET /api/session?role=X`, which was closed down as a
  privilege-escalation oracle, so the UI silently received `{ user: null }` and
  every button failed. These assertions fail loudly if that regresses.
* **§14 the 16-step SIH demo walkthrough** — replays exactly the API sequence the
  client-side demo engine performs when a judge clicks **START SIH DEMO**, so a
  broken step is caught even though the engine itself is a React component.

### Static audits

| Command | Checks |
| --- | --- |
| `npm run audit:routes` | every `api.*()` call in the client resolves to a real route (no 404 buttons) |
| `npm run audit:ui` | dead `<Button>`s, `async` handlers with no `catch`, and `t('key')` calls with no translation defined |
| `npm run audit:handlers` | resolves `onClick={name}` references and verifies each `async` one catches |

`audit:ui` and `audit:handlers` exist because the original failure mode was a
silent one: an `async` `onClick` that rejected, swallowed by a generic toast that
named the wrong culprit. Run them after adding UI.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser — single route "/"                                              │
│  app-shell.tsx: client view router (Zustand view state, no /app routes)  │
│    login-screen → customer · worker · coop · taluka · district ·         │
│    state · national · government · hierarchy · exchange · ai ·           │
│    whatsapp · platform (6 tabs incl. Audit & Transparency) · map         │
│  TanStack Query for server state · i18n (en/mr/hi) · dark mode           │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ fetch /api/* (same-origin, httpOnly session cookie)
┌───────────────┴──────────────────────────────────────────────────────────┐
│  Next.js route handlers — src/app/api/* (60 routes, see API table below)   │
│  src/proxy.ts    edge guard: CSRF + session-cookie presence               │
│  src/lib/http.ts  every handler's guard: zod, roles, safeJson, rate limit  │
│  Domain logic in src/lib/* (booking-engine, matching, pricing, fees,      │
│  economics, welfare, trust, reputation, audit, forecast, geoapify, wa-bot) │
│  z-ai-web-dev-sdk server-side only, always with a deterministic fallback  │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ Prisma Client
┌───────────────┴──────────────────────────────────────────────────────────┐
│  SQLite (db/custom.db) — prisma/schema.prisma (25 models)                 │
│  Federation → District → Taluka → Cooperative → Worker → Booking →         │
│  Payment/Rating/Complaint · Exchange · Welfare · Training · TrustReport    │
│  AuditLog · GovRegistration · config tables (FeeConfig, EconomicsConfig,   │
│  MatchWeightConfig, HierarchyLevelConfig, IntegrationRegistry)            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Session + RBAC (spec §47).** Two layers. The edge `proxy` rejects cross-site
mutations and requires a session cookie. Inside each handler,
`requireMutationFor(req, 'COOP_ADMIN')` verifies the HMAC, resolves the actor
and enforces the role hierarchy (`CUSTOMER < WORKER < COOP_ADMIN < TALUKA_COORD
< DISTRICT_COORD < STATE_ADMIN < NATIONAL_ADMIN < PLATFORM_ADMIN`) plus
ownership. Demo logins use **mock credentials by design**, but the cookie is a
real trust boundary: `GET /api/session?role=PLATFORM_ADMIN` no longer returns an
identity, and the role switcher can only assume roles the current session is
allowed to assume.

**Booking simulation.** The lifecycle is time-accelerated server-side — a fetch
of a booking "ticks" it forward (auto-accept ≈ 8 s → on the way → in progress →
completed), so a demo audience watches a job move through the cooperative network
in about a minute without touching a clock.

### Module map (spec §59)

| Module | Where it lives |
|---|---|
| **Auth / RBAC** | `src/lib/session.ts` · `src/lib/identities.ts` · `src/lib/http.ts` · `src/proxy.ts` · `src/app/api/auth/route.ts` · `src/app/api/session/route.ts` |
| **Users (workers & customers)** | `src/app/api/{workers,worker,customers}/**` · `src/components/gigsetu/worker/*` |
| **Cooperatives** | `src/app/api/{coop,cooperatives}/**` · `src/components/gigsetu/coop/*` · `src/lib/{reputation,verify,procurement}.ts` |
| **Workers (matching & trust)** | `src/app/api/match` · `src/lib/matching.ts` · `src/app/api/{trust,reputation}` · `src/lib/trust.ts` |
| **Services (catalog & pricing)** | `src/app/api/categories` · `src/lib/pricing.ts` (rate card, skill level, travel, material, urgency, cooperative policy) |
| **Bookings (engine & lifecycle)** | `src/app/api/bookings/**` · `src/lib/booking-engine.ts` · `src/app/api/{quotes,negotiations,ratings,service-requests}` |
| **Payments** | `src/app/api/payments` · `src/lib/fees.ts` (configurable 4-way split) · `src/lib/earnings.ts` |
| **AI** | `src/app/api/ai/{analyze,allocate,forecast,skill-gap,maintenance,emergency,wa-bot,weights}` · `src/lib/{forecast,skill-gap,maintenance,emergency,matching}.ts` |
| **Geo** | `src/lib/geoapify.ts` (5 GeoApify products + offline grid) · `src/app/api/geo/**` · `src/lib/geo.ts` · `src/components/gigsetu/shared/geo-map.tsx` |
| **Welfare** | `src/app/api/welfare` · `src/lib/welfare.ts` · worker + coop welfare wallets |
| **Federation & hierarchy** | `src/app/api/{hierarchy,districts,talukas,federation/analytics}` · `src/components/gigsetu/hierarchy/*` · `src/app/api/exchange` |
| **Analytics** | `src/app/api/admin` · `src/lib/admin-overview.ts` · `src/components/gigsetu/shared/analytics-kit.tsx` |
| **Notifications** | `src/app/api/notifications` · `src/components/gigsetu/shared/notification-center.tsx` |
| **WhatsApp** | `src/app/api/ai/wa-bot` · `src/lib/wa-bot.ts` · `src/components/gigsetu/customer/whatsapp-bot.tsx` |
| **Audit & transparency (§57)** | `src/lib/audit.ts` · `src/app/api/audit` · "Audit & Transparency" tab in `platform-admin.tsx` |
| **Complaints & disputes (§58)** | `src/app/api/complaints` · complaints tab in `coop-app.tsx` · `components/.../booking-detail.tsx` |
| **Governance actions** | `src/components/gigsetu/hierarchy/governance-actions.tsx` (complaint ACK, training sanction, mutual-aid request) |

---

## Demo identities (9 roles)

No passwords — one click signs you in to that role's seeded identity through
`POST /api/auth`, which sets the signed session cookie.

| Role | Identity | What to try |
|---|---|---|
| **Customer** | Anita Deshmukh (household, Kothrud) | Book a plumber, watch the live lifecycle, pay, rate with factors, file a complaint |
| **Worker** | Rajesh Kumar (electrician, Pune Electrical Coop) | Accept/decline jobs, availability, skill passport, welfare wallet, training, trust report |
| **Coop Admin** | Sunita Patil (Pune Electrical Labour Cooperative) | 14 tabs: utilization, complaint ladder, pricing policy, reputation, procurement, economics |
| **Taluka Coordinator** | Vikram Jadhav (Haveli) | Zone demand, skill gaps, **governance actions** (acknowledge, sanction training, request mutual aid) |
| **District Coordinator** | Meera Kulkarni (Pune) | Command center, capacity comparison, exchange approval, governance actions |
| **State Admin** | Adv. Rohit Deshmukh (Maharashtra federation) | State-wide intelligence, district drill-downs, welfare coverage |
| **National Admin** | Dr. V. R. Iyer (national apex) | National aggregates across states |
| **Institution** | St. Mary's Boys Hostel | AMC contracts, bulk/recurring requests, preventive maintenance |
| **Platform Admin** | GigSetu Ops | 6 tabs incl. **Audit & Transparency**, fee split, AI weights, economics, integrations |

## SIH Demo Mode

The flagship demo runs the **16-step cooperative loop end to end**:

1. Start it from the landing screen or the shell's demo control panel.
2. The engine drives a **Marathi** WhatsApp pipe-burst request → AI understanding
   → location quick-reply → cooperative worker search → single best worker →
   fair price → booking → worker acceptance → on the way → completed → payment
   with transparent split → two-sided rating → live cooperative dashboard update
   → district demand bump → AI capacity-shortage detection → federation exchange
   recommendation with **human** approval.
3. Controls: play/pause, step next/prev, speed multiplier, presentation mode.
4. **RESET DEMO** purges engine-created artifacts (flagged `isDemoScript`) while
   preserving seeded history, so the demo is repeatable all day.

Every narration line is built from data the engine actually collected in that
run — there are no pre-written numbers.

### The signature scenario (spec §51 / §87), verified

| Spec | Delivered |
|---|---|
| Marathi message → Plumbing / Emergency / Pipe burst | `inferCategory` + `inferUrgency` return `plumber` / `EMERGENCY`; title `Pipe burst` (never raw Devanagari) |
| Rajesh Kumar, Haveli Plumbing Cooperative | Best match, from the real matching engine |
| 1.8 km / 12 min | **5.1 km / 11 min** from **live GeoApify road routing** (the honest number for Kothrud → Karve Nagar; it changes with your keys) |
| Fair price ₹550–₹700 | **₹551 – ₹700** (labour ₹285 + travel ₹61 + material ₹110 + emergency ₹143) |
| "Deploy 3 plumbers from a nearby cooperative" | Federation dashboard shows the live exchange recommendation; a human approves |

---

## Tech stack & honest deviations

- **Next.js 16 (App Router, Turbopack) + React 19 + TypeScript 5**, Tailwind CSS 4, shadcn/ui, TanStack Query, Zustand, Recharts, lucide, Prisma 6, zod 4, GeoApify.
- **#60 deviation — database:** the spec prefers PostgreSQL; the prototype ships **SQLite via Prisma** so it runs with zero infrastructure. The schema uses no SQLite-specific types and no `enum`s, so the swap is a one-line `provider` change plus `DATABASE_URL` — no query changes (Prisma is the only data access layer).
- **Maps** are a stylized SVG over a real Pune coordinate grid, with GeoApify supplying real addresses, road distances, ETAs, turn-by-turn steps and polylines. No Mapbox/Google keys, nothing to leak, and it works offline.
- **AI is real where the sandbox allows.** Request understanding calls a server-side LLM with a deterministic heuristic fallback — and the heuristic is the *same* shared inference the matcher uses, so the demo behaves identically offline.
- **Payments are Demo Payment mode only** — mock settlement receipts over UPI/Razorpay-shaped rails, no gateway keys, no real money, no commission hard-coded as the business model.
- **No real government integration.** Every government-facing surface is labelled *"Designed for Authorized Integration"*.

## Security notes (#47)

- **Two-layer authz.** Edge `proxy` (CSRF + cookie presence) then per-handler `requireRole` / ownership checks.
- **Session-signed, not body-derived.** The audit actor and role always come from the HMAC-verified cookie. `recordAudit` no longer accepts a caller-supplied actor.
- **Every mutation is zod-validated** at the `req.json()` boundary; money paths are range-checked; a client-supplied `estimatedPrice` is treated as a hint and recomputed when it is outside a band around the rate card.
- **Ownership is enforced** on bookings, notifications, saved places, earnings, welfare, payments, AMC contracts and training enrolments.
- **The rating path is state-guarded and single-use**, so the two-sided trust surface cannot be inflated.
- **Negotiation is floored server-side** by the cooperative policy — the client no longer invents the floor.
- **Rate limits** on the AI and geo relays; a hard size cap on the ASR base64 payload.
- **Errors never leak** Prisma/SQLite internals; business-rule failures map to 409, not 500.
- **Minimal personal data** — synthetic names/phones; the passport explicitly lists what is excluded.

## Data integrity statement

- All dataset content is **synthetic and labelled "Prototype Data"**.
- Government-facing surfaces carry the notice **"Designed for Authorized Integration"** — nothing claims to be a real government feed, registry or payment rail.
- Every dashboard number is computed from the same database the demo writes to, including the SIH impact tiles, which are derived (utilisation from real job records, response time from real booking timestamps, welfare coverage from real wallet balances). Nothing is a hard-coded scoreboard.

## API surface

60 route handlers. The spec-named endpoints from §61 are all present; these are the ones that matter:

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth` | GET POST DELETE | **Sign in** (mock credentials → signed cookie) · current session · sign out |
| `/api/session` | GET POST | Read identity · **authorised** role switch for the demo console |
| `/proxy` | — | Edge guard: CSRF + session cookie on all mutations |
| `/api/categories` | GET | Service rate cards |
| `/api/workers` · `/api/workers/:id` · `/api/workers/:id/skill-passport` | GET | Worker directory, profile, **Digital Skill Passport + portability record** |
| `/api/worker` | GET PATCH | Worker app sections · availability, accept, advance, **decline**, enrol, training progress |
| `/api/worker/verify` | POST | Criteria-based worker verification (auditable, no trust score) |
| `/api/cooperatives` · `/api/cooperatives/:id` | GET | Directory · full record incl. the §4 government registration block |
| `/api/cooperative/verify` | POST | Cooperative badge verification (audited) |
| `/api/coop` | GET | Cooperative dashboard payload |
| `/api/districts` · `/api/talukas` | GET | Hierarchy lookups |
| `/api/service-requests` | POST | Free text → structured request + fair price + one match |
| `/api/bookings` · `/api/bookings/:id` | GET POST PATCH | List / create · lifecycle actions (cancel, acceptQuote, counter, acceptOffer, rejectOffers, advance, pay, evidence, rate) |
| `/api/quotes` · `/api/negotiations` · `/api/ratings` | POST | Request-a-quote, floored negotiation, two-sided rating |
| `/api/emergency` | POST | Escalation ladder triage, or real dispatch |
| `/api/ai/analyze` | POST | Multilingual request understanding (LLM + deterministic fallback) |
| `/api/ai/wa-bot` | POST | WhatsApp booking brain (Marathi/Hindi/English) |
| `/api/ai/allocate` · `/api/workforce-recommendations` | POST GET | Allocation with full explainability |
| `/api/ai/forecast` · `/api/demand-forecast` | GET | Zone demand forecast |
| `/api/ai/skill-gap` · `/api/skill-gaps` | GET | District-scoped skill-gap intelligence |
| `/api/ai/maintenance` · `/api/ai/emergency` | GET POST | Preventive maintenance · emergency triage |
| `/api/ai/weights` | GET PUT DELETE | Matching-weight config (platform-admin only) |
| `/api/asr` | POST | Voice input (size-capped, rate-limited, safe failure) |
| `/api/exchange` · `/api/capacity-exchange` | GET POST PATCH | **Cooperative Service Exchange** — AI recommends, humans approve |
| `/api/hierarchy` · `/api/hierarchy/dashboard` | GET | Hierarchy tree + per-level dashboards |
| `/api/federation/analytics` | GET | District capacity, category demand, skill gaps, contracts |
| `/api/geo` | GET | Map pins/zones/heatmap + optional geocoded anchor |
| `/api/geo/autocomplete` · `/geocode` · `/reverse` · `/route-matrix` · `/route` | GET POST | The five GeoApify products, each with an offline fallback |
| `/api/payments` | GET PUT | Payment history + configurable fee split |
| `/api/institution` · `/api/amc` | GET POST | Institutional portal · AMC contracts |
| `/api/welfare` · `/api/earnings` · `/api/trust` · `/api/reputation` · `/api/procurement` | GET POST | Worker welfare, earnings, two-sided trust, coop reputation, bulk procurement |
| `/api/places` · `/api/notifications` | GET POST PATCH DELETE | Address book · role-scoped notifications |
| `/api/search` | GET | Global grouped search |
| `/api/complaints` | GET POST PATCH | Complaint register + full committee ladder |
| `/api/admin` | GET | Platform aggregate + **live impact metrics** |
| `/api/audit` | GET | Audit & Transparency log (governance roles) |
| `/api/demo/reset` | GET POST | RESET DEMO dry-run / execute |

## Spec-route map (§74 → app views)

The spec proposes folder routes; the prototype ships **one user-visible route
(`/`)** with a client-side, role-gated view router, so every spec path is an app
view rather than a separate page:

| Spec route | GigSetu implementation |
|---|---|
| `/login` | login-screen with 9 demo identities |
| `/customer` `/customer/services` `/customer/book` `/customer/bookings` `/customer/track` `/customer/payments` `/customer/profile` | CustomerApp: 4 tabs + the 8-step booking flow + live tracking + AMC + maintenance |
| `/worker` `/worker/jobs` `/worker/skill-passport` `/worker/welfare` `/worker/earnings` `/worker/training` | WorkerApp: 7 tabs incl. printable Skill Passport |
| `/cooperative/*` (11 paths) | CoopApp: 14 tabs |
| `/taluka` · `/district` · `/district/map` · `/district/analytics` | TalukaDashboard · DistrictDashboard (+ governance actions) |
| `/federation/*` (4 paths) | StateDashboard · NationalDashboard |
| `/institution/*` | InstitutionPortal · AmcPanel · MaintenancePanel |
| `/admin/*` (4 paths) | PlatformAdmin console: 6 tabs |
| `/demo` | Demo panel + presentation mode |
| `/government` · `/hierarchy` · `/exchange` · `/ai` · `/whatsapp` · `/map` · `/search` | Corresponding views |

---

*GigSetu prototype — built for Smart India Hackathon. Synthetic data, demo payments, designed-for-authorized-integration government surfaces. See `docs/database-schema.md` for the entity catalog and `scripts/e2e-verify.ts` for the executable acceptance test.*
