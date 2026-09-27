'use client'

// Task 2-d — State Federation dashboard (Level 2)
// Data: GET /api/hierarchy/dashboard?level=state&id={federationId} (defaults to Maharashtra STATE federation)

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '@/lib/api-client'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { csvRow, downloadCsv, slugify } from '../shared/csv'
import { KpiCard, SectionCard, DemandBadge, PrototypeNotice, LevelPill, EmptyState } from '../shared/ui-kit'
import {
  type StateDashResp, type DistrictSummaryDTO, num, skillLabel, sortDemand, abbreviate,
  loadTone, utilCellColor, scoreCellColor, axisTick, ChartTooltip, DashboardSkeleton, LoadError,
  UtilBar, HeaderBlock,
} from './hierarchy-shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Map, Warehouse, Users, Activity, Briefcase, IndianRupee, HeartHandshake, Siren,
  ArrowUpRight, GraduationCap, ListChecks, ChevronDown, ChevronUp, Grid3x3, Download,
} from 'lucide-react'

const STATE_URL = (federationId?: string) =>
  `/api/hierarchy/dashboard?level=state${federationId ? `&id=${encodeURIComponent(federationId)}` : ''}`

// ---------- Snapshot export (client-side CSV via shared/csv helpers, no server round-trip) ----------
function buildStateCsv(d: StateDashResp): string {
  const f = d.federation
  const lines: string[] = []
  lines.push(csvRow(['GigSetu state federation snapshot (SIH prototype — synthetic data)']))
  lines.push(csvRow(['Federation', f.name]))
  lines.push(csvRow(['Chairperson', f.chairperson]))
  lines.push(csvRow(['Registration no.', f.regNo]))
  lines.push(csvRow(['Region', f.region]))
  lines.push(csvRow(['Districts', f.districts]))
  lines.push(csvRow(['Cooperatives', f.cooperatives]))
  lines.push(csvRow(['Workers', f.workers]))
  lines.push(csvRow(['Active workers %', f.activeWorkersPct]))
  lines.push(csvRow(['Jobs today', f.jobsToday]))
  lines.push(csvRow(['Revenue this month (lakh Rs)', f.revenueMonthLakh]))
  lines.push(csvRow(['Welfare coverage %', f.welfareCoveragePct]))
  lines.push(csvRow([]))
  lines.push(csvRow(['DISTRICT REGISTER']))
  lines.push(csvRow(['District', 'Cooperatives', 'Workers', 'Active workers', 'Jobs today', 'Utilization %', 'HIGH-demand skills', 'Federation recommendations']))
  for (const dt of d.districts) {
    const high = Object.entries(dt.demand ?? {}).filter(([, v]) => v === 'HIGH').map(([k]) => k).join('; ')
    lines.push(csvRow([dt.name, dt.cooperatives, dt.workers, dt.activeWorkers, dt.jobsToday, dt.utilizationPct, high, (dt.recommendations ?? []).join(' | ')]))
  }
  lines.push(csvRow([]))
  lines.push(csvRow(['CATEGORY DEMAND SCORE (HIGH 3 · MEDIUM 2 · LOW 1)']))
  lines.push(csvRow(['Service category', 'Demand score']))
  for (const [skill, score] of Object.entries(d.categoryDemand ?? {})) lines.push(csvRow([skill, score]))
  lines.push(csvRow([]))
  lines.push(csvRow(['SKILL GAPS & TRAINING REQUIREMENTS']))
  lines.push(csvRow(['Skill', 'Projected gap (workers)', 'Recommended action']))
  for (const g of f.skillGapJson ?? []) lines.push(csvRow([g.skill, g.gap, g.action]))
  return lines.join('\n')
}

