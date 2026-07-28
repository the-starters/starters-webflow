import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('keeps the newest filter result when requests resolve out of order', async () => {
  let resolveReview: ((response: Response) => void) | undefined
  let reviewRequested = false
  const reviewResponse = new Promise<Response>((resolve) => {
    resolveReview = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      const status = JSON.parse(String(init?.body)).status
      if (status === 'under_review') {
        reviewRequested = true
        return reviewResponse
      }
      if (status === 'approved') {
        return jsonResponse({
          items: [{
            id: 2,
            applicant_name: 'Newest Result',
            status: 'approved',
            created_at: 1,
          }],
        })
      }
      return jsonResponse({ items: [] })
    }
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  await screen.findByText('No applications match this view.')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'under_review' } })
  await waitFor(() => expect(reviewRequested).toBe(true))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'approved' } })
  expect(await screen.findByText('Newest Result')).toBeInTheDocument()

  await act(async () => {
    resolveReview?.(jsonResponse({
      items: [{
        id: 1,
        applicant_name: 'Stale Result',
        status: 'under_review',
        created_at: 1,
      }],
    }))
    await reviewResponse
  })

  expect(screen.getByText('Newest Result')).toBeInTheDocument()
  expect(screen.queryByText('Stale Result')).not.toBeInTheDocument()
})

it('suppresses stale rows when a new filter is loading or fails', async () => {
  let rejectReview: ((response: Response) => void) | undefined
  const reviewResponse = new Promise<Response>((resolve) => {
    rejectReview = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      const status = JSON.parse(String(init?.body)).status
      if (status === 'under_review') return reviewResponse
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Previous Filter Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  expect(await screen.findByText('Previous Filter Applicant')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'under_review' } })
  expect(screen.queryByText('Previous Filter Applicant')).not.toBeInTheDocument()

  await act(async () => {
    rejectReview?.(jsonResponse({ message: 'Filter unavailable' }, 500))
    await reviewResponse
  })

  expect(await screen.findByText('Dashboard unavailable')).toBeInTheDocument()
  expect(screen.getByText('Filter unavailable')).toBeInTheDocument()
  expect(screen.queryByText('Previous Filter Applicant')).not.toBeInTheDocument()
})

it('reports a synchronization error after a successful transition', async () => {
  let detailCalls = 0
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Sample Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      detailCalls += 1
      if (detailCalls > 1) return jsonResponse({ message: 'Readback failed' }, 500)
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Sample Applicant',
          status: 'submitted',
          created_at: 1,
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
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))

  expect(await screen.findByText(
    'Application updated, but the latest data could not be reloaded. Refresh before continuing.',
  )).toBeInTheDocument()
  expect(screen.queryByText(/Unable to update the application/i)).not.toBeInTheDocument()
})

