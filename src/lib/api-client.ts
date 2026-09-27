'use client'

// Tiny typed fetch helpers for GigSetu APIs

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json()
  if (!res.ok || data?.ok === false) {
    // Surface WHICH field failed. A bare "Some fields need attention." makes a
    // 400 undiagnosable from the UI — it is how a media shape mismatch
    // (client sent objects, server expected strings) went unnoticed while
    // every booking without a photo worked fine.
    const fields = Array.isArray(data?.fields) ? data.fields as { path?: string; message?: string }[] : []
    const detail = fields
      .map((f) => (f.path ? `${f.path}: ${f.message ?? 'invalid'}` : (f.message ?? 'invalid')))
      .slice(0, 3)
      .join('; ')
    throw new Error(detail ? `${data?.error ?? `Request failed: ${res.status}`} (${detail})` : (data?.error ?? `Request failed: ${res.status}`))
  }
  return data as T
}

export const api = {
  get: <T,>(url: string) => jsonFetch<T>(url),
  post: <T,>(url: string, body: unknown) => jsonFetch<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T,>(url: string, body: unknown) => jsonFetch<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T,>(url: string) => jsonFetch<T>(url, { method: 'DELETE' }),
}

/**
 * Sign in as one of the seeded demo identities.
 *
 * IMPORTANT: this MUST be `POST /api/auth`. `GET /api/session?role=X` used to
 * double as a login endpoint, but it was closed down as a privilege-escalation
 * oracle — it now only answers "who am I right now?" and returns
 * `{ user: null }` when logged out. Calling it to sign in silently handed a
 * null identity to the store, which surfaced as the misleading
 * "SIH demo engine not ready" toast. Always sign in through here.
 */
export async function signInAs<T>(role: string): Promise<T> {
  return api.post<T>('/api/auth', { role })
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return '₹' + n.toLocaleString('en-IN')
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN')
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
