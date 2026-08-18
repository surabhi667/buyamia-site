import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-hardening-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()
  async function request(path, { method = 'GET', body, cookie, headers: extraHeaders = {}, origin } = {}) {
    const headers = { ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    if (origin) headers.Origin = origin
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { response, payload: text ? JSON.parse(text) : null }
  }
  return { request, store }
}

async function signup(request, email = `hardening-${Date.now()}-${Math.random()}@example.com`) {
  const { response, payload } = await request('/api/auth/signup', { method: 'POST', body: { name: 'Hardening User', email, password: 'StrongPassword123' } })
  assert.equal(response.status, 201)
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: payload.data.user }
}

test('private APIs ignore legacy X-User headers and require the HttpOnly session cookie', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/account', { headers: { 'X-User-Id': 'legacy-user', 'X-User-Name': 'Legacy User' } })

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('mutating API routes reject forbidden origins consistently', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  const { response, payload } = await request('/api/support/tickets', {
    method: 'POST',
    cookie,
    origin: 'https://evil.example',
    body: { title: 'Origin check', description: 'This cross-site request must be rejected.', categoryId: 'orders' },
  })

  assert.equal(response.status, 403)
  assert.equal(payload.error.code, 'ORIGIN_NOT_ALLOWED')
})

test('session management keeps the active cookie while revoking other sessions', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request, 'sessions-hardening@example.com')
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'sessions-hardening@example.com', password: 'StrongPassword123' } })
  assert.equal(login.response.status, 200)
  const secondCookie = login.response.headers.get('set-cookie').split(';')[0]

  const sessions = await request('/api/account/sessions', { cookie: secondCookie })
  assert.equal(sessions.response.status, 200)
  assert.equal(sessions.payload.data.length, 2)
  assert.equal(sessions.payload.data.filter((item) => item.current).length, 1)

  const revoked = await request('/api/account/security/logout-all', { method: 'POST', cookie: secondCookie })
  assert.equal(revoked.response.status, 200)
  assert.equal(revoked.payload.data.activeSessions.length, 1)
  assert.equal(revoked.payload.data.activeSessions[0].current, true)

  const oldSession = await request('/api/auth/session', { cookie })
  const currentSession = await request('/api/auth/session', { cookie: secondCookie })
  assert.equal(oldSession.response.status, 401)
  assert.equal(currentSession.response.status, 200)
  assert.equal(currentSession.payload.data.user.userId, user.userId)

  const state = await store.getState()
  assert.equal(state.accountSecurity.find((item) => item.userId === user.userId).activeSessions.length, 1)
})

test('support ticket creation is idempotent for repeated submission keys', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie } = await signup(request)
  const body = { title: 'Order assistance', description: 'Please help me verify my order details.', categoryId: 'orders', priority: 'normal' }
  const first = await request('/api/support/tickets', { method: 'POST', cookie, headers: { 'Idempotency-Key': 'support-key-1' }, body })
  const second = await request('/api/support/tickets', { method: 'POST', cookie, headers: { 'Idempotency-Key': 'support-key-1' }, body })

  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 200)
  assert.equal(second.payload.data.id, first.payload.data.id)
  assert.equal((await store.read('supportTickets')).length, 1)
})

test('auction bids validate amount and are idempotent for repeated submission keys', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie } = await signup(request)
  const low = await request('/api/auctions/auction-chair-1/bids', { method: 'POST', cookie, body: { amount: 1000000 } })
  assert.equal(low.response.status, 409)
  assert.equal(low.payload.error.code, 'BID_TOO_LOW')

  const first = await request('/api/auctions/auction-chair-1/bids', { method: 'POST', cookie, headers: { 'Idempotency-Key': 'bid-key-1' }, body: { amount: 1050000 } })
  const second = await request('/api/auctions/auction-chair-1/bids', { method: 'POST', cookie, headers: { 'Idempotency-Key': 'bid-key-1' }, body: { amount: 1050000 } })
  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 200)
  assert.equal(second.payload.bid.id, first.payload.bid.id)
  assert.equal((await store.read('auctionBids')).filter((item) => item.userId === first.payload.bid.userId && item.idempotencyKey === 'bid-key-1').length, 1)
})

test('supplier category mutations require ownership or administrator access', async (t) => {
  const { request, store } = await withApi(t)
  const owner = await signup(request, 'supplier-owner@example.com')
  const other = await signup(request, 'supplier-other@example.com')
  await store.mutate((db) => {
    db.sellerProfiles.push({ id: 'seller-owner', userId: owner.user.userId, brandId: null, companyName: 'Owner Studio', displayName: 'Owner Studio', email: 'owner@example.com', phone: '+62 812 111 2222', country: 'Indonesia', location: 'Bali', categories: ['furniture'], verificationStatus: 'approved', public: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    db.sellerProfiles.push({ id: 'seller-other', userId: other.user.userId, brandId: null, companyName: 'Other Studio', displayName: 'Other Studio', email: 'other@example.com', phone: '+62 812 333 4444', country: 'Indonesia', location: 'Bali', categories: ['furniture'], verificationStatus: 'approved', public: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  })
  const created = await request('/api/categories', { method: 'POST', cookie: owner.cookie, body: { name: 'Private Supplier Category', description: 'Special supplier catalog category' } })
  assert.equal(created.response.status, 201)

  const denied = await request(`/api/categories/${created.payload.data.id}`, { method: 'PATCH', cookie: other.cookie, body: { name: 'Renamed by other supplier' } })
  assert.equal(denied.response.status, 403)
  assert.equal(denied.payload.error.code, 'CATEGORY_NOT_OWNED')
})
