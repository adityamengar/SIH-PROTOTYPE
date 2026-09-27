'use client'

import { create } from 'zustand'
import { DEMO_RUN_LENGTH, DEMO_SCRIPT, DEMO_STORY_STEP_COUNT } from '@/components/gigsetu/demo/demo-script'

/**
 * SIH Demo Mode state.
 *
 * The demo ENGINE (demo-engine.tsx) drives this store; the control panel, the
 * story header and the highlight layer only read from it. Kept separate from
 * the persisted app store so a page reload cleanly drops any in-flight run.
 *
 * Timing and copy live in the centralized script (demo-script.ts) — this store
 * only holds playback position and presentation state, so there is exactly one
 * place to change how the demo behaves (spec §27 / §28).
 */
export const DEMO_STEP_COUNT = DEMO_RUN_LENGTH

/** Denominator shown in the story header (spec §03). */
export const DEMO_TOTAL_STORY_STEPS = DEMO_STORY_STEP_COUNT

export type DemoPhase = 'idle' | 'running' | 'done' | 'error'

/**
 * Live data collected by the engine while executing the script.
 * Keys are written by demo-engine.tsx as steps complete; the panel renders
 * them per step kind. See DemoData in demo-script.ts for the typed shape.
 */
export type DemoData = Record<string, unknown>

interface DemoState {
  active: boolean
  phase: DemoPhase
  /** auto-advance between steps */
  playing: boolean
  /** presentation mode — hide app chrome, big narration */
  presentation: boolean
  /** 0-based index into the full run (numbered steps + supporting scenes) */
  stepIndex: number
  /** live narration line rendered by the control panel */
  note: string
  /** playback speed multiplier for scripted delays */
  speed: number
  /** last error message, if any */
  error: string
  /** live data collected by the engine (booking refs, worker card, payment split…) */
  data: DemoData
  /** bumped by start()/retry() so the engine re-executes even at the same stepIndex */
  runToken: number
  /**
   * data-demo-target values to outline for the active step (spec §32).
   * Written by the controller whenever the step changes.
   */
  highlight: string[]
  /** index of the active sub-scene within the current step (spec §23); -1 = none */
  subSceneIndex: number
  /** true while the remote-consultation overlay owns the screen (spec §11) */
  consultOpen: boolean

  start: () => void
  stop: () => void
  next: () => void
  prev: () => void
  goTo: (i: number) => void
  setPlaying: (p: boolean) => void
  togglePlay: () => void
  setPresentation: (p: boolean) => void
  setSpeed: (s: number) => void
  setNote: (n: string) => void
  setHighlight: (targets: string[]) => void
  setSubScene: (i: number) => void
  setConsultOpen: (open: boolean) => void
  /** merge live step data (idempotent partials) */
  setData: (partial: DemoData) => void
  fail: (msg: string) => void
  finish: () => void
  /** re-run the current step after an error */
  retry: () => void
}

const clamp = (i: number) => Math.min(Math.max(0, i), DEMO_STEP_COUNT - 1)

/** Highlight targets for a run index, resolved from the centralized script. */
function targetsFor(index: number): string[] {
  return DEMO_SCRIPT[index]?.highlight ?? []
}

export const useDemoStore = create<DemoState>()((set, get) => ({
  active: false,
  phase: 'idle',
  playing: true,
  presentation: true,
  stepIndex: 0,
  note: '',
  speed: 1,
  error: '',
  data: {},
  runToken: 0,
  highlight: [],
  subSceneIndex: -1,
  consultOpen: false,

  start: () =>
    set((s) => ({
      active: true,
      phase: 'running',
      playing: true,
      stepIndex: 0,
      note: '',
      error: '',
      data: {},
      highlight: targetsFor(0),
      subSceneIndex: -1,
      consultOpen: false,
      runToken: s.runToken + 1,
    })),

  stop: () =>
    set({
      active: false,
      phase: 'idle',
      playing: false,
      presentation: false,
      note: '',
      error: '',
      highlight: [],
      subSceneIndex: -1,
      consultOpen: false,
    }),

  next: () => {
    const i = get().stepIndex
    if (i >= DEMO_STEP_COUNT - 1) {
      get().finish()
      return
    }
    const n = i + 1
    set({ stepIndex: n, highlight: targetsFor(n), subSceneIndex: -1 })
  },

  prev: () => {
    const n = Math.max(0, get().stepIndex - 1)
    set({ stepIndex: n, highlight: targetsFor(n), subSceneIndex: -1 })
  },

  goTo: (i) => {
    const n = clamp(i)
    set({ stepIndex: n, phase: 'running', highlight: targetsFor(n), subSceneIndex: -1 })
  },

  setPlaying: (p) => set({ playing: p }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPresentation: (p) => set({ presentation: p }),
  setSpeed: (s) => set({ speed: s }),
  setNote: (n) => set({ note: n }),
  setHighlight: (targets) => set({ highlight: targets }),
  setSubScene: (i) => set({ subSceneIndex: i }),
  setConsultOpen: (open) => set({ consultOpen: open }),
  setData: (partial) => set((s) => ({ data: { ...s.data, ...partial } })),
  fail: (msg) => set({ phase: 'error', error: msg, playing: false }),
  finish: () => set({ phase: 'done', playing: false, highlight: [], note: 'Demo complete — the full cooperative loop ran end to end.' }),
  retry: () => set((s) => ({ phase: 'running', error: '', runToken: s.runToken + 1 })),
}))
