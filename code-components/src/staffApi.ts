import { MemberXanoClient, XANO_ORIGIN } from './memberXanoClient'

/** Xano API group "Staff Console v1" (workspace 2, group 403). Xano owns the staff rule. */
export const STAFF_API_BASE = `${XANO_ORIGIN}/api:kR5gpIDB`

export type PlatformStatus = 'Live on Platform' | 'Removed from Platform'

export interface StaffSession {
  email: string
  role: string
  writes_enabled: boolean
}

export interface StarterSearchItem {
  starter_id: number
  name?: string | null
  email?: string | null
  slug?: string | null
  platform_status?: string | null
  is_live?: boolean
  photo?: string | null
  profile_type?: string | null
}

export interface StarterChange {
  at: number | string
  previous_status?: string | null
  new_status?: string | null
  action?: string | null
  actor?: string | null
  reason?: string | null
  outcome?: string | null
}

export interface StarterCard {
  starter_id: number
  name?: string | null
  email?: string | null
  slug?: string | null
  hire_url?: string | null
  photo?: string | null
  profile_type?: string | null
  platform_status: string
  is_live: boolean
  algolia_sync_status?: string | null
  target_status: PlatformStatus
  target_label: string
  preview_action?: string | null
  preview_token?: string | null
  warnings: { text: string }[]
  last_outcome?: string | null
  last_error?: string | null
  recent_changes: StarterChange[]
}

export interface StatusChangeResult {
  replayed: boolean
  starter_id: number
  action?: string | null
  previous_status?: string | null
  status_now?: string | null
  projection_outcome?: string | null
  projection_error?: string | null
  enqueued?: boolean
}

export class StaffConsoleApi extends MemberXanoClient {
  constructor(fetcher: typeof fetch = window.fetch.bind(window), base = STAFF_API_BASE) {
    super(
      () => base,
      {
        noMemberstack: 'Memberstack is not available on this page.',
        loginRequired: 'Please log in to open the staff console.',
        sessionChanged: 'Your login changed. Reload the staff console.',
      },
      fetcher,
    )
  }

  session(): Promise<StaffSession> {
    return this.request('staff/session')
  }

  async search(q: string): Promise<StarterSearchItem[]> {
    const data = await this.request<{ items?: StarterSearchItem[] }>(
      `staff/starters/search?q=${encodeURIComponent(q)}`,
    )
    return Array.isArray(data?.items) ? data.items : []
  }

  async detail(starterId: number): Promise<StarterCard | null> {
    const data = await this.request<{ items?: StarterCard[] }>(
      `staff/starters/detail?starter_id=${encodeURIComponent(String(starterId))}`,
    )
    return Array.isArray(data?.items) && data.items.length ? data.items[0] : null
  }

  /** Executes a remove/restore. The preview token is the idempotency key on the server. */
  setStatus(card: StarterCard, reason: string): Promise<StatusChangeResult> {
    return this.request('staff/starters/platform-status/set', {
      method: 'POST',
      body: JSON.stringify({
        starter_id: card.starter_id,
        status: card.target_status,
        preview_token: card.preview_token,
        reason: reason.trim(),
      }),
    })
  }
}
