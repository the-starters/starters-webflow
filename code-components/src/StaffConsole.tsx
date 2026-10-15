import * as React from 'react'
import {
  StaffConsoleApi,
  StaffSession,
  StarterCard,
  StarterSearchItem,
  StatusChangeResult,
} from './staffApi'
import { isXanoAuthError } from './memberXanoClient'
import * as styles from './StaffConsole.module.css'

export interface StaffConsoleProps {
  title?: string
  loginUrl?: string
  /** Test seam only. Webflow instances use the default API client. */
  api?: StaffConsoleApi
}

const REASON_MIN = 10
const REASON_MAX = 500
const SEARCH_DEBOUNCE_MS = 400

type Gate =
  | { state: 'loading' }
  | { state: 'login' }
  | { state: 'denied'; message: string }
  | { state: 'error'; message: string }
  | { state: 'ready'; session: StaffSession }

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Plain-language help for the stable Xano error codes. */
function explain(message: string): string {
  if (message.startsWith('STAFF_WRITES_DISABLED')) return 'Changes are turned off right now. Ask JP.'
  if (message.startsWith('PREVIEW_STALE')) return 'This Starter changed or the page is older than 10 minutes. The card was reloaded. Check it and try again.'
  if (message.startsWith('RATE_LIMITED')) return 'You made 20 changes in the last hour. Wait, or ask JP.'
  if (message.startsWith('REASON_INVALID')) return `Write a reason of ${REASON_MIN} to ${REASON_MAX} characters.`
  if (message.startsWith('REQUEST_KEY_REUSED')) return 'This change was already sent for another Starter. Reload the page.'
  if (message.startsWith('STAFF_ACCESS_DENIED')) return 'Your account does not have staff access.'
  return message
}

function denialText(message: string): string {
  const reason = message.split(':')[1] || ''
  const map: Record<string, string> = {
    email_not_verified: 'Your staff email is not verified in Memberstack yet. Ask JP to verify it.',
    domain_not_staff: 'This page is only for staff emails (@thestarters.com or @hirethestarters.com).',
    shared_mailbox_denied: 'Shared mailboxes (hello@, support@, …) cannot use the staff console. Log in with your own email.',
    staff_deactivated: 'Your staff access is turned off. Ask JP.',
    not_live_member: 'This is a test-mode account. Log in with your live account.',
    memberstack_unavailable: 'The staff check could not reach Memberstack. Reload in a minute.',
  }
  return map[reason] || 'Your account does not have staff access.'
}

