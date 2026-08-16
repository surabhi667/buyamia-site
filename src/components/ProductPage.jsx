import { useEffect, useState } from 'react'

function money(value, currency = 'IDR') { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0) }
async function api(url, options = {}) { const response = await fetch(url, { credentials: 'include', ...options, headers: { ...(options.headers || {}) } }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || 'Unable to load product.'); return payload }
function requestAuth() { window.dispatchEvent(new CustomEvent('buyamia:auth-required', { detail: { mode: 'login' } })) }

function ProductCards({ items }) {
  return <div className="source-product-grid">{items.map((product) => <article key={product.id}><a href={`/products/${product.id}`}><img src={product.image} alt={product.title} /><strong>{product.title}</strong><span><small>Estimated Price</small><em>Try a little</em></span><b>{money(product.price, product.currency)}</b><footer>{product.categoryId?.replaceAll('-', ' ')}　 ☆ {product.rating}/5</footer></a></article>)}</div>
}

function Footer() {
  return <footer className="account-footer source-footer"><div className="logo">buyamia</div><p>Buy some comfort. Buy<br />some care.</p><div><small>SHOP</small><span>All Products</span><span>Furniture</span><span>Home Decor</span></div><div><small>ABOUT US</small><span>About Us</span><span>Sustainability</span><span>Sell on Buyamia</span></div><div><small>SUPPORT</small><span>Help Center</span><span>Contact Us</span><span>FAQ</span></div></footer>
}

