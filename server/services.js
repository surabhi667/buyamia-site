import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { buildNodeManifest } from './node-manifest.js'

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
const dummyPasswordHash = '00000000000000000000000000000000:37eb93dcf7f1a0155678935554d2c4839ba75886abfe857c0b3dec6abc1b735dfada31bf00797e77db38e2eb7c18aa6faf637216f618d132b3c614f9d9844a3e'
function tokenHash(token) { return createHash('sha256').update(token).digest('hex') }
function tokenMatches(token, storedHash) { const actual = Buffer.from(tokenHash(token)); const expected = Buffer.from(String(storedHash || '')); return actual.length === expected.length && timingSafeEqual(actual, expected) }
function publicSession(session) { const { tokenHash: _tokenHash, ...safe } = session; return safe }
function publicSecurity(security) { const { passwordHash: _passwordHash, ...safe } = security; return { ...safe, activeSessions: (safe.activeSessions || []).map(publicSession), passwordConfigured: Boolean(_passwordHash) } }
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

function normalizeEmail(value) {
  const email = text(value, 'email', { max: 160 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address')
  return email
}

function publicUser(account) {
  const fullName = [account.firstName, account.lastName].filter(Boolean).join(' ').trim()
  return {
    id: account.userId,
    userId: account.userId,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    name: fullName || account.username || account.email,
    username: account.username,
    avatar: account.avatar,
    authenticated: true,
  }
}

const authSessionTtlMs = 7 * 24 * 60 * 60 * 1000
function invalidCredentials() { return new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect') }
const orderStatuses = ['pending_payment', 'order_received', 'processing', 'shipped', 'delivered', 'cancelled']
const timelineSteps = ['order_received', 'processing', 'shipped', 'delivered']
const sensitiveOrderFields = new Set(['cardNumber', 'securityCode', 'cvc', 'cvv', 'paymentToken'])

function orderStatusLabel(status) {
  const labels = { pending_payment: 'Payment pending', order_received: 'Order received', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' }
  return labels[status] || status
}

function rejectSensitiveOrderData(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveOrderFields.has(key)) throw new ApiError(400, 'SENSITIVE_PAYMENT_DATA', `${key} must not be submitted`)
    if (entry && typeof entry === 'object') rejectSensitiveOrderData(entry)
  }
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

export function createServices(store, environment = process.env) {
  function newAuthSession(timestamp, requestMeta = {}) {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + authSessionTtlMs).toISOString()
    return {
      token,
      session: {
        id: store.id('session'),
        tokenHash: tokenHash(token),
        device: requestMeta.userAgent ? String(requestMeta.userAgent).slice(0, 160) : 'Browser',
        browser: 'Browser',
        operatingSystem: 'Unknown',
        location: 'Unknown',
        createdAt: timestamp,
        lastUsedAt: timestamp,
        expiresAt,
      },
    }
  }

  function accountByEmail(accounts, email) {
    return accounts.find((item) => item.normalizedEmail === email || item.email?.toLowerCase() === email)
  }

  function authSecurity(userId, timestamp, passwordHashValue, session, loginStatus = 'success') {
    return {
      userId,
      emailVerified: false,
      phoneVerified: false,
      twoFactorEnabled: false,
      passwordHash: passwordHashValue,
      passwordUpdatedAt: timestamp,
      activeSessions: [session],
      loginHistory: [{ id: store.id('login'), status: loginStatus, createdAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  const auth = {
    async signup(body, requestMeta = {}) {
      const email = normalizeEmail(body.email)
      const password = text(body.password, 'password', { min: 12, max: 200 })
      const rawName = text(body.name, 'name', { max: 160, required: false })
      const explicitFirstName = text(body.firstName, 'firstName', { max: 80, required: false })
      const explicitLastName = text(body.lastName, 'lastName', { max: 80, required: false })
      const passwordHashValue = await passwordHash(password)
      return store.mutate((db) => {
        if (accountByEmail(db.accounts, email)) throw new ApiError(409, 'EMAIL_EXISTS', 'That email address is already in use')
        const timestamp = new Date().toISOString()
        const userId = store.id('user')
        const [derivedFirstName = 'Buyamia', ...derivedLastName] = (rawName || email.split('@')[0]).trim().split(/\s+/)
        const firstName = explicitFirstName || derivedFirstName
        const lastName = explicitLastName || derivedLastName.join(' ') || 'User'
        const username = `user-${userId.replace(/^user_/, '').slice(0, 12)}`
        const account = { userId, firstName, lastName, username, email, normalizedEmail: email, phone: '', company: '', country: 'Indonesia (ID)', language: 'en', currency: 'IDR', avatar: '/assets/avatar-1.png', createdAt: timestamp, updatedAt: timestamp }
        const { token, session } = newAuthSession(timestamp, requestMeta)
        db.accounts.push(account)
        db.accountSecurity.push(authSecurity(userId, timestamp, passwordHashValue, session))
        return { user: publicUser(account), session: publicSession(session), sessionToken: token, sessionExpiresAt: session.expiresAt }
      })
    },
    async login(body, requestMeta = {}) {
      const email = normalizeEmail(body.email)
      const password = text(body.password, 'password', { min: 1, max: 200 })
      const accounts = await store.read('accounts')
      const account = accountByEmail(accounts, email)
      const security = account ? (await store.read('accountSecurity')).find((item) => item.userId === account.userId) : null
      const matches = await passwordMatches(password, security?.passwordHash || dummyPasswordHash)
      if (!account || !security?.passwordHash || !matches) throw invalidCredentials()
      return store.mutate((db) => {
        const currentAccount = db.accounts.find((item) => item.userId === account.userId)
        const currentSecurity = db.accountSecurity.find((item) => item.userId === account.userId)
        if (!currentAccount || !currentSecurity?.passwordHash) throw invalidCredentials()
        const timestamp = new Date().toISOString()
        const { token, session } = newAuthSession(timestamp, requestMeta)
        currentSecurity.activeSessions = [...(currentSecurity.activeSessions || []).filter((item) => !item.expiresAt || new Date(item.expiresAt) > new Date(timestamp)), session]
        currentSecurity.loginHistory = [...(currentSecurity.loginHistory || []), { id: store.id('login'), status: 'success', createdAt: timestamp }]
        currentSecurity.updatedAt = timestamp
        return { user: publicUser(currentAccount), session: publicSession(session), sessionToken: token, sessionExpiresAt: session.expiresAt }
      })
    },
    async session(token) {
      if (!token) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required')
      const state = await store.getState()
      const security = state.accountSecurity.find((item) => (item.activeSessions || []).some((session) => session.tokenHash && tokenMatches(token, session.tokenHash)))
      const session = security?.activeSessions?.find((item) => item.tokenHash && tokenMatches(token, item.tokenHash))
      if (!security || !session) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required')
      const timestamp = new Date().toISOString()
      if (new Date(session.expiresAt) <= new Date(timestamp)) {
        await store.mutate((db) => {
          const currentSecurity = db.accountSecurity.find((item) => item.userId === security.userId)
          if (currentSecurity) currentSecurity.activeSessions = (currentSecurity.activeSessions || []).filter((item) => item.id !== session.id)
        })
        throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired')
      }
      return store.mutate((db) => {
        const currentSecurity = db.accountSecurity.find((item) => item.userId === security.userId)
        const currentSession = currentSecurity?.activeSessions?.find((item) => item.id === session.id)
        const account = db.accounts.find((item) => item.userId === security.userId)
        if (!currentSecurity || !currentSession || !account) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required')
        currentSession.lastUsedAt = timestamp
        currentSecurity.updatedAt = timestamp
        return { user: publicUser(account), session: publicSession(currentSession) }
      })
    },
    async logout(token) {
      if (!token) return { authenticated: false }
      return store.mutate((db) => {
        const security = db.accountSecurity.find((item) => (item.activeSessions || []).some((session) => session.tokenHash && tokenMatches(token, session.tokenHash)))
        if (!security) return { authenticated: false }
        const session = security.activeSessions.find((item) => item.tokenHash && tokenMatches(token, item.tokenHash))
        security.activeSessions = security.activeSessions.filter((item) => item.id !== session.id)
        security.updatedAt = new Date().toISOString()
        return { authenticated: false }
      })
    },
  }

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
    async filters(id) {
      const category = await this.detail(id)
      const furnitureSubcategories = ['Bathroom Accessories', 'Tubs & Sinks', 'Beds & Headboards', 'Chest of Drawers', 'Tabourets & Pouffes', 'Sofas & Couches', 'Coffee tables', 'Dividers']
      return { category: { id: category.id, name: category.name }, styles: ['Modern','Traditional','Minimalist','Rustic','Industrial','Bohemian','Scandinavian','Coastal'], moods: ['Calm','Energetic','Cozy','Elegant','Playful','Romantic','Formal'], rooms: ['Living room','Dining room','Bedroom','Bathroom','Office','Outdoor'], colors: ['white','cream','yellow','beige','gray','silver','black','tan','orange','brown','dark-brown','red','gold','olive','green','pink','blue','royal-blue','lime','bright-yellow','purple','magenta'], subcategories: category.id === 'furniture' ? furnitureSubcategories : category.children, price: { minimum: 0, maximum: 10000000, currency: 'IDR' }, sorting: [{ id: 'featured', name: 'Featured' },{ id: 'popular', name: 'Most Popular' },{ id: 'best-selling', name: 'Best Selling' },{ id: 'rating', name: 'Highest Rated' },{ id: 'newest', name: 'Newest' },{ id: 'price_asc', name: 'Price: Low to High' },{ id: 'price_desc', name: 'Price: High to Low' },{ id: 'alphabetical', name: 'Alphabetical' }] }
    },
    async browseProducts(id, query) {
      const category = await this.detail(id); const available = await this.filters(id); const q = normalizeSearch(query.get('q') || query.get('search')); const rawSearch = query.get('q') ?? query.get('search'); const subcategory = text(query.get('subcategory'), 'subcategory', { max: 100, required: false }); const room = text(query.get('room'), 'room', { max: 80, required: false }); const sort = query.get('sort') || 'featured'; const premium = query.get('premium'); const minPrice = query.get('minPrice') === null ? null : Number(query.get('minPrice')); const maxPrice = query.get('maxPrice') === null ? null : Number(query.get('maxPrice')); const rawPage = query.get('page'); const rawLimit = query.get('limit')
      const selections = Object.fromEntries(['style','mood','color'].map((field) => [field, [...new Set(query.getAll(field).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))]]))
      if (rawSearch !== null && !q) throw new ApiError(400, 'SEARCH_QUERY_REQUIRED', 'search must contain at least one non-whitespace character')
      if (q.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'search must contain at most 160 characters')
      if (!available.sorting.some((item) => item.id === sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (premium !== null && !['true','false'].includes(premium)) throw new ApiError(400, 'VALIDATION_ERROR', 'premium must be true or false')
      if (subcategory && !available.subcategories.some((item) => item.toLowerCase() === subcategory.toLowerCase())) throw new ApiError(400, 'VALIDATION_ERROR', 'subcategory is not supported')
      if (room && !available.rooms.some((item) => item.toLowerCase() === room.toLowerCase())) throw new ApiError(400, 'VALIDATION_ERROR', 'room is not supported')
      for (const [field, values, allowed] of [['style',selections.style,available.styles],['mood',selections.mood,available.moods],['color',selections.color,available.colors]]) if (values.some((value) => !allowed.some((item) => item.toLowerCase() === value.toLowerCase()))) throw new ApiError(400, 'VALIDATION_ERROR', `${field} contains an unsupported value`)
      if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) throw new ApiError(400, 'VALIDATION_ERROR', 'price range is invalid')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
      const attributeSets = [
        { subcategory: 'Coffee tables', styles: ['Traditional','Scandinavian'], moods: ['Calm','Formal'], room: 'Living room', colors: ['brown','beige'] },
        { subcategory: 'Coffee tables', styles: ['Modern','Minimalist'], moods: ['Calm','Elegant'], room: 'Living room', colors: ['gray','white'] },
        { subcategory: 'Sofas & Couches', styles: ['Industrial','Modern'], moods: ['Energetic','Playful'], room: 'Living room', colors: ['brown','black'] },
        { subcategory: category.children[0] || 'Decor', styles: ['Bohemian','Coastal'], moods: ['Cozy','Romantic'], room: 'Dining room', colors: ['blue','cream'] },
        { subcategory: category.children[0] || 'Lighting', styles: ['Modern','Scandinavian'], moods: ['Warm','Formal'], room: 'Bedroom', colors: ['yellow','beige'] },
      ]
      const [products, brands] = await Promise.all([store.read('products'), store.read('brands')]); const tokens = q.split(' ').filter(Boolean)
      let rows = products.filter((item) => item.active && item.categoryId === category.id).map((product, index) => { const attributes = { ...attributeSets[index % attributeSets.length], ...(product.catalogAttributes || {}) }; const supplier = brands.find((brand) => brand.productIds.includes(product.id)); return { ...product, ...attributes, premium: product.premium ?? product.featured, availability: product.active && (product.stock ?? 100) > 0, supplier: supplier ? { id: supplier.id, name: supplier.name, country: supplier.country, verified: supplier.verified } : null, reviewCount: product.reviewCount || Math.max(1, Math.round(product.soldCount / 1000)), addedAt: product.createdAt } })
      rows = rows.filter((product) => (!tokens.length || tokens.every((token) => normalizeSearch(`${product.title} ${product.description || ''} ${product.subcategory} ${product.styles.join(' ')} ${product.supplier?.name || ''}`).includes(token))) && (!subcategory || product.subcategory.toLowerCase() === subcategory.toLowerCase()) && (!room || product.room.toLowerCase() === room.toLowerCase()) && (premium === null || product.premium === (premium === 'true')) && (minPrice === null || product.price >= minPrice) && (maxPrice === null || product.price <= maxPrice) && (!selections.style.length || selections.style.some((value) => product.styles.some((item) => item.toLowerCase() === value.toLowerCase()))) && (!selections.mood.length || selections.mood.some((value) => product.moods.some((item) => item.toLowerCase() === value.toLowerCase()))) && (!selections.color.length || selections.color.some((value) => product.colors.some((item) => item.toLowerCase() === value.toLowerCase()))))
      const sorters = { featured: (a,b) => Number(b.featured)-Number(a.featured), popular: (a,b) => b.reviewCount-a.reviewCount || b.rating-a.rating, 'best-selling': (a,b) => b.soldCount-a.soldCount, rating: (a,b) => b.rating-a.rating, newest: newestFirst, price_asc: (a,b) => a.price-b.price, price_desc: (a,b) => b.price-a.price, alphabetical: (a,b) => a.title.localeCompare(b.title) }; rows.sort(sorters[sort]); const result = paginate(rows, query); return { category, products: result.data, data: result.data, meta: result.meta, availableFilters: available, selectedFilters: { search: q, subcategory: subcategory || null, styles: selections.style, moods: selections.mood, room: room || null, colors: selections.color, minPrice, maxPrice, premium: premium === null ? null : premium === 'true' }, sorting: { selected: sort, options: available.sorting } }
    },
    async create(body, user) {
      if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in with a supplier account to create a category')
      const supplier = (await store.read('sellerProfiles')).find((item) => item.userId === user.id && item.verificationStatus === 'approved')
      if (!supplier) throw new ApiError(403, 'SUPPLIER_REQUIRED', 'An approved supplier account is required to create a category')
      const name = text(body.name, 'name', { max: 80 })
      const slug = text(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'slug', { max: 100 })
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new ApiError(400, 'VALIDATION_ERROR', 'slug must contain lowercase letters, numbers, and single hyphens')
      const description = text(body.description, 'description', { max: 500, required: false }) || null
      const parentCategoryId = text(body.parentCategoryId, 'parentCategoryId', { max: 120, required: false }) || null
      return store.mutate((db) => {
        if (db.categories.some((item) => item.slug === slug || item.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'CATEGORY_EXISTS', 'A category with this name or slug already exists')
        if (parentCategoryId && !db.categories.some((item) => item.id === parentCategoryId && item.active)) throw new ApiError(404, 'PARENT_CATEGORY_NOT_FOUND', 'Parent category not found')
        const timestamp = new Date().toISOString()
        const category = { id: slug, name, slug, description, parentCategoryId, supplierId: supplier.id, children: [], position: db.categories.length + 1, active: true, createdAt: timestamp, updatedAt: timestamp }
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

  const products = {
    async detail(id) {
      const [items, categoryRows, brandRows, profiles, aboutPage] = await Promise.all([store.read('products'), store.read('categories'), store.read('brands'), store.read('sellerProfiles'), store.read('aboutPage')])
      const product = items.find((item) => item.id === id && item.active)
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
      const detailed = { ...product, description: product.description || 'A distinctive Indonesian-made piece created for considered commercial and residential spaces.', images: product.images?.length ? product.images : [product.image, '/assets/product-1.jpeg', '/assets/product-2.jpeg', '/assets/product-3.jpeg'], minimumOrder: product.minimumOrder || 10, shipping: product.shipping?.length ? product.shipping : ['Air Freight', 'Sea Freight'], customization: product.customization ?? true, warranty: product.warranty ?? false, material: product.material || 'Wood · FNP · Rustic', dimensions: product.dimensions || '215 cm × 90 cm × 165 cm', weight: product.weight || '54 Kgs', impactTags: product.impactTags?.length ? product.impactTags : ['Heritage Craft', 'Eco Materials', 'Sustainable Design', 'Innovation', 'Woman Led'] }
      const category = categoryRows.find((item) => item.id === product.categoryId)
      const brand = brandRows.find((item) => item.productIds?.includes(product.id))
      const profile = profiles.find((item) => item.id === product.supplierId || item.userId === product.supplierId) || profiles.find((item) => item.verificationStatus === 'approved')
      const seller = brand ? { id: brand.id, name: brand.name, location: brand.country, description: brand.description, verified: brand.verified } : profile ? { id: profile.id, name: profile.displayName, location: profile.businessAddress?.country || 'Indonesia', description: profile.description || 'Verified Indonesian maker supplying thoughtfully made products.', verified: profile.verificationStatus === 'approved' } : { id: 'buyamia-maker', name: 'Buyamia Maker', location: 'Indonesia', description: 'Verified Indonesian maker supplying thoughtfully made products.', verified: true }
      const related = items.filter((item) => item.active && item.id !== product.id && item.categoryId === product.categoryId)
      const recommendations = [...related, ...items.filter((item) => item.active && item.id !== product.id && item.categoryId !== product.categoryId)].slice(0, 4)
      return { ...detailed, category: category || null, seller, relatedProducts: recommendations, collectionProducts: recommendations.slice(0, 2), bundles: [...items.filter((item) => item.active && item.id !== product.id)].slice(0, 4), confidence: aboutPage.confidence.cards, information: { general: 'Discover exceptional products on Buyamia, the leading B2B marketplace for sourcing unique and high-quality goods from Indonesia. Every product is carefully presented to support transparent, confident purchasing decisions.', product: detailed.description, shipping: `Available shipping options: ${detailed.shipping.join(' and ')}. Final delivery pricing and timing are confirmed with your quote.` } }
    },
    async requestQuote(id, body, user) {
      const product = (await store.read('products')).find((item) => item.id === id && item.active)
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
      const quantity = Number(body.quantity)
      const minimumOrder = product.minimumOrder || 10
      if (!Number.isInteger(quantity) || quantity < minimumOrder) throw new ApiError(400, 'INVALID_QUANTITY', `quantity must be an integer of at least ${minimumOrder}`)
      const note = text(body.note, 'note', { max: 1000, required: false }) || null
      return store.mutate((db) => {
        const quote = { id: store.id('product-quote'), productId: product.id, userId: user?.authenticated ? user.id : null, quantity, note, status: 'requested', createdAt: new Date().toISOString() }
        db.productQuotes.push(quote)
        return quote
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
    async marketplaces() { const [definitions, listings] = await Promise.all([store.read('marketplaces'), store.read('marketplaceListings')]); return definitions.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, title: item.title, description: item.description, category: item.categories?.[0]?.id || item.id, image: item.image || item.categories?.[0]?.image || listings.find((listing) => listing.marketplaceId === item.id)?.images?.[0] || null, route: `/marketplaces/${item.id}`, status: 'available', supplierId: item.supplierId || null, categoryCount: item.categories?.length || 0, listingCount: listings.filter((listing) => listing.marketplaceId === item.id && listing.available).length })) },
    async createMarketplace(body, user) {
      if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in with a supplier account to create a marketplace')
      const profile = (await store.read('sellerProfiles')).find((item) => item.userId === user.id && item.verificationStatus === 'approved')
      if (!profile) throw new ApiError(403, 'SUPPLIER_REQUIRED', 'An approved supplier account is required to create a marketplace')
      const name = text(body.name, 'name', { min: 3, max: 100 })
      const description = text(body.description, 'description', { min: 10, max: 1000 })
      const categoryId = text(body.categoryId, 'categoryId', { max: 120 })
      const image = text(body.image, 'image', { max: 1000, required: false }) || null
      const category = (await store.read('categories')).find((item) => item.id === categoryId && item.active)
      if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Marketplace category not found')
      const id = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (!id) throw new ApiError(400, 'VALIDATION_ERROR', 'Marketplace name must contain letters or numbers')
      return store.mutate((db) => {
        if (db.marketplaces.some((item) => item.id === id || item.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'MARKETPLACE_ALREADY_EXISTS', 'A marketplace with this name already exists')
        const timestamp = new Date().toISOString()
        const marketplace = { id, name, title: name, eyebrow: 'Supplier marketplace', description, heroPrompt: `Ask Amia about ${name}`, suggestions: [], categories: [{ id: category.id, name: category.name, image: image || '/assets/category-bg.png' }], image: image || '/assets/category-bg.png', supplierId: profile.id, ownerUserId: user.id, active: true, status: 'active', createdAt: timestamp, updatedAt: timestamp }
        db.marketplaces.push(marketplace)
        return { ...marketplace, route: `/marketplaces/${id}` }
      })
    },
    async marketplaceOverview(id = 'vehicles') {
      const definition = (await store.read('marketplaces')).find((item) => item.id === id && item.active)
      if (!definition) throw new ApiError(404, 'MARKETPLACE_NOT_FOUND', 'Marketplace not found')
      if (id !== 'vehicles') {
        const categoryIds = new Set((definition.categories || []).map((item) => item.id))
        const products = (await store.read('products')).filter((item) => item.active && categoryIds.has(item.categoryId))
        const supplier = (await store.read('sellerProfiles')).find((item) => item.id === definition.supplierId)
        return { ...definition, products, featured: products.filter((item) => item.featured).slice(0, 8), trending: [...products].sort((a, b) => b.soldCount - a.soldCount).slice(0, 8), recommendations: products.slice(0, 4), sellers: supplier ? [{ id: supplier.id, name: supplier.displayName, location: supplier.location, verified: true }] : [] }
      }
      const emptyQuery = new URLSearchParams('limit=8'); const featured = await this.marketplaceProducts(new URLSearchParams(`marketplace=${encodeURIComponent(id)}&featured=true&limit=8`)); const trending = await this.marketplaceProducts(new URLSearchParams(`marketplace=${encodeURIComponent(id)}&sort=popular&limit=8`)); return { ...definition, featured: featured.data, trending: trending.data, sellers: await this.marketplaceSellers(id), recommendations: (await this.marketplaceProducts(emptyQuery)).data.slice(0, 4) }
    },
    async marketplaceProducts(query) {
      const marketplaceId = query.get('marketplace') || 'vehicles'; const q = text(query.get('q') || query.get('search'), 'search', { max: 160, required: false })?.toLowerCase(); const category = query.get('category') || query.get('type'); const sellerId = query.get('seller'); const country = text(query.get('country'), 'country', { max: 100, required: false }); const sort = query.get('sort') || 'featured'; const featured = query.get('featured'); const minPrice = query.get('minPrice') === null ? null : Number(query.get('minPrice')); const maxPrice = query.get('maxPrice') === null ? null : Number(query.get('maxPrice')); const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (!(await store.read('marketplaces')).some((item) => item.id === marketplaceId && item.active)) throw new ApiError(404, 'MARKETPLACE_NOT_FOUND', 'Marketplace not found'); if (category && !['cars','bikes'].includes(category)) throw new ApiError(400, 'VALIDATION_ERROR', 'category is not supported'); if (sellerId && !(await store.read('marketplaceDealers')).some((item) => item.id === sellerId && item.marketplaceId === marketplaceId)) throw new ApiError(404, 'SELLER_NOT_FOUND', 'Marketplace seller not found'); if (featured !== null && !['true','false'].includes(featured)) throw new ApiError(400, 'VALIDATION_ERROR', 'featured must be true or false'); if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) throw new ApiError(400, 'VALIDATION_ERROR', 'price range is invalid'); if (!['featured','popular','newest','price-asc','price-desc','mileage'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported'); if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100')
      const dealers = await store.read('marketplaceDealers'); const dealerById = new Map(dealers.map((item) => [item.id,item])); let rows = (await store.read('marketplaceListings')).filter((item) => item.marketplaceId === marketplaceId && item.available && (!q || `${item.title} ${item.description} ${item.engineType} ${dealerById.get(item.sellerId)?.name || ''}`.toLowerCase().includes(q)) && (!category || item.type === category) && (!sellerId || item.sellerId === sellerId) && (!country || dealerById.get(item.sellerId)?.country.toLowerCase() === country.toLowerCase()) && (featured === null || item.featured === (featured === 'true')) && (minPrice === null || item.price >= minPrice) && (maxPrice === null || item.price <= maxPrice)).map((item) => ({ ...item, seller: dealerById.get(item.sellerId) || null })); const sorters = { featured: (a,b) => Number(b.featured)-Number(a.featured) || b.popularity-a.popularity, popular: (a,b) => b.popularity-a.popularity, newest: newestFirst, 'price-asc': (a,b) => a.price-b.price, 'price-desc': (a,b) => b.price-a.price, mileage: (a,b) => a.mileage-b.mileage }; rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async marketplaceProduct(id) { const product = (await store.read('marketplaceListings')).find((item) => item.id === id); if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Marketplace product not found'); const seller = (await store.read('marketplaceDealers')).find((item) => item.id === product.sellerId); return { ...product, seller: seller || null } },
    async marketplaceSellers(id = 'vehicles') { const listings = await store.read('marketplaceListings'); return (await store.read('marketplaceDealers')).filter((item) => item.marketplaceId === id && item.approved).map((item) => ({ ...item, products: item.listingIds.map((listingId) => listings.find((listing) => listing.id === listingId && listing.available)).filter(Boolean) })) },
  }

  function buyingPoolStatus(pool, participantCount) {
    if (pool.status === 'draft') return 'draft'
    if (pool.status === 'cancelled') return 'cancelled'
    const now = Date.now(); const start = new Date(pool.startTime).getTime(); const end = new Date(pool.endTime).getTime()
    if (now < start) return 'upcoming'
    if (now >= end) return 'expired'
    if (participantCount >= pool.targetBusinesses) return 'full'
    if (participantCount >= Math.ceil(pool.targetBusinesses * 0.75)) return 'almost-full'
    return 'open'
  }

  async function buyingPoolRows(user) {
    const [pools, participants, products, profiles] = await Promise.all(['buyingPools', 'buyingPoolParticipants', 'products', 'sellerProfiles'].map((name) => store.read(name)))
    return pools.map((pool) => {
      const joins = participants.filter((item) => item.poolId === pool.id); const participantCount = pool.baseParticipants + joins.length; const product = products.find((item) => item.id === pool.productId); const supplier = profiles.find((item) => item.id === pool.supplierId)
      return { ...pool, status: buyingPoolStatus(pool, participantCount), participantCount, remainingPlaces: Math.max(0, pool.targetBusinesses - participantCount), progressPercent: Math.min(100, Math.round(participantCount / pool.targetBusinesses * 100)), joined: Boolean(user?.authenticated && joins.some((item) => item.userId === user.id)), product: product ? { id: product.id, title: product.title, image: product.image, originalPrice: product.price, currency: product.currency, rating: product.rating } : null, supplier: supplier ? { id: supplier.id, name: supplier.displayName, verified: supplier.verificationStatus === 'approved' } : null }
    })
  }

  const buyingPools = {
    async list(query, user) {
      const q = text(query.get('q') || query.get('search'), 'search', { max: 160, required: false })?.toLowerCase(); const industry = query.get('industry'); const status = query.get('status') || 'current'; const sort = query.get('sort') || 'filling-fast'
      const industries = ['restaurants-cafes', 'bars-nightlife', 'hotels-hospitality', 'gyms-fitness', 'clinics-healthcare', 'salons-spas', 'retail-boutiques']
      if (industry && !industries.includes(industry)) throw new ApiError(400, 'VALIDATION_ERROR', 'industry is not supported')
      if (!['current', 'all', 'open', 'almost-full', 'full', 'upcoming', 'expired'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported')
      if (!['filling-fast', 'ending-soon', 'newest', 'title'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      let rows = (await buyingPoolRows(user)).filter((pool) => pool.status !== 'draft' && (status === 'all' || (status === 'current' ? ['open', 'almost-full'].includes(pool.status) : pool.status === status)) && (!industry || pool.industry === industry) && (!q || `${pool.title} ${pool.description} ${pool.location} ${pool.product?.title || pool.productName || ''}`.toLowerCase().includes(q)))
      const sorters = { 'filling-fast': (a, b) => b.progressPercent - a.progressPercent, 'ending-soon': (a, b) => new Date(a.endTime) - new Date(b.endTime), newest: newestFirst, title: (a, b) => a.title.localeCompare(b.title) }; rows.sort(sorters[sort])
      return paginate(rows, query)
    },
    async get(id, user) { const pool = (await buyingPoolRows(user)).find((item) => item.id === id && (item.status !== 'draft' || (user?.authenticated && item.createdBy === user.id))); if (!pool) throw new ApiError(404, 'BUYING_POOL_NOT_FOUND', 'Buying Pool not found'); return pool },
    async industries() { return [{ id: 'restaurants-cafes', name: 'Restaurants & Cafés' }, { id: 'bars-nightlife', name: 'Bars & Nightlife' }, { id: 'hotels-hospitality', name: 'Hotels & Hospitality' }, { id: 'gyms-fitness', name: 'Gyms & Fitness Studios' }, { id: 'clinics-healthcare', name: 'Clinics & Healthcare' }, { id: 'salons-spas', name: 'Salons & Spas' }, { id: 'retail-boutiques', name: 'Retail & Boutiques' }] },
    async join(id, user) {
      if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to join a Buying Pool')
      return store.mutate((db) => { const pool = db.buyingPools.find((item) => item.id === id); if (!pool) throw new ApiError(404, 'BUYING_POOL_NOT_FOUND', 'Buying Pool not found'); const count = pool.baseParticipants + db.buyingPoolParticipants.filter((item) => item.poolId === id).length; const status = buyingPoolStatus(pool, count); if (!['open', 'almost-full'].includes(status)) throw new ApiError(409, 'BUYING_POOL_CLOSED', 'This Buying Pool is no longer accepting participants'); if (db.buyingPoolParticipants.some((item) => item.poolId === id && item.userId === user.id)) throw new ApiError(409, 'ALREADY_JOINED', 'You have already joined this Buying Pool'); const participation = { id: store.id('pool-participant'), poolId: id, userId: user.id, joinedAt: new Date().toISOString() }; db.buyingPoolParticipants.push(participation); return participation })
    },
    async create(body, user) {
      if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to start a Buying Pool')
      const productName = text(body.productName, 'productName', { min: 2, max: 120 }); const preferredSupplier = text(body.preferredSupplier, 'preferredSupplier', { max: 120, required: false }) || null; const frequency = text(body.frequency, 'frequency', { max: 30 }); const location = text(body.location, 'location', { min: 2, max: 160 }); const matchingRadius = text(body.matchingRadius, 'matchingRadius', { max: 40 }); const industryMatching = text(body.industryMatching, 'industryMatching', { max: 60 }); const monitoring = text(body.monitoring, 'monitoring', { max: 220, required: false }) || null
      const orderQuantity = Number(body.orderQuantity); const minimumBusinesses = Number(body.minimumBusinesses); const maximumBusinesses = body.maximumBusinesses === null || body.maximumBusinesses === '' || body.maximumBusinesses === undefined ? null : Number(body.maximumBusinesses); const targetVolume = Number(body.targetVolume); const poolWindowDays = Number(body.poolWindowDays)
      if (![orderQuantity, minimumBusinesses, targetVolume, poolWindowDays].every(Number.isSafeInteger) || orderQuantity < 1 || minimumBusinesses < 2 || targetVolume < 1 || ![7, 14, 30].includes(poolWindowDays)) throw new ApiError(400, 'VALIDATION_ERROR', 'Quantities, minimum businesses, target volume, and pool window are invalid')
      if (maximumBusinesses !== null && (!Number.isSafeInteger(maximumBusinesses) || maximumBusinesses < minimumBusinesses)) throw new ApiError(400, 'VALIDATION_ERROR', 'maximumBusinesses must be at least the minimum number of businesses')
      if (!['weekly', 'monthly', 'quarterly'].includes(frequency)) throw new ApiError(400, 'VALIDATION_ERROR', 'frequency is not supported')
      if (!['neighborhood', 'city', 'unlimited'].includes(matchingRadius)) throw new ApiError(400, 'VALIDATION_ERROR', 'matchingRadius is not supported')
      if (!['same-industry', 'compatible'].includes(industryMatching)) throw new ApiError(400, 'VALIDATION_ERROR', 'industryMatching is not supported')
      if (body.publish !== undefined && typeof body.publish !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'publish must be a boolean')
      const timestamp = new Date().toISOString(); const endTime = new Date(Date.now() + poolWindowDays * 86400000).toISOString(); const status = body.publish === true ? 'open' : 'draft'
      return store.mutate((db) => { const pool = { id: store.id('pool'), title: `${productName} Buying Pool`, description: `${frequency[0].toUpperCase()}${frequency.slice(1)} collective order for ${productName}.`, productName, preferredSupplier, industry: 'custom', location, productId: null, supplierId: null, targetBusinesses: maximumBusinesses || minimumBusinesses, minimumBusinesses, maximumBusinesses, baseParticipants: 1, groupPrice: null, minimumQuantity: orderQuantity, orderQuantity, targetVolume, frequency, matchingRadius, industryMatching, poolWindowDays, monitoring, status, createdBy: user.id, startTime: timestamp, endTime, image: '/assets/carved-bg.png', createdAt: timestamp, updatedAt: timestamp, publishedAt: status === 'open' ? timestamp : null }; db.buyingPools.push(pool); return pool })
    },
    async mine(user) { if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to view your Buying Pools'); return (await buyingPoolRows(user)).filter((item) => item.createdBy === user.id).sort(newestFirst) },
  }

  function flashSaleStatus(sale) {
    if (sale.publicationStatus === 'draft') return 'draft'
    if (sale.publicationStatus === 'cancelled') return 'cancelled'
    const now = Date.now()
    if (now < new Date(sale.startTime).getTime()) return 'upcoming'
    if (now >= new Date(sale.endTime).getTime()) return 'expired'
    return 'active'
  }

  async function flashSaleRows() {
    const [sales, products, categories, brands] = await Promise.all(['flashSales', 'products', 'categories', 'brands'].map((name) => store.read(name)))
    const productById = new Map(products.map((item) => [item.id, item]))
    const categoryById = new Map(categories.map((item) => [item.id, item]))
    return sales.map((sale) => {
      const status = flashSaleStatus(sale)
      const saleProducts = sale.products.map((entry) => {
        const product = productById.get(entry.productId)
        if (!product) return null
        const seller = brands.find((brand) => brand.productIds.includes(product.id)) || null
        return { ...product, description: product.description || `${product.title}, selected for a limited-time Buyamia event.`, originalPrice: product.price, salePrice: entry.salePrice, discountPercent: Math.round((1 - entry.salePrice / product.price) * 100), remainingStock: entry.remainingStock, availability: status !== 'expired' && entry.remainingStock > 0, seller: seller ? { id: seller.id, name: seller.name, verified: seller.verified } : null, category: categoryById.get(product.categoryId) || null, reviewCount: product.reviewCount || Math.max(1, Math.round(product.soldCount / 1000)), verificationBadge: seller?.verified ? 'Verified seller' : null }
      }).filter(Boolean)
      const end = new Date(sale.endTime).getTime(); const start = new Date(sale.startTime).getTime()
      const managementStatus = status === 'upcoming' ? 'scheduled' : status === 'expired' ? 'ended' : status
      return { ...sale, status, managementStatus, remainingMs: status === 'active' ? Math.max(0, end - Date.now()) : 0, startsInMs: status === 'upcoming' ? Math.max(0, start - Date.now()) : 0, products: saleProducts, productCount: saleProducts.length, categories: [...new Set(saleProducts.map((item) => item.categoryId))] }
    })
  }

  async function flashSaleSupplier(user) {
    if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in with a supplier account to manage flash sales')
    const profiles = await store.read('sellerProfiles')
    const profile = profiles.find((item) => item.userId === user.id && item.verificationStatus === 'approved')
    if (!profile) throw new ApiError(403, 'SUPPLIER_REQUIRED', 'An approved supplier account is required to manage flash sales')
    const brand = (await store.read('brands')).find((item) => item.id === profile.brandId)
    if (!brand) throw new ApiError(403, 'SUPPLIER_CATALOG_REQUIRED', 'The supplier does not have an available product catalog')
    return { profile, brand }
  }

  async function flashSaleValues(body, user, existing = null) {
    const { profile, brand } = await flashSaleSupplier(user)
    const productId = text(body.productId ?? existing?.products?.[0]?.productId, 'productId', { max: 120 })
    const product = (await store.read('products')).find((item) => item.id === productId && item.active)
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'The selected product was not found')
    if (!brand.productIds.includes(productId)) throw new ApiError(403, 'PRODUCT_NOT_OWNED', 'The selected product is not part of this supplier catalog')
    const title = text(body.title ?? existing?.title, 'title', { min: 3, max: 120 })
    const description = text(body.description ?? existing?.description, 'description', { min: 10, max: 1000 })
    const salePrice = Number(body.salePrice ?? existing?.products?.[0]?.salePrice)
    const remainingStock = Number(body.remainingStock ?? existing?.products?.[0]?.remainingStock)
    if (!Number.isSafeInteger(salePrice) || salePrice < 1 || salePrice >= product.price) throw new ApiError(400, 'INVALID_SALE_PRICE', 'salePrice must be a positive whole number below the original product price')
    if (!Number.isSafeInteger(remainingStock) || remainingStock < 1 || remainingStock > (product.stock || 1000000)) throw new ApiError(400, 'INVALID_FLASH_SALE_STOCK', 'remainingStock must be a positive whole number within available stock')
    const startTime = new Date(body.startTime ?? existing?.startTime)
    const endTime = new Date(body.endTime ?? existing?.endTime)
    if (Number.isNaN(startTime.getTime())) throw new ApiError(400, 'INVALID_START_TIME', 'startTime must be a valid date and time')
    if (Number.isNaN(endTime.getTime()) || endTime <= startTime) throw new ApiError(400, 'INVALID_END_TIME', 'endTime must be a valid date after startTime')
    return { profile, title, description, startTime: startTime.toISOString(), endTime: endTime.toISOString(), products: [{ productId, salePrice, remainingStock }] }
  }

  const flashSales = {
    async list(query) {
      const q = text(query.get('q') || query.get('search'), 'search', { max: 160, required: false })?.toLowerCase()
      const status = query.get('status') || 'current'; const category = query.get('category'); const sort = query.get('sort') || 'ending-soon'; const featured = query.get('featured'); const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (!['current', 'all', 'active', 'upcoming', 'expired'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported')
      if (!['ending-soon', 'starting-soon', 'newest', 'discount-high', 'title'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (featured !== null && !['true', 'false'].includes(featured)) throw new ApiError(400, 'VALIDATION_ERROR', 'featured must be true or false')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100')
      if (category && !(await store.read('categories')).some((item) => item.id === category && item.active)) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Flash sale category not found')
      let rows = (await flashSaleRows()).filter((sale) => !['draft', 'cancelled'].includes(sale.status) && (status === 'all' || (status === 'current' ? sale.status !== 'expired' : sale.status === status)) && (!category || sale.categories.includes(category)) && (featured === null || sale.featured === (featured === 'true')) && (!q || `${sale.title} ${sale.description} ${sale.products.map((item) => item.title).join(' ')}`.toLowerCase().includes(q)))
      const maxDiscount = (sale) => Math.max(0, ...sale.products.map((item) => item.discountPercent)); const sorters = { 'ending-soon': (a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || new Date(a.endTime) - new Date(b.endTime), 'starting-soon': (a, b) => new Date(a.startTime) - new Date(b.startTime), newest: newestFirst, 'discount-high': (a, b) => maxDiscount(b) - maxDiscount(a), title: (a, b) => a.title.localeCompare(b.title) }
      rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async get(id) { const sale = (await flashSaleRows()).find((item) => item.id === id && !['draft', 'cancelled'].includes(item.status)); if (!sale) throw new ApiError(404, 'FLASH_SALE_NOT_FOUND', 'Flash sale not found'); return sale },
    async categories() { const [categories, sales] = await Promise.all([store.read('categories'), flashSaleRows()]); const ids = new Set(sales.filter((sale) => !['expired', 'draft', 'cancelled'].includes(sale.status)).flatMap((sale) => sale.categories)); return categories.filter((item) => item.active && ids.has(item.id)).map(({ id, name, slug }) => ({ id, name, slug })) },
    async mine(user) {
      const { profile, brand } = await flashSaleSupplier(user)
      const sales = (await flashSaleRows()).filter((item) => item.supplierId === profile.id).sort(newestFirst)
      const products = (await store.read('products')).filter((item) => brand.productIds.includes(item.id) && item.active).map(({ id, title, price, currency, image, stock, categoryId }) => ({ id, title, price, currency, image, stock, categoryId }))
      return { sales, products, supplier: { id: profile.id, name: profile.displayName } }
    },
    async create(body, user) {
      if (body.status !== undefined && !['draft', 'published'].includes(body.status)) throw new ApiError(400, 'INVALID_FLASH_SALE_STATUS', 'status must be draft or published')
      if (body.publish !== undefined && typeof body.publish !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'publish must be a boolean')
      const values = await flashSaleValues(body, user)
      const publicationStatus = body.publish === true || body.status === 'published' ? 'published' : 'draft'
      return store.mutate((db) => { const timestamp = new Date().toISOString(); const sale = { id: store.id('flash-sale'), supplierId: values.profile.id, userId: user.id, title: values.title, description: values.description, featured: false, publicationStatus, startTime: values.startTime, endTime: values.endTime, products: values.products, createdAt: timestamp, updatedAt: timestamp, publishedAt: publicationStatus === 'published' ? timestamp : null }; db.flashSales.push(sale); return sale })
    },
    async update(id, body, user) {
      const { profile } = await flashSaleSupplier(user); const current = (await store.read('flashSales')).find((item) => item.id === id && item.supplierId === profile.id)
      if (!current) throw new ApiError(404, 'FLASH_SALE_NOT_FOUND', 'Supplier flash sale not found')
      if (current.publicationStatus === 'cancelled' || flashSaleStatus(current) === 'expired') throw new ApiError(409, 'FLASH_SALE_NOT_EDITABLE', 'Cancelled or ended flash sales cannot be edited')
      const values = await flashSaleValues(body, user, current)
      return store.mutate((db) => { const sale = db.flashSales.find((item) => item.id === id); Object.assign(sale, { title: values.title, description: values.description, startTime: values.startTime, endTime: values.endTime, products: values.products, updatedAt: new Date().toISOString() }); return sale })
    },
    async publish(id, user) {
      const { profile } = await flashSaleSupplier(user)
      return store.mutate((db) => { const sale = db.flashSales.find((item) => item.id === id && item.supplierId === profile.id); if (!sale) throw new ApiError(404, 'FLASH_SALE_NOT_FOUND', 'Supplier flash sale not found'); if (sale.publicationStatus !== 'draft') throw new ApiError(409, 'FLASH_SALE_NOT_DRAFT', 'Only draft flash sales can be published'); if (new Date(sale.endTime) <= new Date()) throw new ApiError(409, 'FLASH_SALE_ENDED', 'An ended flash sale cannot be published'); sale.publicationStatus = 'published'; sale.publishedAt = new Date().toISOString(); sale.updatedAt = sale.publishedAt; return sale })
    },
    async cancel(id, user) {
      const { profile } = await flashSaleSupplier(user)
      return store.mutate((db) => { const sale = db.flashSales.find((item) => item.id === id && item.supplierId === profile.id); if (!sale) throw new ApiError(404, 'FLASH_SALE_NOT_FOUND', 'Supplier flash sale not found'); if (['cancelled', 'expired'].includes(flashSaleStatus(sale))) throw new ApiError(409, 'FLASH_SALE_NOT_CANCELLABLE', 'This flash sale can no longer be cancelled'); sale.publicationStatus = 'cancelled'; sale.updatedAt = new Date().toISOString(); return sale })
    },
  }

  async function fastSellingRows() {
    const [products, categories, brands] = await Promise.all(['products', 'categories', 'brands'].map((name) => store.read(name)))
    const categoryById = new Map(categories.map((item) => [item.id, item]))
    return products.filter((product) => product.active && product.soldCount > 0).map((product) => {
      const seller = brands.find((brand) => brand.productIds.includes(product.id)) || null
      const stock = product.stock ?? Math.max(1, Math.round(product.soldCount / 1000))
      const currentPrice = product.discountPercent ? Math.round(product.price * (1 - product.discountPercent / 100)) : product.price
      return { ...product, description: product.description || `${product.title}, a popular choice from Buyamia's verified Indonesian marketplace.`, images: product.images || [product.image], originalPrice: product.discountPercent ? product.price : null, currentPrice, stock, availability: stock > 0, stockStatus: stock > 10 ? 'in-stock' : stock > 0 ? 'low-stock' : 'out-of-stock', seller: seller ? { id: seller.id, name: seller.name, country: seller.country, verified: seller.verified } : null, category: categoryById.get(product.categoryId) || null, reviewCount: product.reviewCount || Math.max(1, Math.round(product.soldCount / 1000)), verificationBadge: seller?.verified ? 'Verified seller' : null }
    })
  }

  const fastSelling = {
    async list(query) {
      const q = text(query.get('q') || query.get('search'), 'search', { max: 160, required: false })?.toLowerCase(); const category = query.get('category'); const seller = query.get('seller'); const sort = query.get('sort') || 'sales-volume'; const featured = query.get('featured'); const minPrice = query.get('minPrice') === null ? null : Number(query.get('minPrice')); const maxPrice = query.get('maxPrice') === null ? null : Number(query.get('maxPrice')); const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (!['popularity', 'sales-volume', 'newest', 'price-asc', 'price-desc'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (featured !== null && !['true', 'false'].includes(featured)) throw new ApiError(400, 'VALIDATION_ERROR', 'featured must be true or false')
      if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) throw new ApiError(400, 'VALIDATION_ERROR', 'price range is invalid')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100')
      if (category && !(await store.read('categories')).some((item) => item.id === category && item.active)) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Fast-selling category not found')
      if (seller && !(await store.read('brands')).some((item) => item.id === seller)) throw new ApiError(404, 'SELLER_NOT_FOUND', 'Fast-selling seller not found')
      let rows = (await fastSellingRows()).filter((product) => (!q || `${product.title} ${product.description} ${product.seller?.name || ''}`.toLowerCase().includes(q)) && (!category || product.categoryId === category) && (!seller || product.seller?.id === seller) && (featured === null || product.featured === (featured === 'true')) && (minPrice === null || product.currentPrice >= minPrice) && (maxPrice === null || product.currentPrice <= maxPrice))
      const sorters = { popularity: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount, 'sales-volume': (a, b) => b.soldCount - a.soldCount, newest: newestFirst, 'price-asc': (a, b) => a.currentPrice - b.currentPrice, 'price-desc': (a, b) => b.currentPrice - a.currentPrice }; rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async get(id) { const product = (await fastSellingRows()).find((item) => item.id === id); if (!product) throw new ApiError(404, 'FAST_SELLING_PRODUCT_NOT_FOUND', 'Fast-selling product not found'); return product },
    async categories() { const [categories, products] = await Promise.all([store.read('categories'), fastSellingRows()]); const ids = new Set(products.map((item) => item.categoryId)); return categories.filter((item) => item.active && ids.has(item.id)).map(({ id, name, slug }) => ({ id, name, slug })) },
    async sellers() { const rows = await fastSellingRows(); return [...new Map(rows.filter((item) => item.seller).map((item) => [item.seller.id, item.seller])).values()] },
  }

  async function sellerPromotionRows() {
    const [promotions, products, categories, profiles, brands] = await Promise.all(['sellerPromotions', 'products', 'categories', 'sellerProfiles', 'brands'].map((name) => store.read(name)))
    const productById = new Map(products.map((item) => [item.id, item])); const categoryById = new Map(categories.map((item) => [item.id, item]))
    return promotions.map((promotion, index) => {
      const product = productById.get(promotion.productId) || products.filter((item) => item.active)[index % products.filter((item) => item.active).length]
      const profile = profiles.find((item) => item.id === promotion.sellerId); const brand = brands.find((item) => item.name === promotion.sellerName || item.productIds.includes(product?.id)); const seller = profile ? { id: profile.id, name: profile.displayName, avatar: promotion.avatar, verified: profile.verificationStatus === 'approved', location: profile.location } : { id: promotion.sellerId, name: promotion.sellerName, avatar: promotion.avatar, verified: Boolean(brand?.verified), location: brand?.country || 'Indonesia' }
      const categoryId = promotion.categoryId || product?.categoryId; const discountPercent = promotion.discountPercent ?? product?.discountPercent ?? 0; const originalPrice = product?.price || 0; const discountedPrice = Math.round(originalPrice * (1 - discountPercent / 100)); const startTime = promotion.startTime || promotion.createdAt; const endTime = promotion.endTime || '2027-01-31T23:59:59.000Z'; const now = Date.now(); const status = !promotion.active || now >= new Date(endTime).getTime() ? 'expired' : now < new Date(startTime).getTime() ? 'upcoming' : 'active'
      return { ...promotion, title: promotion.title || `${seller.name} Limited Offer`, description: promotion.description || promotion.text, image: promotion.image || product?.image || promotion.avatar, categoryId, category: categoryById.get(categoryId) || { id: categoryId, name: promotion.category }, seller, product: product ? { id: product.id, title: product.title, image: product.image, currency: product.currency, rating: product.rating } : null, originalPrice, discountedPrice, discountPercent, startTime, endTime, status, availability: status !== 'expired' && Boolean(product?.active), featured: Boolean(promotion.featured), remainingMs: status === 'active' ? Math.max(0, new Date(endTime).getTime() - now) : 0, startsInMs: status === 'upcoming' ? Math.max(0, new Date(startTime).getTime() - now) : 0 }
    })
  }

  const sellerPromotions = {
    async list(query) {
      const q = text(query.get('q') || query.get('search'), 'search', { max: 160, required: false })?.toLowerCase(); const category = query.get('category'); const seller = query.get('seller'); const status = query.get('status') || 'active'; const featured = query.get('featured'); const sort = query.get('sort') || 'newest'; const rawPage = query.get('page'); const rawLimit = query.get('limit')
      if (!['all', 'active', 'upcoming', 'expired'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported')
      if (!['newest', 'ending-soon', 'discount-high', 'price-low', 'price-high', 'title'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported')
      if (featured !== null && !['true', 'false'].includes(featured)) throw new ApiError(400, 'VALIDATION_ERROR', 'featured must be true or false')
      if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer')
      if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100')
      const rows = await sellerPromotionRows()
      if (category && !(await store.read('categories')).some((item) => item.id === category && item.active)) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Promotion category not found')
      if (seller && !rows.some((item) => item.seller.id === seller)) throw new ApiError(404, 'SELLER_NOT_FOUND', 'Promotion seller not found')
      const filtered = rows.filter((item) => (status === 'all' || item.status === status) && (!category || item.categoryId === category) && (!seller || item.seller.id === seller) && (featured === null || item.featured === (featured === 'true')) && (!q || `${item.title} ${item.description} ${item.seller.name} ${item.category.name}`.toLowerCase().includes(q)))
      const sorters = { newest: newestFirst, 'ending-soon': (a, b) => new Date(a.endTime) - new Date(b.endTime), 'discount-high': (a, b) => b.discountPercent - a.discountPercent, 'price-low': (a, b) => a.discountedPrice - b.discountedPrice, 'price-high': (a, b) => b.discountedPrice - a.discountedPrice, title: (a, b) => a.title.localeCompare(b.title) }; filtered.sort(sorters[sort]); return paginate(filtered, query)
    },
    async get(id) { const promotion = (await sellerPromotionRows()).find((item) => item.id === id); if (!promotion) throw new ApiError(404, 'SELLER_PROMOTION_NOT_FOUND', 'Seller promotion not found'); return promotion },
    async categories() { const [categories, promotions] = await Promise.all([store.read('categories'), sellerPromotionRows()]); const ids = new Set(promotions.map((item) => item.categoryId)); return categories.filter((item) => item.active && ids.has(item.id)).map(({ id, name, slug }) => ({ id, name, slug })) },
    async sellers() { return [...new Map((await sellerPromotionRows()).map((item) => [item.seller.id, item.seller])).values()] },
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
      const [listings, products, categories] = await Promise.all([store.read('sourcingListings'), store.read('products'), store.read('categories')]); const categoryById = new Map(categories.map((item) => [item.id, item])); if (category && !categoryById.has(category)) throw new ApiError(400, 'VALIDATION_ERROR', 'category is not supported'); const tokens = q.split(' ').filter(Boolean); const rows = listings.map((listing) => ({ ...listing, product: products.find((product) => product.id === listing.productId && product.active), category: categoryById.get(listing.categoryId)?.name || listing.categoryId })).filter((listing) => listing.product && (!tokens.length || tokens.every((token) => normalizeSearch(`${listing.title} ${listing.description} ${listing.product.title} ${listing.category} ${listing.country}`).includes(token))) && (!category || listing.categoryId === category) && (!country || normalizeSearch(listing.country).includes(country)) && (!sourceType || listing.sourceType === sourceType)); const sorters = { newest: newestFirst, price_asc: (a, b) => a.product.price - b.product.price, price_desc: (a, b) => b.product.price - a.product.price }; rows.sort(sorters[sort]); return paginate(rows, query)
    },
    async detail(id) { const result = await this.list(new URLSearchParams({ limit: '100' })); const listing = result.data.find((item) => item.id === id); if (!listing) throw new ApiError(404, 'SOURCE_ITEM_NOT_FOUND', 'Sourced item not found'); const products = await store.read('products'); const relatedProducts = products.filter((item) => item.active && item.id !== listing.productId).sort((a, b) => Number(b.categoryId === listing.categoryId) - Number(a.categoryId === listing.categoryId)).slice(0, 4); return { ...listing, relatedProducts, bundles: products.filter((item) => item.active).slice(0, 4), information: { general: 'Every externally sourced item is reviewed for useful product information before it appears on Buyamia. Pricing and availability remain subject to confirmation with the external retailer.', product: listing.description, shipping: `Available shipping options: ${listing.shipping.join(' and ')}. Final freight pricing and delivery timing are confirmed before purchase.` }, confidence: [{ id: 'quality', title: 'Buyer’s Guarantee – Quality Control', summary: 'Quality is built into how we work.', description: 'Quality-control inspections can be tailored to the quantity, complexity, and location of your order.' }, { id: 'shipping', title: 'Ship with Buyamia and Save', summary: 'Access shipping support from an experienced sourcing team.', description: 'Shipping estimates and any clearance charges are confirmed for your destination before the order proceeds.' }] } },
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
      if (conversationId !== undefined && conversationId !== null) conversationId = text(conversationId, 'conversationId', { max: 160 })
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
      const email = normalizeEmail(body.email ?? current.email)
      const phone = text(body.phone ?? current.phone, 'phone', { max: 40 })
      const company = text(body.company ?? current.company, 'company', { max: 160, required: false }) || ''
      const country = text(body.country ?? current.country, 'country', { max: 100 })
      const language = text(body.language ?? current.language, 'language', { max: 12 })
      const currency = text(body.currency ?? current.currency, 'currency', { min: 3, max: 3 })
      const avatar = text(body.avatar ?? current.avatar ?? user.avatar, 'avatar', { max: 500000 })
      if (!/^\+?[0-9][0-9 ()-]{5,38}$/.test(phone)) throw new ApiError(400, 'VALIDATION_ERROR', 'phone must be a valid phone number')
      return store.mutate((db) => {
        const timestamp = new Date().toISOString()
        const profile = { userId: user.id, firstName, lastName, username, email, normalizedEmail: email, phone, company, country, language, currency: currency.toUpperCase(), avatar, updatedAt: timestamp }
        if (db.accounts.some((item) => item.userId !== user.id && item.username?.toLowerCase() === username.toLowerCase())) throw new ApiError(409, 'USERNAME_EXISTS', 'That username is already in use')
        if (db.accounts.some((item) => item.userId !== user.id && (item.normalizedEmail === email || item.email?.toLowerCase() === email))) throw new ApiError(409, 'EMAIL_EXISTS', 'That email address is already in use')
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
    async sessions(user) { const security = (await store.read('accountSecurity')).find((item) => item.userId === user.id); return (security || newSecurity(user)).activeSessions.map(publicSession) },
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
    async application(user) {
      if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to view your affiliate application')
      return (await store.read('affiliateApplications')).filter((item) => item.userId === user.id).sort(newestFirst)[0] || null
    },
    async apply(body, user) {
      if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to create an affiliate application')
      const name = text(body.name, 'name', { min: 2, max: 120 })
      const email = normalizeEmail(body.email)
      const publicName = text(body.publicName, 'publicName', { max: 120, required: false })
      const website = text(body.website, 'website', { max: 240, required: false })
      const country = text(body.country, 'country', { max: 80 })
      const preferredLanguage = text(body.preferredLanguage, 'preferredLanguage', { max: 40 })
      const biography = text(body.biography, 'biography', { min: 10, max: 600 })
      const motivation = text(body.motivation, 'motivation', { min: 10, max: 1500 })
      if (!Array.isArray(body.categoryIds) || !body.categoryIds.length || body.categoryIds.length > 12 || body.categoryIds.some((item) => typeof item !== 'string')) throw new ApiError(400, 'VALIDATION_ERROR', 'categoryIds must contain between 1 and 12 category IDs')
      const categoryIds = [...new Set(body.categoryIds)]
      return store.mutate((db) => {
        const invalidCategoryIds = categoryIds.filter((id) => !db.categories.some((item) => item.id === id && item.active))
        if (invalidCategoryIds.length) throw new ApiError(400, 'VALIDATION_ERROR', 'One or more category IDs are invalid', { categoryIds: invalidCategoryIds })
        if (db.affiliateApplications.some((item) => item.userId === user.id && ['pending', 'approved'].includes(item.status))) throw new ApiError(409, 'APPLICATION_EXISTS', 'An active affiliate application already exists')
        const timestamp = new Date().toISOString()
        const application = { id: store.id('affiliate'), userId: user.id, name, email, publicName: publicName || null, website: website || null, country, preferredLanguage, biography, motivation, categoryIds, status: 'pending', createdAt: timestamp, updatedAt: timestamp }
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

  function cartFromState(db, user) {
    const productById = new Map(db.products.map((product) => [product.id, product]))
    const items = db.cartItems.filter((item) => item.userId === user.id).map((item) => {
      const product = productById.get(item.productId)
      if (!product || !product.active) throw new ApiError(409, 'PRODUCT_UNAVAILABLE', 'A cart product is no longer available')
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw new ApiError(400, 'INVALID_CART_QUANTITY', 'Cart contains an invalid quantity')
      if (!Number.isInteger(item.packSize) || item.packSize < 1 || item.packSize > 999) throw new ApiError(400, 'INVALID_CART_QUANTITY', 'Cart contains an invalid pack size')
      if (!['air', 'sea'].includes(item.shippingMethod || 'sea')) throw new ApiError(400, 'INVALID_SHIPPING_METHOD', 'Cart contains an invalid shipping method')
      const unitPrice = product.price
      return { ...item, product, unitPrice, shippingMethod: item.shippingMethod || 'sea', lineTotal: unitPrice * item.quantity, availableStock: product.stock ?? 100 }
    })
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
    const shipping = items.length ? (items.some((item) => item.shippingMethod === 'air') ? 600000 : 350000) : 0
    const coupon = db.cartCoupons.find((item) => item.userId === user.id) || null
    if (coupon && coupon.code !== 'BUYAMIA10') throw new ApiError(400, 'INVALID_COUPON', 'This promotional code is invalid or expired')
    const automaticDiscount = subtotal >= 3000000 ? 350000 : 0
    const couponDiscount = coupon?.code === 'BUYAMIA10' ? Math.min(Math.round(subtotal * .1), 500000) : 0
    const discount = Math.max(automaticDiscount, couponDiscount)
    const taxes = 0
    return { items, summary: { itemCount: items.reduce((sum, item) => sum + item.quantity, 0), subtotal, shipping, discount, taxes, total: Math.max(0, subtotal + shipping + taxes - discount), currency: 'IDR', coupon: coupon?.code || null, deliveryEstimate: items.length ? '7–14 business days' : null } }
  }

  function orderShippingAddress(db, user) {
    const session = db.checkoutSessions.find((item) => item.userId === user.id)
    const shipping = session?.shipping || {}
    const profile = db.accounts.find((item) => item.userId === user.id)
    const defaultAddress = db.shippingAddresses.find((item) => item.userId === user.id && item.isDefault) || db.shippingAddresses.find((item) => item.userId === user.id)
    return {
      name: [shipping.firstName, shipping.lastName].filter(Boolean).join(' ').trim() || defaultAddress?.recipientName || profile?.name || profile?.firstName || 'Buyamia Buyer',
      phone: shipping.phone || defaultAddress?.phone || profile?.phone || '',
      line1: shipping.addressLine1 || defaultAddress?.line1 || '',
      line2: shipping.addressLine2 || defaultAddress?.line2 || '',
      city: shipping.city || defaultAddress?.city || '',
      region: shipping.region || defaultAddress?.state || '',
      postalCode: shipping.zipCode || defaultAddress?.postalCode || '',
      country: shipping.country || defaultAddress?.country || profile?.country || '',
    }
  }

  function publicOrder(order) {
    const { idempotencyKey: _idempotencyKey, userId: _userId, ...safe } = order
    return safe
  }

  function enrichOrder(order, products) {
    const productById = new Map(products.map((item) => [item.id, item]))
    const items = order.items.map((item) => ({ ...item, product: item.product || productById.get(item.productId) || null }))
    const reachedStatuses = new Set((order.timeline || []).map((entry) => entry.status))
    const timeline = timelineSteps.map((status) => {
      const entry = (order.timeline || []).find((item) => item.status === status)
      return { status, label: orderStatusLabel(status), at: entry?.at || null, reached: reachedStatuses.has(status) }
    })
    if (order.status === 'pending_payment' && !timeline.some((entry) => entry.reached)) timeline[0].reached = true
    return publicOrder({ ...order, items, timeline, statusLabel: orderStatusLabel(order.status), itemCount: items.reduce((sum, item) => sum + item.quantity, 0) })
  }

  function positiveInteger(value, field, maximum = 999) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an integer between 1 and ${maximum}`)
    return value
  }

  async function cartView(user) {
    const db = await store.getState()
    return cartFromState(db, user)
  }

  const cart = {
    get: cartView,
    async add(body, user) {
      const productId = text(body.productId, 'productId', { max: 120 }); const quantity = positiveInteger(body.quantity ?? 1, 'quantity')
      const product = (await store.read('products')).find((item) => item.id === productId && item.active)
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found or unavailable')
      const packSize = positiveInteger(body.packSize ?? product.minimumOrder ?? 1, 'packSize')
      const minimumOrder = product.minimumOrder ?? 1
      if (packSize < minimumOrder) throw new ApiError(400, 'MINIMUM_ORDER_REQUIRED', `Minimum order is ${minimumOrder} pcs`)
      const stock = product.stock ?? 100; if (quantity > stock) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${stock} units are available`)
      await store.mutate((db) => {
        const timestamp = new Date().toISOString()
        const existing = db.cartItems.find((item) => item.userId === user.id && item.productId === productId && item.packSize === packSize && (item.shippingMethod || 'sea') === 'sea' && (item.customization || 'No') === 'No' && (item.warranty || 'No') === 'No')
        if (existing) {
          const nextQuantity = existing.quantity + quantity
          if (nextQuantity > stock) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${stock} units are available`)
          existing.quantity = nextQuantity
          existing.unitPrice = product.price
          existing.updatedAt = timestamp
          return
        }
        const item = { id: store.id('cart'), userId: user.id, productId, quantity, packSize, unitPrice: product.price, shippingMethod: 'sea', customization: 'No', warranty: 'No', createdAt: timestamp }
        db.cartItems.push(item)
      })
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
      const safeBody = { ...body }; if (safeBody.card) delete safeBody.card
      const session = await store.mutate((db) => { let value = db.checkoutSessions.find((item) => item.userId === user.id); if (!value) { value = { id: store.id('checkout'), userId: user.id, createdAt: new Date().toISOString() }; db.checkoutSessions.push(value) } Object.assign(value, safeBody, { step, summary: cartData.summary, updatedAt: new Date().toISOString() }); return value })
      return session
    },
  }

  const orders = {
    async create(body, user, headerIdempotencyKey) {
      rejectSensitiveOrderData(body)
      const idempotencyKey = text(headerIdempotencyKey || body.idempotencyKey, 'idempotencyKey', { max: 160 })
      return store.mutate((db) => {
        const existing = db.orders.find((item) => item.userId === user.id && item.idempotencyKey === idempotencyKey)
        if (existing) return { order: enrichOrder(existing, db.products), created: false }
        const cartData = cartFromState(db, user)
        if (!cartData.items.length) throw new ApiError(409, 'EMPTY_CART', 'Add an item to your cart before placing an order')
        const timestamp = new Date().toISOString()
        const orderId = store.id('order')
        const shortId = orderId.replace(/^order_/, '').replace(/-/g, '').slice(0, 8).toUpperCase()
        const orderNumber = `BYA-${new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, '')}-${shortId}`
        const status = 'pending_payment'
        const items = cartData.items.map((item) => ({
          id: store.id('order-item'),
          productId: item.productId,
          title: item.product.title,
          image: item.product.image,
          quantity: item.quantity,
          packSize: item.packSize,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          currency: item.product.currency || cartData.summary.currency,
          shippingMethod: item.shippingMethod,
          customization: item.customization || 'No',
          warranty: item.warranty || 'No',
          product: { id: item.product.id, title: item.product.title, image: item.product.image, categoryId: item.product.categoryId },
        }))
        const order = {
          id: orderId,
          userId: user.id,
          idempotencyKey,
          orderNumber,
          status,
          statusLabel: orderStatusLabel(status),
          currency: cartData.summary.currency,
          subtotal: cartData.summary.subtotal,
          shippingCost: cartData.summary.shipping,
          discount: cartData.summary.discount,
          taxes: cartData.summary.taxes,
          total: cartData.summary.total,
          itemCount: cartData.summary.itemCount,
          coupon: cartData.summary.coupon,
          shipping: { carrier: 'Buyamia Logistics', service: cartData.items.some((item) => item.shippingMethod === 'air') ? 'Air Freight' : 'Sea Freight', destination: orderShippingAddress(db, user).country || 'To be confirmed' },
          shippingAddress: orderShippingAddress(db, user),
          deliveryEstimate: cartData.summary.deliveryEstimate,
          payment: { method: 'Simulated checkout', status: 'pending', label: 'Payment pending' },
          timeline: [{ status: 'order_received', label: orderStatusLabel('order_received'), at: timestamp }],
          items,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        db.orders.push(order)
        db.cartItems = db.cartItems.filter((item) => item.userId !== user.id)
        db.cartCoupons = db.cartCoupons.filter((item) => item.userId !== user.id)
        db.checkoutSessions = db.checkoutSessions.filter((item) => item.userId !== user.id)
        return { order: enrichOrder(order, db.products), created: true }
      })
    },
    async list(query, user) {
      const search = normalizeSearch(query.get('q'))
      const status = query.get('status')
      if (status && !orderStatuses.includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported')
      const rows = (await store.read('orders')).filter((item) => item.userId === user.id && (!status || item.status === status) && (!search || normalizeSearch(item.orderNumber).includes(search))).sort(newestFirst).map((item) => publicOrder({ ...item, statusLabel: orderStatusLabel(item.status), itemCount: item.itemCount ?? item.items?.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0 }))
      return paginate(rows, query)
    },
    async get(id, user) {
      const [ordersData, products] = await Promise.all([store.read('orders'), store.read('products')])
      const order = ordersData.find((item) => item.id === id && item.userId === user.id)
      if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found')
      return enrichOrder(order, products)
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
    async list(query, user) { const q = text(query.get('q'), 'q', { max: 160, required: false })?.toLowerCase(); const status = query.get('status') || 'live'; const category = text(query.get('category'), 'category', { max: 120, required: false }); const sort = query.get('sort') || 'ending-soon'; const premium = query.get('premium') || 'false'; const rawPage = query.get('page'); const rawLimit = query.get('limit'); if (!['all', 'live', 'upcoming', 'completed', 'hot-bidding'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported'); if (!['ending-soon', 'newest', 'bid-high', 'price-low', 'most-bids'].includes(sort)) throw new ApiError(400, 'VALIDATION_ERROR', 'sort is not supported'); if (!['true', 'false'].includes(premium)) throw new ApiError(400, 'VALIDATION_ERROR', 'premium must be true or false'); if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) throw new ApiError(400, 'VALIDATION_ERROR', 'page must be a positive integer'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100'); const allRows = (await auctionRows(user)).filter((item) => item.status !== 'cancelled'); const availableCategories = [...new Set(allRows.map((item) => item.categoryId).filter(Boolean))].sort(); if (category && !availableCategories.includes(category)) throw new ApiError(400, 'VALIDATION_ERROR', 'category is not supported'); const tokens = q?.split(/\s+/).filter(Boolean) || []; let rows = allRows.filter((item) => (status === 'all' || (status === 'hot-bidding' ? item.status === 'live' && item.bidCount > 0 : item.status === status)) && (!category || item.categoryId === category) && (premium !== 'true' || item.featured) && (!tokens.length || tokens.every((token) => `${item.title} ${item.description} ${item.seller?.displayName || ''} ${item.product?.title || ''}`.toLowerCase().includes(token)))); const sorters = { 'ending-soon': (a, b) => new Date(a.endTime) - new Date(b.endTime), newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt), 'bid-high': (a, b) => b.currentBid - a.currentBid, 'price-low': (a, b) => a.currentBid - b.currentBid, 'most-bids': (a, b) => b.bidCount - a.bidCount }; rows.sort(sorters[sort]); const result = paginate(rows, query); return { ...result, meta: { ...result.meta, availableCategories }, filters: { q: q || '', status, category: category || '', premium: premium === 'true', sort } } },
    async get(id, user) { const auction = (await auctionRows(user)).find((item) => item.id === id); if (!auction) throw new ApiError(404, 'AUCTION_NOT_FOUND', 'Auction not found'); return auction },
    async featured(user) { return (await auctionRows(user)).filter((item) => item.featured && item.status === 'live').sort((a, b) => a.remainingMs - b.remainingMs).slice(0, 4) },
    async bids(id, query, user) { await this.get(id, user); const rows = (await store.read('auctionBids')).filter((item) => item.auctionId === id).sort((a, b) => b.amount - a.amount || new Date(b.createdAt) - new Date(a.createdAt)).map((item) => ({ ...item, bidder: item.userId === user.id ? 'You' : `Bidder ${item.userId.slice(-4)}` })); return paginate(rows, query) },
    async placeBid(id, body, user) { const amount = Number(body.amount); if (!Number.isSafeInteger(amount) || amount < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'amount must be a positive whole number'); await store.mutate((db) => { const auction = db.auctions.find((item) => item.id === id); if (!auction) throw new ApiError(404, 'AUCTION_NOT_FOUND', 'Auction not found'); const status = auctionStatus(auction); if (status === 'upcoming') throw new ApiError(409, 'AUCTION_NOT_STARTED', 'This auction has not started'); if (status !== 'live') throw new ApiError(409, 'AUCTION_CLOSED', 'This auction is closed'); const seller = db.sellerProfiles.find((item) => item.id === auction.sellerId); if (seller?.userId === user.id) throw new ApiError(403, 'SELLER_CANNOT_BID', 'Sellers cannot bid on their own auctions'); const highest = db.auctionBids.filter((item) => item.auctionId === id).reduce((max, item) => Math.max(max, item.amount), auction.currentBid || auction.startingPrice); const minimum = highest + (auction.bidIncrement || 1); if (amount < minimum) throw new ApiError(409, 'BID_TOO_LOW', `Bid must be at least ${minimum}`); const bid = { id: store.id('bid'), auctionId: id, userId: user.id, amount, createdAt: new Date().toISOString() }; db.auctionBids.push(bid); auction.currentBid = amount; auction.bidCount = (auction.bidCount || 0) + 1; auction.updatedAt = bid.createdAt }); return this.get(id, user) },
    async watchlist(user) { return (await auctionRows(user)).filter((item) => item.watched) },
    async watch(body, user) { const auctionId = text(body.auctionId, 'auctionId', { max: 160 }); await this.get(auctionId, user); return store.mutate((db) => { if (db.auctionWatchlists.some((item) => item.userId === user.id && item.auctionId === auctionId)) throw new ApiError(409, 'AUCTION_ALREADY_WATCHED', 'Auction is already in your watchlist'); const item = { id: store.id('auction-watch'), userId: user.id, auctionId, createdAt: new Date().toISOString() }; db.auctionWatchlists.push(item); return item }) },
    async unwatch(id, user) { return store.mutate((db) => { const index = db.auctionWatchlists.findIndex((item) => item.userId === user.id && (item.id === id || item.auctionId === id)); if (index < 0) throw new ApiError(404, 'WATCHLIST_ITEM_NOT_FOUND', 'Auction watchlist item not found'); return db.auctionWatchlists.splice(index, 1)[0] }) },
    async history(query, user) { const ownBids = (await store.read('auctionBids')).filter((item) => item.userId === user.id); const latestByAuction = new Map(); ownBids.forEach((bid) => { if (!latestByAuction.has(bid.auctionId) || latestByAuction.get(bid.auctionId).amount < bid.amount) latestByAuction.set(bid.auctionId, bid) }); const byId = new Map((await auctionRows(user)).map((item) => [item.id, item])); return paginate([...latestByAuction.values()].map((bid) => ({ ...bid, auction: byId.get(bid.auctionId) })).filter((item) => item.auction).sort(newestFirst), query) },
  }

  function requireAuthenticated(user) { if (!user.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to manage auction listings') }
  function optionalListingText(value, field, max) { return text(value, field, { max, required: false }) || '' }
  async function listingInput(body, current = {}) {
    const value = { ...current }
    if (body.title !== undefined) value.title = optionalListingText(body.title, 'title', 120)
    if (body.description !== undefined) value.description = optionalListingText(body.description, 'description', 3000)
    if (body.categoryId !== undefined) { const categoryId = optionalListingText(body.categoryId, 'categoryId', 120); if (categoryId && !(await store.read('categories')).some((item) => item.id === categoryId && item.active)) throw new ApiError(400, 'VALIDATION_ERROR', 'categoryId is invalid'); value.categoryId = categoryId }
    for (const field of ['startingPrice', 'reservePrice', 'minimumOrder']) if (body[field] !== undefined) { const number = Number(body[field]); if (!Number.isSafeInteger(number) || number < (field === 'minimumOrder' ? 1 : 0)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid positive whole number`); value[field] = number }
    for (const [field, max] of [['shippingOption',80],['customization',80],['warranty',80],['material',160],['condition',80]]) if (body[field] !== undefined) value[field] = optionalListingText(body[field], field, max)
    if (body.dimensions !== undefined) { const dimensions = body.dimensions || {}; value.dimensions = {}; for (const field of ['width','height','length']) { const number = Number(dimensions[field] || 0); if (!Number.isFinite(number) || number < 0 || number > 100000) throw new ApiError(400, 'VALIDATION_ERROR', `dimensions.${field} is invalid`); value.dimensions[field] = number } }
    for (const field of ['productTags','impactTags']) if (body[field] !== undefined) { if (!Array.isArray(body[field]) || body[field].length > 12) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an array with at most 12 entries`); value[field] = body[field].map((item) => text(item, `${field} item`, { max: 80 })) }
    if (body.images !== undefined) { if (!Array.isArray(body.images) || body.images.length > 8) throw new ApiError(400, 'VALIDATION_ERROR', 'images must contain at most 8 entries'); value.images = body.images.map((image, index) => { if (!image || typeof image !== 'object') throw new ApiError(400, 'VALIDATION_ERROR', 'Each image must contain metadata'); const name = text(image.name, 'image.name', { max: 180 }); const mimeType = text(image.mimeType, 'image.mimeType', { max: 80 }); const size = Number(image.size); if (!['image/jpeg','image/png','image/heic'].includes(mimeType)) throw new ApiError(400, 'VALIDATION_ERROR', 'Images must be JPEG, PNG, or HEIC'); if (!Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024) throw new ApiError(400, 'VALIDATION_ERROR', 'Each image must be between 1 byte and 10 MB'); return { id: image.id || store.id('auction-image'), name, mimeType, size, order: index, url: image.url || '/assets/product-thumb.png', uploadedAt: image.uploadedAt || new Date().toISOString() } }) }
    if (body.startTime !== undefined) { const date = new Date(body.startTime); if (Number.isNaN(date.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', 'startTime must be a valid date'); value.startTime = date.toISOString() }
    if (body.endTime !== undefined) { const date = new Date(body.endTime); if (Number.isNaN(date.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', 'endTime must be a valid date'); value.endTime = date.toISOString() }
    if (value.startTime && value.endTime && new Date(value.endTime) <= new Date(value.startTime)) throw new ApiError(400, 'VALIDATION_ERROR', 'endTime must be after startTime')
    return value
  }
  function listingPublicationErrors(listing) { const errors = []; if (!listing.title || listing.title.length < 3) errors.push('Title must contain at least 3 characters'); if (!listing.description || listing.description.length < 20) errors.push('Description must contain at least 20 characters'); if (!listing.categoryId) errors.push('Select a category'); if (!Number.isSafeInteger(listing.startingPrice) || listing.startingPrice < 1) errors.push('Opening bid must be greater than zero'); if (!Array.isArray(listing.images) || listing.images.length < 2) errors.push('Upload at least 2 images'); if (!listing.shippingOption) errors.push('Select a shipping option'); return errors }
  const auctionListings = {
    async list(query, user) { requireAuthenticated(user); const status = query.get('status') || 'all'; if (!['all','draft','published'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status is not supported'); return paginate((await store.read('auctionListings')).filter((item) => item.userId === user.id && (status === 'all' || item.status === status)).sort(newestFirst), query) },
    async get(id, user) { requireAuthenticated(user); const listing = (await store.read('auctionListings')).find((item) => item.id === id && item.userId === user.id); if (!listing) throw new ApiError(404, 'AUCTION_LISTING_NOT_FOUND', 'Auction listing not found'); return listing },
    async create(body, user) { requireAuthenticated(user); const values = await listingInput(body); return store.mutate((db) => { const timestamp = new Date().toISOString(); const listing = { id: store.id('auction-listing'), userId: user.id, seller: { id: user.id, name: user.name }, title: '', description: '', categoryId: '', startingPrice: 0, reservePrice: 0, minimumOrder: 1, shippingOption: '', customization: '', warranty: '', material: '', condition: '', dimensions: { width: 0, height: 0, length: 0 }, productTags: [], impactTags: [], images: [], ...values, status: 'draft', createdAt: timestamp, updatedAt: timestamp, publishedAt: null, auctionId: null }; db.auctionListings.push(listing); return listing }) },
    async update(id, body, user) { const current = await this.get(id, user); if (current.status !== 'draft') throw new ApiError(409, 'LISTING_ALREADY_PUBLISHED', 'Published listings cannot be edited'); const values = await listingInput(body, current); return store.mutate((db) => { const listing = db.auctionListings.find((item) => item.id === id); Object.assign(listing, values, { updatedAt: new Date().toISOString() }); return listing }) },
    async remove(id, user) { const current = await this.get(id, user); if (current.status !== 'draft') throw new ApiError(409, 'LISTING_ALREADY_PUBLISHED', 'Published listings cannot be deleted'); return store.mutate((db) => { const index = db.auctionListings.findIndex((item) => item.id === id); return db.auctionListings.splice(index, 1)[0] }) },
    async preview(id, user) { const listing = await this.get(id, user); const errors = listingPublicationErrors(listing); return { ...listing, readyToPublish: errors.length === 0, validationErrors: errors } },
    async upload(body, user) { requireAuthenticated(user); if (!Array.isArray(body.images) || !body.images.length) throw new ApiError(400, 'VALIDATION_ERROR', 'images must contain at least one image'); const images = await listingInput({ images: body.images }); return images.images },
    async publish(id, user) { const listing = await this.get(id, user); if (listing.status !== 'draft') throw new ApiError(409, 'LISTING_ALREADY_PUBLISHED', 'This listing has already been published'); const errors = listingPublicationErrors(listing); if (errors.length) throw new ApiError(400, 'LISTING_INCOMPLETE', 'Complete all required listing fields before publishing', errors); const timestamp = new Date().toISOString(); const startTime = listing.startTime || timestamp; const endTime = listing.endTime || new Date(new Date(startTime).getTime() + 7 * 86400000).toISOString(); if (new Date(endTime) <= new Date(startTime)) throw new ApiError(400, 'VALIDATION_ERROR', 'Auction end time must be after its start time'); return store.mutate((db) => { const product = { id: store.id('product'), title: listing.title, description: listing.description, categoryId: listing.categoryId, image: listing.images[0].url, images: listing.images.map((item) => item.url), price: listing.startingPrice, currency: 'IDR', rating: 0, reviewCount: 0, discountPercent: 0, soldCount: 0, stock: listing.minimumOrder, featured: false, active: true, createdAt: timestamp, updatedAt: timestamp }; db.products.push(product); const sellerProfile = db.sellerProfiles.find((item) => item.userId === user.id); const auction = { id: store.id('auction'), productId: product.id, sellerId: sellerProfile?.id || `user-${user.id}`, seller: sellerProfile || listing.seller, title: listing.title, description: listing.description, images: listing.images.map((item) => item.url), categoryId: listing.categoryId, startingPrice: listing.startingPrice, currentBid: listing.startingPrice, reservePrice: listing.reservePrice || listing.startingPrice, bidIncrement: Math.max(1, Math.round(listing.startingPrice * .05)), bidCount: 0, featured: false, startTime, endTime, status: 'live', shippingOption: listing.shippingOption, customization: listing.customization, warranty: listing.warranty, material: listing.material, condition: listing.condition, dimensions: listing.dimensions, productTags: listing.productTags, impactTags: listing.impactTags, createdAt: timestamp, updatedAt: timestamp }; db.auctions.push(auction); const draft = db.auctionListings.find((item) => item.id === id); Object.assign(draft, { status: 'published', productId: product.id, auctionId: auction.id, startTime, endTime, publishedAt: timestamp, updatedAt: timestamp }); return { listing: draft, auction } }) },
  }

  const concierge = {
    whatsapp(message) {
      const configuredNumber = String(environment.BUYAMIA_WHATSAPP_NUMBER || '').trim()
      const businessName = text(environment.BUYAMIA_WHATSAPP_BUSINESS_NAME || 'Buyamia', 'BUYAMIA_WHATSAPP_BUSINESS_NAME', { max: 80 })
      const defaultMessage = text(environment.BUYAMIA_WHATSAPP_DEFAULT_MESSAGE || 'Hello, I would like help from the Buyamia concierge.', 'BUYAMIA_WHATSAPP_DEFAULT_MESSAGE', { max: 500 })
      if (!configuredNumber) throw new ApiError(503, 'WHATSAPP_NOT_CONFIGURED', 'WhatsApp concierge is not configured')
      if (!/^\+?[1-9]\d{7,14}$/.test(configuredNumber)) throw new ApiError(503, 'WHATSAPP_INVALID_CONFIGURATION', 'WhatsApp concierge phone number must use international format')
      const cleanMessage = message === null ? defaultMessage : text(message, 'message', { max: 500 })
      const phoneNumber = configuredNumber.replace(/^\+/, '')
      return {
        channel: 'whatsapp',
        businessName,
        phoneNumber: `+${phoneNumber}`,
        message: cleanMessage,
        url: `https://wa.me/${phoneNumber}?text=${encodeURIComponent(cleanMessage)}`,
      }
    },
    async telegramStatus(user) {
      const connection = (await store.read('telegramConnections')).find((item) => item.userId === user.id) || null
      return {
        configured: Boolean(String(environment.BUYAMIA_TELEGRAM_BOT_USERNAME || '').trim()),
        connected: Boolean(connection),
        username: connection?.telegramUsername || null,
        telegramUserId: connection?.telegramUserId || null,
        connectedAt: connection?.connectedAt || null,
        lastInteractionAt: connection?.lastInteractionAt || null,
      }
    },
    telegramBotUsername() {
      const username = String(environment.BUYAMIA_TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '')
      if (!username) throw new ApiError(503, 'TELEGRAM_NOT_CONFIGURED', 'Telegram concierge is not configured')
      if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) throw new ApiError(503, 'TELEGRAM_INVALID_CONFIGURATION', 'Telegram bot username is invalid')
      return username
    },
    async telegramStart(body, user) {
      const botUsername = this.telegramBotUsername()
      const message = text(body.message, 'message', { max: 500, required: false }) || null
      const startToken = store.id('buyamia').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
      const timestamp = new Date().toISOString()
      const conversation = await store.mutate((db) => {
        const item = { id: store.id('telegram-conversation'), userId: user.id, startToken, message, status: 'started', startedAt: timestamp, lastInteractionAt: timestamp }
        db.telegramConversationHistory.push(item)
        const connection = db.telegramConnections.find((entry) => entry.userId === user.id)
        if (connection) connection.lastInteractionAt = timestamp
        return item
      })
      return { conversationId: conversation.id, status: conversation.status, url: `https://t.me/${botUsername}?start=${encodeURIComponent(startToken)}`, botUsername: `@${botUsername}`, startedAt: timestamp }
    },
    async telegramConnect(body, user) {
      if (!user.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in before linking a Telegram account')
      const telegramUserId = text(String(body.telegramUserId || ''), 'telegramUserId', { max: 20 })
      const telegramUsername = text(body.telegramUsername, 'telegramUsername', { max: 33, required: false })?.replace(/^@/, '') || null
      if (!/^\d{5,20}$/.test(telegramUserId)) throw new ApiError(400, 'VALIDATION_ERROR', 'telegramUserId must contain 5 to 20 digits')
      if (telegramUsername && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegramUsername)) throw new ApiError(400, 'VALIDATION_ERROR', 'telegramUsername is invalid')
      return store.mutate((db) => {
        if (db.telegramConnections.some((item) => item.userId === user.id)) throw new ApiError(409, 'TELEGRAM_ALREADY_CONNECTED', 'A Telegram account is already linked to this user')
        if (db.telegramConnections.some((item) => item.telegramUserId === telegramUserId)) throw new ApiError(409, 'TELEGRAM_ACCOUNT_IN_USE', 'This Telegram account is already linked')
        const timestamp = new Date().toISOString()
        const connection = { id: store.id('telegram-connection'), userId: user.id, telegramUserId, telegramUsername, status: 'linked', connectedAt: timestamp, lastInteractionAt: timestamp }
        db.telegramConnections.push(connection)
        return connection
      })
    },
    async telegramDisconnect(user) {
      if (!user.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in before unlinking a Telegram account')
      return store.mutate((db) => {
        const index = db.telegramConnections.findIndex((item) => item.userId === user.id)
        if (index < 0) throw new ApiError(404, 'TELEGRAM_NOT_CONNECTED', 'No Telegram account is linked to this user')
        const [connection] = db.telegramConnections.splice(index, 1)
        return { id: connection.id, disconnected: true, disconnectedAt: new Date().toISOString() }
      })
    },
    async telegramHistory(query, user) {
      const rows = (await store.read('telegramConversationHistory')).filter((item) => item.userId === user.id).sort(newestFirst).map(({ startToken: _startToken, ...item }) => item)
      return paginate(rows, query)
    },
  }

  const promoFeedback = {
    async submit(body, user) {
      const email = text(body.email, 'email', { min: 5, max: 254 }).toLowerCase()
      const feedback = text(body.feedback, 'feedback', { min: 10, max: 2000 })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'INVALID_EMAIL', 'Enter a valid email address')
      const fingerprint = createHash('sha256').update(`${email}\n${feedback.toLowerCase()}`).digest('hex')
      return store.mutate((db) => {
        if (db.feedbackSubmissions.some((item) => item.fingerprint === fingerprint)) throw new ApiError(409, 'FEEDBACK_ALREADY_SUBMITTED', 'This feedback has already been submitted')
        const submission = { id: store.id('feedback'), email, feedback, userId: user?.authenticated ? user.id : null, source: 'promo-popup', status: 'received', fingerprint, createdAt: new Date().toISOString() }
        db.feedbackSubmissions.push(submission)
        return { id: submission.id, status: submission.status, reward: { type: 'percentage', value: 10, appliesTo: 'next-purchase' } }
      })
    },
  }

  const nodeManifest = {
    async get(supplierId) {
      const [profiles, brands, products, pools, participants] = await Promise.all(['sellerProfiles', 'brands', 'products', 'buyingPools', 'buyingPoolParticipants'].map((name) => store.read(name)))
      const eligible = profiles.filter((item) => item.public && item.verificationStatus === 'approved').sort((a, b) => a.id.localeCompare(b.id))
      const supplier = supplierId ? eligible.find((item) => item.id === supplierId) : eligible[0]
      if (!supplier) throw new ApiError(404, 'NODE_MANIFEST_NOT_FOUND', 'No public verified supplier node is available')
      const brand = brands.find((item) => item.id === supplier.brandId) || null
      return buildNodeManifest({ supplier, brand, products, pools, participants })
    },
  }

  return { auth, about, categories, products, marketplace, buyingPools, flashSales, fastSelling, sellerPromotions, brands, source, search, community, chat, account, affiliate, support, cart, checkout, orders, seller, auctions, auctionListings, concierge, promoFeedback, nodeManifest }
}
