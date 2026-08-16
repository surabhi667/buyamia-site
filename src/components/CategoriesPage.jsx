import { useEffect, useState } from 'react'

function money(value, currency) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value || 0) }
const emptyFilters = { styles: [], moods: [], room: '', colors: [], minPrice: '', maxPrice: '' }

function requestAuth() {
  window.dispatchEvent(new CustomEvent('buyamia:auth-required', { detail: { mode: 'login' } }))
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState([])
  const [selected, setSelected] = useState(null)
  const [products, setProducts] = useState([])
  const [available, setAvailable] = useState(null)
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 })
  const [sort, setSort] = useState('featured')
  const [filters, setFilters] = useState(emptyFilters)
  const [draftFilters, setDraftFilters] = useState(emptyFilters)
  const [subcategory, setSubcategory] = useState('')
  const [premium, setPremium] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [subcategoryOpen, setSubcategoryOpen] = useState(false)
  const [view, setView] = useState('grid')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [cartAction, setCartAction] = useState({ productId: '', status: 'idle', message: '' })

  useEffect(() => {
    fetch('/api/categories?limit=100')
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Unable to load categories.')
        setCategories(payload.data)
        const requested = new URLSearchParams(window.location.search).get('category')
        const category = payload.data.find((item) => item.id === requested || item.slug === requested) || payload.data.find((item) => item.slug === 'furniture') || payload.data[0]
        setSelected(category || null)
      })
      .catch((error) => { setMessage(error.message); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!selected) return undefined
    const controller = new AbortController()
    setLoading(true)
    setMessage('')
    const query = new URLSearchParams({ limit: '24', page: String(page), sort })
    if (subcategory) query.set('subcategory', subcategory)
    if (premium) query.set('premium', 'true')
    if (filters.room) query.set('room', filters.room)
    if (filters.minPrice !== '') query.set('minPrice', filters.minPrice)
    if (filters.maxPrice !== '') query.set('maxPrice', filters.maxPrice)
    filters.styles.forEach((item) => query.append('style', item))
    filters.moods.forEach((item) => query.append('mood', item))
    filters.colors.forEach((item) => query.append('color', item))
    fetch(`/api/categories/${encodeURIComponent(selected.id)}/products?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Unable to load category products.')
        setProducts(payload.data)
        setMeta(payload.meta)
        setAvailable(payload.availableFilters)
      })
      .catch((error) => { if (error.name !== 'AbortError') setMessage(error.message) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [selected, sort, filters, subcategory, premium, page])

  function switchCategory(category) {
    setSelected(category)
    setPage(1)
    setFilters(emptyFilters)
    setDraftFilters(emptyFilters)
    setSubcategory('')
    setPremium(false)
    setSubcategoryOpen(false)
    setCartAction({ productId: '', status: 'idle', message: '' })
  }

  function toggleDraft(field, value) {
    setDraftFilters((current) => ({ ...current, [field]: current[field].includes(value) ? current[field].filter((item) => item !== value) : [...current[field], value] }))
  }

  function applyFilters() {
    setFilters(draftFilters)
    setPage(1)
    setFilterOpen(false)
  }

  async function addToCart(product) {
    if (cartAction.status === 'loading') return
    setCartAction({ productId: product.id, status: 'loading', message: '' })
    try {
      const response = await fetch('/api/cart/items', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, quantity: 1 }),
      })
      const payload = await response.json()
      if (response.status === 401) {
        requestAuth()
        throw new Error('Please log in or sign up to add items to your cart.')
      }
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to add this product to your cart.')
      window.dispatchEvent(new CustomEvent('buyamia:cart-updated', { detail: { cart: payload.data } }))
      setCartAction({ productId: product.id, status: 'success', message: 'Added to cart' })
    } catch (error) {
      setCartAction({ productId: product.id, status: 'error', message: error.message })
    }
  }

  const colorMap = { white:'#fff',cream:'#f7f3da',yellow:'#fff8b5',beige:'#c9c29e',gray:'#d2d4d7',silver:'#aaa',black:'#000',tan:'#d7b47f',orange:'#b86a28',brown:'#70462d','dark-brown':'#4b3027',red:'#c5463c',gold:'#e99a13',olive:'#637934',green:'#258c35',pink:'#e6b8b8',blue:'#79d8f6','royal-blue':'#3975e9',lime:'#d3e900','bright-yellow':'#ffdb00',purple:'#d548d8',magenta:'#d82ad8' }

  return <main className="categories-page"><div className="category-breadcrumb shell">Home <span>›</span> {selected?.name || 'Categories'}</div><section className="category-hero shell"><img src="/assets/category-bg.png" alt="" /><h1>Wholesale <em>{selected?.name || 'Categories'}</em></h1></section><section className="category-intro shell"><p>Quality pieces built to last, priced for volume. Browse commercial-grade furniture that holds up in high-traffic spaces without the markup.</p></section><section className="category-catalog shell"><div className="category-toolbar category-toolbar--filters"><div><button type="button" onClick={() => { setDraftFilters(filters); setFilterOpen((value) => !value); setSubcategoryOpen(false) }}>All Filters　☷</button><button type="button" className={premium ? 'is-active' : ''} onClick={() => { setPremium((value) => !value); setPage(1) }}>Premium</button><div className="subcategory-control"><button type="button" className={subcategory ? 'is-active' : ''} onClick={() => { setSubcategoryOpen((value) => !value); setFilterOpen(false) }}>{subcategory || 'Sub-Categories'}　⌄</button>{subcategoryOpen && <div className="subcategory-menu"><button onClick={() => { setSubcategory(''); setSubcategoryOpen(false) }}>→　All products</button>{available?.subcategories.map((item) => <button onClick={() => { setSubcategory(item); setSubcategoryOpen(false); setPage(1) }} key={item}>→　{item}</button>)}</div>}</div></div><div><span>{meta.total} Items</span><label>Sort By<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>{available?.sorting.map((item) => <option value={item.id} key={item.id}>{item.name}</option>) || <option value="featured">Featured</option>}</select></label><button className={view === 'comfortable' ? 'is-active' : ''} onClick={() => setView('comfortable')}>♙</button><button className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')}>⠿</button></div></div>{filterOpen && available && <aside className="category-filter-panel"><header><h2>Filters</h2><button onClick={() => setFilterOpen(false)}>×</button></header><section><h3>⌄　Style</h3><div>{available.styles.map((item) => <label key={item}><input type="checkbox" checked={draftFilters.styles.includes(item)} onChange={() => toggleDraft('styles', item)} />{item}</label>)}</div></section><section><h3>⌄　Mood</h3><div>{available.moods.map((item) => <label key={item}><input type="checkbox" checked={draftFilters.moods.includes(item)} onChange={() => toggleDraft('moods', item)} />{item}</label>)}</div></section><section><h3>⌄　Price</h3><div className="category-price"><label>From<input type="number" min="0" value={draftFilters.minPrice} onChange={(event) => setDraftFilters((current) => ({ ...current, minPrice: event.target.value }))} placeholder="0 IDR" /></label><label>To<input type="number" min="0" value={draftFilters.maxPrice} onChange={(event) => setDraftFilters((current) => ({ ...current, maxPrice: event.target.value }))} placeholder="10,000 IDR" /></label></div></section><section><h3>⌄　Room</h3><select value={draftFilters.room} onChange={(event) => setDraftFilters((current) => ({ ...current, room: event.target.value }))}><option value="">Choose a room</option>{available.rooms.map((item) => <option key={item}>{item}</option>)}</select></section><section><h3>⌄　Color</h3><div className="category-colors">{available.colors.map((item) => <button type="button" className={draftFilters.colors.includes(item) ? 'active' : ''} style={{ background: colorMap[item] }} onClick={() => toggleDraft('colors', item)} aria-label={item} key={item} />)}</div></section><button className="category-apply" onClick={applyFilters}>Apply <span>✓</span></button></aside>}<div className={`category-results${filterOpen ? ' has-filter' : ''}`}>{loading && <p className="category-state">Loading products…</p>}{!loading && message && <p className="category-state category-state--error">{message}</p>}{!loading && !message && !products.length && <p className="category-state">No products found in this category.</p>}{!loading && Boolean(products.length) && <div className={`category-product-grid${view === 'comfortable' ? ' comfortable' : ''}`}>{products.map((product) => <article className="category-product-card" key={product.id}><a href={`/products/${product.id}`}><img src={product.image} alt={product.title} /><h2>{product.title}</h2><small>♧ Try a little</small><strong>{money(product.price, product.currency)}</strong><footer><span>{product.subcategory}</span><span>★ {product.rating}/5</span></footer></a><button type="button" className="category-cart-button" disabled={cartAction.status === 'loading' && cartAction.productId === product.id} onClick={() => addToCart(product)}>{cartAction.status === 'loading' && cartAction.productId === product.id ? 'Adding...' : 'Add to Cart'}</button>{cartAction.productId === product.id && cartAction.message && <p className={`category-cart-message ${cartAction.status === 'error' ? 'is-error' : ''}`} role={cartAction.status === 'error' ? 'alert' : 'status'}>{cartAction.message}</p>}</article>)}</div>}{meta.pages > 1 && <nav className="saved-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page} of {meta.pages}</span><button disabled={page >= meta.pages} onClick={() => setPage(page + 1)}>Next →</button></nav>}</div><nav className="category-switcher" aria-label="Browse categories">{categories.map((category) => <button className={category.id === selected?.id ? 'active' : ''} onClick={() => switchCategory(category)} key={category.id}>{category.name}</button>)}</nav></section></main>
}
