import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TalentApplicationsAdmin } from '../src/TalentApplicationsAdmin'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  window.$memberstackDom = { getMemberCookie: vi.fn().mockResolvedValue('member-jwt') }
})

it('reviews an application through an allowed transition', async () => {
  const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Sample Applicant',
          applicant_email: 'sample@example.test',
          status: 'submitted',
          created_at: '2026-07-27T12:00:00Z',
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Sample Applicant',
          applicant_email: 'sample@example.test',
          motivation: 'I enjoy helping growing teams.',
          status: 'submitted',
          created_at: '2026-07-27T12:00:00Z',
        },
        events: [],
      })
    }
    if (url.endsWith('/admin/applications/transition')) {
      return jsonResponse({ id: 12, status: 'under_review' })
    }
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.click(await screen.findByText('Sample Applicant'))
  expect(await screen.findByText('I enjoy helping growing teams.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Under review' }))

  await waitFor(() => {
    const transition = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/admin/applications/transition'),
    )
    expect(transition).toBeTruthy()
    expect(JSON.parse(String(transition?.[1]?.body))).toMatchObject({
      application_id: 12,
      expected_status: 'submitted',
      next_status: 'under_review',
    })
  })
})
