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
    const getMemberCookie = vi.fn()
      .mockResolvedValueOnce('member-one')
      .mockResolvedValueOnce('member-two')
    window.$memberstackDom = { getMemberCookie }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('xano-one'))
      .mockResolvedValueOnce(jsonResponse({ role: 'admin' }))
      .mockResolvedValueOnce(jsonResponse('xano-two'))
      .mockResolvedValueOnce(jsonResponse({ role: 'admin' }))
    const api = new TalentAdminApi('Staging', fetcher)

    await api.session()
    await api.session()

    expect(fetcher.mock.calls[0][0]).toBe(`${TRADE_TOKEN_URL}?token=member-one`)
    expect(fetcher.mock.calls[2][0]).toBe(`${TRADE_TOKEN_URL}?token=member-two`)
    expect(new Headers(fetcher.mock.calls[3][1]?.headers).get('Authorization')).toBe(
      'Bearer xano-two',
    )
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
})
