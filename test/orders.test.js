import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

const password = 'StrongPassword123'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-orders-'))
  testContext.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  testContext.after(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const { port } = server.address()
  async function request(path, { method = 'GET', body, cookie, headers: extraHeaders = {}, origin } = {}) {
    const headers = { ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    if (origin) headers.Origin = origin
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    return { response, payload: text ? JSON.parse(text) : null }
  }

  return { request, store }
}

function sessionCookie(response) {
  const header = response.headers.get('set-cookie')
  assert.match(header, /buyamia_session=/)
  return header.split(';')[0]
}

async function signup(request, email = `buyer-${Date.now()}@example.com`) {
  const { response, payload } = await request('/api/auth/signup', { method: 'POST', body: { email, password, name: 'Order Buyer' } })
  assert.equal(response.status, 201)
  return { cookie: sessionCookie(response), user: payload.data.user }
}

async function addCartItem(request, cookie, body = {}) {
  const { response, payload } = await request('/api/cart/items', {
    method: 'POST',
    cookie,
    body: { productId: 'prod-bamboo-table', quantity: 1, ...body },
  })
  assert.equal(response.status, 201)
  return payload.data
}

async function saveDelivery(request, cookie) {
  const { response } = await request('/api/checkout', {
    method: 'POST',
    cookie,
    body: {
      step: 'delivery',
      shipping: {
        firstName: 'Order',
        lastName: 'Buyer',
        country: 'Indonesia',
        addressLine1: 'Jl. Test 1',
        city: 'Jakarta',
        region: 'Jakarta',
        zipCode: '10110',
        phone: '+62 123 456 789',
      },
    },
  })
  assert.equal(response.status, 200)
}

async function createOrder(request, cookie, key = `order-key-${Date.now()}`, body = {}) {
  return request('/api/orders', {
    method: 'POST',
    cookie,
    headers: { 'Idempotency-Key': key },
    body,
  })
}

function assertNoSensitiveData(value) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, /cardNumber|securityCode|cvc|cvv|paymentToken|idempotencyKey|tokenHash|passwordHash/i)
}

test('order creation persists an authenticated user order and clears the cart', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)
  await saveDelivery(request, cookie)

  const { response, payload } = await createOrder(request, cookie, 'create-success')

  assert.equal(response.status, 201)
  assert.match(payload.data.orderNumber, /^BYA-\d{8}-[A-Z0-9]{8}$/)
  assert.equal(payload.data.status, 'pending_payment')
  assert.equal(payload.data.statusLabel, 'Payment pending')
  assert.equal(payload.data.items.length, 1)
  assert.equal(payload.data.shippingAddress.line1, 'Jl. Test 1')
  assert.equal(payload.data.payment.label, 'Payment pending')
  assert.equal(payload.data.discount, 150000)
  assert.equal(payload.data.discountLabel, 'Welcome discount (10%)')
  assert.deepEqual(payload.data.discounts.map((item) => ({ type: item.type, percent: item.percent, amount: item.amount })), [{ type: 'welcome-first-order', percent: 10, amount: 150000 }])
  assert.equal(payload.data.total, 1700000)
  assertNoSensitiveData(payload)

  const cart = await request('/api/cart', { cookie })
  assert.equal(cart.payload.data.items.length, 0)
  const state = await store.getState()
  assert.equal(state.orders.length, 2)
  const welcome = state.welcomeDiscounts.find((item) => item.userId === user.id)
  assert.equal(welcome.status, 'used')
  assert.equal(welcome.orderId, payload.data.id)
})

test('order creation rejects unauthenticated requests', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'no-auth' },
    body: {},
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('order creation rejects an empty cart', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  const { response, payload } = await createOrder(request, cookie, 'empty-cart')

  assert.equal(response.status, 409)
  assert.equal(payload.error.code, 'EMPTY_CART')
})

test('order creation recalculates prices server-side and ignores falsified client prices', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)
  await store.mutate((db) => {
    const item = db.cartItems.find((entry) => entry.userId === user.id)
    item.unitPrice = 1
  })

  const { response, payload } = await createOrder(request, cookie, 'forged-price', { total: 1, items: [{ productId: 'prod-bamboo-table', unitPrice: 1 }] })

  assert.equal(response.status, 201)
  assert.equal(payload.data.items[0].unitPrice, 1500000)
  assert.equal(payload.data.items[0].lineTotal, 1500000)
  assert.equal(payload.data.discount, 150000)
  assert.equal(payload.data.total, 1700000)
})

test('order creation rejects invalid cart quantity and keeps the cart', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)
  await store.mutate((db) => {
    const item = db.cartItems.find((entry) => entry.userId === user.id)
    item.quantity = 0
  })

  const { response, payload } = await createOrder(request, cookie, 'invalid-quantity')

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'INVALID_CART_QUANTITY')
  const state = await store.getState()
  assert.equal(state.cartItems.some((item) => item.userId === user.id), true)
  assert.equal(state.welcomeDiscounts.find((item) => item.userId === user.id).status, 'eligible')
})

