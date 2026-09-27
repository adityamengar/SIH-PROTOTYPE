'use client'

// Task 2-d — National / Apex Cooperative Network dashboard (Level 1)
// Data: GET /api/hierarchy/dashboard?level=national

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { api } from '@/lib/api-client'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { csvRow, downloadCsv, slugify } from '../shared/csv'
import { KpiCard, SectionCard, DemandBadge, PrototypeNotice, LevelPill, EmptyState } from '../shared/ui-kit'
import {
  type NationalDashResp, num, skillLabel, sortDemand, abbreviate, axisTick, ChartTooltip,
  DashboardSkeleton, LoadError, PIE_COLORS, HeaderBlock,
} from './hierarchy-shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Globe2, Landmark, Map, Warehouse, Users, Briefcase, FileCheck2, IndianRupee,
  Activity, HeartHandshake, ArrowUpRight, GraduationCap, LayoutGrid, ShieldAlert, Download,
} from 'lucide-react'

// ---------- Snapshot export (client-side CSV via shared/csv helpers, no server round-trip) ----------
function buildNationalCsv(d: NationalDashResp): string {
  const nat = d.national
  const lines: string[] = []
  lines.push(csvRow(['GigSetu apex network snapshot (SIH prototype — synthetic data, no official statistics)']))
  lines.push(csvRow(['Apex network', nat.name]))
  lines.push(csvRow(['Chairperson', nat.chairperson]))
  lines.push(csvRow(['Registration no.', nat.regNo]))
  lines.push(csvRow(['Region', nat.region]))
  lines.push(csvRow(['Districts', nat.districts]))
  lines.push(csvRow(['Cooperatives', nat.cooperatives]))
  lines.push(csvRow(['Workers', nat.workers]))
  lines.push(csvRow(['Active workers %', nat.activeWorkersPct]))
  lines.push(csvRow(['Jobs today', nat.jobsToday]))
  lines.push(csvRow(['Revenue this month (lakh Rs)', nat.revenueMonthLakh]))
  lines.push(csvRow(['Welfare coverage %', nat.welfareCoveragePct]))
  const c = nat.national?.contracts
  if (c) {
    lines.push(csvRow(['Institutional AMC contracts', c.institutionalAMC]))
    lines.push(csvRow(['Government institutions served', c.govtInstitutions]))
    lines.push(csvRow(['Monthly contract value (Rs crore)', c.monthlyValueCr]))
  }
  lines.push(csvRow([]))
  lines.push(csvRow(['STATE REGISTER']))
  lines.push(csvRow(['State', 'Federations', 'Districts', 'Cooperatives', 'Workers', 'Intensity index (0-1)']))
  for (const st of nat.national?.states ?? []) lines.push(csvRow([st.state, st.federations, st.districts, st.cooperatives, st.workers, st.intensity]))
  lines.push(csvRow([]))
  lines.push(csvRow(['NATIONAL SKILL GAPS']))
  lines.push(csvRow(['Skill', 'Projected gap (workers)', 'Recommended action']))
  for (const g of nat.skillGapJson ?? []) lines.push(csvRow([g.skill, g.gap, g.action]))
  return lines.join('\n')
}