function dateText(value?: number | string): string {
  if (value === undefined || value === null || value === '') return '—'
  const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function safeUrl(value?: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function initialStarterId(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('starter_id')
    const id = raw ? Number(raw) : NaN
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

function StatusPill({ live }: { live: boolean }) {
  return <span className={live ? styles.pillLive : styles.pillRemoved}>{live ? 'Live' : 'Removed'}</span>
}

export function StaffConsole({
  title = 'Staff console',
  loginUrl = '/login?next=/staff',
  api: injectedApi,
}: StaffConsoleProps) {
  const api = React.useMemo(() => injectedApi ?? new StaffConsoleApi(), [injectedApi])
  const [gate, setGate] = React.useState<Gate>({ state: 'loading' })
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<StarterSearchItem[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<number | null>(initialStarterId)
  const [card, setCard] = React.useState<StarterCard | null>(null)
  const [cardLoading, setCardLoading] = React.useState(false)
  const [cardError, setCardError] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const [confirmed, setConfirmed] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [lastResult, setLastResult] = React.useState<StatusChangeResult | null>(null)
  const searchRequest = React.useRef(0)
  const cardRequest = React.useRef(0)
  const inFlight = React.useRef(false)

  const loadSession = React.useCallback(async () => {
    setGate({ state: 'loading' })
    try {
      setGate({ state: 'ready', session: await api.session() })
    } catch (error) {
      const message = errorText(error, 'Unable to check staff access.')
      if (isXanoAuthError(error)) {
        setGate(/log in|not available/i.test(message) ? { state: 'login' } : { state: 'denied', message })
      } else {
        setGate({ state: 'error', message })
      }
    }
  }, [api])

  React.useEffect(() => {
    void loadSession()
    return api.subscribeAuthChanges(() => {
      setResults([])
      setCard(null)
      setReason('')
      setConfirmed(false)
      void loadSession()
    })
  }, [api, loadSession])

  const ready = gate.state === 'ready'

  React.useEffect(() => {
    if (!ready) return
    const q = query.trim()
    const request = ++searchRequest.current
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const items = await api.search(q)
        if (request === searchRequest.current) {
          setResults(items)
          setSearchError(null)
        }
      } catch (error) {
        if (request === searchRequest.current) setSearchError(explain(errorText(error, 'Search failed.')))
      } finally {
        if (request === searchRequest.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [api, query, ready])

  const loadCard = React.useCallback(async (starterId: number) => {
    const request = ++cardRequest.current
    setCardLoading(true)
    setCardError(null)
    try {
      const next = await api.detail(starterId)
      if (request !== cardRequest.current) return
      setCard(next)
      if (!next) setCardError('Starter not found.')
    } catch (error) {
      if (request === cardRequest.current) {
        setCard(null)
        setCardError(explain(errorText(error, 'Could not load this Starter.')))
      }
    } finally {
      if (request === cardRequest.current) setCardLoading(false)
    }
  }, [api])

  React.useEffect(() => {
    if (ready && selectedId) void loadCard(selectedId)
  }, [ready, selectedId, loadCard])

  const choose = (starterId: number) => {
    setSelectedId(starterId)
    setReason('')
    setConfirmed(false)
    setSubmitError(null)
    setLastResult(null)
  }

  const reasonLength = reason.trim().length
  const writesEnabled = gate.state === 'ready' && gate.session.writes_enabled === true
  const canSubmit =
    !!card && !!card.preview_token && writesEnabled && confirmed && !submitting &&
    reasonLength >= REASON_MIN && reasonLength <= REASON_MAX

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!card || !canSubmit || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setSubmitError(null)
    setLastResult(null)
    try {
      const result = await api.setStatus(card, reason)
      setLastResult(result)
      setReason('')
      setConfirmed(false)
    } catch (error) {
      setSubmitError(explain(errorText(error, 'The change failed.')))
    } finally {
      inFlight.current = false
      setSubmitting(false)
      // Always re-read: shows the new status, the audit row and a fresh preview token.
      void loadCard(card.starter_id)
    }
  }

  if (gate.state === 'loading') {
    return <section className={styles.shell} aria-busy="true"><p className={styles.muted}>Checking staff access…</p></section>
  }
  if (gate.state === 'login') {
    return (
      <section className={styles.shell}>
        <h1>{title}</h1>
        <p>Log in with your staff account to use this page.</p>
        <a className={styles.buttonPrimary} href={loginUrl}>Log in</a>
      </section>
    )
  }
  if (gate.state === 'denied' || gate.state === 'error') {
    return (
      <section className={styles.shell}>
        <h1>{title}</h1>
        <div className={styles.alert} role="alert" data-testid="no-access">
          {gate.state === 'denied' ? denialText(gate.message) : gate.message}
        </div>
      </section>
    )
  }

  const hireUrl = safeUrl(card?.hire_url)

  return (
    <section className={styles.shell} aria-label={title}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>The Starters staff</p>
          <h1>{title}</h1>
          <p className={styles.muted}>Signed in as <strong>{gate.session.email}</strong></p>
        </div>
        <span className={writesEnabled ? styles.pillLive : styles.pillRemoved} data-testid="writes-flag">
          {writesEnabled ? 'Changes ON' : 'Changes OFF (read only)'}
        </span>
      </header>

      <div className={styles.layout}>
        <div className={styles.card}>
          <label className={styles.label} htmlFor="staff-search">Find a Starter</label>
          <input
            id="staff-search"
            className={styles.input}
            type="search"
            placeholder="Id, email, /hire slug or name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searchError && <p className={styles.error} role="alert">{searchError}</p>}
          {searching && <p className={styles.muted}>Searching…</p>}
          {!searching && query.trim().length >= 2 && !results.length && !searchError && (
            <p className={styles.muted}>No Starter found.</p>
          )}
          <ul className={styles.results}>
            {results.map((item) => (
              <li key={item.starter_id}>
                <button
                  type="button"
                  className={item.starter_id === selectedId ? styles.resultActive : styles.result}
                  onClick={() => choose(item.starter_id)}
                >
                  <strong>{item.name || '(no name)'}</strong>
                  <span>{item.email || 'no email'}</span>
                  <span className={styles.muted}>#{item.starter_id}{item.slug ? ` · /hire/${item.slug}` : ''}</span>
                  <StatusPill live={item.is_live === true} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.card} data-testid="starter-card">
          {!selectedId && <p className={styles.muted}>Pick a Starter from the search results.</p>}
          {cardLoading && !card && <p className={styles.muted}>Loading Starter…</p>}
          {cardError && <p className={styles.error} role="alert">{cardError}</p>}
          {card && (
            <>
              <div className={styles.cardHead}>
                {safeUrl(card.photo) && <img className={styles.photo} src={safeUrl(card.photo) as string} alt="" />}
                <div>
                  <h2>{card.name || '(no name)'}</h2>
                  <p className={styles.muted}>{card.email || 'no email'} · #82 {card.starter_id}</p>
                </div>
                <StatusPill live={card.is_live} />
              </div>
              <dl className={styles.facts}>
                <dt>Status</dt><dd>{card.platform_status || '—'}</dd>
                <dt>/hire page</dt><dd>{hireUrl ? <a href={hireUrl} target="_blank" rel="noopener noreferrer">{hireUrl}</a> : 'No /hire page'}</dd>
                <dt>Search index</dt><dd>{card.algolia_sync_status || 'unknown'}</dd>
              </dl>

              {card.warnings.map((warning) => (
                <p key={warning.text} className={styles.warning}>{warning.text}</p>
              ))}

              {card.last_outcome === 'error' && (
                <div className={styles.alert} role="alert" data-testid="last-error">
                  The last change did not finish: {card.last_error || 'no detail'}. Do not retry. Send this Starter id to JP.
                </div>
              )}

              {lastResult && (
                <p className={styles.success} role="status" data-testid="last-result">
                  {lastResult.replayed ? 'Already done (same request). ' : 'Done. '}
                  Status is now {lastResult.status_now}. Update: {lastResult.projection_outcome}
                  {lastResult.projection_error ? ` (${lastResult.projection_error}). Send this Starter id to JP.` : '.'}
                </p>
              )}

              <form className={styles.form} onSubmit={submit} aria-label="Change platform status">
                <p>This will set the status to <strong>{card.target_status}</strong>.</p>
                <label className={styles.label} htmlFor="staff-reason">Reason ({REASON_MIN} to {REASON_MAX} characters)</label>
                <textarea
                  id="staff-reason"
                  className={styles.input}
                  value={reason}
                  maxLength={REASON_MAX}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={!writesEnabled || submitting}
                />
                <p className={styles.muted}>{reasonLength}/{REASON_MAX}</p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={!writesEnabled || submitting}
                  />
                  I checked the name, email and #82 id. This is the right Starter.
                </label>
                {submitError && <p className={styles.error} role="alert" data-testid="submit-error">{submitError}</p>}
                <button
                  type="submit"
                  className={card.target_status === 'Removed from Platform' ? styles.buttonDanger : styles.buttonPrimary}
                  disabled={!canSubmit}
                  aria-busy={submitting}
                >
                  {submitting ? 'Working…' : card.target_label}
                </button>
                {!writesEnabled && <p className={styles.muted}>Changes are off. You can still look up Starters.</p>}
              </form>

              <h3 className={styles.subhead}>Recent changes</h3>
              {card.recent_changes.length ? (
                <ul className={styles.history}>
                  {card.recent_changes.map((change, index) => (
                    <li key={`${change.at}-${index}`}>
                      <span className={styles.muted}>{dateText(change.at)}</span> · {change.previous_status || '—'} → {change.new_status || '—'} · {change.actor || '—'} · {change.outcome || '—'}
                      {change.reason ? <em> · {change.reason}</em> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No changes recorded.</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
