'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  KpiCard, SectionCard, DemandBadge, LevelPill, PrototypeNotice, EmptyState,
} from '../shared/ui-kit'
import {
  useHierarchyDashboard, DashSkeleton, DashError, DemandLegend, UtilBar, ScrollList,
  skillIcon, skillLabel, demandEntries, hasLevel, DrillBanner,
  type TalukaResp, type DemandMap, type TalukaCoop, type SkillGap,
} from './taluka-district-kit'
import { useAppStore, ROLE_VIEWS } from '@/store/app-store'
import type { DemoUser } from '@/lib/types'
import { t } from '@/lib/i18n'
import { useToast } from '@/hooks/use-toast'
import { csvRow, downloadCsv, slugify } from '../shared/csv'
import { GovernanceActions } from './governance-actions'
import {
  Sparkles, Building2, Users, UserCheck, BriefcaseBusiness, Siren, Activity,
  MapPin, TrendingUp, UsersRound, GraduationCap, ArrowUpRight, Download,
} from 'lucide-react'

// ---------- Snapshot export (client-side CSV from already-fetched dashboard data) ----------

function buildTalukaCsv(taluka: TalukaResp['taluka'], cooperatives: TalukaCoop[]): string {
  const lines: string[] = []
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' IST'
  lines.push(csvRow(['GigSetu taluka snapshot (SIH prototype — synthetic data)']))
  lines.push(csvRow(['Taluka', taluka.name]))
  lines.push(csvRow(['Coordinator', taluka.coordinator]))
  lines.push(csvRow(['Cooperatives', taluka.cooperatives, 'Workers', taluka.workers]))
  lines.push(csvRow(['Available now', taluka.availableWorkers, 'Jobs today', taluka.jobsToday]))
  lines.push(csvRow(['Emergency capacity', taluka.emergencyCapacity, 'Utilisation %', taluka.utilizationPct.toFixed(1)]))
  lines.push(csvRow(['AI recommendation', taluka.recommendation]))
  lines.push(csvRow(['Generated at', stamp]))
  lines.push('')
  lines.push(csvRow(['--- ZONE DEMAND MATRIX ---']))
  lines.push(csvRow(['Zone', 'Skill', 'Demand level', 'Note']))
  for (const z of taluka.zonesJson) {
    for (const [skill, level] of Object.entries(z.demand)) {
      lines.push(csvRow([z.zone, skill, level, z.note ?? '']))
    }
  }
  lines.push('')
  lines.push(csvRow(['--- SKILL GAPS ---']))
  lines.push(csvRow(['Skill', 'Registered workers', 'Projected need', 'Shortfall']))
  for (const g of taluka.skillGapJson) {
    lines.push(csvRow([g.skill, g.have, g.need, Math.max(0, g.need - g.have)]))
  }
  lines.push('')
  lines.push(csvRow(['--- PARTICIPATING COOPERATIVES ---']))
  lines.push(csvRow(['Name', 'Sector', 'Workers', 'Active today', 'Jobs today', 'Utilisation %', 'Emergency pool']))
  for (const c of cooperatives) {
    lines.push(csvRow([c.name, c.sector, c.workerCount, c.activeToday, c.jobsToday, c.utilizationPct.toFixed(1), c.emergencyPoolSize]))
  }
  return lines.join('\n')
}

// Zone heatmap accent: red/amber left border when any skill demand is HIGH / MEDIUM
function zoneAccent(demand: DemandMap): string {
  if (hasLevel(demand, 'HIGH')) return 'border-l-4 border-l-red-400 dark:border-l-red-500'
  if (hasLevel(demand, 'MEDIUM')) return 'border-l-4 border-l-amber-400 dark:border-l-amber-500'
  return 'border-l-4 border-l-zinc-300 dark:border-l-zinc-700'
}

