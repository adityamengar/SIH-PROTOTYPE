'use client'

import type { View } from '@/store/app-store'
import type { PaymentRecord } from '@/lib/types'

/**
 * Phase 6 #50 — SIH Demo Mode script definition.
 *
 * This file is the SINGLE centralized demo configuration (spec §27). Every step
 * carries its own number, title, scenario, description, dwell time, narration,
 * voiceover, highlight target and sub-scenes, so no timing or copy logic is
 * scattered across individual pages. demo-engine.tsx executes the actions;
 * demo-panel.tsx and the story header render them.
 *
 * The story is ONE continuous scenario — an emergency plumbing request from
 * Kothrud flowing through the entire cooperative ecosystem against real APIs.
 *
 * ENTITY NAMING (spec §05 / §39)
 * ------------------------------
 * The worker name is NEVER hardcoded. The matching engine deterministically
 * returns a real seeded record ("Rajesh Kumar", plumber, Haveli Plumbing &
 * Sanitation Cooperative) for this scenario, and the story header renders that
 * same live value. Hardcoding a different name would put one identity in the
 * header and another on screen in the same frame during a recording — exactly
 * the inconsistency the spec forbids. Everything else in the scenario
 * (customer, area, taluka, district, state, institution) matches the seed.
 */


/** Marathi request typed by the customer in the demo (parses → plumber · EMERGENCY · mr). */
export const DEMO_WA_MESSAGE = 'माझ्या घरात पाण्याची पाइप फुटली आहे. तातडीने plumber पाहिजे.'
export const DEMO_AREA = 'Kothrud'
export const DEMO_CUSTOMER_NAME = 'Anita Deshmukh'

/** The single scenario label shown in the story header for every step. */
export const DEMO_SCENARIO = 'Emergency Plumbing | Kothrud'

/** Fixed scenario entities that the seed also uses, so the story stays coherent. */
export const DEMO_SCENARIO_ENTITIES = {
  customer: 'Anita Deshmukh',
  institution: "St. Mary's Boys Hostel",
  taluka: 'Haveli',
  district: 'Pune',
  state: 'Maharashtra',
  service: 'Emergency Plumbing',
  location: 'Kothrud, Pune',
} as const

/** The governance line that must appear wherever AI is shown making a call. */
export const DEMO_GOVERNANCE = 'AI RECOMMENDS · COOPERATIVE GOVERNS'

/** Typed view of everything the engine collects during a run. */
export interface DemoData {
  // steps 1–3 — WhatsApp conversation
  waReqSent?: string
  waReqReplies?: string[]
  waLocSent?: string
  waLocReplies?: string[]
  waTimeSent?: string
  waTimeReplies?: string[]
  waConfirmReplies?: string[]
  /** opaque wa-bot conversation state — echoed back on the next API call */
  waState?: unknown
  analysis?: {
    title?: string
    urgency?: string
    estimatedMinutes?: number | string
    difficulty?: string
    summary?: string
    safetyNotes?: string[]
    source?: string
  } | null
  // steps 4–6 — matching
  pipeline?: Array<{ stage: string; detail: string; count: number }>
  searchArea?: string
  alternativesCount?: number
  workerId?: string
  workerName?: string
  coopId?: string
  coopName?: string
  workerRating?: number
  distanceKm?: number
  etaMin?: number
  score?: number
  certName?: string
  certStatus?: string
  price?: { base: number; urgencySurcharge: number; total: number; floor: number; ceiling: number }
  // steps 7–10 — booking lifecycle
  bookingRef?: string
  bookingId?: string
  bookingStatus?: string
  timeline?: Array<{ status: string; at: string; note?: string }>
  // step 11–12 — settlement + rating
  payment?: PaymentRecord | null
  rating?: number
  review?: string
  // step 13–14 — hierarchy
  coopKpis?: { name: string; workers: number; jobsToday: number; utilization: number; activeToday: number }
  district?: { name: string; jobsToday: number; workers: number; plumberDemand: string; coordinator: string }
  // steps 15–16 — AI + federation
  forecast?: { zoneLabel: string; baseWeekend: number; expectedWeekend: number; pct: number; trend: string; drivers: string[] }
  exchange?: { id: string; fromCoopName: string; toCoopName: string; workerCount: number; durationDays: number; distanceKm: number; expectedDemand: number; status: string; approvedBy?: string | null }
  // taluka / state / national / institution / platform — added for the 17-step story
  taluka?: { name: string; workers: number; available: number; jobsToday: number; emergencyCapacity: number; utilization: number; recommendation?: string }
  stateFed?: { name: string; districts: number; cooperatives: number; workers: number; activeWorkers: number; jobsToday: number }
  national?: { states: number; federations: number; districts: number; cooperatives: number; workers: number; jobsToday: number }
  institution?: { name: string; dueCount: number }
  platform?: { workers: number; cooperatives: number; bookings: number; openComplaints: number }
  /** 17A/17B sub-scene currently shown inside step 17 (spec §23) */
  subSceneId?: string
}

