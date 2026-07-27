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

interface MemberstackDom {
  getMemberCookie(): Promise<string | null> | string | null
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

export class TalentAdminApi {
  private token: string | null = null

  constructor(
    private readonly environment: Environment,
    private readonly fetcher: typeof fetch = window.fetch.bind(window),
  ) {}

  private async xanoToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token) return this.token
    const memberstack = window.$memberstackDom
    if (!memberstack?.getMemberCookie) {
      throw new Error('Memberstack is not available on this page.')
    }

    const memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('Please log in to open the admin dashboard.')

    const response = await this.fetcher(
      `${TRADE_TOKEN_URL}?token=${encodeURIComponent(memberstackToken)}`,
    )
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new Error(responseMessage(data, response.status))

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
    return token
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowRetry = true,
  ): Promise<T> {
    const token = await this.xanoToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', 'application/json')

    const response = await this.fetcher(`${apiBase(this.environment)}/${path}`, {
      ...init,
      headers,
    })
    if (response.status === 401 && allowRetry) {
      this.token = null
      await this.xanoToken(true)
      return this.request<T>(path, init, false)
    }

    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new Error(responseMessage(data, response.status))
    return data as T
  }

  session(): Promise<{ role: 'reviewer' | 'admin'; display_name?: string }> {
    return this.request('admin/session')
  }

  list(status?: ApplicationStatus): Promise<PagedApplications> {
    return this.request('admin/applications/list', {
      method: 'POST',
      body: JSON.stringify({ status: status || null, page: 1, per_page: 100 }),
    })
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
