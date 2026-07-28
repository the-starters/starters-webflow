import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiBase, TalentAdminApi, TRADE_TOKEN_URL } from '../src/api'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('TalentAdminApi', () => {
  beforeEach(() => {
    window.$memberstackDom = {
      getMemberCookie: vi.fn().mockResolvedValue('member-jwt'),
    }
  })

  it('pins traffic to the expected Xano staging canonical', () => {
    expect(apiBase('Staging')).toBe(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:talent-admin-v3:staging',
    )
  })

  it('trades Memberstack auth and sends only the Xano token to the admin API', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ authToken: 'xano-token' }))
      .mockResolvedValueOnce(jsonResponse({ role: 'admin' }))
    const api = new TalentAdminApi('Staging', fetcher)

    await api.session()

    expect(fetcher.mock.calls[0][0]).toBe(`${TRADE_TOKEN_URL}?token=member-jwt`)
    expect(fetcher.mock.calls[1][0]).toBe(`${apiBase('Staging')}/admin/session`)
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe(
      'Bearer xano-token',
    )
    expect(String(fetcher.mock.calls[1][0])).not.toContain('member-jwt')
  })

  it('sends optimistic concurrency status on transitions', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('xano-token'))
      .mockResolvedValueOnce(jsonResponse({ id: 7, status: 'approved' }))
    const api = new TalentAdminApi('Staging', fetcher)

    await api.transition(
      { id: 7, status: 'interview_completed', created_at: 1 },
      'approved',
      'Strong interview',
      '',
    )

    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      application_id: 7,
      expected_status: 'interview_completed',
      next_status: 'approved',
      notes: 'Strong interview',
    })
  })

  it('does not call Xano when Memberstack has no session', async () => {
    window.$memberstackDom = { getMemberCookie: vi.fn().mockResolvedValue(null) }
    const fetcher = vi.fn<typeof fetch>()
    const api = new TalentAdminApi('Staging', fetcher)

    await expect(api.session()).rejects.toThrow(/log in/i)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('trades a new Xano token when the Memberstack session changes', async () => {
    let memberstackToken = 'member-one'
    let authChange: ((member: unknown) => void) | undefined
    const getMemberCookie = vi.fn(async () => memberstackToken)
    window.$memberstackDom = {
      getMemberCookie,
      onAuthChange(listener) {
        authChange = listener
      },
    }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('xano-one'))
      .mockResolvedValueOnce(jsonResponse({ role: 'admin' }))
      .mockResolvedValueOnce(jsonResponse('xano-two'))
      .mockResolvedValueOnce(jsonResponse({ role: 'admin' }))
    const api = new TalentAdminApi('Staging', fetcher)

    await api.session()
    memberstackToken = 'member-two'
    authChange?.(null)
    await api.session()

    expect(fetcher.mock.calls[0][0]).toBe(`${TRADE_TOKEN_URL}?token=member-one`)
    expect(fetcher.mock.calls[2][0]).toBe(`${TRADE_TOKEN_URL}?token=member-two`)
    expect(new Headers(fetcher.mock.calls[3][1]?.headers).get('Authorization')).toBe(
      'Bearer xano-two',
    )
  })

  it('unsubscribes from Memberstack auth changes after the last subscriber leaves', () => {
    const unsubscribe = vi.fn()
    const onAuthChange = vi.fn(() => ({ unsubscribe }))
    window.$memberstackDom = {
      getMemberCookie: vi.fn().mockResolvedValue('member-jwt'),
      onAuthChange,
    }
    const api = new TalentAdminApi('Staging', vi.fn<typeof fetch>())

    const cleanupFirst = api.subscribeAuthChanges(vi.fn())
    const cleanupSecond = api.subscribeAuthChanges(vi.fn())

    cleanupFirst()
    expect(unsubscribe).not.toHaveBeenCalled()

    cleanupSecond()
    expect(unsubscribe).toHaveBeenCalledOnce()

    const cleanupThird = api.subscribeAuthChanges(vi.fn())
    expect(onAuthChange).toHaveBeenCalledTimes(2)
    cleanupThird()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('loads every page in the application queue', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      status: 'submitted',
      created_at: 1,
    }))
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('xano-token'))
      .mockResolvedValueOnce(jsonResponse({ items: firstPage, itemsTotal: 101 }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: 101, status: 'submitted', created_at: 1 }],
        itemsTotal: 101,
      }))
    const api = new TalentAdminApi('Staging', fetcher)

    const result = await api.list()

    expect(result.items).toHaveLength(101)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ page: 1 })
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toMatchObject({ page: 2 })
  })

  it('aborts pagination when the Memberstack session changes between pages', async () => {
    let memberstackToken = 'member-one'
    let authChange: ((member: unknown) => void) | undefined
    window.$memberstackDom = {
      getMemberCookie: vi.fn(async () => memberstackToken),
      onAuthChange(listener) {
        authChange = listener
      },
    }
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      status: 'submitted',
      created_at: 1,
    }))
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-one')
      memberstackToken = 'member-two'
      authChange?.(null)
      return jsonResponse({ items: firstPage, itemsTotal: 101 })
    })
    const api = new TalentAdminApi('Staging', fetcher)

    await expect(api.list()).rejects.toThrow(/session changed/i)

    expect(fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith('/admin/applications/list'),
    )).toHaveLength(1)
  })

  it('rejects a token trade completed after the Memberstack session changes', async () => {
    let authChange: ((member: unknown) => void) | undefined
    let resolveTrade: ((response: Response) => void) | undefined
    const trade = new Promise<Response>((resolve) => {
      resolveTrade = resolve
    })
    window.$memberstackDom = {
      getMemberCookie: vi.fn().mockResolvedValue('member-one'),
      onAuthChange(listener) {
        authChange = listener
      },
    }
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(trade)
    const api = new TalentAdminApi('Staging', fetcher)
    const pending = api.list()

    await vi.waitFor(() => expect(resolveTrade).toBeDefined())
    authChange?.(null)
    resolveTrade?.(jsonResponse('xano-one'))

    await expect(pending).rejects.toThrow(/session changed/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects a completed page when the Memberstack token changed silently', async () => {
    let memberstackToken = 'member-one'
    window.$memberstackDom = {
      getMemberCookie: vi.fn(async () => memberstackToken),
    }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) return jsonResponse('xano-one')
      memberstackToken = 'member-two'
      return jsonResponse({
        items: [{ id: 1, status: 'submitted', created_at: 1 }],
        itemsTotal: 1,
      })
    })
    const api = new TalentAdminApi('Staging', fetcher)

    await expect(api.list()).rejects.toThrow(/session changed/i)
  })
})
