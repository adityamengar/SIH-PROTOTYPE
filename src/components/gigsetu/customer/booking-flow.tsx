'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, inr } from '@/lib/api-client'
import { useAppStore } from '@/store/app-store'
import { t } from '@/lib/i18n'
import { DEMO_AREAS, type MatchResponse, type PlaceSuggestion, type SavedPlaceDTO, type ServiceCategoryDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SectionCard, StatusChip } from '../shared/ui-kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { DemoUser } from '@/lib/types'
import {
  ArrowLeft, ArrowRight, Mic, Square, ImageIcon, X, Sparkles, Loader2, MapPin, Calendar,
  Bot, Route, ShieldCheck, Star, Clock3, IndianRupee, CheckCircle2, Phone, Video,
  BookmarkPlus, Check,
} from 'lucide-react'

const STEPS = ['stepService', 'stepDescribe', 'stepPhotos', 'stepLocation', 'stepTime', 'stepAI', 'stepMatch', 'stepConfirm'] as const

const latStr = (n: number) => n.toFixed(5)
const lonStr = (n: number) => n.toFixed(5)

const HINDI_SAMPLE = 'पंखा और लाइट अचानक बंद हो गए हैं। MCB बार-बार ट्रिप हो रहा है। आज ही बिजली मिस्त्री की ज़रूरत है।'

