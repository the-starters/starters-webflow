// Shared Memberstack -> Xano Bearer client for staff/admin code components.
// The browser holds no secret: it trades the current Memberstack token at
// auth/trade-token/v3 for a Xano token and sends it as a Bearer. Xano owns every
// permission check. Session changes invalidate in-flight work and cached tokens.
export const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
export const TRADE_TOKEN_URL = `${XANO_ORIGIN}/api:g1vmSLWh/auth/trade-token/v3`

export interface MemberXanoMessages {
  noMemberstack: string
  loginRequired: string
  sessionChanged: string
}

export class XanoAuthError extends Error {}

export function isXanoAuthError(error: unknown): error is XanoAuthError {
  return error instanceof XanoAuthError
}

interface MemberstackDom {
  getMemberCookie(): Promise<string | null> | string | null
  onAuthChange?(
    listener: (member: unknown) => void,
  ): (() => void) | { unsubscribe(): void } | void
}

declare global {
  interface Window {
    $memberstackDom?: MemberstackDom
  }
}

function responseMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return `Request failed (${status})`
}

export class MemberXanoClient {
  private token: string | null = null
  private memberstackToken: string | null = null
  protected sessionGeneration = 0
  private wiredMemberstack: MemberstackDom | null = null
  private authChangeCleanup: (() => void) | null = null
  private readonly authChangeListeners = new Set<() => void>()

  constructor(
    private readonly baseUrl: () => string,
    private readonly messages: MemberXanoMessages,
    private readonly fetcher: typeof fetch = window.fetch.bind(window),
  ) {}

  private sessionChangedError(): XanoAuthError {
    return new XanoAuthError(this.messages.sessionChanged)
  }

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
    this.authChangeCleanup =
      typeof cleanup === 'function'
        ? cleanup
        : cleanup && typeof cleanup.unsubscribe === 'function'
          ? () => cleanup.unsubscribe()
          : null
  }

  private assertSessionGeneration(generation: number): void {
    if (generation !== this.sessionGeneration) throw this.sessionChangedError()
  }

  private async assertMemberstackSession(generation: number): Promise<void> {
    const memberstack = window.$memberstackDom
    if (!memberstack?.getMemberCookie) {
      this.resetSession()
      throw this.sessionChangedError()
    }
    const memberstackToken = await memberstack.getMemberCookie()
    this.assertSessionGeneration(generation)
    if (!memberstackToken || memberstackToken !== this.memberstackToken) {
      this.resetSession()
      throw this.sessionChangedError()
    }
  }

  subscribeAuthChanges(listener: () => void): () => void {
    this.authChangeListeners.add(listener)
    const memberstack = window.$memberstackDom
    if (memberstack) this.wireAuthChanges(memberstack)
    return () => {
      this.authChangeListeners.delete(listener)
      if (!this.authChangeListeners.size) {
        this.authChangeCleanup?.()
        this.authChangeCleanup = null
        this.wiredMemberstack = null
      }
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
      throw new XanoAuthError(this.messages.noMemberstack)
    }
    this.wireAuthChanges(memberstack)

    const memberstackToken = await memberstack.getMemberCookie()
    this.assertSessionGeneration(generation)
    if (!memberstackToken) {
      this.token = null
      this.memberstackToken = null
      throw new XanoAuthError(this.messages.loginRequired)
    }
    if (this.memberstackToken && memberstackToken !== this.memberstackToken) {
      this.resetSession()
      throw this.sessionChangedError()
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
      throw this.sessionChangedError()
    }
    if (!response.ok) {
      const message = responseMessage(data, response.status)
      if (response.status === 401 || response.status === 403) {
        throw new XanoAuthError(message)
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

  protected async request<T>(
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

    const response = await this.fetcher(`${this.baseUrl()}/${path}`, {
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
        throw new XanoAuthError(message)
      }
      throw new Error(message)
    }
    return data as T
  }
}