export function StateDashboard({ user }: { user: import('@/lib/types').DemoUser }) {
  const drillTo = useAppStore((s) => s.drillTo)
  const { toast } = useToast()
  const q = useQuery({
    queryKey: ['hierarchy', 'state', user.federationId ?? 'default'],
    queryFn: () => api.get<StateDashResp>(STATE_URL(user.federationId)),
    // Live: every governance dashboard must reflect a booking as it happens.
    staleTime: 15_000,
    refetchInterval: 20_000,
  })

  const federation = q.data?.federation
  const districts = useMemo(() => q.data?.districts ?? [], [q.data])

  const byWorkers = useMemo(() => [...districts].sort((a, b) => b.workers - a.workers), [districts])
  const byJobs = useMemo(() => [...districts].sort((a, b) => b.jobsToday - a.jobsToday), [districts])
  const byUtil = useMemo(() => [...districts].sort((a, b) => b.utilizationPct - a.utilizationPct), [districts])
  const maxJobs = useMemo(() => Math.max(1, ...districts.map((d) => d.jobsToday)), [districts])
  const busiest = byJobs[0]

  const categoryData = useMemo(
    () => Object.entries(q.data?.categoryDemand ?? {})
      .map(([skill, score]) => ({ name: skillLabel(skill), score }))
      .sort((a, b) => b.score - a.score),
    [q.data]
  )

  const demandEntries = useMemo(
    () => sortDemand(Object.entries(federation?.demandJson ?? {})),
    [federation]
  )

  const totalActive = useMemo(() => districts.reduce((s, d) => s + d.activeWorkers, 0), [districts])
  const surgeReserve = (federation?.workers ?? 0) - totalActive
  const urgentDistricts = useMemo(
    () => districts.filter((d) => d.recommendations.some((r) => /urgent|emergency/i.test(r))),
    [districts]
  )
  const highDemandDistricts = useMemo(
    () => districts.filter((d) => Object.values(d.demand).some((v) => v === 'HIGH')),
    [districts]
  )

  if (q.isLoading) return <DashboardSkeleton kpis={7} kpiCols="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7" />
  if (q.isError || !federation) return <LoadError message={q.error instanceof Error ? q.error.message : undefined} />

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <HeaderBlock
        name={federation.name}
        subtitle={
          <>
            Chairperson: <span className="font-medium text-foreground">{federation.chairperson}</span>
            <span className="mx-1.5">·</span>Reg. No. {federation.regNo}
            <span className="mx-1.5">·</span>{federation.region}
            <span className="mt-0.5 block text-[11px]">Signed in: {user.name} — {user.title}</span>
          </>
        }
        chips={
          <>
            <LevelPill level={2} label="State Federation — Level 2" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              aria-label="Download state federation snapshot as CSV"
              onClick={() => {
                if (!q.data) return
                try {
                  downloadCsv(`gigsetu-state-${slugify(federation?.name ?? 'federation').slice(0, 40)}.csv`, buildStateCsv(q.data))
                  toast({
                    title: 'Snapshot downloaded',
                    description: `${districts.length} district records, category demand and the skill-gap register exported as CSV.`,
                  })
                } catch {
                  toast({ title: 'Export failed', description: 'The snapshot could not be generated in this browser.', variant: 'destructive' })
                }
              }}
            >
              <Download className="h-3.5 w-3.5" /> Snapshot CSV
            </Button>
          </>
        }
        extra={<PrototypeNotice className="mt-3" />}
      />

      {/* KPI row */}
      <section aria-label="Key indicators" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Districts" value={num(federation.districts)} icon={<Map className="h-4 w-4" />} />
        <KpiCard label="Cooperatives" value={num(federation.cooperatives)} icon={<Warehouse className="h-4 w-4" />} />
        <KpiCard label="Workers" value={num(federation.workers)} icon={<Users className="h-4 w-4" />} sub="across all districts" />
        <KpiCard label="Active workers" value={`${federation.activeWorkersPct}%`} tone="success" icon={<Activity className="h-4 w-4" />} sub="working today" />
        <KpiCard label="Jobs today" value={num(federation.jobsToday)} tone="primary" icon={<Briefcase className="h-4 w-4" />} sub="network-wide bookings" />
        <KpiCard label="Revenue" value={`₹${num(federation.revenueMonthLakh)} L`} tone="warning" icon={<IndianRupee className="h-4 w-4" />} sub="this month (lakh)" />
        <KpiCard label="Welfare coverage" value={`${federation.welfareCoveragePct}%`} tone="success" icon={<HeartHandshake className="h-4 w-4" />} sub="workers with welfare cover" />
      </section>

      {/* Schematic demand map */}
      <SectionCard
        title={<span className="flex items-center gap-2"><Grid3x3 className="h-4 w-4 text-primary" /> Maharashtra — schematic demand map</span>}
        description="prototype · schematic · not to scale — dot position is stylised, size & colour show jobs today"
      >
        <div
          className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border bg-muted/30"
          role="img"
          aria-label={`Schematic map of ${districts.length} districts of Maharashtra, dot intensity shows jobs today`}
          style={{
            backgroundImage: 'radial-gradient(circle, var(--color-border) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        >
          {districts.map((d) => {
            const tone = loadTone(d.jobsToday, maxJobs)
            const size = Math.round(10 + (d.jobsToday / maxJobs) * 14)
            const isBusiest = busiest?.id === d.id
            const labelLeft = d.mapPos.x > 72
            return (
              <div
                key={d.id}
                className="absolute -translate-y-1/2"
                style={{ left: `${d.mapPos.x}%`, top: `${d.mapPos.y}%` }}
              >
                <div className={`flex items-center gap-1.5 ${labelLeft ? 'flex-row-reverse' : ''}`}>
                  <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
                    {isBusiest && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone.dot} opacity-50`} />}
                    <span className={`relative inline-flex h-full w-full rounded-full ${tone.dot} ring-2 ring-background`} />
                  </span>
                  <span className={`whitespace-nowrap rounded bg-background/85 px-1 py-0.5 text-[10px] leading-tight backdrop-blur-sm sm:text-[11px]`}>
                    <span className="font-semibold">{d.name}</span>{' '}
                    <span className={`tabular-nums ${tone.text}`}>{num(d.jobsToday)}</span>
                  </span>
                </div>
              </div>
            )
          })}
          {/* compass-free honest legend */}
          <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background/90 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur-sm">
            <span className="font-semibold text-foreground">Jobs-today load:</span>
            <LegendDot cls="bg-red-500" label="High ≥80%" />
            <LegendDot cls="bg-orange-500" label="60–80%" />
            <LegendDot cls="bg-amber-500" label="40–60%" />
            <LegendDot cls="bg-amber-400" label="20–40%" />
            <LegendDot cls="bg-emerald-500" label="Low <20%" />
            <span className="ml-auto hidden sm:inline">dot size scales with relative max</span>
          </div>
        </div>
      </SectionCard>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div data-demo-target="state-workers-card">
          <SectionCard title="Workers by district" description="registered cooperative workers (abbreviated names)">
            <ChartShell>
              <BarChart data={byWorkers.map((d) => ({ name: abbreviate(d.name), Workers: d.workers }))} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} interval={0} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
                <Bar dataKey="Workers" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ChartShell>
          </SectionCard>
        </div>

        <SectionCard title="Jobs today by district" description="live bookings flowing through the federation">
          <ChartShell>
            <BarChart data={byJobs.map((d) => ({ name: abbreviate(d.name), Jobs: d.jobsToday }))} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} tickLine={false} axisLine={false} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
              <Bar dataKey="Jobs" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ChartShell>
        </SectionCard>

        <SectionCard title="Demand score by service category" description="sum of district demand weights across the state (HIGH 3 · MEDIUM 2 · LOW 1)">
          <ChartShell>
            <BarChart data={categoryData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} tickLine={false} axisLine={false} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
              <Bar dataKey="score" name="Demand score" radius={[4, 4, 0, 0]} maxBarSize={44}>
                {categoryData.map((c) => (
                  <Cell key={c.name} fill={scoreCellColor(c.score)} />
                ))}
              </Bar>
            </BarChart>
          </ChartShell>
        </SectionCard>

        <SectionCard title="Utilization by district" description="share of registered workers active today (%)">
          <ChartShell>
            <BarChart data={byUtil.map((d) => ({ name: d.name, Utilization: d.utilizationPct }))} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} unit="%" />
              <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={96} />
              <Tooltip content={<ChartTooltip suffix="%" />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
              <Bar dataKey="Utilization" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {byUtil.map((d) => (
                  <Cell key={d.id} fill={utilCellColor(d.utilizationPct)} />
                ))}
              </Bar>
            </BarChart>
          </ChartShell>
        </SectionCard>
      </div>

      {/* Demand by category roll-up + skill gaps */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Demand by category (federation roll-up)" description="aggregated from all 8 district command centers">
          <div className="flex flex-wrap items-center gap-2">
            {demandEntries.map(([skill, level]) => (
              <span key={skill} className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
                <span className="font-medium">{skillLabel(skill)}</span>
                <DemandBadge level={level} />
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Demand levels are computed live from district demand registers — HIGH districts drive exchange transfers & training priorities.
          </p>
        </SectionCard>

        <SectionCard
          title={<span className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" /> Skill gaps & training requirements</span>}
          description="projected shortfall vs expected demand this quarter"
        >
          {(federation.skillGapJson ?? []).length === 0 ? (
            <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No skill gaps recorded" body="Federation training targets are currently balanced." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-medium">Skill</th>
                  <th className="pb-2 text-right font-medium">Gap</th>
                  <th className="pb-2 pl-4 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {federation.skillGapJson.map((g) => (
                  <tr key={g.skill} className="border-t align-top">
                    <td className="py-2 pr-2 font-medium">{g.skill}</td>
                    <td className="py-2 pr-2 text-right font-bold tabular-nums text-destructive">{num(g.gap)}</td>
                    <td className="py-2 pl-4 text-xs text-muted-foreground">{g.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {/* Emergency capacity strip */}
      <section aria-label="Emergency capacity" className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/30">
        <div className="flex items-center gap-2">
          <Siren className="h-4 w-4 animate-pulse text-destructive" />
          <h2 className="text-sm font-bold text-destructive">Emergency capacity & surge readiness</h2>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <EmergencyChip value={num(urgentDistricts.length)} label={urgentDistricts.length === 1 ? 'district has urgent actions flagged' : 'districts have urgent actions flagged'} />
          <EmergencyChip value={num(surgeReserve)} label="workers off-shift today (surge reserve, derived: workers − active)" />
          <EmergencyChip value={num(highDemandDistricts.length)} label="districts carrying HIGH demand skills" />
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Federation emergency protocol (prototype): every district maintains an emergency pool of certified workers on standby; the state
          federation can authorise cross-district transfers through the Cooperative Service Exchange. Counts above are derived from live
          district data in this prototype — automated emergency dispatch arrives in Phase 4.
        </p>
      </section>

      {/* District drill cards */}
      <SectionCard
        title="District command cards"
        description="drill into any district command center — membership, live jobs, demand mix & federation recommendations"
        actions={<Badge variant="outline" className="text-[10px]">{districts.length} districts</Badge>}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {districts.map((d) => (
            <DistrictDrillCard key={d.id} district={d} maxJobs={maxJobs} onOpen={() => drillTo('district', { district: d.id })} />
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

// ---------- pieces ----------

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
      {label}
    </span>
  )
}

function EmergencyChip({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-background px-2.5 py-1 text-xs dark:border-red-900">
      <span className="font-bold tabular-nums text-destructive">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

function ChartShell({ children }: { children: React.ReactElement }) {
  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  )
}

function DistrictDrillCard({
  district: d, maxJobs, onOpen,
}: {
  district: DistrictSummaryDTO
  maxJobs: number
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const tone = loadTone(d.jobsToday, maxJobs)
  const recs = d.recommendations ?? []

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold leading-tight">{d.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {num(d.cooperatives)} cooperatives · <span className={`font-semibold tabular-nums ${tone.text}`}>{num(d.jobsToday)} jobs today</span>
          </p>
        </div>
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} aria-label={`Load ${Math.round((d.jobsToday / maxJobs) * 100)}% of max`} />
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2 text-center">
        <MiniStat label="Workers" value={num(d.workers)} />
        <MiniStat label="Active" value={num(d.activeWorkers)} />
        <MiniStat label="Co-ops" value={num(d.cooperatives)} />
      </div>

      <UtilBar pct={d.utilizationPct} />

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Demand mix</p>
        <div className="flex flex-wrap gap-1">
          {sortDemand(Object.entries(d.demand)).map(([skill, level]) => (
            <span key={skill} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]">
              {skillLabel(skill)} <DemandBadge level={level} />
            </span>
          ))}
        </div>
      </div>

      <div>
        <button
          className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-primary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {recs.length} federation recommendation{recs.length === 1 ? '' : 's'}
          {open ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
        </button>
        {open && (
          <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
            {recs.length === 0 ? <li>No open recommendations.</li> : recs.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        )}
      </div>

      <Button size="sm" variant="outline" className="mt-auto w-full justify-between" onClick={onOpen}>
        View command center <ArrowUpRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  )
}
