'use client'

// Phase 6 (15-d) — Platform Admin console (#43) now six tabs
// (Overview · Network · Finance · Trust & Safety · AI & Integrations · Audit & Transparency), fed by
// /api/admin + /api/payments + /api/economics + /api/audit (#57). Charts come from the shared
// analytics-kit (#55). AI matching weights card (Task 9) preserved in the AI tab.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, fmtDateTime, inr, signInAs, timeAgo } from '@/lib/api-client'
import { useAppStore, type View } from '@/store/app-store'
import { t } from '@/lib/i18n'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { AdminOverviewDTO, DemoUser, EconomicsDTO, ExchangeDTO, FeeConfigDTO, MatchWeightsDTO, PaymentHistoryDTO } from '@/lib/types'
import { SectionCard, KpiCard, PrototypeNotice, StatusChip, EmptyState } from './shared/ui-kit'
import { BarChartMini, ChartLegend, DonutMini, StackedBar, SparkLine } from './shared/analytics-kit'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Activity, Building2, Users, Briefcase, Server, ShieldAlert, Database,
  Workflow, Landmark, Repeat, UserCheck, Timer, Sparkles, SlidersHorizontal, RotateCcw, Save, Loader2,
  Search, ShieldCheck, Plug, AlertTriangle, MapPin, ScrollText, RefreshCw,
} from 'lucide-react'

const QUICK_NAV: Array<{ view: View; label: string; desc: string; icon: React.ReactNode }> = [
  { view: 'customer', label: 'Customer App', desc: 'Book, track, pay, rate', icon: <UserCheck className="h-4 w-4" /> },
  { view: 'worker', label: 'Worker App', desc: 'Jobs, passport, welfare', icon: <Users className="h-4 w-4" /> },
  { view: 'coop', label: 'Cooperative', desc: 'Pune Electrical Labour Coop', icon: <Building2 className="h-4 w-4" /> },
  { view: 'taluka', label: 'Taluka', desc: 'Haveli coordination', icon: <Workflow className="h-4 w-4" /> },
  { view: 'district', label: 'District', desc: 'Pune command center', icon: <Activity className="h-4 w-4" /> },
  { view: 'state', label: 'State Federation', desc: 'Maharashtra intelligence', icon: <Landmark className="h-4 w-4" /> },
  { view: 'national', label: 'National Apex', desc: 'Apex network view', icon: <Database className="h-4 w-4" /> },
  { view: 'map', label: 'Network Map', desc: 'Geo view of the network', icon: <MapPin className="h-4 w-4" /> },
  { view: 'exchange', label: 'Service Exchange', desc: 'Cross-coop transfers', icon: <Repeat className="h-4 w-4" /> },
  { view: 'hierarchy', label: 'Hierarchy Engine', desc: 'Configurable levels 0–6', icon: <Workflow className="h-4 w-4" /> },
  { view: 'government', label: 'Gov Ecosystem', desc: 'Authorized integration design', icon: <Landmark className="h-4 w-4" /> },
]

// ---------- AI matching weights (Task 9) ----------

const WEIGHT_KEYS = ['skillMatch', 'certification', 'distance', 'availability', 'workload', 'serviceHistory'] as const
type WeightKey = (typeof WEIGHT_KEYS)[number]

interface WeightsResponse {
  ok: boolean
  weights: MatchWeightsDTO
  meta: Array<{ key: string; label: string; desc: string }>
  defaults: Record<WeightKey, number>
}

function pickWeights(w: Pick<MatchWeightsDTO, WeightKey>): Record<WeightKey, number> {
  return {
    skillMatch: w.skillMatch,
    certification: w.certification,
    distance: w.distance,
    availability: w.availability,
    workload: w.workload,
    serviceHistory: w.serviceHistory,
  }
}

// ---------- Phase 6 #57 — audit & transparency ----------

interface AuditEntry {
  id: string; at: string; actor: string; actorRole: string
  action: string; entity: string; entityId: string; detail: string
}

interface AuditResponse {
  ok: boolean
  entries: AuditEntry[]
  actions: string[]
  total: number
}

function ActionChip({ action }: { action: string }) {
  return (
    <span className="inline-block max-w-[200px] truncate rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-primary" title={action}>
      {action}
    </span>
  )
}

