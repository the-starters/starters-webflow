import * as React from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  Clock3,
  ExternalLink,
  FileSearch,
  RefreshCw,
  Search,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react'
import {
  Application,
  ApplicationDetail,
  ApplicationStatus,
  Environment,
  isTalentAdminAuthError,
  TalentAdminApi,
} from './api'
import { Badge, Button, Card } from './ui'
import * as styles from './TalentApplicationsAdmin.module.css'

export interface TalentApplicationsAdminProps {
  title?: string
  environment?: Environment
  loginUrl?: string
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  interview_sent: 'Interview sent',
  interview_completed: 'Interview completed',
  approved: 'Approved',
  rejected: 'Rejected',
  on_hold: 'On hold',
  withdrawn: 'Withdrawn',
}

const FILTERS: Array<ApplicationStatus | 'all'> = [
  'all',
  'submitted',
  'under_review',
  'interview_sent',
  'interview_completed',
  'approved',
  'rejected',
  'on_hold',
]

const NEXT: Partial<Record<ApplicationStatus, ApplicationStatus[]>> = {
  submitted: ['under_review', 'on_hold', 'rejected'],
  under_review: ['interview_sent', 'approved', 'on_hold', 'rejected'],
  interview_sent: ['interview_completed', 'approved', 'on_hold', 'rejected'],
  interview_completed: ['approved', 'on_hold', 'rejected'],
  on_hold: ['under_review', 'interview_sent', 'approved', 'rejected'],
}

type RefreshResult = 'synced' | 'failed' | 'auth-failed' | 'superseded'

interface DashboardError {
  message: string
  authentication: boolean
}

function dateText(value?: string | number): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function safeExternalUrl(value?: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={status}>{STATUS_LABELS[status]}</Badge>
}

