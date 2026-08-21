import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'
import { ApiError, paginate } from '../server/services.js'
import { NotificationStatus, NotificationType, createNotificationService } from '../server/notifications.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-notifications-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()
  async function request(path, { method = 'GET', body, cookie } = {}) {
    const headers = {}; if (body !== undefined) headers['Content-Type'] = 'application/json'; if (cookie) headers.Cookie = cookie
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const raw = await response.text(); return { response, payload: raw ? JSON.parse(raw) : null }
  }
  return { request, store }
}

async function signup(request, email) {
  const result = await request('/api/auth/signup', { method: 'POST', body: { name: 'Notification User', email, password: 'StrongPassword123' } })
  assert.equal(result.response.status, 201)
  return { cookie: result.response.headers.get('set-cookie').split(';')[0], userId: result.payload.data.user.userId }
}

test('supplier verification creates an in-app notification for the affected supplier', async (t) => {
  const { request, store } = await withApi(t)
  const admin = await signup(request, 'notification-admin@example.com')
  const supplier = await signup(request, 'notification-supplier@example.com')
  await store.mutate((db) => {
    db.accounts.find((item) => item.userId === admin.userId).role = 'administrator'
    db.sellerApplications.push({ id: 'notification-application', userId: supplier.userId, companyName: 'Notification Studio', brandName: 'Notification Studio', legalName: 'Notification Studio Ltd', email: 'notification-supplier@example.com', phone: '+628123456789', country: 'Indonesia', categories: ['furniture'], status: 'submitted', verificationStatus: 'pending-review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  })
  const approved = await request('/api/admin/suppliers/notification-application', { method: 'PATCH', cookie: admin.cookie, body: { status: 'approved', reason: 'Supplier documents were verified' } })
  const listed = await request('/api/notifications', { cookie: supplier.cookie })
  assert.equal(approved.response.status, 200)
  assert.equal(listed.response.status, 200)
  assert.equal(listed.payload.data.length, 1)
  assert.equal(listed.payload.data[0].type, NotificationType.SUPPLIER_VERIFIED)
  assert.equal(listed.payload.data[0].recipientId, supplier.userId)
  assert.equal(listed.payload.data[0].status, NotificationStatus.DELIVERED)
})

test('notification APIs isolate ownership and update only the current user read state', async (t) => {
  const { request, store } = await withApi(t)
  const first = await signup(request, 'notification-first@example.com')
  const second = await signup(request, 'notification-second@example.com')
  const service = createNotificationService(store, { ApiError, paginate })
  const [firstNotification] = await service.publish({ recipientIds: [first.userId], type: NotificationType.ORDER_CONFIRMED, payload: { orderId: 'order-first', orderNumber: 'BYA-FIRST' } })
  await service.publish({ recipientIds: [first.userId, second.userId], type: NotificationType.BUYING_POOL_JOINED, payload: { poolId: 'pool-one', poolTitle: 'Pool One' } })

  const forbiddenRead = await request(`/api/notifications/${firstNotification.id}`, { cookie: second.cookie })
  assert.equal(forbiddenRead.response.status, 404)
  const count = await request('/api/notifications/unread-count', { cookie: first.cookie })
  assert.equal(count.payload.data.count, 2)
  const readOne = await request(`/api/notifications/${firstNotification.id}/read`, { method: 'PATCH', cookie: first.cookie })
  assert.equal(readOne.response.status, 200)
  assert.equal(typeof readOne.payload.data.readAt, 'string')
  const readAll = await request('/api/notifications/read-all', { method: 'PATCH', cookie: first.cookie })
  assert.equal(readAll.payload.data.updated, 1)
  const secondCount = await request('/api/notifications/unread-count', { cookie: second.cookie })
  assert.equal(secondCount.payload.data.count, 1)
})

test('notification list is paginated and includes unread count', async (t) => {
  const { request, store } = await withApi(t)
  const user = await signup(request, 'notification-pagination@example.com')
  const service = createNotificationService(store, { ApiError, paginate })
  for (let index = 0; index < 5; index += 1) await service.publish({ recipientIds: [user.userId], type: NotificationType.ORDER_CONFIRMED, payload: { orderId: `order-${index}`, orderNumber: `BYA-${index}` } })
  const page = await request('/api/notifications?page=2&limit=2', { cookie: user.cookie })
  assert.equal(page.response.status, 200)
  assert.equal(page.payload.data.length, 2)
  assert.deepEqual(page.payload.meta, { page: 2, limit: 2, total: 5, pages: 3, unread: 5 })
})

test('disabled in-app preference skips non-critical notifications', async (t) => {
  const { request, store } = await withApi(t)
  const user = await signup(request, 'notification-preference@example.com')
  const preference = await request('/api/preferences', { method: 'PATCH', cookie: user.cookie, body: { notifications: { inApp: false } } })
  assert.equal(preference.response.status, 200)
  const service = createNotificationService(store, { ApiError, paginate })
  const normal = await service.publish({ recipientIds: [user.userId], type: NotificationType.ORDER_CONFIRMED, payload: { orderId: 'normal', orderNumber: 'NORMAL' } })
  const critical = await service.publish({ recipientIds: [user.userId], type: NotificationType.ORDER_CONFIRMED, critical: true, priority: 'HIGH', payload: { orderId: 'critical', orderNumber: 'CRITICAL' } })
  assert.equal(normal.length, 0)
  assert.equal(critical.length, 1)
})

test('notification payload removes sensitive values recursively', async (t) => {
  const { request, store } = await withApi(t)
  const user = await signup(request, 'notification-safe@example.com')
  const service = createNotificationService(store, { ApiError, paginate })
  await service.publish({ recipientIds: [user.userId], type: NotificationType.ORDER_CONFIRMED, payload: { orderId: 'safe-order', orderNumber: 'SAFE', password: 'never-store', nested: { apiToken: 'never-store', allowed: true }, cardNumber: '4111111111111111' } })
  const serialized = JSON.stringify((await store.read('notifications'))[0])
  assert.equal(serialized.includes('never-store'), false)
  assert.equal(serialized.includes('4111111111111111'), false)
  assert.equal(JSON.parse(serialized).payload.nested.allowed, true)
})

test('notification endpoints require authentication', async (t) => {
  const { request } = await withApi(t)
  for (const path of ['/api/notifications', '/api/notifications/unread-count', '/api/notifications/arbitrary']) {
    const result = await request(path)
    assert.equal(result.response.status, 401)
  }
})
