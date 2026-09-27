'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { inr } from '@/lib/api-client'
import { useDemoStore, DEMO_STEP_COUNT, DEMO_TOTAL_STORY_STEPS } from '@/store/demo-store'
import { STATUS_LABELS } from '@/lib/types'
import { VerifiedBadge, RatingStars, DemandBadge } from '../shared/ui-kit'
import { resetDemoState, stopSihDemo } from './demo-launch'
import { DEMO_SCRIPT, DEMO_SCENARIO, DEMO_GOVERNANCE, DEMO_SCENARIO_ENTITIES, type DemoData } from './demo-script'
import { DemoStoryHeader } from './demo-story-header'
import { DemoFeatureCard } from './demo-feature-card'
import { DemoVideoCall } from './demo-video-call'
import { useDemoHighlight, clearDemoHighlights } from './demo-highlight'
import {
  Play, Pause, ChevronLeft, ChevronRight, X, Monitor, RotateCcw, ShieldCheck, Info,
  Star, TrendingUp, ArrowRight, CheckCircle2, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const SPEEDS = [1, 1.5, 2]

function initials(name?: string): string {
  return (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/* ---------------- live-data strip renderers ---------------- */

function WaBubble({ side, children }: { side: 'sent' | 'received'; children: React.ReactNode }) {
  return (
    <div className={cn('flex', side === 'sent' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-2.5 py-1.5 text-[11px] leading-relaxed shadow-sm',
          side === 'sent'
            ? 'rounded-tr-sm bg-emerald-100 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-50'
            : 'rounded-tl-sm bg-white text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
        )}
      >
        {children}
      </div>
    </div>
  )
}

function WaStrip({ data }: { data: DemoData }) {
  const threads: Array<{ sent?: string; received?: string[] }> = [
    { sent: data.waReqSent, received: data.waReqReplies },
    { sent: data.waLocSent, received: data.waLocReplies },
    { sent: data.waTimeSent, received: data.waTimeReplies },
    ...(data.waConfirmReplies?.length ? [{ sent: '✅ CONFIRM BOOKING', received: data.waConfirmReplies }] : []),
  ].filter((t) => t.sent || (t.received && t.received.length > 0))
  return (
    <div className="overflow-hidden rounded-lg border shadow-sm">
      <div className="flex items-center gap-1.5 bg-emerald-700 px-2.5 py-1 text-[10px] font-semibold text-emerald-50 dark:bg-emerald-900">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden />
        WhatsApp Booking Assistant · मराठी
      </div>
      <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto bg-[#efeae2] p-2 dark:bg-zinc-900" role="log" aria-label="WhatsApp conversation">
        {threads.map((t, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            {t.sent && <WaBubble side="sent">{t.sent}</WaBubble>}
            {t.received?.map((r, j) => (
              <WaBubble key={j} side="received">{r}</WaBubble>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkerStrip({ data }: { data: DemoData }) {
  if (!data.workerName) return null
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary" aria-hidden>
          {initials(data.workerName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold leading-tight">
            {data.workerName}
            {data.certStatus && <VerifiedBadge status={data.certStatus} />}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{data.coopName}</p>
        </div>
        {typeof data.score === 'number' && (
          <Badge variant="outline" className="shrink-0 border-primary/40 bg-accent text-[10px] text-primary">
            AI score {data.score}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {typeof data.workerRating === 'number' && <RatingStars value={data.workerRating} />}
        {typeof data.distanceKm === 'number' && <span>📍 {data.distanceKm} km away</span>}
        {typeof data.etaMin === 'number' && <span>🛵 ETA ~{data.etaMin} min</span>}
        {data.certName && <span className="truncate">🎓 {data.certName}</span>}
        {typeof data.alternativesCount === 'number' && data.alternativesCount > 0 && (
          <span className="text-primary">{data.alternativesCount} verified alternative(s) ranked</span>
        )}
      </div>
      {data.pipeline && data.pipeline.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Matching pipeline">
          {data.pipeline.map((p) => (
            <span key={p.stage} className="rounded-full border bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {p.stage} · {p.count}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function PriceStrip({ data }: { data: DemoData }) {
  const p = data.price
  if (!p) return null
  const span = Math.max(1, p.ceiling - p.floor)
  const totalPos = Math.min(100, Math.max(0, ((p.total - p.floor) / span) * 100))
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Federation rate card (plumber · emergency)</span>
        <span className="text-base font-bold tabular-nums text-primary">{inr(p.total)}</span>
      </div>
      <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
        <span>Base {inr(p.base)}</span>
        <span>+ Emergency surcharge {inr(p.urgencySurcharge)}</span>
      </div>
      <div className="mt-2">
        <div className="relative h-2 rounded-full bg-muted">
          <div className="absolute inset-y-0 rounded-full bg-emerald-200 dark:bg-emerald-900" style={{ left: 0, right: 0 }} />
          <div className="absolute inset-y-0 w-1 rounded-full bg-primary shadow" style={{ left: `calc(${totalPos}% - 2px)` }} aria-hidden />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>cooperative floor {inr(p.floor)}</span>
          <span>ceiling {inr(p.ceiling)}</span>
        </div>
        <p className="mt-1 text-[10px] italic text-muted-foreground">Floor protects worker income — negotiation never undercuts the cooperative rate card.</p>
      </div>
    </div>
  )
}

function BookingStrip({ data }: { data: DemoData }) {
  if (!data.bookingRef && !data.bookingStatus) return null
  const timeline = data.timeline ?? []
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {data.bookingRef && <Badge variant="outline" className="font-mono text-[10px]">{data.bookingRef}</Badge>}
        {data.bookingStatus && <Badge variant="outline" className="border-primary/40 bg-accent text-[10px] font-bold text-primary">{STATUS_LABELS[data.bookingStatus] ?? data.bookingStatus}</Badge>}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="h-3 w-3" /> live engine timers</span>
      </div>
      {timeline.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Booking timeline">
          {timeline.slice(-7).map((t, i) => (
            <span
              key={`${t.status}-${i}`}
              className={cn(
                'rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                i === timeline.slice(-7).length - 1
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-muted bg-muted text-muted-foreground'
              )}
            >
              {STATUS_LABELS[t.status] ?? t.status}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function PaymentStrip({ data }: { data: DemoData }) {
  const p = data.payment
  if (!p) return null
  const amount = Math.max(1, p.amount)
  const segs = [
    { label: 'Worker', v: p.workerShare, cls: 'bg-emerald-500' },
    { label: 'Coop', v: p.coopCommission, cls: 'bg-amber-500' },
    { label: 'Welfare', v: p.welfare, cls: 'bg-emerald-300' },
    { label: 'Platform', v: p.platformFee, cls: 'bg-zinc-400' },
  ]
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold">{p.method}</span>
        <span className="text-base font-bold tabular-nums text-primary">{inr(p.amount)}</span>
      </div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full" role="img" aria-label="Payment split">
        {segs.map((s) => (
          <div key={s.label} className={s.cls} style={{ width: `${(s.v / amount) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', s.cls)} aria-hidden /> {s.label} {inr(s.v)}
          </span>
        ))}
      </div>
      <p className="mt-1 font-mono text-[9px] text-muted-foreground/70">{p.txnId}</p>
    </div>
  )
}

function RatingStrip({ data }: { data: DemoData }) {
  const factors: Array<[string, number]> = [
    ['Quality', 5], ['Timeliness', 5], ['Behaviour', 5], ['Communication', 5],
  ]
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex gap-0.5" aria-label="Rated 5 out of 5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-hidden />
          ))}
        </span>
        <span className="text-xs font-bold">5 / 5</span>
        <Badge variant="outline" className="ml-auto border-emerald-300 bg-emerald-50 text-[9px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          submitted
        </Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {factors.map(([k, v]) => (
          <span key={k} className="rounded-full border bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{k} ★{v}</span>
        ))}
      </div>
      {data.review && <p className="mt-1.5 line-clamp-2 text-[10px] italic text-muted-foreground">“{data.review}”</p>}
    </div>
  )
}

function CoopStrip({ data }: { data: DemoData }) {
  const k = data.coopKpis
  if (!k) return null
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="text-xs font-semibold">{k.name}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>👷 {k.workers} members</span>
        <span>🧰 {k.jobsToday} jobs today</span>
        <span>⚡ {k.activeToday} active now</span>
        <span className="font-semibold text-primary">Utilisation {k.utilization}%</span>
      </div>
    </div>
  )
}

function DistrictStrip({ data }: { data: DemoData }) {
  const k = data.district
  if (!k) return null
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="text-xs font-semibold">{k.name} District · {k.coordinator}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>🧰 {k.jobsToday.toLocaleString('en-IN')} jobs today</span>
        <span>👷 {k.workers.toLocaleString('en-IN')} workers</span>
        <span className="inline-flex items-center gap-1">Plumbing demand <DemandBadge level={k.plumberDemand} /></span>
      </div>
    </div>
  )
}

function ForecastStrip({ data }: { data: DemoData }) {
  const f = data.forecast
  if (!f) return null
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <TrendingUp className="h-3.5 w-3.5 text-amber-500" aria-hidden />
        {f.zoneLabel}
        <Badge variant="outline" className="ml-auto border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {f.pct >= 0 ? '+' : ''}{f.pct}% weekend
        </Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        <span>Plumbing: {f.baseWeekend} → <span className="font-bold text-foreground">{f.expectedWeekend}</span> expected jobs</span>
      </div>
      {f.drivers?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {f.drivers.slice(0, 3).map((dr) => (
            <span key={dr} className="rounded-full border border-dashed border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">{dr}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ExchangeStrip({ data }: { data: DemoData }) {
  const x = data.exchange
  if (!x) return null
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold">{x.fromCoopName}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="font-semibold">{x.toCoopName}</span>
        <Badge className="ml-auto border-emerald-300 bg-emerald-100 text-[9px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle2 className="mr-0.5 h-3 w-3" /> APPROVED
        </Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>🔧 {x.workerCount} plumbers</span>
        <span>🗓 {x.durationDays}-day deputation</span>
        <span>📈 covers ~{x.expectedDemand} weekend jobs</span>
        {x.distanceKm > 0 && <span>🛣 {x.distanceKm} km</span>}
      </div>
      {x.approvedBy && <p className="mt-1 text-[10px] text-muted-foreground">Approved by {x.approvedBy} — workers are never auto-transferred.</p>}
    </div>
  )
}

function DataStrip({ display, data }: { display: string; data: DemoData }) {
  switch (display) {
    case 'wa': return <WaStrip data={data} />
    case 'worker': return <WorkerStrip data={data} />
    case 'price': return <PriceStrip data={data} />
    case 'booking': return <BookingStrip data={data} />
    case 'payment': return <PaymentStrip data={data} />
    case 'rating': return <RatingStrip data={data} />
    case 'coop': return <CoopStrip data={data} />
    case 'district': return <DistrictStrip data={data} />
    case 'forecast': return <ForecastStrip data={data} />
    case 'exchange': return <ExchangeStrip data={data} />
    default: return null
  }
}

/* ---------------- the panel ---------------- */

export function DemoPanel() {
  const active = useDemoStore((s) => s.active)
  const phase = useDemoStore((s) => s.phase)
  const playing = useDemoStore((s) => s.playing)
  const presentation = useDemoStore((s) => s.presentation)
  const stepIndex = useDemoStore((s) => s.stepIndex)
  const note = useDemoStore((s) => s.note)
  const speed = useDemoStore((s) => s.speed)
  const error = useDemoStore((s) => s.error)
  const data = useDemoStore((s) => s.data) as DemoData
  const qc = useQueryClient()
  const { toast } = useToast()

  const step = DEMO_SCRIPT[stepIndex]
  const consultOpen = useDemoStore((s) => s.consultOpen)

  // Highlights the current step's data-demo-target elements (spec §32).
  useDemoHighlight()

  // A stopped demo must leave no orange outlines behind (spec §41).
  useEffect(() => {
    if (!active) clearDemoHighlights()
  }, [active])

  const narration = useMemo(() => {
    try {
      return step?.narration(data) ?? ''
    } catch {
      return step?.title ?? ''
    }
  }, [step, data])

  const advance = useCallback(() => {
    const s = useDemoStore.getState()
    if (s.phase === 'error') s.retry()
    else s.next()
  }, [])

  async function doReset() {
    try {
      await resetDemoState(qc)
      useDemoStore.getState().stop()
      toast({ title: 'Demo state reset', description: 'All demo bookings, notifications and exchange records were removed.' })
    } catch (e) {
      // Never claim a reset succeeded if something actually threw.
      useDemoStore.getState().stop()
      toast({
        title: 'Reset could not complete',
        description: e instanceof Error ? e.message : 'Unknown error.',
        variant: 'destructive',
      })
    }
  }

  // Keyboard controls — never hijack typing (spec §36)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        advance()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        useDemoStore.getState().prev()
      } else if (e.key === ' ') {
        e.preventDefault()
        useDemoStore.getState().togglePlay()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        stopSihDemo()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        void doReset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, advance])

  if (!active) return null

  const isDone = phase === 'done'
  const isError = phase === 'error'

  return (
    <>
      {/* ---- DEMO STORY HEADER (spec §02 / §29) ----
          Sits directly above the control bar so the application screen stays
          the main visual focus. Driven entirely by the step in the centralized
          script — no timing or copy lives here. */}
      <DemoStoryHeader
        currentStep={step?.num ?? stepIndex + 1}
        totalSteps={DEMO_TOTAL_STORY_STEPS}
        scenario={DEMO_SCENARIO}
        title={step?.title ?? ''}
        description={step?.description ?? ''}
        supporting={step?.num === null}
        active={!isError}
      />

      <section
        aria-label="SIH Demo Mode control panel"
        className="fixed inset-x-3 bottom-3 z-50 w-[calc(100%-1.5rem)] rounded-2xl border bg-card/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[700px] sm:-translate-x-1/2"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="p-3 sm:p-4 sm:pb-1">
        {/* header row */}
        <div className="flex items-center gap-2">
          <Badge className="gap-1.5 border-red-200 bg-red-600 px-2 text-[10px] font-bold tracking-wide text-white hover:bg-red-600 dark:border-red-800">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            SIH DEMO MODE
          </Badge>
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground/90">
            {DEMO_SCENARIO} — full cooperative workforce loop
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="About the demo script">
                <Info className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="max-h-80 w-80 overflow-y-auto p-3">
              <p className="text-xs font-bold">The {DEMO_TOTAL_STORY_STEPS}-step story</p>
              <ol className="mt-2 space-y-1.5">
                {DEMO_SCRIPT.map((s, i) => (
                  <li key={s.id} className="flex gap-2 text-[11px] leading-snug">
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold', i <= stepIndex ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      {s.num ?? '•'}
                    </span>
                    <span className={cn(i <= stepIndex ? 'text-foreground' : 'text-muted-foreground')}>
                      <span className="font-semibold">{s.title}</span> — {s.role}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">Arrow keys / Space drive the demo. Every step calls the live API layer.</p>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close demo panel" onClick={stopSihDemo}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Compact labelled progress (spec §30): orange = active, green =
            completed, grey = upcoming. Ticks carry short labels so the viewer can
            see where they are without a legend. */}
        <div className="mt-2.5" role="tablist" aria-label="Demo story progress">
          <div className="flex items-center gap-0.5">
            {DEMO_SCRIPT.map((s, i) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={i === stepIndex}
                aria-label={s.num === null ? `Scene: ${s.short}` : `Step ${s.num} of ${DEMO_TOTAL_STORY_STEPS}: ${s.short}`}
                title={s.num === null ? s.title : `${String(s.num).padStart(2, '0')} — ${s.title}`}
                onClick={() => useDemoStore.getState().goTo(i)}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  i < stepIndex
                    ? 'bg-emerald-500'
                    : i === stepIndex
                      ? 'bg-primary'
                      : 'bg-muted hover:bg-muted-foreground/30'
                )}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-tighter">
            {DEMO_SCRIPT.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  'min-w-0 flex-1 truncate text-center leading-none',
                  i < stepIndex
                    ? 'text-emerald-600 dark:text-emerald-500'
                    : i === stepIndex
                      ? 'text-primary'
                      : 'text-muted-foreground/60'
                )}
              >
                {s.short}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
          <span>Step {stepIndex + 1} / {DEMO_STEP_COUNT} · viewing as <span className="font-semibold text-foreground/80">{step?.role}</span></span>
          <span className="tabular-nums">{step?.short}</span>
        </div>

        {/* narration */}
        <div className="mt-2 min-h-[52px] rounded-lg bg-accent/40 px-2.5 py-2">
          <p className="text-xs font-bold leading-snug text-foreground">{isDone ? 'Demo complete — the full cooperative loop ran end to end.' : step?.title}</p>
          {!isDone && <p className="mt-0.5 text-[11px] leading-snug text-foreground/80">{narration}</p>}
          {(note || isError) && (
            <p className={cn('mt-1 flex items-center gap-1 text-[10px]', isError ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
              {!isError && <span className="inline-flex gap-0.5" aria-hidden><span className="animate-bounce">·</span><span className="animate-bounce [animation-delay:150ms]">·</span><span className="animate-bounce [animation-delay:300ms]">·</span></span>}
              {isError ? `Error: ${error}` : note}
            </p>
          )}
        </div>

        {/* live data strip */}
        {!isDone && (
          <div className="mt-2 max-h-44 overflow-y-auto">
            <DataStrip display={step?.display ?? 'wa'} data={data} />
          </div>
        )}

        {/* controls */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 px-2.5" aria-label="Previous step" disabled={stepIndex === 0} onClick={() => useDemoStore.getState().prev()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-9 px-0"
            aria-label={playing ? 'Pause auto-advance' : 'Resume auto-advance'}
            disabled={isDone}
            onClick={() => useDemoStore.getState().setPlaying(!playing)}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="default" size="sm" className="h-8 min-w-[76px] gap-1 px-3" onClick={advance} disabled={isDone} aria-label={isError ? 'Retry step' : 'Next step'}>
            {isError ? <RotateCcw className="h-3.5 w-3.5" /> : <ChevronRight className="h-4 w-4" />}
            {isError ? 'Retry' : isDone ? 'Done' : 'Next'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 font-mono text-[11px]"
            aria-label="Cycle playback speed"
            onClick={() => useDemoStore.getState().setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          >
            {speed}×
          </Button>
          <Button
            variant={presentation ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            aria-pressed={presentation}
            aria-label="Toggle presentation mode"
            onClick={() => useDemoStore.getState().setPresentation(!presentation)}
          >
            <Monitor className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Presentation</span>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto h-8 gap-1.5 border-destructive/40 px-2.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive">
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">RESET DEMO</span>
                <span className="sm:hidden">RESET</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset the demo state?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes every booking, notification, complaint and exchange record the demo created, and stops playback. Seeded prototype history is preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={doReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Reset demo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* integrity line */}
      <div className="flex items-center justify-center gap-1.5 border-t px-3 pb-1 pt-1.5 text-[10px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3 text-emerald-600" aria-hidden />
        Scripted demo drives real APIs — every booking, payment and rating is genuine prototype data.
      </div>
      </section>

      {/* ---- FEATURE EXPLANATION CARD (spec §31) ----
          One heading + one sentence, pinned bottom-right so it never covers the
          application content it describes. */}
      <DemoFeatureCard
        heading={step?.title ?? ''}
        sentence={step?.voiceover ?? ''}
        footer={step && (step.display === 'exchange' || step.display === 'worker' || step.display === 'loop') ? DEMO_GOVERNANCE : undefined}
        visible={!isDone && !isError && !!step}
      />
      {/* ---- REMOTE CONSULTATION OVERLAY (spec §11 / §33) ----
          Deterministic simulation: no getUserMedia, no microphone, no WebRTC,
          no external API. Rendered above everything and self-terminating. */}
      {consultOpen && (
        <DemoVideoCall
          customer={DEMO_SCENARIO_ENTITIES.customer}
          worker={(data.workerName as string) ?? 'Matched worker'}
          service={DEMO_SCENARIO_ENTITIES.service}
          location={DEMO_SCENARIO_ENTITIES.location}
          duration={9000}
          autoPlay
          onEnd={() => useDemoStore.getState().setConsultOpen(false)}
        />
      )}
      </>
  )
}
