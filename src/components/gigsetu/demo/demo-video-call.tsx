'use client'

/**
 * Demo Remote Consultation (spec §11 / §12 / §33).
 *
 * A DETERMINISTIC prototype simulation. Explicitly:
 *   - no getUserMedia, no real camera
 *   - no microphone
 *   - no WebRTC / RTCPeerConnection
 *   - no external API
 *
 * It advances through CALLING -> CONNECTING -> CONNECTED -> CONSULTATION ->
 * SUMMARY -> END on a fixed timer, so a screen recording always shows the same
 * thing. Controls are present and operable (they are part of the story) but
 * they only drive this local simulation.
 */
import { useEffect, useState } from 'react'
import { Camera, CheckCircle2, Loader2, Mic, MicOff, PhoneOff, Volume2, VideoOff } from 'lucide-react'

export type DemoCallState = 'CALLING' | 'CONNECTING' | 'CONNECTED' | 'CONSULTATION' | 'SUMMARY' | 'END'

/** Fixed state timeline in ms from mount. Total ~9s (spec §12). */
const TIMELINE: { at: number; state: DemoCallState; note?: string }[] = [
  { at: 900, state: 'CONNECTING', note: 'Connecting securely…' },
  { at: 2100, state: 'CONNECTED', note: 'Connected' },
  { at: 2600, state: 'CONSULTATION', note: 'Consultation in progress' },
  { at: 6100, state: 'SUMMARY', note: 'Remote inspection complete' },
  { at: 8600, state: 'END', note: 'Call ended' },
]

/** The short scripted exchange (spec §12) — two lines, no padding. */
const EXCHANGE: { at: number; from: 'CUSTOMER' | 'WORKER'; text: string }[] = [
  { at: 2900, from: 'CUSTOMER', text: 'Water pipe burst near kitchen.' },
  { at: 4300, from: 'WORKER', text: 'Please show the affected pipe.' },
]

const STATE_LABEL: Record<DemoCallState, string> = {
  CALLING: 'Calling',
  CONNECTING: 'Connecting',
  CONNECTED: 'Connected',
  CONSULTATION: 'Consultation',
  SUMMARY: 'Summary',
  END: 'Call ended',
}

export function DemoVideoCall({
  customer,
  worker,
  service,
  location,
  /** total ms before the call auto-ends; 0 = run until the user ends it */
  duration = 9000,
  autoPlay = true,
  onEnd,
}: {
  customer: string
  worker: string
  service: string
  location: string
  duration?: number
  autoPlay?: boolean
  onEnd?: () => void
}) {
  const [state, setState] = useState<DemoCallState>(autoPlay ? 'CALLING' : 'CALLING')
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [manualEnd, setManualEnd] = useState(false)

  // Deterministic clock. One interval, one state machine — no randomness, no
  // external calls, so every recording is identical.
  useEffect(() => {
    if (manualEnd) return
    const started = Date.now()
    const id = window.setInterval(() => {
      const t = Date.now() - started
      setElapsed(t)
      if (duration > 0 && t >= duration) {
        setState('END')
        setManualEnd(true)
        onEnd?.()
        return
      }
      const next = [...TIMELINE].reverse().find((s) => t >= s.at)
      if (next) setState(next.state)
    }, 120)
    return () => window.clearInterval(id)
  }, [duration, manualEnd])

  const lines = EXCHANGE.filter((e) => elapsed >= e.at)
  const seconds = Math.floor(elapsed / 1000)
  const isLive = state === 'CONNECTED' || state === 'CONSULTATION'
  const dotColor =
    state === 'CONNECTING' || state === 'CALLING'
      ? 'text-amber-600'
      : state === 'END'
        ? 'text-muted-foreground'
        : 'text-emerald-600'

  return (
    <div
      data-demo-target="remote-consult"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur"
    >
      <div className="w-full max-w-2xl rounded-2xl border bg-card p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider">Remote consultation</h2>
            <p className="text-[11px] text-muted-foreground">
              {service} · {location}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
            <span className={`h-1.5 w-1.5 rounded-full ${dotColor} ${isLive ? 'animate-pulse' : ''}`} aria-hidden />
            <span className={dotColor}>{STATE_LABEL[state]}</span>
            {isLive && <span className="text-muted-foreground">· {seconds}s</span>}
          </span>
        </div>

        {/* Two participant panels — the "video" is a labelled placeholder, never a real feed. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            { role: 'Customer', name: customer, self: !muted },
            { role: 'Worker', name: worker, self: !cameraOff },
          ].map((p) => (
            <div
              key={p.role}
              className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-xl border bg-muted/40"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-base font-bold text-primary">
                {p.name.slice(0, 1)}
              </div>
              <p className="px-2 text-center text-[11px] font-semibold">{p.name}</p>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{p.role}</p>
              <p className="text-[9px] text-muted-foreground/70">
                {p.role === 'Customer' ? (muted ? 'Muted' : 'Simulated feed') : cameraOff ? 'Camera off' : 'Simulated feed'}
              </p>
            </div>
          ))}
        </div>

        {/* Scripted exchange */}
        <div className="mt-3 min-h-[4.5rem] space-y-1.5">
          {lines.length === 0 && state !== 'SUMMARY' && (
            <p className="text-[11px] italic text-muted-foreground">…</p>
          )}
          {lines.map((l) => (
            <div key={l.at} className="animate-fade-in">
              <span className="text-[9px] font-bold uppercase tracking-widest text-primary">{l.from}</span>
              <p className="text-[11px] text-foreground">“{l.text}”</p>
            </div>
          ))}
        </div>

        {state === 'SUMMARY' && (
          <div className="mt-2 animate-fade-in rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Remote inspection complete
            </p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              <dt className="text-muted-foreground">Likely issue</dt>
              <dd className="font-medium">Pipe leakage</dd>
              <dt className="text-muted-foreground">Dispatch</dt>
              <dd className="font-medium">Recommended</dd>
            </dl>
          </div>
        )}

        {/* Controls — present and operable, but purely local to the simulation. */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 border-t pt-3">
          <DemoCallButton active={muted} onClick={() => setMuted((m) => !m)} label={muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />} name={muted ? 'Unmute' : 'Mute'} />
          <DemoCallButton active={cameraOff} onClick={() => setCameraOff((c) => !c)} label={cameraOff ? <VideoOff className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />} name={cameraOff ? 'Camera on' : 'Camera'} />
          <DemoCallButton label={<Volume2 className="h-3.5 w-3.5" />} name="Speaker" />
          <DemoCallButton
            danger
            onClick={() => {
              setManualEnd(true)
              setState('END')
              onEnd?.()
            }}
            label={state === 'END' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <PhoneOff className="h-3.5 w-3.5" />}
            name={state === 'END' ? 'Ended' : 'End call'}
          />
        </div>
        <p className="mt-2 text-center text-[9px] text-muted-foreground/70">
          Deterministic prototype simulation — no camera, microphone, WebRTC or external API is used.
        </p>
      </div>
    </div>
  )
}

function DemoCallButton({
  label, name, onClick, danger, active,
}: {
  label: React.ReactNode
  name: string
  onClick?: () => void
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition',
        danger
          ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
          : active
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted',
      ].join(' ')}
    >
      {label}
      {name}
    </button>
  )
}
