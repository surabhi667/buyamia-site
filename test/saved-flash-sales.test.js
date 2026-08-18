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
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-saved-flash-'))
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

async function signup(request, email = `saved-${Date.now()}-${Math.random()}@example.com`) {
  const { response, payload } = await request('/api/auth/signup', { method: 'POST', body: { email, password, name: 'Saved Buyer' } })
  assert.equal(response.status, 201)
  return { cookie: sessionCookie(response), user: payload.data.user }
}

async function saveDelivery(request, cookie) {
  const { response } = await request('/api/checkout', {
    method: 'POST',
    cookie,
    body: {
      step: 'delivery',
      shipping: {
        firstName: 'Saved',
        lastName: 'Buyer',
        country: 'Indonesia',
        addressLine1: 'Jl. Saved 1',
        city: 'Jakarta',
        region: 'Jakarta',
        zipCode: '10110',
        phone: '+62 123 456 789',
      },
    },
  })
  assert.equal(response.status, 200)
}

test('saved products toggle by product id, persist, and do not duplicate', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie, user } = await signup(request)

  const first = await request('/api/saved', { method: 'POST', cookie, body: { productId: 'prod-accent-chair' } })
  const second = await request('/api/saved', { method: 'POST', cookie, body: { productId: 'prod-accent-chair' } })
  const status = await request('/api/saved/status?productId=prod-accent-chair', { cookie })
  const list = await request('/api/saved?limit=50', { cookie })

  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 201)
  assert.equal(second.payload.data.existing, true)
  assert.equal(status.payload.data.saved, true)
  assert.equal(status.payload.data.item.productId, 'prod-accent-chair')
  assert.equal(list.payload.data.length, 1)

  const state = await store.getState()
  assert.equal(state.wishlists.filter((item) => item.userId === user.id && item.productId === 'prod-accent-chair').length, 1)

  const removed = await request('/api/saved/products/prod-accent-chair', { method: 'DELETE', cookie })
  const after = await request('/api/saved/status?productId=prod-accent-chair', { cookie })
  assert.equal(removed.response.status, 200)
  assert.equal(after.payload.data.saved, false)
})

test('saved products are authenticated, isolated, and validate product existence', async (t) => {
  const { request } = await withApi(t)
  const first = await signup(request, 'saved-first@example.com')
  const second = await signup(request, 'saved-second@example.com')

  const anonymous = await request('/api/saved', { method: 'POST', body: { productId: 'prod-bamboo-table' } })
  assert.equal(anonymous.response.status, 401)
  assert.equal(anonymous.payload.error.code, 'AUTHENTICATION_REQUIRED')

  const missing = await request('/api/saved', { method: 'POST', cookie: first.cookie, body: { productId: 'missing-product' } })
  assert.equal(missing.response.status, 404)
  assert.equal(missing.payload.error.code, 'PRODUCT_NOT_FOUND')

  await request('/api/saved', { method: 'POST', cookie: first.cookie, body: { productId: 'prod-bamboo-table' } })
  const firstList = await request('/api/saved?limit=50', { cookie: first.cookie })
  const secondList = await request('/api/saved?limit=50', { cookie: second.cookie })

  assert.equal(firstList.payload.data.length, 1)
  assert.equal(secondList.payload.data.length, 0)

  const blockedRemove = await request('/api/saved/products/prod-bamboo-table', { method: 'DELETE', cookie: second.cookie })
  assert.equal(blockedRemove.response.status, 404)
  assert.equal(blockedRemove.payload.error.code, 'SAVED_ITEM_NOT_FOUND')
})

test('active flash sale product detail, cart, order price, and stock are server-side', async (t) => {
  const { request, store } = await withApi(t)
  const { cookie } = await signup(request)

  const product = await request('/api/products/prod-accent-chair?flashSale=flash-artisan-edit')
  assert.equal(product.response.status, 200)
  assert.equal(product.payload.data.id, 'prod-accent-chair')
  assert.equal(product.payload.data.price, 1020000)
  assert.equal(product.payload.data.originalPrice, 3400000)
  assert.equal(product.payload.data.flashSale.remainingStock, 7)

  const forged = await request('/api/cart/items', {
    method: 'POST',
    cookie,
    body: { productId: 'prod-accent-chair', quantity: 1, packSize: 10, flashSaleId: 'flash-artisan-edit', unitPrice: 1 },
  })
  assert.equal(forged.response.status, 201)
  assert.equal(forged.payload.data.items[0].unitPrice, 1020000)
  assert.equal(forged.payload.data.items[0].flashSale.id, 'flash-artisan-edit')

  await saveDelivery(request, cookie)
  const order = await request('/api/orders', {
    method: 'POST',
    cookie,
    headers: { 'Idempotency-Key': 'flash-sale-order' },
    body: { idempotencyKey: 'flash-sale-order', total: 1 },
  })

  assert.equal(order.response.status, 201)
  assert.equal(order.payload.data.items[0].unitPrice, 1020000)
  assert.equal(order.payload.data.items[0].flashSale.salePrice, 1020000)

  const state = await store.getState()
  const sale = state.flashSales.find((item) => item.id === 'flash-artisan-edit')
  assert.equal(sale.products.find((item) => item.productId === 'prod-accent-chair').remainingStock, 6)
})

test('flash sale APIs filter combinations and reject unavailable sale products', async (t) => {
  const { request } = await withApi(t)
  const { cookie } = await signup(request)

  const filtered = await request('/api/flash-sales?status=active&category=furniture&q=artisan&sort=discount-high')
  assert.equal(filtered.response.status, 200)
  assert.equal(filtered.payload.data.length, 1)
  assert.equal(filtered.payload.data[0].id, 'flash-artisan-edit')
  assert.equal(filtered.payload.data[0].products.every((product) => product.categoryId === 'furniture' || product.title.toLowerCase().includes('artisan')), true)

  const expired = await request('/api/cart/items', {
    method: 'POST',
    cookie,
    body: { productId: 'prod-ceramic-vase', quantity: 1, packSize: 10, flashSaleId: 'flash-midyear-archive' },
  })
  assert.equal(expired.response.status, 404)
  assert.equal(expired.payload.error.code, 'FLASH_SALE_NOT_FOUND')
})
