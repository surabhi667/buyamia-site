import { useEffect, useMemo, useState } from 'react'

const supplierHeaders = { 'Content-Type': 'application/json' }
const money = (value, currency = 'IDR') => new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
const blankForm = { title: '', productId: '', description: '', salePrice: '', remainingStock: '', startTime: '', endTime: '' }

async function api(url, options) {
  const response = await fetch(url, { credentials: 'include', ...(options || {}) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message || 'Unable to save this Flash Sale.')
  return payload
}

export default function CreateFlashSalePage() {
  const [supplier, setSupplier] = useState(null); const [products, setProducts] = useState([]); const [form, setForm] = useState(blankForm); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('')
  useEffect(() => { api('/api/flash-sales/mine', { headers: supplierHeaders }).then(({ data }) => { setSupplier(data.supplier); setProducts(data.products); setForm((current) => ({ ...current, productId: data.products[0]?.id || '' })) }).catch((error) => setMessage(error.message)).finally(() => setLoading(false)) }, [])
  const selectedProduct = useMemo(() => products.find((product) => product.id === form.productId), [form.productId, products])
  const discount = selectedProduct && Number(form.salePrice) > 0 ? Math.max(0, Math.round((1 - Number(form.salePrice) / selectedProduct.price) * 100)) : 0
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const { data } = await api('/api/flash-sales', { method: 'POST', headers: supplierHeaders, body: JSON.stringify({ ...form, salePrice: Number(form.salePrice), remainingStock: Number(form.remainingStock), publish: true }) })
      setMessage('Flash Sale published successfully.')
      setTimeout(() => window.location.assign(`/flash-sales/${data.id}`), 500)
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }
  return <main className="flash-page create-flash-page"><div className="category-breadcrumb shell"><a href="/flash-sales">Flash Sale</a><span>›</span>Create Flash Sale</div><section className="flash-hero shell"><p className="eyebrow">{supplier?.name || 'Supplier Flash Sales'}</p><h1>Create Flash Sale</h1><p>Choose one of your approved products and schedule a limited-time offer.</p></section><section className="flash-manager shell">{loading && <p className="flash-state">Loading your supplier catalog…</p>}{!loading && message && !products.length && <p className="flash-state flash-state--error">{message}</p>}{!loading && products.length > 0 && <form onSubmit={submit}><label>Flash Sale title<input required minLength="3" maxLength="120" value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="Summer furniture event" /></label><label>Product<select required value={form.productId} onChange={(event) => update('productId', event.target.value)}>{products.map((product) => <option value={product.id} key={product.id}>{product.title}</option>)}</select></label><div className="flash-product-summary"><img src={selectedProduct?.image} alt="" /><div><small>Original price</small><strong>{selectedProduct ? money(selectedProduct.price, selectedProduct.currency) : '—'}</strong><span>{discount > 0 ? `${discount}% discount` : 'Enter a sale price'}</span></div></div><label className="flash-manager-wide">Description<textarea required minLength="10" maxLength="1000" value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Describe this limited-time supplier offer." /></label><label>Flash Sale price (IDR)<input required type="number" min="1" max={selectedProduct ? selectedProduct.price - 1 : undefined} step="1" value={form.salePrice} onChange={(event) => update('salePrice', event.target.value)} /></label><label>Available quantity<input required type="number" min="1" max={selectedProduct?.stock || undefined} step="1" value={form.remainingStock} onChange={(event) => update('remainingStock', event.target.value)} /></label><label>Starts<input required type="datetime-local" value={form.startTime} onChange={(event) => update('startTime', event.target.value)} /></label><label>Ends<input required type="datetime-local" value={form.endTime} onChange={(event) => update('endTime', event.target.value)} /></label><div className="flash-manager-actions"><a href="/flash-sales">Cancel</a><button className="btn btn-charcoal" disabled={saving} type="submit">{saving ? 'Publishing…' : 'Publish Flash Sale'}</button></div>{message && <p className="flash-manager-message" role="status">{message}</p>}</form>}</section></main>
}