it('does not show a stale transition readback error on a newly opened application', async () => {
  let detailCalls = 0
  let resolveReadback: ((response: Response) => void) | undefined
  const readbackResponse = new Promise<Response>((resolve) => {
    resolveReadback = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [
          {
            id: 12,
            applicant_name: 'Transitioned Applicant',
            status: 'submitted',
            created_at: 1,
          },
          {
            id: 24,
            applicant_name: 'Current Applicant',
            status: 'submitted',
            created_at: 2,
          },
        ],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      detailCalls += 1
      if (detailCalls === 2) return readbackResponse
      const applicationId = JSON.parse(String(init?.body)).application_id
      return jsonResponse({
        application: {
          id: applicationId,
          applicant_name: applicationId === 12
            ? 'Transitioned Applicant'
            : 'Current Applicant',
          motivation: applicationId === 12
            ? 'Transitioned motivation'
            : 'Current motivation',
          status: 'submitted',
          created_at: applicationId === 12 ? 1 : 2,
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

  fireEvent.click(await screen.findByText('Transitioned Applicant'))
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))
  await waitFor(() => expect(detailCalls).toBe(2))
  fireEvent.click(screen.getByRole('button', { name: 'All applications' }))
  fireEvent.click(await screen.findByText('Current Applicant'))
  expect(await screen.findByText('Current motivation')).toBeInTheDocument()

  await act(async () => {
    resolveReadback?.(jsonResponse({ message: 'Readback failed' }, 500))
    await readbackResponse
  })

  expect(screen.getByText('Current motivation')).toBeInTheDocument()
  expect(screen.queryByText(/latest data could not be reloaded/i)).not.toBeInTheDocument()
})

it('clears private state when transition detail readback loses authorization', async () => {
  let detailCalls = 0
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Private Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      detailCalls += 1
      if (detailCalls > 1) return jsonResponse({ message: 'Unauthorized' }, 401)
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Private Applicant',
          motivation: 'Private motivation',
          review_notes: 'Private internal note',
          status: 'submitted',
          created_at: 1,
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

  fireEvent.click(await screen.findByText('Private Applicant'))
  expect(await screen.findByDisplayValue('Private internal note')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Under review' }))

  expect(await screen.findByText('Admin login required')).toBeInTheDocument()
  expect(screen.queryByText('Private Applicant')).not.toBeInTheDocument()
  expect(screen.queryByText('Private motivation')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('Private internal note')).not.toBeInTheDocument()
})

it('preserves the login prompt when transition queue refresh loses authorization', async () => {
  let sessionCalls = 0
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) {
      sessionCalls += 1
      return sessionCalls === 1
        ? jsonResponse({ role: 'admin' })
        : jsonResponse({ message: 'Forbidden' }, 403)
    }
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Private Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Private Applicant',
          motivation: 'Private motivation',
          review_notes: 'Private internal note',
          status: 'submitted',
          created_at: 1,
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

  fireEvent.click(await screen.findByText('Private Applicant'))
  expect(await screen.findByDisplayValue('Private internal note')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Under review' }))

  expect(await screen.findByText('Admin login required')).toBeInTheDocument()
  expect(screen.getByText('Forbidden')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  expect(screen.queryByText(/latest data could not be reloaded/i)).not.toBeInTheDocument()
  expect(screen.queryByText('Private Applicant')).not.toBeInTheDocument()
})

it('cleans up saving state when a stale transition fails', async () => {
  let resolveTransition: ((response: Response) => void) | undefined
  const transitionResponse = new Promise<Response>((resolve) => {
    resolveTransition = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Sample Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Sample Applicant',
          motivation: 'Private motivation',
          status: 'submitted',
          created_at: 1,
        },
        events: [],
      })
    }
    if (url.endsWith('/admin/applications/transition')) return transitionResponse
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.click(await screen.findByText('Sample Applicant'))
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))
  fireEvent.click(screen.getByRole('button', { name: 'All applications' }))
  fireEvent.click(await screen.findByText('Sample Applicant'))
  expect(await screen.findByText('Private motivation')).toBeInTheDocument()

  await act(async () => {
    resolveTransition?.(jsonResponse({ message: 'Transition failed' }, 500))
    await transitionResponse
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Under review' })).toBeEnabled()
  })
})

it('clears newly opened applicant data when a stale transition loses authorization', async () => {
  let resolveTransition: ((response: Response) => void) | undefined
  const transitionResponse = new Promise<Response>((resolve) => {
    resolveTransition = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Private Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Private Applicant',
          motivation: 'Private motivation',
          review_notes: 'Private internal note',
          status: 'submitted',
          created_at: 1,
        },
        events: [],
      })
    }
    if (url.endsWith('/admin/applications/transition')) return transitionResponse
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.click(await screen.findByText('Private Applicant'))
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))
  fireEvent.click(screen.getByRole('button', { name: 'All applications' }))
  fireEvent.click(await screen.findByText('Private Applicant'))
  expect(await screen.findByDisplayValue('Private internal note')).toBeInTheDocument()

  await act(async () => {
    resolveTransition?.(jsonResponse({ message: 'Forbidden' }, 403))
    await transitionResponse
  })

  expect(await screen.findByText('Admin login required')).toBeInTheDocument()
  expect(screen.queryByText('Private Applicant')).not.toBeInTheDocument()
  expect(screen.queryByText('Private motivation')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('Private internal note')).not.toBeInTheDocument()
})

it('does not refresh a stale filter after a transition completes', async () => {
  let resolveTransition: ((response: Response) => void) | undefined
  const transitionResponse = new Promise<Response>((resolve) => {
    resolveTransition = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      const status = JSON.parse(String(init?.body)).status
      return status === 'approved'
        ? jsonResponse({
            items: [{
              id: 24,
              applicant_name: 'Approved Applicant',
              status: 'approved',
              created_at: 1,
            }],
          })
        : jsonResponse({
            items: [{
              id: 12,
              applicant_name: 'Pending Applicant',
              status: 'submitted',
              created_at: 1,
            }],
          })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Pending Applicant',
          status: 'submitted',
          created_at: 1,
        },
        events: [],
      })
    }
    if (url.endsWith('/admin/applications/transition')) return transitionResponse
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.click(await screen.findByText('Pending Applicant'))
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))
  fireEvent.click(screen.getByRole('button', { name: 'All applications' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'approved' } })
  expect(await screen.findByText('Approved Applicant')).toBeInTheDocument()

  await act(async () => {
    resolveTransition?.(jsonResponse({ id: 12, status: 'under_review' }))
    await transitionResponse
  })

  await waitFor(() => {
    expect(screen.getByText('Approved Applicant')).toBeInTheDocument()
    expect(screen.queryByText('Pending Applicant')).not.toBeInTheDocument()
  })
})

