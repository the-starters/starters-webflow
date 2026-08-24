const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-call-media.js')

function booking() {
  return {
    status: 'completed',
    notetaker_id: 'notetaker-1',
    grant_id: 'grant-1',
  }
}

test('media reads require a completed canonical booking identity', () => {
  assert.equal(api.canReadMedia(booking()), true)
  assert.equal(api.canReadMedia({ ...booking(), status: 'confirmed' }), false)
  assert.equal(api.canReadMedia({ ...booking(), grant_id: '' }), false)
  assert.equal(api.canReadMedia({ ...booking(), notetaker_id: '' }), false)
})

test('media normalization allows only HTTPS provider URLs', () => {
  assert.deepEqual(
    api.normalizeMedia({
      response: {
        status: 200,
        result: {
          data: {
            audio: { url: 'https://media.example/recording', duration: 61 },
            transcript: { url: 'https://media.example/transcript' },
          },
        },
      },
    }),
    {
      recording_url: 'https://media.example/recording',
      recording_duration: 61,
      transcript_available: true,
    },
  )
  assert.deepEqual(
    api.normalizeMedia({
      response: {
        status: 200,
        result: {
          data: {
            recording: { url: 'javascript:alert(1)' },
            transcript: { url: 'http://unsafe.example/transcript' },
          },
        },
      },
    }),
    {
      recording_url: '',
      recording_duration: 0,
      transcript_available: false,
    },
  )
  assert.equal(api.normalizeMedia({ response: { status: 403 } }), null)
})

test('media uses the authenticated V3 ownership proxy only', async () => {
  const original = global.xanoAuthFetch
  const requests = []
  try {
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            response: {
              status: 200,
              result: {
                data: {
                  recording: { url: 'https://media.example/recording' },
                },
              },
            },
          }
        },
      }
    }
    const media = await api.getMedia(booking())
    assert.equal(media.recording_url, 'https://media.example/recording')
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/notetaker\/get_media\/v3$/)
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      notetaker_id: 'notetaker-1',
      grant_id: 'grant-1',
    })
  } finally {
    global.xanoAuthFetch = original
  }
})

test('transcript provider URL is never returned to the browser consumer', () => {
  const media = api.normalizeMedia({
    response: {
      status: 200,
      result: {
        data: {
          recording: { url: 'https://media.example/recording' },
          transcript: { url: 'https://private.example/transcript' },
        },
      },
    },
  })
  assert.equal(Object.hasOwn(media, 'transcript_url'), false)
  assert.equal(media.transcript_available, true)
})
