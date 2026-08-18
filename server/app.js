import { createServices, ApiError } from './services.js'

const bodyLimit = 512 * 1024
const sessionCookieName = 'buyamia_session'

function json(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  const contentType = request.headers['content-type'] || ''
  if (!contentType.includes('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > bodyLimit) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
    chunks.push(chunk)
  }
  let parsed
  try {
    parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body contains invalid JSON')
  }
  rejectDangerousJsonKeys(parsed)
  return parsed
}

function rejectDangerousJsonKeys(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ApiError(400, 'INVALID_JSON_PROPERTY', `${key} is not allowed`)
    rejectDangerousJsonKeys(entry)
  }
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || '').split(';')
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=')
    if (separator < 0) continue
    const key = cookie.slice(0, separator).trim()
    if (key === name) return cookie.slice(separator + 1).trim()
  }
  return ''
}

function isSecureRequest(request) {
  return Boolean(request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production')
}

function sessionCookie(request, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  return [`${sessionCookieName}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`, `Expires=${new Date(expiresAt).toUTCString()}`, ...(isSecureRequest(request) ? ['Secure'] : [])].join('; ')
}

function clearSessionCookie(request) {
  return [`${sessionCookieName}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', ...(isSecureRequest(request) ? ['Secure'] : [])].join('; ')
}

function authRequestMeta(request) {
  return { userAgent: request.headers['user-agent'] || '' }
}

function authResponse(result) {
  const { sessionToken: _sessionToken, sessionExpiresAt: _sessionExpiresAt, ...safe } = result
  return safe
}

async function logoutResponse(request, response, services, corsHeaders) {
  await services.auth.logout(cookieValue(request, sessionCookieName))
  return json(response, 200, { data: { authenticated: false } }, { ...corsHeaders, 'Set-Cookie': clearSessionCookie(request) })
}

async function userForRequest(request, services) {
  const token = cookieValue(request, sessionCookieName)
  if (token) {
    try {
      const session = await services.auth.session(token)
      return { ...session.user, sessionId: session.session.id }
    } catch {
      // Public endpoints continue as anonymous guests when a stale cookie is present.
    }
  }
  return guestUser()
}

async function requireSessionUser(request, services) {
  const session = await services.auth.session(cookieValue(request, sessionCookieName))
  return { ...session.user, sessionId: session.session.id }
}

function guestUser() {
  return { id: null, name: 'Buyamia Guest', avatar: '/assets/avatar-1.png', authenticated: false }
}

function match(pathname, pattern) {
  const result = pathname.match(pattern)
  return result ? result.slice(1).map(decodeURIComponent) : null
}

function isAllowedOrigin(origin, allowedOrigin) {
  return origin === allowedOrigin || origin === 'http://localhost:5173'
}

export function createApp(store, { allowedOrigin = 'http://127.0.0.1:5173' } = {}) {
  const services = createServices(store)

  return async function app(request, response) {
    const requestId = store.id('request')
    const origin = request.headers.origin
    const corsHeaders = origin && isAllowedOrigin(origin, allowedOrigin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }
      : {}

    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key' })
        return response.end()
      }

      const url = new URL(request.url, 'http://localhost')
      const { pathname, searchParams } = url
      if (pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method) && origin && !isAllowedOrigin(origin, allowedOrigin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')
      let user = await userForRequest(request, services)
      let params

      const privateAccountPath = pathname === '/api/preferences' || pathname.startsWith('/api/account') || pathname.startsWith('/api/saved') || pathname === '/api/notifications'
      const privateCartPath = pathname === '/api/cart' || pathname === '/api/cart/summary' || pathname === '/api/cart/coupon' || pathname === '/api/checkout' || pathname.startsWith('/api/cart/items')
      const privateCatalogPath = (pathname === '/api/categories' || pathname === '/api/marketplaces' || pathname === '/api/flash-sales') && request.method !== 'GET'
      const privateFlashSalePath = /^\/api\/flash-sales\/[^/]+$/.test(pathname) && ['PATCH', 'DELETE'].includes(request.method) || /^\/api\/flash-sales\/[^/]+\/publish$/.test(pathname)
      const privateAuctionPath = pathname === '/api/auctions/watchlist' && request.method === 'POST' || /^\/api\/auctions\/watchlist\/[^/]+$/.test(pathname) || /^\/api\/auctions\/[^/]+\/bids$/.test(pathname) && request.method === 'POST' || pathname.startsWith('/api/auction-listings')
      const privateSupportPath = pathname === '/api/support' && request.method === 'POST' || pathname.startsWith('/api/support/tickets')
      const privateSellerPath = pathname === '/api/seller' || pathname.startsWith('/api/seller/')
      const privatePoolPath = pathname === '/api/buying-pools' && request.method === 'POST' || /^\/api\/buying-pools\/[^/]+\/join$/.test(pathname)
      const privateAffiliatePath = pathname === '/api/affiliate-program/application' || pathname === '/api/affiliate-program/applications'
      const privateCommunityPath = pathname === '/api/community/messages' && request.method === 'POST'
      const privateChatPath = pathname.startsWith('/api/chat/') || pathname === '/api/ask-amia' || pathname.startsWith('/api/ask-amia/')
      const privateOrderAuxPath = /^\/api\/orders\/[^/]+\/(tracking|invoice)$/.test(pathname)
      const privateSellerFollowPath = /^\/api\/sellers\/[^/]+\/follow$/.test(pathname)
      const privateConciergePath = pathname === '/api/concierge/telegram/start' || pathname === '/api/concierge/telegram/connect' || pathname === '/api/concierge/telegram/disconnect' || pathname === '/api/concierge/telegram/history'
      if (privateAccountPath || privateCartPath || privateCatalogPath || privateFlashSalePath || privateAuctionPath || privateSupportPath || privateSellerPath || privatePoolPath || privateAffiliatePath || privateCommunityPath || privateChatPath || privateOrderAuxPath || privateSellerFollowPath || privateConciergePath) user = await requireSessionUser(request, services)

      if (request.method === 'GET' && pathname === '/.well-known/buyamia-node') return json(response, 200, await services.nodeManifest.get(searchParams.get('supplier')), { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' })
      if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok', service: 'buyamia-api', timestamp: new Date().toISOString() }, corsHeaders)
      if (pathname.startsWith('/api/admin/')) {
        if (request.method !== 'GET' && origin && !isAllowedOrigin(origin, allowedOrigin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')
        const adminUser = await requireSessionUser(request, services)
        if (request.method === 'GET' && pathname === '/api/admin/dashboard') return json(response, 200, { data: await services.admin.dashboard(adminUser) }, corsHeaders)
        if (request.method === 'GET' && pathname === '/api/admin/security') return json(response, 200, { data: await services.admin.security(adminUser) }, corsHeaders)
        if (request.method === 'GET' && pathname === '/api/admin/users') return json(response, 200, await services.admin.users(searchParams, adminUser), corsHeaders)
        if ((params = match(pathname, /^\/api\/admin\/users\/([^/]+)$/)) && request.method === 'PATCH') return json(response, 200, { data: await services.admin.updateUser(params[0], await readJson(request), adminUser) }, corsHeaders)
        if (request.method === 'GET' && pathname === '/api/admin/suppliers') return json(response, 200, await services.admin.suppliers(searchParams, adminUser), corsHeaders)
        if (request.method === 'POST' && pathname === '/api/admin/suppliers') return json(response, 201, { data: await services.admin.addSupplier(await readJson(request), adminUser) }, corsHeaders)
        if ((params = match(pathname, /^\/api\/admin\/suppliers\/([^/]+)$/)) && request.method === 'PATCH') return json(response, 200, { data: await services.admin.updateSupplier(params[0], await readJson(request), adminUser) }, corsHeaders)
        if (request.method === 'GET' && pathname === '/api/admin/refunds') return json(response, 200, { data: await services.admin.refunds(searchParams, adminUser) }, corsHeaders)
        if (request.method === 'POST' && pathname === '/api/admin/refunds') return json(response, 201, { data: await services.admin.createRefund(await readJson(request), adminUser) }, corsHeaders)
        if (request.method === 'GET' && pathname === '/api/admin/amia') return json(response, 200, { data: await services.admin.amia(adminUser) }, corsHeaders)
        if (request.method === 'PATCH' && pathname === '/api/admin/amia') return json(response, 200, { data: await services.admin.updateAmia(await readJson(request), adminUser) }, corsHeaders)
        if (request.method === 'GET' && pathname === '/api/admin/audit-log') return json(response, 200, await services.admin.auditLog(searchParams, adminUser), corsHeaders)
        throw new ApiError(404, 'NOT_FOUND', 'Admin API endpoint not found')
      }
      if (request.method === 'POST' && pathname === '/api/auth/signup') {
        const result = await services.auth.signup(await readJson(request), authRequestMeta(request))
        return json(response, 201, { data: authResponse(result) }, { ...corsHeaders, 'Set-Cookie': sessionCookie(request, result.sessionToken, result.sessionExpiresAt) })
      }
      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const result = await services.auth.login(await readJson(request), authRequestMeta(request))
        return json(response, 200, { data: authResponse(result) }, { ...corsHeaders, 'Set-Cookie': sessionCookie(request, result.sessionToken, result.sessionExpiresAt) })
      }
      if (request.method === 'POST' && pathname === '/api/auth/logout') {
        return logoutResponse(request, response, services, corsHeaders)
      }
      if (request.method === 'GET' && pathname === '/api/auth/session') return json(response, 200, { data: await services.auth.session(cookieValue(request, sessionCookieName)) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/feedback') return json(response, 201, { data: await services.promoFeedback.submit(await readJson(request), user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/newsletter') return json(response, 201, { data: await services.newsletter.subscribe(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/concierge/whatsapp') return json(response, 200, { data: services.concierge.whatsapp(searchParams.get('message')) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/concierge/telegram/status') return json(response, 200, { data: await services.concierge.telegramStatus(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/concierge/telegram/start') return json(response, 201, { data: await services.concierge.telegramStart(await readJson(request), user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/concierge/telegram/connect') return json(response, 201, { data: await services.concierge.telegramConnect(await readJson(request), user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/concierge/telegram/disconnect') return json(response, 200, { data: await services.concierge.telegramDisconnect(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/concierge/telegram/history') return json(response, 200, await services.concierge.telegramHistory(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/about') return json(response, 200, { data: await services.about.get() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/about\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.about.section(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/categories') return json(response, 200, await services.categories.list(searchParams), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/categories') return json(response, 201, { data: await services.categories.create(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/categories/products' || pathname === '/api/categories/search')) { const categoryId = searchParams.get('category'); if (!categoryId) throw new ApiError(400, 'VALIDATION_ERROR', 'category is required'); return json(response, 200, await services.categories.browseProducts(categoryId, searchParams), corsHeaders) }
      if ((params = match(pathname, /^\/api\/categories\/([^/]+)\/filters$/)) && request.method === 'GET') return json(response, 200, { data: await services.categories.filters(params[0]) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/categories\/([^/]+)\/products$/)) && request.method === 'GET') return json(response, 200, await services.categories.browseProducts(params[0], searchParams), corsHeaders)
      if ((params = match(pathname, /^\/api\/categories\/([^/]+)$/))) {
        if (request.method === 'GET') return json(response, 200, { data: await services.categories.detail(params[0]) }, corsHeaders)
        if (request.method === 'PATCH' || request.method === 'PUT') return json(response, 200, { data: await services.categories.update(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.categories.remove(params[0], user) }, corsHeaders)
      }

      if (request.method === 'GET' && pathname === '/api/products') return json(response, 200, await services.marketplace.products(searchParams), corsHeaders)
      if ((params = match(pathname, /^\/api\/products\/([^/]+)\/quotes$/)) && request.method === 'POST') return json(response, 201, { data: await services.products.requestQuote(params[0], await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/products\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.products.detail(params[0], searchParams) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/brands') return json(response, 200, await services.brands.list(searchParams), corsHeaders)
      if ((params = match(pathname, /^\/api\/brands\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.brands.detail(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/source') return json(response, 200, await services.source.list(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/source/filters') return json(response, 200, { data: await services.source.filters() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/source\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.source.detail(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/search') return json(response, 200, await services.search.query(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplace/feed') return json(response, 200, { data: await services.marketplace.feed(searchParams) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/buying-pools') return json(response, 200, await services.buyingPools.list(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/buying-pools/industries') return json(response, 200, { data: await services.buyingPools.industries() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/buying-pools/mine') return json(response, 200, { data: await services.buyingPools.mine(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/buying-pools') return json(response, 201, { data: await services.buyingPools.create(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/buying-pools\/([^/]+)\/join$/)) && request.method === 'POST') { const participation = await services.buyingPools.join(params[0], user); return json(response, 201, { data: participation, pool: await services.buyingPools.get(params[0], user) }, corsHeaders) }
      if ((params = match(pathname, /^\/api\/buying-pools\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.buyingPools.get(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces') return json(response, 200, { data: await services.marketplace.marketplaces() }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/marketplaces') return json(response, 201, { data: await services.marketplace.createMarketplace(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces/featured') { searchParams.set('featured','true'); return json(response, 200, await services.marketplace.marketplaceProducts(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/marketplaces/trending') { searchParams.set('sort','popular'); return json(response, 200, await services.marketplace.marketplaceProducts(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/marketplaces/categories') return json(response, 200, { data: (await services.marketplace.marketplaceOverview(searchParams.get('marketplace') || 'vehicles')).categories }, corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/marketplaces/products' || pathname === '/api/marketplaces/search')) return json(response, 200, await services.marketplace.marketplaceProducts(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces/sellers') return json(response, 200, { data: await services.marketplace.marketplaceSellers(searchParams.get('marketplace') || 'vehicles') }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces/recommendations') return json(response, 200, { data: (await services.marketplace.marketplaceOverview(searchParams.get('marketplace') || 'vehicles')).recommendations }, corsHeaders)
      if ((params = match(pathname, /^\/api\/marketplaces\/products\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.marketplace.marketplaceProduct(params[0]) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/marketplaces\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.marketplace.marketplaceOverview(params[0]) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/widgets\/(flash-sales|fast-selling|seller-promotions|auctions)$/)) && request.method === 'GET') return json(response, 200, await services.marketplace.widget(params[0], searchParams), corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/flash-sales' || pathname === '/api/flash-sales/search')) return json(response, 200, await services.flashSales.list(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/flash-sales/active') { searchParams.set('status', 'active'); return json(response, 200, await services.flashSales.list(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/flash-sales/upcoming') { searchParams.set('status', 'upcoming'); return json(response, 200, await services.flashSales.list(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/flash-sales/featured') { searchParams.set('featured', 'true'); return json(response, 200, await services.flashSales.list(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/flash-sales/categories') return json(response, 200, { data: await services.flashSales.categories() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/flash-sales/mine') return json(response, 200, { data: await services.flashSales.mine(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/flash-sales') return json(response, 201, { data: await services.flashSales.create(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/flash-sales\/([^/]+)\/publish$/)) && request.method === 'POST') return json(response, 200, { data: await services.flashSales.publish(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/flash-sales\/([^/]+)$/)) && request.method === 'PATCH') return json(response, 200, { data: await services.flashSales.update(params[0], await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/flash-sales\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.flashSales.cancel(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/flash-sales\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.flashSales.get(params[0]) }, corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/fast-selling' || pathname === '/api/fast-selling/search')) return json(response, 200, await services.fastSelling.list(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/fast-selling/featured') { searchParams.set('featured', 'true'); return json(response, 200, await services.fastSelling.list(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/fast-selling/categories') return json(response, 200, { data: await services.fastSelling.categories() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/fast-selling/sellers') return json(response, 200, { data: await services.fastSelling.sellers() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/fast-selling\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.fastSelling.get(params[0]) }, corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/sellers/promotions' || pathname === '/api/sellers/promotions/search')) return json(response, 200, await services.sellerPromotions.list(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/sellers/promotions/featured') { searchParams.set('featured', 'true'); return json(response, 200, await services.sellerPromotions.list(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/sellers/promotions/categories') return json(response, 200, { data: await services.sellerPromotions.categories() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/sellers/promotions/sellers') return json(response, 200, { data: await services.sellerPromotions.sellers() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/sellers\/promotions\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.sellerPromotions.get(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions') return json(response, 200, await services.auctions.list(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions/featured') return json(response, 200, { data: await services.auctions.featured(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions/upcoming') { searchParams.set('status', 'upcoming'); return json(response, 200, await services.auctions.list(searchParams, user), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/auctions/history') return json(response, 200, await services.auctions.history(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions/watchlist') return json(response, 200, { data: await services.auctions.watchlist(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/auctions/watchlist') { if (!user.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to manage your auction watchlist'); return json(response, 201, { data: await services.auctions.watch(await readJson(request), user) }, corsHeaders) }
      if ((params = match(pathname, /^\/api\/auctions\/watchlist\/([^/]+)$/)) && request.method === 'DELETE') { if (!user.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to manage your auction watchlist'); return json(response, 200, { data: await services.auctions.unwatch(params[0], user) }, corsHeaders) }
      if ((params = match(pathname, /^\/api\/auctions\/([^/]+)\/bids$/))) {
        if (request.method === 'GET') return json(response, 200, await services.auctions.bids(params[0], searchParams, user), corsHeaders)
        if (request.method === 'POST') {
          if (!user.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to place a bid')
          const result = await services.auctions.placeBid(params[0], await readJson(request), user, request.headers['idempotency-key'])
          return json(response, result.created ? 201 : 200, { data: result.auction, bid: result.bid }, corsHeaders)
        }
      }
      if ((params = match(pathname, /^\/api\/auctions\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.auctions.get(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auction-listings') return json(response, 200, await services.auctionListings.list(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/auction-listings') return json(response, 201, { data: await services.auctionListings.create(await readJson(request), user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/auction-listings/upload') return json(response, 201, { data: await services.auctionListings.upload(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/auction-listings\/([^/]+)\/preview$/)) && request.method === 'GET') return json(response, 200, { data: await services.auctionListings.preview(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/auction-listings\/([^/]+)\/publish$/)) && request.method === 'POST') return json(response, 200, { data: await services.auctionListings.publish(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/auction-listings\/([^/]+)$/))) {
        if (request.method === 'GET') return json(response, 200, { data: await services.auctionListings.get(params[0], user) }, corsHeaders)
        if (request.method === 'PUT' || request.method === 'PATCH' || request.method === 'POST') return json(response, 200, { data: await services.auctionListings.update(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.auctionListings.remove(params[0], user) }, corsHeaders)
      }

      if (request.method === 'GET' && (pathname === '/api/cart' || pathname === '/api/cart/summary')) return json(response, 200, { data: await services.cart.get(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/cart/items') return json(response, 201, { data: await services.cart.add(await readJson(request), await requireSessionUser(request, services)) }, corsHeaders)
      if (request.method === 'DELETE' && pathname === '/api/cart') return json(response, 200, { data: await services.cart.clear(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/cart/coupon') return json(response, 200, { data: await services.cart.coupon(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/cart/recommendations') return json(response, 200, { data: await services.cart.recommendations() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/cart\/items\/([^/]+)\/save$/)) && request.method === 'POST') return json(response, 200, { data: await services.cart.save(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/cart\/items\/([^/]+)$/))) {
        if (request.method === 'PATCH') return json(response, 200, { data: await services.cart.update(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.cart.remove(params[0], user) }, corsHeaders)
      }
      if (request.method === 'POST' && pathname === '/api/checkout') return json(response, 200, { data: await services.checkout.prepare(await readJson(request), user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/orders') {
        if (origin && !isAllowedOrigin(origin, allowedOrigin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')
        const sessionUser = await requireSessionUser(request, services)
        const result = await services.orders.create(await readJson(request), sessionUser, request.headers['idempotency-key'])
        return json(response, result.created ? 201 : 200, { data: result.order }, corsHeaders)
      }

      if (request.method === 'GET' && pathname === '/api/affiliate-program') return json(response, 200, { data: await services.affiliate.get() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/affiliate-program/application') return json(response, 200, { data: await services.affiliate.application(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/affiliate-program/applications') return json(response, 201, { data: await services.affiliate.apply(await readJson(request), user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/support/categories') return json(response, 200, await services.support.categories(), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/support/faqs') return json(response, 200, await services.support.faqs(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/support/tickets') return json(response, 200, await services.support.tickets(searchParams, user), corsHeaders)
      if (request.method === 'POST' && (pathname === '/api/support' || pathname === '/api/support/tickets')) {
        const result = await services.support.createTicket(await readJson(request), user, request.headers['idempotency-key'])
        return json(response, result.created ? 201 : 200, { data: result.ticket }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/support\/tickets\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.support.ticket(params[0], user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/community/messages') return json(response, 200, await services.community.list(searchParams), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/community/messages') return json(response, 201, { data: await services.community.post(await readJson(request), user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/chat/conversations') return json(response, 200, await services.chat.conversations(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/chat/conversations') return json(response, 201, { data: await services.chat.createConversation(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/chat\/conversations\/([^/]+)\/messages$/))) {
        if (request.method === 'GET') return json(response, 200, await services.chat.messages(params[0], searchParams, user), corsHeaders)
        if (request.method === 'POST') return json(response, 201, { data: await services.chat.send(params[0], await readJson(request), user) }, corsHeaders)
      }
      if (request.method === 'GET' && pathname === '/api/ask-amia') return json(response, 200, { data: await services.chat.overview(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/ask-amia/chat') return json(response, 201, { data: await services.chat.prompt(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/ask-amia/history' || pathname === '/api/ask-amia/conversations')) return json(response, 200, await services.chat.conversations(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/ask-amia/conversations') return json(response, 201, { data: await services.chat.createConversation(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/ask-amia/suggestions') return json(response, 200, { data: await services.chat.suggestions(user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/ask-amia\/conversations\/([^/]+)\/messages$/)) && request.method === 'GET') return json(response, 200, await services.chat.messages(params[0], searchParams, user), corsHeaders)
      if ((params = match(pathname, /^\/api\/ask-amia\/conversations\/([^/]+)$/))) {
        if (request.method === 'PATCH') return json(response, 200, { data: await services.chat.updateConversation(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.chat.deleteConversation(params[0], user) }, corsHeaders)
      }

      if (request.method === 'GET' && pathname === '/api/preferences') return json(response, 200, { data: await services.account.preferences(user) }, corsHeaders)
      if ((request.method === 'PUT' || request.method === 'PATCH') && pathname === '/api/preferences') return json(response, 200, { data: await services.account.updatePreferences(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account') return json(response, 200, { data: await services.account.profile(user) }, corsHeaders)
      if ((request.method === 'PUT' || request.method === 'PATCH') && pathname === '/api/account') return json(response, 200, { data: await services.account.updateProfile(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/preferences') return json(response, 200, { data: await services.account.preferences(user) }, corsHeaders)
      if ((request.method === 'PUT' || request.method === 'PATCH') && pathname === '/api/account/preferences') return json(response, 200, { data: await services.account.updatePreferences(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/security') return json(response, 200, { data: await services.account.security(user) }, corsHeaders)
      if ((request.method === 'PUT' || request.method === 'PATCH') && pathname === '/api/account/security') return json(response, 200, { data: await services.account.updateSecurity(await readJson(request), user) }, corsHeaders)
      if (request.method === 'PATCH' && pathname === '/api/account/password') return json(response, 200, { data: await services.account.changePassword(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/sessions') return json(response, 200, { data: await services.account.sessions(user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/sessions\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeSession(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/login-history') return json(response, 200, await services.account.loginHistory(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/security/logout-all') return json(response, 200, { data: await services.account.logoutAll(user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/account/addresses') return json(response, 200, await services.account.addresses(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/addresses') return json(response, 201, { data: await services.account.saveAddress(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/addresses\/([^/]+)$/))) {
        if (request.method === 'GET') return json(response, 200, { data: await services.account.address(params[0], user) }, corsHeaders)
        if (request.method === 'PUT' || request.method === 'PATCH') return json(response, 200, { data: await services.account.saveAddress(await readJson(request), user, params[0]) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.account.removeAddress(params[0], user) }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/account\/addresses\/([^/]+)\/default$/)) && (request.method === 'POST' || request.method === 'PATCH')) return json(response, 200, { data: await services.account.setDefaultAddress(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/shipping-addresses') return json(response, 200, await services.account.addresses(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/shipping-addresses') return json(response, 201, { data: await services.account.saveAddress(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/shipping-addresses\/([^/]+)$/))) {
        if (request.method === 'GET') return json(response, 200, { data: await services.account.address(params[0], user) }, corsHeaders)
        if (request.method === 'PUT' || request.method === 'PATCH') return json(response, 200, { data: await services.account.saveAddress(await readJson(request), user, params[0]) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.account.removeAddress(params[0], user) }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/account\/shipping-addresses\/([^/]+)\/default$/)) && (request.method === 'POST' || request.method === 'PATCH')) return json(response, 200, { data: await services.account.setDefaultAddress(params[0], user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/account/bank-accounts') return json(response, 200, await services.account.bankAccounts(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/bank-accounts') return json(response, 201, { data: await services.account.saveBankAccount(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/bank-accounts\/([^/]+)$/))) {
        if (request.method === 'PUT' || request.method === 'PATCH') return json(response, 200, { data: await services.account.saveBankAccount(await readJson(request), user, params[0]) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.account.removeBankAccount(params[0], user) }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/account\/bank-accounts\/([^/]+)\/default$/)) && request.method === 'POST') return json(response, 200, { data: await services.account.setDefaultBankAccount(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/bank') return json(response, 200, await services.account.bankAccounts(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/bank') return json(response, 201, { data: await services.account.saveBankAccount(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/bank\/([^/]+)$/))) {
        if (request.method === 'PUT' || request.method === 'PATCH') return json(response, 200, { data: await services.account.saveBankAccount(await readJson(request), user, params[0]) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.account.removeBankAccount(params[0], user) }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/account\/bank\/([^/]+)\/default$/)) && (request.method === 'POST' || request.method === 'PATCH')) return json(response, 200, { data: await services.account.setDefaultBankAccount(params[0], user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/account/orders') return json(response, 200, await services.account.orders(searchParams, user), corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/orders\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.account.order(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/orders') return json(response, 200, await services.orders.list(searchParams, await requireSessionUser(request, services)), corsHeaders)
      if ((params = match(pathname, /^\/api\/orders\/([^/]+)\/tracking$/)) && request.method === 'GET') return json(response, 200, { data: await services.account.tracking(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/orders\/([^/]+)\/invoice$/)) && request.method === 'GET') return json(response, 200, { data: await services.account.invoice(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/orders\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.orders.get(params[0], await requireSessionUser(request, services)) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/wishlist') return json(response, 200, await services.account.wishlist(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/wishlist') return json(response, 201, { data: await services.account.addWishlist(await readJson(request), user) }, corsHeaders)
      if (request.method === 'DELETE' && pathname === '/api/account/wishlist') return json(response, 200, { data: await services.account.clearWishlist(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/wishlist/count') return json(response, 200, { data: await services.account.wishlistCount(user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/wishlist\/([^/]+)\/move-to-cart$/)) && request.method === 'POST') return json(response, 200, { data: await services.account.moveWishlistToCart(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/wishlist\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeWishlist(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved') return json(response, 200, await services.account.saved(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/saved') return json(response, 201, { data: await services.account.saveItem(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved/status') return json(response, 200, { data: await services.account.savedStatus(searchParams, user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved/recommendations') return json(response, 200, { data: await services.account.savedRecommendations(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved/collections') return json(response, 200, { data: await services.account.collections(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/saved/collections') return json(response, 201, { data: await services.account.createCollection(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/collections\/([^/]+)\/items\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeCollectionItem(params[0], params[1], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/collections\/([^/]+)\/items$/)) && request.method === 'POST') return json(response, 200, { data: await services.account.addCollectionItem(params[0], await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/collections\/([^/]+)$/))) {
        if (request.method === 'PATCH') return json(response, 200, { data: await services.account.updateCollection(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.account.deleteCollection(params[0], user) }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/saved\/products\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeSavedProduct(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeWishlist(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/history') return json(response, 200, await services.account.history(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/history') return json(response, 201, { data: await services.account.recordHistory(await readJson(request), user) }, corsHeaders)
      if (request.method === 'DELETE' && pathname === '/api/account/history') return json(response, 200, { data: await services.account.clearHistory(user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/history\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeHistory(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/affiliate') return json(response, 200, { data: await services.account.affiliateDashboard(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/affiliate/link') return json(response, 200, { data: await services.account.affiliateProfile(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/notifications') return json(response, 200, await services.account.notifications(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/seller') return json(response, 200, { data: await services.seller.get(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/seller/application') return json(response, 201, { data: await services.seller.create(await readJson(request), user) }, corsHeaders)
      if (request.method === 'PATCH' && pathname === '/api/seller/application') return json(response, 200, { data: await services.seller.update(await readJson(request), user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/seller/application/submit') return json(response, 200, { data: await services.seller.submit(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/seller/status') return json(response, 200, { data: await services.seller.status(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/seller/documents') return json(response, 200, { data: await services.seller.documents(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/seller/documents') return json(response, 201, { data: await services.seller.addDocument(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/seller/profile') return json(response, 200, { data: await services.seller.profile(user) }, corsHeaders)
      if (request.method === 'PATCH' && pathname === '/api/seller/profile') return json(response, 200, { data: await services.seller.updateProfile(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/seller/dashboard') return json(response, 200, { data: await services.seller.dashboard(user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/sellers\/([^/]+)\/follow$/)) && request.method === 'POST') return json(response, 200, { data: await services.seller.follow(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/sellers\/([^/]+)\/follow$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.seller.unfollow(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/sellers\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.seller.publicProfile(params[0]) }, corsHeaders)

      throw new ApiError(404, 'NOT_FOUND', 'API endpoint not found')
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500
      if (status === 500) console.error(`[${requestId}]`, error)
      return json(response, status, {
        error: {
          code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof ApiError ? error.message : 'An unexpected error occurred',
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      }, corsHeaders)
    }
  }
}
