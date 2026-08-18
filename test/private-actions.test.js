import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-private-actions-'))
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
    const text = await response.text()
    return { response, payload: text ? JSON.parse(text) : null }
  }
  return { request, store }
}

async function signup(request) {
  const { response } = await request('/api/auth/signup', { method: 'POST', body: { name: 'Private Buyer', email: `private-${Date.now()}-${Math.random()}@example.com`, password: 'StrongPassword123' } })
  assert.equal(response.status, 201)
  return response.headers.get('set-cookie').split(';')[0]
}

const protectedRequests = [
  ['/api/account', { method: 'GET' }],
  ['/api/saved', { method: 'GET' }],
  ['/api/support/tickets', { method: 'GET' }],
  ['/api/community/messages', { method: 'POST', body: { text: 'Hello community' } }],
  ['/api/buying-pools/pool-kemang-cleaning/join', { method: 'POST', body: { quantity: 1 } }],
  ['/api/marketplaces', { method: 'POST', body: { name: 'New Marketplace', categoryId: 'furniture', description: 'A dedicated furniture marketplace.' } }],
  ['/api/flash-sales', { method: 'POST', body: { title: 'Private sale', description: 'Authenticated only', products: [] } }],
  ['/api/auctions/auction-chair-1/bids', { method: 'POST', body: { amount: 1200000 } }],
  ['/api/auction-listings', { method: 'GET' }],
  ['/api/sellers/seller-sari/follow', { method: 'POST' }],
  ['/api/concierge/telegram/start', { method: 'POST', body: {} }],
]

test('private commerce and account routes require a real session', async (t) => {
  const { request } = await withApi(t)
  for (const [path, options] of protectedRequests) {
    const { response, payload } = await request(path, options)
    assert.equal(response.status, 401, path)
    assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED', path)
  }
})

test('seller follow stores the authenticated user instead of demo-user', async (t) => {
  const { request, store } = await withApi(t)
  const cookie = await signup(request)
  const { response, payload } = await request('/api/sellers/seller-sari/follow', { method: 'POST', cookie })
  assert.equal(response.status, 200)
  assert.equal(payload.data.sellerId, 'seller-sari')
  assert.notEqual(payload.data.userId, 'demo-user')

  const follows = await store.read('sellerFollows')
  assert.equal(follows.length, 1)
  assert.equal(follows[0].userId, payload.data.userId)
})

