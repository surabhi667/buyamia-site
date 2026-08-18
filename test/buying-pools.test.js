import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext, setup) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-pools-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'db.json')
  if (setup) await setup(databasePath)
  const store = createStore(databasePath)
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

async function signup(request, email) {
  const { response } = await request('/api/auth/signup', { method: 'POST', body: { name: 'Pool Buyer', email, password: 'StrongPassword123' } })
  assert.equal(response.status, 201)
  return response.headers.get('set-cookie').split(';')[0]
}

const expectedSeedTitles = [
  'Sustainable Hotel Furniture Procurement',
  'Handmade Home Décor Wholesale Pool',
  'Hospitality Amenities Buying Pool',
  'Indonesian Artisan Furniture Pool',
  'Commercial Office Furniture Pool',
]

test('Buying Pools seed backfills an existing empty collection without duplication', async (t) => {
  const { store } = await withApi(t, (databasePath) => writeFile(databasePath, JSON.stringify({ buyingPools: [], buyingPoolParticipants: [] }), 'utf8'))
  const firstLoad = await store.read('buyingPools')
  const secondLoad = await store.read('buyingPools')

  assert.equal(firstLoad.length, expectedSeedTitles.length)
  assert.deepEqual([...new Set(firstLoad.map((pool) => pool.id))].length, firstLoad.length)
  assert.equal(secondLoad.length, firstLoad.length)
  for (const title of expectedSeedTitles) assert.ok(firstLoad.some((pool) => pool.title === title), title)
})

test('Buying Pools list loads useful startup pools from the backend', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/buying-pools?limit=20')

  assert.equal(response.status, 200)
  assert.ok(payload.data.length >= expectedSeedTitles.length)
  assert.ok(payload.data.every((pool) => pool.title && pool.category && pool.location && pool.objective))
  assert.ok(payload.data.every((pool) => Number.isInteger(pool.targetQuantity) && Number.isInteger(pool.committedQuantity)))
})

test('Buying Pools filters return matching industries', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/buying-pools?industry=hotels-hospitality&limit=20')

  assert.equal(response.status, 200)
  assert.ok(payload.data.length >= 2)
  assert.ok(payload.data.every((pool) => pool.industry === 'hotels-hospitality'))
})

test('Buying Pool detail exposes progress and closing information', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/buying-pools/pool-commercial-office-furniture')

  assert.equal(response.status, 200)
  assert.equal(payload.data.title, 'Commercial Office Furniture Pool')
  assert.equal(payload.data.category.id, 'office-supplies')
  assert.equal(payload.data.participantCount, 4)
  assert.equal(payload.data.targetBusinesses, 8)
  assert.equal(payload.data.endTime, '2027-03-01T23:59:59.000Z')
})

test('authenticated users can create a persisted Buying Pool', async (t) => {
  const { request, store } = await withApi(t)
  const cookie = await signup(request, 'creator@example.com')
  const body = { productName: 'Custom office furniture', preferredSupplier: 'Sari Living', orderQuantity: 12, frequency: 'monthly', minimumBusinesses: 3, maximumBusinesses: 5, targetVolume: 60, location: 'Jakarta, Indonesia', matchingRadius: 'city', industryMatching: 'compatible', poolWindowDays: 14, monitoring: 'Email me when buyers join.', publish: true }
  const { response, payload } = await request('/api/buying-pools', { method: 'POST', cookie, body })

  assert.equal(response.status, 201)
  assert.equal(payload.data.status, 'open')
  assert.equal(payload.data.categoryId, 'office-supplies')
  assert.notEqual(payload.data.createdBy, 'demo-user')

  const pools = await store.read('buyingPools')
  assert.ok(pools.some((pool) => pool.id === payload.data.id && pool.createdBy === payload.data.createdBy))
})

test('Joining a Buying Pool is persisted per authenticated user', async (t) => {
  const { request, store } = await withApi(t)
  const mayaCookie = await signup(request, 'maya@example.com')
  const danielCookie = await signup(request, 'daniel@example.com')

  const joined = await request('/api/buying-pools/pool-commercial-office-furniture/join', { method: 'POST', cookie: mayaCookie })
  assert.equal(joined.response.status, 201)
  assert.equal(joined.payload.pool.joined, true)
  assert.equal(joined.payload.pool.participantCount, 5)

  const duplicate = await request('/api/buying-pools/pool-commercial-office-furniture/join', { method: 'POST', cookie: mayaCookie })
  assert.equal(duplicate.response.status, 409)
  assert.equal(duplicate.payload.error.code, 'ALREADY_JOINED')

  const danielView = await request('/api/buying-pools/pool-commercial-office-furniture', { cookie: danielCookie })
  assert.equal(danielView.response.status, 200)
  assert.equal(danielView.payload.data.joined, false)

  const participants = await store.read('buyingPoolParticipants')
  assert.equal(participants.length, 1)
  assert.notEqual(participants[0].userId, 'demo-user')
})

test('Buying Pool private actions reject unauthenticated requests', async (t) => {
  const { request } = await withApi(t)
  const create = await request('/api/buying-pools', { method: 'POST', body: { productName: 'Office furniture', orderQuantity: 10, frequency: 'monthly', minimumBusinesses: 3, targetVolume: 30, location: 'Jakarta', matchingRadius: 'city', industryMatching: 'compatible', poolWindowDays: 14, publish: true } })
  const joinPool = await request('/api/buying-pools/pool-commercial-office-furniture/join', { method: 'POST' })

  assert.equal(create.response.status, 401)
  assert.equal(create.payload.error.code, 'AUTHENTICATION_REQUIRED')
  assert.equal(joinPool.response.status, 401)
  assert.equal(joinPool.payload.error.code, 'AUTHENTICATION_REQUIRED')
})
