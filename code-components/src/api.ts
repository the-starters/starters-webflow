export const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
export const TRADE_TOKEN_URL = `${XANO_ORIGIN}/api:g1vmSLWh/auth/trade-token/v3`

export type Environment = 'Staging' | 'Live'
export type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'interview_sent'
  | 'interview_completed'
  | 'approved'
  | 'rejected'
  | 'on_hold'
  | 'withdrawn'

export interface Application {
  id: number
  created_at: number | string
  updated_at?: number | string
  applicant_name?: string
  applicant_email?: string
  timezone?: string
  availability?: string
  portfolio_url?: string
  linkedin_url?: string
  motivation?: string
  answers?: unknown
  status: ApplicationStatus
  interview_url?: string
  review_notes?: string
}

export interface ApplicationEvent {
  id: number
  created_at: number | string
  action: string
  from_status?: ApplicationStatus
  to_status: ApplicationStatus
  notes?: string
}

export interface ApplicationDetail {
  application: Application
  events: ApplicationEvent[]
}

export interface PagedApplications {
  items: Application[]
  itemsTotal?: number
  curPage?: number
}

const APPLICATIONS_PER_PAGE = 100
const MAX_APPLICATION_PAGES = 1000

interface MemberstackDom {
  getMemberCookie(): Promise<string | null> | string | null
  onAuthChange?(listener: (member: unknown) => void): (() => void) | void
}

declare global {
  interface Window {
    $memberstackDom?: MemberstackDom
  }
}

export function apiBase(environment: Environment): string {
  return environment === 'Live'
    ? `${XANO_ORIGIN}/api:talent-admin-v3`
    : `${XANO_ORIGIN}/api:talent-admin-v3:staging`
}

function responseMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return `Request failed (${status})`
}

export class TalentAdminAuthError extends Error {}

function memberSessionChangedError(): TalentAdminAuthError {
  return new TalentAdminAuthError('Member session changed while loading the admin dashboard.')
}

export function isTalentAdminAuthError(error: unknown): error is TalentAdminAuthError {
  return error instanceof TalentAdminAuthError
}

export class TalentAdminApi {
  private token: string | null = null
  private memberstackToken: string | null = null
  private sessionGeneration = 0
  private wiredMemberstack: MemberstackDom | null = null
  private authChangeCleanup: (() => void) | null = null
  private readonly authChangeListeners = new Set<() => void>()

  constructor(
    private readonly environment: Environment,
    private readonly fetcher: typeof fetch = window.fetch.bind(window),
  ) {}

  private resetSession(): void {
    this.sessionGeneration += 1
    this.token = null
    this.memberstackToken = null
    for (const listener of this.authChangeListeners) listener()
  }

  private wireAuthChanges(memberstack: MemberstackDom): void {
    if (memberstack === this.wiredMemberstack) return
    this.authChangeCleanup?.()
    this.wiredMemberstack = memberstack
    const cleanup = memberstack.onAuthChange?.(() => this.resetSession())
    this.authChangeCleanup = typeof cleanup === 'function' ? cleanup : null
  }

  private assertSessionGeneration(generation: number): void {
    if (generation !== this.sessionGeneration) throw memberSessionChangedError()
  }

  private async assertMemberstackSession(generation: number): Promise<void> {
    const memberstack = window.$memberstackDom
    if (!memberstack?.getMemberCookie) {
      this.resetSession()
      throw memberSessionChangedError()
    }
    const memberstackToken = await memberstack.getMemberCookie()
    this.assertSessionGeneration(generation)
    if (!memberstackToken || memberstackToken !== this.memberstackToken) {
      this.resetSession()
      throw memberSessionChangedError()
    }
  }

  subscribeAuthChanges(listener: () => void): () => void {
    this.authChangeListeners.add(listener)
    const memberstack = window.$memberstackDom
    if (memberstack) this.wireAuthChanges(memberstack)
    return () => {
      this.authChangeListeners.delete(listener)
    }
  }

