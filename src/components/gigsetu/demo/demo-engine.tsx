'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, signInAs } from '@/lib/api-client'
import { areaDistance } from '@/lib/area-distance'
import { useAppStore } from '@/store/app-store'
import { useDemoStore, DEMO_STEP_COUNT } from '@/store/demo-store'
import type { BookingDTO, DemoUser, MatchResponse, WaBotResponse } from '@/lib/types'
import {
  DEMO_SCRIPT,
  DEMO_AREA,
  DEMO_WA_MESSAGE,
  DEMO_RATING,
  DEMO_GOVERNANCE,
  DEMO_SCENARIO_ENTITIES,
  EMERGENCY_PIPELINE_NOTES,
  type DemoData,
  type DemoStepId,
} from './demo-script'

/**
 * Every step id the engine's switch below actually handles, as a const tuple.
 *
 * HANDLED_EXHAUSTIVE below turns this into a COMPILE-TIME proof that the
 * engine covers every step in the script. Ten new steps once compiled cleanly
 * and silently did nothing at runtime, in front of a judge; this makes that a
 * `npm run typecheck` failure instead.
 *
 * Note this must be a const TUPLE, not a union type cast — `id as Union` is
 * permitted by TypeScript and therefore proves nothing.
 */
const HANDLED_STEP_IDS = [
  'customer-request', 'wa-request', 'ai-understand',
  'match-search', 'match-select', 'remote-consult',
  'confirm', 'on-the-way', 'complete', 'payment',
  'coop-update', 'taluka-capacity', 'district-demand',
  'state-network', 'national-apex', 'institution-amc',
  'workforce-intelligence',
  'platform-admin', 'intelligence-loop', 'closing',
] as const

/** Any script step the engine forgot — must be `never`. */
type UnhandledStepId = Exclude<DemoStepId, (typeof HANDLED_STEP_IDS)[number]>

// Fails to compile if any script step lacks an engine action. The [X] extends
// [never] form is deliberate: bare `X extends never` distributes over `never`
// and would always pass. The message names the unhandled ids.
type ExhaustiveError = [UnhandledStepId] extends [never]
  ? true
  : { error: 'These demo-script steps have no case in the demo engine switch:'; missing: UnhandledStepId[] }
const HANDLED_EXHAUSTIVE: ExhaustiveError = true
void HANDLED_EXHAUSTIVE

// Re-exported so the landing screen (task 15-c) can wire its START DEMO button
// to the exact same reset → login → start sequence used by the app header.
export { startSihDemo, stopSihDemo, resetDemoState } from './demo-launch'

const POLL_MS = 2000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const d = () => useDemoStore.getState().data as DemoData
const put = (partial: Partial<DemoData>) => useDemoStore.getState().setData(partial as Record<string, unknown>)

/** Rotation helper for loading-state notes (#69). */
function rotatingNote(idx: number) {
  return EMERGENCY_PIPELINE_NOTES[idx % EMERGENCY_PIPELINE_NOTES.length]
}

/**
 * Phase 6 #50/#66/#69 — SIH Demo ENGINE.
 * Mounted ONCE inside app-shell. Watches the demo store and executes the
 * current step's action idempotently; polls the booking engine where the
 * story needs to wait for real time-accelerated progression; auto-advances
 * when `playing` after each step's dwell (scaled by speed).
 * Renders nothing — all UI lives in demo-panel.tsx.
 */