export function NationalDashboard({ user }: { user: import('@/lib/types').DemoUser }) {
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const q = useQuery({
    queryKey: ['hierarchy', 'national'],
    queryFn: () => api.get<NationalDashResp>('/api/hierarchy/dashboard?level=national'),
    // Live: every governance dashboard must reflect a booking as it happens.
    staleTime: 15_000,
    refetchInterval: 20_000,
  })

  const national = q.data?.national
  const n = national?.national
  const states = useMemo(() => [...(n?.states ?? [])].sort((a, b) => b.workers - a.workers), [n])
  const contracts = n?.contracts
  const stateFed = q.data?.stateFed

  const federationsTotal = useMemo(() => states.reduce((s, st) => s + st.federations, 0), [states])

  const demandEntries = useMemo(
    () => (national ? sortDemand(Object.entries(national.demandJson ?? {})) : []),
    [national]
  )

  if (q.isLoading) return <DashboardSkeleton kpis={8} kpiCols="grid grid-cols-2 gap-3 sm:grid-cols-4" />
  if (q.isError || !national || !n) return <LoadError message={q.error instanceof Error ? q.error.message : undefined} />

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <HeaderBlock
        name={national.name}
        subtitle={
          <>
            Chairperson: <span className="font-medium text-foreground">{national.chairperson}</span>
            <span className="mx-1.5">·</span>Reg. No. {national.regNo}
            <span className="mx-1.5">·</span>{national.region}
            <span className="mt-0.5 block text-[11px]">Signed in: {user.name} — {user.title}</span>
          </>
        }
        chips={
          <>
            <LevelPill level={1} label="Level 1 — Apex" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              aria-label="Download apex network snapshot as CSV"
              onClick={() => {
                if (!q.data) return
                try {
                  downloadCsv(`gigsetu-national-${slugify(national?.name ?? 'apex').slice(0, 40)}.csv`, buildNationalCsv(q.data))
                  toast({
                    title: 'Snapshot downloaded',
                    description: `${states.length} state records, contracts counters and the national skill-gap register exported as CSV.`,
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
        extra={
          <div className="mt-3 space-y-2">
            <PrototypeNotice className="border-2 border-amber-400 bg-amber-50 px-3.5 py-3 text-xs dark:border-amber-600">
              <span className="font-bold uppercase tracking-wide">Prototype synthetic data — no official government statistics are represented.</span>{' '}
              {n.note ? <span className="font-medium">{n.note}</span> : null}
            </PrototypeNotice>
          </div>
        }
      />

      {/* KPI row */}
      <section aria-label="Network key indicators" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="States covered" value={num(states.length)} icon={<Globe2 className="h-4 w-4" />} sub="pilot network footprint" />
        <KpiCard label="Federations" value={num(federationsTotal)} icon={<Landmark className="h-4 w-4" />} sub="state-level bodies" />
        <KpiCard label="Districts" value={num(national.districts)} icon={<Map className="h-4 w-4" />} />
        <KpiCard label="Cooperatives" value={num(national.cooperatives)} icon={<Warehouse className="h-4 w-4" />} />
        <KpiCard label="Workers" value={`${num(national.workers)}+`} icon={<Users className="h-4 w-4" />} sub="network membership" />
        <KpiCard label="Jobs today" value={num(national.jobsToday)} tone="primary" icon={<Briefcase className="h-4 w-4" />} sub="all states" />
        <KpiCard label="Institutional AMC" value={num(contracts?.institutionalAMC)} tone="success" icon={<FileCheck2 className="h-4 w-4" />} sub="active contracts" />
        <KpiCard label="Monthly contract value" value={`₹${num(contracts?.monthlyValueCr)} Cr`} tone="warning" icon={<IndianRupee className="h-4 w-4" />} sub="institutional pipeline" />
      </section>

      {/* Schematic state-intensity tile map */}
      <SectionCard
        title={<span className="flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-primary" /> Schematic state-intensity map</span>}
        description="grid tile map — not a geographic map · prototype · tile shade = worker network intensity"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="list" aria-label="States by network intensity">
          {states.map((st) => {
            const opacity = 0.15 + st.intensity * 0.85
            const darkText = st.intensity >= 0.55
            return (
              <div key={st.state} role="listitem" className="relative overflow-hidden rounded-xl border">
                <div className="absolute inset-0 bg-primary" style={{ opacity }} aria-hidden />
                <div className={`relative p-3 ${darkText ? 'text-zinc-900' : 'text-foreground'}`}>
                  <p className="truncate text-xs font-bold sm:text-sm">{st.state}</p>
                  <p className="text-lg font-extrabold tabular-nums leading-tight sm:text-xl">{num(st.workers)}</p>
                  <p className={`text-[10px] ${darkText ? 'text-zinc-800' : 'text-muted-foreground'}`}>
                    {st.federations} fed · {st.districts} dist · {num(st.cooperatives)} co-ops
                  </p>
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          Tiles are ordered by network size, not geography. Intensity is a 0–1 prototype index of workforce activity — an honest abstraction,
          not a choropleth of India.
        </p>
      </SectionCard>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div data-demo-target="national-workers-card">
          <SectionCard title="Workers by state" description="registered cooperative workers in the apex network">
            <div className="h-64 w-full sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={states.map((s) => ({ name: abbreviate(s.state), Workers: s.workers }))} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" tick={axisTick} interval={0} angle={-18} textAnchor="end" height={46} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
                  <Bar dataKey="Workers" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Cooperatives by state" description="share of primary societies per state">
          <div className="h-64 w-full sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={states}
                  dataKey="cooperatives"
                  nameKey="state"
                  innerRadius="42%"
                  outerRadius="70%"
                  paddingAngle={2}
                  stroke="var(--color-background)"
                  strokeWidth={2}
                >
                  {states.map((s, i) => (
                    <Cell key={s.state} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Featured federation + contracts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Featured state federation"
          description="largest state body in the network — the Phase 2 flagship"
          className="border-primary/40"
        >
          {stateFed ? (
            <div className="rounded-xl bg-accent p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-tight">{stateFed.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{stateFed.region} · Maharashtra state federation</p>
                  <p className="mt-2 text-2xl font-extrabold tabular-nums text-primary">{num(stateFed.workers)}</p>
                  <p className="text-[11px] text-muted-foreground">workers on the GigSetu network</p>
                </div>
                <Button size="sm" onClick={() => setView('state')} className="shrink-0">
                  Open state dashboard <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-3 border-t border-primary/20 pt-2 text-[11px] text-muted-foreground">
                Live command view: 8 districts, schematic demand map, skill-gap training plans and the Cooperative Service Exchange.
              </p>
            </div>
          ) : (
            <EmptyState icon={<Landmark className="h-6 w-6" />} title="No state federation linked yet" />
          )}
        </SectionCard>

        <SectionCard
          title="Institutional contracts"
          description="apex-level B2B & government pipeline"
          actions={<Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">Phase 5 full contracts module planned</Badge>}
        >
          <div className="space-y-2">
            <ContractRow icon={<FileCheck2 className="h-4 w-4 text-primary" />} label="Institutional AMC contracts" value={num(contracts?.institutionalAMC)} sub="active annual maintenance agreements" />
            <ContractRow icon={<Landmark className="h-4 w-4 text-primary" />} label="Government institutions served" value={num(contracts?.govtInstitutions)} sub="departmental & civic-body engagements" />
            <ContractRow icon={<IndianRupee className="h-4 w-4 text-primary" />} label="Monthly contract value" value={`₹${num(contracts?.monthlyValueCr)} Cr`} sub="recurring institutional revenue (₹ crore / month)" />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Prototype summary counters — full contract lifecycle (sourcing → SLA → invoicing) lands in Phase 5.
          </p>
        </SectionCard>
      </div>

      {/* Operational pulse */}
      <section aria-label="Operational pulse" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Active workers" value={`${national.activeWorkersPct}%`} tone="success" icon={<Activity className="h-4 w-4" />} sub="network-wide activity rate" />
        <KpiCard label="Revenue" value={`₹${num(national.revenueMonthLakh)} L`} tone="warning" icon={<IndianRupee className="h-4 w-4" />} sub="this month (lakh)" />
        <KpiCard label="Welfare coverage" value={`${national.welfareCoveragePct}%`} tone="success" icon={<HeartHandshake className="h-4 w-4" />} sub="workers with welfare cover" />
      </section>

      {/* Demand + skill gaps */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Network demand snapshot" description="apex roll-up of state federation demand registers">
          <div className="flex flex-wrap items-center gap-2">
            {demandEntries.map(([skill, level]) => (
              <span key={skill} className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
                <span className="font-medium">{skillLabel(skill)}</span>
                <DemandBadge level={level} />
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            HIGH-demand categories guide national training partnerships and state-level exchange corridors.
          </p>
        </SectionCard>

        <SectionCard
          title={<span className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" /> National skill gaps</span>}
          description="projected shortfall vs expected network demand"
        >
          {(national.skillGapJson ?? []).length === 0 ? (
            <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No skill gaps recorded" />
          ) : (
            <div className="space-y-2">
              {national.skillGapJson.map((g) => (
                <div key={g.skill} className="flex items-center gap-3 rounded-lg border p-2.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{g.skill}</p>
                    <p className="truncate text-xs text-muted-foreground">{g.action}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums text-destructive">{num(g.gap)}</p>
                    <p className="text-[10px] text-muted-foreground">workers short</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

function ContractRow({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
      </div>
      <p className="shrink-0 text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}