/** What kind of live-data strip the panel renders for this step. */
export type DemoDisplay =
  | 'wa' | 'worker' | 'price' | 'booking' | 'payment' | 'rating'
  | 'coop' | 'district' | 'forecast' | 'exchange'
  | 'consult' | 'tracking' | 'fairwork' | 'taluka' | 'state'
  | 'national' | 'institution' | 'ai' | 'platform' | 'loop' | 'closing'

/**
 * Numbered story steps (01..17) plus unnumbered supporting scenes. Supporting
 * scenes are part of the same run and share the progress bar, but they do not
 * consume a story number (spec §24 — Platform Admin is explicitly "not a new
 * numbered story step").
 */
export interface DemoStep {
  id: string
  /** 1-based step number for the 17 numbered steps; null for supporting scenes */
  num: number | null
  title: string
  /** ultra-short label for the compact progress indicator */
  short: string
  /** app view the engine switches to while this step runs */
  view: View
  /** which role's eyes the audience borrows (labels only) */
  role: string
  display: DemoDisplay
  /** ms the narration holds after the action completes, before auto-advance (at 1x) */
  dwellMs: number
  /**
   * The one-sentence "what is happening" line shown under the step number in
   * the story header (spec §03).
   */
  description: string
  /** Narration built from LIVE collected data — never hardcoded metrics. */
  narration: (d: DemoData) => string
  /** Voiceover script, 1-2 sentences, recorded later (spec §34). */
  voiceover: string
  /** data-demo-target(s) to outline while this step is active (spec §32) */
  highlight?: string[]
  /** short sub-scenes within this step (spec §23 — 17A / 17B) */
  subScenes?: { id: string; label: string; note: string }[]
}

/**
 * The story: 17 numbered steps (spec §03) followed by three unnumbered
 * supporting scenes — Platform Admin (§24), the Complete Intelligence Loop
 * (§25) and the closing card (§26).
 */
