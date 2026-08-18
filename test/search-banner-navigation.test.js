import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'
import { shoppingRoute, routeForSearchResult } from '../src/navigation.js'
import { promoBannerMessages, nextBannerIndex } from '../src/promoBanner.js'
import { clearedSearchState, searchKeyboardAction } from '../src/searchInteractions.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-search-'))
  testContext.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()
  return { request: (path) => fetch(`http://127.0.0.1:${port}${path}`) }
}

test('search result clicks resolve Category, Product, and Auction routes', () => {
  assert.equal(routeForSearchResult({ type: 'category', id: 'furniture' }), '/categories?category=furniture')
  assert.equal(routeForSearchResult({ type: 'product', id: 'prod-bamboo-table' }), '/products/prod-bamboo-table')
  assert.equal(routeForSearchResult({ type: 'auction', id: 'auction-chair-1' }), '/auctions/auction-chair-1')
})

test('search keyboard navigation selects and closes results predictably', () => {
  assert.deepEqual(searchKeyboardAction({ key: 'ArrowDown', open: true, activeIndex: -1, resultCount: 3 }), { type: 'highlight', activeIndex: 0, open: true })
  assert.deepEqual(searchKeyboardAction({ key: 'ArrowDown', open: true, activeIndex: 2, resultCount: 3 }), { type: 'highlight', activeIndex: 0, open: true })
  assert.deepEqual(searchKeyboardAction({ key: 'ArrowUp', open: true, activeIndex: 0, resultCount: 3 }), { type: 'highlight', activeIndex: 2, open: true })
  assert.deepEqual(searchKeyboardAction({ key: 'Enter', open: true, activeIndex: 1, resultCount: 3 }), { type: 'select', activeIndex: 1 })
  assert.deepEqual(searchKeyboardAction({ key: 'Escape', open: true, activeIndex: 1, resultCount: 3 }), { type: 'close' })
})

test('search selection cleanup empties and closes the result list', () => {
  assert.deepEqual(clearedSearchState(), { query: '', results: [], status: 'idle', message: '', open: false, activeIndex: -1 })
})

test('Start Shopping targets the full catalog route', () => {
  assert.equal(shoppingRoute, '/categories')
})

test('promo banner messages route discover to catalog and discount to signup', () => {
  const discover = promoBannerMessages.find((item) => item.id === 'discover')
  const welcome = promoBannerMessages.find((item) => item.id === 'welcome-discount')

  assert.equal(discover.text, 'Discover and shop premium Indonesian products at our online wholesale marketplace')
  assert.equal(discover.href, '/categories')
  assert.equal(discover.action, 'catalog')
  assert.equal(welcome.text, 'Sign up today and get 10% off your first order')
  assert.equal(welcome.href, '/signup')
  assert.equal(welcome.action, 'signup')
  assert.equal(nextBannerIndex(0, promoBannerMessages.length), 1)
})

test('search API returns real routes for Category, Product, and Auction results', async (t) => {
  const { request } = await withApi(t)

  const category = await (await request('/api/search?q=furniture&type=category&limit=5')).json()
  const product = await (await request('/api/search?q=bamboo&type=product&limit=5')).json()
  const auction = await (await request('/api/search?q=chair&type=auction&limit=5')).json()

  assert.equal(category.data[0].href, '/categories?category=furniture')
  assert.equal(product.data[0].href, '/products/prod-bamboo-table')
  assert.match(auction.data[0].href, /^\/auctions\/auction-/)
  for (const payload of [category, product, auction]) {
    for (const result of payload.data) assert.notEqual(result.href, '#')
  }
})
