'use client'

// Cooperative Service Exchange — the CORE USP.
// AI detects capacity imbalance between cooperatives and RECOMMENDS transfers.
// AI never moves workers: authorized personnel review and approve/reject.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, timeAgo, fmtDateTime } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { KpiCard, EmptyState } from '../shared/ui-kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import type { DemoUser } from '@/lib/types'
import type { ExchangeResponse, ExchangeRec } from './api-types'
import {
  ArrowLeftRight, ArrowRight, MapPin, Users, Route, CalendarClock, Clock, Sparkles,
  CheckCircle2, XCircle, Loader2, ShieldCheck, Eye, RefreshCw, ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const APPROVER_ROLES: string[] = ['COOP_ADMIN', 'TALUKA_COORD', 'DISTRICT_COORD', 'STATE_ADMIN', 'NATIONAL_ADMIN', 'PLATFORM_ADMIN']

function ExchangeStatusBadge({ status }: { status: string }) {
  if (status === 'APPROVED') {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2 className="mr-1 h-3 w-3" /> APPROVED
      </Badge>
    )
  }
  if (status === 'REJECTED') {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <XCircle className="mr-1 h-3 w-3" /> REJECTED
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <Clock className="mr-1 h-3 w-3" /> PENDING
    </Badge>
  )
}

function ImpactTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{icon} {label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function RecCard({ rec, canApprove, onReview }: { rec: ExchangeRec; canApprove: boolean; onReview: (r: ExchangeRec) => void }) {
  const decided = rec.status === 'APPROVED' || rec.status === 'REJECTED'
  return (
    <div className={cn('rounded-xl border bg-card p-4', rec.status === 'PENDING' && 'border-amber-200/80 dark:border-amber-900/60')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="capitalize">{rec.skill}</Badge>
        <ExchangeStatusBadge status={rec.status} />
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" /> {timeAgo(rec.createdAt)}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold">{rec.fromCoopName}</span>
        <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-semibold">{rec.toCoopName}</span>
      </div>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3" /> {rec.districtName} district · {rec.distanceKm} km apart
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ImpactTile icon={<Users className="h-3 w-3" />} label="Workers" value={`${rec.workerCount} workers`} />
        <ImpactTile icon={<Sparkles className="h-3 w-3" />} label="Demand" value={`covers ~${rec.expectedDemand} expected jobs`} />
        <ImpactTile icon={<CalendarClock className="h-3 w-3" />} label="Duration" value={`${rec.durationDays}-day deputation`} />
        <ImpactTile icon={<Route className="h-3 w-3" />} label="Distance" value={`${rec.distanceKm} km`} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{rec.rationale}</p>

      {decided && rec.approvedBy && (
        <div className={cn(
          'mt-3 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]',
          rec.status === 'APPROVED'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
        )}>
          {rec.status === 'APPROVED' ? <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> : <ShieldAlert className="h-3.5 w-3.5 shrink-0" />}
          <span>
            {rec.status === 'APPROVED' ? 'Approved' : 'Rejected'} by <span className="font-semibold">{rec.approvedBy}</span>
            {rec.decidedAt && <> · {fmtDateTime(rec.decidedAt)}</>}
          </span>
        </div>
      )}

      {rec.status === 'PENDING' && (
        <div className="mt-3">
          {canApprove ? (
            <Button size="sm" variant="outline" onClick={() => onReview(rec)}>
              <Eye className="mr-1.5 h-3.5 w-3.5" /> Review recommendation
            </Button>
          ) : (
            <p className="text-[11px] text-muted-foreground">Awaiting review by an authorized coordinator / admin.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ServiceExchange({ user }: { user: DemoUser }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [reviewing, setReviewing] = useState<ExchangeRec | null>(null)

  const q = useQuery({
    queryKey: ['exchange'],
    queryFn: () => api.get<ExchangeResponse>('/api/exchange'),
    // Live: every governance dashboard must reflect a booking as it happens.
    staleTime: 15_000,
    refetchInterval: 20_000,
  })

  const canApprove = APPROVER_ROLES.includes(user.role)

  const sorted = useMemo(() => {
    const recs = q.data?.recommendations ?? []
    const rank = (s: string) => (s === 'PENDING' ? 0 : s === 'APPROVED' ? 1 : 2)
    return [...recs].sort((a, b) => rank(a.status) - rank(b.status) || +new Date(b.createdAt) - +new Date(a.createdAt))
  }, [q.data])

  const decide = useMutation({
    mutationFn: (vars: { id: string; action: 'approve' | 'reject' }) =>
      api.patch<{ ok: boolean; recommendation: ExchangeRec }>('/api/exchange', { id: vars.id, action: vars.action, by: user.name }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['exchange'] })
      setReviewing(null)
      toast({
        title: vars.action === 'approve' ? 'Transfer approved' : 'Transfer rejected',
        description: vars.action === 'approve'
          ? `Deputation window scheduled. Both cooperatives and the district coordinator were notified — recorded under ${user.name}.`
          : 'The exchange network has been notified of the rejection.',
      })
    },
    onError: (e: Error) => {
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' })
    },
  })

  const stats = q.data?.stats

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><ArrowLeftRight className="h-5 w-5" /></div>
          <h1 className="text-xl font-bold tracking-tight">Cooperative Service Exchange</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          AI detects imbalance between cooperatives and recommends capacity transfers. AI recommends — authorized personnel approve.{' '}
          <span className="font-semibold text-amber-700 dark:text-amber-400">AI does NOT automatically transfer workers.</span>
        </p>
      </div>

      {/* Reviewer context */}
      <div className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs',
        canApprove ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-border bg-muted/50 text-muted-foreground'
      )}>
        {canApprove ? <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> : <Eye className="h-3.5 w-3.5 shrink-0" />}
        <span>
          {canApprove
            ? <>Reviewing as <span className="font-semibold">{user.name}</span> ({user.title}) — your approval is recorded under your name.</>
            : <>Viewing as <span className="font-semibold">{user.name}</span> ({user.title}) —               this role has read-only access to the exchange register — transfers are
              approved by the district or federation coordinator.</>}
        </span>
      </div>

      {/* Stats */}
      {stats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Pending" value={stats.pending} tone="warning" icon={<Clock className="h-4 w-4" />} sub="awaiting human decision" />
          <KpiCard label="Approved" value={stats.approved} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} sub="by authorized personnel" />
          <KpiCard label="Rejected" value={stats.rejected} tone="danger" icon={<XCircle className="h-4 w-4" />} sub="with recorded reviewer" />
          <KpiCard label="Workers moved" value={stats.workersMoved} tone="primary" icon={<Users className="h-4 w-4" />} sub="via approved transfers" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)}
        </div>
      )}

      {/* Recommendations */}
      {q.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : q.isError || !q.data?.ok ? (
        <EmptyState
          icon={<ArrowLeftRight className="h-8 w-8" />}
          title="Exchange unavailable"
          body={q.isError ? (q.error as Error).message : 'Unexpected response from the exchange service.'}
          action={<Button variant="outline" size="sm" onClick={() => q.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry</Button>}
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight className="h-8 w-8" />}
          title="No recommendations right now"
          body="When the AI detects a capacity imbalance between cooperatives (surplus on one side, shortage on the other), recommendations will appear here for review."
        />
      ) : (
        <div className="space-y-3">
          <div data-demo-target="exchange-recommendations">
            {sorted.map((rec) => (
              <RecCard key={rec.id} rec={rec} canApprove={canApprove} onReview={setReviewing} />
            ))}
          </div>
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!reviewing} onOpenChange={(o) => { if (!o) setReviewing(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> AI transfer recommendation
            </DialogTitle>
            <DialogDescription>
              AI recommends — you decide. Approving records <span className="font-semibold">{user.name}</span> as the authorizing officer.
            </DialogDescription>
          </DialogHeader>

          {reviewing && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{reviewing.fromCoopName}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-semibold">{reviewing.toCoopName}</span>
                <Badge variant="secondary" className="ml-auto capitalize">{reviewing.skill}</Badge>
              </div>

              <div className="rounded-lg border border-dashed bg-muted/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">AI rationale</p>
                <p className="mt-1 text-sm leading-relaxed">{reviewing.rationale}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ImpactTile icon={<Users className="h-3 w-3" />} label="Workers to depute" value={`${reviewing.workerCount} workers`} />
                <ImpactTile icon={<CalendarClock className="h-3 w-3" />} label="Deputation window" value={`${reviewing.durationDays} days`} />
                <ImpactTile icon={<Sparkles className="h-3 w-3" />} label="Expected impact" value={`covers ~${reviewing.expectedDemand} expected jobs`} />
                <ImpactTile icon={<MapPin className="h-3 w-3" />} label="Location" value={`${reviewing.districtName} · ${reviewing.distanceKm} km`} />
              </div>

              <Separator />

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                On approval, both cooperatives and the district coordinator are notified and the {reviewing.durationDays}-day deputation window is scheduled.
                Workers keep their cooperative membership, welfare balance and ratings — this is temporary capacity sharing, not re-employment.
              </p>
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setReviewing(null)} disabled={decide.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={decide.isPending}
              onClick={() => reviewing && decide.mutate({ id: reviewing.id, action: 'reject' })}
            >
              {decide.isPending && decide.variables?.action === 'reject'
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <XCircle className="mr-1.5 h-4 w-4" />}
              REJECT
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-700"
              disabled={decide.isPending}
              onClick={() => reviewing && decide.mutate({ id: reviewing.id, action: 'approve' })}
            >
              {decide.isPending && decide.variables?.action === 'approve'
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              APPROVE
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
