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
})
