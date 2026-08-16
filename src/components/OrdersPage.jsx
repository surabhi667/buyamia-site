import { useEffect, useState } from 'react'

const statusOptions = [
  ['', 'All orders'],
  ['pending_payment', 'Payment pending'],
  ['order_received', 'Order received'],
  ['processing', 'Processing'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
]

const formatMoney = (value, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value || 0)

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : ''
}

export default function OrdersPage() {
  const initialId = window.location.pathname.match(/^\/account\/orders\/([^/]+)$/)?.[1] || ''
  const [orders, setOrders] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState('')

  async function api(url, options) {
    const response = await fetch(url, { credentials: 'include', ...(options || {}) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error?.message || 'Unable to load orders.')
    return payload
  }

  async function load(status = '') {
    const payload = await api(`/api/orders?limit=20${status ? `&status=${encodeURIComponent(status)}` : ''}`)
    setOrders(payload.data)
    return payload.data
  }

  async function select(id) {
    setDetailsLoading(true)
    setMessage('')
    try {
      const payload = await api(`/api/orders/${encodeURIComponent(id)}`)
      setSelected(payload.data)
      if (window.location.pathname !== `/account/orders/${id}`) window.history.replaceState(null, '', `/account/orders/${id}`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setDetailsLoading(false)
    }
  }

  useEffect(() => {
    load()
      .then((rows) => {
        if (initialId) select(initialId)
        else if (rows[0]) select(rows[0].id)
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false))
  }, [initialId])

  async function changeFilter(value) {
    setFilter(value)
    setLoading(true)
    setSelected(null)
    setMessage('')
    try {
      const rows = await load(value)
      if (rows[0]) await select(rows[0].id)
      else if (window.location.pathname !== '/account/orders') window.history.replaceState(null, '', '/account/orders')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  return <main className="orders-page shell"><section className="orders-page__head"><p className="eyebrow">My Account</p><h1>My <em>Orders</em></h1><p>Review your orders, delivery progress, and payment details.</p></section><div className="orders-toolbar"><label>Status<select value={filter} onChange={(event) => changeFilter(event.target.value)}>{statusOptions.map(([value, label]) => <option value={value} key={value || 'all'}>{label}</option>)}</select></label></div><div className="orders-layout"><section className="orders-list"><h2>Order history</h2>{loading && <p>Loading orders…</p>}{!loading && !orders.length && <p>No orders found.</p>}{orders.map((order) => <button type="button" className={selected?.id === order.id ? 'is-selected' : ''} onClick={() => select(order.id)} key={order.id}><span><small>{order.statusLabel || order.status}</small><strong>{order.orderNumber}</strong><em>{formatDate(order.createdAt)}</em><em>{order.itemCount || order.items?.length || 0} items</em></span><b>{formatMoney(order.total, order.currency)}</b><small className="orders-view">View</small></button>)}</section><section className="order-details">{detailsLoading && <p>Loading order details…</p>}{!detailsLoading && !selected && <p>Select an order to see its details.</p>}{!detailsLoading && selected && <><header><div><small>{selected.statusLabel || selected.status}</small><h2>{selected.orderNumber}</h2><p>Placed {formatDate(selected.createdAt)}</p></div><strong>{formatMoney(selected.total, selected.currency)}</strong></header><div className="order-items">{selected.items.map((item) => <article key={item.id || item.productId}><img src={item.product?.image || item.image} alt="" /><span><strong>{item.product?.title || item.title || 'Product'}</strong><small>Quantity {item.quantity} · {item.packSize * item.quantity} pcs</small></span><b>{formatMoney(item.lineTotal ?? item.unitPrice * item.quantity, selected.currency)}</b></article>)}</div><div className="order-detail-grid"><section><h3>Delivery</h3><p>{selected.shipping?.service || 'Shipping to be confirmed'}<br />{selected.shippingAddress?.line1 || 'Address to be confirmed'}<br />{[selected.shippingAddress?.city, selected.shippingAddress?.country].filter(Boolean).join(', ')}</p></section><section><h3>Payment</h3><p>{selected.payment?.label || 'Payment pending'}<br />No card has been charged.</p></section></div><section className="order-timeline"><h3>Order timeline</h3>{selected.timeline.map((entry) => <p className={entry.reached ? '' : 'is-pending'} key={entry.status}><span />{entry.label || entry.status}<small>{entry.at ? formatDate(entry.at) : 'Pending'}</small></p>)}</section><footer><span>Subtotal <b>{formatMoney(selected.subtotal, selected.currency)}</b></span><span>Delivery <b>{formatMoney(selected.shippingCost, selected.currency)}</b></span><span>Sale <b>- {formatMoney(selected.discount || 0, selected.currency)}</b></span><span>Taxes <b>{formatMoney(selected.taxes, selected.currency)}</b></span><strong>Total <b>{formatMoney(selected.total, selected.currency)}</b></strong></footer></>}</section></div>{message && <p className="orders-message">{message}</p>}</main>
}