function ZoneCard({ zone, demand, note }: { zone: string; demand: DemandMap; note?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm transition hover:shadow', zoneAccent(demand))}>
      <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        {zone}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {demandEntries(demand).map(([skill, level]) => (
          <span key={skill} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-1 text-[11px] font-medium">
            {skillIcon(skill)}
            {skillLabel(skill)}
            <DemandBadge level={level} />
          </span>
        ))}
      </div>
      {note && <p className="mt-2.5 border-t pt-2 text-[11px] italic leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  )
}

function SkillGapRow({ gap }: { gap: SkillGap }) {
  const shortfall = gap.need - gap.have
  const pct = gap.need > 0 ? Math.min(100, (gap.have / gap.need) * 100) : 100
  const covered = shortfall <= 0
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-primary">{skillIcon(gap.skill)}</span>
          {skillLabel(gap.skill)}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {gap.have.toLocaleString('en-IN')} have / {gap.need.toLocaleString('en-IN')} need
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
          aria-label={`${skillLabel(gap.skill)} coverage ${Math.round(pct)} percent`}
        >
          <div className={cn('h-full rounded-full', covered ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn('w-28 shrink-0 text-right text-[11px] font-semibold tabular-nums', covered ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
          {covered ? 'covered' : `need ${shortfall.toLocaleString('en-IN')} more`}
        </span>
      </div>
    </div>
  )
}

function CoopCard({ c, canDrill, onOpen }: { c: TalukaCoop; canDrill: boolean; onOpen: () => void }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm transition', canDrill && 'hover:border-primary/40')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-snug">{c.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="text-primary">{skillIcon(c.sector)}</span>
            {skillLabel(c.sector)} sector society
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-bold tabular-nums text-accent-foreground">
          {c.jobsToday.toLocaleString('en-IN')} jobs
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/50 px-1 py-1.5">
          <p className="text-sm font-bold tabular-nums">{c.workerCount.toLocaleString('en-IN')}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">workers</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-1 py-1.5">
          <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{c.activeToday.toLocaleString('en-IN')}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">active</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-1 py-1.5">
          <p className="flex items-center justify-center gap-1 text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
            <Siren className="h-3 w-3" />{c.emergencyPoolSize}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">SOS pool</p>
        </div>
      </div>
      <div className="mt-3">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Utilization today</p>
        <UtilBar pct={c.utilizationPct} />
      </div>
      {canDrill && (
        <Button size="sm" variant="ghost" className="mt-3 w-full justify-between border-t pt-2 text-xs text-primary hover:text-primary" onClick={onOpen}>
          Open cooperative dashboard <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

export function TalukaDashboard({ user, focusId }: { user: DemoUser; focusId?: string }) {
  const drillTo = useAppStore((s) => s.drillTo)
  const clearFocus = useAppStore((s) => s.clearFocus)
  const lang = useAppStore((s) => s.lang)
  const { toast } = useToast()
  const q = useHierarchyDashboard<TalukaResp>('taluka', user, focusId)
  const canDrillCoop = ROLE_VIEWS[user.role].includes('coop')

  const gaps = useMemo(() => {
    const list = q.data?.taluka.skillGapJson ?? []
    return [...list].sort((a, b) => b.need - b.have - (a.need - a.have))
  }, [q.data])

  if (q.isLoading) return <DashSkeleton />
  if (q.isError || !q.data?.taluka)
    return (
      <div className="space-y-4">
        {focusId && (
          <DrillBanner
            label={t('drillUnavailable', lang)}
            sublabel={t('drillUnavailableSubTaluka', lang)}
            onClear={() => clearFocus(['taluka'])}
            clearLabel={t('drillClear', lang)}
          />
        )}
        <DashError message={(q.error as Error | null)?.message} onRetry={() => q.refetch()} />
      </div>
    )

  const { taluka, cooperatives } = q.data

  return (
    <div className="space-y-5">
      {/* Drill-down context */}
      {focusId && (
        <DrillBanner
          label={`${t('drillViewing', lang)} ${taluka.name} · ${t('drillTag', lang)}`}
          sublabel={user.talukaId ? t('drillSubTalukaOwn', lang) : t('drillSubTalukaFeatured', lang)}
          onClear={() => clearFocus(['taluka'])}
          clearLabel={user.talukaId ? t('drillBackTaluka', lang) : t('drillClearFocus', lang)}
        />
      )}

      {/* Header */}
      <section aria-label="Taluka overview">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-amber-500 p-5 text-primary-foreground shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest opacity-90">Taluka / Block coordination</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{taluka.name} Taluka</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-95">
                <UsersRound className="h-4 w-4" />
                Coordinator <span className="font-semibold">{taluka.coordinator}</span>
                <span aria-hidden>·</span>
                {taluka.cooperatives} cooperative societies in this block
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="rounded-lg bg-primary-foreground/15 px-2.5 py-2 backdrop-blur-sm">
                <LevelPill level={4} label="Taluka / Block Network" />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-primary-foreground/40 bg-primary-foreground/15 px-2.5 text-xs text-primary-foreground backdrop-blur-sm hover:bg-primary-foreground/25 hover:text-primary-foreground"
                aria-label={`Download ${taluka.name} taluka snapshot as CSV`}
                onClick={() => {
                  try {
                    downloadCsv(`gigsetu-taluka-${slugify(taluka.name).slice(0, 40)}.csv`, buildTalukaCsv(taluka, cooperatives))
                    toast({
                      title: 'Snapshot downloaded',
                      description: `${taluka.zonesJson.length} zones, ${taluka.skillGapJson.length} skill gaps and ${cooperatives.length} cooperatives exported as CSV.`,
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
        <KpiCard label="Cooperatives" value={taluka.cooperatives} sub="participating societies" icon={<Building2 className="h-4 w-4" />} />
        <KpiCard label="Total workers" value={taluka.workers.toLocaleString('en-IN')} sub="registered in taluka" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Available" value={taluka.availableWorkers.toLocaleString('en-IN')} sub="free to accept work now" icon={<UserCheck className="h-4 w-4" />} tone="success" />
        <KpiCard label="Jobs today" value={taluka.jobsToday.toLocaleString('en-IN')} sub="bookings across network" icon={<BriefcaseBusiness className="h-4 w-4" />} tone="primary" />
        <KpiCard label="Emergency capacity" value={taluka.emergencyCapacity} sub="SOS pool on standby" icon={<Siren className="h-4 w-4" />} tone="danger" />
        <KpiCard label="Utilization" value={`${taluka.utilizationPct.toFixed(1)}%`} sub="workers engaged today" icon={<Activity className="h-4 w-4" />} tone="warning" />
      </section>

      {/* Governance actions — a coordinator can now ACT on the signal, not only read it. */}
      <GovernanceActions
        user={user}
        scopeLabel={`${taluka.name} Taluka`}
        cooperativeIds={[]}
        cooperativeNames={[]}
        skillGaps={taluka.skillGapJson}
      />

      {/* AI recommendation banner */}
      <section aria-label="AI recommendation">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-accent p-4 shadow-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">AI recommendation</p>
            <p className="mt-0.5 text-sm font-medium leading-relaxed">{taluka.recommendation}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Generated from zone demand, skill gaps and live utilization — advisory only.</p>
          </div>
        </div>
      </section>

      {/* Demand by category */}
      <div data-demo-target="taluka-workers-card">
      <SectionCard
        title="Demand by service category"
        description="Aggregated taluka-level demand signal per skill, from today's booking flow"
        actions={<DemandLegend />}
      >
        <div className="flex flex-wrap gap-2">
          {demandEntries(taluka.demandJson).map(([skill, level]) => (
            <span key={skill} className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs font-medium">
              <span className="text-primary">{skillIcon(skill)}</span>
              {skillLabel(skill)}
              <DemandBadge level={level} />
            </span>
          ))}
        </div>
      </SectionCard>
      </div>

      {/* Zone heatmap */}
      <SectionCard
        title="Service demand heatmap"
        description={`Schematic zone view across ${taluka.name} taluka — red/amber edge marks elevated demand`}
        actions={<DemandLegend />}
      >
        {taluka.zonesJson.length === 0 ? (
          <EmptyState icon={<MapPin className="h-8 w-8" />} title="No zone data" body="Zone demand feed will appear here once configured." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {taluka.zonesJson.map((z) => (
              <ZoneCard key={z.zone} zone={z.zone} demand={z.demand} note={z.note} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Skill gaps + cooperatives */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Skill gap analysis"
          description="Registered workers vs projected daily need"
          actions={<span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><GraduationCap className="h-3.5 w-3.5" /> training & intake signal</span>}
        >
          {gaps.length === 0 ? (
            <EmptyState title="No skill gaps reported" body="All tracked skills meet projected need." />
          ) : (
            <div className="divide-y">
              {gaps.map((g) => (
                <SkillGapRow key={g.skill} gap={g} />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Participating cooperatives"
          description={`${cooperatives.length} primary societies under ${taluka.name} taluka network`}
          actions={<span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> live utilization</span>}
        >
          {cooperatives.length === 0 ? (
            <EmptyState icon={<Building2 className="h-8 w-8" />} title="No cooperatives yet" body="Primary societies will be listed here as they onboard." />
          ) : (
            <ScrollList ariaLabel="Cooperative list">
              <div className="grid gap-3">
                {cooperatives.map((c) => (
                  <CoopCard
                    key={c.id}
                    c={c}
                    canDrill={canDrillCoop && c.id !== user.orgId}
                    onOpen={() => drillTo('coop', { coop: c.id })}
                  />
                ))}
              </div>
            </ScrollList>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