export function TalentApplicationsAdmin({
  title = 'Talent applications',
  environment = 'Staging',
  loginUrl = '/login?next=/admin/talent-applications',
}: TalentApplicationsAdminProps) {
  const api = React.useMemo(() => new TalentAdminApi(environment), [environment])
  const [applications, setApplications] = React.useState<Application[]>([])
  const [selected, setSelected] = React.useState<ApplicationDetail | null>(null)
  const [filter, setFilter] = React.useState<ApplicationStatus | 'all'>('all')
  const [search, setSearch] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [interviewUrl, setInterviewUrl] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<DashboardError | null>(null)
  const refreshRequest = React.useRef(0)
  const detailRequest = React.useRef(0)
  const transitionRequest = React.useRef(0)
  const filterRef = React.useRef<ApplicationStatus | 'all'>(filter)

  const clearPrivateState = React.useCallback((invalidateRefresh = true) => {
    if (invalidateRefresh) refreshRequest.current += 1
    detailRequest.current += 1
    transitionRequest.current += 1
    setApplications([])
    setSelected(null)
    setNotes('')
    setInterviewUrl('')
    setSaving(false)
  }, [])

  const refresh = React.useCallback(async (): Promise<RefreshResult> => {
    const request = ++refreshRequest.current
    const currentFilter = filterRef.current
    setLoading(true)
    setError(null)
    try {
      await api.session()
      const page = await api.list(currentFilter === 'all' ? undefined : currentFilter)
      if (request === refreshRequest.current) {
        setApplications(Array.isArray(page.items) ? page.items : [])
      }
      return 'synced'
    } catch (nextError) {
      if (request === refreshRequest.current) {
        const authFailed = isTalentAdminAuthError(nextError)
        if (authFailed) clearPrivateState(false)
        setError({
          message: nextError instanceof Error ? nextError.message : 'Unable to load applications.',
          authentication: authFailed,
        })
        return authFailed ? 'auth-failed' : 'failed'
      }
      return 'superseded'
    } finally {
      if (request === refreshRequest.current) {
        setLoading(false)
      }
    }
  }, [api, clearPrivateState])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => api.subscribeAuthChanges(() => {
    clearPrivateState()
    setError(null)
    setLoading(true)
    void refresh()
  }), [api, clearPrivateState, refresh])

  function changeFilter(nextFilter: ApplicationStatus | 'all') {
    refreshRequest.current += 1
    filterRef.current = nextFilter
    setApplications([])
    setError(null)
    setLoading(true)
    setFilter(nextFilter)
    void refresh()
  }

  function reconcileTransition(applicationId: number, nextStatus: ApplicationStatus) {
    setApplications((current) => current.flatMap((application) => {
      if (application.id !== applicationId) return [application]
      const currentFilter = filterRef.current
      if (currentFilter !== 'all' && currentFilter !== nextStatus) return []
      return [{ ...application, status: nextStatus }]
    }))
  }

  async function openApplication(application: Application) {
    const request = ++detailRequest.current
    setError(null)
    try {
      const detail = await api.detail(application.id)
      if (request !== detailRequest.current) return
      setSelected(detail)
      setNotes(detail.application.review_notes || '')
      setInterviewUrl(detail.application.interview_url || '')
    } catch (nextError) {
      if (request === detailRequest.current) {
        const authentication = isTalentAdminAuthError(nextError)
        if (authentication) clearPrivateState()
        setError({
          message: nextError instanceof Error ? nextError.message : 'Unable to load the application.',
          authentication,
        })
      }
    }
  }

  async function transition(nextStatus: ApplicationStatus) {
    if (!selected || saving) return
    const request = ++transitionRequest.current
    setSaving(true)
    setError(null)
    const applicationId = selected.application.id
    const detailSyncRequest = ++detailRequest.current
    try {
      try {
        await api.transition(selected.application, nextStatus, notes, interviewUrl)
      } catch (nextError) {
        const authentication = isTalentAdminAuthError(nextError)
        if (authentication) clearPrivateState()
        if (detailSyncRequest !== detailRequest.current && !authentication) return
        setError({
          message: nextError instanceof Error ? nextError.message : 'Unable to update the application.',
          authentication,
        })
        return
      }

      reconcileTransition(applicationId, nextStatus)
      const listResultPromise = refresh()
      if (detailSyncRequest !== detailRequest.current) {
        await listResultPromise
        return
      }

      setSelected((current) => current && current.application.id === applicationId
        ? {
            ...current,
            application: {
              ...current.application,
              status: nextStatus,
              review_notes: notes.trim(),
              interview_url: interviewUrl.trim(),
            },
          }
        : current)

      const [detailResult, listResult] = await Promise.all([
        detailSyncRequest === detailRequest.current
          ? api.detail(applicationId).then(
              (detail) => ({ status: 'fulfilled' as const, detail }),
              (error: unknown) => ({ status: 'rejected' as const, error }),
            )
          : Promise.resolve({ status: 'skipped' as const }),
        listResultPromise,
      ])
      if (
        detailResult.status === 'rejected' &&
        isTalentAdminAuthError(detailResult.error)
      ) {
        clearPrivateState()
        setError({ message: detailResult.error.message, authentication: true })
        return
      }
      if (listResult === 'auth-failed') return
      const detailSyncFailed = (
        detailResult.status === 'rejected' &&
        detailSyncRequest === detailRequest.current
      )
      if (detailResult.status === 'fulfilled' && detailSyncRequest === detailRequest.current) {
        setSelected(detailResult.detail)
        setNotes(detailResult.detail.application.review_notes || '')
        setInterviewUrl(detailResult.detail.application.interview_url || '')
      }
      if (detailSyncFailed || listResult === 'failed') {
        setError({
          message: 'Application updated, but the latest data could not be reloaded. Refresh before continuing.',
          authentication: false,
        })
      }
    } finally {
      if (request === transitionRequest.current) setSaving(false)
    }
  }

  const visible = applications.filter((application) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return `${application.applicant_name || ''} ${application.applicant_email || ''}`
      .toLowerCase()
      .includes(needle)
  })

  const counts = React.useMemo(
    () => ({
      total: applications.length,
      review: applications.filter((item) => item.status === 'under_review').length,
      interview: applications.filter((item) =>
        ['interview_sent', 'interview_completed'].includes(item.status),
      ).length,
      approved: applications.filter((item) => item.status === 'approved').length,
    }),
    [applications],
  )

  if (error && !applications.length && !selected) {
    return (
      <section className={styles.shell} aria-label={title}>
        <Card className={styles.centerCard}>
          <FileSearch size={32} aria-hidden="true" />
          <h2>{error.authentication ? 'Admin login required' : 'Dashboard unavailable'}</h2>
          <p>{error.message}</p>
          {error.authentication ? (
            <a className={styles.linkButton} href={loginUrl}>Log in</a>
          ) : (
            <Button variant="primary" onClick={refresh}>Try again</Button>
          )}
        </Card>
      </section>
    )
  }

  if (selected) {
    const application = selected.application
    const portfolioUrl = safeExternalUrl(application.portfolio_url)
    const linkedinUrl = safeExternalUrl(application.linkedin_url)
    return (
      <section className={styles.shell} aria-label={`${title}: ${application.applicant_name}`}>
        <div className={styles.detailTopbar}>
          <Button variant="ghost" onClick={() => {
            detailRequest.current += 1
            setSelected(null)
          }}>
            <ArrowLeft size={16} /> All applications
          </Button>
          <StatusBadge status={application.status} />
        </div>
        {error ? <div className={styles.error} role="alert">{error.message}</div> : null}

        <div className={styles.detailGrid}>
          <main>
            <Card className={styles.profileCard}>
              <p className={styles.eyebrow}>Application #{application.id}</p>
              <h1>{application.applicant_name || 'Unnamed applicant'}</h1>
              <p className={styles.muted}>{application.applicant_email || 'No email'}</p>
              <dl className={styles.meta}>
                <div><dt>Submitted</dt><dd>{dateText(application.created_at)}</dd></div>
                <div><dt>Timezone</dt><dd>{application.timezone || '—'}</dd></div>
                <div><dt>Availability</dt><dd>{application.availability || '—'}</dd></div>
              </dl>
              <div className={styles.links}>
                {portfolioUrl ? (
                  <a href={portfolioUrl} target="_blank" rel="noreferrer">
                    Portfolio <ExternalLink size={14} />
                  </a>
                ) : null}
                {linkedinUrl ? (
                  <a href={linkedinUrl} target="_blank" rel="noreferrer">
                    LinkedIn <ExternalLink size={14} />
                  </a>
                ) : null}
              </div>
            </Card>

            <Card className={styles.sectionCard}>
              <h2>Why they want to join</h2>
              <p className={styles.longText}>{application.motivation || 'No response provided.'}</p>
            </Card>

            <Card className={styles.sectionCard}>
              <h2>Application history</h2>
              <ol className={styles.timeline}>
                {selected.events.map((event) => (
                  <li key={event.id}>
                    <span className={styles.timelineDot}><Check size={12} /></span>
                    <div>
                      <strong>{STATUS_LABELS[event.to_status]}</strong>
                      <time>{dateText(event.created_at)}</time>
                      {event.notes ? <p>{event.notes}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </main>

          <aside>
            <Card className={styles.actionCard}>
              <h2>Review decision</h2>
              <label>
                <span>Interview link</span>
                <input
                  type="url"
                  value={interviewUrl}
                  onChange={(event) => setInterviewUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label>
                <span>Internal notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={7}
                  placeholder="Only approved staff can see this"
                />
              </label>
              <div className={styles.actionStack}>
                {(NEXT[application.status] || []).map((status) => (
                  <Button
                    key={status}
                    variant={
                      status === 'approved'
                        ? 'primary'
                        : status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                    }
                    disabled={saving}
                    onClick={() => void transition(status)}
                  >
                    {saving ? 'Saving…' : STATUS_LABELS[status]}
                  </Button>
                ))}
              </div>
              {!(NEXT[application.status] || []).length ? (
                <p className={styles.muted}>This application is in a final state.</p>
              ) : null}
            </Card>
          </aside>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.shell} aria-label={title}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>The Starters · {environment}</p>
          <h1>{title}</h1>
          <p className={styles.muted}>Review, interview, and approve starters from one queue.</p>
        </div>
        <Button onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? styles.spin : undefined} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      {error ? <div className={styles.error} role="alert">{error.message}</div> : null}

      <div className={styles.metrics}>
        <Card><UsersRound /><span>Total</span><strong>{counts.total}</strong></Card>
        <Card><FileSearch /><span>In review</span><strong>{counts.review}</strong></Card>
        <Card><Clock3 /><span>Interview</span><strong>{counts.interview}</strong></Card>
        <Card><UserRoundCheck /><span>Approved</span><strong>{counts.approved}</strong></Card>
      </div>

      <Card className={styles.queueCard}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <span className={styles.srOnly}>Search applications</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
            />
          </label>
          <label>
            <span className={styles.srOnly}>Filter by status</span>
            <select
              value={filter}
              onChange={(event) => {
                changeFilter(event.target.value as ApplicationStatus | 'all')
              }}
            >
              {FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === 'all' ? 'All statuses' : STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.table} aria-busy={loading}>
          <div className={styles.tableHead}>
            <span>Applicant</span><span>Status</span><span>Submitted</span><span />
          </div>
          {!loading && !visible.length ? (
            <div className={styles.empty}>
              <BriefcaseBusiness size={28} />
              <p>No applications match this view.</p>
            </div>
          ) : null}
          {visible.map((application) => (
            <button
              key={application.id}
              className={styles.tableRow}
              onClick={() => void openApplication(application)}
            >
              <span>
                <strong>{application.applicant_name || 'Unnamed applicant'}</strong>
                <small>{application.applicant_email || 'No email'}</small>
              </span>
              <StatusBadge status={application.status} />
              <time>{dateText(application.created_at)}</time>
              <span className={styles.openLabel}>Review →</span>
            </button>
          ))}
        </div>
      </Card>
    </section>
  )
}