export default function ProductPage({ id }) {
  const [product, setProduct] = useState(null); const [image, setImage] = useState(0); const [quantity, setQuantity] = useState(''); const [note, setNote] = useState(''); const [tab, setTab] = useState('general'); const [contextOpen, setContextOpen] = useState(false); const [submitting, setSubmitting] = useState(false); const [adding, setAdding] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [email, setEmail] = useState(''); const [subscribed, setSubscribed] = useState(false)
  useEffect(() => { const controller = new AbortController(); api(`/api/products/${encodeURIComponent(id)}`, { signal: controller.signal }).then((payload) => { setProduct(payload.data); setQuantity(String(payload.data.minimumOrder || 1)) }).catch((caught) => { if (caught.name !== 'AbortError') setError(caught.message) }); return () => controller.abort() }, [id])
  async function requestQuote() { setSubmitting(true); setMessage(''); try { const payload = await api(`/api/products/${encodeURIComponent(id)}/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: Number(quantity), note }) }); setMessage(`Quote request ${payload.data.id} was submitted.`) } catch (caught) { setMessage(caught.message) } finally { setSubmitting(false) } }
  async function addToCart() {
    const minimumOrder = product.minimumOrder || 1
    const selected = Number(quantity)
    if (!Number.isInteger(selected) || selected < minimumOrder) { setMessage(`Minimum order is ${minimumOrder} pcs`); return }
    setAdding(true)
    setMessage('')
    try {
      const response = await fetch('/api/cart/items', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, quantity: Math.max(1, selected / minimumOrder), packSize: minimumOrder }),
      })
      const payload = await response.json()
      if (response.status === 401) {
        requestAuth()
        throw new Error('Please log in or sign up to add items to your cart.')
      }
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to add this product to your cart.')
      window.dispatchEvent(new CustomEvent('buyamia:cart-updated', { detail: { cart: payload.data } }))
      setMessage('Added to cart')
    } catch (caught) {
      setMessage(caught.message)
    } finally {
      setAdding(false)
    }
  }
  if (error) return <main className="source-page shell"><p className="source-state source-state--error">{error}</p></main>
  if (!product) return <main className="source-page shell"><p className="source-state">Loading product…</p></main>
  const images = product.images?.length ? product.images : [product.image]
  return <main className="source-page product-page"><div className="source-shell"><section className="source-top"><div className="source-gallery"><img className="source-main-image" src={images[image]} alt={product.title} /><div>{images.map((url, index) => <button type="button" className={index === image ? 'is-active' : ''} onClick={() => setImage(index)} key={`${url}-${index}`}><img src={url} alt="" /></button>)}</div><div className="source-media-preview"><img src={images[0]} alt="" /><span>◁　▷</span><button className="product-context-trigger" onClick={() => setContextOpen(true)}>▣　AI Product Context</button></div></div><section className="source-summary"><h1>{product.title}</h1><div className="source-price"><small>Estimated Price</small><em>Try a little</em><strong>{money(product.price, product.currency)}</strong></div><p className="source-notice">◇　This product&apos;s price is fully negotiable. Submit a quote request to discuss discounts based on your specific needs and order quantity.</p><label className="source-quantity"><select value={quantity} onChange={(event) => setQuantity(event.target.value)}>{[1, 2, 5].map((multiple) => <option value={(product.minimumOrder || 1) * multiple} key={multiple}>{(product.minimumOrder || 1) * multiple} pcs</option>)}</select></label><label className="source-quantity"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write a note" maxLength="1000" /></label><div className="product-quote-actions"><button type="button" className="source-cart" disabled={adding} onClick={addToCart}>{adding ? 'Adding...' : 'Add to Cart'} <span>▷</span></button><button type="button" className="source-cart source-cart--secondary" disabled={submitting} onClick={requestQuote}>{submitting ? 'Submitting…' : 'Request Quote'} <span>▷</span></button><a href="/ask-amia">Other Questions</a></div>{message && <p className="source-action-message" role="status">{message}</p>}<div className="product-badges"><span>▣　Pre-Order</span><span>♢　Unique Product</span><span>⚒　Custom Product</span></div><section className="source-details"><h2>Product Details</h2><dl><dt>Minimum Order</dt><dd>{product.minimumOrder} pcs</dd><dt>Shipping</dt><dd>{product.shipping.join(' · ')}</dd><dt>Customization</dt><dd>{product.customization ? 'Yes' : 'No'}</dd><dt>Warranty</dt><dd>{product.warranty ? 'Yes' : 'No'}</dd><dt>Material</dt><dd>{product.material}</dd><dt>Dimensions</dt><dd>{product.dimensions}</dd><dt>Weight</dt><dd>{product.weight}</dd></dl></section><section className="product-impact"><h2>Impact</h2><div>{product.impactTags.map((tag, index) => <span className={index === 1 ? 'active' : index === 4 ? 'pink' : ''} key={tag}>{tag}</span>)}</div></section><section className="source-mini-related"><h2>From the same collection</h2><ProductCards items={product.collectionProducts} /></section></section></section>{contextOpen && <aside className="product-context"><header>▣　AI Product Context <button onClick={() => setContextOpen(false)}>×</button></header><div><h3>Product overview</h3><p>{product.description}</p><h3>Buyer guidance</h3><p>Ask Amia about quantities, customization, shipping, or how this piece can fit your sourcing brief.</p></div></aside>}<div className="source-breadcrumb">Home <span>›</span> {product.category?.name} <span>›</span> {product.title}</div></div><section className="source-general"><div className="source-shell"><nav>{[['general','General Information'],['product','Product Details'],['shipping','Shipping Information']].map(([key, label]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}</nav><p>{product.information[tab]}</p></div></section><section className="source-confidence source-shell"><p className="eyebrow">Quality Control &amp; Shipping</p><h2>Order with confidence</h2><div>{product.confidence.map((card) => <article key={card.id}><span>{card.id.includes('quality') ? '✓' : '▣'}</span><h3>{card.title}</h3><p>{card.summary}</p><p>{card.description}</p></article>)}</div></section><section className="source-rail source-shell"><header><div><p className="eyebrow">Related Products</p><h2>You might also like</h2></div><a href={`/categories?category=${product.categoryId}`}>Browse More　→</a></header><ProductCards items={product.relatedProducts} /></section><section className="product-maker source-shell"><div><p className="eyebrow">More from this maker</p><h2>{product.seller.name}</h2><div><span>{product.seller.location}</span><span>Verified maker</span></div><p>{product.seller.description}</p></div><div><ProductCards items={product.collectionProducts} /><a href={`/sellers/${product.seller.id}`}>Shop Maker　→</a></div></section><section className="source-rail source-shell"><header><div><p className="eyebrow">Bundles</p><h2>Shop curated packages</h2></div><a href="/categories">Browse More　→</a></header><ProductCards items={product.bundles} /></section><section className="source-newsletter" style={{ backgroundImage: "url('/assets/hero-field.jpeg')" }}><form onSubmit={(event) => { event.preventDefault(); setSubscribed(true) }}><h2>Stay in the loop.<br />Make a difference.</h2><p>New products, maker stories, sourcing insights, and trade news — delivered to your inbox.</p><div><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="john@email.com" required /><button>{subscribed ? 'Subscribed ✓' : 'Subscribe　✓'}</button></div></form></section><Footer /></main>
}