export const DEMO_SCRIPT: DemoStep[] = [
  {
    id: 'customer-request', num: 1, title: 'CUSTOMER REQUEST', short: 'REQUEST',
    view: 'customer', role: 'CUSTOMER', display: 'wa', dwellMs: 7000,
    description: 'Customer starts an emergency plumbing request through GigSetu.',
    voiceover: 'Customers can request services through app, WhatsApp or voice.',
    highlight: ['customer-entry'],
    narration: (d) => `${DEMO_CUSTOMER_NAME}, ${DEMO_AREA} — a burst water pipe, and three ways in: app, WhatsApp or voice. She picks WhatsApp because it needs no install.`,
  },
  {
    id: 'wa-request', num: 2, title: 'MULTILINGUAL REQUEST', short: 'REQUEST',
    view: 'whatsapp', role: 'CUSTOMER', display: 'wa', dwellMs: 6500,
    description: 'Customer sends the service request through WhatsApp in Marathi.',
    voiceover: 'GigSetu converts multilingual requests into structured service requirements.',
    highlight: ['wa-thread'],
    narration: (d) => `She messages in her own language: “${d.waReqSent ?? DEMO_WA_MESSAGE}” — no app install, no English needed.`,
  },
  {
    id: 'ai-understand', num: 3, title: 'AI UNDERSTANDS', short: 'AI',
    view: 'whatsapp', role: 'CUSTOMER', display: 'wa', dwellMs: 6000,
    description: 'AI converts the customer request into structured service requirements.',
    voiceover: 'AI extracts service, skill, location and urgency for workforce matching.',
    highlight: ['wa-thread'],
    narration: (d) => `AI reads it instantly: service → Plumbing, skill → Plumber, location → ${DEMO_AREA}, urgency → ${d.analysis?.urgency ?? 'EMERGENCY'}, availability → required now. ~${d.analysis?.estimatedMinutes ?? 60} min job from free text, in Marathi.`,
  },
  {
    id: 'match-search', num: 4, title: 'WORKER DISCOVERY', short: 'MATCH',
    view: 'whatsapp', role: 'CUSTOMER', display: 'worker', dwellMs: 6500,
    description: 'GigSetu searches the verified workforce network using skill, location and availability.',
    voiceover: 'GigSetu discovers eligible workers using skill, location, availability and workload.',
    highlight: ['wa-worker-card'],
    narration: (d) => `The matching pipeline filters ${d.searchArea ?? DEMO_AREA}’s cooperative network${d.pipeline?.length ? ` — ${d.pipeline[0].count} skilled in network → ${d.pipeline[d.pipeline.length - 1].count} final match` : ''}${d.alternativesCount ? `, ${d.alternativesCount} verified alternatives ranked behind it` : ''}.`,
  },
  {
    id: 'match-select', num: 5, title: 'FAIR MATCHING', short: 'MATCH',
    view: 'whatsapp', role: 'CUSTOMER', display: 'worker', dwellMs: 6000,
    description: 'AI recommends a suitable verified worker based on skill, location, availability and workload.',
    voiceover: 'AI recommends a suitable worker while cooperative governance remains human-controlled.',
    highlight: ['wa-worker-card'],
    narration: (d) => `Best-fit worker: ${d.workerName ?? 'the matched worker'} (${d.coopName ?? 'local cooperative'}) — ${d.distanceKm ?? '?'} km away, ETA ~${d.etaMin ?? '?'} min, ★${d.workerRating ?? '?'}. ${DEMO_GOVERNANCE}.`,
  },
  {
    id: 'remote-consult', num: 6, title: 'REMOTE CONSULTATION', short: 'CALL',
    view: 'whatsapp', role: 'CUSTOMER', display: 'consult', dwellMs: 9500,
    description: 'Customer and worker clarify the issue through a simulated video consultation.',
    voiceover: 'Video consultation can help clarify the issue remotely before dispatch.',
    narration: (d) => `Before dispatch, ${DEMO_CUSTOMER_NAME} and ${d.workerName ?? 'the worker'} open a GigSetu remote consultation — deterministic simulation, no camera or microphone — and confirm the likely issue remotely.`,
  },
  {
    id: 'confirm', num: 7, title: 'WORKER ACCEPTS', short: 'CALL',
    view: 'worker', role: 'WORKER', display: 'booking', dwellMs: 6000,
    description: 'The selected worker receives and accepts the service request.',
    voiceover: 'Workers receive relevant requests and choose whether to accept them.',
    highlight: ['worker-job-card'],
    narration: (d) => `The cooperative dispatches it to ${d.workerName ?? 'the worker'}’s phone — a real NEW SERVICE REQUEST with ACCEPT / DECLINE. He accepts, and booking ${d.bookingRef ?? 'GS-…'} becomes live.`,
  },
  {
    id: 'on-the-way', num: 8, title: 'SERVICE TRACKING', short: 'SERVICE',
    view: 'customer', role: 'CUSTOMER', display: 'tracking', dwellMs: 6000,
    description: 'GigSetu records the service lifecycle from acceptance to completion.',
    voiceover: 'Customers can follow service progress while GigSetu records the job lifecycle.',
    highlight: ['booking-timeline'],
    narration: (d) => `Requested → Accepted → On the way → In progress, tracked live by the customer — ${d.workerName ?? 'the worker'} is ${d.distanceKm ?? '?'} km from ${DEMO_AREA}, ETA ~${d.etaMin ?? '?'} min.`,
  },
  {
    id: 'complete', num: 9, title: 'SERVICE COMPLETED', short: 'SERVICE',
    view: 'worker', role: 'WORKER', display: 'booking', dwellMs: 5500,
    description: 'The completed service is recorded in the digital work history.',
    voiceover: 'Completed work becomes part of the worker and cooperative service record.',
    highlight: ['worker-job-card'],
    narration: (d) => `Work marked COMPLETED on ${d.bookingRef ?? 'the booking'} — service completed, work recorded, customer confirmation captured in the digital history.`,
  },
  {
    id: 'payment', num: 10, title: 'PAYMENT + FAIRWORK', short: 'PAY',
    view: 'customer', role: 'CUSTOMER', display: 'payment', dwellMs: 8000,
    description: 'Payment and worker earning records are captured transparently.',
    voiceover: 'Completed services create a transparent digital work and earning record.',
    highlight: ['payment-split'],
    subScenes: [
      { id: 'payment', label: 'PAYMENT RECORDED', note: 'Transparent split: worker + cooperative + welfare + platform.' },
      { id: 'fairwork', label: 'FAIRWORK LEDGER', note: 'Worker earnings · service record · payment status · two-sided feedback.' },
    ],
    narration: (d) => `₹${d.payment?.amount ?? '—'} paid by UPI — split transparently: worker ₹${d.payment?.workerShare ?? '—'}, cooperative ₹${d.payment?.coopCommission ?? '—'}, welfare fund ₹${d.payment?.welfare ?? '—'}, platform ₹${d.payment?.platformFee ?? '—'}. That is the FairWork ledger: earnings, service record, payment status and Anita’s ★${DEMO_RATING} two-sided feedback, which flows into the worker’s Skill Passport.`,
  },
  {
    id: 'coop-update', num: 11, title: 'COOPERATIVE DASHBOARD', short: 'COOP',
    view: 'coop', role: 'COOP_ADMIN', display: 'coop', dwellMs: 7000,
    description: 'The cooperative gains visibility into workers, jobs and service performance.',
    voiceover: 'Cooperatives gain visibility into workers, jobs and service performance.',
    highlight: ['coop-workers-card', 'coop-jobs-card'],
    narration: (d) => `${d.coopKpis?.name ?? 'The cooperative'}’s dashboard already shows it: ${d.coopKpis?.jobsToday ?? '?'} jobs today across ${d.coopKpis?.workers ?? '?'} members, utilisation ${d.coopKpis?.utilization ?? '?'}% — the same single data layer, no re-entry.`,
  },
  {
    id: 'taluka-capacity', num: 12, title: 'TALUKA COORDINATION', short: 'TALUKA',
    view: 'taluka', role: 'TALUKA_COORD', display: 'taluka', dwellMs: 7000,
    description: 'Taluka-level coordination identifies local workforce capacity and demand.',
    voiceover: 'Taluka coordination helps identify local workforce shortages and available capacity.',
    highlight: ['taluka-workers-card', 'taluka-recommendation'],
    narration: (d) => `${d.taluka?.name ?? DEMO_SCENARIO_ENTITIES.taluka} Taluka sees cooperatives, total workers, available, jobs today, emergency capacity and utilisation${d.taluka?.recommendation ? ` — AI recommendation: “${d.taluka.recommendation}”` : ''}.`,
  },
  {
    id: 'district-demand', num: 13, title: 'DISTRICT COMMAND', short: 'DISTRICT',
    view: 'district', role: 'DISTRICT_COORD', display: 'district', dwellMs: 6500,
    description: 'District-level intelligence combines demand and workforce signals.',
    voiceover: 'The district view combines workforce and demand signals across participating talukas.',
    highlight: ['district-demand-by-skill'],
    narration: (d) => `${d.district?.name ?? DEMO_SCENARIO_ENTITIES.district} District Command Center aggregates the event: ${d.district?.jobsToday ?? '?'} jobs today, ${d.district?.workers ?? '?'} workers, and demand by skill with PLUMBING flagged ${d.district?.plumberDemand ?? 'HIGH'}.`,
  },
  {
    id: 'state-network', num: 14, title: 'STATE FEDERATION', short: 'STATE',
    view: 'state', role: 'STATE_ADMIN', display: 'state', dwellMs: 6500,
    description: 'The state federation sees network-level workforce capacity and demand.',
    voiceover: 'The state federation can view workforce capacity and demand patterns across districts.',
    highlight: ['state-workers-card'],
    narration: (d) => `${d.stateFed?.name ?? DEMO_SCENARIO_ENTITIES.state} sees ${d.stateFed?.districts ?? '?'} districts, ${d.stateFed?.cooperatives ?? '?'} cooperatives, ${d.stateFed?.workers ?? '?'} workers and ${d.stateFed?.activeWorkers ?? '?'} active — network capacity on one schematic demand map.`,
  },
  {
    id: 'national-apex', num: 15, title: 'NATIONAL APEX', short: 'NATIONAL',
    view: 'national', role: 'NATIONAL_ADMIN', display: 'national', dwellMs: 6500,
    description: 'The national layer provides an aggregated cooperative workforce view.',
    voiceover: 'The national layer provides an aggregated view of the cooperative workforce network.',
    highlight: ['national-workers-card'],
    narration: (d) => `National Apex aggregates the whole cooperative workforce network: ${d.national?.states ?? '?'} states, ${d.national?.districts ?? '?'} districts, ${d.national?.cooperatives ?? '?'} cooperatives, ${d.national?.workers ?? '?'} workers, ${d.national?.jobsToday ?? '?'} jobs today.`,
  },
  {
    id: 'institution-amc', num: 16, title: 'INSTITUTIONAL SERVICES', short: 'INSTITUTION',
    view: 'customer', role: 'INSTITUTION', display: 'institution', dwellMs: 7000,
    description: 'Institutions can manage recurring services, contracts and maintenance.',
    voiceover: 'Institutions can manage recurring services, contracts, maintenance and payments.',
    highlight: ['institution-contracts'],
    narration: (d) => `${DEMO_SCENARIO_ENTITIES.institution} manages the same layer: contracts / AMC, payments, support and preventive maintenance${d.institution?.dueCount ? ` — ${d.institution.dueCount} service(s) completed, payment due` : ''}, and plans recurring services.`,
  },
  {
    id: 'workforce-intelligence', num: 17, title: 'WORKFORCE INTELLIGENCE', short: 'INTELLIGENCE',
    view: 'exchange', role: 'NATIONAL_ADMIN', display: 'exchange', dwellMs: 8000,
    description: 'GigSetu turns service data into workforce planning recommendations.',
    voiceover: 'GigSetu turns service and workforce data into planning recommendations.',
    highlight: ['exchange-recommendations'],
    subScenes: [
      { id: 'exchange', label: '17A — COOPERATIVE SERVICE EXCHANGE', note: 'Cooperative A has high plumbing demand · Cooperative B has available capacity.' },
      { id: 'intelligence', label: '17B — AI WORKFORCE INTELLIGENCE', note: 'Demand signals + worker availability + historical service data + skill information → recommendations.' },
    ],
    narration: (d) => `17A — the Service Exchange pairs ${d.exchange?.fromCoopName ?? 'Cooperative A'} (high plumbing demand) with ${d.exchange?.toCoopName ?? 'Cooperative B'} (available capacity): ${d.exchange?.workerCount ?? '—'} plumber(s) for ${d.exchange?.durationDays ?? 7} days — ${DEMO_GOVERNANCE}, workers are never auto-transferred. 17B — forecast, skill gap and allocation turn that history into planning.`,
  },
  {
    // ---- unnumbered supporting scenes (spec §24-§26) ----
    id: 'platform-admin', num: null, title: 'SYSTEM OPERATIONS', short: 'PLATFORM',
    view: 'platform', role: 'PLATFORM_ADMIN', display: 'platform', dwellMs: 5000,
    description: 'Platform administration provides system-wide operational visibility.',
    voiceover: 'Platform administration provides system-wide operational visibility.',
    highlight: ['platform-bookings'],
    narration: (d) => `Platform operations: ${d.platform?.workers ?? '?'} workers on network, ${d.platform?.cooperatives ?? '?'} cooperatives, ${d.platform?.bookings ?? '?'} bookings, ${d.platform?.openComplaints ?? '?'} open complaints — bookings over the last 7 days and booking status.`,
  },
  {
    id: 'intelligence-loop', num: null, title: 'COMPLETE INTELLIGENCE LOOP', short: 'LOOP',
    view: 'ai', role: 'NATIONAL_ADMIN', display: 'loop', dwellMs: 8000,
    description: 'Every service contributes to better workforce planning.',
    voiceover: 'Every service becomes a signal, so the next request is matched better.',
    narration: () => `Customer demand → AI understands → worker matching → service → payment + feedback → cooperative data → taluka / district / state insights → AI forecast → capacity planning → better workforce planning → back to customer demand. ${DEMO_GOVERNANCE}.`,
  },
  {
    id: 'closing', num: null, title: 'GIGSETU', short: 'END',
    view: 'ai', role: 'NATIONAL_ADMIN', display: 'closing', dwellMs: 5000,
    description: 'India’s Cooperative Workforce Operating System.',
    voiceover: 'GigSetu connects the cooperative workforce ecosystem.',
    narration: () => `From individual gig workers to a coordinated cooperative workforce. ${DEMO_GOVERNANCE}. Connecting skills. Empowering communities.`,
  },
]

