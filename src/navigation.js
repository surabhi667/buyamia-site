export const shoppingRoute = '/categories'

export function routeForSearchResult(result) {
  if (!result || typeof result !== 'object') return shoppingRoute
  if (result.href && result.href !== '#') return result.href
  if (result.type === 'category' && result.id) return `/categories?category=${encodeURIComponent(result.id)}`
  if (result.type === 'product' && result.id) return `/products/${encodeURIComponent(result.id)}`
  if (result.type === 'auction' && result.id) return `/auctions/${encodeURIComponent(result.id)}`
  return shoppingRoute
}

export function navigateTo(path, targetWindow = window) {
  const next = new URL(path, targetWindow.location.origin)
  const current = `${targetWindow.location.pathname}${targetWindow.location.search}${targetWindow.location.hash}`
  const destination = `${next.pathname}${next.search}${next.hash}`
  if (destination !== current) targetWindow.history.pushState({}, '', destination)
  targetWindow.dispatchEvent(new Event('buyamia:navigate'))
  if (next.hash) targetWindow.document.querySelector(next.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  else targetWindow.scrollTo({ top: 0, behavior: 'smooth' })
}
