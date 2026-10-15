import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StaffConsole } from '../src/StaffConsole'
import { STAFF_API_BASE, StaffConsoleApi } from '../src/staffApi'
import { TRADE_TOKEN_URL } from '../src/memberXanoClient'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

const card = (over: Record<string, unknown> = {}) => ({
  starter_id: 1142,
  name: 'Full QA Starter',
  email: 'qa@example.test',
  slug: 'full-q',
  hire_url: 'https://www.thestarters.com/hire/full-q',
  photo: null,
  platform_status: 'Live on Platform',
  is_live: true,
  algolia_sync_status: 'synced',
  target_status: 'Removed from Platform',
  target_label: 'Remove from platform',
  preview_action: 'set',
  preview_token: '1792000000000.abc',
  warnings: [],
  last_outcome: null,
  last_error: null,
  recent_changes: [],
  ...over,
})

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockXano(routes: Record<string, Route>) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (url.href.startsWith(TRADE_TOKEN_URL)) return jsonResponse({ authToken: 'xano-token' })
    const path = url.pathname.replace('/api:kR5gpIDB/', '')
    const route = routes[path]
    return route ? route(url, init) : jsonResponse({ message: 'no route' }, 404)
  })
}

const staffRoutes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  'staff/session': () => jsonResponse({ email: 'kaeser@hirethestarters.com', role: 'operator', writes_enabled: true }),
  'staff/starters/search': (url) => jsonResponse({ items: (url.searchParams.get('q') || '').length >= 2 ? [card()] : [] }),
  'staff/starters/detail': () => jsonResponse({ items: [card()] }),
  'staff/starters/platform-status/set': () =>
    jsonResponse({ replayed: false, starter_id: 1142, status_now: 'Removed from Platform', projection_outcome: 'trigger', projection_error: null }),
  ...over,
})

function setup(routes: Record<string, Route>, url = '/staff') {
  window.history.replaceState(null, '', url)
  const fetcher = mockXano(routes)
  const api = new StaffConsoleApi(fetcher)
  render(<StaffConsole api={api} />)
  return fetcher
}

const calls = (fetcher: ReturnType<typeof mockXano>, path: string) =>
  fetcher.mock.calls.filter(([input]) => String(input).includes(`/api:kR5gpIDB/${path}`))

async function openCardAndFill(reason = 'Starter asked to leave the platform') {
  fireEvent.change(screen.getByLabelText('Find a Starter'), { target: { value: 'full' } })
  fireEvent.click(await screen.findByRole('button', { name: /Full QA Starter/ }, { timeout: 3000 }))
  await screen.findByRole('heading', { name: 'Full QA Starter' })
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: reason } })
  fireEvent.click(screen.getByRole('checkbox'))
}

beforeEach(() => {
  window.$memberstackDom = { getMemberCookie: vi.fn().mockResolvedValue('member-jwt') }
})

describe('StaffConsoleApi', () => {
  it('targets the staff group and sends only the Xano Bearer', async () => {
    const fetcher = mockXano(staffRoutes())
    await new StaffConsoleApi(fetcher).session()
    const [url, init] = fetcher.mock.calls[1]
    expect(String(url)).toBe(`${STAFF_API_BASE}/staff/session`)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer xano-token')
    expect(String(url)).not.toContain('member-jwt')
  })

  it('posts the preview token, target status and trimmed reason, never an actor', async () => {
    const fetcher = mockXano(staffRoutes())
    const api = new StaffConsoleApi(fetcher)
    await api.setStatus(card() as never, '  Starter asked to leave  ')
    const body = JSON.parse(String(calls(fetcher, 'staff/starters/platform-status/set')[0][1]?.body))
    expect(body).toEqual({ starter_id: 1142, status: 'Removed from Platform', preview_token: '1792000000000.abc', reason: 'Starter asked to leave' })
  })
})