/** Rotation shown in the note line during step 4 while matching runs (#69). */
export const EMERGENCY_PIPELINE_NOTES = [
  'Checking local cooperative…',
  'Checking Taluka reserve…',
  'Checking district capacity…',
]

/**
 * Every story-step id, as a const tuple.
 *
 * This is the single source of truth for step identity. Deriving the union type
 * from it lets the engine prove at COMPILE TIME that it handles every step (see
 * DemoStepId in demo-engine.tsx) — a cast cannot do that, because TypeScript
 * happily allows `someString as 'a' | 'b'`.
 */
export const DEMO_STEP_IDS = [
  'customer-request',
  'wa-request',
  'ai-understand',
  'match-search',
  'match-select',
  'remote-consult',
  'confirm',
  'on-the-way',
  'complete',
  'payment',
  'coop-update',
  'taluka-capacity',
  'district-demand',
  'state-network',
  'national-apex',
  'institution-amc',
  'workforce-intelligence',
  'platform-admin',
  'intelligence-loop',
  'closing',
] as const

/** Union of every step id the story can produce. */
export type DemoStepId = (typeof DEMO_STEP_IDS)[number]

/** Rating the demo customer gives, used by the FairWork ledger narration. */
export const DEMO_RATING = 5

/** Total NUMBERED story steps — the denominator in the story header (spec §03). */
export const DEMO_STORY_STEP_COUNT = DEMO_SCRIPT.filter((s) => s.num !== null).length

/** Steps that carry a story number, in order. */
export const DEMO_NUMBERED_STEPS = DEMO_SCRIPT.filter((s) => s.num !== null)

/** Full run order including the unnumbered supporting scenes. */
export const DEMO_RUN_LENGTH = DEMO_SCRIPT.length

/**
 * The intelligence loop shown in the closing scene (spec §25). Rendered as an
 * ordered chain so the "every service feeds planning" idea is legible at a
 * glance on video.
 */
export const DEMO_INTELLIGENCE_LOOP = [
  'Customer demand',
  'AI understands',
  'Worker matching',
  'Service',
  'Payment + feedback',
  'Cooperative data',
  'Taluka / district / state insights',
  'AI forecast',
  'Capacity planning',
  'Better workforce planning',
] as const

/** Service-tracking states shown in step 08 (spec §14). */
export const DEMO_TRACKING_STATES = [
  'Request accepted',
  'Worker en route',
  'Arrived',
  'Service in progress',
  'Completed',
] as const
