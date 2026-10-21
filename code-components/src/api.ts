import {
  MemberXanoClient,
  XanoAuthError,
  XANO_ORIGIN,
} from './memberXanoClient'

export { TRADE_TOKEN_URL, XANO_ORIGIN } from './memberXanoClient'

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

export function apiBase(environment: Environment): string {
  return environment === 'Live'
    ? `${XANO_ORIGIN}/api:talent-admin-v3`
    : `${XANO_ORIGIN}/api:talent-admin-v3:staging`
}

export { XanoAuthError as TalentAdminAuthError }

export function isTalentAdminAuthError(error: unknown): error is XanoAuthError {
  return error instanceof XanoAuthError
}

export class TalentAdminApi extends MemberXanoClient {
  constructor(
    environment: Environment,
    fetcher: typeof fetch = window.fetch.bind(window),
  ) {
    super(
      () => apiBase(environment),
      {
        noMemberstack: 'Memberstack is not available on this page.',
        loginRequired: 'Please log in to open the admin dashboard.',
        sessionChanged: 'Member session changed while loading the admin dashboard.',
      },
      fetcher,
    )
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