export function DemoEngine() {
  const qc = useQueryClient()
  const active = useDemoStore((s) => s.active)
  const phase = useDemoStore((s) => s.phase)
  const stepIndex = useDemoStore((s) => s.stepIndex)
  const runToken = useDemoStore((s) => s.runToken)
  const playing = useDemoStore((s) => s.playing)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepDoneRef = useRef(-1)
  const runRef = useRef<{ token: number; step: number } | null>(null)
  const bookingInflight = useRef<Promise<{ bookingRef: string; bookingId: string }> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleAdvance = useCallback(
    (holdMs: number) => {
      clearTimer()
      const s = useDemoStore.getState()
      if (!s.active || s.phase !== 'running' || !s.playing) return
      const atStep = s.stepIndex
      timerRef.current = setTimeout(() => {
        const cur = useDemoStore.getState()
        if (!cur.active || cur.phase !== 'running' || !cur.playing || cur.stepIndex !== atStep) return
        if (cur.stepIndex >= DEMO_STEP_COUNT - 1) cur.finish()
        else cur.next()
      }, Math.max(400, holdMs / (s.speed || 1)))
    },
    [clearTimer]
  )

  // ---------- small ensure-helpers (make every step idempotent + jump-safe) ----------

  const ensureCustomer = useCallback(async (): Promise<string> => {
    const app = useAppStore.getState()
    if (app.user?.role === 'CUSTOMER' && app.user.customerId) return app.user.customerId
    const res = await signInAs<{ ok: boolean; user: DemoUser }>('CUSTOMER')
    if (!res.user) throw new Error('Demo customer identity unavailable. Run: npm run db:seed')
    useAppStore.getState().login(res.user)
    if (!res.user.customerId) throw new Error('Demo customer identity has no customerId')
    return res.user.customerId
  }, [])

  /** Replay the WhatsApp conversation up to the "ready to confirm" state. */
  const ensureReadyWaState = useCallback(async (): Promise<Record<string, unknown>> => {
    const data = d()
    let state = (data.waState ?? null) as Record<string, unknown> | null
    if (!state) {
      // jumped straight here — replay the request message first
      const customerId = await ensureCustomer()
      const r1: WaBotResponse = await api.post('/api/ai/wa-bot', { customerId, message: DEMO_WA_MESSAGE, lang: 'mr', state: { stage: 'new' } })
      state = r1.state as Record<string, unknown>
      put({ waReqSent: DEMO_WA_MESSAGE, waReqReplies: r1.replies.map((x) => x.text), waState: state })
    }
    // walk the slot-filling machine until dispatch-ready (location → time → ready)
    for (let i = 0; i < 3; i += 1) {
      const st = state as { stage?: string }
      if (st.stage === 'ready') break
      const customerId = await ensureCustomer()
      if (st.stage === 'awaiting_time') {
        const r: WaBotResponse = await api.post('/api/ai/wa-bot', { customerId, message: 'now', lang: 'mr', state })
        state = r.state as Record<string, unknown>
        put({
          waTimeSent: '⚡ Right now',
          waTimeReplies: r.replies.map((x) => x.text),
          waState: state,
          ...(r.workerCard
            ? {
                workerId: r.workerCard.workerId,
                workerName: r.workerCard.workerName,
                coopName: r.workerCard.coopName,
                workerRating: r.workerCard.rating,
                distanceKm: r.workerCard.distanceKm,
                etaMin: r.workerCard.etaMin,
              }
            : {}),
        })
      } else {
        const r: WaBotResponse = await api.post('/api/ai/wa-bot', { customerId, message: `📍 ${DEMO_AREA}`, lang: 'mr', state })
        state = r.state as Record<string, unknown>
        put({
          waLocSent: `📍 ${DEMO_AREA}`,
          waLocReplies: r.replies.map((x) => x.text),
          waState: state,
          ...(r.workerCard
            ? {
                workerId: r.workerCard.workerId,
                workerName: r.workerCard.workerName,
                coopName: r.workerCard.coopName,
                workerRating: r.workerCard.rating,
                distanceKm: r.workerCard.distanceKm,
                etaMin: r.workerCard.etaMin,
              }
            : {}),
        })
      }
    }
    const final = state as { stage?: string }
    if (final.stage !== 'ready') throw new Error('WhatsApp assistant did not reach the ready-to-dispatch state')
    return state
  }, [ensureCustomer])

  /** Run the AI match (read-only) and collect the worker card + pipeline. */
  const ensureMatch = useCallback(async (): Promise<MatchResponse> => {
    const data = d()
    if (data.workerId && data.pipeline && data.price) {
      // already collected this run — no refetch needed
      return { ok: true, best: null, alternatives: [], priceEstimate: { base: data.price.base, urgencySurcharge: data.price.urgencySurcharge, eveningSurcharge: 0, total: data.price.total, floor: data.price.floor, ceiling: data.price.ceiling, estimatedMinutes: 0, welfareNote: '', policyNote: '' }, pipeline: data.pipeline, weights: undefined, aiLabel: '', policySummary: [] } as unknown as MatchResponse
    }
    const customerId = await ensureCustomer()
    const res: MatchResponse = await api.post('/api/match', { categoryKey: 'plumber', area: DEMO_AREA, urgency: 'EMERGENCY', customerId })
    if (!res.best) throw new Error('No cooperative worker matched for the demo scenario — check seed data (plumber in Kothrud).')
    put({
      pipeline: res.pipeline,
      searchArea: DEMO_AREA,
      alternativesCount: res.alternatives?.length ?? 0,
      workerId: res.best.id,
      workerName: res.best.name,
      coopName: res.best.cooperativeName,
      workerRating: res.best.rating,
      distanceKm: res.best.distanceKm,
      etaMin: res.best.etaMin,
      score: res.best.score,
      certName: res.best.certName,
      certStatus: res.best.certStatus,
      price: { base: res.priceEstimate.base, urgencySurcharge: res.priceEstimate.urgencySurcharge, total: res.priceEstimate.total, floor: res.priceEstimate.floor, ceiling: res.priceEstimate.ceiling },
    })
    return res
  }, [ensureCustomer])

  const ensureWorkerIdentity = useCallback(async (): Promise<{ workerId: string; coopId: string; coopName: string }> => {
    const data = d()
    if (data.workerId && data.coopId && data.coopName) return { workerId: data.workerId, coopId: data.coopId, coopName: data.coopName }
    await ensureMatch()
    const workerId = d().workerId
    if (!workerId) throw new Error('Matched worker unavailable')
    const res = await api.get<{ ok: boolean; worker: { id: string; name: string; primarySkill: string; emergencyPool: boolean }; cooperative: { id: string; name: string } }>(`/api/worker?id=${workerId}`)
    put({ coopId: res.cooperative.id, coopName: res.cooperative.name, workerName: res.worker.name })
    return { workerId: res.worker.id, coopId: res.cooperative.id, coopName: res.cooperative.name }
  }, [ensureMatch])

  /** Poll GET /api/bookings/[id] — each fetch ticks the time-accelerated engine forward.
   *  `isLive` keeps the loop running only while THIS step is still the current one;
   *  when the demo moves on (fast Next clicks) the poll stops silently so a stale
   *  poll can neither leak notes nor fire a timeout into a later step. */
  const pollBooking = useCallback(
    async (id: string, until: string[], opts: { timeoutMs: number; note?: (b: BookingDTO, elapsedS: number, polls: number) => string; isLive?: () => boolean }): Promise<BookingDTO> => {
      const started = Date.now()
      let polls = 0
      for (;;) {
        const res = await api.get<{ ok: boolean; booking: BookingDTO }>(`/api/bookings/${id}`)
        const b = res.booking
        polls += 1
        put({ bookingStatus: b.status, timeline: b.timeline })
        const elapsedS = Math.round((Date.now() - started) / 1000)
        if (opts.note && (!opts.isLive || opts.isLive())) useDemoStore.getState().setNote(opts.note(b, elapsedS, polls))
        if (until.includes(b.status)) return b
        if (opts.isLive && !opts.isLive()) return b // step moved on — the newer step owns the story now
        if (Date.now() - started > opts.timeoutMs) throw new Error(`Timed out waiting for booking status ${until.join(' / ')} (last: ${b.status})`)
        await sleep(POLL_MS)
      }
    },
    []
  )

  const getBooking = useCallback(async (id: string): Promise<BookingDTO> => {
    const res = await api.get<{ ok: boolean; booking: BookingDTO }>(`/api/bookings/${id}`)
    put({ bookingStatus: res.booking.status, timeline: res.booking.timeline })
    return res.booking
  }, [])

  const ensureBooking = useCallback(async (): Promise<{ bookingRef: string; bookingId: string }> => {
    const data = d()
    if (data.bookingId && data.bookingRef) return { bookingRef: data.bookingRef, bookingId: data.bookingId }
    // in-flight memo: fast Next clicks must never double-create the booking
    if (bookingInflight.current) return bookingInflight.current
    bookingInflight.current = (async (): Promise<{ bookingRef: string; bookingId: string }> => {
      const state = await ensureReadyWaState()
      const customerId = await ensureCustomer()
      const resp: WaBotResponse = await api.post('/api/ai/wa-bot', { customerId, confirm: true, state, demoScript: true })
      if (!resp.bookingRef || !resp.bookingId) throw new Error('Booking confirmation did not return a booking reference')
      put({
        bookingRef: resp.bookingRef,
        bookingId: resp.bookingId,
        waConfirmReplies: resp.replies.map((x) => x.text),
        bookingStatus: 'REQUESTED',
      })
      return { bookingRef: resp.bookingRef, bookingId: resp.bookingId }
    })()
    try {
      return await bookingInflight.current
    } finally {
      bookingInflight.current = null
    }
  }, [ensureCustomer, ensureReadyWaState])

  // ---------- the step executor ----------

  const runStep = useCallback(
    async (index: number) => {
      const step = DEMO_SCRIPT[index]
      if (!step) return
      useDemoStore.getState().setNote('')
      const app = useAppStore.getState()
      /** true while THIS step is still the live one (guards notes from stale async work) */
      const live = () => useDemoStore.getState().stepIndex === index && useDemoStore.getState().phase === 'running'

      switch (step.id) {
        // 01 — Customer App: Anita's home screen, three ways in (app / WhatsApp / voice)
        case 'customer-request': {
          await ensureCustomer()
          // FIX (retained): login() resets the view, so set it AFTER ensureCustomer().
          app.setView('customer')
          const me = await api.get<{ ok: boolean; user: { name: string; area?: string } }>('/api/session').catch(() => null)
          put({ searchArea: DEMO_AREA })
          useDemoStore.getState().setNote(`${me?.user?.name ?? DEMO_SCENARIO_ENTITIES.customer} · ${DEMO_AREA}`)
          break
        }

        // 02 — Multilingual WhatsApp request (Marathi, no app install)
        case 'wa-request': {
          const customerId = await ensureCustomer()
          app.setView('whatsapp')
          const resp: WaBotResponse = await api.post('/api/ai/wa-bot', { customerId, message: DEMO_WA_MESSAGE, lang: 'mr', state: { stage: 'new' } })
          put({ waReqSent: DEMO_WA_MESSAGE, waReqReplies: resp.replies.map((x) => x.text), waState: resp.state })
          break
        }

        // 03 — AI understands the same free text
        case 'ai-understand': {
          // FIX: login() resets the view, so the WhatsApp view must be set AFTER
          // ensureCustomer(), otherwise the narration and the screen disagree.
          await ensureCustomer()
          app.setView('whatsapp')
          const res = await api.post<{ ok: boolean; analysis: DemoData['analysis'] }>('/api/ai/analyze', { description: DEMO_WA_MESSAGE, categoryKey: 'plumber', lang: 'mr' })
          put({ analysis: res.analysis })
          break
        }

        // 04 — Worker discovery: the bot reaches the worker card AND the matching
        //      pipeline runs, so the screen shows the discovered workforce.
        case 'match-search': {
          await ensureCustomer()
          app.setView('whatsapp')
          // Advance the conversation to the ready card (this is where the bot
          // asks for Kothrud and shows the matched worker).
          await ensureReadyWaState()
          let rot = 0
          useDemoStore.getState().setNote(rotatingNote(rot++))
          const rotation = setInterval(() => useDemoStore.getState().setNote(rotatingNote(rot++)), 600)
          try {
            const res = await ensureMatch()
            useDemoStore.getState().setNote(res.pipeline?.length ? `${res.pipeline[res.pipeline.length - 1].stage} — done` : '')
          } finally {
            clearInterval(rotation)
          }
          break
        }

        // 05 — Fair matching: one best worker + the fair price range
        case 'match-select': {
          await ensureCustomer()
          app.setView('whatsapp')
          await ensureMatch()
          break
        }

        // 06 — Remote consultation overlay (deterministic simulation, no camera/mic)
        case 'remote-consult': {
          await ensureCustomer()
          app.setView('whatsapp')
          await ensureMatch()
          // The overlay itself is rendered by DemoVideoCall from consultOpen; the
          // engine only has to make sure both parties exist before it opens.
          useDemoStore.getState().setConsultOpen(true)
          useDemoStore.getState().setNote('Remote consultation…')
          break
        }

        // 07 — WORKER ACCEPTS: the customer confirms, a real booking is created,
        //       then the view switches to the worker's phone and he accepts.
        case 'confirm': {
          await ensureCustomer()
          const { bookingRef, bookingId } = await ensureBooking()
          useAppStore.getState().openBookingByRef(bookingRef)

          // Now borrow the worker's phone so the ACCEPT is visibly HIS decision
          // (spec §13 — "Workers receive relevant requests and choose whether to
          // accept them"). Governance stays human on both sides.
          const { workerId, coopId, coopName } = await ensureWorkerIdentity()
          const res = await api.get<{ ok: boolean; worker: { id: string; name: string; primarySkill: string; emergencyPool: boolean } }>(`/api/worker?id=${workerId}`)
          const w = res.worker
          useAppStore.getState().login({
            id: w.id,
            name: w.name,
            role: 'WORKER',
            title: `${w.primarySkill.charAt(0).toUpperCase() + w.primarySkill.slice(1)} · ${w.emergencyPool ? 'emergency pool' : 'cooperative roster'}`,
            workerId: w.id,
            orgId: coopId,
            orgName: coopName,
          })
          app.setView('worker')
          await pollBooking(bookingId, ['ACCEPTED', 'ON_THE_WAY', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'REVIEWED'], {
            timeoutMs: 30000,
            isLive: live,
            note: (b, s) => (s <= 1 ? 'Checking local cooperative…' : `Confirming worker acceptance… ${s}s (${b.status})`),
          })
          qc.invalidateQueries()
          break
        }

        // 08 — SERVICE TRACKING (customer's view polls the live lifecycle)
        case 'on-the-way': {
          const { bookingId } = await ensureBooking()
          await pollBooking(bookingId, ['ON_THE_WAY', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'REVIEWED'], {
            timeoutMs: 60000,
            isLive: live,
            note: (b, s) => `${d().workerName ?? 'Worker'} en route — live status ${b.status} · ${s}s`,
          })
          break
        }

        // 09 — SERVICE COMPLETED
        case 'complete': {
          const { bookingId } = await ensureBooking()
          await pollBooking(bookingId, ['COMPLETED', 'PAID', 'REVIEWED'], {
            timeoutMs: 110000,
            isLive: live,
            note: (b, s) => `Work in progress on site — live status ${b.status} · ${s}s`,
          })
          break
        }

        // 10 — PAYMENT + FAIRWORK LEDGER.
        // Settles the job, then submits the two-sided trust rating. The engine
        // NEVER rates before the job is settled: it waits for completion, pays
        // if needed, and only then rates — that ordering is the whole point of
        // the FairWork ledger.
        case 'payment': {
          await ensureCustomer()
          const { bookingRef, bookingId } = await ensureBooking()
          useAppStore.getState().openBookingByRef(bookingRef)
          let b = await getBooking(bookingId)
          if (['REQUESTED', 'ACCEPTED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(b.status)) {
            b = await pollBooking(bookingId, ['COMPLETED', 'PAID', 'REVIEWED'], { timeoutMs: 110000, isLive: live, note: (_bb, s) => `Waiting for service completion… ${s}s` })
          }
          if (b.status === 'COMPLETED') {
            useDemoStore.getState().setNote('Settling via the cooperative payment rail…')
            const res = await api.patch<{ ok: boolean; booking: BookingDTO }>(`/api/bookings/${bookingId}`, { action: 'pay', method: 'UPI (Demo Payment)' })
            put({ payment: res.booking.payment ?? null, bookingStatus: res.booking.status, timeline: res.booking.timeline })
            b = res.booking
          } else {
            put({ payment: b.payment ?? null })
          }

          // sub-scene 10b — the FairWork ledger's two-sided feedback
          const review = 'Fixed the burst pipe within the hour. Very professional — will call the cooperative again.'
          if (b.status !== 'REVIEWED') {
            useDemoStore.getState().setNote('Submitting the two-sided trust rating…')
            const rated = await api.patch<{ ok: boolean; booking: BookingDTO }>(`/api/bookings/${bookingId}`, {
              action: 'rate',
              rating: DEMO_RATING,
              review,
              factors: { quality: DEMO_RATING, timeliness: DEMO_RATING, behaviour: DEMO_RATING, communication: DEMO_RATING },
            })
            put({ rating: rated.booking.rating ?? DEMO_RATING, review, bookingStatus: rated.booking.status, timeline: rated.booking.timeline })
          } else {
            put({ rating: b.rating ?? DEMO_RATING, review: b.review ?? review })
          }
          qc.invalidateQueries()
          break
        }


        // 13 — Cooperative dashboard updates (drill into the matched worker's coop)
        case 'coop-update': {
          const { coopId } = await ensureWorkerIdentity()
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('COOP_ADMIN')
          if (!res.user) throw new Error('COOP_ADMIN demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          useAppStore.getState().drillTo('coop', { coop: coopId })
          useDemoStore.getState().setNote('Opening the cooperative dashboard…')
          const coop = await api.get<{ ok: boolean; cooperative: { name: string; workerCount: number }; analytics: { jobsToday: number; utilization: number; activeToday: number } }>(`/api/coop?id=${coopId}`)
          put({
            coopKpis: {
              name: coop.cooperative.name,
              workers: coop.cooperative.workerCount,
              jobsToday: coop.analytics.jobsToday,
              utilization: coop.analytics.utilization,
              activeToday: coop.analytics.activeToday,
            },
          })
          qc.invalidateQueries()
          break
        }

        // 14 — District demand increases
        case 'district-demand': {
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('DISTRICT_COORD')
          if (!res.user) throw new Error('DISTRICT_COORD demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          useAppStore.getState().drillTo('district', {})
          const districtId = res.user.districtId
          useDemoStore.getState().setNote('Aggregating taluka rollups…')
          const dash = await api.get<{ ok: boolean; district: { name: string; jobsToday: number; workers: number; coordinator: string; demandJson: Record<string, string> } }>(`/api/hierarchy/dashboard?level=district${districtId ? `&id=${districtId}` : ''}`)
          put({
            district: {
              name: dash.district.name,
              jobsToday: dash.district.jobsToday,
              workers: dash.district.workers,
              plumberDemand: dash.district.demandJson?.plumber ?? 'HIGH',
              coordinator: dash.district.coordinator,
            },
          })
          break
        }

        // 12 — TALUKA COORDINATION (Haveli): local capacity + demand + AI recommendation
        case 'taluka-capacity': {
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('TALUKA_COORD')
          if (!res.user) throw new Error('TALUKA_COORD demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          useAppStore.getState().drillTo('taluka', {})
          useDemoStore.getState().setNote('Aggregating Haveli taluka capacity…')
          const dash = await api.get<{
            ok: boolean
            taluka: {
              name: string
              workers: number
              availableWorkers: number
              jobsToday: number
              emergencyCapacity: number
              utilizationPct: number
              recommendation?: string
            }
          }>('/api/hierarchy/dashboard?level=taluka')
          const t = dash.taluka
          put({
            taluka: {
              name: t.name,
              workers: t.workers,
              available: t.availableWorkers,
              jobsToday: t.jobsToday,
              emergencyCapacity: t.emergencyCapacity,
              utilization: t.utilizationPct,
              recommendation: t.recommendation,
            },
          })
          break
        }

        // 14 — STATE FEDERATION: network-level capacity across districts
        case 'state-network': {
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('STATE_ADMIN')
          if (!res.user) throw new Error('STATE_ADMIN demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          useAppStore.getState().drillTo('state', {})
          useDemoStore.getState().setNote('Rolling up state-wide workforce capacity…')
          const dash = await api.get<{
            ok: boolean
            federation: { name: string; districts: number; cooperatives: number; workers: number; activeWorkers: number; jobsToday: number }
            districts: Array<{ id: string; name: string; jobsToday: number; workers: number; demand: Record<string, string> }>
          }>('/api/hierarchy/dashboard?level=state')
          const f = dash.federation
          put({
            stateFed: {
              name: f.name,
              districts: dash.districts?.length ?? f.districts ?? 0,
              cooperatives: f.cooperatives,
              workers: f.workers,
              activeWorkers: f.activeWorkers,
              jobsToday: f.jobsToday,
            },
          })
          break
        }

        // 15 — NATIONAL APEX: the aggregated cooperative workforce network
        case 'national-apex': {
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('NATIONAL_ADMIN')
          if (!res.user) throw new Error('NATIONAL_ADMIN demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          useAppStore.getState().drillTo('national', {})
          useDemoStore.getState().setNote('Aggregating the national cooperative network…')
          const dash = await api.get<{
            ok: boolean
            national: Record<string, number | string>
            stateFed: { id: string; name: string; region: string; workers: number } | null
          }>('/api/hierarchy/dashboard?level=national')
          const n = dash.national ?? {}
          const num = (v: unknown) => (typeof v === 'number' ? v : 0)
          put({
            national: {
              states: num(n.states ?? n.statesCovered),
              federations: num(n.federations),
              districts: num(n.districts),
              cooperatives: num(n.cooperatives),
              workers: num(n.workers),
              jobsToday: num(n.jobsToday),
            },
          })
          break
        }

        // 16 — INSTITUTIONAL SERVICES (St. Mary's Boys Hostel)
        case 'institution-amc': {
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('INSTITUTION')
          if (!res.user) throw new Error('INSTITUTION demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          // The institution portal is a tab inside the customer view.
          app.setView('customer')
          useDemoStore.getState().setNote('Opening the institution portal…')
          const contracts = await api.get<{ ok: boolean; contracts?: unknown[]; amc?: unknown[] }>('/api/institution').catch(() => ({ ok: false }) as { ok: boolean; contracts?: unknown[] })
          const dueCount = Array.isArray(contracts.contracts) ? contracts.contracts.length : 0
          put({ institution: { name: DEMO_SCENARIO_ENTITIES.institution, dueCount } })
          break
        }

        // 17 — WORKFORCE INTELLIGENCE, with sub-scene 17A (Service Exchange) and
        //       17B (AI Workforce Intelligence). Combines the former ai-shortage
        //       and exchange-approve steps so the Cooperative Service Exchange is
        //       not lost, per spec §23.
        case 'workforce-intelligence': {
          const { coopName } = await ensureWorkerIdentity()

          // ---- 17A: capacity exchange, recommended then human-approved ----
          useDemoStore.getState().setSubScene(0)
          useAppStore.getState().setView('exchange')
          useDemoStore.getState().setNote('Running the demand forecast model…')
          const fc = await api.get<{
            ok: boolean
            label: string
            categories: Array<{ categoryKey: string; baseWeekend: number; expectedWeekend: number; pct: number; trend: string; drivers: string[] }>
          }>('/api/ai/forecast?zone=pune-z4')
          // FIX (retained): an empty category list used to throw a TypeError and
          // break the step. Fall back to an empty forecast instead.
          const plumber = fc.categories.find((c) => c.categoryKey === 'plumber') ?? fc.categories[0]
          const forecast = plumber
            ? { zoneLabel: fc.label, baseWeekend: plumber.baseWeekend, expectedWeekend: plumber.expectedWeekend, pct: plumber.pct, trend: plumber.trend, drivers: plumber.drivers }
            : { zoneLabel: fc.label, baseWeekend: 0, expectedWeekend: 0, pct: 0, trend: 'flat' as const, drivers: [] as string[] }
          put({ forecast })

          let exchange = d().exchange
          if (exchange?.id) {
            if (exchange.status !== 'APPROVED') {
              await api.patch('/api/exchange', { id: exchange.id, action: 'approve', by: 'Meera Kulkarni — Pune District Coordinator (demo)' })
              exchange = { ...exchange, status: 'APPROVED', approvedBy: 'Meera Kulkarni — Pune District Coordinator (demo)' }
              put({ exchange })
            }
          } else {
            const shortfall = Math.max(0, forecast.expectedWeekend - forecast.baseWeekend)
            const workerCount = Math.min(6, Math.max(2, Math.ceil(shortfall / 2) || 3))
            useDemoStore.getState().setNote('Registering the capacity-exchange recommendation…')
            const rec = await api.post<{ ok: boolean; recommendation: { id: string } }>('/api/exchange', {
              skill: 'plumber',
              fromCoopName: 'Maval Pani-Puravanch Shramik Sahakari Sanstha',
              toCoopId: d().coopId,
              toCoopName: coopName,
              districtName: DEMO_SCENARIO_ENTITIES.district,
              workerCount,
              distanceKm: areaDistance('Maval Market', DEMO_AREA),
              expectedDemand: forecast.expectedWeekend,
              durationDays: 7,
              rationale: `Zone 4 weekend plumbing demand up ${forecast.pct}% (${forecast.baseWeekend} → ${forecast.expectedWeekend} jobs). Mutual-aid deputation protects emergency response time — ${DEMO_GOVERNANCE}.`,
              demo: true,
            })
            useDemoStore.getState().setNote('Awaiting human approval…')
            // A HUMAN approves. Workers are never auto-transferred.
            await api.patch('/api/exchange', { id: rec.recommendation.id, action: 'approve', by: 'Meera Kulkarni — Pune District Coordinator (demo)' })
            exchange = {
              id: rec.recommendation.id,
              fromCoopName: 'Maval Pani-Puravanch Shramik Sahakari Sanstha',
              toCoopName: coopName,
              workerCount,
              durationDays: 7,
              distanceKm: areaDistance('Maval Market', DEMO_AREA),
              expectedDemand: forecast.expectedWeekend,
              status: 'APPROVED',
              approvedBy: 'Meera Kulkarni — Pune District Coordinator (demo)',
            }
            put({ exchange })
          }

          // ---- 17B: AI workforce intelligence ----
          useDemoStore.getState().setSubScene(1)
          useDemoStore.getState().setNote('Aggregating skill-gap and allocation signals…')
          const gap = await api
            .get<{ ok: boolean; totalGap?: number }>(`/api/skill-gaps?district=${DEMO_SCENARIO_ENTITIES.district}`)
            .catch(() => ({ ok: false }) as { ok: boolean; totalGap?: number })
          put({ subSceneId: 'intelligence' })
          useAppStore.getState().setView('ai')
          qc.invalidateQueries()
          break
        }

        // Supporting scene — PLATFORM ADMIN (spec §24: deliberately unnumbered)
        case 'platform-admin': {
          const res = await signInAs<{ ok: boolean; user: DemoUser }>('PLATFORM_ADMIN')
          if (!res.user) throw new Error('PLATFORM_ADMIN demo identity unavailable. Run: npm run db:seed')
          useAppStore.getState().login(res.user)
          useAppStore.getState().setView('platform')
          useDemoStore.getState().setNote('System-wide operational visibility…')
          type AdminOps = {
            ok: boolean
            counts?: { workers?: number; cooperatives?: number; bookings?: number; openComplaints?: number }
          }
          const ops = await api.get<AdminOps>('/api/admin').catch((): AdminOps => ({ ok: false }))
          const c = ops.counts ?? {}
          put({
            platform: {
              workers: c.workers ?? 0,
              cooperatives: c.cooperatives ?? 0,
              bookings: c.bookings ?? 0,
              openComplaints: c.openComplaints ?? 0,
            },
          })
          qc.invalidateQueries()
          break
        }

        // Supporting scene — COMPLETE INTELLIGENCE LOOP (spec §25)
        case 'intelligence-loop': {
          app.setView('ai')
          useDemoStore.getState().setNote('Every service feeds the next forecast…')
          // Warm the forecast so the closing scene shows a real number.
          const fc = await api.get<{ ok: boolean; label: string; categories: Array<{ categoryKey: string; baseWeekend: number; expectedWeekend: number; pct: number; trend: string; drivers: string[] }> }>('/api/ai/forecast?zone=pune-z4').catch(() => null)
          const plumber = fc?.categories?.find((c) => c.categoryKey === 'plumber') ?? fc?.categories?.[0]
          if (plumber && fc) {
            put({ forecast: { zoneLabel: fc.label, baseWeekend: plumber.baseWeekend, expectedWeekend: plumber.expectedWeekend, pct: plumber.pct, trend: plumber.trend, drivers: plumber.drivers } })
          }
          break
        }

        // Supporting scene — CLOSING CARD (spec §26)
        case 'closing': {
          useDemoStore.getState().setNote('')
          break
        }

        default:
          // Spec §41 — the demo must NEVER get stuck. An unhandled step is
          // logged and skipped rather than thrown, so a single bad step cannot
          // abort a live recording. The exhaustive-case guard below is what
          // catches drift at build time instead.
          console.warn(`[gigsetu-demo] no action for step "${step.id}" — continuing`)
          break
      }

    },
    [ensureBooking, ensureCustomer, ensureMatch, ensureReadyWaState, ensureWorkerIdentity, getBooking, pollBooking, qc]
  )

  // ---- engine effect: execute the current step whenever it becomes due ----
  useEffect(() => {
    if (!active || phase !== 'running') return
    if (runRef.current && runRef.current.token === runToken && runRef.current.step === stepIndex) return
    runRef.current = { token: runToken, step: stepIndex }
    stepDoneRef.current = -1
    clearTimer()
    let alive = true
    runStep(stepIndex)
      .then(() => {
        if (!alive) return
        const s = useDemoStore.getState()
        if (!s.active || s.phase !== 'running' || s.stepIndex !== stepIndex) return
        stepDoneRef.current = stepIndex
        scheduleAdvance(DEMO_SCRIPT[stepIndex]?.dwellMs ?? 4000)
      })
      .catch((e: unknown) => {
        if (!alive) return
        // a stale step (judge already clicked Next) must never fail the whole demo
        const s = useDemoStore.getState()
        if (!s.active || s.phase !== 'running' || s.stepIndex !== stepIndex) return
        const msg = e instanceof Error ? e.message : 'Step failed'
        useDemoStore.getState().setNote('Step interrupted — press Retry (Next) to run it again.')
        useDemoStore.getState().fail(msg)
      })
    return () => {
      alive = false
    }
  }, [active, phase, stepIndex, runToken, runStep, scheduleAdvance, clearTimer])

  // ---- resume auto-advance when Play is pressed after the action already finished ----
  useEffect(() => {
    if (!playing) {
      clearTimer()
      return
    }
    const s = useDemoStore.getState()
    if (!s.active || s.phase !== 'running') return
    if (stepDoneRef.current === s.stepIndex && !timerRef.current) scheduleAdvance(DEMO_SCRIPT[s.stepIndex]?.dwellMs ?? 4000)
  }, [playing, scheduleAdvance, clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  return null
}
