'use client'

/**
 * UI highlight system (spec §32 / §42).
 *
 * Highlights are driven ENTIRELY by data attributes and a single set of targets
 * in the demo store — never by simulated mouse coordinates. That is what keeps
 * the demo reliable when the browser window is resized, which is exactly what
 * happens when someone records at 16:9.
 *
 * Usage on a dashboard element:   data-demo-target="coop-workers-card"
 * A step lists its targets in the centralized script: highlight: ['coop-workers-card']
 *
 * A target that is not present on the current screen is simply skipped
 * (spec §41 — the demo must never get stuck).
 */
import { useEffect } from 'react'
import { useDemoStore } from '@/store/demo-store'

const ATTR = 'data-demo-target'
const CLASS = 'demo-highlight'

/**
 * Imperatively toggles the outline on every element carrying one of the
 * supplied data-demo-target values. Kept out of React's render path so it
 * cannot cause a re-render loop, and so it works on any element on the page
 * without those elements needing to know anything about the demo.
 */
export function useDemoHighlight() {
  const targets = useDemoStore((s) => s.highlight)
  const active = useDemoStore((s) => s.active)

  useEffect(() => {
    const apply = () => {
      const wanted = new Set(active ? targets : [])
      document.querySelectorAll<HTMLElement>(`[${ATTR}]`).forEach((el) => {
        const key = el.getAttribute(ATTR) ?? ''
        if (wanted.has(key)) {
          el.classList.add(CLASS)
          el.setAttribute('data-demo-active', 'true')
        } else {
          el.classList.remove(CLASS)
          el.removeAttribute('data-demo-active')
        }
      })
    }
    apply()
    // Re-apply on step change, on highlight change, and shortly after the
    // engine navigates (the target may mount a beat after the step starts).
    const t1 = window.setTimeout(apply, 120)
    const t2 = window.setTimeout(apply, 600)
    const t3 = window.setTimeout(apply, 1400)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [targets, active])
}

/** Clears every highlight, e.g. on reset or when the demo stops. */
export function clearDemoHighlights() {
  document.querySelectorAll<HTMLElement>(`.${CLASS}`).forEach((el) => {
    el.classList.remove(CLASS)
    el.removeAttribute('data-demo-active')
  })
}