it('keeps a transitioned row when an older active-filter response resolves last', async () => {
  let reviewListCalls = 0
  let resolveStaleReview: ((response: Response) => void) | undefined
  let resolveTransition: ((response: Response) => void) | undefined
  const staleReviewResponse = new Promise<Response>((resolve) => {
    resolveStaleReview = resolve
  })
  const transitionResponse = new Promise<Response>((resolve) => {
    resolveTransition = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      const status = JSON.parse(String(init?.body)).status
      if (status === 'under_review') {
        reviewListCalls += 1
        if (reviewListCalls === 1) return staleReviewResponse
        return jsonResponse({
          items: [{
            id: 12,
            applicant_name: 'Transitioned Applicant',
            status: 'under_review',
            created_at: 1,
          }],
        })
      }
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Transitioned Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Transitioned Applicant',
          status: reviewListCalls > 0 ? 'under_review' : 'submitted',
          created_at: 1,
        },
        events: [],
      })
    }
    if (url.endsWith('/admin/applications/transition')) return transitionResponse
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.click(await screen.findByText('Transitioned Applicant'))
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))
  fireEvent.click(screen.getByRole('button', { name: 'All applications' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'under_review' } })
  await waitFor(() => expect(reviewListCalls).toBe(1))

  await act(async () => {
    resolveTransition?.(jsonResponse({ id: 12, status: 'under_review' }))
    await transitionResponse
  })

  await waitFor(() => {
    expect(reviewListCalls).toBe(2)
    expect(screen.getByText('Transitioned Applicant')).toBeInTheDocument()
  })

  await act(async () => {
    resolveStaleReview?.(jsonResponse({ items: [] }))
    await staleReviewResponse
  })

  expect(screen.getByText('Transitioned Applicant')).toBeInTheDocument()
})

it('removes a transitioned row from the latest active filter', async () => {
  let transitionCommitted = false
  let resolveTransition: ((response: Response) => void) | undefined
  const transitionResponse = new Promise<Response>((resolve) => {
    resolveTransition = resolve
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      const status = JSON.parse(String(init?.body)).status
      return jsonResponse({
        items: !transitionCommitted && (status === 'submitted' || status == null)
          ? [{
              id: 12,
              applicant_name: 'Pending Applicant',
              status: 'submitted',
              created_at: 1,
            }]
          : [],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Pending Applicant',
          status: 'submitted',
          created_at: 1,
        },
        events: [],
      })
    }
    if (url.endsWith('/admin/applications/transition')) return transitionResponse
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'submitted' } })
  fireEvent.click(await screen.findByText('Pending Applicant'))
  fireEvent.click(await screen.findByRole('button', { name: 'Under review' }))
  fireEvent.click(screen.getByRole('button', { name: 'All applications' }))
  expect(await screen.findByText('Pending Applicant')).toBeInTheDocument()

  await act(async () => {
    transitionCommitted = true
    resolveTransition?.(jsonResponse({ id: 12, status: 'under_review' }))
    await transitionResponse
  })

  await waitFor(() => {
    expect(screen.queryByText('Pending Applicant')).not.toBeInTheDocument()
    expect(screen.getByText('No applications match this view.')).toBeInTheDocument()
  })
})

it('clears applicant data immediately when Memberstack authentication changes', async () => {
  let memberstackToken: string | null = 'member-jwt'
  let authChange: ((member: unknown) => void) | undefined
  window.$memberstackDom = {
    getMemberCookie: vi.fn(async () => memberstackToken),
    onAuthChange(listener) {
      authChange = listener
    },
  }
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) return jsonResponse({ role: 'admin' })
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Private Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    if (url.endsWith('/admin/applications/detail')) {
      return jsonResponse({
        application: {
          id: 12,
          applicant_name: 'Private Applicant',
          motivation: 'Private motivation',
          review_notes: 'Private internal note',
          status: 'submitted',
          created_at: 1,
        },
        events: [],
      })
    }
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  fireEvent.click(await screen.findByText('Private Applicant'))
  expect(await screen.findByText('Private motivation')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Private internal note')).toBeInTheDocument()

  memberstackToken = null
  act(() => authChange?.(null))

  expect(screen.queryByText('Private Applicant')).not.toBeInTheDocument()
  expect(screen.queryByText('Private motivation')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('Private internal note')).not.toBeInTheDocument()
  expect(await screen.findByText('Admin login required')).toBeInTheDocument()
})

it('clears applicant data after a definitive authentication failure', async () => {
  let sessionCalls = 0
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/auth/trade-token/v3')) return jsonResponse('xano-token')
    if (url.endsWith('/admin/session')) {
      sessionCalls += 1
      return sessionCalls === 1
        ? jsonResponse({ role: 'admin' })
        : jsonResponse({ message: 'Unauthorized' }, 401)
    }
    if (url.endsWith('/admin/applications/list')) {
      return jsonResponse({
        items: [{
          id: 12,
          applicant_name: 'Private Applicant',
          status: 'submitted',
          created_at: 1,
        }],
      })
    }
    return jsonResponse({}, 404)
  })

  render(<TalentApplicationsAdmin />)

  expect(await screen.findByText('Private Applicant')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

  expect(await screen.findByText('Admin login required')).toBeInTheDocument()
  expect(screen.queryByText('Private Applicant')).not.toBeInTheDocument()
})
