import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function text(value, field, { min = 1, max = 1000, required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return undefined
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string`)
  const clean = value.trim()
  if (clean.length < min || clean.length > max) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must contain between ${min} and ${max} characters`)
  return clean
}

export function pageOptions(query) {
  const page = Math.max(1, Number.parseInt(query.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.get('limit') || '20', 10) || 20))
  return { page, limit }
}

export function paginate(items, query) {
  const { page, limit } = pageOptions(query)
  const total = items.length
  const pages = Math.max(1, Math.ceil(total / limit))
  return { data: items.slice((page - 1) * limit, page * limit), meta: { page, limit, total, pages } }
}

function newestFirst(a, b) { return new Date(b.createdAt) - new Date(a.createdAt) }

async function passwordHash(password) { const salt = randomBytes(16).toString('hex'); const hash = await scryptAsync(password, salt, 64); return `${salt}:${Buffer.from(hash).toString('hex')}` }
async function passwordMatches(password, stored) { const [salt, expected] = String(stored || '').split(':'); if (!salt || !expected) return false; const actual = Buffer.from(await scryptAsync(password, salt, 64)); const expectedBuffer = Buffer.from(expected, 'hex'); return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer) }
function publicSecurity(security) { const { passwordHash: _passwordHash, ...safe } = security; return { ...safe, passwordConfigured: Boolean(_passwordHash) } }
function newSecurity(user) { const timestamp = new Date().toISOString(); return { userId: user.id, emailVerified: false, phoneVerified: false, twoFactorEnabled: false, activeSessions: [{ id: 'current', current: true, device: 'Current browser', browser: 'Browser', operatingSystem: 'Unknown', location: 'Unknown', createdAt: timestamp }], loginHistory: [{ id: 'current-login', status: 'success', device: 'Current browser', browser: 'Browser', operatingSystem: 'Unknown', location: 'Unknown', createdAt: timestamp }] } }
const supportedBankCountries = new Set(['ID', 'AU', 'SG', 'US'])
const supportedBankCurrencies = new Set(['IDR', 'AUD', 'SGD', 'USD'])
function bankFingerprint(value) { return createHash('sha256').update(value.replace(/\s+/g, '').toUpperCase()).digest('hex') }
function publicBankAccount(account) { const { accountNumber, accountFingerprint: _accountFingerprint, ...safe } = account; const last4 = safe.last4 || String(accountNumber || '').replace(/\s+/g, '').slice(-4); return { ...safe, last4, accountNumberMasked: last4 ? `•••• ${last4}` : '' } }

const searchableTypes = new Map([
  ['product', 'product'], ['products', 'product'], ['marketplace', 'product'], ['marketplace-listing', 'product'],
  ['category', 'category'], ['categories', 'category'],
  ['seller-promotion', 'seller-promotion'], ['seller-promotions', 'seller-promotion'], ['promotion', 'seller-promotion'], ['promotions', 'seller-promotion'],
  ['auction', 'auction'], ['auctions', 'auction'],
  ['flash-sale', 'flash-sale'], ['flash-sales', 'flash-sale'],
  ['affiliate-program', 'affiliate-program'], ['affiliate', 'affiliate-program'], ['service', 'affiliate-program'], ['services', 'affiliate-program'],
  ['community-post', 'community-post'], ['community', 'community-post'], ['community-posts', 'community-post'],
])

function normalizeSearch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function searchOptions(query) {
  const value = normalizeSearch(query.get('q'))
  if (!value) throw new ApiError(400, 'SEARCH_QUERY_REQUIRED', 'q must contain at least one non-whitespace character')
  if (value.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'q must contain at most 160 characters')

  const rawPage = query.get('page')
  const rawLimit = query.get('limit')
  if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 50')

  const category = normalizeSearch(query.get('category'))
  if (category.length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'category must contain at most 100 characters')
  const type = normalizeSearch(query.get('type'))
  const types = type ? type.split(',').map((item) => searchableTypes.get(item.trim())) : null
  if (types?.some((item) => !item)) throw new ApiError(400, 'VALIDATION_ERROR', 'type contains an unsupported searchable entity')
  return { value, category, types: types ? new Set(types) : null, ...pageOptions(query) }
}

function relevance(query, fields) {
  const haystack = normalizeSearch(fields.filter(Boolean).join(' '))
  const tokens = query.split(' ')
  if (!haystack.includes(query) && !tokens.every((token) => haystack.includes(token))) return 0
  const title = normalizeSearch(fields[0])
  let score = haystack.includes(query) ? 20 : 0
  if (title === query) score += 40
  else if (title.startsWith(query)) score += 25
  else if (title.includes(query)) score += 15
  score += tokens.filter((token) => haystack.includes(token)).length * 3
  return score
}

