import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'
import { validateNodeManifest } from '../server/node-manifest.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-node-manifest-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()
  return { store, request: (path) => fetch(`http://127.0.0.1:${port}${path}`) }
}

test('well-known node manifest is valid, stable, and cacheable', async (t) => {
  const { request } = await withApi(t)
  const firstResponse = await request('/.well-known/buyamia-node')
  const first = await firstResponse.json()
  const secondResponse = await request('/.well-known/buyamia-node')
  const second = await secondResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.equal(firstResponse.headers.get('cache-control'), 'public, max-age=3600')
  assert.deepEqual(first, second)
  assert.equal(first.manifest.node_id, 'buyamia:supplier:seller-sari')
  assert.equal(first.conformance.status, 'conformant')
  assert.deepEqual(validateNodeManifest(first), { valid: true, errors: [] })
  assert.ok(first.agent_context.agent_context)
  assert.ok(first.agent_context.not_a_fit.length > 0)
})

test('node manifest reuses supplier catalog and Buying Pools without overstating capabilities', async (t) => {
  const { request } = await withApi(t)
  const response = await request('/.well-known/buyamia-node?supplier=seller-sari')
  const manifest = await response.json()
  const poolsResponse = await request('/api/buying-pools?status=all&limit=100')
  const poolList = await poolsResponse.json()

  assert.equal(response.status, 200)
  assert.equal(poolsResponse.status, 200)
  assert.deepEqual(manifest.offerings.map((item) => item.id), ['prod-accent-chair', 'prod-bamboo-table', 'prod-stone-table'])
  const expectedPoolIds = ['pool-commercial-office-furniture', 'pool-handmade-home-decor-wholesale', 'pool-hospitality-amenities', 'pool-indonesian-artisan-furniture', 'pool-sustainable-hotel-furniture']
  assert.deepEqual(manifest.pool_participation.hosted_pools.map((item) => item.id), expectedPoolIds)
  assert.deepEqual(poolList.data.map((item) => item.id).sort(), expectedPoolIds)
  assert.equal(manifest.capabilities.pools.hostable, true)
  assert.equal(manifest.capabilities.pools.joinable, false)
  assert.equal(manifest.capabilities['com.buyamia.pool_seat'].supported, false)
  assert.equal(manifest.capabilities.escrow.supported, false)
  assert.equal(manifest.capabilities.ucp.status, 'not_published')
  assert.deepEqual(manifest.provenance.self_reported, ['identity', 'agent_context', 'offerings', 'policies'])
  assert.ok(manifest.provenance.platform_attested.includes('platform_attested.verification_tier'))
})

test('node manifest returns a machine-readable error for an unknown supplier', async (t) => {
  const { request } = await withApi(t)
  const response = await request('/.well-known/buyamia-node?supplier=missing')
  const payload = await response.json()
  assert.equal(response.status, 404)
  assert.equal(payload.error.code, 'NODE_MANIFEST_NOT_FOUND')
})

test('manifest validation reports invalid required fields', () => {
  const result = validateNodeManifest({ manifest: { version: 'invalid', kind: 'unknown' }, agent_context: { agent_context: '', not_a_fit: [] }, offerings: [], capabilities: { pools: {} } })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((item) => item.path === 'manifest.node_id'))
  assert.ok(result.errors.some((item) => item.path === 'agent_context.not_a_fit'))
  assert.ok(result.errors.some((item) => item.path === 'capabilities.pools'))
})
