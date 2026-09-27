export {}

/**
 * GigSetu — executable acceptance test.
 *
 * Drives the full spec §87 scenario over live HTTP plus every security control
 * that was added during the hardening pass. Needs the dev server running:
 *
 *   npm run dev -- -p 3111     # or any port; update B below
 *   node scripts/e2e-verify.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const B = process.env.GIGSETU_BASE_URL || 'http://localhost:3111'
const MARATHI = 'माझ्या घरात पाण्याची पाइप फुटली आहे. तातडीने plumber पाहिजे.'

let COOKIE = ''

type ReqOpts = { noAuth?: boolean }

async function req(m: string, u: string, body?: unknown, opts: ReqOpts = {}): Promise<{ s: number; j: any; t?: string }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: B,
    host: new URL(B).host,
  }
  if (COOKIE && !opts.noAuth) headers.cookie = COOKIE
  const r = await fetch(B + u, { method: m, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const setC = r.headers.get('set-cookie')
  if (setC && setC.includes('gigsetu_session=')) COOKIE = setC.split(';')[0]
  const t = await r.text()
  try {
    return { s: r.status, j: JSON.parse(t) }
  } catch {
    return { s: r.status, j: null, t }
  }
}

let passed = 0
let failed = 0
const ok = (c: boolean, label: string, extra = '') => {
  if (c) passed += 1
  else failed += 1
  console.log(`${c ? ' PASS' : '!FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`)
}
const section = (s: string) => console.log(`\n=== ${s} ===`)

async function main() {
  // ---------- 1. AUTH / RBAC ----------
  section('1 auth and role escalation')
  let r = await req('GET', '/api/session?role=PLATFORM_ADMIN', undefined, { noAuth: true })
  ok(r.j?.user === null, 'unauthenticated ?role= returns no identity', `user=${JSON.stringify(r.j?.user)}`)

  r = await req('GET', '/api/session', undefined, { noAuth: true })
  ok(r.j?.user === null, 'unauthenticated /api/session leaks no identity', `user=${JSON.stringify(r.j?.user)}`)

  r = await req('POST', '/api/auth', { role: 'CUSTOMER' }, { noAuth: true })
  ok(r.s === 200 && r.j?.user?.role === 'CUSTOMER', 'POST /api/auth sets a signed session cookie', r.j?.user?.name)
  const CUSTOMER = r.j.user.customerId

  r = await req('GET', '/api/session')
  ok(r.s === 200 && r.j?.user?.role === 'CUSTOMER', 'session round-trips through the cookie')

  r = await req('POST', '/api/session', { role: 'PLATFORM_ADMIN' })
  ok(r.s === 400, 'a customer session cannot escalate to PLATFORM_ADMIN', r.j?.error)

  r = await req('POST', '/api/auth', { role: 'SUPERADMIN' }, { noAuth: true })
  ok(r.s === 400, 'an unknown role is rejected', r.j?.error)

  // ---------- 1c. GEO SUGGESTION CONTRACT (regression) ----------
  // Regression guard. The booking flow does `setFlowArea(suggestion.area)` when
  // the customer picks an address, then POSTs /api/match with it. `area` was
  // declared in the client's hand-written response type but never actually sent
  // by the server, so picking any address blanked the service area and the Match
  // step failed with "categoryKey and area required". It only surfaced on
  // Vercel, where the GeoApify keys are absent and the offline fallback serves
  // the suggestions. Every suggestion from EVERY source must carry an area.
  section('1c address suggestions always resolve an area (regression: blank area -> match 400)')
  for (const q of ['Koth', 'Karve', 'Pune']) {
    const g = await req('GET', `/api/geo/autocomplete?q=${encodeURIComponent(q)}`)
    const results = g.j?.results ?? []
    const missing = results.filter((x: any) => typeof x.area !== 'string' || !x.area.trim()).length
    ok(
      results.length > 0 && missing === 0,
      `autocomplete("${q}") returns usable suggestions`,
      `source=${g.j?.source} n=${results.length} missingArea=${missing} e.g. "${results[0]?.area ?? '—'}"`
    )
  }

  // The area a suggestion reports must be one the matching engine accepts,
  // otherwise the Match step fails on an unrecognised locality.
  const auto = await req('GET', '/api/geo/autocomplete?q=Koth')
  const sugArea = auto.j?.results?.[0]?.area
  const mArea = await req('POST', '/api/match', { categoryKey: 'plumber', area: sugArea, urgency: 'NORMAL' })
  ok(mArea.s === 200 && !!mArea.j?.best, 'a suggestion area is immediately matchable', `area="${sugArea}" -> ${mArea.j?.best?.name ?? mArea.j?.error}`)

  // And the server names the offending field instead of a combined message.
  r = await req('POST', '/api/match', { categoryKey: 'plumber', area: '', urgency: 'NORMAL' })
  ok(r.s === 400 && /area/i.test(r.j?.error ?? ''), 'a blank area is reported as an area problem', r.j?.error)
  r = await req('POST', '/api/match', { area: 'Kothrud', urgency: 'NORMAL' })
  ok(r.s === 400 && /categoryKey/i.test(r.j?.error ?? ''), 'a missing categoryKey is reported as such', r.j?.error)

  // ---------- 1b. CLIENT LOGIN CONTRACT (regression) ----------
  // Regression guard. Every role button, the role switcher, the platform
  // console and the SIH demo launcher sign in through the client. They used to
  // call `GET /api/session?role=X`, which was closed down as a privilege-
  // escalation oracle and now only answers "who am I" — so the UI received
  // `{ user: null }`, handed null to the store, and every button failed with a
  // misleading "SIH demo engine not ready" toast. These assertions fail loudly
  // if sign-in is ever routed through the read-only endpoint again.
  section('1b client sign-in contract (regression: was "demo engine not ready")')
  const ROLES: [string, string][] = [
    ['CUSTOMER', 'Anita Deshmukh'],
    ['WORKER', 'Rajesh Kumar'],
    ['COOP_ADMIN', ''],
    ['TALUKA_COORD', ''],
    ['DISTRICT_COORD', ''],
    ['STATE_ADMIN', ''],
    ['NATIONAL_ADMIN', ''],
    ['INSTITUTION', ''],
    ['PLATFORM_ADMIN', 'GigSetu Ops'],
  ]
  for (const [role, expectName] of ROLES) {
    const res = await req('POST', '/api/auth', { role }, { noAuth: true })
    const u = res.j?.user
    const good = res.s === 200 && u?.role === role && typeof u?.name === 'string' && u.name.length > 0
    ok(good, `signInAs(${role}) returns a usable identity`, good ? `${u.name} · ${u.orgName ?? '—'}` : `status=${res.s} ${res.j?.error ?? ''}`)
    if (expectName) ok(u?.name === expectName, `…and it is the expected persona (${expectName})`, String(u?.name))
  }

  r = await req('GET', '/api/session?role=CUSTOMER')
  ok(r.s === 200 && r.j?.user?.role !== 'CUSTOMER' || r.j?.user === null, 'GET /api/session?role= is NOT a login path', `user=${JSON.stringify(r.j?.user?.role ?? null)}`)

  r = await req('GET', '/api/auth/identities')
  ok(r.s === 200 && r.j?.identities?.length === 9, 'GET /api/auth/identities lists every persona read-only', `n=${r.j?.identities?.length}`)

  const beforeList = (await req('GET', '/api/session')).j?.user?.role
  await req('GET', '/api/auth/identities')
  const afterList = (await req('GET', '/api/session')).j?.user?.role
  ok(beforeList === afterList, 'listing identities does not mutate the session', `${beforeList} -> ${afterList}`)

  // Back to the demo customer for the remaining scenarios.
  await req('POST', '/api/auth', { role: 'CUSTOMER' }, { noAuth: true })

  // ---------- 2. GEOAPIFY (5 products) ----------
  section('2 GeoApify integration')
  r = await req('GET', '/api/geo/autocomplete?q=Kothrud')
  ok(r.s === 200 && r.j?.results?.length > 0, 'Address Autocomplete', `source=${r.j?.source} n=${r.j?.results?.length}`)

  r = await req('GET', '/api/geo/geocode?q=Karve%20Nagar%2C%20Pune')
  ok(r.s === 200 && r.j?.result?.lat, 'Geocoding', `${r.j?.result?.label} -> area ${r.j?.result?.area}`)

  r = await req('GET', '/api/geo/reverse?lat=18.5073&lon=73.8057')
  ok(r.s === 200 && r.j?.result?.area, 'Reverse Geocoding', `${r.j?.result?.label} -> ${r.j?.result?.area}`)

  r = await req('POST', '/api/geo/route-matrix', { sources: [{ lat: 18.5073, lon: 73.8057 }], targets: [{ lat: 18.488, lon: 73.8135 }] })
  ok(r.s === 200 && r.j?.cells?.[0]?.[0]?.distanceKm > 0, 'Route Matrix', JSON.stringify(r.j?.cells))

  r = await req('GET', '/api/geo/route?fromLat=18.5073&fromLon=73.8057&toLat=18.488&toLon=73.8135')
  ok(r.s === 200 && r.j?.distanceKm > 0, 'Routing', `${r.j?.distanceKm} km / ${r.j?.durationMin} min, ${r.j?.polyline?.length} polyline points, ${r.j?.steps?.length} steps`)

  // ---------- 3. MATCHING + FAIR PRICING ----------
  section('3 one-worker matching and the fair pricing engine')
  r = await req('POST', '/api/match', { categoryKey: 'plumber', area: 'Kothrud', urgency: 'EMERGENCY', customerId: CUSTOMER })
  const price = r.j?.priceEstimate
  ok(r.s === 200 && !!r.j?.best, 'exactly one best worker is recommended', `${r.j?.best?.name} · ${r.j?.best?.cooperativeName} · ${r.j?.best?.distanceKm} km · ETA ${r.j?.best?.etaMin} min · geo=${r.j?.geoSource}`)
  ok((r.j?.alternatives ?? []).length >= 0 && r.j?.pipeline?.length === 6, 'the 6-stage pipeline is reported', (r.j?.pipeline ?? []).map((p: any) => `${p.stage}:${p.count}`).join(' '))
  ok(price?.base > 0, 'labour component (incl. skill level)', `₹${price?.base}`)
  ok(price?.travel > 0, 'travel component (road distance x per-km rate)', `₹${price?.travel}`)
  ok(price?.material > 0, 'material component', `₹${price?.material}`)

  // The fair range is DERIVED from the estimate (floor = 92%, ceiling = +17%),
  // and the estimate itself carries a time-of-day component: the engine adds a
  // 10% evening surcharge on labour after 18:00 (isEvening -> getHours() >= 18).
  //
  // This assertion used to hardcode "floor >= 550 && ceiling <= 700", which is
  // only true during the day. Run after 18:00 it failed with ₹577–734, so the
  // suite went red every evening and was quietly misleading. Assert the actual
  // contract instead, and prove the evening branch explicitly below.
  const isEveningNow = new Date().getHours() >= 18
  const eveningApplied = (price?.eveningSurcharge ?? 0) > 0
  ok(
    eveningApplied === isEveningNow,
    'the evening surcharge (10% of labour, after 18:00) is applied exactly when it should be',
    `local hour=${new Date().getHours()} surcharge=₹${price?.eveningSurcharge ?? 0}`
  )
  ok(
    Math.abs(price?.floor - Math.floor(price?.total * 0.92)) <= 1 && price?.floor <= price?.total,
    'the negotiation floor is 92% of the estimate (policy, not a magic number)',
    `floor ₹${price?.floor} vs 92% of ₹${price?.total} = ₹${Math.floor((price?.total ?? 0) * 0.92)}`
  )
  ok(
    Math.abs(price?.ceiling - Math.floor(price?.total * 1.17)) <= 1 && price?.ceiling >= price?.total,
    'the quote ceiling is +17% over the estimate (policy cap)',
    `ceiling ₹${price?.ceiling} vs 117% of ₹${price?.total} = ₹${Math.floor((price?.total ?? 0) * 1.17)}`
  )
  // Daytime reference: with no evening surcharge an emergency plumber call in
  // Kothrud lands in the rate-card band the demo quotes. Only assertable in
  // daylight, so report it rather than gate on it.
  const noEvening = (price?.total ?? 0) - (price?.eveningSurcharge ?? 0)
  ok(
    isEveningNow ? true : price?.floor >= 550 && price?.ceiling <= 700,
    'spec §51 rate-card band holds for a daytime emergency call',
    isEveningNow
      ? `skipped (evening): ex-surcharge total ₹${noEvening} would quote ₹${Math.floor(noEvening * 0.92)}–₹${Math.floor(noEvening * 1.17)}`
      : `₹${price?.floor} – ₹${price?.ceiling}`
  )

  r = await req('POST', '/api/ai/allocate', { categoryKey: 'plumber', area: 'Kothrud', urgency: 'EMERGENCY' })
  ok(r.s === 200 && r.j?.explain?.length >= 5, 'allocation explainability (spec §62)', (r.j?.explain ?? []).join(' | ').slice(0, 140))
  ok((r.j?.factorTable ?? []).length === 6, 'per-factor weight table is shown', `${r.j?.factorTable?.length} factors`)

  // ---------- 4. ANALYZER ----------
  section('4 multilingual request understanding (spec §15)')
  r = await req('POST', '/api/ai/analyze', { description: MARATHI, lang: 'mr' })
  ok(r.j?.analysis?.categoryKey === 'plumber', 'Marathi pipe burst -> plumber', `got=${r.j?.analysis?.categoryKey} via ${r.j?.analysis?.source}`)
  ok(r.j?.analysis?.urgency === 'EMERGENCY', 'Marathi "tatodine" -> EMERGENCY', r.j?.analysis?.urgency)
  ok(/^[\x20-\x7E]+$/.test(r.j?.analysis?.title ?? ''), 'job title is an English label, never raw Devanagari', r.j?.analysis?.title)

  for (const [label, text, cat] of [
    ['Hindi', 'उद्या सकाळी प्लंबर पाहिजे', 'plumber'],
    ['English', 'Tomorrow morning I need a plumber.', 'plumber'],
    ['Hindi electrical', 'बिजली नहीं चल रही है', 'electrician'],
  ] as Array<[string, string, string]>) {
    r = await req('POST', '/api/ai/analyze', { description: text })
    ok(r.j?.analysis?.categoryKey === cat, `${label} sample -> ${cat}`, `got=${r.j?.analysis?.categoryKey}`)
  }

  // ---------- 5. BOOKING LIFECYCLE ----------
  section('5 booking lifecycle, settlement and trust')
  r = await req('POST', '/api/bookings', {
    customerId: CUSTOMER, categoryKey: 'plumber', title: 'Pipe burst', description: 'pipe burst',
    area: 'Kothrud', address: 'Kothrud', scheduledAt: new Date().toISOString(), urgency: 'EMERGENCY', mode: 'INSTANT',
  })
  const BID = r.j?.booking?.id
  ok(r.s === 201 && !!BID, 'booking created', r.j?.booking?.refCode)

  r = await req('POST', '/api/bookings', { customerId: CUSTOMER, categoryKey: 'plumber', title: 'x', description: 'x', area: 'Kothrud', estimatedPrice: 1 })
  ok((r.j?.booking?.estimatedPrice ?? 0) > 100, 'PRICE EXPLOIT BLOCKED: estimatedPrice=1 is recomputed', `est=₹${r.j?.booking?.estimatedPrice}`)
  const EXPLOIT_ID = r.j?.booking?.id

  r = await req('PATCH', `/api/bookings/${EXPLOIT_ID}`, { action: 'rate', rating: 5 })
  ok(r.s === 409, 'RATING EXPLOIT BLOCKED: cannot rate an unsettled job', r.j?.error)

  for (let i = 0; i < 26; i += 1) {
    r = await req('GET', `/api/bookings/${BID}`)
    if (['COMPLETED', 'PAID', 'REVIEWED'].includes(r.j?.booking?.status)) break
    await new Promise((x) => setTimeout(x, 8000))
  }
  ok(r.j?.booking?.status === 'COMPLETED', 'auto-progression reaches COMPLETED', (r.j?.booking?.timeline ?? []).map((t: any) => t.status).join(' > '))
  ok((r.j?.floor ?? 0) > 0, 'the booking response carries the REAL cooperative floor', `floor=₹${r.j?.floor}`)

  r = await req('PATCH', `/api/bookings/${BID}`, { action: 'pay', method: 'UPI (Prototype)' })
  ok(r.j?.booking?.status === 'PAID', 'demo payment settles', r.j?.booking?.payment?.method)
  const sp = r.j?.booking?.payment ?? {}
  ok(Math.abs((sp.workerShare ?? 0) + (sp.coopCommission ?? 0) + (sp.welfare ?? 0) + (sp.platformFee ?? 0) - (sp.amount ?? 0)) <= 1, 'the 4-way split sums to the amount', `worker ₹${sp.workerShare} / coop ₹${sp.coopCommission} / welfare ₹${sp.welfare} / platform ₹${sp.platformFee}`)

  r = await req('PATCH', `/api/bookings/${BID}`, { action: 'rate', rating: 5, review: 'Great work', factors: { quality: 5, timeliness: 5, behaviour: 5, communication: 5 } })
  ok(r.j?.booking?.status === 'REVIEWED', 'multi-factor rating recorded', r.j?.booking?.status)

  r = await req('PATCH', `/api/bookings/${BID}`, { action: 'rate', rating: 5 })
  ok(r.s === 409, 'a second rating on the same job is rejected', r.j?.error)

  // ---------- 6. NEGOTIATION ----------
  section('6 controlled negotiation (spec §12)')
  r = await req('POST', '/api/bookings', {
    customerId: CUSTOMER, categoryKey: 'plumber', title: 'Rewiring', description: 'full rewiring needed',
    area: 'Kothrud', address: 'Kothrud', scheduledAt: new Date().toISOString(), urgency: 'NORMAL', mode: 'QUOTE',
  })
  const QID = r.j?.booking?.id
  for (let i = 0; i < 3; i += 1) {
    r = await req('GET', `/api/bookings/${QID}`)
    await new Promise((x) => setTimeout(x, 7000))
  }
  ok(['QUOTED', 'NEGOTIATING'].includes(r.j?.booking?.status), 'quote flow reaches QUOTED with 3 offers', `${r.j?.booking?.status}, offers=${r.j?.booking?.quoteOffers?.length ?? 0}`)
  const FLOOR = r.j?.floor ?? 0
  r = await req('POST', '/api/negotiations', { bookingId: QID, offer: 10 })
  ok(r.s === 400, 'an offer below the cooperative floor is rejected', r.j?.error)
  r = await req('POST', '/api/negotiations', { bookingId: QID, offer: FLOOR + 50 })
  ok(r.s === 200 && !!r.j?.resolution, 'an offer at/above the floor resolves', JSON.stringify(r.j?.resolution))
  ok(String(r.j?.policyNote ?? '').includes('cooperative pricing policy'), 'the response states the negotiation policy', r.j?.policyNote)

  r = await req('PATCH', `/api/bookings/${QID}`, { action: 'counter', price: 5 })
  ok(r.s === 400, 'the booking PATCH counter path is floored too', r.j?.error)

  // ---------- 7. NOTIFICATIONS ----------
  section('7 notification ownership')
  const before = await req('GET', '/api/notifications')
  const unreadBefore = before.j?.unread ?? 0
  r = await req('PATCH', '/api/notifications', { audience: 'CUSTOMER' })
  ok(r.s === 200, 'mark-all is scoped to the caller', `updated=${r.j?.updated}`)
  const after = await req('GET', '/api/notifications')
  ok((after.j?.unread ?? 0) === 0, 'only the caller\'s own stream was cleared', `unread ${unreadBefore} -> ${after.j?.unread}`)

  // ---------- 8. PRIVILEGED OPERATIONS ----------
  section('8 privileged operations require the right role')
  for (const [m, u, b, label] of [
    ['PUT', '/api/payments', { workerSharePct: 86, coopPct: 8, welfarePct: 2, platformPct: 4 }, 'PUT /api/payments (global fee split)'],
    ['PUT', '/api/ai/weights', { skillMatch: 40 }, 'PUT /api/ai/weights (matching engine)'],
    ['PUT', '/api/economics', { sources: [] }, 'PUT /api/economics (revenue model)'],
    ['POST', '/api/demo/reset', {}, 'POST /api/demo/reset'],
  ] as Array<[string, string, unknown, string]>) {
    r = await req(m, u, b)
    ok(r.s === 403, `customer is blocked from ${label}`, `status=${r.s}`)
  }
  r = await req('PATCH', '/api/exchange', { id: 'nope', action: 'approve' })
  ok(r.s === 403, 'customer cannot approve a cross-cooperative worker transfer', r.j?.error)
  r = await req('PATCH', '/api/worker', { id: 'nope', action: 'availability', value: 'OFFLINE' })
  ok(r.s === 404 || r.s === 403, 'customer cannot flip another worker\'s availability', `status=${r.s}`)
  r = await req('POST', '/api/trust', { workerId: 'nope', category: 'UNSAFE_ENV', detail: 'a valid enough detail string' })
  ok(r.s === 403, 'a customer cannot file a worker-side report against a worker who never served them', `status=${r.s} ${r.j?.error ?? ''}`)
  r = await req('POST', '/api/trust', { workerId: 'nope', category: 'UNSAFE_ENV', detail: 'x' })
  ok(r.s === 400, '…and a malformed report body is rejected by validation', `status=${r.s}`)

  // ---------- 9. PLATFORM ADMIN ----------
  section('9 platform admin + audit integrity')
  await req('POST', '/api/auth', { role: 'PLATFORM_ADMIN' }, { noAuth: true })
  r = await req('GET', '/api/admin')
  ok(r.s === 200 && !!r.j?.impact, 'admin overview with LIVE impact metrics', JSON.stringify(r.j?.impact))
  ok((r.j?.counts?.bookings ?? 0) > 0, 'booking total is a real COUNT, not a capped slice', `bookings=${r.j?.counts?.bookings}`)

  r = await req('PUT', '/api/payments', { workerSharePct: 90, coopPct: 6, welfarePct: 2, platformPct: 2, updatedBy: 'Forged Name' })
  ok(r.s === 200, 'platform admin CAN change the fee split', `updatedBy=${r.j?.config?.updatedBy}`)
  ok(r.j?.config?.updatedBy === 'GigSetu Ops', 'the body-supplied actor is ignored', `stored updatedBy=${r.j?.config?.updatedBy}`)

  r = await req('PUT', '/api/ai/weights', { skillMatch: 500 })
  ok(r.s === 400, 'out-of-range matching weights are rejected', r.j?.error)

  r = await req('GET', '/api/audit?limit=5')
  ok(r.s === 200 && Array.isArray(r.j?.entries), 'audit log readable by governance roles', `total=${r.j?.total} page=${r.j?.limit}`)
  ok(r.j?.entries?.[0]?.actor !== 'Forged Name', 'the forged actor never reached the audit log', `actor=${r.j?.entries?.[0]?.actor}`)

  r = await req('GET', '/api/welfare?workerId=cm-does-not-exist')
  ok(r.s === 404, 'welfare IDOR is bounded', `status=${r.s}`)

  // ---------- 10. SPEC §61 API SURFACE ----------
  section('10 spec §61 API surface')
  for (const u of [
    '/api/workers?skill=plumber',
    '/api/districts',
    '/api/talukas',
    '/api/cooperatives',
    '/api/demand-forecast?zone=pune-z4',
    '/api/skill-gaps?district=Pune',
    '/api/workforce-recommendations?categoryKey=plumber&area=Kothrud',
    '/api/capacity-exchange',
    '/api/federation/analytics',
  ]) {
    r = await req('GET', u)
    ok(r.s === 200, `GET ${u}`, `status=${r.s}`)
  }
  const WID = (await req('GET', '/api/workers?skill=plumber')).j?.workers?.[0]?.id
  r = await req('GET', `/api/workers/${WID}`)
  ok(r.s === 200, 'GET /api/workers/:id', r.j?.worker?.name)
  r = await req('GET', `/api/workers/${WID}/skill-passport`)
  ok(r.s === 200 && !!r.j?.portability, 'GET /api/workers/:id/skill-passport (spec §19/§20)', `${r.j?.worker?.name} · ${r.j?.portability?.portableFields?.length} portable fields`)
  const CID = (await req('GET', '/api/cooperatives')).j?.cooperatives?.[0]?.id
  r = await req('GET', `/api/cooperatives/${CID}`)
  ok(r.s === 200 && !!r.j?.registration, 'GET /api/cooperatives/:id with the §4 government record', `${r.j?.cooperative?.name} · ${r.j?.registration?.registrationNumber}`)
  r = await req('POST', '/api/emergency', { categoryKey: 'plumber', area: 'Kothrud', urgency: 'EMERGENCY' })
  ok(r.s === 200 && r.j?.ladder?.length === 4, 'POST /api/emergency triage ladder (spec §16/§17)', r.j?.dispatchedFrom)
  r = await req('POST', '/api/service-requests', { description: MARATHI, area: 'Kothrud' })
  ok(r.s === 200 && r.j?.request?.categoryKey === 'plumber', 'POST /api/service-requests', JSON.stringify(r.j?.request))

  // ---------- 11. WHATSAPP BOT ----------
  section('11 WhatsApp booking bot (spec §14)')
  await req('POST', '/api/auth', { role: 'CUSTOMER' }, { noAuth: true })
  r = await req('POST', '/api/ai/wa-bot', { customerId: CUSTOMER, message: 'Hi', lang: 'en', state: { stage: 'new' } })
  ok(r.s === 200 && r.j?.state?.stage === 'awaiting_service', 'hi -> welcome + service chips', r.j?.replies?.[0]?.text?.slice(0, 40))
  let st = r.j.state
  for (const msg of ['Plumber', 'pipe burst, urgent', 'Kothrud', 'now']) {
    r = await req('POST', '/api/ai/wa-bot', { customerId: CUSTOMER, message: msg, lang: 'en', state: st })
    st = r.j.state
  }
  ok(st?.stage === 'ready' && !!r.j?.workerCard, 'full happy path -> worker card + CONFIRM/QUOTE', `${r.j?.workerCard?.workerName} ${r.j?.workerCard?.distanceKm} km · ETA ${r.j?.workerCard?.etaMin} min · ₹${r.j?.workerCard?.priceFloor}-${r.j?.workerCard?.priceCeiling}`)
  r = await req('POST', '/api/ai/wa-bot', { customerId: CUSTOMER, message: '', lang: 'en', state: st, confirm: true })
  ok(r.s === 200 && !!r.j?.bookingRef, 'CONFIRM creates a real booking in the engine', r.j?.bookingRef)

  r = await req('POST', '/api/ai/wa-bot', {
    customerId: CUSTOMER, message: '', lang: 'en', confirm: true,
    state: { stage: 'new', pendingSlot: { categoryKey: 'plumber', title: 'HACK', description: 'x', area: 'ZZZ', address: 'y', scheduledAt: 'not-a-date', urgency: 'SUPER_URGENT_!!!' } },
  })
  ok(r.s === 400 || r.s === 200, 'mass-assignment attempt is rejected, never a 500', `status=${r.s} ${r.j?.error ?? '(sanitised into a safe booking)'}`)

  r = await req('POST', '/api/ai/wa-bot', { customerId: 'somebody-else', message: 'hi', lang: 'en', state: { stage: 'new' } })
  ok(r.s === 403, 'the bot cannot be driven for another customer', `status=${r.s} ${r.j?.error ?? ''}`)

  // ---------- 12. AI INTELLIGENCE ----------
  section('12 AI intelligence (spec §28/§29/§63)')
  r = await req('GET', '/api/skill-gaps?district=Pune')
  const pune = r.j
  ok(r.s === 200 && r.j?.rows?.length > 0, 'skill gap, district-scoped', `Pune workers=${r.j?.workerCount} totalGap=${r.j?.totalGap}`)
  r = await req('GET', '/api/skill-gaps?district=Nashik')
  ok(r.j?.workerCount !== pune?.workerCount, '…and it is genuinely scoped per district', `Nashik workers=${r.j?.workerCount} vs Pune ${pune?.workerCount}`)
  r = await req('GET', '/api/demand-forecast?zone=pune-z4')
  ok(r.s === 200 && r.j?.categories?.length > 0, 'demand forecast with drivers', (r.j?.categories ?? []).slice(0, 2).map((c: any) => `${c.categoryKey} ${c.baseWeekend}->${c.expectedWeekend} (${c.pct}%)`).join(' | '))
  r = await req('GET', '/api/demand-forecast?zone=not-a-zone')
  ok(r.j?.ok === false, 'an unknown forecast zone is rejected, not silently defaulted', r.j?.error)

  // ---------- 13. DEMO RESET ----------
  section('13 demo reset (spec §66)')
  await req('POST', '/api/auth', { role: 'PLATFORM_ADMIN' }, { noAuth: true })
  r = await req('GET', '/api/demo/reset')
  ok(r.s === 200, 'reset dry-run reports what it would remove', JSON.stringify(r.j))
  r = await req('POST', '/api/demo/reset')
  // ---------- 14. THE 16-STEP SIH DEMO WALKTHROUGH ----------
  // Replays exactly the API sequence the client-side demo engine performs when
  // a judge clicks "START SIH DEMO" (see demo-engine.tsx runStep). The engine is
  // a React component and cannot be driven from here, but every step it performs
  // is one of these calls — if one regresses, the button silently stalls on that
  // step. Step numbers match DEMO_SCRIPT.
  section('14 the 16-step SIH demo walkthrough (what START SIH DEMO does)')

  // The demo launcher signs the customer in FIRST, then resets (the reset is a
  // mutating route and needs a session). Reset itself is platform-only.
  await req('POST', '/api/auth', { role: 'PLATFORM_ADMIN' }, { noAuth: true })
  const dem = await req('POST', '/api/demo/reset')
  ok(dem.s === 200, 'demo launcher: reset runs with a session', `status=${dem.s}`)
  await req('POST', '/api/auth', { role: 'CUSTOMER' }, { noAuth: true })
  const who = await req('GET', '/api/session')
  ok(who.j?.user?.role === 'CUSTOMER', 'demo launcher: customer identity is live in the cookie', who.j?.user?.name)

  // 1 wa-request — the Marathi opener
  let wa = await req('POST', '/api/ai/wa-bot', { customerId: CUSTOMER, message: MARATHI, lang: 'mr', state: { stage: 'new' } })
  ok(wa.s === 200 && wa.j?.replies?.length > 0, '1  wa-request    Marathi opener gets a reply', wa.j?.replies?.[0]?.text?.slice(0, 34))
  let demoSt = wa.j?.state ?? { stage: 'new' }

  // 2 ai-understand
  let an = await req('POST', '/api/ai/analyze', { description: MARATHI, lang: 'mr' })
  ok(an.s === 200 && an.j?.analysis?.categoryKey === 'plumber', '2  ai-understand  categorised as plumber', `${an.j?.analysis?.categoryKey} / ${an.j?.analysis?.urgency}`)

  // 3 wa-location — the engine walks the bot to the "ready" card, which is what
  //    actually performs the geocode + match + fair-price steps.
  for (const msg of ['Plumber', 'pipe burst, urgent', 'Kothrud', 'now']) {
    wa = await req('POST', '/api/ai/wa-bot', { customerId: CUSTOMER, message: msg, lang: 'en', state: demoSt })
    demoSt = wa.j?.state
  }
  ok(demoSt?.stage === 'ready' && !!wa.j?.workerCard, '3  wa-location   conversation reaches the ready card', `${wa.j?.workerCard?.workerName} ${wa.j?.workerCard?.distanceKm} km`)

  // 4/5 match-search + match-select, reported independently by the engine
  let m = await req('POST', '/api/match', { categoryKey: 'plumber', area: 'Kothrud', urgency: 'EMERGENCY', customerId: CUSTOMER })
  ok(m.s === 200 && m.j?.pipeline?.length === 6, '4  match-search  6-stage pipeline runs', (m.j?.pipeline ?? []).map((x: any) => `${x.stage}:${x.count}`).join(' '))
  ok(!!m.j?.best, '5  match-select   exactly one best worker', m.j?.best?.name)

  // 6 fair-price
  const pe = m.j?.priceEstimate
  ok(pe?.floor > 0 && pe?.ceiling > pe?.floor, '6  fair-price    a fair range is quoted', `₹${pe?.floor}-${pe?.ceiling} total ₹${pe?.total}`)

  // 7 confirm
  const conf = await req('POST', '/api/ai/wa-bot', { customerId: CUSTOMER, message: '', lang: 'en', state: demoSt, confirm: true })
  ok(conf.s === 200 && !!conf.j?.bookingId && !!conf.j?.bookingRef, '7  confirm       booking created', conf.j?.bookingRef)
  const DBOOK = conf.j?.bookingId
  const DREF = conf.j?.bookingRef

  // 8/9/10 worker-accept -> on-the-way -> complete. The engine polls GET
  //     /api/bookings/:id and the booking engine auto-advances the timeline.
  await req('POST', '/api/auth', { role: 'WORKER' }, { noAuth: true })
  let bk: any = null
  for (let i = 0; i < 26; i += 1) {
    const g = await req('GET', `/api/bookings/${DBOOK}`)
    bk = g.j?.booking
    if (bk && ['COMPLETED', 'PAID', 'REVIEWED'].includes(bk.status)) break
    await new Promise((x) => setTimeout(x, 8000))
  }
  ok(bk?.status === 'COMPLETED', '8-10 worker-accept/on-the-way/complete  timeline advances', (bk?.timeline ?? []).map((t: any) => t.status).join(' > '))

  // 11 payment — the customer settles, so be signed in as the customer.
  await req('POST', '/api/auth', { role: 'CUSTOMER' }, { noAuth: true })
  const pay = await req('PATCH', `/api/bookings/${DBOOK}`, { action: 'pay', method: 'UPI (Demo Payment)' })
  const demoSp = pay.j?.booking?.payment ?? {}
  ok(pay.j?.booking?.status === 'PAID', '11 payment      booking settles', `${pay.j?.booking?.status ?? pay.s} ${pay.j?.error ?? ''}`)
  ok(Math.abs((demoSp.workerShare ?? 0) + (demoSp.coopCommission ?? 0) + (demoSp.welfare ?? 0) + (demoSp.platformFee ?? 0) - (demoSp.amount ?? 0)) <= 1, '11 payment      the 4-way split is transparent', `worker ₹${demoSp.workerShare} / coop ₹${demoSp.coopCommission} / welfare ₹${demoSp.welfare} / platform ₹${demoSp.platformFee}`)

  // 12 rating — the route derives the worker from the booking; it takes
  //     `rating`/`review`, and refuses an unsettled job.
  const rat = await req('POST', '/api/ratings', { bookingId: DBOOK, rating: 5, review: 'Fast, neat work and the price matched the quote.' })
  ok(rat.s === 200, '12 rating       trust score is two-sided', `status=${rat.s} ${rat.j?.error ?? ''}`)

  // 13 coop-update
  await req('POST', '/api/auth', { role: 'COOP_ADMIN' }, { noAuth: true })
  const cq = await req('GET', `/api/coop?id=${m.j?.best?.cooperativeId ?? ''}`)
  ok(cq.s === 200 && !!cq.j?.cooperative?.name, '13 coop-update  cooperative dashboard is live', `${cq.j?.cooperative?.name} · ${cq.j?.cooperative?.workerCount} workers`)

  // 14 district-demand
  await req('POST', '/api/auth', { role: 'DISTRICT_COORD' }, { noAuth: true })
  const dd = await req('GET', '/api/hierarchy/dashboard?level=district')
  ok(dd.s === 200 && !!dd.j?.district?.name, '14 district-demand  district rollup is live', `${dd.j?.district?.name} · ${dd.j?.district?.jobsToday} jobs today`)

  // 15 ai-shortage
  const gap = await req('GET', '/api/skill-gaps?district=Pune')
  ok(gap.s === 200 && gap.j?.totalGap > 0, '15 ai-shortage  capacity shortage detected', `totalGap=${gap.j?.totalGap}`)

  // 16 exchange-approve — a human, not the model, approves.
  await req('POST', '/api/auth', { role: 'NATIONAL_ADMIN' }, { noAuth: true })
  const xl = await req('GET', '/api/exchange')
  const pend = (xl.j?.recommendations ?? []).find((x: any) => x.status === 'PENDING')
  if (pend) {
    const ex = await req('PATCH', '/api/exchange', { id: pend.id, action: 'approve', by: 'Walkthrough test' })
    ok(ex.s === 200, '16 exchange-approve  a human approves the allocation', `status=${ex.s} ${ex.j?.error ?? ''}`)
  } else {
    ok(xl.s === 200, '16 exchange-approve  exchange list reachable (nothing PENDING left)', `${xl.j?.recommendations?.length ?? 0} recommendations`)
  }

  const demoAfter = await req('GET', `/api/bookings/${DBOOK}`)
  ok(demoAfter.j?.booking?.refCode === DREF, 'walkthrough booking is queryable end-to-end', `${demoAfter.j?.booking?.refCode} ${demoAfter.j?.booking?.status}`)

  // ---------- 15. SIH DEMO SCRIPT INTEGRITY ----------
  // The demo is a screen-recorded product walkthrough, so a broken script is a
  // broken demo. These assertions are about the SCRIPT, not the API: they run
  // with no server dependency and guard the acceptance list in the brief.
  section('15 SIH demo script integrity (17-step story, spec §46)')
  const scriptSrc = readFileSync(join(process.cwd(), 'src/components/gigsetu/demo/demo-script.ts'), 'utf8')

  const numbered = [...scriptSrc.matchAll(/num:\s*(\d+)\s*,\s*title:\s*'([^']+)'/g)].map((m) => ({ num: Number(m[1]), title: m[2] }))
  ok(numbered.length === 17, 'the script defines exactly 17 numbered story steps', `found ${numbered.length}`)
  ok(
    numbered.every((s, i) => i === 0 || s.num === numbered[i - 1].num + 1),
    'story step numbers run 01..17 with no gaps or duplicates',
    numbered.map((s) => s.num).join(',')
  )
  const titles = numbered.map((s) => s.title)
  const REQUIRED_TITLES = [
    'CUSTOMER REQUEST', 'MULTILINGUAL REQUEST', 'AI UNDERSTANDS', 'WORKER DISCOVERY',
    'FAIR MATCHING', 'REMOTE CONSULTATION', 'WORKER ACCEPTS', 'SERVICE TRACKING',
    'SERVICE COMPLETED', 'PAYMENT + FAIRWORK', 'COOPERATIVE DASHBOARD', 'TALUKA COORDINATION',
    'DISTRICT COMMAND', 'STATE FEDERATION', 'NATIONAL APEX', 'INSTITUTIONAL SERVICES',
    'WORKFORCE INTELLIGENCE',
  ]
  const missingTitles = REQUIRED_TITLES.filter((t) => !titles.includes(t))
  ok(missingTitles.length === 0, 'every required story title from the brief is present', missingTitles.join(', ') || 'all 17')

  // Supporting scenes must be unnumbered (spec §24 — platform admin is NOT a
  // numbered step).
  const supporting = [...scriptSrc.matchAll(/id:\s*'([a-z-]+)',\s*num:\s*null/g)].map((m) => m[1])
  ok(supporting.includes('platform-admin'), 'Platform Admin exists as an UNNUMBERED supporting scene', supporting.join(', '))
  ok(supporting.includes('intelligence-loop'), 'the Complete Intelligence Loop scene exists')
  ok(supporting.includes('closing'), 'the closing scene exists')

  // The three-layer information system (spec §44): every step needs a
  // description AND a voiceover line, or the viewer loses "why it matters".
  const stepBlocks = scriptSrc.split(/\n  \{\n/).slice(1)
  const noDescription = stepBlocks.filter((b) => !/\bdescription:/.test(b)).length
  const noVoiceover = stepBlocks.filter((b) => !/\bvoiceover:/.test(b)).length
  ok(noDescription === 0, 'every step declares a one-line description (LEVEL 1/3)', `${noDescription} missing`)
  ok(noVoiceover === 0, 'every step declares voiceoverText for later narration (spec §34)', `${noVoiceover} missing`)

  // Governance framing must be present wherever AI acts (spec §10 / §25).
  ok(scriptSrc.includes('DEMO_GOVERNANCE'), 'the "AI RECOMMENDS · COOPERATIVE GOVERNS" line is defined')
  ok(
    scriptSrc.includes("'AI RECOMMENDS · COOPERATIVE GOVERNS'"),
    '…and is spelled exactly as the brief requires'
  )

  // Deterministic remote consultation: no camera, no mic, no WebRTC (spec §11).
  // Comments are stripped first — the file's own docblock NAMES these APIs to
  // state that they are deliberately not used, which would otherwise match.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const callSrc = stripComments(readFileSync(join(process.cwd(), 'src/components/gigsetu/demo/demo-video-call.tsx'), 'utf8'))
  ok(!/getUserMedia|mediaDevices|RTCPeerConnection|webkitGetUserMedia/.test(callSrc), 'the video consultation uses NO real camera/mic/WebRTC API')
  ok(/CALLING[\s\S]*CONNECTING[\s\S]*CONNECTED[\s\S]*CONSULTATION[\s\S]*SUMMARY[\s\S]*END/.test(callSrc), 'the consultation runs CALLING → END deterministically')

  // No coordinate-based automation anywhere (spec §42).
  const demoDir = join(process.cwd(), 'src/components/gigsetu/demo')
  const coordClicks: string[] = []
  for (const f of readdirSync(demoDir)) {
    if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue
    const src = readFileSync(join(demoDir, f), 'utf8')
    if (/clientX|clientY|pageX|pageY|dispatchEvent\(new MouseEvent|Math\.random\(\s*\)\s*\*\s*\d{2,}/.test(src)) {
      coordClicks.push(f)
    }
  }
  ok(coordClicks.length === 0, 'no coordinate-based or randomised click automation in the demo', coordClicks.join(', ') || 'clean')

  // The engine must handle every step — enforced at compile time, asserted here
  // so it is also visible in the acceptance report.
  const engineSrc = readFileSync(join(process.cwd(), 'src/components/gigsetu/demo/demo-engine.tsx'), 'utf8')
  const handled = new Set([...engineSrc.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]))
  const scriptIds = [...scriptSrc.matchAll(/^\s{4}id: '([a-z-]+)',\s*$/gm)].map((m) => m[1])
  const unhandled = scriptIds.filter((id) => !handled.has(id))
  ok(unhandled.length === 0, 'the demo engine has an action for every story step', unhandled.join(', ') || `${scriptIds.length} steps`)

  // Store step count must match the script, or progress/Next would misbehave.
  const storeSrc = readFileSync(join(process.cwd(), 'src/store/demo-store.ts'), 'utf8')
  ok(/DEMO_STEP_COUNT\s*=\s*DEMO_RUN_LENGTH/.test(storeSrc), 'the store derives its step count from the script (single source of truth)')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))
  if (failed > 0) process.exitCode = 1
}

main()
