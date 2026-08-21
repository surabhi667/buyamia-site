import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-logout-feedback-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()
  async function request(path, { method = 'GET', body, cookie } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    return { response, payload: JSON.parse(await response.text()) }
  }
  return { request, store }
}

async function authenticatedSession(request) {
  const signup = await request('/api/auth/signup', { method: 'POST', body: { name: 'Feedback User', email: `feedback-${Date.now()}-${Math.random()}@example.com`, password: 'StrongPassword123' } })
  assert.equal(signup.response.status, 201)
  return { cookie: signup.response.headers.get('set-cookie').split(';')[0], userId: signup.payload.data.user.userId }
}

test('authenticated logout feedback stores the server-side user and optional fields', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, userId } = await authenticatedSession(request)
  const result = await request('/api/feedback/logout', { method: 'POST', cookie, body: { rating: 'GOOD', reasons: ['EASY_TO_USE', 'GOOD_PRODUCTS'], comment: 'The marketplace was easy to browse.' } })

  assert.equal(result.response.status, 201)
  const rows = await store.read('feedbackSubmissions')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { id: rows[0].id, userId, rating: 'GOOD', reasons: ['EASY_TO_USE', 'GOOD_PRODUCTS'], comment: 'The marketplace was easy to browse.', source: 'LOGOUT_SURVEY', status: 'received', createdAt: rows[0].createdAt })
  assert.equal('email' in rows[0], false)
})

test('logout feedback requires an authenticated session', async (t) => {
  const { request } = await withApi(t)
  const result = await request('/api/feedback/logout', { method: 'POST', body: { rating: 'GOOD' } })
  assert.equal(result.response.status, 401)
  assert.equal(result.payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('logout feedback rejects invalid ratings and reasons', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await authenticatedSession(request)
  const invalidRating = await request('/api/feedback/logout', { method: 'POST', cookie, body: { rating: 'EXCELLENT' } })
  const invalidReason = await request('/api/feedback/logout', { method: 'POST', cookie, body: { rating: 'GOOD', reasons: ['PASSWORD'] } })
  assert.equal(invalidRating.response.status, 400)
  assert.equal(invalidRating.payload.error.code, 'VALIDATION_ERROR')
  assert.equal(invalidReason.response.status, 400)
  assert.equal(invalidReason.payload.error.code, 'VALIDATION_ERROR')
})

test('logout feedback rejects comments over 500 characters and accepts omitted comments', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie } = await authenticatedSession(request)
  const tooLong = await request('/api/feedback/logout', { method: 'POST', cookie, body: { rating: 'BAD', comment: 'x'.repeat(501) } })
  const omitted = await request('/api/feedback/logout', { method: 'POST', cookie, body: { rating: 'OKAY' } })
  assert.equal(tooLong.response.status, 400)
  assert.equal(tooLong.payload.error.code, 'VALIDATION_ERROR')
  assert.equal(omitted.response.status, 201)
  assert.equal((await store.read('feedbackSubmissions'))[0].comment, null)
})