test('order creation rejects invalid promotions and preserves the cart', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)
  await store.mutate((db) => {
    db.cartCoupons.push({ userId: user.id, code: 'BADPROMO', appliedAt: new Date().toISOString() })
  })

  const { response, payload } = await createOrder(request, cookie, 'invalid-promo')

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'INVALID_COUPON')
  const state = await store.getState()
  assert.equal(state.cartItems.some((item) => item.userId === user.id), true)
})

test('order creation refuses to combine welcome discount with another promotion', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)
  await store.mutate((db) => {
    db.cartCoupons.push({ userId: user.id, code: 'BUYAMIA10', appliedAt: new Date().toISOString() })
  })

  const { response, payload } = await createOrder(request, cookie, 'welcome-plus-coupon')

  assert.equal(response.status, 409)
  assert.equal(payload.error.code, 'PROMOTION_NOT_COMBINABLE')
  const state = await store.getState()
  assert.equal(state.cartItems.some((item) => item.userId === user.id), true)
  assert.equal(state.welcomeDiscounts.find((item) => item.userId === user.id).status, 'eligible')
})

test('order creation is idempotent for repeated keys', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)

  const first = await createOrder(request, cookie, 'double-click')
  const second = await createOrder(request, cookie, 'double-click')

  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 200)
  assert.equal(second.payload.data.id, first.payload.data.id)
  assert.equal(first.payload.data.discount, 150000)
  assert.equal(second.payload.data.discount, 150000)
  const state = await store.getState()
  assert.equal(state.orders.filter((item) => item.userId === user.id).length, 1)
  assert.equal(state.welcomeDiscounts.filter((item) => item.userId === user.id && item.status === 'used').length, 1)
})

test('welcome discount does not apply to a second order', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)
  const first = await createOrder(request, cookie, 'first-welcome-order')
  await addCartItem(request, cookie)
  const secondCart = await request('/api/cart', { cookie })
  const second = await createOrder(request, cookie, 'second-without-welcome')

  assert.equal(first.response.status, 201)
  assert.equal(first.payload.data.discount, 150000)
  assert.equal(secondCart.payload.data.summary.welcomeDiscount.eligible, false)
  assert.equal(secondCart.payload.data.summary.discount, 0)
  assert.equal(second.response.status, 201)
  assert.equal(second.payload.data.discount, 0)
  assert.equal(second.payload.data.total, 1850000)
  const state = await store.getState()
  assert.equal(state.welcomeDiscounts.filter((item) => item.userId === user.id && item.status === 'used').length, 1)
  assert.equal(state.orders.filter((item) => item.userId === user.id).length, 2)
})

test('orders are isolated between users', async (t) => {
  const { request } = await withApi(t)
  const first = await signup(request, 'first@example.com')
  const second = await signup(request, 'second@example.com')
  await addCartItem(request, first.cookie)
  const created = await createOrder(request, first.cookie, 'first-order')

  const detail = await request(`/api/orders/${created.payload.data.id}`, { cookie: second.cookie })
  const list = await request('/api/orders', { cookie: second.cookie })

  assert.equal(detail.response.status, 404)
  assert.equal(list.response.status, 200)
  assert.equal(list.payload.data.length, 0)
})

test('orders list and detail return order data without sensitive fields', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  await addCartItem(request, cookie)
  const created = await createOrder(request, cookie, 'list-detail')

  const list = await request('/api/orders?limit=20', { cookie })
  const detail = await request(`/api/orders/${created.payload.data.id}`, { cookie })

  assert.equal(list.response.status, 200)
  assert.equal(list.payload.data.length, 1)
  assert.equal(list.payload.data[0].orderNumber, created.payload.data.orderNumber)
  assert.equal(detail.response.status, 200)
  assert.equal(detail.payload.data.timeline.some((entry) => entry.status === 'delivered' && entry.reached === false), true)
  assertNoSensitiveData(list.payload)
  assertNoSensitiveData(detail.payload)
})

test('order creation rejects forbidden origins without CORS authorization headers', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  await addCartItem(request, cookie)

  const { response, payload } = await request('/api/orders', {
    method: 'POST',
    cookie,
    origin: 'https://evil.example.com',
    headers: { 'Idempotency-Key': 'bad-origin' },
    body: {},
  })

  assert.equal(response.status, 403)
  assert.equal(payload.error.code, 'ORIGIN_NOT_ALLOWED')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
  const state = await store.getState()
  assert.equal(state.orders.some((item) => item.userId === user.id), false)
  assert.equal(state.cartItems.some((item) => item.userId === user.id), true)
})

test('order creation refuses card data in the order payload', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  await addCartItem(request, cookie)

  const { response, payload } = await createOrder(request, cookie, 'sensitive-card', { card: { cardNumber: '4111111111111111', securityCode: '123' } })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'SENSITIVE_PAYMENT_DATA')
})