describe('StaffConsole', () => {
  it('shows a clear no-access message for a non-staff account (403)', async () => {
    setup(staffRoutes({
      'staff/session': () => jsonResponse({ code: 'ERROR_CODE_ACCESS_DENIED', message: 'STAFF_ACCESS_DENIED:domain_not_staff' }, 403),
    }))
    expect(await screen.findByTestId('no-access')).toHaveTextContent(/only for staff emails/)
    expect(screen.queryByLabelText('Find a Starter')).not.toBeInTheDocument()
  })

  it('asks unverified staff to get verified', async () => {
    setup(staffRoutes({
      'staff/session': () => jsonResponse({ message: 'STAFF_ACCESS_DENIED:email_not_verified' }, 403),
    }))
    expect(await screen.findByTestId('no-access')).toHaveTextContent(/not verified/)
  })

  it('shows a login link when there is no Memberstack session', async () => {
    window.$memberstackDom = { getMemberCookie: vi.fn().mockResolvedValue(null) }
    setup(staffRoutes())
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login?next=/staff')
  })

  it('searches, opens the card and removes with one request (double click = one request)', async () => {
    const fetcher = setup(staffRoutes())
    expect(await screen.findByText('kaeser@hirethestarters.com')).toBeInTheDocument()
    await openCardAndFill()
    const button = screen.getByRole('button', { name: 'Remove from platform' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByTestId('last-result')).toHaveTextContent(/Status is now Removed from Platform/)
    expect(calls(fetcher, 'staff/starters/platform-status/set')).toHaveLength(1)
    await waitFor(() => expect(calls(fetcher, 'staff/starters/detail').length).toBeGreaterThanOrEqual(2))
  })

  it('blocks submit until the reason is long enough and the check box is ticked', async () => {
    const fetcher = setup(staffRoutes())
    await screen.findByText('kaeser@hirethestarters.com')
    await openCardAndFill('too short')
    expect(screen.getByRole('button', { name: 'Remove from platform' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Starter asked to leave the platform' } })
    expect(screen.getByRole('button', { name: 'Remove from platform' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Remove from platform' })).toBeDisabled()
    expect(calls(fetcher, 'staff/starters/platform-status/set')).toHaveLength(0)
  })

  it('is read only when Xano reports writes disabled', async () => {
    setup(staffRoutes({
      'staff/session': () => jsonResponse({ email: 'kaeser@hirethestarters.com', role: 'operator', writes_enabled: false }),
    }), '/staff?starter_id=1142')
    expect(await screen.findByTestId('writes-flag')).toHaveTextContent('Changes OFF')
    await screen.findByRole('heading', { name: 'Full QA Starter' })
    expect(screen.getByRole('button', { name: 'Remove from platform' })).toBeDisabled()
    expect(screen.getByLabelText(/Reason/)).toBeDisabled()
  })

  it.each([
    ['PREVIEW_STALE: preview is old or the status changed. Preview again.', 400, /older than 10 minutes/],
    ['STAFF_WRITES_DISABLED: staff writes are turned off. Ask JP.', 403, /Changes are turned off/],
    ['RATE_LIMITED: max 20 status changes per hour', 429, /20 changes/],
    ['REASON_INVALID: reason must be 10 to 500 characters', 400, /10 to 500/],
  ])('explains the server error %s and reloads the card', async (message, status, text) => {
    const fetcher = setup(staffRoutes({
      'staff/starters/platform-status/set': () => jsonResponse({ code: 'ERR', message }, status),
    }))
    await screen.findByText('kaeser@hirethestarters.com')
    await openCardAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from platform' }))
    expect(await screen.findByTestId('submit-error')).toHaveTextContent(text)
    await waitFor(() => expect(calls(fetcher, 'staff/starters/detail').length).toBeGreaterThanOrEqual(2))
  })

  it('shows a projection error and tells staff to escalate', async () => {
    setup(staffRoutes({
      'staff/starters/detail': () => jsonResponse({ items: [card({ last_outcome: 'error', last_error: 'Canonical Client identity or order is invalid' })] }),
    }), '/staff?starter_id=1142')
    expect(await screen.findByTestId('last-error')).toHaveTextContent(/Canonical Client identity.*Send this Starter id to JP/)
  })

  it('shows the removed-Starter apply warning and a restore action', async () => {
    setup(staffRoutes({
      'staff/starters/detail': () => jsonResponse({ items: [card({
        platform_status: 'Removed from Platform', is_live: false, target_status: 'Live on Platform', target_label: 'Restore to platform',
        warnings: [{ text: 'Removed Starters can still apply to opportunities (known gap, endpoint 5693).' }],
      })] }),
    }), '/staff?starter_id=1142')
    expect(await screen.findByText(/known gap, endpoint 5693/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore to platform' })).toBeInTheDocument()
  })

  it('rejects a non-https /hire link', async () => {
    setup(staffRoutes({
      'staff/starters/detail': () => jsonResponse({ items: [card({ hire_url: 'javascript:alert(1)' })] }),
    }), '/staff?starter_id=1142')
    await screen.findByRole('heading', { name: 'Full QA Starter' })
    expect(screen.getByText('No /hire page')).toBeInTheDocument()
  })
})