// ---------- small helpers ----------

function num(n: number | undefined | null): string {
  return typeof n === 'number' ? n.toLocaleString('en-IN') : '—'
}

const STATUS_COLOR: Record<string, string> = {
  PAID: 'stroke-emerald-500',
  COMPLETED: 'stroke-zinc-400',
  REVIEWED: 'stroke-amber-500',
}

function UtilBarMini({ pct }: { pct: number }) {
  const tone = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full max-w-[90px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={cn('h-1.5 rounded-full', tone)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
}

export function PlatformAdmin({ user }: { user: DemoUser }) {
  const setView = useAppStore((s) => s.setView)
  const lang = useAppStore((s) => s.lang)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const sessionQ = useQuery({
    queryKey: ['platform-sessions'],
    queryFn: () =>
      api
        .get<{ ok: boolean; identities: { role: string; name: string; orgName: string }[] }>('/api/auth/identities')
        .then((r) => r.identities.map((i) => ({ role: i.role, name: i.name, org: i.orgName }))),
    staleTime: 30000,
  })
  const exchangeQ = useQuery({
    queryKey: ['platform-exchange'],
    queryFn: () => api.get<{ ok: boolean; recommendations: ExchangeDTO[]; stats: { pending: number; approved: number; rejected: number; workersMoved: number } }>('/api/exchange'),
    refetchInterval: 20000,
  })

  // ----- Phase 5 platform aggregates -----
  const adminQ = useQuery({
    queryKey: ['platform-admin'],
    queryFn: () => api.get<AdminOverviewDTO>('/api/admin'),
    refetchInterval: 30000,
  })
  const payQ = useQuery({
    queryKey: ['platform-payments'],
    queryFn: () => api.get<{ ok: boolean; config: FeeConfigDTO; payments: PaymentHistoryDTO[] }>('/api/payments'),
    staleTime: 20000,
  })
  const econQ = useQuery({
    queryKey: ['platform-economics'],
    queryFn: () => api.get<EconomicsDTO>('/api/economics'),
    staleTime: 20000,
  })

  // ----- Phase 6 #57 — audit & transparency viewer -----
  const [auditAction, setAuditAction] = useState('ALL')
  const [auditQInput, setAuditQInput] = useState('')
  const [auditQueryText, setAuditQueryText] = useState('')
  // debounce the free-text query so typing doesn't spam the API
  useEffect(() => {
    const h = setTimeout(() => setAuditQueryText(auditQInput.trim()), 300)
    return () => clearTimeout(h)
  }, [auditQInput])

  const auditLogQ = useQuery({
    queryKey: ['audit-log', auditAction, auditQueryText],
    queryFn: () => api.get<AuditResponse>(
      `/api/audit?limit=120${auditAction !== 'ALL' ? `&action=${encodeURIComponent(auditAction)}` : ''}${auditQueryText ? `&q=${encodeURIComponent(auditQueryText)}` : ''}`
    ),
    refetchInterval: 30000,
  })
  const auditEntries = useMemo(() => auditLogQ.data?.entries ?? [], [auditLogQ.data])
  const auditActions = auditLogQ.data?.actions ?? []
  const auditActorCount = useMemo(() => new Set(auditEntries.map((e) => e.actor)).size, [auditEntries])

  const admin = adminQ.data
  const counts = admin?.counts ?? {}
  const payments = admin?.payments
  const fee = payQ.data?.config
  const [coopSearch, setCoopSearch] = useState('')
  const coops = useMemo(() => {
    const list = admin?.coopCapacity ?? []
    const q = coopSearch.trim().toLowerCase()
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list
  }, [admin, coopSearch])

  const financeSegments = useMemo(
    () =>
      payments
        ? [
            { label: t('paSplitWorker', lang), value: payments.workerRs, color: 'bg-emerald-500' },
            { label: t('paSplitCoop', lang), value: payments.coopRs, color: 'bg-amber-500' },
            { label: t('paSplitWelfare', lang), value: payments.welfareRs, color: 'bg-orange-400' },
            { label: t('paSplitPlatform', lang), value: payments.platformRs, color: 'bg-zinc-400' },
          ]
        : [],
    [payments, lang]
  )
  const financeLegend = useMemo(
    () =>
      payments
        ? [
            { label: t('paSplitWorker', lang), value: inr(payments.workerRs), dotClass: 'bg-emerald-500' },
            { label: t('paSplitCoop', lang), value: inr(payments.coopRs), dotClass: 'bg-amber-500' },
            { label: t('paSplitWelfare', lang), value: inr(payments.welfareRs), dotClass: 'bg-orange-400' },
            { label: t('paSplitPlatform', lang), value: inr(payments.platformRs), dotClass: 'bg-zinc-400' },
          ]
        : [],
    [payments, lang]
  )
  const settledShare = admin && admin.counts.bookings > 0 ? Math.round(((payments?.settledCount ?? 0) / admin.counts.bookings) * 100) : 0

  // ----- Matching weights admin (this console is only reachable by PLATFORM_ADMIN — see ROLE_VIEWS) -----
  const weightsQ = useQuery({
    queryKey: ['ai-weights'],
    queryFn: () => api.get<WeightsResponse>('/api/ai/weights'),
    staleTime: 15000,
  })
  const [draft, setDraft] = useState<Record<WeightKey, number> | null>(null)
  // Sliders edit a draft; null until the fetch resolves (draft-less render shows a skeleton)
  const effDraft = draft ?? (weightsQ.data ? pickWeights(weightsQ.data.weights) : null)
  const totalPts = useMemo(
    () => (effDraft ? WEIGHT_KEYS.reduce((s, k) => s + (effDraft[k] || 0), 0) : 0),
    [effDraft]
  )

  const saveWeights = useMutation({
    mutationFn: async (w: Record<WeightKey, number>) => {
      const res = await fetch('/api/ai/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...w, updatedBy: 'platform-admin' }),
      })
      const data = await res.json()
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `Request failed: ${res.status}`)
      return data as { ok: boolean; weights: MatchWeightsDTO }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<WeightsResponse>(['ai-weights'], (old) => (old ? { ...old, weights: data.weights } : old))
      setDraft(pickWeights(data.weights))
      toast({ title: t('mwSavedToast', lang), description: t('mwSavedToastSub', lang) })
    },
    onError: () => {
      toast({ title: t('mwSaveFailToast', lang), description: t('mwSaveFailSub', lang), variant: 'destructive' })
    },
  })

  const resetDraft = () => {
    if (!weightsQ.data) return
    setDraft({ ...weightsQ.data.defaults })
    toast({ title: t('mwResetToast', lang), description: t('mwResetToastSub', lang) })
  }

  const saved = weightsQ.data?.weights
  const customised = Boolean(saved && saved.updatedBy && saved.updatedBy !== 'system')

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Platform Admin Console</h1>
            <p className="text-sm text-muted-foreground">System / platform operations · all demo roles share one live data layer</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5 text-emerald-600" /> API healthy · SQLite prototype store · simulation active
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="overview" className="min-h-9 gap-1.5 text-xs"><Activity className="h-3.5 w-3.5" /> {t('paTabOverview', lang)}</TabsTrigger>
          <TabsTrigger value="network" className="min-h-9 gap-1.5 text-xs"><Building2 className="h-3.5 w-3.5" /> {t('paTabNetwork', lang)}</TabsTrigger>
          <TabsTrigger value="finance" className="min-h-9 gap-1.5 text-xs"><Landmark className="h-3.5 w-3.5" /> {t('paTabFinance', lang)}</TabsTrigger>
          <TabsTrigger value="trust" className="min-h-9 gap-1.5 text-xs"><ShieldAlert className="h-3.5 w-3.5" /> {t('paTabTrust', lang)}</TabsTrigger>
          <TabsTrigger value="ai" className="min-h-9 gap-1.5 text-xs"><Sparkles className="h-3.5 w-3.5" /> {t('paTabAI', lang)}</TabsTrigger>
          <TabsTrigger value="audit" className="min-h-9 gap-1.5 text-xs"><ScrollText className="h-3.5 w-3.5" /> Audit &amp; Transparency</TabsTrigger>
        </TabsList>

        {/* ============================ OVERVIEW ============================ */}
        <TabsContent value="overview" className="mt-0 space-y-4">
          {adminQ.isError ? (
            <EmptyState
              icon={<AlertTriangle className="h-8 w-8" />}
              title={t('paAdminErr', lang)}
              action={<Button size="sm" className="h-10" onClick={() => adminQ.refetch()}>{t('paRetry', lang)}</Button>}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <KpiCard label={t('paKpiWorkers', lang)} value={num(counts.workers)} icon={<Users className="h-4 w-4" />} />
              <KpiCard label={t('paKpiCoops', lang)} value={num(counts.cooperatives)} tone="primary" icon={<Building2 className="h-4 w-4" />} />
              <KpiCard label={t('paKpiDistricts', lang)} value={num(counts.districts)} icon={<MapPin className="h-4 w-4" />} />
              <KpiCard label={t('paKpiBookings', lang)} value={num(counts.bookings)} icon={<Briefcase className="h-4 w-4" />} />
              <KpiCard label={t('paKpiOpenComplaints', lang)} value={num(counts.openComplaints)} tone={(counts.openComplaints ?? 0) > 0 ? 'warning' : 'default'} icon={<ShieldAlert className="h-4 w-4" />} />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div data-demo-target="platform-bookings">
              <SectionCard title={t('paTrendBookings', lang)} description={admin?.note}>
                {adminQ.isLoading ? (
                  <Skeleton className="h-40 rounded-lg" />
                ) : (
                  <>
                    <BarChartMini data={admin?.bookingsByDay.map((d) => ({ label: d.label, value: d.count })) ?? []} />
                    <SparkLine points={admin?.bookingsByDay.map((d) => d.count) ?? []} className="mt-2" height={34} />
                  </>
                )}
              </SectionCard>
            </div>
            <div data-demo-target="platform-bookings">
              <SectionCard title={t('paByStatus', lang)}>
                {adminQ.isLoading ? (
                  <Skeleton className="h-40 rounded-lg" />
                ) : (
                  <DonutMini
                    data={(admin?.bookingsByStatus ?? []).map((s) => ({ label: s.status.replace(/_/g, ' '), value: s.count, color: STATUS_COLOR[s.status] }))}
                  />
                )}
              </SectionCard>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Exchange decisions pending" value={exchangeQ.data?.stats.pending ?? '—'} tone={(exchangeQ.data?.stats.pending ?? 0) > 0 ? 'warning' : 'default'} icon={<Repeat className="h-4 w-4" />} />
            <KpiCard label="Workers moved (approved)" value={exchangeQ.data?.stats.workersMoved ?? '—'} tone="success" icon={<Users className="h-4 w-4" />} />
            <KpiCard label="Demo identities" value={sessionQ.data?.length ?? '—'} sub="role-backed, DB-resolved" icon={<UserCheck className="h-4 w-4" />} />
            <KpiCard label="Booking simulation" value="Active" sub="time-accelerated lifecycle" tone="primary" icon={<Timer className="h-4 w-4" />} />
          </div>

          <SectionCard title="Jump to any workspace" description="Every view below is fully functional and backed by the shared database">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {QUICK_NAV.map((n) => (
                <button key={n.view} onClick={() => setView(n.view)} className="group flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition hover:border-primary/50 hover:bg-accent/50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary group-hover:bg-primary group-hover:text-primary-foreground">{n.icon}</span>
                  <span className="text-sm font-semibold">{n.label}</span>
                  <span className="text-[11px] text-muted-foreground">{n.desc}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Demo identities" description="Resolved live from the seeded database">
              <ScrollArea className="h-64">
                <div className="space-y-2 pr-3">
                  {(sessionQ.data ?? []).map((s) => (
                    <div key={s.role} className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.org}</p>
                      </div>
                      <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">{s.role.replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-2.5">
                    <div>
                      <p className="text-sm font-semibold">GigSetu Ops (you)</p>
                      <p className="text-xs text-muted-foreground">Platform administration</p>
                    </div>
                    <span className="rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">PLATFORM ADMIN</span>
                  </div>
                </div>
              </ScrollArea>
            </SectionCard>

            <SectionCard title="Service Exchange activity" description="Latest cross-cooperative transfer decisions">
              <ScrollArea className="h-64">
                <div className="space-y-2 pr-3">
                  {(exchangeQ.data?.recommendations ?? []).slice(0, 8).map((r) => (
                    <div key={r.id} className="rounded-lg border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{r.skill} · {r.workerCount} workers</p>
                        <StatusChip status={r.status === 'PENDING' ? 'REQUESTED' : r.status === 'APPROVED' ? 'PAID' : 'CANCELLED'} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{r.fromCoopName} → {r.toCoopName}</p>
                      <p className="text-[10px] text-muted-foreground/70">{timeAgo(r.createdAt)}{r.approvedBy ? ` · by ${r.approvedBy}` : ''}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </SectionCard>
          </div>

          <SectionCard title="System notes" description="What is simulated vs. designed">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldAlert className="h-4 w-4 text-amber-600" /> Simulated (prototype)</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>• Worker accept/progression & quotes (time-accelerated)</li>
                  <li>• Payments (UPI-style receipts, no gateway)</li>
                  <li>• Government/cooperative registries (synthetic)</li>
                </ul>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><Database className="h-4 w-4 text-emerald-600" /> Real in this prototype</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>• Matching, pricing, booking lifecycle on live DB</li>
                  <li>• Welfare ledger, ratings, coop metrics updates</li>
                  <li>• AI request analysis &amp; voice transcription services</li>
                </ul>
              </div>
            </div>
            <PrototypeNotice className="mt-3" />
          </SectionCard>
        </TabsContent>

        {/* ============================ NETWORK ============================ */}
        <TabsContent value="network" className="mt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={t('paCountsTalukas', lang)} value={num(counts.talukas)} icon={<MapPin className="h-4 w-4" />} />
            <KpiCard label={t('paCountsDistricts', lang)} value={num(counts.districts)} tone="primary" icon={<MapPin className="h-4 w-4" />} />
            <KpiCard label={t('paCountsFed', lang)} value={num(counts.federations)} icon={<Landmark className="h-4 w-4" />} />
            <KpiCard label={t('paCountsCustomers', lang)} value={num(counts.customers)} tone="success" icon={<UserCheck className="h-4 w-4" />} />
          </div>

          <SectionCard title={t('paNetworkTitle', lang)} description={t('paNetworkDesc', lang)}>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={coopSearch}
                onChange={(e) => setCoopSearch(e.target.value)}
                placeholder={t('paSearchCoop', lang)}
                aria-label={t('paSearchCoop', lang)}
                className="h-10 pl-9"
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_72px_84px_136px] gap-2 border-b pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{t('paColCoop', lang)}</span>
              <span className="text-right">{t('paColWorkers', lang)}</span>
              <span className="text-right">{t('paColActive', lang)}</span>
              <span>{t('paColUtil', lang)}</span>
            </div>
            {adminQ.isLoading ? (
              <div className="mt-3 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
            ) : coops.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('paNetworkEmpty', lang)}</p>
            ) : (
              <div className="max-h-96 space-y-1.5 overflow-y-auto pt-2 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
                {coops.map((c) => (
                  <div key={c.name} className="grid grid-cols-[minmax(0,1fr)_72px_84px_136px] items-center gap-2 rounded-lg border p-2">
                    <span className="truncate text-xs font-medium" title={c.name}>{c.name}</span>
                    <span className="text-right text-xs tabular-nums">{num(c.workers)}</span>
                    <span className="text-right text-xs font-semibold tabular-nums text-primary">{num(c.activeToday)}</span>
                    <UtilBarMini pct={c.utilizationPct} />
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Users className="mt-0.5 h-3 w-3 shrink-0" /> {t('paUsersNote', lang)}
            </p>
          </SectionCard>
        </TabsContent>

        {/* ============================ FINANCE ============================ */}
        <TabsContent value="finance" className="mt-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard label={t('paSettledCount', lang)} value={num(payments?.settledCount)} tone="primary" icon={<Landmark className="h-4 w-4" />} />
            <KpiCard label={t('paSettledRs', lang)} value={payments ? inr(payments.settledRs) : '—'} tone="success" sub={payments ? `${num(counts.bookings)} ${t('paKpiBookings', lang).toLowerCase()}` : undefined} icon={<Landmark className="h-4 w-4" />} />
          </div>

          <SectionCard title={t('paSplitTitle', lang)} description={t('paFinDesc', lang)}>
            {adminQ.isLoading || !payments ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : (
              <>
                <StackedBar segments={financeSegments} />
                <ChartLegend className="mt-3" items={financeLegend} />
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('akTotal', lang)}: <span className="font-bold tabular-nums text-foreground">{inr(payments.workerRs + payments.coopRs + payments.welfareRs + payments.platformRs)}</span>
                  {' · '}{num(payments.settledCount)} {t('paSettledCount', lang).toLowerCase()}
                </p>
              </>
            )}
          </SectionCard>

          <SectionCard title={t('paFeeTitle', lang)}>
            {payQ.isLoading || !fee ? (
              <Skeleton className="h-20 rounded-lg" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { pct: fee.workerSharePct, label: t('paSplitWorker', lang) },
                    { pct: fee.coopPct, label: t('paSplitCoop', lang) },
                    { pct: fee.welfarePct, label: t('paSplitWelfare', lang) },
                    { pct: fee.platformPct, label: t('paSplitPlatform', lang) },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-xl font-bold tabular-nums text-primary">{s.pct}%</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t('paFeeCaption', lang)}
                    {fee.note ? <span className="block text-amber-700/80 dark:text-amber-400/80">{fee.note}</span> : null}
                  </span>
                </div>
              </>
            )}
          </SectionCard>

          <SectionCard
            title={t('paRevTitle', lang)}
            description={t('paRevDesc', lang)}
            actions={
              <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <SlidersHorizontal className="h-3 w-3" /> {t('paRevEditable', lang)}
              </Badge>
            }
          >
            {econQ.isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_84px] gap-2 border-b pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{t('paColSource', lang)}</span>
                  <span className="text-right">{t('paColPrice', lang)}</span>
                  <span className="text-right">{t('paColUnit', lang)}</span>
                  <span className="text-right">{t('paColStatus', lang)}</span>
                </div>
                <div className="max-h-96 space-y-1.5 overflow-y-auto pt-2 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
                  {(econQ.data?.sources ?? []).map((s) => (
                    <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_110px_110px_84px] items-center gap-2 rounded-lg border p-2">
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{s.label}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{s.note}</span>
                      </span>
                      <span className="text-right text-xs font-semibold tabular-nums">{inr(s.priceRs)}</span>
                      <span className="text-right text-[11px] text-muted-foreground">{s.unit}</span>
                      <span className="text-right">
                        <Badge variant="outline" className={s.active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'}>
                          {s.active ? t('paActive', lang) : t('paPlanned', lang)}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
                {econQ.data && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t('paProjected', lang)}: <span className="font-bold tabular-nums text-foreground">{inr(econQ.data.projectedMonthlyRs)}</span>
                    {' · '}{econQ.data.updatedBy} · {fmtDateTime(econQ.data.updatedAt)}
                  </p>
                )}
              </>
            )}
          </SectionCard>
        </TabsContent>

        {/* ============================ TRUST & SAFETY ============================ */}
        <TabsContent value="trust" className="mt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={t('paKpiOpenComplaints', lang)} value={num(counts.openComplaints)} tone={(counts.openComplaints ?? 0) > 0 ? 'danger' : 'default'} icon={<ShieldAlert className="h-4 w-4" />} />
            <KpiCard label={t('paKpiComplaintsAll', lang)} value={num(counts.complaints)} icon={<ShieldAlert className="h-4 w-4" />} />
            <KpiCard label={t('paKpiTrustReports', lang)} value={num(counts.trustReports)} tone="warning" icon={<ShieldCheck className="h-4 w-4" />} />
            <KpiCard label={t('paKpiNotifs', lang)} value={num(counts.notifications)} icon={<Activity className="h-4 w-4" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={t('paDemandTitle', lang)}>
              {adminQ.isLoading ? (
                <Skeleton className="h-40 rounded-lg" />
              ) : (
                <BarChartMini data={(admin?.demandByCategory ?? []).map((d) => ({ label: d.key, value: d.count }))} tone="amber" />
              )}
            </SectionCard>

            <SectionCard title={t('paIntegrityTitle', lang)}>
              {adminQ.isLoading || !payments ? (
                <Skeleton className="h-40 rounded-lg" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-2xl font-bold tabular-nums">{num(counts.bookings)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{t('paIntegrityBookings', lang)}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-2xl font-bold tabular-nums text-primary">{num(payments.settledCount)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{t('paSettledCount', lang)}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{t('paIntegrityShare', lang)}</span>
                      <span className="font-bold tabular-nums text-foreground">{settledShare}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, settledShare)}%` }} />
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t('paIntegrityNote', lang)}</p>
                </>
              )}
            </SectionCard>
          </div>

          <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{t('paTrustConcept', lang)}</span>
          </div>
        </TabsContent>

        {/* ============================ AI & INTEGRATIONS ============================ */}
        <TabsContent value="ai" className="mt-0 space-y-4">
          <SectionCard
            title={t('mwTitle', lang)}
            description={t('mwDesc', lang)}
            actions={
              <Badge variant="outline" className="gap-1 border-primary/30 bg-accent text-primary">
                <Sparkles className="h-3 w-3" /> {t('mwBadge', lang)}
              </Badge>
            }
          >
            {/* Last-updated meta line */}
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-primary" />
              {customised && saved
                ? <>{t('mwUpdatedBy', lang)} <span className="font-semibold text-foreground">{saved.updatedBy}</span>{saved.updatedAt ? ` · ${fmtDateTime(saved.updatedAt)}` : ''}</>
                : t('mwNeverEdited', lang)}
            </p>

            {weightsQ.isLoading || !effDraft ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
                </div>
              </div>
            ) : (
              <>
                {/* Live total badge */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      'tabular-nums',
                      totalPts === 100
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                    )}
                  >
                    {t('mwTotal', lang)}: {totalPts} {t('mwPts', lang)}
                  </Badge>
                  {totalPts !== 100 && <p className="text-xs text-amber-600 dark:text-amber-400">{t('mwTotalWarn', lang)}</p>}
                </div>

                {/* Six factor sliders */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(weightsQ.data?.meta ?? [])
                    .filter((m) => (WEIGHT_KEYS as readonly string[]).includes(m.key))
                    .map((m) => {
                      const k = m.key as WeightKey
                      const lbl = t(`mwF${m.key}`, lang)
                      const label = lbl.startsWith('mwF') ? m.label : lbl
                      const dsc = t(`mwD${m.key}`, lang)
                      const desc = dsc.startsWith('mwD') ? m.desc : dsc
                      return (
                        <div key={m.key} className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{label}</p>
                              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
                            </div>
                            <span className="shrink-0 rounded-md bg-accent px-2 py-1 text-sm font-bold tabular-nums text-primary">{effDraft[k]}</span>
                          </div>
                          <Slider
                            min={0}
                            max={100}
                            step={1}
                            value={[effDraft[k] ?? 0]}
                            onValueChange={(v) => setDraft({ ...effDraft, [k]: Math.round(v[0] ?? 0) })}
                            aria-label={`${label} (0–100)`}
                            className="mt-4"
                          />
                        </div>
                      )
                    })}
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => saveWeights.mutate(effDraft)}
                    disabled={saveWeights.isPending}
                    className="min-h-9 gap-1.5"
                  >
                    {saveWeights.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t('mwSave', lang)}
                  </Button>
                  <Button variant="ghost" onClick={resetDraft} disabled={saveWeights.isPending} className="min-h-9 gap-1.5">
                    <RotateCcw className="h-4 w-4" /> {t('mwReset', lang)}
                  </Button>
                </div>
              </>
            )}
            <Separator className="my-3" />
            <p className="text-[11px] text-muted-foreground">{t('mwConfiguredBy', lang)}</p>
          </SectionCard>

          <SectionCard
            title={t('paIntTitle', lang)}
            description={t('paIntDesc', lang)}
            actions={<Plug className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_150px_92px] gap-2 border-b pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(0,1fr)_170px_100px_minmax(0,1.4fr)]">
              <span>{t('paColName', lang)}</span>
              <span className="hidden sm:block">{t('paColDomain', lang)}</span>
              <span>{t('paColStatus', lang)}</span>
              <span className="hidden sm:block">{t('paColPurpose', lang)}</span>
            </div>
            {adminQ.isLoading ? (
              <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
            ) : (
              <div className="max-h-96 space-y-1.5 overflow-y-auto pt-2 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
                {(admin?.integrations ?? []).map((ig) => (
                  <div key={ig.name} className="rounded-lg border p-2.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_170px_100px_minmax(0,1.4fr)]">
                      <span className="truncate text-xs font-semibold" title={ig.name}>{ig.name}</span>
                      <span className="hidden truncate text-[11px] text-muted-foreground sm:block">{ig.domain}</span>
                      <span>
                        <Badge variant="outline" className={ig.status === 'DESIGNED'
                          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                          : 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'}>
                          {ig.status === 'DESIGNED' ? t('paIntDesigned', lang) : t('paIntFuture', lang)}
                        </Badge>
                      </span>
                      <span className="hidden text-[11px] leading-snug text-muted-foreground sm:block">{ig.purpose}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">{ig.domain} — {ig.purpose}</p>
                  </div>
                ))}
              </div>
            )}
            {admin?.aiSettings && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <SlidersHorizontal className="h-3 w-3 shrink-0 text-primary" />
                {t('paAiConfiguredBy', lang)}: <span className="font-semibold text-foreground">{admin.aiSettings.weightsConfiguredBy}</span>
                {admin.aiSettings.weightsUpdatedAt ? ` · ${fmtDateTime(admin.aiSettings.weightsUpdatedAt)}` : ''}
              </p>
            )}
          </SectionCard>
        </TabsContent>

        {/* ============================ AUDIT & TRANSPARENCY (#57) ============================ */}
        <TabsContent value="audit" className="mt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard label="Log entries" value={num(auditLogQ.data?.total)} sub="latest window · filtered" icon={<ScrollText className="h-4 w-4" />} />
            <KpiCard label="Distinct actors" value={num(auditActorCount)} tone="primary" sub="demo identities" icon={<UserCheck className="h-4 w-4" />} />
            <KpiCard label="Latest action" value={auditEntries[0] ? timeAgo(auditEntries[0].at) : '—'} sub={auditEntries[0]?.action} tone="success" icon={<Timer className="h-4 w-4" />} />
          </div>

          <SectionCard
            title="Audit & Transparency"
            description="Who changed what, when — the cooperative governance trail"
            actions={
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => auditLogQ.refetch()} disabled={auditLogQ.isFetching}>
                <RefreshCw className={cn('h-3.5 w-3.5', auditLogQ.isFetching && 'animate-spin')} /> Refresh
              </Button>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={auditAction} onValueChange={setAuditAction}>
                <SelectTrigger className="h-9 w-[230px]" aria-label="Filter by action">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All actions</SelectItem>
                  {auditActions.map((a) => (
                    <SelectItem key={a} value={a} className="font-mono text-xs">{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={auditQInput}
                  onChange={(e) => setAuditQInput(e.target.value)}
                  placeholder="Search actor, detail, entity…"
                  aria-label="Search audit log"
                  className="h-9 pl-9"
                />
              </div>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                live · refreshes every 30s
              </span>
            </div>

            {auditLogQ.isLoading ? (
              <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
            ) : auditLogQ.isError ? (
              <EmptyState
                icon={<AlertTriangle className="h-8 w-8" />}
                title="Could not load the audit log"
                action={<Button size="sm" className="h-10" onClick={() => auditLogQ.refetch()}>Retry</Button>}
              />
            ) : auditEntries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No audit entries match the current filters.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-lg border pr-0.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Timestamp</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditEntries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(e.at)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="max-w-[150px] truncate text-xs font-semibold" title={e.actor}>{e.actor}</span>
                            <span className="w-fit rounded bg-secondary px-1.5 py-px text-[9px] font-semibold tracking-wide text-secondary-foreground">{e.actorRole.replace(/_/g, ' ')}</span>
                          </div>
                        </TableCell>
                        <TableCell><ActionChip action={e.action} /></TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{e.entity}</span>
                            {e.entityId && e.entityId !== '-' ? (
                              <span className="max-w-[120px] truncate font-mono text-[10px] text-muted-foreground" title={e.entityId}>{e.entityId}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-[340px] truncate text-xs text-muted-foreground" title={e.detail}>{e.detail || '—'}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Who changed what — cooperative governance requires a transparent trail. Prototype actors are demo identities;
                every entry is written best-effort at mutation time and can be filtered by action or free text.
              </span>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  )
}
