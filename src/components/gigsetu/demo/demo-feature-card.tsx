'use client'

/**
 * Demo Feature Card (spec §31).
 *
 * Exactly one heading + one short sentence, pinned to a corner so it never
 * covers the application content it is describing. Appears at the start of a
 * step and fades before the next transition.
 *
 * Presentational only — the controller decides when it is visible.
 */
import { Sparkles } from 'lucide-react'

export function DemoFeatureCard({
  heading,
  sentence,
  visible = true,
  /** optional governance line, e.g. "AI RECOMMENDS · COOPERATIVE GOVERNS" */
  footer,
}: {
  heading: string
  sentence: string
  visible?: boolean
  footer?: string
}) {
  return (
    <div
      data-demo-target="feature-card"
      aria-hidden={!visible}
      className={[
        'pointer-events-none fixed bottom-4 right-4 z-40 w-[min(21rem,calc(100vw-2rem))] rounded-xl border border-primary/25 bg-card/95 p-3 shadow-lg backdrop-blur',
        'transition-all duration-500 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-primary">
        <Sparkles className="h-3 w-3" aria-hidden />
        Feature demo
      </div>
      <p className="mt-1 text-[12px] font-bold uppercase leading-tight tracking-wide text-foreground">
        {heading}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sentence}</p>
      {footer && (
        <p className="mt-1.5 border-t pt-1.5 text-[9px] font-bold uppercase tracking-wider text-primary">
          {footer}
        </p>
      )}
    </div>
  )
}