test('private account data is isolated between authenticated users', async (t) => {
  const previousBot = process.env.BUYAMIA_TELEGRAM_BOT_USERNAME
  process.env.BUYAMIA_TELEGRAM_BOT_USERNAME = 'BuyamiaTestBot'
  t.after(() => {
    if (previousBot === undefined) delete process.env.BUYAMIA_TELEGRAM_BOT_USERNAME
    else process.env.BUYAMIA_TELEGRAM_BOT_USERNAME = previousBot
  })

  const { request, store } = await withApi(t)
  const firstCookie = await signup(request)
  const secondCookie = await signup(request)

  const address = await request('/api/account/shipping-addresses', {
    method: 'POST',
    cookie: firstCookie,
    body: { fullName: 'First Buyer', phone: '+62 123 456 789', line1: 'Jl. First 1', city: 'Jakarta', postalCode: '10110', country: 'Indonesia' },
  })
  assert.equal(address.response.status, 201)

  const bank = await request('/api/account/bank', {
    method: 'POST',
    cookie: firstCookie,
    body: { accountHolder: 'First Buyer', bankName: 'Bank Indonesia', accountNumber: '1234567890', country: 'ID', currency: 'IDR', accountType: 'personal' },
  })
  assert.equal(bank.response.status, 201)
  assert.equal(bank.payload.data.accountNumber, undefined)
  assert.match(bank.payload.data.accountNumberMasked, /7890$/)

  const wishlist = await request('/api/account/wishlist', { method: 'POST', cookie: firstCookie, body: { productId: 'prod-bamboo-table' } })
  assert.equal(wishlist.response.status, 201)

  const collection = await request('/api/saved/collections', { method: 'POST', cookie: firstCookie, body: { name: 'Procurement list' } })
  assert.equal(collection.response.status, 201)

  const support = await request('/api/support/tickets', {
    method: 'POST',
    cookie: firstCookie,
    body: { title: 'Private order question', description: 'I need help with my private order details.', categoryId: 'orders', priority: 'normal' },
  })
  assert.equal(support.response.status, 201)

  const history = await request('/api/account/history', { method: 'POST', cookie: firstCookie, body: { productId: 'prod-bamboo-table' } })
  assert.equal(history.response.status, 201)

  const telegram = await request('/api/concierge/telegram/start', { method: 'POST', cookie: firstCookie, body: {} })
  assert.equal(telegram.response.status, 201)

  const secondAddresses = await request('/api/account/shipping-addresses?limit=50', { cookie: secondCookie })
  const secondBank = await request('/api/account/bank?limit=50', { cookie: secondCookie })
  const secondWishlist = await request('/api/account/wishlist?limit=50', { cookie: secondCookie })
  const secondSaved = await request('/api/saved/collections', { cookie: secondCookie })
  const secondTickets = await request('/api/support/tickets?limit=50', { cookie: secondCookie })
  const secondHistory = await request('/api/account/history?limit=50', { cookie: secondCookie })
  const secondTelegramHistory = await request('/api/concierge/telegram/history?limit=50', { cookie: secondCookie })

  assert.deepEqual(secondAddresses.payload.data, [])
  assert.deepEqual(secondBank.payload.data, [])
  assert.deepEqual(secondWishlist.payload.data, [])
  assert.deepEqual(secondSaved.payload.data, [])
  assert.deepEqual(secondTickets.payload.data, [])
  assert.deepEqual(secondHistory.payload.data, [])
  assert.deepEqual(secondTelegramHistory.payload.data, [])

  const blockedAddressDelete = await request(`/api/account/shipping-addresses/${address.payload.data.id}`, { method: 'DELETE', cookie: secondCookie })
  const blockedBankDelete = await request(`/api/account/bank/${bank.payload.data.id}`, { method: 'DELETE', cookie: secondCookie })
  const blockedWishlistDelete = await request(`/api/account/wishlist/${wishlist.payload.data.id}`, { method: 'DELETE', cookie: secondCookie })
  const blockedCollectionRead = await request(`/api/saved?collection=${collection.payload.data.id}`, { cookie: secondCookie })
  const blockedTicketRead = await request(`/api/support/tickets/${support.payload.data.id}`, { cookie: secondCookie })
  const blockedHistoryDelete = await request(`/api/account/history/${history.payload.data.id}`, { method: 'DELETE', cookie: secondCookie })

  assert.equal(blockedAddressDelete.response.status, 404)
  assert.equal(blockedBankDelete.response.status, 404)
  assert.equal(blockedWishlistDelete.response.status, 404)
  assert.equal(blockedCollectionRead.response.status, 404)
  assert.equal(blockedTicketRead.response.status, 404)
  assert.equal(blockedHistoryDelete.response.status, 404)

  const state = await store.getState()
  for (const collectionName of ['shippingAddresses', 'bankAccounts', 'wishlists', 'savedCollections', 'supportTickets', 'browsingHistory', 'telegramConversationHistory']) {
    assert.ok(state[collectionName].every((item) => item.userId !== 'demo-user'), collectionName)
  }
})

test('newsletter subscribe persists a real subscription without authentication', async (t) => {
  const { request, store } = await withApi(t)
  const { response, payload } = await request('/api/newsletter', { method: 'POST', body: { email: 'Reader@Example.com', source: 'test' } })
  assert.equal(response.status, 201)
  assert.equal(payload.data.email, 'reader@example.com')
  assert.equal(payload.data.userId, null)

  const subscriptions = await store.read('newsletterSubscriptions')
  assert.equal(subscriptions.length, 1)
  assert.equal(subscriptions[0].email, 'reader@example.com')
})

test('Ask Amia chat creates a persisted conversation through the public chat API', async (t) => {
  const { request, store } = await withApi(t)
  const { response, payload } = await request('/api/ask-amia/chat', { method: 'POST', body: { prompt: 'Find verified furniture suppliers' } })
  assert.equal(response.status, 201)
  assert.ok(payload.data.conversationId)
  assert.equal(payload.data.assistantMessage.role, 'assistant')

  const conversations = await store.read('conversations')
  assert.equal(conversations.length, 1)
})