  private async xanoToken(
    forceRefresh = false,
    generation = this.sessionGeneration,
  ): Promise<string> {
    const memberstack = window.$memberstackDom
    if (!memberstack?.getMemberCookie) {
      this.token = null
      this.memberstackToken = null
      throw new TalentAdminAuthError('Memberstack is not available on this page.')
    }
    this.wireAuthChanges(memberstack)

    const memberstackToken = await memberstack.getMemberCookie()
    this.assertSessionGeneration(generation)
    if (!memberstackToken) {
      this.token = null
      this.memberstackToken = null
      throw new TalentAdminAuthError('Please log in to open the admin dashboard.')
    }
    if (this.memberstackToken && memberstackToken !== this.memberstackToken) {
      this.resetSession()
      throw memberSessionChangedError()
    }
    if (!forceRefresh && this.token && memberstackToken === this.memberstackToken) {
      return this.token
    }

    const response = await this.fetcher(
      `${TRADE_TOKEN_URL}?token=${encodeURIComponent(memberstackToken)}`,
    )
    const data: unknown = await response.json().catch(() => null)
    this.assertSessionGeneration(generation)
    const latestMemberstackToken = await memberstack.getMemberCookie()
    this.assertSessionGeneration(generation)
    if (latestMemberstackToken !== memberstackToken) {
      this.resetSession()
      throw memberSessionChangedError()
    }
    if (!response.ok) {
      const message = responseMessage(data, response.status)
      if (response.status === 401 || response.status === 403) {
        throw new TalentAdminAuthError(message)
      }
      throw new Error(message)
    }

    const token =
      typeof data === 'string'
        ? data
        : data && typeof data === 'object' && 'authToken' in data
          ? (data as { authToken?: unknown }).authToken
          : data && typeof data === 'object' && 'token' in data
            ? (data as { token?: unknown }).token
            : null
    if (typeof token !== 'string' || !token) {
      throw new Error('Xano did not return an auth token.')
    }
    this.token = token
    this.memberstackToken = memberstackToken
    return token
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowRetry = true,
    generation = this.sessionGeneration,
  ): Promise<T> {
    const token = await this.xanoToken(false, generation)
    this.assertSessionGeneration(generation)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', 'application/json')

    const response = await this.fetcher(`${apiBase(this.environment)}/${path}`, {
      ...init,
      headers,
    })
    this.assertSessionGeneration(generation)
    await this.assertMemberstackSession(generation)
    if (response.status === 401 && allowRetry) {
      this.token = null
      await this.xanoToken(true, generation)
      return this.request<T>(path, init, false, generation)
    }

    const data: unknown = await response.json().catch(() => null)
    this.assertSessionGeneration(generation)
    if (!response.ok) {
      const message = responseMessage(data, response.status)
      if (response.status === 401 || response.status === 403) {
        throw new TalentAdminAuthError(message)
      }
      throw new Error(message)
    }
    return data as T
  }

  session(): Promise<{ role: 'reviewer' | 'admin'; display_name?: string }> {
    return this.request('admin/session')
  }

  private listPage(
    status: ApplicationStatus | undefined,
    page: number,
    generation: number,
  ): Promise<PagedApplications> {
    return this.request('admin/applications/list', {
      method: 'POST',
      body: JSON.stringify({
        status: status || null,
        page,
        per_page: APPLICATIONS_PER_PAGE,
      }),
    }, true, generation)
  }

  async list(status?: ApplicationStatus): Promise<PagedApplications> {
    const generation = this.sessionGeneration
    const items: Application[] = []
    const seenIds = new Set<number>()
    let itemsTotal: number | undefined

    for (let page = 1; page <= MAX_APPLICATION_PAGES; page += 1) {
      const response = await this.listPage(status, page, generation)
      const pageItems = Array.isArray(response.items) ? response.items : []
      if (typeof response.itemsTotal === 'number' && response.itemsTotal >= 0) {
        itemsTotal = response.itemsTotal
      }

      const previousCount = items.length
      for (const application of pageItems) {
        if (!seenIds.has(application.id)) {
          seenIds.add(application.id)
          items.push(application)
        }
      }

      if (
        pageItems.length === 0 ||
        (itemsTotal !== undefined && items.length >= itemsTotal) ||
        (itemsTotal === undefined && pageItems.length < APPLICATIONS_PER_PAGE)
      ) {
        return { items, itemsTotal: itemsTotal ?? items.length, curPage: page }
      }
      if (items.length === previousCount) {
        throw new Error('Xano pagination did not advance while loading applications.')
      }
    }

    throw new Error('The application queue is too large to load safely.')
  }

  detail(applicationId: number): Promise<ApplicationDetail> {
    return this.request('admin/applications/detail', {
      method: 'POST',
      body: JSON.stringify({ application_id: applicationId }),
    })
  }

  transition(
    application: Application,
    nextStatus: ApplicationStatus,
    notes: string,
    interviewUrl: string,
  ): Promise<Application> {
    return this.request('admin/applications/transition', {
      method: 'PATCH',
      body: JSON.stringify({
        application_id: application.id,
        expected_status: application.status,
        next_status: nextStatus,
        notes: notes.trim() || null,
        interview_url: interviewUrl.trim() || null,
      }),
    })
  }
}