const SAMPLES: Record<string, { labelKey: string; text: string }> = {
  mr: { labelKey: 'marathiSample', text: 'माझ्या घरात फक्त आता फॅन आणि लाईट बंद पडले आहेत. MCB वारंवार ट्रिप होत आहे. तातडीने इलेक्ट्रिशियन हवा आहे.' },
  hi: { labelKey: 'hindiSample', text: HINDI_SAMPLE },
  en: { labelKey: 'englishSample', text: 'Fan and lights stopped working suddenly. The MCB keeps tripping. Need an electrician urgently today.' },
}

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const max = 720
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(reader.result as string)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.68))
      }
      img.onerror = () => resolve(reader.result as string)
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export function BookingFlow({
  user, categoryKey, area, emergency, onClose, onBooked, initialDescription,
}: {
  user: DemoUser
  categoryKey: string
  area: string
  emergency: boolean
  onClose: () => void
  onBooked: (bookingId: string) => void
  /** Pre-filled problem text, e.g. carried over from the Diagnose-before-dispatch consult (spec §13). */
  initialDescription?: string
}) {
  const { toast } = useToast()
  const lang = useAppStore((s) => s.lang)
  const [step, setStep] = useState(1)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [media, setMedia] = useState<Array<{ kind: 'image' | 'video'; data: string; name: string }>>([])
  const [address, setAddress] = useState('')
  const [flowArea, setFlowArea] = useState(area)
  const [when, setWhen] = useState<'now' | 'evening' | 'tomorrow' | 'custom'>('now')
  const [customWhen, setCustomWhen] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null)
  const [matching, setMatching] = useState(false)
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [confirming, setConfirming] = useState(false)

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  // GeoApify address autocomplete (spec §42)
  const [addrQuery, setAddrQuery] = useState('')
  const [addrOpen, setAddrOpen] = useState(false)
  const addrQ = useQuery({
    queryKey: ['geo-autocomplete', addrQuery],
    // Import the server's real type rather than re-declaring it. A hand-written
    // `area: string` here previously asserted a field the server never sent, so
    // TypeScript happily compiled a bug that blanked the service area.
    queryFn: () => api.get<{ ok: boolean; source: string; results: PlaceSuggestion[] }>(`/api/geo/autocomplete?q=${encodeURIComponent(addrQuery)}`),
    enabled: addrQuery.trim().length >= 3,
    staleTime: 300000,
  })
  const addrSuggestions = addrQ.data?.results.slice(0, 6) ?? []
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const catsQ = useCategory(categoryKey)

  // ---------- saved places (address book) ----------
  const qc = useQueryClient()
  const placesKey = ['places', user.id] as const
  const placesQ = useQuery({
    queryKey: placesKey,
    queryFn: () => api.get<{ ok: boolean; places: SavedPlaceDTO[] }>(`/api/places?customerId=${user.id}`),
    enabled: !!user.id,
  })
  const places = placesQ.data?.places ?? []
  const [placeLabelOpen, setPlaceLabelOpen] = useState(false)
  const [placeLabel, setPlaceLabel] = useState('')
  const savePlaceM = useMutation({
    mutationFn: (p: { label: string; area: string; address: string }) =>
      api.post<{ ok: boolean; place: SavedPlaceDTO }>('/api/places', { customerId: user.id, ...p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: placesKey })
      toast({ title: t('placeSaved', lang) })
      setPlaceLabelOpen(false)
      setPlaceLabel('')
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  })
  const delPlaceM = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/places?id=${id}&customerId=${user.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: placesKey })
      toast({ title: t('placeDeleted', lang) })
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  })
  const setDefaultM = useMutation({
    mutationFn: (id: string) => api.patch<{ ok: boolean }>('/api/places', { id, customerId: user.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: placesKey })
      toast({ title: t('placeSetDefault', lang) })
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  })
  const placeApplied = (p: SavedPlaceDTO) => p.area === flowArea && p.address === address.trim()
  const addressAlreadySaved = places.some((p) => p.area === flowArea && p.address === address.trim())

  const scheduledAt = useCallback((): string => {
    const d = new Date()
    if (when === 'now') return d.toISOString()
    if (when === 'evening') { d.setHours(18, 30, 0, 0); return d.toISOString() }
    if (when === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.toISOString() }
    if (customWhen) {
      const parsed = new Date(customWhen)
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    }
    return d.toISOString()
  }, [when, customWhen])

  const urgency = emergency ? 'EMERGENCY' : ((analysis?.urgency as string) ?? 'NORMAL')

  // ---------- voice ----------
  const streamRef = useRef<MediaStream | null>(null)

  /** Release the microphone on unmount / step change — a leaked track keeps the
   *  browser's recording indicator on forever and holds the device open. */
  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null
    setRecording(false)
  }, [])

  useEffect(() => releaseMic, [releaseMic])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (streamRef.current === stream) streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        transcribe(blob)
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      toast({ title: 'Microphone unavailable', description: 'Permission denied or no mic in this browser. Type the description instead (voice input is a prototype feature).', variant: 'destructive' })
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true)
    try {
      const b64 = await new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve((r.result as string).split(',')[1])
        r.readAsDataURL(blob)
      })
      const res = await api.post<{ ok: boolean; text: string }>('/api/asr', { audio: b64 })
      if (res.text) setDescription((d) => (d ? d + ' ' : '') + res.text)
      toast({ title: 'Voice transcribed', description: 'Prototype speech-to-text applied to your recording.' })
    } catch {
      toast({ title: 'Voice transcription failed', description: 'ASR service unavailable in this environment — please type the description.', variant: 'destructive' })
    } finally {
      setTranscribing(false)
    }
  }

  // ---------- media ----------
  async function handleFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files).slice(0, 4)) {
      if (f.type.startsWith('image/')) {
        const data = await compressImage(f)
        setMedia((m) => [...m, { kind: 'image', data, name: f.name }])
      } else if (f.type.startsWith('video/')) {
        setMedia((m) => [...m, { kind: 'video', data: '', name: `${f.name} (${Math.round(f.size / 1024)} KB — video attached for demo)` }])
      }
    }
  }

  // ---------- AI + match ----------
  async function runAnalysis() {
    if (!description.trim()) {
      toast({ title: 'Please describe the problem first', variant: 'destructive' })
      return
    }
    setAnalyzing(true)
    try {
      const res = await api.post<{ ok: boolean; analysis: Record<string, unknown> }>('/api/ai/analyze', { description, categoryKey, lang })
      setAnalysis(res.analysis)
      setStep(6)
    } catch (e) {
      toast({ title: 'AI analysis failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setAnalyzing(false)
    }
  }

  async function runMatch() {
    // Guard before firing. The server requires both fields and answers 400 with
    // "categoryKey and area required", which is a dead end for the user — they
    // cannot tell which field is missing or how to fix it. The area in
    // particular can be blanked by clearing the Location step, so send them
    // back there rather than surfacing a raw API error.
    if (!categoryKey?.trim()) {
      toast({ title: 'Choose a service first', description: 'Pick the service you need before finding workers.', variant: 'destructive' })
      setStep(0)
      return
    }
    if (!flowArea?.trim()) {
      toast({ title: 'Choose your area', description: 'Matching needs a service area so it can find a verified worker near you.', variant: 'destructive' })
      setStep(3)
      return
    }
    setMatching(true)
    try {
      const res = await api.post<MatchResponse>('/api/match', {
        categoryKey,
        area: flowArea,
        urgency: emergency ? 'EMERGENCY' : (analysis?.urgency ?? 'NORMAL'),
        scheduledAt: scheduledAt(),
      })
      setMatch(res)
      setStep(7)
    } catch (e) {
      toast({ title: 'Matching failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMatching(false)
    }
  }

  async function confirm(mode: 'INSTANT' | 'QUOTE') {
    if (!match?.best) return
    setConfirming(true)
    try {
      const res = await api.post<{ ok: boolean; booking: { id: string } }>('/api/bookings', {
        customerId: user.customerId,
        categoryKey,
        title: (analysis?.title as string) ?? 'Service request',
        description,
        // Media is posted as plain data-URL strings, which is what the rest of the
        // app consumes: BookingDTO.media is string[] and the booking gallery plus
        // the evidence card both call .startsWith('data:image') on each entry.
        // It previously posted {kind, name, data} objects, which the API schema
        // rejected outright — attaching any photo made booking impossible.
        media: media.filter((m) => m.kind === 'image' && m.data).map((m) => m.data),
        area: flowArea,
        address: address || 'Address on file',
        scheduledAt: scheduledAt(),
        urgency,
        mode,
        workerId: mode === 'INSTANT' ? match.best.id : undefined,
        estimatedPrice: match.priceEstimate.total,
        analysis,
        lang,
      })
      toast({ title: mode === 'INSTANT' ? 'Worker request sent' : 'Quote requested', description: mode === 'INSTANT' ? `${match.best.name} is being notified via the cooperative network.` : 'The best-match worker will respond with a fair quote.' })
      onBooked(res.booking.id)
    } catch (e) {
      toast({ title: 'Booking failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setConfirming(false)
    }
  }

  const best = match?.best
  const price = match?.priceEstimate

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('back', lang)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold">
            {t('bookService', lang)}: {catsQ ? (lang === 'mr' ? catsQ.nameMr : lang === 'hi' ? catsQ.nameHi : catsQ.nameEn) : categoryKey}
            {emergency && <Badge variant="destructive" className="ml-1">{t('emergency', lang)}</Badge>}
          </h2>
          <p className="text-xs text-muted-foreground">
            {catsQ && (lang === 'mr' ? (catsQ.descMr || catsQ.descEn) : lang === 'hi' ? (catsQ.descHi || catsQ.descEn) : catsQ.descEn)} · {t('flowSubtitle', lang)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 flex-col items-center gap-1">
            <div className={`h-1.5 w-full rounded-full ${i + 1 <= step ? 'bg-primary' : 'bg-muted'}`} />
            <span className={`hidden text-[9px] sm:block ${i + 1 === step ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{t(s, lang)}</span>
          </div>
        ))}
      </div>

      {/* Step 1: service (implicit) → Step 2: describe */}
      {(step === 1 || step === 2) && (
        <SectionCard title={t('describeTitle', lang)} description={t('describeDesc', lang)}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={recording ? 'destructive' : 'outline'} size="sm" onClick={recording ? stopRecording : startRecording} disabled={transcribing}>
                {transcribing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : recording ? <Square className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                {transcribing ? t('transcribing', lang) : recording ? t('stopRecording', lang) : t('speak', lang)}
              </Button>
              <span className="self-center text-xs text-muted-foreground">{recording ? t('listening', lang) : t('orType', lang)}</span>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={emergency ? 'e.g. माझ्या घरात आग लागण्याची भीती आहे — MCB ट्रिप होत आहे. तातडीने मदत हवी.' : 'e.g. Fan and lights stopped working, MCB keeps tripping. Need an electrician today.'}
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground self-center">{t('sampleScripts', lang)}</span>
              {(['mr', 'hi', 'en'] as const).map((k) => (
                <Button key={k} variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setDescription(SAMPLES[k].text)}>{t(SAMPLES[k].labelKey, lang)}</Button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(3)} disabled={!description.trim()}>{t('next', lang)} <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Step 3: photos */}
      {step === 3 && (
        <SectionCard title={t('photosTitle', lang)} description={t('photosDesc', lang)}>
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-muted-foreground transition hover:border-primary/50 hover:text-primary">
              <ImageIcon className="h-6 w-6" />
              <span className="text-sm">{t('tapAdd', lang)}</span>
              <span className="text-[11px]">Images stay on this device in the prototype · video stored as metadata</span>
            </button>
            {media.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.map((m, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-lg border">
                    {m.kind === 'image' ? (
                       
                      <img src={m.data} alt={`attachment ${i + 1}`} className="h-20 w-full object-cover" />
                    ) : (
                      <div className="flex h-20 w-full flex-col items-center justify-center gap-1 text-muted-foreground"><Video className="h-5 w-5" /><span className="px-1 text-center text-[9px] leading-tight">{m.name}</span></div>
                    )}
                    <button aria-label="Remove attachment" onClick={() => setMedia((arr) => arr.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="mr-1 h-4 w-4" /> {t('back', lang)}</Button>
              <Button onClick={() => setStep(4)}>{t('next', lang)} <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Step 4+5: location & time */}
      {step === 4 && (
        <SectionCard title={t('whereWhenTitle', lang)} description="Service location and preferred time">
          <div className="space-y-4">
            {/* Saved places — one-tap fill */}
            {places.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{t('savedPlaces', lang)}</label>
                  <span className="text-[11px] text-muted-foreground/70">{t('savedPlacesSub', lang)}</span>
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
                  {places.map((p) => {
                    const applied = placeApplied(p)
                    return (
                      <div key={p.id} className="group relative shrink-0">
                        <button
                          type="button"
                          onClick={() => { setFlowArea(p.area); setAddress(p.address) }}
                          aria-pressed={applied}
                          className={cn(
                            'flex items-center gap-1.5 rounded-full border py-1.5 pl-2.5 pr-3 text-xs transition motion-safe:hover:-translate-y-0.5',
                            applied
                              ? 'border-primary bg-accent font-semibold text-primary shadow-sm'
                              : 'bg-card text-foreground hover:border-primary/40 hover:bg-accent/40',
                          )}
                        >
                          {applied ? <Check className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5 text-primary" />}
                          <span className="max-w-[120px] truncate">{p.label}</span>
                          <span className="text-muted-foreground/70">· {p.area}</span>
                          {p.isDefault && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                              {t('placeDefault', lang)}
                            </span>
                          )}
                        </button>
                        {!p.isDefault && (
                          <button
                            type="button"
                            aria-label={`${t('placeSetDefault', lang)}: ${p.label}`}
                            title={t('placeSetDefault', lang)}
                            disabled={setDefaultM.isPending}
                            onClick={() => setDefaultM.mutate(p.id)}
                            className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition hover:text-primary motion-safe:hover:scale-110"
                          >
                            <Star className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`${t('remove', lang)}: ${p.label}`}
                          title={t('remove', lang)}
                          disabled={delPlaceM.isPending}
                          onClick={() => delPlaceM.mutate(p.id)}
                          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition hover:border-destructive/40 hover:text-destructive motion-safe:hover:scale-110"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('areaLabel', lang)}</label>
              <Select value={flowArea} onValueChange={setFlowArea}>
                <SelectTrigger><MapPin className="h-4 w-4 text-primary" /><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {DEMO_AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* Spec §42 — GeoApify Address Autocomplete. Type any part of an
                  address to resolve it to a real locality; falls back to the
                  built-in Pune service grid when the provider is unavailable. */}
              <div className="relative">
                <label className="text-[11px] font-medium text-muted-foreground" htmlFor="geo-address-search">
                  {lang === 'mr' ? 'पत्ता शोधा (GeoApify)' : lang === 'hi' ? 'पता खोजें (GeoApify)' : 'Search a full address'}
                </label>
                <Input
                  id="geo-address-search"
                  className="mt-1 h-9"
                  placeholder={lang === 'mr' ? 'उदा. कर्वे नगर, पुणे' : lang === 'hi' ? 'जैसे कर्वे नगर, पुणे' : 'e.g. Karve Nagar, Pune'}
                  value={addrQuery}
                  onChange={(e) => setAddrQuery(e.target.value)}
                  onFocus={() => setAddrOpen(true)}
                />
                {addrQ.isFetching && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {lang === 'mr' ? 'शोधत आहे…' : lang === 'hi' ? 'खोज रहा है…' : 'Searching…'}
                  </p>
                )}
                {addrOpen && addrSuggestions.length > 0 && (
                  <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md" role="listbox">
                    {addrSuggestions.map((s) => (
                      <li key={s.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                          onClick={() => {
                            // Never let a suggestion blank the area: the server
                            // now always sends one, but if it ever regressed a
                            // missing `area` would silently wipe the selection
                            // and break the Match step.
                            const resolved = s.area?.trim()
                            if (resolved) setFlowArea(resolved)
                            setAddrQuery(s.label)
                            setAddress(s.label)
                            setAddrOpen(false)
                          }}
                        >
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{s.label}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {s.area} · {latStr(s.lat)}, {lonStr(s.lon)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {addrQ.data && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {addrQ.data.source === 'geoapify'
                      ? lang === 'mr'
                        ? 'GeoApify वापरून तपासलेले'
                        : lang === 'hi'
                          ? 'GeoApify से सत्यापित'
                          : 'Verified by GeoApify'
                      : lang === 'mr'
                        ? 'ऑफलाइन पड fallback वापरला'
                        : lang === 'hi'
                          ? 'ऑफ़लाइन गृrid fallback उपयोग'
                          : 'Offline service-grid fallback in use'}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">{t('landmarkLabel', lang)}</label>
                {address.trim().length >= 8 && !addressAlreadySaved && !placeLabelOpen && (
                  <button
                    type="button"
                    onClick={() => setPlaceLabelOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition hover:underline"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" /> {t('savePlace', lang)}
                  </button>
                )}
              </div>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. B-402, Shreeji Residency, near school" />
              {placeLabelOpen && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-accent/40 p-2">
                  <Input
                    value={placeLabel}
                    onChange={(e) => setPlaceLabel(e.target.value)}
                    placeholder={t('placeLabelPh', lang)}
                    maxLength={40}
                    className="h-8 bg-background text-sm"
                    aria-label={t('placeLabel', lang)}
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={!placeLabel.trim() || savePlaceM.isPending}
                    onClick={() => savePlaceM.mutate({ label: placeLabel.trim(), area: flowArea, address: address.trim() })}
                  >
                    {savePlaceM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                    {t('save', lang)}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setPlaceLabelOpen(false); setPlaceLabel('') }}>
                    {t('cancel', lang)}
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('whenLabel', lang)}</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([['now', t('whenNow', lang)], ['evening', t('whenEvening', lang)], ['tomorrow', t('whenTomorrow', lang)], ['custom', t('whenCustom', lang)]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setWhen(k)} className={`rounded-lg border p-2.5 text-xs font-medium transition ${when === k ? 'border-primary bg-accent text-primary' : 'hover:border-primary/40'}`}>
                    <Calendar className="mx-auto mb-1 h-4 w-4" />{l}
                  </button>
                ))}
              </div>
              {when === 'custom' && <Input type="datetime-local" value={customWhen} onChange={(e) => setCustomWhen(e.target.value)} className="mt-2" />}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="mr-1 h-4 w-4" /> {t('back', lang)}</Button>
              <Button onClick={() => runAnalysis()} disabled={analyzing}>
                {analyzing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('analyzing', lang)}</> : <>{t('analyzeCta', lang)} <Sparkles className="ml-1 h-4 w-4" /></>}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Step 6: AI analysis */}
      {step === 6 && analysis && (
        <SectionCard title={t('aiTitle', lang)} description="The platform understands your problem before matching">
          <div className="space-y-3">
            <div className="rounded-xl border bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="gap-1"><Bot className="h-3 w-3" /> {String(analysis.source) === 'ai' ? 'AI analyzed' : 'Rule-based (fallback)'}</Badge>
                <Badge variant="secondary">{t('categoryLabel', lang)}: {catsQ ? (lang === 'mr' ? catsQ.nameMr : lang === 'hi' ? catsQ.nameHi : catsQ.nameEn) : String(analysis.categoryKey)}</Badge>
                <StatusChip status={String(analysis.urgency) === 'EMERGENCY' ? 'REQUESTED' : 'QUOTED'} />
                <span className="text-xs font-semibold">{String(analysis.urgency)}</span>
                <span className="text-xs text-muted-foreground">· est. {String(analysis.estimatedMinutes)} min · {String(analysis.difficulty)}</span>
              </div>
              <p className="mt-2 text-sm font-semibold">{String(analysis.title)}</p>
              <p className="text-sm text-muted-foreground">{String(analysis.summary)}</p>
              {Array.isArray(analysis.safetyNotes) && analysis.safetyNotes.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-400">
                  {analysis.safetyNotes.map((s, i) => <li key={i}>⚠ {String(s)}</li>)}
                </ul>
              )}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(4)}><ArrowLeft className="mr-1 h-4 w-4" /> {t('editRequest', lang)}</Button>
              <Button onClick={runMatch} disabled={matching}>
                {matching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('matchingWorkers', lang)}</> : <>{t('findWorkers', lang)} <ArrowRight className="ml-1 h-4 w-4" /></>}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Step 7+8: match */}
      {step === 7 && match && (
        <>
          <SectionCard title={t('pipelineTitle', lang)} description="One customer → one worker. No unnecessary multi-assignment.">
            <div className="grid gap-2 sm:grid-cols-3">
              {match.pipeline.map((p, i) => {
                const prev = i > 0 ? match.pipeline[i - 1] : null
                const widened = !!prev && p.count > prev.count
                return (
                  <div key={p.stage} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{p.stage} <span className="text-muted-foreground">({p.count})</span></p>
                      <p className="truncate text-[11px] text-muted-foreground">{p.detail}</p>
                      {widened && <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">↑ widened radius — nearest-available fallback</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>

          {best ? (
            <>
              <SectionCard title={
                <span className="flex items-center gap-2">
                  <Badge className="bg-primary">BEST MATCH</Badge>
                  <span className="text-sm">{best.name}</span>
                </span>
              } description="AI-recommended verified worker + fair price estimate">
                <div className="space-y-4">
                  <div className="rounded-xl border border-primary/40 bg-accent/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">{best.name} · {best.experienceYears} {t('yrsExp', lang)}</p>
                        <p className="text-xs text-muted-foreground">{best.cooperativeName}</p>
                      </div>
                      <div className="text-right">
                        <p className="flex items-center gap-1 text-sm font-bold"><Star className="h-4 w-4 fill-amber-500 text-amber-500" /> {best.rating.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">{best.completedJobs} {t('jobs', lang)}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <span className="flex items-center gap-1"><Route className="h-3.5 w-3.5 text-primary" /> {best.distanceKm} km</span>
                      <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5 text-primary" /> ETA ~{best.etaMin} min</span>
                      <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {best.certStatus}</span>
                      <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-primary" /> {t('viaCoop', lang)}</span>
                    </div>
                    <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground">{best.skills.slice(0, 4).join(' · ')}</p>
                    {catsQ && (
                      <p className="mt-1.5 border-t border-dashed pt-1.5 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground/80">{t('serviceScope', lang)}:</span>{' '}
                        {lang === 'mr' ? (catsQ.descMr || catsQ.descEn) : lang === 'hi' ? (catsQ.descHi || catsQ.descEn) : catsQ.descEn}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><IndianRupee className="h-4 w-4 text-primary" /> {t('fairPrice', lang)}</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('visitWork', lang)}</span><span className="tabular-nums">{inr(price!.base)}</span></div>
                      {price!.urgencySurcharge > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t('urgencySurcharge', lang)} ({urgency})</span><span className="tabular-nums">{inr(price!.urgencySurcharge)}</span></div>}
                      {price!.eveningSurcharge > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t('eveningSurcharge', lang)}</span><span className="tabular-nums">{inr(price!.eveningSurcharge)}</span></div>}
                      <div className="flex justify-between border-t pt-1.5 font-bold"><span>{t('estTotal', lang)}</span><span className="tabular-nums text-primary">{inr(price!.total)}</span></div>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">{price!.policyNote} · {price!.welfareNote}</p>
                  </div>

                  {match.alternatives.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">{t('otherOptions', lang)}</p>
                      {match.alternatives.map((a) => (
                        <div key={a.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{a.name} <span className="text-xs text-muted-foreground">· {a.cooperativeName}</span></p>
                            <p className="text-[11px] text-muted-foreground">{a.distanceKm} km · ★{a.rating.toFixed(2)} · {a.completedJobs} jobs · ETA ~{a.etaMin}m</p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">{a.availability}</Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => setStep(8)} className="sm:order-1">
                      {t('requestQuote', lang)} <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                    <Button onClick={() => confirm('INSTANT')} disabled={confirming} className="sm:order-2">
                      {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {t('acceptEstimate', lang)} — {best.name.split(' ')[0]}
                    </Button>
                  </div>
                </div>
              </SectionCard>
            </>
          ) : (
            <SectionCard title={t('noWorkerTitle', lang)} description="Cooperative emergency protocol">
              <p className="text-sm text-muted-foreground">
                No verified {categoryKey} covers {flowArea} at this moment. In production the taluka coordinator is alerted and the Service Exchange reroutes demand to a neighbouring society. Try another nearby area for the demo.
              </p>
            </SectionCard>
          )}
        </>
      )}

      {/* Step 8: quote mode handoff */}
      {step === 8 && match?.best && (
        <SectionCard title={t('quoteTitle', lang)} description="Worker quotes per rate card; you can accept or negotiate — the floor protects worker income">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p><strong className="text-foreground">{match.best.name}</strong> will respond with a fair-price quote in a few seconds (prototype simulation). You can then accept, or send counter-offers — the worker agent never agrees below the cooperative floor.</p>
            <Progress value={Math.round(((step - 1) / Math.max(1, STEPS.length - 2)) * 100)} className="h-1.5" />
            <div className="flex justify-end">
              <Button onClick={() => confirm('QUOTE')} disabled={confirming}>
                {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Request quote from {match.best.name.split(' ')[0]}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function useCategory(key: string): ServiceCategoryDTO | null {
  const { data } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ ok: boolean; categories: ServiceCategoryDTO[] }>('/api/categories'),
    staleTime: 300000,
  })
  return data?.categories.find((c) => c.key === key) ?? null
}
