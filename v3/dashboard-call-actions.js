/**
 * Canonical dashboard call lifecycle actions.
 *
 * Webflow owns the base modal plus the authored decline, cancel, and reschedule
 * reason fields. This module binds those elements, creates only missing
 * supporting reschedule views, and sends environment-safe commands with
 * V3 contracts: decline, cancel, direct pending-request time updates,
 * pending new-time offers, and proposal responses for eligible Free calls,
 * plus the Paid parity P5 (held-call cancel and fee line), P6 (pending Paid
 * edit) and P7 (saved-card Paid reschedule) gates, each mirrored from its
 * server admission rule.
 * Reschedule-decline release
 * prerequisites are owned by README.md, "CS-17 backend release prerequisite".
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

  const canonicalClocks = new WeakMap()
  function monotonicNow() {
    try {
      const value = global.performance && global.performance.now()
      return Number.isFinite(value) && value >= 0 ? value : null
    } catch (_error) { return null }
  }

  function wallNow() {
    const value = Date.now()
    return Number.isFinite(value) ? value : null
  }

  function bindCanonicalClock(rows, requestStarted, requestWallStarted) {
    if (!Array.isArray(rows)) return false
    rows.forEach(function (row) { if (row && typeof row === 'object') canonicalClocks.delete(row) })
    if (rows.length === 0) return true
    const stamp = rows[0] && rows[0].server_now_ms
    const received = monotonicNow()
    const wallReceived = wallNow()
    if (!Number.isSafeInteger(stamp) || stamp <= 0 ||
      !Number.isFinite(requestStarted) || requestStarted < 0 ||
      received == null || received < requestStarted || wallReceived == null ||
      !rows.every(function (row) { return row && row.server_now_ms === stamp })) return false
    const wallStarted = Number.isFinite(requestWallStarted) ? requestWallStarted : wallReceived
    const elapsed = Math.max(received - requestStarted, Math.max(0, wallReceived - wallStarted))
    const clock = {
      stamp,
      started: requestStarted,
      wallStarted,
      lastMonotonic: received,
      lastCanonical: stamp + elapsed,
      valid: true,
    }
    rows.forEach(function (row) { canonicalClocks.set(row, clock) })
    return true
  }

  function canonicalNow(booking) {
    const clock = booking && canonicalClocks.get(booking)
    const current = monotonicNow()
    const wallCurrent = wallNow()
    if (!clock || !clock.valid) return null
    if (current == null || wallCurrent == null || current < clock.lastMonotonic) {
      clock.valid = false
      return null
    }
    clock.lastMonotonic = current
    const elapsed = Math.max(
      current - clock.started,
      Math.max(0, wallCurrent - clock.wallStarted),
    )
    clock.lastCanonical = Math.max(clock.lastCanonical, clock.stamp + elapsed)
    return clock.lastCanonical
  }

  function rescheduleWindowOpen(booking) {
    const reference = canonicalNow(booking)
    const start = Number(booking && (booking.status === 'rescheduled' ? booking.start_old : booking.start))
    return reference != null && Number.isFinite(start) && start - reference > 8 * 3600000
  }

  const KINDS = {
    decline: {
      path: '/booking/decline/v3',
      storagePrefix: 'starters:dashboard-decline:v1:',
      attemptPrefix: 'dashboard-decline',
      reasonField: 'reason',
      reasonAttribute: 'booking-decline-reason',
      responseKey: 'decline',
      successStatus: 'declined',
      firstContent: 'decline',
      reasonContent: 'decline-reason',
      successContent: 'declined',
      failureMessage: 'Canonical booking decline failed',
      busyLabel: 'Declining…',
    },
    cancel: {
      path: '/booking/cancel/v3',
      storagePrefix: 'starters:dashboard-cancel:v1:',
      attemptPrefix: 'dashboard-cancel',
      reasonField: 'cancelled_reason',
      reasonAttribute: 'booking-cancel-reason',
      responseKey: 'cancel',
      successStatus: 'cancelled',
      firstContent: 'cancel',
      reasonContent: 'cancel-reason',
      successContent: 'cancelled',
      failureMessage: 'Canonical booking cancel failed',
      busyLabel: 'Cancelling…',
    },
    'reschedule-propose': {
      path: '/booking/reschedule/propose/v3',
      storagePrefix: 'starters:dashboard-reschedule-propose:v1:',
      attemptPrefix: 'dashboard-reschedule-propose',
      reasonField: 'rescheduled_reason',
      reasonAttribute: 'booking-reschedule-reason',
      responseKey: 'reschedule',
      successStatus: 'rescheduled',
      successContent: 'reschedule-proposed',
      failureMessage: 'Canonical reschedule proposal failed',
    },
    /* A Brand editing the time on its own PENDING request. There is no
       handshake: the Starter has not accepted anything yet, so the booking
       keeps `pending` and the Starter's normal accept then applies to the new
       time. Separate from `reschedule-propose`, which is the confirmed-call
       contract, because the server contracts differ — #5921 refuses a
       confirmed booking and #5756 refuses a pending one. */
    'reschedule-request': {
      path: '/booking/reschedule/request/v3',
      storagePrefix: 'starters:dashboard-reschedule-request:v1:',
      attemptPrefix: 'dashboard-reschedule-request',
      reasonField: 'rescheduled_reason',
      reasonAttribute: 'booking-reschedule-reason',
      responseKey: 'reschedule_request',
      // #5921 replaces the provider booking: its result carries the NEW
      // booking_id and names the sent one as replaced_booking_id.
      replacesBooking: true,
      // The booking is deliberately still pending afterwards; a status change
      // here would mean the handshake contract ran by mistake.
      successStatus: 'pending',
      successContent: 'reschedule-updated',
      failureMessage: 'Canonical reschedule request failed',
    },
    'reschedule-confirm': {
      path: '/booking/reschedule/confirm/v3',
      storagePrefix: 'starters:dashboard-reschedule-confirm:v1:',
      attemptPrefix: 'dashboard-reschedule-confirm',
      reasonField: null,
      responseKey: 'reschedule_confirm',
      successStatus: 'confirmed',
      successContent: 'reschedule-accepted',
      failureMessage: 'Canonical reschedule confirmation failed',
      busyLabel: 'Accepting…',
    },
    'reschedule-decline': {
      path: '/booking/reschedule/decline/v3',
      storagePrefix: 'starters:dashboard-reschedule-decline:v1:',
      attemptPrefix: 'dashboard-reschedule-decline',
      reasonField: null,
      responseKey: 'reschedule_decline',
      // F13 soft launch: published #5760 restores a Free call to its original
      // confirmed time (original_restored true). The P7 #5760 draft restores
      // a saved-card Paid proposal the same way, so `confirmed` stays the
      // success status for both (canRespondReschedule gates who reaches it).
      successStatus: 'confirmed',
      successContent: 'reschedule-declined',
      failureMessage: 'Canonical reschedule response failed',
      busyLabel: 'Keeping current time…',
    },
    /* F08/F10 (JP 2026-10-09/10): a new time offered on a PENDING request.
       The request keeps `pending` at its original slot; the offer lives in
       start_old/end_old with rescheduled_by = proposer (#5756 pending branch).
       First offer: Starter only. Counter: the current responder. */
    'pending-propose': {
      path: '/booking/reschedule/propose/v3',
      storagePrefix: 'starters:dashboard-pending-propose:v1:',
      attemptPrefix: 'dashboard-pending-propose',
      reasonField: 'rescheduled_reason',
      reasonAttribute: 'booking-reschedule-reason',
      responseKey: 'reschedule',
      successStatus: 'pending',
      successContent: 'reschedule-proposed',
      failureMessage: 'The new time could not be proposed',
    },
    /* Accept of an open offer (#5759 pending branch). The server owner is not
       built yet, so the control stays hidden behind F08_ACCEPT_ENABLED. */
    'pending-accept': {
      path: '/booking/reschedule/confirm/v3',
      storagePrefix: 'starters:dashboard-pending-accept:v1:',
      attemptPrefix: 'dashboard-pending-accept',
      reasonField: null,
      responseKey: 'reschedule_confirm',
      // The accept replaces the provider booking (design S2).
      replacesBooking: true,
      successStatus: 'confirmed',
      successContent: 'reschedule-accepted',
      failureMessage: 'The new time could not be confirmed',
      busyLabel: 'Confirming…',
    },
    /* A Brand decline of a Starter offer (#5760 pending branch -> #2126). It
       ends the whole request with the pending policy (no fee). A Starter
       answers a Brand counter with the normal Decline Call (#1547). */
    'pending-decline': {
      path: '/booking/reschedule/decline/v3',
      storagePrefix: 'starters:dashboard-pending-decline:v1:',
      attemptPrefix: 'dashboard-pending-decline',
      reasonField: null,
      responseKey: 'reschedule_decline',
      successStatus: 'cancelled',
      successContent: 'cancelled',
      failureMessage: 'The new time could not be declined',
      busyLabel: 'Declining…',
    },
  }

  const CALENDAR_MODULE_PATH =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/paid-call-brand-payment.js'

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function bookingStatus(booking) {
    return clean(booking && booking.status).toLowerCase()
  }

  function bookingEnvironment(booking) {
    return clean(booking && booking.data_environment).toLowerCase()
  }

  function bookingIdentified(booking) {
    return (
      clean(booking && booking.booking_id) !== '' &&
      clean(booking && booking.config_id) !== '' &&
      ['test', 'production'].includes(bookingEnvironment(booking))
    )
  }

  function actorMemberId(role, booking) {
    const source =
      role === 'starter'
        ? booking && booking.starter_data
        : role === 'brand'
          ? booking && booking.brand_data
          : null
    return clean(source && source.memberstack_id)
  }

  function freeBooking(booking) {
    const value = booking && (
      booking.is_paid != null ? booking.is_paid : booking.paid_meeting
    )
    return value === false || value === 0 || clean(value).toLowerCase() === 'false'
  }

  /**
   * Lenient paid check matching dashboard-calls' paidBooking: a missing flag
   * counts as Free. Decline and Cancel must not disappear on Free rows that
   * never stamped the flag, so they gate on this instead of strict freeBooking.
   */
  function paidFlag(booking) {
    const value = booking && (
      booking.is_paid != null ? booking.is_paid : booking.paid_meeting
    )
    return value === true || value === 1 || clean(value).toLowerCase() === 'true'
  }

  function canDecline(role, booking) {
    return (
      role === 'starter' &&
      bookingStatus(booking) === 'pending' &&
      // A pending Paid request holds only a saved card, so booking/decline/v3
      // (#1547) declines it with no Stripe call (Paid parity P2, 2026-10-03).
      bookingIdentified(booking)
    )
  }

  // Paid parity P4 (2026-10-03): a confirmed saved-card Paid call can cancel
  // only more than 48 h 15 min before start (task #121 authorizes at 48 h).
  // Inside that saved-card window the server refuses; P5 handles reconciled
  // authorized holds below.
  const PAID_CONFIRMED_CANCEL_LEAD_MS = 173700000

  /* Paid parity P6 / P7 server openings. The Xano gates (`$p6_paid_open` /
     `$p7_paid_open`) admit Paid only for `data_environment` values mirrored
     below. Keep each list in lockstep with its server gate; the client must
     never offer a control the server refuses. */
  const PAID_EDIT_OPEN_ENVIRONMENTS = ['test']
  const PAID_RESCHEDULE_OPEN_ENVIRONMENTS = ['test', 'production']
  // P5 (#2099 held-call cancel) opens in production with the #2099 / #263 / #272
  // server publish; keep this list in lockstep with that admission gate.
  const PAID_HOLD_CANCEL_OPEN_ENVIRONMENTS = ['test', 'production']
  /* F08/F10 pending propose/counter/decline opening. Lockstep with the #5756
     `$f08_open` / `$f08_paid_open` gates (Test only). Production is a
     one-line change here after the server switch opens. */
  const PENDING_PROPOSE_OPEN_ENVIRONMENTS = ['test']
  /* The accept owner (#5759 pending branch) is not built yet (it waits on a
     Nylas probe). Keep the accept control hidden until it passes Test. */
  const F08_ACCEPT_ENABLED = false
  let f08AcceptEnabled = F08_ACCEPT_ENABLED

  /** Test-only override of F08_ACCEPT_ENABLED. Returns the previous value. */
  function setF08AcceptEnabledForTest(enabled) {
    const previous = f08AcceptEnabled
    f08AcceptEnabled = enabled === true
    return previous
  }
  // #5756: an offer must start more than 24 h from now (offer_start - 24 h > now).
  const PENDING_PROPOSE_LEAD_MS = 24 * 3600000
  /* The server range is the configuration's available_days_in_future. The
     row does not carry it, so the picker uses the writer default (14) unless
     the row names one; the server stays the authority. */
  const PENDING_PROPOSE_DEFAULT_RANGE_DAYS = 14
  const PENDING_PROPOSE_STEP_MINUTES = 30
  const PENDING_PROPOSE_START_MESSAGE =
    'Choose a new time more than 24 hours from now.'

  // F15 (Kaeser + Jai, 2026-10-06): a Brand cancel at or within 8 h of start is
  // charged the full session fee; every other Paid cancel is released.
  const PAID_LATE_CANCEL_FEE_WINDOW_MS = 8 * 3600000
  const CANCEL_FEE_TEXT = {
    late: 'This call starts within 8 hours. Cancelling now charges the full session fee.',
    none: 'No charge will be made for this cancellation.',
  }
  const PAID_PROPOSED_START_MESSAGE =
    'Choose a new time more than 48 hours and 15 minutes from now.'

  function referenceTime(booking, now) {
    if (now != null && Number.isFinite(Number(now))) return Number(now)
    const canonical = canonicalNow(booking)
    return canonical != null ? canonical : Date.now()
  }

  function actionNow(settings, booking) {
    const source = settings && settings.now
    const value = typeof source === 'function' ? source(booking) : source
    return value != null && Number.isFinite(Number(value)) ? Number(value) : undefined
  }

  /**
   * Paid parity P5: a confirmed Paid call that already holds an authorized
   * PaymentIntent (#269 at 48 h) is cancellable by either participant until
   * start, but only while the hold is reconciled (#2099 P5 admission).
   */
  function paidHoldCancelAdmitted(booking) {
    return (
      paidFlag(booking) &&
      bookingStatus(booking) === 'confirmed' &&
      clean(booking && booking.payment_intent) !== '' &&
      clean(booking && booking.payment_status).toLowerCase() === 'intent_created' &&
      clean(booking && booking.payment_reconciliation_status).toLowerCase() === 'reconciled' &&
      paidEnvironmentOpen(booking, PAID_HOLD_CANCEL_OPEN_ENVIRONMENTS)
    )
  }

  /**
   * The saved-card state P6 and P7 admit (no PaymentIntent yet): empty
   * payment_intent, `waiting_for_intent`, revision 0, reconciliation `ready`.
   * A missing revision fails closed.
   */
  function paidSavedCardState(booking) {
    const revision = booking && booking.payment_revision
    return (
      paidFlag(booking) &&
      clean(booking && booking.payment_intent) === '' &&
      clean(booking && booking.payment_status).toLowerCase() === 'waiting_for_intent' &&
      revision != null &&
      clean(revision) !== '' &&
      Number(revision) === 0 &&
      clean(booking && booking.payment_reconciliation_status).toLowerCase() === 'ready'
    )
  }

  function paidEnvironmentOpen(booking, environments) {
    return environments.indexOf(bookingEnvironment(booking)) !== -1
  }

  /** Paid parity P6: a Brand may restate the time on its own Paid request. */
  function paidPendingEditAdmitted(booking) {
    return (
      bookingStatus(booking) === 'pending' &&
      paidSavedCardState(booking) &&
      paidEnvironmentOpen(booking, PAID_EDIT_OPEN_ENVIRONMENTS)
    )
  }

  /** Paid parity P7: whether a start time is outside the 48 h 15 min lead. */
  function paidProposedStartAllowed(start, reference) {
    const value = Number(start)
    const at = Number(reference)
    return (
      Number.isFinite(value) &&
      reference != null &&
      Number.isFinite(at) &&
      value > at + PAID_CONFIRMED_CANCEL_LEAD_MS
    )
  }

  /** Paid parity P7 (JP 1a): propose on a confirmed saved-card Paid call. */
  function paidRescheduleProposeAdmitted(booking, reference) {
    return (
      bookingStatus(booking) === 'confirmed' &&
      paidSavedCardState(booking) &&
      paidEnvironmentOpen(booking, PAID_RESCHEDULE_OPEN_ENVIRONMENTS) &&
      paidProposedStartAllowed(booking && booking.start, reference)
    )
  }

  /**
   * Paid parity P7 (JP 2a): the last instant the counterpart can accept an
   * open Paid proposal, min(original start, proposed start) - 48 h 15 min.
   * At or after it the lapse owner restores the original call. NaN when the
   * row is not an open proposal with both times.
   */
  function paidRescheduleLastAcceptTime(booking) {
    const original = Number(booking && booking.start_old)
    const proposed = Number(booking && booking.start)
    if (
      bookingStatus(booking) !== 'rescheduled' ||
      !Number.isFinite(original) || original <= 0 ||
      !Number.isFinite(proposed) || proposed <= 0
    ) return Number.NaN
    return Math.min(original, proposed) - PAID_CONFIRMED_CANCEL_LEAD_MS
  }

  /** Paid parity P7: the counterpart may answer before the last accept time. */
  function paidRescheduleRespondAdmitted(booking, reference) {
    const last = paidRescheduleLastAcceptTime(booking)
    const at = Number(reference)
    return (
      paidSavedCardState(booking) &&
      paidEnvironmentOpen(booking, PAID_RESCHEDULE_OPEN_ENVIRONMENTS) &&
      Number.isFinite(last) &&
      reference != null &&
      Number.isFinite(at) &&
      at < last
    )
  }

  /**
   * The open Paid proposal's lapse time for the dashboard note, or NaN when
   * the row is not an open Paid proposal in an opened environment.
   */
  function paidProposalLapseTime(booking) {
    if (
      !paidFlag(booking) ||
      !paidEnvironmentOpen(booking, PAID_RESCHEDULE_OPEN_ENVIRONMENTS)
    ) return Number.NaN
    return paidRescheduleLastAcceptTime(booking)
  }

  function timestampMs(value) {
    const time = Number(value)
    if (!Number.isFinite(time) || time === 0) return time
    return Math.abs(time) < 1e12 ? time * 1000 : time
  }

  /**
   * F08: whether a PENDING request carries an open new-time offer
   * (status pending, start_old > 0, end_old after start_old).
   * @param {object|null} booking Canonical booking row.
   * @returns {boolean}
   */
  function pendingOfferOpen(booking) {
    const start = timestampMs(booking && booking.start_old)
    const end = timestampMs(booking && booking.end_old)
    return (
      bookingStatus(booking) === 'pending' &&
      Number.isFinite(start) && start > 0 &&
      Number.isFinite(end) && end > start
    )
  }

  /** The proposer of the open offer ('starter' | 'brand'), or ''. */
  function pendingOfferProposer(booking) {
    if (!pendingOfferOpen(booking)) return ''
    const proposer = clean(booking && booking.rescheduled_by).toLowerCase()
    return proposer === 'starter' || proposer === 'brand' ? proposer : ''
  }

  function pendingDeadlineOpen(booking, reference) {
    const deadline = timestampMs(booking && booking.confirmation_expires_at)
    return (
      reference != null && Number.isFinite(Number(reference)) &&
      Number.isFinite(deadline) && deadline > Number(reference)
    )
  }

  /** Shared F08 admission: environment switch, identity, Free or saved-card Paid. */
  function pendingNegotiationAdmitted(role, booking) {
    return (
      (role === 'starter' || role === 'brand') &&
      bookingStatus(booking) === 'pending' &&
      paidEnvironmentOpen(booking, PENDING_PROPOSE_OPEN_ENVIRONMENTS) &&
      (freeBooking(booking) || paidSavedCardState(booking)) &&
      actorMemberId(role, booking) !== '' &&
      bookingIdentified(booking)
    )
  }

  /**
   * F08/F10: whether `role` may propose (first offer, Starter only) or
   * counter (responder only, no round limit) a new time on a pending request.
   * Mirrors the #5756 pending-branch admission.
   */
  function canProposePending(role, booking, now) {
    const duration = Number(booking && booking.duration)
    if (!pendingNegotiationAdmitted(role, booking)) return false
    if (clean(booking && booking.grant_id) === '' || !Number.isFinite(duration) || duration <= 0) return false
    if (!pendingDeadlineOpen(booking, referenceTime(booking, now))) return false
    if (pendingOfferOpen(booking)) {
      const proposer = pendingOfferProposer(booking)
      return proposer !== '' && proposer !== role
    }
    return role === 'starter'
  }

  /** F08: whether `role` is the responder of an open offer with time left. */
  function canRespondPending(role, booking, now) {
    const proposer = pendingOfferProposer(booking)
    return (
      pendingNegotiationAdmitted(role, booking) &&
      proposer !== '' &&
      proposer !== role &&
      pendingDeadlineOpen(booking, referenceTime(booking, now))
    )
  }

  /** F08: Accept of an open offer. Hidden while F08_ACCEPT_ENABLED is false. */
  function canAcceptPendingOffer(role, booking, now) {
    const offerStart = timestampMs(booking && booking.start_old)
    return (
      f08AcceptEnabled &&
      canRespondPending(role, booking, now) &&
      offerStart > referenceTime(booking, now)
    )
  }

  /**
   * F08: the Brand declines a Starter offer through #5760 (pending branch).
   * A Starter answers a Brand counter with the normal Decline Call (#1547).
   */
  function canDeclinePendingOffer(role, booking, now) {
    return role === 'brand' &&
      pendingOfferProposer(booking) === 'starter' &&
      canRespondPending(role, booking, now)
  }

  /** F08: whether a proposed start meets the #5756 lead and range rules. */
  function pendingProposedStartAllowed(booking, start, reference) {
    const value = Number(start)
    const at = Number(reference)
    if (!Number.isFinite(value) || reference == null || !Number.isFinite(at)) return false
    return value - PENDING_PROPOSE_LEAD_MS > at &&
      value <= at + pendingProposeRangeDays(booking) * 86400000
  }

  function pendingProposeRangeDays(booking) {
    const named = Number(booking && (booking.available_days_in_future != null
      ? booking.available_days_in_future
      : booking.days_in_future))
    return Number.isFinite(named) && named > 0 ? named : PENDING_PROPOSE_DEFAULT_RANGE_DAYS
  }

  /**
   * F08: candidate slots for the pending picker. Posted availability does not
   * narrow a pending offer (#5756 checks only Starter free/busy), so every
   * step-aligned start with the call duration is offered from now + 24 h up
   * to the booking range. The current requested time and the open offer are
   * left out because the server refuses them. The server is the authority for
   * free/busy and shows its own message for a busy slot.
   * @param {object} booking Canonical booking row.
   * @param {number} [now] Reference time in ms.
   * @param {object} [options] `{ stepMinutes, rangeDays }` overrides.
   * @returns {{start:number,end:number}[]}
   */
  function pendingProposeSlots(booking, now, options) {
    const settings = options || {}
    const reference = Number(referenceTime(booking, now))
    const durationMs = Number(booking && booking.duration) * 60000
    const step = Number(settings.stepMinutes) > 0
      ? Number(settings.stepMinutes) * 60000
      : PENDING_PROPOSE_STEP_MINUTES * 60000
    const days = Number(settings.rangeDays) > 0
      ? Number(settings.rangeDays)
      : pendingProposeRangeDays(booking)
    if (!Number.isFinite(reference) || !Number.isFinite(durationMs) || durationMs <= 0) return []
    const excluded = [
      timestampMs(booking && booking.start),
      timestampMs(booking && booking.start_old),
    ]
    const last = reference + days * 86400000
    const slots = []
    let start = Math.floor((reference + PENDING_PROPOSE_LEAD_MS) / step) * step + step
    for (; start <= last; start += step) {
      if (excluded.indexOf(start) !== -1) continue
      slots.push({ start, end: start + durationMs })
    }
    return slots
  }

  /** Authored label of each relabelled control, so a later booking restores it. */
  const authoredActionLabels = new WeakMap()
  const PENDING_OFFER_RESPONSE_ATTR = 'data-starters-pending-offer-response'

  function readActionLabel(control) {
    const node = typeof control.querySelector === 'function'
      ? control.querySelector(ACTION_LABEL_SELECTOR)
      : null
    return clean((node || control).textContent)
  }

  function relabelControl(control, label) {
    if (!authoredActionLabels.has(control)) {
      authoredActionLabels.set(control, readActionLabel(control))
    }
    setAuthoredActionLabel(control, label || authoredActionLabels.get(control))
  }

  /**
   * F08: the label of an authored control for a pending offer, or '' to keep
   * the authored label. One authored control serves each F08 action:
   * `reschedule` -> Propose New Time / Propose Another Time (counter),
   * `confirm-reschedule` -> Confirm New Time, `reschedule-decline` ->
   * Decline New Time (Brand only).
   */
  function pendingOfferControlLabel(action, role, booking, now) {
    if (action === 'reschedule' && rescheduleKindFor(role, booking, now) === 'pending-propose') {
      return pendingOfferOpen(booking) ? 'Propose Another Time' : 'Propose New Time'
    }
    if (action === 'confirm-reschedule' && canAcceptPendingOffer(role, booking, now)) {
      return 'Confirm New Time'
    }
    if (action === 'reschedule-decline' && canDeclinePendingOffer(role, booking, now)) {
      return 'Decline New Time'
    }
    return ''
  }

  /**
   * F08: relabels the authored base controls for the booking in the modal,
   * and marks the Brand's pending Decline so the retired Keep-Current-Time
   * guard does not hide it. Restores the authored labels otherwise.
   * @returns {number} How many controls carry an F08 label.
   */
  function applyPendingOfferControls(modal, role, booking, now) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return 0
    let applied = 0
    ;['reschedule', 'confirm-reschedule', 'reschedule-decline'].forEach(function (action) {
      const controls = modal.querySelectorAll(
        '[booking-action-btn="' + action + '"], [booking-card-action-btn="' + action + '"]',
      )
      const label = pendingOfferControlLabel(action, role, booking, now)
      Array.prototype.forEach.call(controls, function (control) {
        if (label || authoredActionLabels.has(control)) relabelControl(control, label)
        if (action === 'reschedule-decline' && typeof control.setAttribute === 'function') {
          if (label) {
            control.setAttribute(PENDING_OFFER_RESPONSE_ATTR, '')
            control.removeAttribute('aria-hidden')
          } else if (typeof control.removeAttribute === 'function') {
            control.removeAttribute(PENDING_OFFER_RESPONSE_ATTR)
          }
        }
        if (label) applied += 1
      })
    })
    return applied
  }

  /**
   * The one fee line of the cancel confirmation. Free returns '' (unchanged).
   * A Brand cancelling a confirmed Paid call at or within 8 h of start pays
   * the full fee; every other Paid cancellation is free of charge.
   */
  function cancelFeeText(role, booking, now) {
    if (!paidFlag(booking)) return ''
    const start = Number(booking && booking.start)
    const reference = referenceTime(booking, now)
    if (
      role === 'brand' &&
      bookingStatus(booking) === 'confirmed' &&
      Number.isFinite(start) &&
      start - reference <= PAID_LATE_CANCEL_FEE_WINDOW_MS
    ) return CANCEL_FEE_TEXT.late
    return CANCEL_FEE_TEXT.none
  }

  function canCancel(role, booking, now) {
    const start = Number(booking && booking.start)
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    const status = bookingStatus(booking)
    const paid = paidFlag(booking)
    return (
      (role === 'starter' || role === 'brand') &&
      // A Brand may withdraw its own pending request: #1545 routes pending
      // state to the Brand-only #2126 owner, which admits a Paid request that
      // holds only a saved card (P1). A Starter declines instead.
      ((!paid && ['confirmed', 'rescheduled'].includes(status)) ||
        (paid &&
          status === 'confirmed' &&
          Number.isFinite(start) &&
          start > reference + PAID_CONFIRMED_CANCEL_LEAD_MS) ||
        // P5: inside that window only a reconciled authorized hold is
        // cancellable, by either participant, until start (checked below).
        (paid && paidHoldCancelAdmitted(booking)) ||
        (role === 'brand' && status === 'pending')) &&
      actorMemberId(role, booking) !== '' &&
      Number.isFinite(start) &&
      start > reference &&
      bookingIdentified(booking)
    )
  }

  function canProposeReschedule(role, booking, now) {
    const start = Number(booking && booking.start)
    const duration = Number(booking && booking.duration)
    return (
      (role === 'starter' || role === 'brand') &&
      (freeBooking(booking) ||
        paidRescheduleProposeAdmitted(booking, canonicalNow(booking))) &&
      bookingStatus(booking) === 'confirmed' &&
      actorMemberId(role, booking) !== '' &&
      clean(booking && booking.grant_id) !== '' &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(start) &&
      rescheduleWindowOpen(booking) &&
      bookingIdentified(booking)
    )
  }

  /**
   * Whether the signed-in member may restate the time on a PENDING request.
   * Brand only, by product decision: it is the Brand's own request and the
   * Starter has not answered it yet. Otherwise the same shape as
   * canProposeReschedule, because #5921 reuses #5756's guards.
   */
  function canRequestReschedule(role, booking, now) {
    const start = Number(booking && booking.start)
    const duration = Number(booking && booking.duration)
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    return (
      role === 'brand' &&
      (freeBooking(booking) || paidPendingEditAdmitted(booking)) &&
      bookingStatus(booking) === 'pending' &&
      // F08: #5921 refuses an edit while a new-time offer is open.
      !pendingOfferOpen(booking) &&
      actorMemberId(role, booking) !== '' &&
      clean(booking && booking.grant_id) !== '' &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(start) &&
      start > reference &&
      bookingIdentified(booking)
    )
  }

  /**
   * Which reschedule contract this booking takes, or '' when neither applies.
   * One authored Reschedule button serves both, so the kind is resolved from
   * the booking at click time rather than from the markup.
   */
  function rescheduleKindFor(role, booking, now) {
    if (canProposeReschedule(role, booking, now)) return 'reschedule-propose'
    if (canProposePending(role, booking, now)) return 'pending-propose'
    if (canRequestReschedule(role, booking, now)) return 'reschedule-request'
    return ''
  }

  /**
   * F08: which response contract an authored respond control takes. On a
   * pending request with an open offer, `confirm-reschedule` is the pending
   * accept and `reschedule-decline` is the pending decline.
   */
  function respondKindFor(kind, booking) {
    if (!pendingOfferOpen(booking)) return kind
    if (kind === 'reschedule-confirm') return 'pending-accept'
    if (kind === 'reschedule-decline') return 'pending-decline'
    return kind
  }

  function canRespondReschedule(role, booking) {
    const proposer = clean(booking && booking.rescheduled_by).toLowerCase()
    return (
      (role === 'starter' || role === 'brand') &&
      (freeBooking(booking) ||
        paidRescheduleRespondAdmitted(booking, canonicalNow(booking))) &&
      bookingStatus(booking) === 'rescheduled' &&
      ['starter', 'brand'].includes(proposer) &&
      proposer !== role &&
      actorMemberId(role, booking) !== '' &&
      bookingIdentified(booking)
    )
  }

  /* "Keep Current Time" (the proposal-decline response, #5760) is retired
     from the dashboard by JP decision 2a on 2026-10-03 (Jai list #12). Only
     the button goes: the server rule stays, so a declined proposal still keeps
     the original confirmed call (F13 / F48 1a). The counterpart's remaining
     exits are Accept New Time, Cancel, or no answer, which task #335 expires at
     the proposed start. Flip this default to restore the button; the test
     hook below only exists so the retained decline path keeps its coverage. */
  const KEEP_CURRENT_TIME_DEFAULT = false
  let keepCurrentTimeEnabled = KEEP_CURRENT_TIME_DEFAULT
  const KEEP_CURRENT_TIME_SELECTOR =
    '[booking-action-btn="reschedule-decline"], [booking-card-action-btn="reschedule-decline"]'
  const KEEP_CURRENT_TIME_GUARD_ATTR = 'data-starters-keep-current-time-guard'

  function canKeepCurrentTime(role, booking) {
    return keepCurrentTimeEnabled && canRespondReschedule(role, booking)
  }

  /** Test-only override. Returns the previous value so callers can restore it. */
  function setKeepCurrentTimeEnabledForTest(enabled) {
    const previous = keepCurrentTimeEnabled
    keepCurrentTimeEnabled = enabled === true
    return previous
  }

  /**
   * Hides every authored "Keep Current Time" control while the button is
   * retired. The Webflow markup still carries the control, so the library
   * owns the hide: one `!important` style rule (wins over any inline
   * show/hide toggle from an older dashboard-calls.js) plus `hidden` on each
   * control present now. Idempotent; returns how many controls were hidden.
   * @param {Document} document Page document.
   * @param {ParentNode} [root] Scope to search; defaults to the document.
   * @returns {number}
   */
  function hideKeepCurrentTime(document, root) {
    if (keepCurrentTimeEnabled || !document) return 0
    if (
      typeof document.querySelector === 'function' &&
      typeof document.createElement === 'function' &&
      !document.querySelector('style[' + KEEP_CURRENT_TIME_GUARD_ATTR + ']')
    ) {
      const style = document.createElement('style')
      style.setAttribute(KEEP_CURRENT_TIME_GUARD_ATTR, '')
      style.textContent =
        '[booking-action-btn="reschedule-decline"]:not([' + PENDING_OFFER_RESPONSE_ATTR + ']),' +
        '[booking-card-action-btn="reschedule-decline"]:not([' + PENDING_OFFER_RESPONSE_ATTR + ']){display:none!important}'
      const host = document.head || document.documentElement
      if (host && typeof host.appendChild === 'function') host.appendChild(style)
    }
    const scope = root || document
    if (!scope || typeof scope.querySelectorAll !== 'function') return 0
    let count = 0
    Array.prototype.forEach.call(scope.querySelectorAll(KEEP_CURRENT_TIME_SELECTOR), function (control) {
      // F08: the Brand's pending Decline reuses this authored control.
      if (typeof control.hasAttribute === 'function' && control.hasAttribute(PENDING_OFFER_RESPONSE_ATTR)) return
      control.hidden = true
      if (control.style) control.style.display = 'none'
      if (typeof control.setAttribute === 'function') control.setAttribute('aria-hidden', 'true')
      count += 1
    })
    return count
  }

  function canConfirmReschedule(role, booking) {
    const reference = canonicalNow(booking)
    return canRespondReschedule(role, booking) && rescheduleWindowOpen(booking) &&
      reference != null && Number(booking.start) > reference
  }

  function canAct(kind, role, booking, now) {
    if (kind === 'decline') return canDecline(role, booking)
    if (kind === 'cancel') return canCancel(role, booking, now)
    if (kind === 'reschedule-propose') return canProposeReschedule(role, booking, now)
    if (kind === 'reschedule-request') return canRequestReschedule(role, booking, now)
    if (kind === 'reschedule-confirm') return canConfirmReschedule(role, booking)
    if (kind === 'reschedule-decline') return canKeepCurrentTime(role, booking)
    if (kind === 'pending-propose') return canProposePending(role, booking, now)
    if (kind === 'pending-accept') return canAcceptPendingOffer(role, booking, now)
    if (kind === 'pending-decline') return canDeclinePendingOffer(role, booking, now)
    return false
  }

  async function stableScopeHash(value) {
    const input = clean(value)
    const crypto = global.crypto
    const TextEncoder = global.TextEncoder
    if (
      !input ||
      !crypto ||
      !crypto.subtle ||
      typeof crypto.subtle.digest !== 'function' ||
      typeof TextEncoder !== 'function'
    ) return ''
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input),
      )
      return Array.from(new Uint8Array(digest), function (byte) {
        return byte.toString(16).padStart(2, '0')
      }).join('')
    } catch (_error) {
      return ''
    }
  }

  async function actionStorageKey(kind, booking, reason, role) {
    const config = KINDS[kind]
    const bookingId = clean(booking && booking.booking_id)
    const actorId = actorMemberId(role, booking)
    const environment = bookingEnvironment(booking)
    const actorScope = await stableScopeHash(actorId)
    const reasonScope = await stableScopeHash(reason)
    if (
      !config ||
      !bookingId ||
      !actorScope ||
      !reasonScope ||
      !['test', 'production'].includes(environment)
    ) return ''
    return (
      config.storagePrefix +
      environment +
      ':' +
      actorScope +
      ':' +
      bookingId +
      ':' +
      reasonScope
    )
  }

  function declineStorageKey(booking, reason) {
    return actionStorageKey('decline', booking, reason, 'starter')
  }

  function cancelStorageKey(booking, reason, role) {
    return actionStorageKey('cancel', booking, reason, role)
  }

  function kindAttemptKeyPattern(kind) {
    const config = KINDS[kind]
    if (!config) return null
    return new RegExp(
      '^' +
      config.attemptPrefix +
      ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      'i',
    )
  }

  function validKindAttemptKey(kind, value) {
    const pattern = kindAttemptKeyPattern(kind)
    return Boolean(pattern && pattern.test(clean(value)))
  }

  function validAttemptKey(value) {
    return validKindAttemptKey('decline', value)
  }

  async function actionAttemptKey(kind, booking, reason, role) {
    const config = KINDS[kind]
    const storageKey = await actionStorageKey(kind, booking, reason, role)
    const storage = global.sessionStorage
    if (
      !config ||
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function'
    ) return ''
    try {
      const existing = clean(storage.getItem(storageKey))
      if (validKindAttemptKey(kind, existing)) return existing
      if (existing && typeof storage.removeItem === 'function') {
        storage.removeItem(storageKey)
      }
      const randomUUID = global.crypto && global.crypto.randomUUID
      if (typeof randomUUID !== 'function') return ''
      const created = config.attemptPrefix + ':' + randomUUID.call(global.crypto)
      if (!validKindAttemptKey(kind, created)) return ''
      storage.setItem(storageKey, created)
      return clean(storage.getItem(storageKey)) === created ? created : ''
    } catch (_error) {
      return ''
    }
  }

  function declineAttemptKey(booking, reason) {
    return actionAttemptKey('decline', booking, reason, 'starter')
  }

  function cancelAttemptKey(booking, reason, role) {
    return actionAttemptKey('cancel', booking, reason, role)
  }

  async function clearActionAttemptKey(kind, booking, reason, role, value) {
    const storageKey = await actionStorageKey(kind, booking, reason, role)
    const storage = global.sessionStorage
    if (
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) return
    try {
      if (clean(storage.getItem(storageKey)) === clean(value)) {
        storage.removeItem(storageKey)
      }
    } catch (_error) {}
  }

  function clearDeclineAttemptKey(booking, reason, value) {
    return clearActionAttemptKey('decline', booking, reason, 'starter', value)
  }

  function clearCancelAttemptKey(booking, reason, role, value) {
    return clearActionAttemptKey('cancel', booking, reason, role, value)
  }

  function actionPayload(kind, role, booking, reason, idempotencyKey, now, extra) {
    const config = KINDS[kind]
    if (!config || !canAct(kind, role, booking, now)) return null
    const payload = {
      booking_id: clean(booking && booking.booking_id),
      config_id: clean(booking && booking.config_id),
      idempotency_key: clean(idempotencyKey),
    }
    if (config.reasonField) {
      payload[config.reasonField] = clean(reason)
      if (!payload[config.reasonField]) return null
    }
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (key) {
        payload[key] = extra[key]
      })
    }
    if (!validKindAttemptKey(kind, payload.idempotency_key)) return null
    return payload
  }

  function declinePayload(booking, reason, idempotencyKey) {
    return actionPayload('decline', 'starter', booking, reason, idempotencyKey)
  }

  function cancelPayload(booking, reason, idempotencyKey, role, now) {
    return actionPayload('cancel', role, booking, reason, idempotencyKey, now)
  }

  function actionSucceeded(kind, body, bookingId) {
    const config = KINDS[kind]
    const result = config && body && body[config.responseKey]
    const sent = clean(bookingId)
    // A replacing contract answers with the new id and names the sent one as
    // replaced; that new id must be present for the caller to adopt it.
    const replaced = Boolean(
      config &&
      config.replacesBooking &&
      result &&
      clean(result.replaced_booking_id) === sent &&
      clean(result.booking_id) !== ''
    )
    return Boolean(
      config &&
      result &&
      sent !== '' &&
      (clean(result.booking_id) === sent || replaced) &&
      clean(result.status).toLowerCase() === config.successStatus
    )
  }

  /**
   * The booking id a successful replacing command left in place of `booking`,
   * or '' when the booking kept its id.
   * @param {string} kind Action kind that succeeded.
   * @param {object|null} body Validated command response.
   * @param {object|null} booking Booking the command was sent for.
   * @returns {string} Replacement booking id, or ''.
   */
  function replacementBookingId(kind, body, booking) {
    const config = KINDS[kind]
    const result = config && config.replacesBooking && body && body[config.responseKey]
    const sent = clean(booking && booking.booking_id)
    const next = clean(result && result.booking_id)
    return result && sent !== '' && next !== '' && next !== sent &&
      clean(result.replaced_booking_id) === sent
      ? next
      : ''
  }

  /**
   * Moves the local booking and every element keyed by its old id to the
   * replacement id, so the open modal and the list card keep resolving the
   * same row until the next canonical read.
   * @param {Document|null} document Page document.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {object} booking Canonical row to update in place.
   * @param {string} nextId Replacement booking id.
   * @returns {boolean} Whether the booking id changed.
   */
  function adoptReplacementBooking(document, modal, booking, nextId) {
    const previous = clean(booking && booking.booking_id)
    const next = clean(nextId)
    if (!booking || !previous || !next || previous === next) return false
    booking.booking_id = next
    const carriers = document && typeof document.querySelectorAll === 'function'
      ? Array.prototype.slice.call(document.querySelectorAll('[data-booking-id]'))
      : []
    if (modal && carriers.indexOf(modal) === -1) carriers.push(modal)
    carriers.forEach(function (carrier) {
      if (
        carrier &&
        typeof carrier.getAttribute === 'function' &&
        typeof carrier.setAttribute === 'function' &&
        clean(carrier.getAttribute('data-booking-id')) === previous
      ) carrier.setAttribute('data-booking-id', next)
    })
    return true
  }

  function declineSucceeded(body, bookingId) {
    return actionSucceeded('decline', body, bookingId)
  }

  function cancelSucceeded(body, bookingId) {
    return actionSucceeded('cancel', body, bookingId)
  }

  async function submitAction(kind, role, booking, reason, now, extra, scope) {
    const config = KINDS[kind]
    if (
      !config ||
      !canAct(kind, role, booking, now) ||
      typeof global.xanoAuthFetch !== 'function'
    ) return null
    const attemptScope = clean(scope) || clean(reason)
    const attemptKey = await actionAttemptKey(kind, booking, attemptScope, role)
    const payload = actionPayload(kind, role, booking, reason, attemptKey, now, extra)
    if (!payload) return null
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + config.path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !actionSucceeded(kind, body, payload.booking_id)) {
      // Prefer the server's own message (for example the paid-cancel gate in
      // booking/cancel/v3) so the modal can explain the refusal to the user.
      const serverMessage = clean(body && (body.message || body.error))
      throw new Error(serverMessage || config.failureMessage)
    }
    await clearActionAttemptKey(kind, booking, attemptScope, role, attemptKey)
    return body
  }

  function proposeReschedule(booking, role, reason, slot, now, kind) {
    const start = Number(slot && slot.start)
    const end = Number(slot && slot.end)
    const timezone = clean(slot && slot.timezone)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return Promise.resolve(null)
    }
    // Confirmed calls take the propose-then-confirm contract; a pending
    // request takes the direct update. Resolved from the booking when the
    // caller does not name one, so the single authored button serves both.
    const resolved = clean(kind) || rescheduleKindFor(role, booking, now)
    if (
      resolved !== 'reschedule-propose' &&
      resolved !== 'reschedule-request' &&
      resolved !== 'pending-propose'
    ) {
      return Promise.resolve(null)
    }
    // F08: a pending offer must start more than 24 h ahead and inside the
    // booking range; #5756 refuses it otherwise, so it is never sent.
    if (
      resolved === 'pending-propose' &&
      !pendingProposedStartAllowed(booking, start, referenceTime(booking, now))
    ) return Promise.resolve(null)
    // P7: a Paid proposal must also start outside the 48 h 15 min lead; the
    // server (#5756) refuses it otherwise, so it is never sent.
    if (
      resolved === 'reschedule-propose' &&
      paidFlag(booking) &&
      !paidProposedStartAllowed(start, referenceTime(booking, now))
    ) return Promise.resolve(null)
    const proposedSlot = { new_start: start, new_end: end }
    if (timezone) proposedSlot.timezone = timezone
    return submitAction(
      resolved,
      role,
      booking,
      reason,
      now,
      proposedSlot,
      clean(reason) + '|' + String(start) + '|' + timezone,
    )
  }

  function respondReschedule(kind, booking, role, now) {
    if (
      kind !== 'reschedule-confirm' && kind !== 'reschedule-decline' &&
      kind !== 'pending-accept' && kind !== 'pending-decline'
    ) {
      return Promise.resolve(null)
    }
    return submitAction(kind, role, booking, '', now, null, 'respond')
  }

  function declineBooking(booking, reason) {
    return submitAction('decline', 'starter', booking, reason)
  }

  function cancelBooking(booking, reason, role, now) {
    return submitAction('cancel', role, booking, reason, now)
  }

  function counterpartName(role, booking) {
    const source =
      role === 'starter'
        ? booking && booking.brand_data
        : booking && booking.starter_data
    return clean(source && source.name) || 'the other participant'
  }

  const counterpartPlaceholderTemplates = new WeakMap()

  function fillCounterpartPlaceholders(modal, panelName, role, booking) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return 0
    const name = counterpartName(role, booking)
    let replaced = 0
    modal
      .querySelectorAll('[booking-popup-content="' + panelName + '"]')
      .forEach(function (panel) {
        function render(node) {
          if (!node) return
          if (node.nodeType === 3) {
            const current = String(node.nodeValue == null ? '' : node.nodeValue)
            const template = counterpartPlaceholderTemplates.get(node) || current
            const hasSharedPlaceholder =
              template.indexOf('[Starter]') !== -1 || template.indexOf('[Brand]') !== -1
            const hasFreeBrandPlaceholder = template.indexOf('[brand]') !== -1
            if (!hasSharedPlaceholder && !hasFreeBrandPlaceholder) return
            counterpartPlaceholderTemplates.set(node, template)
            const paid = paidFlag(booking)
            node.nodeValue = template
              .split('[Starter]')
              .join(name)
              .split('[Brand]')
              .join(name)
            if (!paid) {
              node.nodeValue = node.nodeValue.split('[brand]').join(name)
            }
            if (hasSharedPlaceholder || (hasFreeBrandPlaceholder && !paid)) {
              replaced += 1
            }
            return
          }
          Array.prototype.forEach.call(node.childNodes || [], render)
        }
        render(panel)
      })
    return replaced
  }

  function switchPopupContent(modal, target) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return false
    let found = false
    const contents = Array.prototype.slice.call(modal.querySelectorAll('[booking-popup-content]'))
    // Some authored pages also label the legacy proposal-confirmation panel
    // as "cancel". Prefer the panel that owns the cancellation controls so
    // opening cancellation cannot reveal that unrelated confirmation form.
    const cancellationPanel = target === 'cancel' && contents.find(function (content) {
      return content.getAttribute('booking-popup-content') === 'cancel' &&
        typeof content.querySelector === 'function' &&
        content.querySelector(
          '[booking-action-btn="switch-cancel-reason"], [booking-card-action-btn="switch-cancel-reason"], ' +
          '[booking-action-btn="cancel"], [booking-card-action-btn="cancel"]',
        )
    })
    contents.forEach(function (content) {
      const active = content.getAttribute('booking-popup-content') === target &&
        (!cancellationPanel || content === cancellationPanel)
      content.hidden = !active
      content.style.display = active ? 'flex' : 'none'
      if (active) {
        found = true
        if (target === 'decline') {
          content.querySelectorAll(
            '[booking-action-btn="switch-decline-reason"], [booking-card-action-btn="switch-decline-reason"]',
          ).forEach(function (control) {
            setAuthoredActionLabel(control, 'Decline Call')
          })
        }
      }
    })
    // The authored back control returns to the base panel, so it is only
    // meaningful away from it. Hiding it there removes the doubled close icon
    // Kaeser reported on the Brand dialog.
    const backSelector =
      '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]'
    // The Brand header's [close-to-base] X is a second way back. A step panel
    // that authors its own Back, or a receipt that authors its own Close,
    // keeps only that control, so the header no longer shows a second X
    // beside the dialog close. A panel with neither (payment-methods) keeps
    // the header X as its only way back.
    const ownExitSelector = backSelector +
      ', [booking-action-btn="switch-close"], [booking-card-action-btn="switch-close"]'
    const targetHasOwnExit = contents.some(function (content) {
      return !content.hidden &&
        typeof content.querySelector === 'function' &&
        Boolean(content.querySelector(ownExitSelector))
    })
    modal
      .querySelectorAll(backSelector)
      .forEach(function (control) {
        const visible = target !== 'base' &&
          !(targetHasOwnExit && hasAttribute(control, 'close-to-base'))
        control.hidden = !visible
        control.style.display = visible ? '' : 'none'
      })
    return found
  }

  function hasAttribute(node, name) {
    if (!node) return false
    if (typeof node.hasAttribute === 'function') return node.hasAttribute(name)
    return typeof node.getAttribute === 'function' && node.getAttribute(name) != null
  }

  /**
   * Closes the details dialog through the authored close control so the
   * native modal system runs its own close flow; falls back to the dialog
   * API when no authored control exists.
   */
  function closeDetailModal(modal) {
    if (!modal) return false
    const control =
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[booking-popup-info-close], [data-modal-close]')
    if (control && typeof control.click === 'function') {
      control.click()
      return true
    }
    if (typeof modal.close === 'function') {
      try {
        modal.close()
      } catch (_error) {}
      return true
    }
    return false
  }

  function reasonValue(modal, kind) {
    const config = KINDS[kind] || KINDS.decline
    const field =
      modal &&
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[' + config.reasonAttribute + ']')
    if (!field) return { field: null, value: '' }
    return { field, value: clean(field.value) }
  }

  function validateReason(field, value) {
    if (!field) return false
    if (typeof field.setCustomValidity === 'function') {
      field.setCustomValidity(value ? '' : 'Please provide a reason.')
    }
    if (!value && typeof field.reportValidity === 'function') {
      field.reportValidity()
    }
    return Boolean(value)
  }

  function actionForButton(button) {
    const action = clean(
      button.getAttribute('booking-action-btn') ||
        button.getAttribute('booking-card-action-btn'),
    )
    if (action === 'switch-decline') return { kind: 'decline', step: 'open' }
    if (action === 'switch-decline-reason') return { kind: 'decline', step: 'reason' }
    if (action === 'decline') return { kind: 'decline', step: 'submit' }
    if (action === 'switch-cancel') return { kind: 'cancel', step: 'open' }
    if (action === 'switch-cancel-reason') return { kind: 'cancel', step: 'reason' }
    if (action === 'cancel') return { kind: 'cancel', step: 'submit' }
    if (action === 'reschedule') return { kind: 'reschedule-propose', step: 'open' }
    if (action === 'reschedule-calendar') return { kind: 'reschedule-propose', step: 'calendar' }
    if (action === 'confirm-reschedule') return { kind: 'reschedule-confirm', step: 'respond' }
    if (action === 'reschedule-decline') return { kind: 'reschedule-decline', step: 'respond' }
    // Modal chrome: the authored back and close controls. The legacy inline
    // delegation used to own these; this module owns them now so they work on
    // both dashboards and stop bubbling into legacy handlers.
    if (action === 'switch-base') return { kind: 'navigate', step: 'base' }
    if (action === 'switch-close') return { kind: 'navigate', step: 'close' }
    return null
  }

  const WIRE_SELECTOR = [
    'switch-decline',
    'switch-decline-reason',
    'decline',
    'switch-cancel',
    'switch-cancel-reason',
    'cancel',
    'reschedule',
    'reschedule-calendar',
    'confirm-reschedule',
    'reschedule-decline',
    'switch-base',
    'switch-close',
  ]
    .map(function (action) {
      return (
        '[booking-action-btn="' +
        action +
        '"], [booking-card-action-btn="' +
        action +
        '"]'
      )
    })
    .join(', ')

  const CLOSE_SELECTOR =
    '[booking-action-btn="switch-close"], [booking-card-action-btn="switch-close"], [data-modal-close], [booking-popup-close], [popup-booking-close]'

  function restartAfterModalClose(document, modal, restart) {
    if (
      !document ||
      typeof document.addEventListener !== 'function' ||
      !modal ||
      typeof restart !== 'function'
    ) return false
    let pending = true
    const detach = function () {
      if (typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onClick, true)
      }
      if (typeof modal.removeEventListener === 'function') {
        modal.removeEventListener('close', onClose)
      }
    }
    const run = function () {
      if (!pending) return
      pending = false
      detach()
      Promise.resolve()
        .then(restart)
        .catch(function (error) {
          console.error(
            '[dashboard-call-actions] refresh after close failed:',
            error && error.message,
          )
        })
    }
    const onClose = function () {
      run()
    }
    const onClick = function (event) {
      const target = event && event.target
      const close = target && target.closest && target.closest(CLOSE_SELECTOR)
      if (!close || !close.closest) return
      const owner = close.closest(
        '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
      )
      if (owner === modal) run()
    }
    document.addEventListener('click', onClick, true)
    if (typeof modal.addEventListener === 'function') {
      modal.addEventListener('close', onClose)
    }
    return true
  }

  function loaderCacheSuffix(document) {
    const loader =
      document &&
      typeof document.querySelector === 'function' &&
      document.querySelector('script[src*="/v3/dashboard-calls.js"]')
    const src = clean(loader && loader.getAttribute('src'))
    const query = src.indexOf('?')
    if (query === -1) return ''
    const suffix = src.slice(query + 1)
    return suffix ? '?' + suffix : ''
  }

  async function loadCalendarModule(document) {
    function ready() {
      const candidate = global.StartersPaidCallBrandPayment
      return candidate && typeof candidate.mountPaidCalendar === 'function'
        ? candidate
        : null
    }
    if (ready()) return ready()
    if (!document || typeof document.createElement !== 'function') return null
    await new Promise(function (resolve) {
      let script = document.querySelector(
        'script[data-starters-reschedule-calendar], script[src*="/v3/paid-call-brand-payment.js"]',
      )
      if (!script) {
        script = document.createElement('script')
        script.src = CALENDAR_MODULE_PATH + loaderCacheSuffix(document)
        script.defer = true
        script.setAttribute('data-starters-reschedule-calendar', '')
        ;(document.head || document.documentElement).appendChild(script)
      }
      script.addEventListener('load', resolve, { once: true })
      script.addEventListener('error', resolve, { once: true })
      global.setTimeout(resolve, 8000)
    })
    return ready()
  }

  function styledActionButton(document, modal, action, label) {
    const template =
      modal &&
      typeof modal.querySelector === 'function' &&
      (modal.querySelector('[booking-action-btn="cancel"]') ||
        modal.querySelector('[booking-action-btn="decline"]'))
    let button
    if (template && typeof template.cloneNode === 'function') {
      button = template.cloneNode(true)
    } else {
      button = document.createElement('button')
      button.type = 'button'
      button.style.padding = '12px 16px'
      button.style.border = '1px solid #1f211d'
      button.style.borderRadius = '6px'
      button.style.background = '#1f211d'
      button.style.color = '#ffffff'
      button.style.cursor = 'pointer'
    }
    button.setAttribute('booking-action-btn', action)
    button.removeAttribute('booking-card-action-btn')
    button.hidden = false
    button.style.display = ''
    button.textContent = label
    return button
  }

  const ACTION_LABEL_SELECTOR = '.button_main-text, [button-text], [data-button-text]'

  function setAuthoredActionLabel(control, label) {
    if (!control) return false
    const labels =
      typeof control.querySelectorAll === 'function'
        ? Array.prototype.slice.call(control.querySelectorAll(ACTION_LABEL_SELECTOR))
        : []
    if (labels.length) {
      labels.forEach(function (node) {
        node.textContent = label
      })
    } else {
      control.textContent = label
    }
    return true
  }

  /**
   * Shows a visible in-flight state on an action control until the returned
   * release runs: the authored label reads `label`, and the control and any
   * button inside it are disabled. aria-busy alone was invisible, so a slow
   * command read as a dead button (Kaeser QA P5, 2026-09-28). Release
   * restores the authored label and each button's prior disabled state.
   * @param {HTMLElement|null} control Clicked action control.
   * @param {string} label Busy label, for example "Confirming…".
   * @returns {function(): void} Idempotent release.
   */
  function markActionBusy(control, label) {
    if (!control) return function () {}
    const labels =
      typeof control.querySelectorAll === 'function'
        ? Array.prototype.slice.call(control.querySelectorAll(ACTION_LABEL_SELECTOR))
        : []
    // A control with element children but no label hook keeps its markup;
    // it still gets the busy and disabled state below.
    const textNodes = labels.length
      ? labels
      : control.children && control.children.length ? [] : [control]
    const authoredText = textNodes.map(function (node) { return node.textContent })
    const buttons = [control]
      .concat(
        typeof control.querySelectorAll === 'function'
          ? Array.prototype.slice.call(control.querySelectorAll('button'))
          : [],
      )
      .filter(function (node) { return node && 'disabled' in node })
    const wasDisabled = buttons.map(function (node) { return node.disabled })
    if (typeof control.setAttribute === 'function') {
      control.setAttribute('aria-busy', 'true')
      control.setAttribute('aria-disabled', 'true')
    }
    if (clean(label)) {
      textNodes.forEach(function (node) { node.textContent = label })
    }
    buttons.forEach(function (node) { node.disabled = true })
    let released = false
    return function release() {
      if (released) return
      released = true
      if (clean(label)) {
        textNodes.forEach(function (node, index) { node.textContent = authoredText[index] })
      }
      buttons.forEach(function (node, index) { node.disabled = wasDisabled[index] })
      if (typeof control.setAttribute === 'function') {
        control.setAttribute('aria-busy', 'false')
        control.setAttribute('aria-disabled', 'false')
      }
    }
  }

  function replaceAuthoredPlaceholder(root, replacement) {
    let changed = 0
    function visit(node) {
      if (!node) return
      if (node.nodeType === 3) {
        if (clean(node.nodeValue) === 'This is some text inside of a div block.') {
          node.nodeValue = replacement
          changed += 1
        }
        return
      }
      Array.prototype.forEach.call(node.childNodes || [], visit)
    }
    visit(root)
    return changed
  }

  /**
   * Keeps the Designer-owned reschedule form and normalizes only its copy.
   * Webflow's default Div Block text can otherwise ship as the field label,
   * and cloned Button components keep that same placeholder in their labels.
   */
  function normalizeRescheduleViewCopy(modal) {
    if (!modal || typeof modal.querySelector !== 'function') return false
    const panel = modal.querySelector('[booking-popup-content="reschedule"]')
    if (!panel || typeof panel.querySelectorAll !== 'function') return false
    panel
      .querySelectorAll(
        '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]',
      )
      .forEach(function (control) {
        setAuthoredActionLabel(control, 'Back')
      })
    panel
      .querySelectorAll(
        '[booking-action-btn="reschedule-calendar"], [booking-card-action-btn="reschedule-calendar"]',
      )
      .forEach(function (control) {
        setAuthoredActionLabel(control, 'Continue')
      })
    const reason = panel.querySelector('[booking-reschedule-reason]')
    if (reason) {
      reason.placeholder = 'Why do you need a new time?'
      if (typeof reason.setAttribute === 'function') {
        reason.setAttribute('aria-label', 'Why do you need a new time?')
      }
    }
    replaceAuthoredPlaceholder(panel, 'Why do you need a new time?')
    return true
  }

  /* One authored reason panel serves the reschedule contracts, so its copy
     cannot be static: the confirmed flow really does keep the current time
     until the counterpart answers, the direct pending edit changes the time
     immediately, and a pending offer keeps the original requested time while
     the offer is open. The panel's heading and body carry authored
     `booking-copy` hooks (`reschedule-title` / `reschedule-body`) so this
     targets attributes, never a styling class. The known-string match below is
     only a fallback for a page served before those hooks were published. */
  const RESCHEDULE_COPY = {
    'reschedule-propose': {
      title: 'Propose a new time',
      body:
        'Your call keeps its current time until the other participant confirms the new one.' +
        ' Changes close to the start time can be disruptive, so add a short note about why.',
    },
    'pending-propose': {
      title: 'Propose a new time',
      body:
        'The request keeps its requested time until the other participant answers.' +
        ' Choose any time more than 24 hours from now. Add a short note about why.',
    },
    'reschedule-request': {
      title: 'Update the requested time',
      body:
        'The Starter has not accepted this request yet, so the new time applies right away' +
        ' and their acceptance will apply to it. Add a short note about why.',
    },
  }

  /**
   * Swaps the shared reason panel's heading and description to the copy of the
   * contract actually in play.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {string} kind Resolved reschedule contract.
   * @returns {boolean} Whether any authored node was updated.
   */
  function applyRescheduleContractCopy(modal, kind) {
    const copy = RESCHEDULE_COPY[kind]
    if (!modal || !copy || typeof modal.querySelector !== 'function') return false
    const panel = modal.querySelector('[booking-popup-content="reschedule"]')
    if (!panel || typeof panel.querySelectorAll !== 'function') return false
    let applied = 0
    const authoredTitle = panel.querySelector('[booking-copy="reschedule-title"]')
    const authoredBody = panel.querySelector('[booking-copy="reschedule-body"]')
    if (authoredTitle) {
      authoredTitle.textContent = copy.title
      applied += 1
    }
    if (authoredBody) {
      authoredBody.textContent = copy.body
      applied += 1
    }
    if (applied) return true
    // Fallback for a page published before the authored hooks existed.
    const titles = []
    const bodies = []
    Object.keys(RESCHEDULE_COPY).forEach(function (name) {
      titles.push(RESCHEDULE_COPY[name].title)
      bodies.push(RESCHEDULE_COPY[name].body)
    })
    Array.prototype.forEach.call(panel.querySelectorAll('p, h1, h2, h3'), function (node) {
      if (node.children && node.children.length) return
      const text = clean(node.textContent)
      if (titles.indexOf(text) !== -1) {
        node.textContent = copy.title
        applied += 1
        return
      }
      if (bodies.indexOf(text) !== -1) {
        node.textContent = copy.body
        applied += 1
      }
    })
    return applied > 0
  }

  function reschedulePanel(document, name, marker) {
    const panel = document.createElement('div')
    panel.setAttribute('booking-popup-content', name)
    if (marker) panel.setAttribute('data-starters-reschedule-views', '')
    panel.hidden = true
    panel.style.display = 'none'
    panel.style.flexDirection = 'column'
    panel.style.gap = '12px'
    panel.style.width = '100%'
    return panel
  }

  function panelText(document, tag, text, muted) {
    const node = document.createElement(tag)
    node.textContent = text
    if (muted) {
      node.style.color = '#6f746d'
      node.style.fontSize = '13px'
      node.style.margin = '0'
    }
    return node
  }

  function ensureRescheduleViews(document, modal) {
    if (
      !document ||
      !modal ||
      typeof modal.querySelector !== 'function' ||
      typeof document.createElement !== 'function'
    ) return false
    // The authored declined receipt ("The call keeps its original time.")
    // matches the #5760 Free contract again, so it is no longer rewritten.
    const hasAuthoredRescheduleView = normalizeRescheduleViewCopy(modal)
    if (modal.querySelector('[data-starters-reschedule-views]')) {
      ensureRespondButtons(document, modal)
      return true
    }
    const sibling =
      modal.querySelector('[booking-popup-content="cancel-reason"]') ||
      modal.querySelector('[booking-popup-content="base"]')
    const host = sibling && sibling.parentNode
    if (!host || typeof host.appendChild !== 'function') return false

    if (!hasAuthoredRescheduleView) {
      const reasonPanel = reschedulePanel(document, 'reschedule', true)
      reasonPanel.appendChild(panelText(document, 'h3', 'Choose a new time'))
      reasonPanel.appendChild(
        panelText(
          document,
          'p',
          'Select a new time and add a short note about why you need the change.',
          true,
        ),
      )
      const reason = document.createElement('textarea')
      reason.setAttribute('booking-reschedule-reason', '')
      reason.rows = 3
      reason.placeholder = 'Why do you need a new time?'
      reason.style.width = '100%'
      reason.style.padding = '10px'
      reason.style.border = '1px solid #d7d9d2'
      reason.style.borderRadius = '6px'
      reasonPanel.appendChild(reason)
      reasonPanel.appendChild(
        styledActionButton(document, modal, 'reschedule-calendar', 'Continue'),
      )
      host.appendChild(reasonPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-calendar"]')) {
      const calendarPanel = reschedulePanel(document, 'reschedule-calendar')
      calendarPanel.appendChild(panelText(document, 'h3', 'Pick a new time'))
      const calendarHost = document.createElement('div')
      calendarHost.setAttribute('booking-reschedule-calendar', '')
      calendarHost.style.width = '100%'
      calendarPanel.appendChild(calendarHost)
      host.appendChild(calendarPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-proposed"]')) {
      const proposedPanel = reschedulePanel(document, 'reschedule-proposed')
      proposedPanel.appendChild(panelText(document, 'h3', 'Reschedule request sent'))
      proposedPanel.appendChild(
        panelText(
          document,
          'p',
          'We will notify you when the other participant responds. The call keeps its current time until then.',
          true,
        ),
      )
      host.appendChild(proposedPanel)
    }

    /* The pending path's success view. Authored in the Brands View, which is
       the only surface that can reach it, so this fallback exists purely so a
       modal without the authored panel cannot switch to a target that is not
       there and end up blank. */
    if (!modal.querySelector('[booking-popup-content="reschedule-updated"]')) {
      const updatedPanel = reschedulePanel(document, 'reschedule-updated')
      updatedPanel.appendChild(panelText(document, 'h3', 'Request time updated'))
      updatedPanel.appendChild(
        panelText(
          document,
          'p',
          'Your call request now shows the new time. The Starter has not accepted yet, and their acceptance will apply to this new time.',
          true,
        ),
      )
      host.appendChild(updatedPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-accepted"]')) {
      const acceptedPanel = reschedulePanel(document, 'reschedule-accepted')
      acceptedPanel.appendChild(panelText(document, 'h3', 'New time confirmed'))
      acceptedPanel.appendChild(
        panelText(document, 'p', 'The call has been moved to the proposed time.', true),
      )
      host.appendChild(acceptedPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-declined"]')) {
      const declinedPanel = reschedulePanel(document, 'reschedule-declined')
      declinedPanel.appendChild(panelText(document, 'h3', 'Proposal declined'))
      declinedPanel.appendChild(
        panelText(document, 'p', 'The call keeps its original time.', true),
      )
      host.appendChild(declinedPanel)
    }

    ensureRespondButtons(document, modal)
    normalizeRescheduleViewCopy(modal)
    return true
  }

  /**
   * Finds a control that sits inside the modal's own `base` panel. The same
   * `booking-action-btn` value also appears on list cards and inside the step
   * panels, so the base-panel test is what separates a control the member can
   * act on from the opening view from every other copy of it.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {string} selector Control selector to search for.
   * @returns {HTMLElement|null} The base-panel control, or null when absent.
   */
  function basePanelControl(modal, selector) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return null
    const candidates = modal.querySelectorAll(selector)
    for (let index = 0; index < candidates.length; index += 1) {
      const panel = candidates[index].closest
        ? candidates[index].closest('[booking-popup-content]')
        : null
      if (panel && panel.getAttribute('booking-popup-content') === 'base') {
        return candidates[index]
      }
    }
    return null
  }

  function ensureRespondButtons(document, modal) {
    if (
      !document ||
      !modal ||
      typeof modal.querySelector !== 'function' ||
      typeof document.createElement !== 'function'
    ) return false
    // Declining a Free proposal keeps the original time (#5760), but the
    // "Keep Current Time" button is retired (JP 2a, 2026-10-03): hide any
    // authored copy and never generate one. Accept New Time remains.
    hideKeepCurrentTime(document, modal)
    if (modal.querySelector('[data-starters-reschedule-respond]')) return true
    /* Both views now author the respond pair in the base panel, where the
       member can reach it. Generating a second pair there left four controls
       where two belong, because the authored and generated copies pass the
       same gate. The authored pair wins whenever it is present. */
    if (
      basePanelControl(
        modal,
        '[booking-action-btn="confirm-reschedule"], [booking-card-action-btn="confirm-reschedule"]',
      ) &&
      (!keepCurrentTimeEnabled || basePanelControl(
        modal,
        '[booking-action-btn="reschedule-decline"], [booking-card-action-btn="reschedule-decline"]',
      ))
    ) return true
    // On a page published while the authored confirm-reschedule still sat
    // inside the legacy hidden panel, the counterpart cannot reach it, so the
    // base view still needs generated respond controls. The authored base
    // reschedule trigger anchors their placement and styling.
    const anchor = basePanelControl(
      modal,
      '[booking-action-btn="reschedule"], [booking-action-btn="switch-cancel"]',
    )
    if (!anchor || !anchor.parentNode) return false
    const accept = styledActionButton(
      document,
      modal,
      'confirm-reschedule',
      'Accept New Time',
    )
    accept.setAttribute('data-starters-reschedule-respond', '')
    anchor.parentNode.insertBefore(accept, anchor.nextSibling)
    if (!keepCurrentTimeEnabled) return true
    const decline = styledActionButton(
      document,
      modal,
      'reschedule-decline',
      'Keep Current Time',
    )
    decline.setAttribute('data-starters-reschedule-respond', '')
    anchor.parentNode.insertBefore(decline, accept.nextSibling)
    return true
  }

  function resetRescheduleState(modal) {
    if (!modal || typeof modal.querySelector !== 'function') return false
    modal.__startersRescheduleCalendarToken = null
    const reason = modal.querySelector('[booking-reschedule-reason]')
    if (reason) reason.value = ''
    const calendar = modal.querySelector('[booking-reschedule-calendar]')
    if (calendar) calendar.textContent = ''
    // A reset can land mid-load (the member closed the modal or switched
    // bookings), so the loader must not be left covering the next open.
    showCalendarLoader(modal, false)
    return true
  }

  /**
   * Shows or hides the authored calendar loader. The site's `.loader_wrap` is
   * authored `display:none`, so a reveal has to name the display it wants;
   * `flex` is what that class is built around. Returns whether an authored
   * loader exists, which is what tells the caller a text fallback is needed.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {boolean} visible Whether the loader should show.
   * @returns {boolean} Whether an authored loader was found.
   */
  function showCalendarLoader(modal, visible) {
    const loader =
      modal &&
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[booking-calendar-loader]')
    if (!loader) return false
    loader.hidden = !visible
    if (loader.style) loader.style.display = visible ? 'flex' : 'none'
    return true
  }

  async function mountRescheduleCalendar(
    document,
    modal,
    booking,
    role,
    reason,
    restart,
    refreshDetail,
    settings,
  ) {
    const container = modal && modal.querySelector('[booking-reschedule-calendar]')
    if (!container) return false
    if (!rescheduleKindFor(role, booking)) return false
    const mountToken = {}
    modal.__startersRescheduleCalendarToken = mountToken
    // The row's id, not the id at mount: a F04 replacement moves the row and
    // the modal to the new id together, and the engine's post-success cleanup
    // still needs this mount to read as current.
    const isCurrent = function () {
      return (
        modal.__startersRescheduleCalendarToken === mountToken &&
        clean(modal.getAttribute && modal.getAttribute('data-booking-id')) ===
          clean(booking && booking.booking_id) &&
        modal.querySelector('[booking-reschedule-calendar]') === container
      )
    }
    /* The loader covers BOTH waits, not just the script fetch: the engine
       clears the container and only then requests availability, so the slow
       half of this used to render as an empty panel. */
    const authoredLoader = showCalendarLoader(modal, true)
    if (!authoredLoader) container.textContent = 'Loading available times...'
    const calendarModule = await loadCalendarModule(document)
    if (!isCurrent()) return false
    if (!rescheduleKindFor(role, booking)) { showCalendarLoader(modal, false); return false }
    if (!calendarModule) {
      showCalendarLoader(modal, false)
      container.textContent = 'The calendar could not load. Please try again.'
      return false
    }
    if (!authoredLoader) container.textContent = ''
    // F08: a pending offer is not limited to posted availability, so the
    // picker gets every step-aligned start in range instead of the posted slots.
    const pendingSlots = rescheduleKindFor(role, booking) === 'pending-propose'
      ? pendingProposeSlots(booking)
      : null
    try {
      await calendarModule.mountPaidCalendar({
      container,
      slots: pendingSlots || undefined,
      config: {
        booking_id: clean(booking && booking.booking_id),
        config_id: clean(booking && booking.config_id),
        grant_id: clean(booking && booking.grant_id),
        duration: Number(booking && booking.duration),
      },
      confirmText: 'Propose new time',
      isCurrent,
      onConfirm: async function (slot) {
        if (!isCurrent()) return null
        showActionError(modal, '')
        // The booking decides the contract, and with it the failure copy and
        // success view: direct edits land on "time updated"; pending offers
        // and confirmed proposals wait for the other participant.
        const initialKind = rescheduleKindFor(role, booking)
        if (!initialKind) return null
        let mutationClaim = null
        let releaseAction = null
        try {
          releaseAction = settings && typeof settings.acquireBookingAction === 'function'
            ? await acquireMutationSlot(settings, booking, KINDS[initialKind].failureMessage)
            : async function () {}
          if (!releaseAction || !isCurrent()) return null
          if (settings && typeof settings.getBooking === 'function') {
            booking = settings.getBooking(modal)
            if (!booking) return null
          }
          const kind = rescheduleKindFor(role, booking)
          if (!kind) return null
          const config = KINDS[kind]
          if (
            kind === 'reschedule-propose' &&
            paidFlag(booking) &&
            !paidProposedStartAllowed(slot && slot.start, referenceTime(booking))
          ) throw new Error(PAID_PROPOSED_START_MESSAGE)
          if (
            kind === 'pending-propose' &&
            !pendingProposedStartAllowed(booking, slot && slot.start, referenceTime(booking))
          ) throw new Error(PENDING_PROPOSE_START_MESSAGE)
          if (
            kind === 'pending-propose' &&
            settings &&
            typeof settings.captureBookingMutation === 'function'
          ) {
            mutationClaim = settings.captureBookingMutation(booking)
          }
          const result = await proposeReschedule(booking, role, reason, {
            start: Number(slot && slot.start),
            end: Number(slot && slot.end),
            timezone: clean(slot && slot.timezone),
          }, undefined, kind)
          if (!result) throw new Error(config.failureMessage)
          // F04: the update replaces the provider booking, so the row now
          // lives under the new id. The attempt key was already cleared under
          // the sent id inside submitAction. Adopt before the currency check:
          // a member who moved on mid-request must not leave the row, or a card
          // still keyed by the sent id, holding a dead booking_id.
          const replaced = kind === 'reschedule-request' && adoptReplacementBooking(
            document,
            modal,
            booking,
            replacementBookingId(kind, result, booking),
          )
          if (!isCurrent()) {
            // The card still shows the old slot, so re-read the list on close.
            // F08: the card still shows no offer, so re-read the list on close too.
            if (replaced || kind === 'pending-propose') restartAfterModalClose(document, modal, restart)
            return result
          }
          const reasonField = modal.querySelector('[booking-reschedule-reason]')
          if (reasonField) reasonField.value = ''
          // The receipt describes the selected slot. A direct pending edit
          // moves immediately; a confirmed call keeps its canonical time until
          // the counterpart accepts, so render its proposal from a separate model.
          if (kind === 'reschedule-request' && booking) {
            booking.start = Number(slot && slot.start)
            booking.end = Number(slot && slot.end)
            booking.rescheduled_reason = reason || booking.rescheduled_reason
            if (typeof refreshDetail === 'function') refreshDetail(modal, booking)
          }
          // F08: the request keeps its original time; the offer, proposer and
          // new deadline come from the server result.
          if (kind === 'pending-propose' && booking) {
            const offer = result[config.responseKey] || {}
            const deadline = Number(offer.deadline)
            const committed = commitBookingMutation(settings, booking, {
              start_old: Number(offer.offer_start) > 0 ? Number(offer.offer_start) : Number(slot && slot.start),
              end_old: Number(offer.offer_end) > 0 ? Number(offer.offer_end) : Number(slot && slot.end),
              rescheduled_by: role,
              rescheduled_reason: reason || booking.rescheduled_reason,
              confirmation_expires_at: Number.isFinite(deadline) && deadline > 0
                ? deadline
                : booking.confirmation_expires_at,
            }, mutationClaim)
            if (!committed) return result
            if (typeof refreshDetail === 'function') refreshDetail(modal, committed, config.successContent)
          }
          if (kind === 'reschedule-propose' && booking && typeof refreshDetail === 'function') {
            refreshDetail(modal, Object.assign({}, booking, {
              start: Number(slot && slot.start),
              end: Number(slot && slot.end),
              rescheduled_reason: reason || booking.rescheduled_reason,
            }), config.successContent)
          }
          switchPopupContent(modal, config.successContent)
          restartAfterModalClose(document, modal, restart)
        } catch (error) {
          if (isCurrent()) {
            showActionError(modal, (error && error.message) || KINDS[initialKind].failureMessage)
          }
          throw error
        } finally {
          try {
            await releaseMutationClaim(settings, mutationClaim)
          } finally {
            await releaseMutationSlot(releaseAction)
          }
        }
      },
      })
    } catch (error) {
      if (isCurrent()) {
        container.textContent = 'Available times could not load. Go back and try again.'
      }
      throw error
    } finally {
      // The engine has painted (or failed) by here, so the loader comes down
      // either way rather than covering a rendered calendar.
      if (isCurrent()) showCalendarLoader(modal, false)
    }
    return true
  }

  // The panel switchPopupContent left open. A root with no nested panels
  // (the payment module passes the base panel itself) returns null.
  function openPopupContent(modal) {
    if (typeof modal.querySelectorAll !== 'function') return null
    return Array.prototype.find.call(
      modal.querySelectorAll('[booking-popup-content]'),
      function (content) {
        return !content.hidden && !(content.style && content.style.display === 'none')
      },
    ) || null
  }

  function visibleCancelFeeText(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return ''
    const note = Array.prototype.find.call(
      modal.querySelectorAll('[booking-copy="cancel-fee"], [data-starters-cancel-fee-note]'),
      function (each) {
        return each && !each.hidden && !(each.style && each.style.display === 'none')
      },
    )
    return clean(note && note.textContent)
  }

  const RESPOND_SELECTOR =
    '[booking-action-btn="confirm-reschedule"], [booking-card-action-btn="confirm-reschedule"], ' +
    '[booking-action-btn="reschedule-decline"], [booking-card-action-btn="reschedule-decline"]'

  /**
   * The clicked proposal response plus every other response control in the
   * open panel (authored or module-rendered), clicked control first.
   * @param {HTMLElement|null} modal Detail modal.
   * @param {HTMLElement} button Clicked response control.
   * @returns {HTMLElement[]} Response controls to hold busy together.
   */
  function respondControlsInOpenPanel(modal, button) {
    const panel = modal && openPopupContent(modal)
    const siblings = panel && typeof panel.querySelectorAll === 'function'
      ? Array.prototype.slice.call(panel.querySelectorAll(RESPOND_SELECTOR))
      : []
    return [button].concat(siblings.filter(function (control) { return control !== button }))
  }

  /**
   * Shows (or clears, with an empty message) a module-owned error line inside
   * the details modal. A failed command must never end as a console-only
   * event: Kaeser's QA read those silent failures as dead buttons.
   */
  function showActionError(modal, message) {
    if (!modal || typeof modal.querySelector !== 'function') return
    const text = clean(message)
    let note = modal.querySelector('[data-starters-action-error]')
    if (!text) {
      // The note moves between panels and the payment module keeps its own
      // in the base panel, so a clear must reach every note, not the first.
      const notes = typeof modal.querySelectorAll === 'function'
        ? modal.querySelectorAll('[data-starters-action-error]')
        : [note]
      Array.prototype.forEach.call(notes, function (each) {
        if (!each) return
        each.hidden = true
        each.style.display = 'none'
      })
      return
    }
    // F21: the dialog root clips to the viewport, so a note appended there
    // sat below the fold. Place it in the open panel, next to the failed
    // action, and keep the root when no open panel is found.
    const host = openPopupContent(modal) || modal
    if (!note) {
      const document = modal.ownerDocument || global.document
      if (
        !document ||
        typeof document.createElement !== 'function' ||
        typeof host.appendChild !== 'function'
      ) return
      note = document.createElement('div')
      note.setAttribute('data-starters-action-error', '')
      note.setAttribute('role', 'alert')
      note.style.color = '#b3261e'
      note.style.fontSize = '14px'
      note.style.lineHeight = '1.4'
      note.style.margin = '12px 24px'
      host.appendChild(note)
    } else if (host !== modal && note.parentNode !== host && typeof host.appendChild === 'function') {
      host.appendChild(note)
    }
    note.textContent = text
    note.hidden = false
    note.style.display = ''
    // The open panel scrolls inside the dialog; bring the note into view.
    if (typeof note.scrollIntoView === 'function') {
      try {
        note.scrollIntoView({ block: 'nearest' })
      } catch (_error) {}
    }
  }

  /**
   * Renders the cancel confirmation's fee line (P5 / F15). An authored
   * `[booking-copy="cancel-fee"]` slot wins when present. Without one, the
   * module owns one `[data-starters-cancel-fee-note]` line placed right after
   * the authored `[confirming-cancel-text]` body (copying its class so it
   * reads as authored copy), or at the end of the open cancel panel. Free
   * bookings render nothing and hide any earlier line.
   * @returns {boolean} Whether a fee line is visible.
   */
  function renderCancelFeeNote(document, modal, role, booking, now) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return false
    const text = cancelFeeText(role, booking, now)
    const panel = openPopupContent(modal)
    const panelName = panel && typeof panel.getAttribute === 'function'
      ? panel.getAttribute('booking-popup-content')
      : ''
    const inCancel = Boolean(
      panel && (panelName === 'cancel' || panelName === 'cancel-reason')
    )
    const authored = inCancel && typeof panel.querySelector === 'function'
      ? panel.querySelector('[booking-copy="cancel-fee"]')
      : null
    Array.prototype.forEach.call(
      modal.querySelectorAll('[booking-copy="cancel-fee"], [data-starters-cancel-fee-note]'),
      function (each) {
        if (each === authored && text) return
        each.hidden = true
        if (each.style) each.style.display = 'none'
      },
    )
    if (!text || !inCancel) return false
    let note = authored
    if (!note) {
      note = typeof panel.querySelector === 'function'
        ? panel.querySelector('[data-starters-cancel-fee-note]')
        : null
    }
    if (!note) {
      const owner = document || modal.ownerDocument || global.document
      if (!owner || typeof owner.createElement !== 'function') return false
      note = owner.createElement('p')
      note.setAttribute('data-starters-cancel-fee-note', '')
      const anchor = typeof panel.querySelector === 'function'
        ? panel.querySelector('[confirming-cancel-text]')
        : null
      if (anchor && anchor.parentNode && typeof anchor.parentNode.insertBefore === 'function') {
        if (anchor.className) note.className = anchor.className
        anchor.parentNode.insertBefore(note, anchor.nextSibling)
      } else if (typeof panel.appendChild === 'function') {
        panel.appendChild(note)
      } else {
        return false
      }
    }
    note.textContent = text
    note.hidden = false
    if (note.style) note.style.display = ''
    return true
  }

  function refreshCancelFeeDisclosure(document, modal, role, booking, now) {
    const before = visibleCancelFeeText(modal)
    const expected = clean(cancelFeeText(role, booking, now))
    const rendered = renderCancelFeeNote(document, modal, role, booking, now)
    return expected !== '' && before !== expected && rendered
  }

  function commitBookingMutation(settings, booking, update, claim) {
    if (settings && typeof settings.commitBookingMutation === 'function') {
      return settings.commitBookingMutation(booking, update, claim)
    }
    if (!booking) return null
    const changes = typeof update === 'function' ? update(booking) : update
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null
    Object.assign(booking, changes)
    return booking
  }

  async function releaseMutationClaim(settings, claim) {
    if (
      !claim || !settings ||
      typeof settings.releaseBookingMutation !== 'function'
    ) return
    const refresh = settings.releaseBookingMutation(claim)
    if (!refresh || typeof settings.reconcileBookingMutations !== 'function') return
    try {
      await settings.reconcileBookingMutations()
    } catch (error) {
      console.error(
        '[dashboard-call-actions] mutation reconciliation failed:',
        error && error.message,
      )
    }
  }

  function acquireMutationSlot(settings, booking, failureMessage) {
    return settings && typeof settings.acquireBookingAction === 'function'
      ? settings.acquireBookingAction(booking, failureMessage)
      : Promise.resolve(async function () {})
  }

  async function releaseMutationSlot(release) {
    if (typeof release !== 'function') return
    try {
      await release()
    } catch (error) {
      console.error('[dashboard-call-actions] mutation readback failed:', error && error.message)
    }
  }

  function wire(options) {
    const settings = options || {}
    const document = settings.document || global.document
    if (
      !document ||
      typeof document.addEventListener !== 'function' ||
      typeof settings.getBooking !== 'function'
    ) return false
    hideKeepCurrentTime(document)
    document.addEventListener(
      'click',
      async function (event) {
        const target = event && event.target
        const button =
          target && target.closest && target.closest(WIRE_SELECTOR)
        if (!button) return
        let step = actionForButton(button)
        if (!step) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
        const modal =
          button.closest &&
          (button.closest(
            '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
          ) ||
            (document.querySelector &&
              document.querySelector(
                '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
              )))
        if (step.kind === 'navigate') {
          // Modal chrome needs no booking gate: back returns to the base
          // panel, close dismisses the dialog.
          if (step.step === 'base') {
            showActionError(modal, '')
            switchPopupContent(modal, 'base')
          } else {
            closeDetailModal(modal)
          }
          return
        }
        let booking = settings.getBooking(button)
        /* One authored Reschedule button serves multiple contracts. The markup
           cannot know which, so the booking decides here: a pending request
           swaps the confirmed-call kind for the direct-edit or pending-offer
           kind before the gate runs, otherwise the gate would reject its own
           button. */
        if (step.kind === 'reschedule-propose') {
          const resolved = rescheduleKindFor(settings.role, booking)
          if (resolved) step = { kind: resolved, step: step.step }
        }
        // F08: the authored respond pair answers a pending offer too.
        if (step.kind === 'reschedule-confirm' || step.kind === 'reschedule-decline') {
          step = { kind: respondKindFor(step.kind, booking), step: step.step }
        }
        let now = actionNow(settings, booking)
        if (!canAct(step.kind, settings.role, booking, now)) {
          // Never fail silently: a blocked click with no trace reads as a dead
          // button. The gate snapshot names the reason without member PII.
          console.warn('[dashboard-call-actions] ' + step.kind + ' blocked:', {
            role: settings.role,
            status: bookingStatus(booking),
            paid: booking ? paidFlag(booking) : null,
            identified: bookingIdentified(booking),
          })
          return
        }
        const config = KINDS[step.kind]
        if (step.step === 'open') {
          const card = button.closest && button.closest('[data-booking-id]')
          if (card && typeof settings.openDetail === 'function' &&
              !settings.openDetail(modal, booking)) return
          if (
            step.kind === 'reschedule-propose' ||
            step.kind === 'reschedule-request' ||
            step.kind === 'pending-propose'
          ) {
            ensureRescheduleViews(document, modal)
            applyRescheduleContractCopy(modal, step.kind)
            switchPopupContent(modal, 'reschedule')
            return
          }
          switchPopupContent(modal, config.firstContent)
          if (step.kind === 'cancel') renderCancelFeeNote(document, modal, settings.role, booking, now)
          return
        }
        if (step.step === 'reason') {
          if (
            step.kind === 'cancel' &&
            refreshCancelFeeDisclosure(document, modal, settings.role, booking, now)
          ) return
          switchPopupContent(modal, config.reasonContent)
          if (step.kind === 'cancel') {
            renderCancelFeeNote(document, modal, settings.role, booking, now)
          }
          return
        }
        if (step.step === 'calendar') {
          const proposalReason = reasonValue(modal, step.kind)
          if (!validateReason(proposalReason.field, proposalReason.value)) return
          switchPopupContent(modal, 'reschedule-calendar')
          mountRescheduleCalendar(
            document,
            modal,
            booking,
            settings.role,
            proposalReason.value,
            settings.restart,
            settings.refreshDetail,
            settings,
          ).catch(function (error) {
            console.error(
              '[dashboard-call-actions] reschedule calendar failed:',
              error && error.message,
            )
          })
          return
        }
        if (button.__startersActionBusy) return
        if (step.step === 'respond') {
          // Keep Current Time and Accept New Time answer the same proposal.
          // While either is in flight, both are busy, so the sibling cannot
          // send the opposite command; only the clicked one changes its label.
          const respondControls = respondControlsInOpenPanel(modal, button)
          const releases = respondControls.map(function (control) {
            control.__startersActionBusy = true
            return markActionBusy(control, control === button ? config.busyLabel : '')
          })
          const releaseBusy = function () {
            respondControls.forEach(function (control) { control.__startersActionBusy = false })
            releases.forEach(function (release) { release() })
          }
          showActionError(modal, '')
          let mutationClaim = null
          let releaseAction = null
          try {
            releaseAction = await acquireMutationSlot(settings, booking, config.failureMessage)
            if (!releaseAction) return
            booking = settings.getBooking(button)
            now = actionNow(settings, booking)
            if (!canAct(step.kind, settings.role, booking, now)) return
            mutationClaim = typeof settings.captureBookingMutation === 'function'
              ? settings.captureBookingMutation(booking)
              : null
            const result = await respondReschedule(step.kind, booking, settings.role, now)
            if (!result) throw new Error(config.failureMessage)
            let pendingCommitted = null
            if (step.kind === 'pending-accept' || step.kind === 'pending-decline') {
              const answer = result[config.responseKey] || {}
              const replacement = replacementBookingId(step.kind, result, booking)
              const committed = commitBookingMutation(settings, booking, function (current) {
                if (step.kind === 'pending-decline') {
                  return { status: 'cancelled', cancelled_by: 'brand' }
                }
                const offerStart = Number(answer.start) > 0 ? Number(answer.start) : Number(current.start_old)
                const offerEnd = Number(answer.end) > 0 ? Number(answer.end) : Number(current.end_old)
                return { status: 'confirmed', start: offerStart, end: offerEnd, start_old: null, end_old: null }
              }, mutationClaim)
              if (!committed) return
              if (replacement) adoptReplacementBooking(document, modal, committed, replacement)
              if (committed !== booking) booking.booking_id = committed.booking_id
              pendingCommitted = committed
            }
            const modalIsCurrent =
              clean(modal.getAttribute('data-booking-id')) ===
              clean(booking.booking_id || booking.id)
            if (pendingCommitted && modalIsCurrent && typeof settings.refreshDetail === 'function') {
              settings.refreshDetail(modal, pendingCommitted)
            }
            if (step.kind === 'reschedule-confirm' || step.kind === 'reschedule-decline') {
              const confirmed = result[config.responseKey]
              const confirmedBooking = commitBookingMutation(settings, booking, function (current) {
                const changes = { status: confirmed.status }
                const confirmedStart = Number(confirmed.start)
                const confirmedEnd = Number(confirmed.end)
                const restoredStart = Number(current.start_old)
                const restoredEnd = Number(current.end_old)
                if (Number.isFinite(confirmedStart) && confirmedStart > 0) changes.start = confirmedStart
                else if (step.kind === 'reschedule-decline') changes.start = Number.isFinite(restoredStart) && restoredStart > 0 ? restoredStart : null
                if (Number.isFinite(confirmedEnd) && confirmedEnd > 0) changes.end = confirmedEnd
                else if (step.kind === 'reschedule-decline') changes.end = Number.isFinite(restoredEnd) && restoredEnd > 0 ? restoredEnd : null
                return changes
              }, mutationClaim)
              if (!confirmedBooking) return
              if (modalIsCurrent && typeof settings.refreshDetail === 'function') {
                settings.refreshDetail(modal, confirmedBooking)
              }
            }
            if (modalIsCurrent) {
              ensureRescheduleViews(document, modal)
              switchPopupContent(modal, config.successContent)
            }
            restartAfterModalClose(document, modal, settings.restart)
          } catch (error) {
            if (clean(modal.getAttribute('data-booking-id')) !== clean(booking.booking_id || booking.id)) return
            console.error(
              '[dashboard-call-actions] ' + step.kind + ' failed closed:',
              error && error.message,
            )
            showActionError(modal, (error && error.message) || config.failureMessage)
          } finally {
            try {
              await releaseMutationClaim(settings, mutationClaim)
            } finally {
              await releaseMutationSlot(releaseAction)
              releaseBusy()
            }
          }
          return
        }
        if (
          step.kind === 'cancel' &&
          refreshCancelFeeDisclosure(document, modal, settings.role, booking, actionNow(settings, booking))
        ) return
        const reason = reasonValue(modal, step.kind)
        if (!validateReason(reason.field, reason.value)) return
        button.__startersActionBusy = true
        const releaseBusy = markActionBusy(button, config.busyLabel)
        showActionError(modal, '')
        let mutationClaim = null
        let releaseAction = null
        try {
          releaseAction = await acquireMutationSlot(settings, booking, config.failureMessage)
          if (!releaseAction) return
          booking = settings.getBooking(button)
          now = actionNow(settings, booking)
          if (!canAct(step.kind, settings.role, booking, now)) return
          if (
            step.kind === 'cancel' &&
            refreshCancelFeeDisclosure(document, modal, settings.role, booking, now)
          ) return
          mutationClaim = step.kind === 'cancel' &&
            typeof settings.captureBookingMutation === 'function'
            ? settings.captureBookingMutation(booking)
            : null
          const result = await submitAction(
            step.kind,
            settings.role,
            booking,
            reason.value,
            now,
          )
          if (!result) throw new Error(config.failureMessage)
          if (step.kind === 'cancel' && typeof settings.onCancelSuccess === 'function') {
            try {
              const repaintCancellation =
                ['confirmed', 'rescheduled'].includes(bookingStatus(booking))
              if (settings.onCancelSuccess(booking, result, mutationClaim, reason.value) === false) return
              // A different booking may have been opened while the command
              // was in flight. Commit the original row, but never repaint or
              // clear the other booking's modal/form.
              if (clean(modal.getAttribute('data-booking-id')) !== clean(booking.booking_id || booking.id)) return
              if (repaintCancellation && typeof settings.refreshDetail === 'function') {
                settings.refreshDetail(modal, booking)
              }
            } catch (error) {
              console.error(
                '[dashboard-call-actions] cancellation repaint failed:',
                error && error.message,
              )
              return
            }
          }
          if (reason.field) reason.field.value = ''
          fillCounterpartPlaceholders(modal, config.successContent, settings.role, booking)
          switchPopupContent(modal, config.successContent)
          restartAfterModalClose(document, modal, settings.restart)
        } catch (error) {
          console.error(
            '[dashboard-call-actions] ' + step.kind + ' failed closed:',
            error && error.message,
          )
          showActionError(modal, (error && error.message) || config.failureMessage)
        } finally {
          try {
            await releaseMutationClaim(settings, mutationClaim)
          } finally {
            await releaseMutationSlot(releaseAction)
            button.__startersActionBusy = false
            releaseBusy()
          }
        }
      },
      true,
    )
    return true
  }

  const api = {
    PAID_EDIT_OPEN_ENVIRONMENTS,
    PAID_HOLD_CANCEL_OPEN_ENVIRONMENTS,
    PAID_RESCHEDULE_OPEN_ENVIRONMENTS,
    PAID_CONFIRMED_CANCEL_LEAD_MS,
    PAID_LATE_CANCEL_FEE_WINDOW_MS,
    CANCEL_FEE_TEXT,
    PAID_PROPOSED_START_MESSAGE,
    paidHoldCancelAdmitted,
    paidSavedCardState,
    paidPendingEditAdmitted,
    paidProposedStartAllowed,
    paidRescheduleProposeAdmitted,
    paidRescheduleLastAcceptTime,
    paidRescheduleRespondAdmitted,
    paidProposalLapseTime,
    cancelFeeText,
    renderCancelFeeNote,
    canCancel,
    canDecline,
    counterpartName,
    fillCounterpartPlaceholders,
    bindCanonicalClock,
    canonicalNow,
    monotonicNow,
    canConfirmReschedule,
    PENDING_PROPOSE_OPEN_ENVIRONMENTS,
    F08_ACCEPT_ENABLED,
    PENDING_PROPOSE_LEAD_MS,
    PENDING_PROPOSE_START_MESSAGE,
    pendingOfferOpen,
    pendingOfferProposer,
    canProposePending,
    canRespondPending,
    canAcceptPendingOffer,
    canDeclinePendingOffer,
    pendingProposedStartAllowed,
    pendingProposeSlots,
    pendingOfferControlLabel,
    applyPendingOfferControls,
    respondKindFor,
    setF08AcceptEnabledForTest,
    canAct,
    canProposeReschedule,
    canRequestReschedule,
    rescheduleKindFor,
    canRespondReschedule,
    canKeepCurrentTime,
    hideKeepCurrentTime,
    setKeepCurrentTimeEnabledForTest,
    ensureRescheduleViews,
    normalizeRescheduleViewCopy,
    applyRescheduleContractCopy,
    mountRescheduleCalendar,
    proposeReschedule,
    respondReschedule,
    resetRescheduleState,
    cancelAttemptKey,
    cancelBooking,
    cancelPayload,
    cancelStorageKey,
    cancelSucceeded,
    clearCancelAttemptKey,
    clearDeclineAttemptKey,
    declineAttemptKey,
    declineBooking,
    declinePayload,
    declineStorageKey,
    closeDetailModal,
    declineSucceeded,
    markActionBusy,
    showActionError,
    switchPopupContent,
    validAttemptKey,
    wire,
  }
  if (isCommonJs) module.exports = api
  else global.StartersDashboardCallActions = api
})(typeof window === 'undefined' ? globalThis : window)
