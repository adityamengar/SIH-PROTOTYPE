'use client'

import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  KpiCard, SectionCard, DemandBadge, LevelPill, PrototypeNotice, EmptyState, AttentionRow,
} from '../shared/ui-kit'
import {
  useHierarchyDashboard, DashSkeleton, DashError, DemandLegend, UtilBar, ScrollList,
  skillIcon, skillLabel, demandEntries, tradeKind, signedGap, fmt, DrillBanner,
  type DistrictResp, type DistrictTaluka, type Opportunity, type SkillGap,
} from './taluka-district-kit'
import { ROLE_VIEWS } from '@/store/app-store'
import type { DemoUser } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'
import { csvRow, downloadCsv, slugify } from '../shared/csv'
import { GovernanceActions } from './governance-actions'
import {
  Sparkles, Building2, Users, BriefcaseBusiness, Activity, UserCheck, Grid3X3,
  ArrowLeftRight, Siren, UsersRound, Layers, AlertTriangle, ArrowUpRight, Download,
} from 'lucide-react'

// ---------- Snapshot export (client-side CSV from already-fetched dashboard data) ----------

function buildDistrictCsv(district: DistrictResp['district'], talukas: DistrictTaluka[], comparison: DistrictResp['comparison']): string {
  const lines: string[] = []
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' IST'
  lines.push(csvRow(['GigSetu district snapshot (SIH prototype — synthetic data)']))
  lines.push(csvRow(['District', district.name]))
  lines.push(csvRow(['Coordinator', district.coordinator]))
  lines.push(csvRow(['Cooperatives', district.cooperatives, 'Talukas', talukas.length]))
  lines.push(csvRow(['Workers', district.workers, 'Active workers', district.activeWorkers]))
  lines.push(csvRow(['Jobs today', district.jobsToday, 'Utilisation %', district.utilizationPct.toFixed(1)]))
  lines.push(csvRow(['Service zones', district.zoneCount]))
  lines.push(csvRow(['Generated at', stamp]))
  lines.push('')
  lines.push(csvRow(['--- TALUKA REGISTER ---']))
  lines.push(csvRow(['Taluka', 'Coordinator', 'Workers', 'Available', 'Jobs today', 'Utilisation %', 'Emergency capacity']))
  for (const t of talukas) {
    lines.push(csvRow([t.name, t.coordinator, t.workers, t.availableWorkers, t.jobsToday, t.utilizationPct.toFixed(1), t.emergencyCapacity]))
  }
  lines.push('')
  lines.push(csvRow(['--- CROSS-COOPERATIVE CAPACITY COMPARISON ---']))
  lines.push(csvRow(['Cooperative', 'Skill', 'Available', 'Expected jobs', 'Gap', 'Status']))
  for (const r of comparison) {
    const gap = r.available - r.expectedJobs
    const status = r.available < r.expectedJobs - 4 ? 'SHORTAGE' : r.available > r.expectedJobs + 4 ? 'SURPLUS' : 'BALANCED'
    lines.push(csvRow([r.coop, r.skill, r.available, r.expectedJobs, gap > 0 ? `+${gap}` : String(gap), status]))
  }
  return lines.join('\n')
}

// ---- Schematic taluka demand map (tile intensity ∝ jobsToday relative to max) ----

function tileTone(intensity: number): string {
  if (intensity >= 0.8) return 'border-amber-600 bg-amber-500 text-white'
  if (intensity >= 0.55) return 'border-amber-400 bg-amber-400/90 text-amber-950'
  if (intensity >= 0.3) return 'border-amber-300 bg-amber-200 text-amber-900 dark:border-amber-800 dark:bg-amber-900/60 dark:text-amber-100'
  return 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
}

function DemandTile({ t, maxJobs }: { t: DistrictTaluka; maxJobs: number }) {
  const intensity = maxJobs > 0 ? t.jobsToday / maxJobs : 0
  return (
    <div
      className={cn('rounded-xl border p-3.5 shadow-sm transition hover:shadow', tileTone(intensity))}
      role="img"
      aria-label={`${t.name} taluka: ${fmt(t.jobsToday)} jobs today, ${t.utilizationPct.toFixed(1)} percent utilization`}
    >
      <p className="flex items-center justify-between gap-1 text-sm font-bold leading-tight">
        {t.name}
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">{Math.round(intensity * 100)}%</span>
      </p>
      <p className="mt-1.5 text-xl font-bold tabular-nums leading-none">{fmt(t.jobsToday)}</p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide opacity-80">jobs today</p>
      <p className="mt-2 border-t border-current/20 pt-1.5 text-[11px] font-medium tabular-nums opacity-90">
        {fmt(t.workers)} workers · {t.utilizationPct.toFixed(1)}% util
      </p>
    </div>
  )
}

