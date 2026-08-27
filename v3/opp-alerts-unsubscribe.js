(function () {
  'use strict'

  var ENDPOINT =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/notifications/unsubscribe'

  function initOpportunityAlertsUnsubscribe() {
    var root = document.getElementById('oa-unsub')
    if (!root || root.getAttribute('data-oa-ready') === 'true') return
    root.setAttribute('data-oa-ready', 'true')

    var find = function (name) {
      return root.querySelector('[data-oa="' + name + '"]')
    }
    var intro = find('intro')
    var unsubscribeButton = find('unsub')
    var resubscribeButton = find('resub')
    var status = find('status')

    if (!intro || !unsubscribeButton || !resubscribeButton || !status) return

    function memberId() {
      try {
        return new URLSearchParams(window.location.search).get('m') || ''
      } catch (_error) {
        return ''
      }
    }

    function showStatus(message, state) {
      status.textContent = message
      status.setAttribute('data-state', state)
      status.hidden = false
    }

    function sendPreference(resubscribe, button, workingLabel, onDone) {
      button.disabled = true
      button.textContent = workingLabel

      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberstack_id: memberId(),
          resubscribe: Boolean(resubscribe),
        }),
      })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
        .then(onDone)
        .catch(function () {
          button.disabled = false
          button.textContent = button.getAttribute('data-label')
          showStatus('Something went wrong. Please try again.', 'err')
        })
    }

    var memberstackId = memberId()
    if (!memberstackId) {
      intro.textContent =
        'This link is missing its identifier. Please open the unsubscribe link directly from the email we sent you.'
      unsubscribeButton.hidden = true
      return
    }

    unsubscribeButton.setAttribute('data-label', 'Unsubscribe me')
    resubscribeButton.setAttribute('data-label', 'Re-subscribe')

    unsubscribeButton.addEventListener('click', function () {
      sendPreference(false, unsubscribeButton, 'Unsubscribing…', function () {
        intro.hidden = true
        unsubscribeButton.hidden = true
        showStatus(
          'You’ve been unsubscribed from opportunity alert emails.',
          'ok',
        )
        resubscribeButton.hidden = false
      })
    })

    resubscribeButton.addEventListener('click', function () {
      sendPreference(true, resubscribeButton, 'Re-subscribing…', function () {
        resubscribeButton.hidden = true
        showStatus(
          'You’re re-subscribed. You’ll receive opportunity alerts again.',
          'ok',
        )
      })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initOpportunityAlertsUnsubscribe,
      { once: true },
    )
  } else {
    initOpportunityAlertsUnsubscribe()
  }
})()
