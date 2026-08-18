import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-admin-'))
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
    const raw = await response.text()
    return { response, payload: raw ? JSON.parse(raw) : null }
  }
  return { request, store }
}

async function signup(request, email) {
  const result = await request('/api/auth/signup', { method: 'POST', body: { name: 'Admin Test', email, password: 'StrongPassword123' } })
  assert.equal(result.response.status, 201)
  return { cookie: result.response.headers.get('set-cookie').split(';')[0], userId: result.payload.data.user.userId }
}

async function makeAdmin(store, userId) {
  await store.mutate((db) => { db.accounts.find((item) => item.userId === userId).role = 'administrator' })
}

test('admin APIs reject unauthenticated and regular users', async (t) => {
  const { request, store } = await withApi(t)
  const anonymous = await request('/api/admin/dashboard')
  assert.equal(anonymous.response.status, 401)
  const regular = await signup(request, 'regular-admin-test@example.com')
  const forbidden = await request('/api/admin/dashboard', { cookie: regular.cookie })
  assert.equal(forbidden.response.status, 403)
  assert.equal(forbidden.payload.error.code, 'ADMIN_ACCESS_REQUIRED')
  assert.equal((await store.read('securityEvents')).at(-1).type, 'unauthorized_admin_access')
})

test('authorized administrator can load dashboard without secrets', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'dashboard-admin@example.com'); await makeAdmin(store, admin.userId)
  const result = await request('/api/admin/dashboard', { cookie: admin.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(typeof result.payload.data.metrics.activeProducts, 'number')
  assert.equal(JSON.stringify(result.payload).includes('passwordHash'), false)
  assert.equal(JSON.stringify(result.payload).includes('tokenHash'), false)
})

test('user suspension revokes sessions, blocks login, and records security activity', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'security-admin@example.com'); await makeAdmin(store, admin.userId)
  const target = await signup(request, 'suspended-user@example.com')
  const suspended = await request(`/api/admin/users/${target.userId}`, { method: 'PATCH', cookie: admin.cookie, body: { status: 'suspended', reason: 'Confirmed account security review' } })
  assert.equal(suspended.response.status, 200)
  const oldSession = await request('/api/auth/session', { cookie: target.cookie })
  assert.equal(oldSession.response.status, 401)
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'suspended-user@example.com', password: 'StrongPassword123' } })
  assert.equal(login.response.status, 403)
  assert.equal(login.payload.error.code, 'ACCOUNT_SUSPENDED')
  const security = await request('/api/admin/security', { cookie: admin.cookie })
  assert.equal(security.response.status, 200)
  assert.equal(security.payload.data.events.some((item) => item.type === 'suspended_account_login'), true)
})

test('supplier administration reuses supplier profiles and writes audit entries', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'supplier-admin@example.com'); await makeAdmin(store, admin.userId)
  const created = await request('/api/admin/suppliers', { method: 'POST', cookie: admin.cookie, body: { companyName: 'Admin Added Studio', contactName: 'Studio Owner', email: 'studio@example.com', phone: '+62 812 555 0101', country: 'Indonesia', categoryId: 'furniture', website: 'https://example.com', verificationStatus: 'pending-review', reason: 'Manually reviewed supplier lead' } })
  assert.equal(created.response.status, 201)
  assert.equal(created.payload.data.manuallyCreated, true)
  const approved = await request(`/api/admin/suppliers/${created.payload.data.id}`, { method: 'PATCH', cookie: admin.cookie, body: { status: 'approved', reason: 'Business documents reviewed' } })
  assert.equal(approved.response.status, 200)
  assert.equal(approved.payload.data.public, true)
  assert.deepEqual((await store.read('adminAuditLogs')).map((item) => item.action), ['supplier.create', 'supplier.approved'])
})

test('administrator approval converts a submitted seller application into a supplier profile', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'review-admin@example.com'); await makeAdmin(store, admin.userId)
  const seller = await signup(request, 'seller-applicant@example.com')
  const applicationBody = { companyName: 'Applicant Studio', legalName: 'Applicant Studio Ltd', email: 'seller-applicant@example.com', phone: '+62 812 555 0202', country: 'Indonesia', address: 'Jl. Applicant 1, Bali', warehouseAddress: '', categories: ['furniture'], brandName: 'Applicant Studio', taxId: '', termsAccepted: true }
  const created = await request('/api/seller/application', { method: 'POST', cookie: seller.cookie, body: applicationBody })
  assert.equal(created.response.status, 201)
  const document = await request('/api/seller/documents', { method: 'POST', cookie: seller.cookie, body: { name: 'registration.pdf', type: 'business-registration', mimeType: 'application/pdf', size: 1024 } })
  assert.equal(document.response.status, 201)
  const submitted = await request('/api/seller/application/submit', { method: 'POST', cookie: seller.cookie })
  assert.equal(submitted.response.status, 200)
  const approved = await request(`/api/admin/suppliers/${created.payload.data.id}`, { method: 'PATCH', cookie: admin.cookie, body: { status: 'approved', reason: 'Registration document verified' } })
  assert.equal(approved.response.status, 200)
  assert.equal(approved.payload.data.verificationStatus, 'approved')
  assert.equal((await store.read('sellerProfiles')).some((item) => item.userId === seller.userId && item.public), true)
})

test('refund workflow never claims provider execution and enforces eligible amount', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'refund-admin@example.com'); await makeAdmin(store, admin.userId)
  const created = await request('/api/admin/refunds', { method: 'POST', cookie: admin.cookie, body: { orderId: 'order-demo-1001', amount: 500000, reason: 'Customer order issue confirmed', confirmed: true } })
  assert.equal(created.response.status, 201)
  assert.equal(created.payload.data.status, 'payment_provider_not_configured')
  assert.equal(created.payload.data.providerExecuted, false)
  const excessive = await request('/api/admin/refunds', { method: 'POST', cookie: admin.cookie, body: { orderId: 'order-demo-1001', amount: 1000001, reason: 'Attempt beyond remaining amount', confirmed: true } })
  assert.equal(excessive.response.status, 409)
  assert.equal(excessive.payload.error.code, 'REFUND_AMOUNT_EXCEEDED')
  assert.equal((await store.read('adminAuditLogs')).at(-1).action, 'refund.request')
})

test('Amia administration exposes configuration status but never provider secrets', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'amia-admin@example.com'); await makeAdmin(store, admin.userId)
  const updated = await request('/api/admin/amia', { method: 'PATCH', cookie: admin.cookie, body: { enabled: false, moderation: 'strict', capabilities: ['products', 'suppliers'], reason: 'Temporary controlled maintenance' } })
  assert.equal(updated.response.status, 200)
  const status = await request('/api/admin/amia', { cookie: admin.cookie })
  assert.equal(status.response.status, 200)
  assert.equal(status.payload.data.provider.secretExposed, false)
  assert.equal('key' in status.payload.data.provider, false)
  assert.equal((await store.read('adminAuditLogs')).at(-1).action, 'amia.configuration.update')
})
