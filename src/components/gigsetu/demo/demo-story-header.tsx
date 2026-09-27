'use client'

/**
 * Demo Story Header (spec §02 / §29).
 *
 * The mandatory "where are we / what is happening" indicator that sits at the
 * top of the SIH demo bar. Three levels of information (spec §44):
 *
 *   LEVEL 1 — STORY      05 / 17 — FAIR MATCHING
 *   LEVEL 2 — SCENARIO   LIVE SCENARIO · Emergency Plumbing | Kothrud
 *   LEVEL 3 — WHY        one sentence describing what is happening
 *
 * Deliberately compact: the application screen must stay the visual focus
 * during a screen recording, so this is a thin strip, not a banner.
 *
 * Purely presentational and driven entirely by props — it holds no timing logic
 * (that all lives in the centralized demo script + controller).
 */
import { Activity, MapPin } from 'lucide-react'

export function DemoStoryHeader({
  currentStep,
  totalSteps,
  scenario,
  title,
  description,
  /** true for the unnumbered supporting scenes (platform admin / loop / closing) */
  supporting = false,
  active = true,
}: {
  currentStep: number
  totalSteps: number
  scenario: string
  title: string
  description: string
  supporting?: boolean
  active?: boolean
}) {
  const stepText = supporting
    ? title
    : `${String(currentStep).padStart(2, '0')} / ${totalSteps} — ${title}`

  return (
    <div
      data-demo-target="story-header"
      className={[
        'border-b bg-card/95 px-3 py-2 backdrop-blur transition-opacity duration-300 sm:px-4',
        active ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        {/* LEVEL 2 — the one continuous scenario, identical for every step */}
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          <Activity className="h-3 w-3" aria-hidden />
          Live scenario
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-foreground">
          <MapPin className="h-3 w-3 text-muted-foreground" aria-hidden />
          {scenario}
        </span>

        {/* LEVEL 1 — where we are in the story */}
        <span className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-wider text-foreground sm:ml-0">
          {stepText}
        </span>
      </div>

      {/* LEVEL 3 — why it matters. One sentence, wraps to at most two lines. */}
      <p className="mx-auto mt-1 w-full max-w-6xl text-[11px] leading-snug text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