// ---- Capacity transfer callout ----

function TransferCallout({ opp, surplus }: { opp: Opportunity; surplus: Opportunity | null }) {
  const setView = useAppStore((s) => s.setView)
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500 text-white">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-700 dark:text-red-300">
              Cross-cooperative capacity transfer — AI detected
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug">
              AI detects: {opp.coop} needs ~{Math.abs(opp.gap)} more {skillLabel(opp.skill)}(s) today
            </p>
            {surplus && (
              <p className="mt-1 text-xs text-muted-foreground">
                Nearest surplus: <span className="font-medium text-foreground">{surplus.coop}</span> has{' '}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{surplus.gap}</span> spare {skillLabel(surplus.skill)}(s).
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">Review in Cooperative Service Exchange — taluka coordinators finalize the transfer.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setView('exchange')}>
          <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" /> Open Service Exchange
        </Button>
      </div>
    </div>
  )
}

// ---- Comparison table ----

function ComparisonTable({ rows }: { rows: DistrictResp['comparison'] }) {
  if (rows.length === 0) {
    return <EmptyState title="No comparison data" body="Cross-cooperative capacity comparison is not configured for this district yet." />
  }
  return (
    <ScrollList ariaLabel="Cooperative capacity comparison" className="min-h-0">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>Cooperative</TableHead>
            <TableHead>Skill</TableHead>
            <TableHead className="text-right">Available</TableHead>
            <TableHead className="text-right">Expected jobs</TableHead>
            <TableHead className="text-right">Gap</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const kind = tradeKind(r.available, r.expectedJobs)
            const gap = r.available - r.expectedJobs
            return (
              <TableRow key={`${r.coop}-${r.skill}`}>
                <TableCell className="max-w-[220px] truncate text-sm font-medium" title={r.coop}>{r.coop}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span className="text-primary">{skillIcon(r.skill)}</span>
                    {skillLabel(r.skill)}
                  </span>
                </TableCell>
                <TableCell className="text-right text-sm font-semibold tabular-nums">{r.available}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{r.expectedJobs}</TableCell>
                <TableCell
                  className={cn(
                    'text-right text-sm font-bold tabular-nums',
                    gap > 0 ? 'text-emerald-600 dark:text-emerald-400' : gap < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                  )}
                >
                  {signedGap(gap)}
                </TableCell>
                <TableCell className="text-right">
                  <span className={cn(kind === 'SHORTAGE' && 'text-red-600 dark:text-red-400', kind === 'SURPLUS' && 'text-emerald-600 dark:text-emerald-400')}>
                    <span className="inline-flex items-center rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-bold tracking-wide">
                      {kind}
                    </span>
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollList>
  )
}

// ---- Taluka summary card ----

const GAP_CHIP = 'inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300'

function TalukaSummaryCard({ t, canDrill, onOpen }: { t: DistrictTaluka; canDrill: boolean; onOpen: () => void }) {
  const topDemand = demandEntries(t.demand).slice(0, 3)
  const topGaps: SkillGap[] = [...t.skillGap].sort((a, b) => b.need - b.have - (a.need - a.have)).slice(0, 3)
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-snug">{t.name} Taluka</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <UsersRound className="h-3 w-3" /> Coord. {t.coordinator}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-bold tabular-nums text-accent-foreground">
          {fmt(t.jobsToday)} jobs
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/50 px-1 py-1.5">
          <p className="text-sm font-bold tabular-nums">{fmt(t.workers)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">workers</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-1 py-1.5">
          <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(t.availableWorkers)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">available</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-1 py-1.5">
          <p className="flex items-center justify-center gap-1 text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
            <Siren className="h-3 w-3" />{t.emergencyCapacity}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">SOS pool</p>
        </div>
      </div>

      <div className="mt-3">
        <UtilBar pct={t.utilizationPct} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {topDemand.map(([skill, level]) => (
          <span key={skill} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-1 text-[11px] font-medium">
            {skillIcon(skill)}
            {skillLabel(skill)}
            <DemandBadge level={level} />
          </span>
        ))}
      </div>

      {t.recommendation && (
        <p className="mt-3 flex items-start gap-1.5 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
          <span><span className="font-semibold text-foreground">AI:</span> {t.recommendation}</span>
        </p>
      )}

      {topGaps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {topGaps.map((g) => {
            const shortfall = g.need - g.have
            return shortfall > 0 ? (
              <span key={g.skill} className={GAP_CHIP}>
                {skillLabel(g.skill)} −{shortfall}
              </span>
            ) : null
          })}
        </div>
      )}

      {canDrill && (
        <Button size="sm" variant="ghost" className="mt-3 w-full justify-between border-t pt-2 text-xs text-primary hover:text-primary" onClick={onOpen}>
          Open taluka dashboard <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

export function DistrictDashboard({ user, focusId }: { user: DemoUser; focusId?: string }) {
  const drillTo = useAppStore((s) => s.drillTo)
  const clearFocus = useAppStore((s) => s.clearFocus)
  const lang = useAppStore((s) => s.lang)
  const { toast } = useToast()
  const q = useHierarchyDashboard<DistrictResp>('district', user, focusId)
  const canDrillTaluka = ROLE_VIEWS[user.role].includes('taluka')

  if (q.isLoading) return <DashSkeleton />
  if (q.isError || !q.data?.district)
    return (
      <div className="space-y-4">
        {focusId && (
          <DrillBanner
            label={t('drillUnavailable', lang)}
            sublabel={t('drillUnavailableSubDistrict', lang)}
            onClear={() => clearFocus(['district'])}
            clearLabel={t('drillClear', lang)}
          />
        )}
        <DashError message={(q.error as Error | null)?.message} onRetry={() => q.refetch()} />
      </div>
    )

  const { district, talukas, comparison, opportunities, recommendations } = q.data

  const topShortage = opportunities.filter((o) => o.kind === 'SHORTAGE').sort((a, b) => a.gap - b.gap)[0] ?? null
  const topSurplus = opportunities.filter((o) => o.kind === 'SURPLUS').sort((a, b) => b.gap - a.gap)[0] ?? null

  const totalEmergency = talukas.reduce((s, t) => s + t.emergencyCapacity, 0)
  const smallestEmergency = [...talukas].sort((a, b) => a.emergencyCapacity - b.emergencyCapacity).slice(0, 3)
  const maxJobs = Math.max(...talukas.map((t) => t.jobsToday), 1)

  return (
    <div className="space-y-5">
      {/* Drill-down context */}
      {focusId && (
        <DrillBanner
          label={`${t('drillViewing', lang)} ${district.name} · ${t('drillTag', lang)}`}
          sublabel={user.districtId ? t('drillSubDistrictOwn', lang) : t('drillSubDistrictFeatured', lang)}
          onClear={() => clearFocus(['district'])}
          clearLabel={user.districtId ? t('drillBackDistrict', lang) : t('drillClearFocus', lang)}
        />
      )}

      {/* Governance actions — the coordinator can now ACT on what the dashboard shows,
          not just read it (complaint acknowledgement, training sanction, mutual aid). */}
      <GovernanceActions
        user={user}
        scopeLabel={district.name}
        cooperativeIds={[]}
        cooperativeNames={comparison.map((c) => c.coop)}
        opportunities={opportunities}
      />

      {/* Header */}
      <section aria-label="District overview">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-amber-500 p-5 text-primary-foreground shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest opacity-90">District command center</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{district.name} District — Workforce Command Center</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-95">
                <UsersRound className="h-4 w-4" />
                District Coordinator <span className="font-semibold">{district.coordinator}</span>
                <span aria-hidden>·</span>
                {talukas.length} talukas · {district.zoneCount} service zones
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="rounded-lg bg-primary-foreground/15 px-2.5 py-2 backdrop-blur-sm">
                <LevelPill level={3} label="District Cooperative Network" />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-primary-foreground/40 bg-primary-foreground/15 px-2.5 text-xs text-primary-foreground backdrop-blur-sm hover:bg-primary-foreground/25 hover:text-primary-foreground"
                aria-label={`Download ${district.name} district snapshot as CSV`}
                onClick={() => {
                  try {
                    downloadCsv(`gigsetu-district-${slugify(district.name).slice(0, 40)}.csv`, buildDistrictCsv(district, talukas, comparison))
                    toast({
                      title: 'Snapshot downloaded',
                      description: `${talukas.length} talukas and ${comparison.length} capacity-comparison rows exported as CSV.`,
                    })
                  } catch {
                    toast({ title: 'Export failed', description: 'The snapshot could not be generated in this browser.', variant: 'destructive' })
                  }
                }}
              >
                <Download className="h-3.5 w-3.5" /> Snapshot CSV
              </Button>
            </div>
          </div>
        </div>
        <PrototypeNotice className="mt-3" />
      </section>

      {/* KPI row */}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Cooperatives" value={district.cooperatives} sub="across all talukas" icon={<Building2 className="h-4 w-4" />} />
        <KpiCard label="Workers" value={fmt(district.workers)} sub="registered in district" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Jobs today" value={fmt(district.jobsToday)} sub="bookings network-wide" icon={<BriefcaseBusiness className="h-4 w-4" />} tone="primary" />
        <KpiCard label="Utilization" value={`${district.utilizationPct.toFixed(1)}%`} sub="workforce engaged" icon={<Activity className="h-4 w-4" />} tone="warning" />
        <KpiCard label="Active workers" value={fmt(district.activeWorkers)} sub="on a job or en route" icon={<UserCheck className="h-4 w-4" />} tone="success" />
        <KpiCard label="Zone count" value={district.zoneCount} sub="service planning zones" icon={<Grid3X3 className="h-4 w-4" />} />
      </section>

      {/* Demand by skill */}
      <div data-demo-target="district-demand-by-skill">
      <SectionCard
        title="District demand by skill"
        description="Aggregated demand signal across the district, from today's booking flow"
        actions={<DemandLegend />}
      >
        <div className="flex flex-wrap gap-2">
          {demandEntries(district.demandJson).map(([skill, level]) => (
            <span key={skill} className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs font-medium">
              <span className="text-primary">{skillIcon(skill)}</span>
              {skillLabel(skill)}
              <DemandBadge level={level} />
            </span>
          ))}
        </div>
      </SectionCard>
      </div>

      {/* Schematic taluka demand map */}
      <SectionCard
        title="Schematic taluka demand map (prototype)"
        description="Tile intensity reflects today's job volume per taluka relative to the busiest taluka — schematic grid, not geographic scale"
        actions={<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="font-semibold text-amber-700 dark:text-amber-400">▓ more jobs</span> → <span className="font-semibold">░ fewer</span></span>}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {talukas.map((t) => (
            <DemandTile key={t.id} t={t} maxJobs={maxJobs} />
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Geographic positioning (mapPos) of this district on the state map: x={district.mapPos?.x ?? '—'}, y={district.mapPos?.y ?? '—'} — rendered by the State Federation view.
        </p>
      </SectionCard>

      {/* AI recommendations */}
      <SectionCard
        title="AI recommendations — district actions"
        description="Generated from live demand, skill gaps and utilization across the district network"
        actions={<span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent-foreground"><Sparkles className="h-3 w-3 text-primary" /> AI</span>}
      >
        {recommendations.length === 0 ? (
          <EmptyState icon={<Sparkles className="h-8 w-8" />} title="No recommendations yet" body="AI advice appears as soon as demand data flows in." />
        ) : (
          <ol className="space-y-2">
            {recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-2.5 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{i + 1}</span>
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {/* Comparison table */}
      <SectionCard
        title="Cross-cooperative capacity comparison"
        description="Available workers vs expected jobs per skill — status computed live (±4 tolerance)"
        actions={<span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Layers className="h-3.5 w-3.5" /> {comparison.length} coop-skill rows</span>}
      >
        <ComparisonTable rows={comparison} />
      </SectionCard>

      {/* Capacity transfer callout */}
      {topShortage && (
        <section aria-label="Capacity transfer recommendation">
          <TransferCallout opp={topShortage} surplus={topSurplus} />
        </section>
      )}

      {/* Taluka summary cards */}
      <SectionCard
        title="Taluka summary"
        description="Per-taluka workforce health, top demand skills and AI advice"
      >
        {talukas.length === 0 ? (
          <EmptyState title="No talukas configured" body="Taluka networks will appear here once registered." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {talukas.map((t) => (
              <TalukaSummaryCard
                key={t.id}
                t={t}
                canDrill={canDrillTaluka && t.id !== user.talukaId}
                onOpen={() => drillTo('taluka', { taluka: t.id })}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Emergency capacity summary */}
      <SectionCard
        title="Emergency capacity summary"
        description="SOS-pool workers held in reserve across the district for priority dispatch"
        actions={<span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Siren className="h-3.5 w-3.5 text-red-500" /> district total</span>}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="rounded-xl border border-red-200 bg-red-50/60 px-6 py-4 text-center dark:border-red-900 dark:bg-red-950/30">
            <p className="text-3xl font-bold tabular-nums text-red-600 dark:text-red-400">{totalEmergency}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700/80 dark:text-red-300/80">emergency workers on standby</p>
          </div>
          <div className="flex-1">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Smallest reserves need attention
            </p>
            {smallestEmergency.map((t) => (
              <AttentionRow
                key={t.id}
                severity={t.emergencyCapacity < 10 ? 'SERIOUS' : 'WARNING'}
                label={`${t.name}: only ${t.emergencyCapacity} emergency-pool workers (${t.availableWorkers} available overall)`}
              />
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
