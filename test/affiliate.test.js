import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-affiliate-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()
  return async function request(path, { method = 'GET', body, cookie } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { response, payload: text ? JSON.parse(text) : null }
  }
}

async function signup(request) {
  const { response } = await request('/api/auth/signup', { method: 'POST', body: { name: 'Affiliate Applicant', email: `affiliate-${Date.now()}-${Math.random()}@example.com`, password: 'StrongPassword123' } })
  assert.equal(response.status, 201)
  return response.headers.get('set-cookie').split(';')[0]
}

const validApplication = {
  name: 'Affiliate Applicant',
  email: 'affiliate.applicant@example.com',
  publicName: 'Thoughtful Spaces',
  website: 'https://example.com/profile',
  country: 'Indonesia',
  preferredLanguage: 'English',
  biography: 'I publish practical guides for independent hospitality businesses.',
  motivation: 'I plan to promote relevant Buyamia products through editorial guides.',
  categoryIds: ['furniture', 'home-decoration'],
}

test('affiliate application requires an authenticated customer', async (t) => {
  const request = await withApi(t)
  const { response, payload } = await request('/api/affiliate-program/applications', { method: 'POST', body: validApplication })
  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('affiliate application stores existing category IDs and pending status', async (t) => {
  const request = await withApi(t)
  const cookie = await signup(request)
  const { response, payload } = await request('/api/affiliate-program/applications', { method: 'POST', cookie, body: validApplication })
  assert.equal(response.status, 201)
  assert.equal(payload.data.status, 'pending')
  assert.deepEqual(payload.data.categoryIds, ['furniture', 'home-decoration'])
  assert.equal(payload.data.email, validApplication.email)

  const current = await request('/api/affiliate-program/application', { cookie })
  assert.equal(current.response.status, 200)
  assert.equal(current.payload.data.id, payload.data.id)
})

test('affiliate application rejects invalid categories', async (t) => {
  const request = await withApi(t)
  const cookie = await signup(request)
  const { response, payload } = await request('/api/affiliate-program/applications', { method: 'POST', cookie, body: { ...validApplication, categoryIds: ['not-a-category'] } })
  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
})

test('affiliate application rejects a duplicate active application', async (t) => {
  const request = await withApi(t)
  const cookie = await signup(request)
  const first = await request('/api/affiliate-program/applications', { method: 'POST', cookie, body: validApplication })
  assert.equal(first.response.status, 201)
  const duplicate = await request('/api/affiliate-program/applications', { method: 'POST', cookie, body: validApplication })
  assert.equal(duplicate.response.status, 409)
  assert.equal(duplicate.payload.error.code, 'APPLICATION_EXISTS')
})
