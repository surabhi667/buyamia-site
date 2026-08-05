import { createServices, ApiError } from './services.js'

const bodyLimit = 512 * 1024

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
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body contains invalid JSON')
  }
}

function userFrom(request) {
  const id = String(request.headers['x-user-id'] || request.headers['x-session-id'] || 'demo-user').slice(0, 120)
  const name = String(request.headers['x-user-name'] || 'Buyamia Guest').slice(0, 80)
  return { id, name, avatar: '/assets/avatar-1.png' }
}

function match(pathname, pattern) {
  const result = pathname.match(pattern)
  return result ? result.slice(1).map(decodeURIComponent) : null
}

export function createApp(store, { allowedOrigin = 'http://127.0.0.1:5173' } = {}) {
  const services = createServices(store)

  return async function app(request, response) {
    const requestId = store.id('request')
    const origin = request.headers.origin
    const corsHeaders = origin && (origin === allowedOrigin || origin === 'http://localhost:5173')
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}

    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-User-Name, X-Session-Id' })
        return response.end()
      }

      const url = new URL(request.url, 'http://localhost')
      const { pathname, searchParams } = url
      const user = userFrom(request)
      let params

      if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok', service: 'buyamia-api', timestamp: new Date().toISOString() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/about') return json(response, 200, { data: await services.about.get() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/about\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.about.section(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/categories') return json(response, 200, await services.categories.list(searchParams), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/categories') return json(response, 201, { data: await services.categories.create(await readJson(request)) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/categories\/([^/]+)\/products$/)) && request.method === 'GET') return json(response, 200, await services.categories.products(params[0], searchParams), corsHeaders)
      if ((params = match(pathname, /^\/api\/categories\/([^/]+)$/))) {
        if (request.method === 'GET') return json(response, 200, { data: await services.categories.detail(params[0]) }, corsHeaders)
        if (request.method === 'PATCH' || request.method === 'PUT') return json(response, 200, { data: await services.categories.update(params[0], await readJson(request)) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.categories.remove(params[0]) }, corsHeaders)
      }

      if (request.method === 'GET' && pathname === '/api/products') return json(response, 200, await services.marketplace.products(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/brands') return json(response, 200, await services.brands.list(searchParams), corsHeaders)
      if ((params = match(pathname, /^\/api\/brands\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.brands.detail(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/source') return json(response, 200, await services.source.list(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/source/filters') return json(response, 200, { data: await services.source.filters() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/source\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.source.detail(params[0]) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/search') return json(response, 200, await services.search.query(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplace/feed') return json(response, 200, { data: await services.marketplace.feed(searchParams) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces') return json(response, 200, { data: await services.marketplace.marketplaces() }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces/featured') { searchParams.set('featured','true'); return json(response, 200, await services.marketplace.marketplaceProducts(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/marketplaces/trending') { searchParams.set('sort','popular'); return json(response, 200, await services.marketplace.marketplaceProducts(searchParams), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/marketplaces/categories') return json(response, 200, { data: (await services.marketplace.marketplaceOverview(searchParams.get('marketplace') || 'vehicles')).categories }, corsHeaders)
      if (request.method === 'GET' && (pathname === '/api/marketplaces/products' || pathname === '/api/marketplaces/search')) return json(response, 200, await services.marketplace.marketplaceProducts(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces/sellers') return json(response, 200, { data: await services.marketplace.marketplaceSellers(searchParams.get('marketplace') || 'vehicles') }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/marketplaces/recommendations') return json(response, 200, { data: (await services.marketplace.marketplaceOverview(searchParams.get('marketplace') || 'vehicles')).recommendations }, corsHeaders)
      if ((params = match(pathname, /^\/api\/marketplaces\/products\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.marketplace.marketplaceProduct(params[0]) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/marketplaces\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.marketplace.marketplaceOverview(params[0]) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/widgets\/(flash-sales|fast-selling|seller-promotions|auctions)$/)) && request.method === 'GET') return json(response, 200, await services.marketplace.widget(params[0], searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions') return json(response, 200, await services.auctions.list(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions/featured') return json(response, 200, { data: await services.auctions.featured(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions/upcoming') { searchParams.set('status', 'upcoming'); return json(response, 200, await services.auctions.list(searchParams, user), corsHeaders) }
      if (request.method === 'GET' && pathname === '/api/auctions/history') return json(response, 200, await services.auctions.history(searchParams, user), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/auctions/watchlist') return json(response, 200, { data: await services.auctions.watchlist(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/auctions/watchlist') return json(response, 201, { data: await services.auctions.watch(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/auctions\/watchlist\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.auctions.unwatch(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/auctions\/([^/]+)\/bids$/))) {
        if (request.method === 'GET') return json(response, 200, await services.auctions.bids(params[0], searchParams, user), corsHeaders)
        if (request.method === 'POST') return json(response, 201, { data: await services.auctions.placeBid(params[0], await readJson(request), user) }, corsHeaders)
      }
      if ((params = match(pathname, /^\/api\/auctions\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.auctions.get(params[0], user) }, corsHeaders)

      if (request.method === 'GET' && (pathname === '/api/cart' || pathname === '/api/cart/summary')) return json(response, 200, { data: await services.cart.get(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/cart/items') return json(response, 201, { data: await services.cart.add(await readJson(request), user) }, corsHeaders)
      if (request.method === 'DELETE' && pathname === '/api/cart') return json(response, 200, { data: await services.cart.clear(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/cart/coupon') return json(response, 200, { data: await services.cart.coupon(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/cart/recommendations') return json(response, 200, { data: await services.cart.recommendations() }, corsHeaders)
      if ((params = match(pathname, /^\/api\/cart\/items\/([^/]+)\/save$/)) && request.method === 'POST') return json(response, 200, { data: await services.cart.save(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/cart\/items\/([^/]+)$/))) {
        if (request.method === 'PATCH') return json(response, 200, { data: await services.cart.update(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.cart.remove(params[0], user) }, corsHeaders)
      }
      if (request.method === 'POST' && pathname === '/api/checkout') return json(response, 200, { data: await services.checkout.prepare(await readJson(request), user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/affiliate-program') return json(response, 200, { data: await services.affiliate.get() }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/affiliate-program/applications') return json(response, 201, { data: await services.affiliate.apply(await readJson(request), user) }, corsHeaders)

      if (request.method === 'GET' && pathname === '/api/support/categories') return json(response, 200, await services.support.categories(), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/support/faqs') return json(response, 200, await services.support.faqs(searchParams), corsHeaders)
      if (request.method === 'GET' && pathname === '/api/support/tickets') return json(response, 200, await services.support.tickets(searchParams, user), corsHeaders)
      if (request.method === 'POST' && (pathname === '/api/support' || pathname === '/api/support/tickets')) return json(response, 201, { data: await services.support.createTicket(await readJson(request), user) }, corsHeaders)
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
      if (request.method === 'GET' && pathname === '/api/orders') return json(response, 200, await services.account.orders(searchParams, user), corsHeaders)
      if ((params = match(pathname, /^\/api\/orders\/([^/]+)\/tracking$/)) && request.method === 'GET') return json(response, 200, { data: await services.account.tracking(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/orders\/([^/]+)\/invoice$/)) && request.method === 'GET') return json(response, 200, { data: await services.account.invoice(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/orders\/([^/]+)$/)) && request.method === 'GET') return json(response, 200, { data: await services.account.order(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/wishlist') return json(response, 200, await services.account.wishlist(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/account/wishlist') return json(response, 201, { data: await services.account.addWishlist(await readJson(request), user) }, corsHeaders)
      if (request.method === 'DELETE' && pathname === '/api/account/wishlist') return json(response, 200, { data: await services.account.clearWishlist(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/account/wishlist/count') return json(response, 200, { data: await services.account.wishlistCount(user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/wishlist\/([^/]+)\/move-to-cart$/)) && request.method === 'POST') return json(response, 200, { data: await services.account.moveWishlistToCart(params[0], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/account\/wishlist\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeWishlist(params[0], user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved') return json(response, 200, await services.account.saved(searchParams, user), corsHeaders)
      if (request.method === 'POST' && pathname === '/api/saved') return json(response, 201, { data: await services.account.saveItem(await readJson(request), user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved/recommendations') return json(response, 200, { data: await services.account.savedRecommendations(user) }, corsHeaders)
      if (request.method === 'GET' && pathname === '/api/saved/collections') return json(response, 200, { data: await services.account.collections(user) }, corsHeaders)
      if (request.method === 'POST' && pathname === '/api/saved/collections') return json(response, 201, { data: await services.account.createCollection(await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/collections\/([^/]+)\/items\/([^/]+)$/)) && request.method === 'DELETE') return json(response, 200, { data: await services.account.removeCollectionItem(params[0], params[1], user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/collections\/([^/]+)\/items$/)) && request.method === 'POST') return json(response, 200, { data: await services.account.addCollectionItem(params[0], await readJson(request), user) }, corsHeaders)
      if ((params = match(pathname, /^\/api\/saved\/collections\/([^/]+)$/))) {
        if (request.method === 'PATCH') return json(response, 200, { data: await services.account.updateCollection(params[0], await readJson(request), user) }, corsHeaders)
        if (request.method === 'DELETE') return json(response, 200, { data: await services.account.deleteCollection(params[0], user) }, corsHeaders)
      }
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
