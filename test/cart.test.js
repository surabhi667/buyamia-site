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
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-cart-'))
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
  async function request(path, { method = 'GET', body, cookie, headers: extraHeaders = {} } = {}) {
    const headers = { ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
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

async function signup(request, email = `cart-${Date.now()}@example.com`) {
  const { response, payload } = await request('/api/auth/signup', { method: 'POST', body: { email, password, name: 'Cart Buyer' } })
  assert.equal(response.status, 201)
  return { cookie: sessionCookie(response), user: payload.data.user }
}

async function addCartItem(request, cookie, body = {}) {
  return request('/api/cart/items', {
    method: 'POST',
    cookie,
    body: { productId: 'prod-bamboo-table', quantity: 1, ...body },
  })
}

async function saveDelivery(request, cookie) {
  const { response } = await request('/api/checkout', {
    method: 'POST',
    cookie,
    body: {
      step: 'delivery',
      shipping: {
        firstName: 'Cart',
        lastName: 'Buyer',
        country: 'Indonesia',
        addressLine1: 'Jl. Cart 1',
        city: 'Jakarta',
        region: 'Jakarta',
        zipCode: '10110',
        phone: '+62 123 456 789',
      },
    },
  })
  assert.equal(response.status, 200)
}

test('cart add persists a valid authenticated product with server pricing and MOQ', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)

  const { response, payload } = await addCartItem(request, cookie)

  assert.equal(response.status, 201)
  assert.equal(payload.data.items.length, 1)
  assert.equal(payload.data.items[0].productId, 'prod-bamboo-table')
  assert.equal(payload.data.items[0].quantity, 1)
  assert.equal(payload.data.items[0].packSize, 10)
  assert.equal(payload.data.items[0].unitPrice, 1500000)
  assert.equal(payload.data.items[0].lineTotal, 1500000)
})

test('cart add rejects unauthenticated users', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/cart/items', {
    method: 'POST',
    body: { productId: 'prod-bamboo-table', quantity: 1 },
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('cart add rejects an unknown product', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  const { response, payload } = await addCartItem(request, cookie, { productId: 'missing-product' })

  assert.equal(response.status, 404)
  assert.equal(payload.error.code, 'PRODUCT_NOT_FOUND')
})

test('cart add rejects an invalid quantity', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  const { response, payload } = await addCartItem(request, cookie, { quantity: 0 })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
})

test('cart add rejects a pack size below the product MOQ', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  const { response, payload } = await addCartItem(request, cookie, { packSize: 1 })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'MINIMUM_ORDER_REQUIRED')
})

test('cart add ignores forged client prices', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  const { response, payload } = await addCartItem(request, cookie, { price: 1, unitPrice: 1, total: 1 })

  assert.equal(response.status, 201)
  assert.equal(payload.data.items[0].unitPrice, 1500000)
  assert.equal(payload.data.summary.total, 1850000)
})

test('cart add merges repeated products into one cart line', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)
  const first = await addCartItem(request, cookie)
  const second = await addCartItem(request, cookie)

  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 201)
  assert.equal(second.payload.data.items.length, 1)
  assert.equal(second.payload.data.items[0].quantity, 2)
  const state = await store.getState()
  assert.equal(state.cartItems.filter((item) => item.userId === user.id && item.productId === 'prod-bamboo-table').length, 1)
})

test('cart items are isolated between authenticated users', async (t) => {
  const { request } = await withApi(t)
  const first = await signup(request, 'cart-first@example.com')
  const second = await signup(request, 'cart-second@example.com')
  await addCartItem(request, first.cookie)

  const firstCart = await request('/api/cart', { cookie: first.cookie })
  const secondCart = await request('/api/cart', { cookie: second.cookie })

  assert.equal(firstCart.response.status, 200)
  assert.equal(firstCart.payload.data.items.length, 1)
  assert.equal(secondCart.response.status, 200)
  assert.equal(secondCart.payload.data.items.length, 0)
})

test('cart item is visible in the cart after add', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  await addCartItem(request, cookie)

  const { response, payload } = await request('/api/cart', { cookie })

  assert.equal(response.status, 200)
  assert.equal(payload.data.items[0].product.title, 'Eco Friendly Bamboo Side Table')
  assert.equal(payload.data.items[0].packSize, 10)
})

test('cart add remains compatible with order creation', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)
  await addCartItem(request, cookie)
  await saveDelivery(request, cookie)

  const { response, payload } = await request('/api/orders', {
    method: 'POST',
    cookie,
    headers: { 'Idempotency-Key': 'cart-to-order' },
    body: { idempotencyKey: 'cart-to-order' },
  })

  assert.equal(response.status, 201)
  assert.equal(payload.data.items.length, 1)
  assert.equal(payload.data.items[0].packSize, 10)
  assert.equal(payload.data.total, 1850000)
})