export function createServices(store) {
  const about = {
    async get() { return store.read('aboutPage') },
    async section(id) { const page = await store.read('aboutPage'); const allowed = ['company', 'confidence', 'brands', 'testimonials', 'achievement', 'verification', 'impact', 'faq', 'closing']; if (!allowed.includes(id)) throw new ApiError(404, 'ABOUT_SECTION_NOT_FOUND', 'About section not found'); const value = page[id]; if (!value) throw new ApiError(404, 'ABOUT_SECTION_NOT_FOUND', 'About section not found'); return value },
  }
  const categories = {
    async list(query) {
      const search = normalizeSearch(query.get('search') || query.get('q'))
      const sort = query.get('sort') || 'position'
      const rawSearch = query.get('search') ?? query.get('q')
      const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (rawSearch !== null && !search) throw new ApiError(400, 'SEARCH_QUERY_REQUIRED', 'search must contain at least one non-whitespace character')
      if (search.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'search must contain at most 160 characters')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
      if (!['position', 'name'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort must be position or name')
      const [categoryRows, products] = await Promise.all([store.read('categories'), store.read('products')])
      const rows = [...categoryRows]
        .filter((item) => item.active && (!search || normalizeSearch([item.name, ...item.children].join(' ')).includes(search)))
        .map((item) => ({ ...item, productCount: products.filter((product) => product.active && product.categoryId === item.id).length }))
        .sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => a.position - b.position)
      return paginate(rows, query)
    },
    async detail(id) { const category = (await store.read('categories')).find((item) => (item.id === id || item.slug === id) && item.active); if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found'); const products = await store.read('products'); return { ...category, productCount: products.filter((product) => product.active && product.categoryId === category.id).length } },
    async products(id, query) { const category = await this.detail(id); const sort = query.get('sort') || 'featured'; const rawPage = query.get('page'); const rawLimit = query.get('limit'); if (!['featured', 'price_asc', 'price_desc', 'sold'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported'); if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100'); const search = normalizeSearch(query.get('search')); const products = (await store.read('products')).filter((item) => item.active && item.categoryId === category.id && (!search || normalizeSearch(item.title).includes(search))); const sorters = { price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price, sold: (a, b) => b.soldCount - a.soldCount, featured: (a, b) => Number(b.featured) - Number(a.featured) }; products.sort(sorters[sort]); return { category, ...paginate(products, query) } },
    async create(body) {
      const name = text(body.name, 'name', { max: 80 })
      const slug = text(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'slug', { max: 100 })
      return store.mutate((db) => {
        if (db.categories.some((item) => item.slug === slug)) throw new ApiError(409, 'CATEGORY_EXISTS', 'A category with this slug already exists')
        const timestamp = new Date().toISOString()
        const category = { id: store.id('category'), name, slug, children: Array.isArray(body.children) ? body.children.map((child) => text(child, 'children item', { max: 80 })) : [], position: db.categories.length + 1, active: true, createdAt: timestamp, updatedAt: timestamp }
        db.categories.push(category)
        return category
      })
    },
    async update(id, body) {
      return store.mutate((db) => {
        const category = db.categories.find((item) => item.id === id)
        if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
        if (body.name !== undefined) category.name = text(body.name, 'name', { max: 80 })
        if (body.children !== undefined) {
          if (!Array.isArray(body.children)) throw new ApiError(400, 'VALIDATION_ERROR', 'children must be an array')
          category.children = body.children.map((child) => text(child, 'children item', { max: 80 }))
        }
        if (body.active !== undefined) category.active = Boolean(body.active)
        category.updatedAt = new Date().toISOString()
        return category
      })
    },
    async remove(id) {
      return store.mutate((db) => {
        const index = db.categories.findIndex((item) => item.id === id)
        if (index < 0) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
        if (db.products.some((product) => product.categoryId === id)) throw new ApiError(409, 'CATEGORY_IN_USE', 'Category cannot be deleted while products use it')
        return db.categories.splice(index, 1)[0]
      })
    },
  }

  const marketplace = {
    async products(query) {
      const search = (query.get('search') || '').trim().toLowerCase()
      const category = query.get('category')
      const featured = query.get('featured')
      const sort = query.get('sort') || 'featured'
      const rows = [...await store.read('products')].filter((item) => item.active && (!search || item.title.toLowerCase().includes(search)) && (!category || item.categoryId === category) && (featured === null || item.featured === (featured === 'true')))
      const sorters = { price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price, sold: (a, b) => b.soldCount - a.soldCount, featured: (a, b) => Number(b.featured) - Number(a.featured) }
      rows.sort(sorters[sort] || sorters.featured)
      return paginate(rows, query)
    },
    async widget(name, query) {
      const products = [...await store.read('products')].filter((item) => item.active)
      if (name === 'flash-sales') return paginate(products.filter((item) => item.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent), query)
      if (name === 'fast-selling') return paginate(products.sort((a, b) => b.soldCount - a.soldCount), query)
      if (name === 'seller-promotions') return paginate([...await store.read('sellerPromotions')].filter((item) => item.active).sort(newestFirst), query)
      if (name === 'auctions') return paginate([...await store.read('auctions')].filter((item) => item.status !== 'cancelled').sort(newestFirst), query)
      throw new ApiError(404, 'WIDGET_NOT_FOUND', 'Marketplace widget not found')
    },
    async feed(query) {
      const [flashSales, fastSelling, sellerPromotions, auctions] = await Promise.all(['flash-sales', 'fast-selling', 'seller-promotions', 'auctions'].map((name) => this.widget(name, query)))
      return { flashSales, fastSelling, sellerPromotions, auctions }
    },
    async marketplaces() { return (await store.read('marketplaces')).filter((item) => item.active) },
    async marketplaceOverview(id = 'vehicles') { const definition = (await store.read('marketplaces')).find((item) => item.id === id && item.active); if (!definition) throw new ApiError(404, 'MARKETPLACE_NOT_FOUND', 'Marketplace not found'); const emptyQuery = new URLSearchParams('limit=8'); const featured = await this.marketplaceProducts(new URLSearchParams(`marketplace=${encodeURIComponent(id)}&featured=true&limit=8`)); const trending = await this.marketplaceProducts(new URLSearchParams(`marketplace=${encodeURIComponent(id)}&sort=popular&limit=8`)); return { ...definition, featured: featured.data, trending: trending.data, sellers: await this.marketplaceSellers(id), recommendations: (await this.marketplaceProducts(emptyQuery)).data.slice(0, 4) } },
    async marketplaceProducts(query) {
      const marketplaceId = query.get('marketplace') || 'vehicles'; const q = text(query.get('q') || query.get('search'), 'search', { max: 160, required: false })?.toLowerCase(); const category = query.get('category') || query.get('type'); const sellerId = query.get('seller'); const country = text(query.get('country'), 'country', { max: 100, required: false }); const sort = query.get('sort') || 'featured'; const featured = query.get('featured'); const minPrice = query.get('minPrice') === null ? null : Number(query.get('minPrice')); const maxPrice = query.get('maxPrice') === null ? null : Number(query.get('maxPrice')); const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (!(await store.read('marketplaces')).some((item) => item.id === marketplaceId && item.active)) throw new ApiError(404, 'MARKETPLACE_NOT_FOUND', 'Marketplace not found'); if (category && !['cars','bikes'].includes(category)) throw new ApiError(400, 'VALIDATION_ERROR', 'category is not supported'); if (sellerId && !(await store.read('marketplaceDealers')).some((item) => item.id === sellerId && item.marketplaceId === marketplaceId)) throw new ApiError(404, 'SELLER_NOT_FOUND', 'Marketplace seller not found'); if (featured !== null && !['true','false'].includes(featured)) throw new ApiError(400, 'VALIDATION_ERROR', 'featured must be true or false'); if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) throw new ApiError(400, 'VALIDATION_ERROR', 'price range is invalid'); if (!['featured','popular','newest','price-asc','price-desc','mileage'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported'); if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100')
      const dealers = await store.read('marketplaceDealers'); const dealerById = new Map(dealers.map((item) => [item.id,item])); let rows = (await store.read('marketplaceListings')).filter((item) => item.marketplaceId === marketplaceId && item.available && (!q || `${item.title} ${item.description} ${item.engineType} ${dealerById.get(item.sellerId)?.name || ''}`.toLowerCase().includes(q)) && (!category || item.type === category) && (!sellerId || item.sellerId === sellerId) && (!country || dealerById.get(item.sellerId)?.country.toLowerCase() === country.toLowerCase()) && (featured === null || item.featured === (featured === 'true')) && (minPrice === null || item.price >= minPrice) && (maxPrice === null || item.price <= maxPrice)).map((item) => ({ ...item, seller: dealerById.get(item.sellerId) || null })); const sorters = { featured: (a,b) => Number(b.featured)-Number(a.featured) || b.popularity-a.popularity, popular: (a,b) => b.popularity-a.popularity, newest: newestFirst, 'price-asc': (a,b) => a.price-b.price, 'price-desc': (a,b) => b.price-a.price, mileage: (a,b) => a.mileage-b.mileage }; rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async marketplaceProduct(id) { const product = (await store.read('marketplaceListings')).find((item) => item.id === id); if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Marketplace product not found'); const seller = (await store.read('marketplaceDealers')).find((item) => item.id === product.sellerId); return { ...product, seller: seller || null } },
    async marketplaceSellers(id = 'vehicles') { const listings = await store.read('marketplaceListings'); return (await store.read('marketplaceDealers')).filter((item) => item.marketplaceId === id && item.approved).map((item) => ({ ...item, products: item.listingIds.map((listingId) => listings.find((listing) => listing.id === listingId && listing.available)).filter(Boolean) })) },
  }

  const brands = {
    async list(query) {
      const q = normalizeSearch(query.get('q') || query.get('search')); const country = normalizeSearch(query.get('country')); const category = query.get('category'); const featured = query.get('featured'); const sort = query.get('sort') || 'name'; const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if ((query.has('q') || query.has('search')) && !q) throw new ApiError(400, 'SEARCH_QUERY_REQUIRED', 'search must contain at least one non-whitespace character')
      if (q.length > 160 || country.length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'search or country is too long')
      if (featured !== null && !['true', 'false'].includes(featured)) throw new ApiError(400, 'VALIDATION_ERROR', 'featured must be true or false')
      if (!['name', 'popular', 'newest'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
      const [rows, products, categories] = await Promise.all([store.read('brands'), store.read('products'), store.read('categories')]); const categoryById = new Map(categories.map((item) => [item.id, item]))
      const result = rows.filter((brand) => (!q || normalizeSearch(`${brand.name} ${brand.description}`).includes(q)) && (!country || normalizeSearch(brand.country).includes(country)) && (!category || brand.categoryId === category) && (featured === null || brand.featured === (featured === 'true'))).map((brand) => ({ ...brand, category: categoryById.get(brand.categoryId)?.name || brand.categoryId, products: brand.productIds.map((id) => products.find((product) => product.id === id && product.active)).filter(Boolean), productCount: brand.productIds.length }))
      const sorters = { name: (a, b) => a.name.localeCompare(b.name), popular: (a, b) => b.productCount - a.productCount || b.rating - a.rating, newest: newestFirst }; result.sort(sorters[sort]); return paginate(result, query)
    },
    async detail(id) { const result = await this.list(new URLSearchParams({ limit: '100' })); const brand = result.data.find((item) => item.id === id); if (!brand) throw new ApiError(404, 'BRAND_NOT_FOUND', 'Brand not found'); return brand },
  }

  const source = {
    async list(query) {
      const q = normalizeSearch(query.get('q')); const category = query.get('category'); const country = normalizeSearch(query.get('country')); const sourceType = query.get('sourceType'); const sort = query.get('sort') || 'newest'; const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (query.has('q') && !q) throw new ApiError(400, 'SEARCH_QUERY_REQUIRED', 'q must contain at least one non-whitespace character')
      if (q.length > 160 || country.length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'search or country is too long')
      if (sourceType && !['external'].includes(sourceType)) throw new ApiError(400, 'VALIDATION_ERROR', 'sourceType is not supported')
      if (!['newest', 'price_asc', 'price_desc'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
      const [listings, products, categories] = await Promise.all([store.read('sourcingListings'), store.read('products'), store.read('categories')]); const categoryById = new Map(categories.map((item) => [item.id, item])); const rows = listings.map((listing) => ({ ...listing, product: products.find((product) => product.id === listing.productId && product.active), category: categoryById.get(listing.categoryId)?.name || listing.categoryId })).filter((listing) => listing.product && (!q || normalizeSearch(`${listing.title} ${listing.description}`).includes(q)) && (!category || listing.categoryId === category) && (!country || normalizeSearch(listing.country).includes(country)) && (!sourceType || listing.sourceType === sourceType)); const sorters = { newest: newestFirst, price_asc: (a, b) => a.product.price - b.product.price, price_desc: (a, b) => b.product.price - a.product.price }; rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async detail(id) { const result = await this.list(new URLSearchParams({ limit: '100' })); const listing = result.data.find((item) => item.id === id); if (!listing) throw new ApiError(404, 'SOURCE_ITEM_NOT_FOUND', 'Sourced item not found'); const products = await store.read('products'); return { ...listing, relatedProducts: products.filter((item) => item.active && item.categoryId === listing.categoryId && item.id !== listing.productId).slice(0, 4) } },
    async filters() { const [categories, listings] = await Promise.all([store.read('categories'), store.read('sourcingListings')]); return { categories: categories.filter((item) => item.active && listings.some((listing) => listing.categoryId === item.id)).map(({ id, name }) => ({ id, name })), countries: [...new Set(listings.map((item) => item.country))], sourceTypes: ['external'] } },
  }

  const search = {
    async query(query) {
      const options = searchOptions(query)
      const [products, categoryRows, promotions, auctions, affiliateProgram, communityMessages] = await Promise.all([
        store.read('products'), store.read('categories'), store.read('sellerPromotions'), store.read('auctions'), store.read('affiliateProgram'), store.read('communityMessages'),
      ])
      const categoryById = new Map(categoryRows.map((category) => [category.id, category]))
      const typeAllowed = (type) => !options.types || options.types.has(type)
      const categoryMatches = (category) => !options.category || normalizeSearch(category?.id) === options.category || normalizeSearch(category?.name) === options.category
      const results = []
      const add = (type, fields, result) => {
        if (!typeAllowed(type)) return
        const score = relevance(options.value, fields)
        if (score) results.push({ type, score, ...result })
      }

      categoryRows.filter((item) => item.active).forEach((item) => {
        if (!categoryMatches(item)) return
        add('category', [item.name, ...item.children], { id: item.id, title: item.name, description: item.children.join(', '), href: '#categories' })
      })
      products.filter((item) => item.active).forEach((item) => {
        const category = categoryById.get(item.categoryId)
        if (!categoryMatches(category)) return
        const base = { id: item.id, title: item.title, description: category?.name || 'Marketplace product', category: category?.name, image: item.image, href: '#featured' }
        add('product', [item.title, category?.name], base)
        if (item.discountPercent > 0 && options.types?.has('flash-sale')) add('flash-sale', [item.title, category?.name, 'flash sale'], { ...base, description: `${item.discountPercent}% flash sale · ${base.description}` })
      })
      promotions.filter((item) => item.active).forEach((item) => {
        if (options.category && normalizeSearch(item.category) !== options.category) return
        add('seller-promotion', [item.sellerName, item.category, item.text], { id: item.id, title: item.sellerName, description: item.text, category: item.category, image: item.avatar, href: '#featured' })
      })
      auctions.filter((item) => item.status !== 'cancelled').forEach((item) => {
        const category = categoryById.get(item.categoryId)
        if (!categoryMatches(category)) return
        add('auction', [item.title, item.description, category?.name], { id: item.id, title: item.title, description: item.description || 'Marketplace auction', category: category?.name, image: item.image, href: '#reviews' })
      })
      if (affiliateProgram && typeAllowed('affiliate-program')) {
        add('affiliate-program', [affiliateProgram.title, affiliateProgram.description, 'service rewards impact'], { id: affiliateProgram.id, title: affiliateProgram.title, description: affiliateProgram.description, href: '#sell' })
      }
      communityMessages.forEach((item) => add('community-post', [item.userName, item.text], { id: item.id, title: item.userName, description: item.text, image: item.avatar, href: '#support' }))

      results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      const total = results.length
      const pages = Math.max(1, Math.ceil(total / options.limit))
      const data = results.slice((options.page - 1) * options.limit, options.page * options.limit).map((item) => {
        const result = { ...item }
        delete result.score
        return result
      })
      return { data, meta: { query: options.value, page: options.page, limit: options.limit, total, pages } }
    },
  }

  const community = {
    async list(query) { return paginate([...await store.read('communityMessages')].sort(newestFirst), query) },
    async post(body, user) {
      const messageText = text(body.text, 'text', { max: 1000 })
      return store.mutate((db) => {
        const message = { id: store.id('community'), userId: user.id, userName: user.name, avatar: user.avatar, text: messageText, createdAt: new Date().toISOString() }
        db.communityMessages.push(message)
        return message
      })
    },
  }

  const chat = {
    async overview(user) {
      const conversations = [...await store.read('conversations')].filter((item) => item.userId === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      return { conversations: conversations.slice(0, 8), suggestions: await this.suggestions(user), capabilities: ['products', 'suppliers', 'services', 'categories', 'marketplace-listings', 'auctions', 'flash-sales', 'documentation'] }
    },
    async suggestions(user) {
      const recentMessages = (await store.read('chatMessages')).filter((message) => message.role === 'user')
      const ownConversationIds = new Set((await store.read('conversations')).filter((item) => item.userId === user.id).map((item) => item.id))
      return { recommended: ['Find sustainable furniture for a boutique hotel', 'Compare air and sea freight options', 'Show me handmade Indonesian home décor', 'Help me prepare a wholesale sourcing brief'], quickActions: ['Discover products', 'Find suppliers', 'Plan procurement', 'Explore categories'], recentlyAsked: recentMessages.filter((item) => ownConversationIds.has(item.conversationId)).slice(-4).reverse().map((item) => item.text), saved: [] }
    },
    async createConversation(body, user) {
      const title = text(body.title || 'New sourcing conversation', 'title', { max: 120 })
      return store.mutate((db) => {
        const timestamp = new Date().toISOString()
        const conversation = { id: store.id('conversation'), userId: user.id, title, createdAt: timestamp, updatedAt: timestamp }
        db.conversations.push(conversation)
        db.chatMessages.push({ id: store.id('message'), conversationId: conversation.id, role: 'assistant', text: 'Hi there! I am Amia, powered by Buyamia. How can I help?', createdAt: timestamp })
        return conversation
      })
    },
    async conversations(query, user) { return paginate([...await store.read('conversations')].filter((item) => item.userId === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)), query) },
    async updateConversation(id, body, user) {
      const title = text(body.title, 'title', { max: 120 })
      return store.mutate((db) => { const conversation = db.conversations.find((item) => item.id === id && item.userId === user.id); if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found'); conversation.title = title; conversation.updatedAt = new Date().toISOString(); return conversation })
    },
    async deleteConversation(id, user) {
      return store.mutate((db) => { const index = db.conversations.findIndex((item) => item.id === id && item.userId === user.id); if (index < 0) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found'); const [conversation] = db.conversations.splice(index, 1); db.chatMessages = db.chatMessages.filter((item) => item.conversationId !== id); return conversation })
    },
    async messages(conversationId, query, user) {
      const conversations = await store.read('conversations')
      if (!conversations.some((item) => item.id === conversationId && item.userId === user.id)) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found')
      return paginate([...await store.read('chatMessages')].filter((item) => item.conversationId === conversationId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), query)
    },
    async send(conversationId, body, user) {
      const messageText = text(body.text || body.prompt, 'prompt', { max: 4000 })
      const products = (await store.read('products')).filter((product) => product.active).slice(0, 3).map(({ id, title, image, price, currency, categoryId }) => ({ id, title, image, price, currency, categoryId }))
      return store.mutate((db) => {
        const conversation = db.conversations.find((item) => item.id === conversationId && item.userId === user.id)
        if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found')
        const timestamp = new Date().toISOString()
        const userMessage = { id: store.id('message'), conversationId, role: 'user', text: messageText, createdAt: timestamp }
        const assistantMessage = { id: store.id('message'), conversationId, role: 'assistant', text: `I’ve prepared a starting point for “${messageText.slice(0, 120)}”. These Buyamia products may fit your brief. Share your preferred quantity, budget, destination, and delivery date and I can narrow the options.`, createdAt: new Date(Date.now() + 1).toISOString(), mocked: true, provider: 'placeholder', result: { type: 'marketplace-search-preview', products, nextQuestions: ['What quantity do you need?', 'What is your target budget?', 'Where should the order be delivered?'] } }
        db.chatMessages.push(userMessage, assistantMessage)
        if (conversation.title === 'New sourcing conversation') conversation.title = messageText.slice(0, 72)
        conversation.updatedAt = assistantMessage.createdAt
        return { userMessage, assistantMessage }
      })
    },
    async prompt(body, user) {
      const prompt = text(body.prompt || body.text, 'prompt', { max: 4000 })
      let conversationId = body.conversationId
      if (conversationId !== undefined) conversationId = text(conversationId, 'conversationId', { max: 160 })
      if (!conversationId) conversationId = (await this.createConversation({ title: prompt.slice(0, 72) }, user)).id
      const messages = await this.send(conversationId, { prompt }, user)
      return { conversationId, ...messages }
    },
  }

  const account = {
    async profile(user) {
      const account = (await store.read('accounts')).find((item) => item.userId === user.id)
      if (account) return account
      const [firstName = 'User', ...rest] = user.name.trim().split(/\s+/)
      return { userId: user.id, firstName, lastName: rest.join(' ') || 'Name', username: user.id, email: 'user@example.com', phone: '', company: '', country: 'Indonesia (ID)', language: 'en', currency: 'IDR', avatar: user.avatar }
    },
    async updateProfile(body, user) {
      const current = await this.profile(user)
      const firstName = text(body.firstName ?? current.firstName, 'firstName', { max: 80 })
      const lastName = text(body.lastName ?? current.lastName, 'lastName', { max: 80 })
      const username = text(body.username ?? current.username, 'username', { min: 3, max: 40 })
      const email = text(body.email ?? current.email, 'email', { max: 160 })
      const phone = text(body.phone ?? current.phone, 'phone', { max: 40 })
      const company = text(body.company ?? current.company, 'company', { max: 160, required: false }) || ''
      const country = text(body.country ?? current.country, 'country', { max: 100 })
      const language = text(body.language ?? current.language, 'language', { max: 12 })
      const currency = text(body.currency ?? current.currency, 'currency', { min: 3, max: 3 })
      const avatar = text(body.avatar ?? current.avatar ?? user.avatar, 'avatar', { max: 500000 })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address')
      if (!/^\+?[0-9][0-9 ()-]{5,38}$/.test(phone)) throw new ApiError(400, 'VALIDATION_ERROR', 'phone must be a valid phone number')
      return store.mutate((db) => {
        const timestamp = new Date().toISOString()
        const profile = { userId: user.id, firstName, lastName, username, email, phone, company, country, language, currency: currency.toUpperCase(), avatar, updatedAt: timestamp }
        if (db.accounts.some((item) => item.userId !== user.id && item.username?.toLowerCase() === username.toLowerCase())) throw new ApiError(409, 'USERNAME_EXISTS', 'That username is already in use')
        if (db.accounts.some((item) => item.userId !== user.id && item.email?.toLowerCase() === email.toLowerCase())) throw new ApiError(409, 'EMAIL_EXISTS', 'That email address is already in use')
        const index = db.accounts.findIndex((item) => item.userId === user.id)
        if (index < 0) db.accounts.push({ ...profile, createdAt: timestamp })
        else db.accounts[index] = { ...db.accounts[index], ...profile }
        return db.accounts.find((item) => item.userId === user.id)
      })
    },
    async preferences(user) { return (await store.read('userPreferences')).find((item) => item.userId === user.id) || { userId: user.id, currency: 'IDR', location: 'Bali, Indonesia', sidebar: { leftOpen: false, rightOpen: false } } },
    async updatePreferences(body, user) {
      const allowed = ['currency', 'location', 'sidebar']
      const update = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)))
      return store.mutate((db) => {
        let preferences = db.userPreferences.find((item) => item.userId === user.id)
        if (!preferences) { preferences = { userId: user.id }; db.userPreferences.push(preferences) }
        Object.assign(preferences, update, { updatedAt: new Date().toISOString() })
        return preferences
      })
    },
    async notifications(query, user) { return paginate([...await store.read('notifications')].filter((item) => item.userId === user.id).sort(newestFirst), query) },
    async security(user) { const security = (await store.read('accountSecurity')).find((item) => item.userId === user.id); return publicSecurity(security || newSecurity(user)) },
    async updateSecurity(body, user) {
      if (body.twoFactorEnabled !== undefined && typeof body.twoFactorEnabled !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'twoFactorEnabled must be a boolean')
      const result = await store.mutate((db) => {
        let security = db.accountSecurity.find((item) => item.userId === user.id)
        if (!security) { security = newSecurity(user); db.accountSecurity.push(security) }
        if (body.twoFactorEnabled !== undefined) security.twoFactorEnabled = body.twoFactorEnabled
        security.updatedAt = new Date().toISOString()
        return security
      })
      return publicSecurity(result)
    },
    async changePassword(body, user) {
      const newPassword = text(body.newPassword, 'newPassword', { min: 12, max: 200 }); const confirmPassword = text(body.confirmPassword, 'confirmPassword', { min: 12, max: 200 })
      if (newPassword !== confirmPassword) throw new ApiError(400, 'VALIDATION_ERROR', 'newPassword and confirmPassword must match')
      if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) throw new ApiError(400, 'VALIDATION_ERROR', 'newPassword must include uppercase, lowercase, and a number')
      const existing = (await store.read('accountSecurity')).find((item) => item.userId === user.id)
      if (existing?.passwordHash) { const currentPassword = text(body.currentPassword, 'currentPassword', { min: 1, max: 200 }); if (!(await passwordMatches(currentPassword, existing.passwordHash))) throw new ApiError(403, 'CURRENT_PASSWORD_INCORRECT', 'The current password is incorrect') }
      const hash = await passwordHash(newPassword)
      const result = await store.mutate((db) => { let security = db.accountSecurity.find((item) => item.userId === user.id); if (!security) { security = newSecurity(user); db.accountSecurity.push(security) }; security.passwordHash = hash; security.passwordUpdatedAt = new Date().toISOString(); security.activeSessions = security.activeSessions.filter((item) => item.current); security.updatedAt = security.passwordUpdatedAt; return security })
      return publicSecurity(result)
    },
    async sessions(user) { const security = (await store.read('accountSecurity')).find((item) => item.userId === user.id); return (security || newSecurity(user)).activeSessions },
    async removeSession(id, user) { return store.mutate((db) => { const security = db.accountSecurity.find((item) => item.userId === user.id); if (!security) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found'); const session = security.activeSessions.find((item) => item.id === id); if (!session || session.current) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found'); security.activeSessions = security.activeSessions.filter((item) => item.id !== id); return { id } }) },
    async loginHistory(query, user) { const security = (await store.read('accountSecurity')).find((item) => item.userId === user.id); return paginate([...(security || newSecurity(user)).loginHistory].sort(newestFirst), query) },
    async logoutAll(user) { const result = await store.mutate((db) => { let security = db.accountSecurity.find((item) => item.userId === user.id); if (!security) { security = newSecurity(user); db.accountSecurity.push(security) }; security.activeSessions = security.activeSessions.filter((item) => item.current); security.updatedAt = new Date().toISOString(); return security }); return publicSecurity(result) },
    async addresses(query, user) { return paginate((await store.read('shippingAddresses')).filter((item) => item.userId === user.id).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)), query) },
    async saveAddress(body, user, id) {
      const existing = id ? (await store.read('shippingAddresses')).find((item) => item.id === id && item.userId === user.id) : null
      if (id && !existing) throw new ApiError(404, 'ADDRESS_NOT_FOUND', 'Shipping address not found')
      const source = { ...existing, ...body, recipientName: body.fullName ?? body.recipientName ?? existing?.recipientName }
      const fields = ['recipientName', 'line1', 'city', 'country', 'postalCode', 'phone']
      const values = Object.fromEntries(fields.map((field) => [field, text(source[field], field, { max: field === 'line1' ? 200 : 100 })]))
      values.company = text(source.company, 'company', { max: 160, required: false }) || ''
      values.email = text(source.email, 'email', { max: 160, required: false }) || ''
      values.line2 = text(source.line2, 'line2', { max: 200, required: false }) || ''
      values.state = text(source.state, 'state', { max: 100, required: false }) || ''
      values.deliveryInstructions = text(source.deliveryInstructions, 'deliveryInstructions', { max: 600, required: false }) || ''
      if (!/^\+?[0-9][0-9 ()-]{5,38}$/.test(values.phone)) throw new ApiError(400, 'VALIDATION_ERROR', 'phone must be a valid phone number')
      if (!/^[A-Z0-9][A-Z0-9 -]{1,18}$/i.test(values.postalCode)) throw new ApiError(400, 'VALIDATION_ERROR', 'postalCode must be a valid postal code')
      if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address')
      return store.mutate((db) => { const timestamp = new Date().toISOString(); let address = id ? db.shippingAddresses.find((item) => item.id === id && item.userId === user.id) : null; if (!address) { address = { id: store.id('address'), userId: user.id, createdAt: timestamp }; db.shippingAddresses.push(address) }; const shouldDefault = body.isDefault === true || !db.shippingAddresses.some((item) => item.userId === user.id && item.isDefault); if (shouldDefault) db.shippingAddresses.filter((item) => item.userId === user.id).forEach((item) => { item.isDefault = false }); Object.assign(address, values, { isDefault: shouldDefault ? true : Boolean(address.isDefault), updatedAt: timestamp }); return address })
    },
    async address(id, user) { const address = (await store.read('shippingAddresses')).find((item) => item.id === id && item.userId === user.id); if (!address) throw new ApiError(404, 'ADDRESS_NOT_FOUND', 'Shipping address not found'); return address },
    async removeAddress(id, user) { return store.mutate((db) => { const index = db.shippingAddresses.findIndex((item) => item.id === id && item.userId === user.id); if (index < 0) throw new ApiError(404, 'ADDRESS_NOT_FOUND', 'Shipping address not found'); return db.shippingAddresses.splice(index, 1)[0] }) },
    async setDefaultAddress(id, user) { return store.mutate((db) => { const address = db.shippingAddresses.find((item) => item.id === id && item.userId === user.id); if (!address) throw new ApiError(404, 'ADDRESS_NOT_FOUND', 'Shipping address not found'); db.shippingAddresses.filter((item) => item.userId === user.id).forEach((item) => { item.isDefault = item.id === id }); return address }) },
    async bankAccounts(query, user) { return paginate((await store.read('bankAccounts')).filter((item) => item.userId === user.id).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map(publicBankAccount), query) },
    async saveBankAccount(body, user, id) {
      const existing = id ? (await store.read('bankAccounts')).find((item) => item.id === id && item.userId === user.id) : null
      if (id && !existing) throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account not found')
      const source = { ...existing, ...body }; const accountHolder = text(source.accountHolder, 'accountHolder', { max: 160 }); const bankName = text(source.bankName, 'bankName', { max: 160 }); const country = text(source.country || 'ID', 'country', { min: 2, max: 2 }).toUpperCase(); const currency = text(source.currency || 'IDR', 'currency', { min: 3, max: 3 }).toUpperCase(); const accountType = text(source.accountType || 'personal', 'accountType', { max: 30 })
      if (!supportedBankCountries.has(country)) throw new ApiError(400, 'VALIDATION_ERROR', 'country is not supported for bank accounts')
      if (!supportedBankCurrencies.has(currency)) throw new ApiError(400, 'VALIDATION_ERROR', 'currency is not supported for bank accounts')
      const rawNumber = body.accountNumber ? text(body.accountNumber, 'accountNumber', { min: 4, max: 80 }) : null
      if (!rawNumber && !existing) throw new ApiError(400, 'VALIDATION_ERROR', 'accountNumber is required')
      if (rawNumber && !/^[A-Z0-9 -]+$/i.test(rawNumber)) throw new ApiError(400, 'VALIDATION_ERROR', 'accountNumber contains invalid characters')
      const iban = text(source.iban, 'iban', { max: 34, required: false }) || ''; const swiftBic = text(source.swiftBic, 'swiftBic', { max: 11, required: false }) || ''; const routingNumber = text(source.routingNumber, 'routingNumber', { max: 20, required: false }) || ''
      if (iban && !/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(iban.replace(/\s+/g, '').toUpperCase())) throw new ApiError(400, 'VALIDATION_ERROR', 'iban must be a valid IBAN')
      if (swiftBic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swiftBic.toUpperCase())) throw new ApiError(400, 'VALIDATION_ERROR', 'swiftBic must be a valid SWIFT/BIC')
      const fingerprint = rawNumber ? bankFingerprint(rawNumber) : existing.accountFingerprint
      const result = await store.mutate((db) => { const timestamp = new Date().toISOString(); let account = id ? db.bankAccounts.find((item) => item.id === id && item.userId === user.id) : null; if (db.bankAccounts.some((item) => item.userId === user.id && item.id !== id && (item.accountFingerprint === fingerprint || (item.accountNumber && bankFingerprint(item.accountNumber) === fingerprint)))) throw new ApiError(409, 'BANK_ACCOUNT_EXISTS', 'That bank account is already saved'); if (!account) { account = { id: store.id('bank'), userId: user.id, createdAt: timestamp }; db.bankAccounts.push(account) }; const shouldDefault = Boolean(body.isDefault) || !db.bankAccounts.some((item) => item.userId === user.id && item.isDefault); if (shouldDefault) db.bankAccounts.filter((item) => item.userId === user.id).forEach((item) => { item.isDefault = false }); Object.assign(account, { accountHolder, bankName, accountFingerprint: fingerprint, last4: rawNumber ? rawNumber.replace(/\s+/g, '').slice(-4) : existing.last4, iban, swiftBic, routingNumber, country, currency, accountType, verificationStatus: existing?.verificationStatus || 'pending', isDefault: shouldDefault ? true : Boolean(account.isDefault), updatedAt: timestamp }); delete account.accountNumber; return account })
      return publicBankAccount(result)
    },
    async removeBankAccount(id, user) { const result = await store.mutate((db) => { const index = db.bankAccounts.findIndex((item) => item.id === id && item.userId === user.id); if (index < 0) throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account not found'); return db.bankAccounts.splice(index, 1)[0] }); return publicBankAccount(result) },
    async setDefaultBankAccount(id, user) { const result = await store.mutate((db) => { const account = db.bankAccounts.find((item) => item.id === id && item.userId === user.id); if (!account) throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account not found'); db.bankAccounts.filter((item) => item.userId === user.id).forEach((item) => { item.isDefault = item.id === id }); return account }); return publicBankAccount(result) },
    async orders(query, user) { const search = normalizeSearch(query.get('q')); const status = query.get('status'); const allowed = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Refunded']; if (status && !allowed.includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported'); return paginate((await store.read('orders')).filter((item) => item.userId === user.id && (!status || item.status === status) && (!search || normalizeSearch(item.orderNumber).includes(search))).sort(newestFirst), query) },
    async order(id, user) { const order = (await store.read('orders')).find((item) => item.id === id && item.userId === user.id); if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found'); const products = await store.read('products'); const productById = new Map(products.map((item) => [item.id, item])); const items = order.items.map((item) => ({ ...item, product: productById.get(item.productId), unitPrice: item.unitPrice ?? productById.get(item.productId)?.price ?? 0 })); const subtotal = order.subtotal ?? items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0); const shippingCost = order.shippingCost ?? 0; const taxes = order.taxes ?? 0; return { ...order, items, subtotal, shippingCost, taxes, total: order.total ?? subtotal + shippingCost + taxes, seller: order.seller || null, shipping: order.shipping || null, payment: order.payment || null, timeline: order.timeline || [{ status: order.status, at: order.updatedAt }], refund: order.refund || null } },
    async tracking(id, user) { const order = await this.order(id, user); return { orderId: order.id, orderNumber: order.orderNumber, status: order.status, trackingNumber: order.trackingNumber || null, deliveryEstimate: order.deliveryEstimate || null, shipping: order.shipping, timeline: order.timeline } },
    async invoice(id, user) { const order = await this.order(id, user); return { invoiceReference: order.invoiceReference || null, orderNumber: order.orderNumber, currency: order.currency, subtotal: order.subtotal, taxes: order.taxes, shippingCost: order.shippingCost, total: order.total, payment: order.payment } },
    async wishlist(query, user) { const products = await store.read('products'); const productById = new Map(products.map((item) => [item.id, item])); return paginate((await store.read('wishlists')).filter((item) => item.userId === user.id).sort(newestFirst).map((item) => ({ ...item, product: productById.get(item.productId) })).filter((item) => item.product), query) },
    async wishlistCount(user) { return { count: (await store.read('wishlists')).filter((item) => item.userId === user.id).length } },
    async addWishlist(body, user) { const productId = text(body.productId, 'productId', { max: 120 }); const product = (await store.read('products')).find((item) => item.id === productId && item.active); if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found'); return store.mutate((db) => { if (db.wishlists.some((item) => item.userId === user.id && item.productId === productId)) throw new ApiError(409, 'WISHLIST_ITEM_EXISTS', 'Product is already in your wishlist'); const item = { id: store.id('wishlist'), userId: user.id, productId, createdAt: new Date().toISOString() }; db.wishlists.push(item); return { ...item, product } }) },
    async removeWishlist(id, user) { const wishlistId = text(id, 'wishlistId', { max: 160 }); return store.mutate((db) => { const index = db.wishlists.findIndex((item) => item.id === wishlistId && item.userId === user.id); if (index < 0) throw new ApiError(404, 'WISHLIST_ITEM_NOT_FOUND', 'Wishlist item not found'); return db.wishlists.splice(index, 1)[0] }) },
    async clearWishlist(user) { return store.mutate((db) => { const removed = db.wishlists.filter((item) => item.userId === user.id); db.wishlists = db.wishlists.filter((item) => item.userId !== user.id); return { removed: removed.length } }) },
    async moveWishlistToCart(id, user) { return store.mutate((db) => { const item = db.wishlists.find((entry) => entry.id === id && entry.userId === user.id); if (!item) throw new ApiError(404, 'WISHLIST_ITEM_NOT_FOUND', 'Wishlist item not found'); let cartItem = db.cartItems.find((entry) => entry.userId === user.id && entry.productId === item.productId); if (!cartItem) { cartItem = { id: store.id('cart'), userId: user.id, productId: item.productId, quantity: 1, createdAt: new Date().toISOString() }; db.cartItems.push(cartItem) }; db.wishlists.splice(db.wishlists.indexOf(item), 1); return { item, cartItem } }) },
    async saved(query, user) {
      const q = text(query.get('q'), 'q', { max: 160, required: false })?.toLowerCase(); const category = text(query.get('category'), 'category', { max: 120, required: false }); const collectionId = text(query.get('collection'), 'collection', { max: 160, required: false }); const sort = query.get('sort') || 'newest'
      const rawPage = query.get('page'); const rawLimit = query.get('limit'); if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
      if (!['newest', 'oldest', 'price-asc', 'price-desc', 'name'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (collectionId && !(await store.read('savedCollections')).some((item) => item.id === collectionId && item.userId === user.id)) throw new ApiError(404, 'COLLECTION_NOT_FOUND', 'Saved collection not found')
      const products = await store.read('products'); const productById = new Map(products.map((item) => [item.id, item])); let rows = (await store.read('wishlists')).filter((item) => item.userId === user.id && (!collectionId || item.collectionId === collectionId)).map((item) => ({ ...item, type: 'product', product: productById.get(item.productId) })).filter((item) => item.product && (!category || item.product.categoryId === category) && (!q || `${item.product.title} ${item.product.categoryId}`.toLowerCase().includes(q)))
      const sorters = { newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt), oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt), 'price-asc': (a, b) => a.product.price - b.product.price, 'price-desc': (a, b) => b.product.price - a.product.price, name: (a, b) => a.product.title.localeCompare(b.product.title) }; rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async saveItem(body, user) { if (body.collectionId && !(await store.read('savedCollections')).some((entry) => entry.id === body.collectionId && entry.userId === user.id)) throw new ApiError(404, 'COLLECTION_NOT_FOUND', 'Saved collection not found'); const item = await this.addWishlist(body, user); if (body.collectionId) { await this.addCollectionItem(body.collectionId, { savedItemId: item.id }, user); item.collectionId = body.collectionId } return item },
    async collections(user) { const saved = await store.read('wishlists'); return (await store.read('savedCollections')).filter((item) => item.userId === user.id).map((item) => ({ ...item, itemCount: saved.filter((savedItem) => savedItem.userId === user.id && savedItem.collectionId === item.id).length })).sort(newestFirst) },
    async createCollection(body, user) { const name = text(body.name, 'name', { max: 80 }); return store.mutate((db) => { if (db.savedCollections.some((item) => item.userId === user.id && item.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'COLLECTION_EXISTS', 'A collection with this name already exists'); const timestamp = new Date().toISOString(); const collection = { id: store.id('collection'), userId: user.id, name, createdAt: timestamp, updatedAt: timestamp }; db.savedCollections.push(collection); return collection }) },
    async updateCollection(id, body, user) { const name = text(body.name, 'name', { max: 80 }); return store.mutate((db) => { const collection = db.savedCollections.find((item) => item.id === id && item.userId === user.id); if (!collection) throw new ApiError(404, 'COLLECTION_NOT_FOUND', 'Saved collection not found'); if (db.savedCollections.some((item) => item.userId === user.id && item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'COLLECTION_EXISTS', 'A collection with this name already exists'); collection.name = name; collection.updatedAt = new Date().toISOString(); return collection }) },
    async deleteCollection(id, user) { return store.mutate((db) => { const index = db.savedCollections.findIndex((item) => item.id === id && item.userId === user.id); if (index < 0) throw new ApiError(404, 'COLLECTION_NOT_FOUND', 'Saved collection not found'); db.wishlists.filter((item) => item.userId === user.id && item.collectionId === id).forEach((item) => { item.collectionId = null }); return db.savedCollections.splice(index, 1)[0] }) },
    async addCollectionItem(collectionId, body, user) { const savedItemId = text(body.savedItemId, 'savedItemId', { max: 160 }); return store.mutate((db) => { const collection = db.savedCollections.find((item) => item.id === collectionId && item.userId === user.id); if (!collection) throw new ApiError(404, 'COLLECTION_NOT_FOUND', 'Saved collection not found'); const item = db.wishlists.find((entry) => entry.id === savedItemId && entry.userId === user.id); if (!item) throw new ApiError(404, 'SAVED_ITEM_NOT_FOUND', 'Saved item not found'); item.collectionId = collectionId; item.updatedAt = new Date().toISOString(); return item }) },
    async removeCollectionItem(collectionId, savedItemId, user) { return store.mutate((db) => { if (!db.savedCollections.some((item) => item.id === collectionId && item.userId === user.id)) throw new ApiError(404, 'COLLECTION_NOT_FOUND', 'Saved collection not found'); const item = db.wishlists.find((entry) => entry.id === savedItemId && entry.userId === user.id && entry.collectionId === collectionId); if (!item) throw new ApiError(404, 'SAVED_ITEM_NOT_FOUND', 'Saved item not found in this collection'); item.collectionId = null; item.updatedAt = new Date().toISOString(); return item }) },
    async savedRecommendations(user) { const savedIds = new Set((await store.read('wishlists')).filter((item) => item.userId === user.id).map((item) => item.productId)); return (await store.read('products')).filter((item) => item.active && !savedIds.has(item.id)).sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating).slice(0, 4) },
    async history(query, user) {
      const rawPage = query.get('page'); const rawLimit = query.get('limit'); const search = text(query.get('q'), 'q', { max: 160, required: false })?.toLowerCase()
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
      const products = await store.read('products'); const productById = new Map(products.map((item) => [item.id, item]))
      const items = (await store.read('browsingHistory')).filter((item) => item.userId === user.id).map((item) => {
        const product = item.productId ? productById.get(item.productId) : null
        return { ...item, itemId: item.itemId || item.productId, itemType: item.itemType || 'product', title: item.title || product?.title || 'Viewed item', thumbnail: item.thumbnail || product?.image || null, destinationUrl: item.destinationUrl || (product ? `/products/${product.id}` : '/'), category: item.category || product?.categoryId || null, product }
      }).filter((item) => !search || [item.title, item.category, item.itemType].filter(Boolean).join(' ').toLowerCase().includes(search)).sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))
      return paginate(items, query)
    },
    async recordHistory(body, user) {
      const itemType = text(body.itemType || (body.productId ? 'product' : undefined), 'itemType', { max: 30 }).toLowerCase()
      if (!['product', 'service', 'category', 'listing'].includes(itemType)) throw new ApiError(400, 'VALIDATION_ERROR', 'itemType is not supported')
      const itemId = text(body.itemId || body.productId, 'itemId', { max: 120 })
      const products = await store.read('products'); const product = itemType === 'product' ? products.find((item) => item.id === itemId && item.active) : null
      if (itemType === 'product' && !product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
      const title = product?.title || text(body.title, 'title', { max: 240 })
      const thumbnail = product?.image || text(body.thumbnail, 'thumbnail', { max: 1000, required: false }) || null
      const destinationUrl = product ? `/products/${product.id}` : text(body.destinationUrl, 'destinationUrl', { max: 1000 })
      if (!destinationUrl.startsWith('/') || destinationUrl.startsWith('//')) throw new ApiError(400, 'VALIDATION_ERROR', 'destinationUrl must be a relative site URL')
      const category = product?.categoryId || text(body.category, 'category', { max: 120, required: false }) || null
      return store.mutate((db) => { const timestamp = new Date().toISOString(); let item = db.browsingHistory.find((entry) => entry.userId === user.id && (entry.itemId || entry.productId) === itemId && (entry.itemType || 'product') === itemType); if (!item) { item = { id: store.id('history'), userId: user.id, itemId, itemType, title, thumbnail, destinationUrl, category, productId: itemType === 'product' ? itemId : undefined, viewedAt: timestamp }; db.browsingHistory.push(item) } else Object.assign(item, { title, thumbnail, destinationUrl, category, viewedAt: timestamp }); return item })
    },
    async removeHistory(id, user) { const historyId = text(id, 'historyId', { max: 160 }); return store.mutate((db) => { const index = db.browsingHistory.findIndex((item) => item.id === historyId && item.userId === user.id); if (index < 0) throw new ApiError(404, 'HISTORY_ITEM_NOT_FOUND', 'Browsing-history item not found'); return db.browsingHistory.splice(index, 1)[0] }) },
    async clearHistory(user) { return store.mutate((db) => { const removed = db.browsingHistory.filter((item) => item.userId === user.id); db.browsingHistory = db.browsingHistory.filter((item) => item.userId !== user.id); return { removed: removed.length } }) },
    async affiliateProfile(user) { const existing = (await store.read('affiliateProfiles')).find((item) => item.userId === user.id); if (existing) return existing; return store.mutate((db) => { let profile = db.affiliateProfiles.find((item) => item.userId === user.id); if (!profile) { const base = user.id.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'MEMBER'; let code = `BUY-${base}`; let suffix = 1; while (db.affiliateProfiles.some((item) => item.referralCode === code)) code = `BUY-${base}-${suffix++}`; profile = { id: store.id('affiliate-profile'), userId: user.id, referralCode: code, referralUrl: `/ref/${code}`, status: 'active', createdAt: new Date().toISOString() }; db.affiliateProfiles.push(profile) }; return profile }) },
    async affiliateDashboard(user) { const profile = await this.affiliateProfile(user); const [commissions, payouts, referrals] = await Promise.all(['affiliateCommissions', 'affiliatePayouts', 'affiliateReferrals'].map((collection) => store.read(collection))); const ownCommissions = commissions.filter((item) => item.userId === user.id); const ownReferrals = referrals.filter((item) => item.userId === user.id); const totalEarnings = ownCommissions.reduce((sum, item) => sum + item.amount, 0); const pendingEarnings = ownCommissions.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0); const paidEarnings = ownCommissions.filter((item) => item.status === 'paid' || item.status === 'completed').reduce((sum, item) => sum + item.amount, 0); return { profile, statistics: { totalReferrals: ownReferrals.length, successfulReferrals: ownReferrals.filter((item) => item.status === 'successful' || item.status === 'converted').length, pendingReferrals: ownReferrals.filter((item) => item.status === 'pending').length, totalEarnings, pendingEarnings, paidEarnings, withdrawableEarnings: ownCommissions.filter((item) => item.status === 'approved').reduce((sum, item) => sum + item.amount, 0), currency: 'IDR' }, commissions: ownCommissions.sort(newestFirst), payouts: payouts.filter((item) => item.userId === user.id).sort(newestFirst), referrals: ownReferrals.sort(newestFirst) } },
  }

  const affiliate = {
    async get() { return store.read('affiliateProgram') },
    async apply(body, user) {
      const website = text(body.website, 'website', { max: 240, required: false })
      const motivation = text(body.motivation, 'motivation', { max: 1500 })
      return store.mutate((db) => {
        if (db.affiliateApplications.some((item) => item.userId === user.id && item.status === 'pending')) throw new ApiError(409, 'APPLICATION_EXISTS', 'A pending application already exists')
        const application = { id: store.id('affiliate'), userId: user.id, website, motivation, status: 'pending', createdAt: new Date().toISOString() }
        db.affiliateApplications.push(application)
        return application
      })
    },
  }

  const support = {
    async categories() { return { data: await store.read('supportCategories') } },
    async faqs(query) {
      const search = normalizeSearch(query.get('q'))
      const category = query.get('category')
      const rows = (await store.read('supportFaqs')).filter((item) => (!category || item.categoryId === category) && (!search || normalizeSearch(`${item.question} ${item.answer}`).includes(search)))
      return paginate(rows, query)
    },
    async tickets(query, user) { return paginate((await store.read('supportTickets')).filter((item) => item.userId === user.id).sort(newestFirst), query) },
    async ticket(id, user) {
      const ticket = (await store.read('supportTickets')).find((item) => item.id === id && item.userId === user.id)
      if (!ticket) throw new ApiError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found')
      return ticket
    },
    async createTicket(body, user) {
      const title = text(body.title, 'title', { max: 160 })
      const description = text(body.description, 'description', { min: 10, max: 4000 })
      const categoryId = text(body.categoryId, 'categoryId', { max: 80 })
      const priority = text(body.priority || 'normal', 'priority', { max: 20 })
      if (!(await store.read('supportCategories')).some((item) => item.id === categoryId)) throw new ApiError(400, 'VALIDATION_ERROR', 'categoryId must be a valid support category')
      if (!['low', 'normal', 'high'].includes(priority)) throw new ApiError(400, 'VALIDATION_ERROR', 'priority must be low, normal, or high')
      if (body.attachments !== undefined && (!Array.isArray(body.attachments) || body.attachments.some((item) => !item || typeof item.name !== 'string' || item.name.length > 160))) throw new ApiError(400, 'VALIDATION_ERROR', 'attachments must contain valid file metadata')
      return store.mutate((db) => {
        const timestamp = new Date().toISOString()
        const ticket = { id: store.id('ticket'), userId: user.id, title, description, categoryId, priority, status: 'open', assignedAgent: null, attachments: body.attachments || [], createdAt: timestamp, updatedAt: timestamp }
        db.supportTickets.push(ticket)
        return ticket
      })
    },
  }

  function positiveInteger(value, field, maximum = 999) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an integer between 1 and ${maximum}`)
    return value
  }

  async function cartView(user) {
    const [products, cartItems, coupons] = await Promise.all([store.read('products'), store.read('cartItems'), store.read('cartCoupons')])
    const productById = new Map(products.map((product) => [product.id, product]))
    const unavailableIds = cartItems.filter((item) => item.userId === user.id && !productById.get(item.productId)?.active).map((item) => item.id)
    if (unavailableIds.length) await store.mutate((db) => { db.cartItems = db.cartItems.filter((item) => !unavailableIds.includes(item.id)) })
    const items = cartItems.filter((item) => item.userId === user.id && !unavailableIds.includes(item.id)).map((item) => {
      const product = productById.get(item.productId)
      const unitPrice = item.unitPrice ?? product.price
      return { ...item, product, unitPrice, lineTotal: unitPrice * item.quantity, availableStock: product.stock ?? 100 }
    })
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
    const shipping = items.length ? (items.some((item) => item.shippingMethod === 'air') ? 600000 : 350000) : 0
    const coupon = coupons.find((item) => item.userId === user.id)
    const automaticDiscount = subtotal >= 3000000 ? 350000 : 0
    const couponDiscount = coupon?.code === 'BUYAMIA10' ? Math.min(Math.round(subtotal * .1), 500000) : 0
    const discount = Math.max(automaticDiscount, couponDiscount)
    const taxes = 0
    return { items, summary: { itemCount: items.reduce((sum, item) => sum + item.quantity, 0), subtotal, shipping, discount, taxes, total: Math.max(0, subtotal + shipping + taxes - discount), currency: 'IDR', coupon: coupon?.code || null, deliveryEstimate: items.length ? '7–14 business days' : null } }
  }

  const cart = {
    get: cartView,
    async add(body, user) {
      const productId = text(body.productId, 'productId', { max: 120 }); const quantity = positiveInteger(body.quantity ?? 1, 'quantity')
      const product = (await store.read('products')).find((item) => item.id === productId && item.active)
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found or unavailable')
      const stock = product.stock ?? 100; if (quantity > stock) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${stock} units are available`)
      await store.mutate((db) => { const item = { id: store.id('cart'), userId: user.id, productId, quantity, packSize: positiveInteger(body.packSize ?? 1, 'packSize'), unitPrice: product.price, shippingMethod: 'sea', customization: 'No', warranty: 'No', createdAt: new Date().toISOString() }; db.cartItems.push(item) })
      return cartView(user)
    },
    async update(id, body, user) {
      const quantity = body.quantity === undefined ? undefined : positiveInteger(body.quantity, 'quantity')
      const shippingMethod = body.shippingMethod === undefined ? undefined : text(body.shippingMethod, 'shippingMethod', { max: 10 })
      if (shippingMethod && !['air', 'sea'].includes(shippingMethod)) throw new ApiError(400, 'VALIDATION_ERROR', 'shippingMethod must be air or sea')
      await store.mutate((db) => { const item = db.cartItems.find((entry) => entry.id === id && entry.userId === user.id); if (!item) throw new ApiError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found'); const product = db.products.find((entry) => entry.id === item.productId && entry.active); if (!product) throw new ApiError(409, 'PRODUCT_UNAVAILABLE', 'This product is no longer available'); if (quantity > (product.stock ?? 100)) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock ?? 100} units are available`); if (quantity !== undefined) item.quantity = quantity; if (shippingMethod) item.shippingMethod = shippingMethod; item.updatedAt = new Date().toISOString() })
      return cartView(user)
    },
    async remove(id, user) { await store.mutate((db) => { const index = db.cartItems.findIndex((item) => item.id === id && item.userId === user.id); if (index < 0) throw new ApiError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found'); db.cartItems.splice(index, 1) }); return cartView(user) },
    async clear(user) { await store.mutate((db) => { db.cartItems = db.cartItems.filter((item) => item.userId !== user.id); db.cartCoupons = db.cartCoupons.filter((item) => item.userId !== user.id) }); return cartView(user) },
    async save(id, user) { await store.mutate((db) => { const index = db.cartItems.findIndex((item) => item.id === id && item.userId === user.id); if (index < 0) throw new ApiError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found'); db.savedCartItems.push({ ...db.cartItems.splice(index, 1)[0], savedAt: new Date().toISOString() }) }); return cartView(user) },
    async coupon(body, user) { const code = text(body.code, 'code', { max: 30 }).toUpperCase(); if (code !== 'BUYAMIA10') throw new ApiError(400, 'INVALID_COUPON', 'This promotional code is invalid or expired'); await store.mutate((db) => { db.cartCoupons = db.cartCoupons.filter((item) => item.userId !== user.id); db.cartCoupons.push({ userId: user.id, code, appliedAt: new Date().toISOString() }) }); return cartView(user) },
    async recommendations() { return (await store.read('products')).filter((product) => product.active && product.featured).slice(0, 4) },
  }

  const checkout = {
    async prepare(body, user) {
      const cartData = await cartView(user); if (!cartData.items.length) throw new ApiError(409, 'EMPTY_CART', 'Add an item to your cart before checkout')
      const step = text(body.step || 'delivery', 'step', { max: 20 }); if (!['delivery', 'payment', 'card', 'confirm'].includes(step)) throw new ApiError(400, 'VALIDATION_ERROR', 'step is not supported')
      const allowedPayments = ['paypal', 'card']; if (body.paymentMethod && !allowedPayments.includes(body.paymentMethod)) throw new ApiError(400, 'VALIDATION_ERROR', 'paymentMethod must be paypal or card')
      if (step === 'delivery') { for (const field of ['firstName', 'lastName', 'country', 'addressLine1', 'city', 'region', 'zipCode', 'phone']) text(body.shipping?.[field], `shipping.${field}`, { max: 160 }) }
      if (step === 'card') { const card = body.card || {}; text(card.cardholderName, 'card.cardholderName', { max: 120 }); if (!/^\d{12,19}$/.test(String(card.cardNumber || '').replace(/\s/g, ''))) throw new ApiError(400, 'VALIDATION_ERROR', 'card.cardNumber must contain 12 to 19 digits'); if (!/^\d{2}\/\d{2}$/.test(String(card.expiration || ''))) throw new ApiError(400, 'VALIDATION_ERROR', 'card.expiration must use MM/YY'); if (!/^\d{3,4}$/.test(String(card.securityCode || ''))) throw new ApiError(400, 'VALIDATION_ERROR', 'card.securityCode must contain 3 or 4 digits') }
      const safeBody = { ...body }; if (safeBody.card) safeBody.card = { cardholderName: safeBody.card.cardholderName, last4: String(safeBody.card.cardNumber).replace(/\s/g, '').slice(-4), expiration: safeBody.card.expiration }
      const session = await store.mutate((db) => { let value = db.checkoutSessions.find((item) => item.userId === user.id); if (!value) { value = { id: store.id('checkout'), userId: user.id, createdAt: new Date().toISOString() }; db.checkoutSessions.push(value) } Object.assign(value, safeBody, { step, summary: cartData.summary, updatedAt: new Date().toISOString() }); return value })
      return session
    },
  }

  function sellerApplicationInput(body, { submitting = false } = {}) {
    const fields = ['companyName', 'legalName', 'email', 'phone', 'country', 'address', 'warehouseAddress', 'brandName']
    const values = Object.fromEntries(fields.map((field) => [field, text(body[field], field, { max: field.includes('Address') || field === 'address' ? 300 : 160, required: !['warehouseAddress', 'brandName'].includes(field) })]))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address')
    if (!/^\+?[0-9 ()-]{7,24}$/.test(values.phone)) throw new ApiError(400, 'VALIDATION_ERROR', 'phone must be a valid phone number')
    if (!Array.isArray(body.categories) || !body.categories.length || body.categories.some((item) => typeof item !== 'string' || item.length > 120)) throw new ApiError(400, 'VALIDATION_ERROR', 'categories must contain at least one valid category')
    const taxId = text(body.taxId, 'taxId', { max: 80, required: false }) || ''
    if (submitting && body.termsAccepted !== true) throw new ApiError(400, 'TERMS_REQUIRED', 'You must accept the seller terms before submitting')
    return { ...values, categories: [...new Set(body.categories)], taxId, termsAccepted: body.termsAccepted === true }
  }

  const seller = {
    async get(user) { return (await store.read('sellerApplications')).find((item) => item.userId === user.id) || null },
    async create(body, user) {
      if ((await store.read('sellerApplications')).some((item) => item.userId === user.id)) throw new ApiError(409, 'SELLER_APPLICATION_EXISTS', 'A seller application already exists for this account')
      const values = sellerApplicationInput(body)
      const categoryIds = new Set((await store.read('categories')).filter((item) => item.active).map((item) => item.id)); if (values.categories.some((id) => !categoryIds.has(id))) throw new ApiError(400, 'VALIDATION_ERROR', 'categories contains an unknown category')
      return store.mutate((db) => { const timestamp = new Date().toISOString(); const application = { id: store.id('seller-application'), userId: user.id, ...values, status: 'draft', verificationStatus: 'not-submitted', createdAt: timestamp, updatedAt: timestamp, submittedAt: null }; db.sellerApplications.push(application); return application })
    },
    async update(body, user) {
      const current = await this.get(user); if (!current) throw new ApiError(404, 'SELLER_APPLICATION_NOT_FOUND', 'Seller application not found'); if (!['draft', 'rejected'].includes(current.status)) throw new ApiError(409, 'APPLICATION_LOCKED', 'Submitted applications cannot be edited')
      const values = sellerApplicationInput({ ...current, ...body })
      const categoryIds = new Set((await store.read('categories')).filter((item) => item.active).map((item) => item.id)); if (values.categories.some((id) => !categoryIds.has(id))) throw new ApiError(400, 'VALIDATION_ERROR', 'categories contains an unknown category')
      return store.mutate((db) => { const application = db.sellerApplications.find((item) => item.id === current.id); Object.assign(application, values, { updatedAt: new Date().toISOString() }); return application })
    },
    async submit(user) {
      const current = await this.get(user); if (!current) throw new ApiError(404, 'SELLER_APPLICATION_NOT_FOUND', 'Seller application not found'); if (current.status !== 'draft' && current.status !== 'rejected') throw new ApiError(409, 'APPLICATION_ALREADY_SUBMITTED', 'This application has already been submitted')
      sellerApplicationInput(current, { submitting: true })
      const documents = (await store.read('sellerDocuments')).filter((item) => item.userId === user.id); if (!documents.length) throw new ApiError(400, 'DOCUMENT_REQUIRED', 'Upload at least one business verification document')
      return store.mutate((db) => { const application = db.sellerApplications.find((item) => item.id === current.id); const timestamp = new Date().toISOString(); Object.assign(application, { status: 'submitted', verificationStatus: 'pending-review', submittedAt: timestamp, updatedAt: timestamp }); return application })
    },
    async status(user) { const application = await this.get(user); return application ? { applicationId: application.id, status: application.status, verificationStatus: application.verificationStatus, submittedAt: application.submittedAt, updatedAt: application.updatedAt } : { status: 'not-started', verificationStatus: 'not-submitted' } },
    async documents(user) { return (await store.read('sellerDocuments')).filter((item) => item.userId === user.id).sort(newestFirst) },
    async addDocument(body, user) {
      const application = await this.get(user); if (!application) throw new ApiError(404, 'SELLER_APPLICATION_NOT_FOUND', 'Create an application before uploading documents'); if (!['draft', 'rejected'].includes(application.status)) throw new ApiError(409, 'APPLICATION_LOCKED', 'Submitted applications cannot be edited')
      const name = text(body.name, 'name', { max: 160 }); const type = text(body.type, 'type', { max: 40 }); const mimeType = text(body.mimeType, 'mimeType', { max: 100 }); const size = Number(body.size)
      if (!['business-registration', 'tax-certificate', 'identity', 'bank-proof', 'other'].includes(type)) throw new ApiError(400, 'VALIDATION_ERROR', 'document type is not supported')
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType)) throw new ApiError(400, 'VALIDATION_ERROR', 'document mimeType must be PDF, JPEG, or PNG')
      if (!Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024) throw new ApiError(400, 'VALIDATION_ERROR', 'document size must be between 1 byte and 10 MB')
      return store.mutate((db) => { const document = { id: store.id('seller-document'), applicationId: application.id, userId: user.id, name, type, mimeType, size, status: 'uploaded', createdAt: new Date().toISOString() }; db.sellerDocuments.push(document); return document })
    },
    async profile(user) { const profile = (await store.read('sellerProfiles')).find((item) => item.userId === user.id); if (!profile) throw new ApiError(404, 'SELLER_PROFILE_NOT_FOUND', 'Seller profile is available after approval'); return profile },
    async updateProfile(body, user) { const current = await this.profile(user); const displayName = text(body.displayName ?? current.displayName, 'displayName', { max: 120 }); const bio = text(body.bio ?? current.bio, 'bio', { max: 1200 }); const location = text(body.location ?? current.location, 'location', { max: 160 }); return store.mutate((db) => { const profile = db.sellerProfiles.find((item) => item.id === current.id); Object.assign(profile, { displayName, bio, location, updatedAt: new Date().toISOString() }); return profile }) },
    async dashboard(user) { const profile = await this.profile(user); const brand = (await store.read('brands')).find((item) => item.id === profile.brandId); const products = (await store.read('products')).filter((item) => brand?.productIds.includes(item.id)); const orders = (await store.read('orders')).filter((item) => item.seller?.id === profile.id); const notifications = (await store.read('notifications')).filter((item) => item.userId === user.id); return { profile, products, inventory: products.map((item) => ({ productId: item.id, available: item.stock ?? 100 })), orders, analytics: { productCount: products.length, orderCount: orders.length, revenue: orders.reduce((sum, item) => sum + item.total, 0) }, storeSettings: { public: profile.public }, payoutInformation: null, notifications } },
    async publicProfile(id) { const profile = (await store.read('sellerProfiles')).find((item) => item.id === id && item.public && item.verificationStatus === 'approved'); if (!profile) throw new ApiError(404, 'SELLER_NOT_FOUND', 'Seller not found'); const brand = (await store.read('brands')).find((item) => item.id === profile.brandId); const products = (await store.read('products')).filter((item) => brand?.productIds.includes(item.id) && item.active); return { ...profile, brand, products, reviews: [{ id: 'review-seller-1', name: 'Ellen', rating: 5, text: 'Beautifully made pieces with thoughtful details and reliable communication.' }], liveFeed: products.slice(0, 6) } },
  }

  function auctionStatus(auction) { const now = Date.now(); if (auction.status === 'cancelled') return 'cancelled'; if (now < new Date(auction.startTime).getTime()) return 'upcoming'; if (now >= new Date(auction.endTime).getTime()) return 'completed'; return 'live' }
  async function auctionRows(user) { const [items, products, profiles, bids, watches] = await Promise.all(['auctions', 'products', 'sellerProfiles', 'auctionBids', 'auctionWatchlists'].map((name) => store.read(name))); const productById = new Map(products.map((item) => [item.id, item])); const sellerById = new Map(profiles.map((item) => [item.id, item])); const watched = new Set(watches.filter((item) => item.userId === user?.id).map((item) => item.auctionId)); return items.map((auction) => { const ownBids = bids.filter((bid) => bid.auctionId === auction.id).sort((a, b) => b.amount - a.amount); const highest = ownBids[0]; const status = auctionStatus(auction); return { ...auction, status, currentBid: highest?.amount ?? auction.currentBid ?? auction.startingPrice, bidCount: Math.max(auction.bidCount || 0, ownBids.length), product: productById.get(auction.productId) || null, seller: sellerById.get(auction.sellerId) || null, remainingMs: status === 'live' ? Math.max(0, new Date(auction.endTime).getTime() - Date.now()) : 0, watched: watched.has(auction.id), reserveMet: (highest?.amount ?? auction.currentBid ?? auction.startingPrice) >= auction.reservePrice } }) }
  const auctions = {
    async list(query, user) { const q = text(query.get('q'), 'q', { max: 160, required: false })?.toLowerCase(); const status = query.get('status') || 'live'; const category = text(query.get('category'), 'category', { max: 120, required: false }); const sort = query.get('sort') || 'ending-soon'; const rawPage = query.get('page'); const rawLimit = query.get('limit'); if (!['all', 'live', 'upcoming', 'completed', 'hot-bidding'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported'); if (!['ending-soon', 'newest', 'bid-high', 'price-low', 'most-bids'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported'); if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100'); let rows = (await auctionRows(user)).filter((item) => item.status !== 'cancelled' && (status === 'all' || (status === 'hot-bidding' ? item.status === 'live' && item.bidCount > 0 : item.status === status)) && (!category || item.categoryId === category) && (!q || `${item.title} ${item.description} ${item.seller?.displayName || ''}`.toLowerCase().includes(q))); const sorters = { 'ending-soon': (a, b) => new Date(a.endTime) - new Date(b.endTime), newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt), 'bid-high': (a, b) => b.currentBid - a.currentBid, 'price-low': (a, b) => a.currentBid - b.currentBid, 'most-bids': (a, b) => b.bidCount - a.bidCount }; rows.sort(sorters[sort]); return paginate(rows, query) },
    async get(id, user) { const auction = (await auctionRows(user)).find((item) => item.id === id); if (!auction) throw new ApiError(404, 'AUCTION_NOT_FOUND', 'Auction not found'); return auction },
    async featured(user) { return (await auctionRows(user)).filter((item) => item.featured && item.status === 'live').sort((a, b) => a.remainingMs - b.remainingMs).slice(0, 4) },
    async bids(id, query, user) { await this.get(id, user); const rows = (await store.read('auctionBids')).filter((item) => item.auctionId === id).sort((a, b) => b.amount - a.amount || new Date(b.createdAt) - new Date(a.createdAt)).map((item) => ({ ...item, bidder: item.userId === user.id ? 'You' : `Bidder ${item.userId.slice(-4)}` })); return paginate(rows, query) },
    async placeBid(id, body, user) { const amount = Number(body.amount); if (!Number.isSafeInteger(amount) || amount < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'amount must be a positive whole number'); await store.mutate((db) => { const auction = db.auctions.find((item) => item.id === id); if (!auction) throw new ApiError(404, 'AUCTION_NOT_FOUND', 'Auction not found'); const status = auctionStatus(auction); if (status === 'upcoming') throw new ApiError(409, 'AUCTION_NOT_STARTED', 'This auction has not started'); if (status !== 'live') throw new ApiError(409, 'AUCTION_CLOSED', 'This auction is closed'); const seller = db.sellerProfiles.find((item) => item.id === auction.sellerId); if (seller?.userId === user.id) throw new ApiError(403, 'SELLER_CANNOT_BID', 'Sellers cannot bid on their own auctions'); const highest = db.auctionBids.filter((item) => item.auctionId === id).reduce((max, item) => Math.max(max, item.amount), auction.currentBid || auction.startingPrice); const minimum = highest + (auction.bidIncrement || 1); if (amount < minimum) throw new ApiError(409, 'BID_TOO_LOW', `Bid must be at least ${minimum}`); const bid = { id: store.id('bid'), auctionId: id, userId: user.id, amount, createdAt: new Date().toISOString() }; db.auctionBids.push(bid); auction.currentBid = amount; auction.bidCount = (auction.bidCount || 0) + 1; auction.updatedAt = bid.createdAt }); return this.get(id, user) },
    async watchlist(user) { return (await auctionRows(user)).filter((item) => item.watched) },
    async watch(body, user) { const auctionId = text(body.auctionId, 'auctionId', { max: 160 }); await this.get(auctionId, user); return store.mutate((db) => { if (db.auctionWatchlists.some((item) => item.userId === user.id && item.auctionId === auctionId)) throw new ApiError(409, 'AUCTION_ALREADY_WATCHED', 'Auction is already in your watchlist'); const item = { id: store.id('auction-watch'), userId: user.id, auctionId, createdAt: new Date().toISOString() }; db.auctionWatchlists.push(item); return item }) },
    async unwatch(id, user) { return store.mutate((db) => { const index = db.auctionWatchlists.findIndex((item) => item.userId === user.id && (item.id === id || item.auctionId === id)); if (index < 0) throw new ApiError(404, 'WATCHLIST_ITEM_NOT_FOUND', 'Auction watchlist item not found'); return db.auctionWatchlists.splice(index, 1)[0] }) },
    async history(query, user) { const ownBids = (await store.read('auctionBids')).filter((item) => item.userId === user.id); const latestByAuction = new Map(); ownBids.forEach((bid) => { if (!latestByAuction.has(bid.auctionId) || latestByAuction.get(bid.auctionId).amount < bid.amount) latestByAuction.set(bid.auctionId, bid) }); const byId = new Map((await auctionRows(user)).map((item) => [item.id, item])); return paginate([...latestByAuction.values()].map((bid) => ({ ...bid, auction: byId.get(bid.auctionId) })).filter((item) => item.auction).sort(newestFirst), query) },
  }

  return { about, categories, marketplace, brands, source, search, community, chat, account, affiliate, support, cart, checkout, seller, auctions }
}
