import { useEffect, useState } from 'react'

const pageSize = 12

function viewedLabel(value) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function BrowsingHistoryPage() {
  const [items, setItems] = useState([]); const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 }); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('')
  async function load(page = 1) { setLoading(true); setMessage(''); try { const response = await fetch(`/api/account/history?page=${page}&limit=${pageSize}`, { credentials: 'include' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || 'Unable to load your browsing history.'); setItems(payload.data); setMeta(payload.meta) } catch (error) { setMessage(error.message) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  async function remove(id) { setMessage(''); try { const response = await fetch(`/api/account/history/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || 'Unable to remove this item.'); if (items.length === 1 && meta.page > 1) await load(meta.page - 1); else { setItems((current) => current.filter((item) => item.id !== id)); setMeta((current) => ({ ...current, total: current.total - 1 })) } } catch (error) { setMessage(error.message) } }
  async function clear() { setMessage(''); try { const response = await fetch('/api/account/history', { method: 'DELETE', credentials: 'include' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || 'Unable to clear browsing history.'); await load() } catch (error) { setMessage(error.message) } }
  const groups = items.reduce((result, item) => { const label = viewedLabel(item.viewedAt); (result[label] ||= []).push(item); return result }, {})
  return <main className="history-page shell"><header className="history-page__head"><div><p className="eyebrow">My Account</p><h1>Browsing <em>History</em></h1><p>Pick up where you left off with recently viewed items.</p></div>{Boolean(items.length) && <button type="button" className="history-clear" onClick={clear}>Clear all history</button>}</header>{loading && <p className="history-state">Loading browsing history…</p>}{!loading && message && <p className="history-state history-state--error">{message}</p>}{!loading && !message && !items.length && <p className="history-state">You have not viewed any items yet.</p>}{!loading && !message && Object.entries(groups).map(([label, group]) => <section className="history-group" key={label}><h2>{label}</h2><div>{group.map((item) => <article className="history-item" key={item.id}><a href={item.destinationUrl} className="history-item__link"><img src={item.thumbnail || '/assets/product-thumb.png'} alt="" /><span><small>{item.itemType}</small><strong>{item.title}</strong>{item.category && <em>{item.category}</em>}</span></a><button type="button" aria-label={`Remove ${item.title} from browsing history`} onClick={() => remove(item.id)}>Remove</button></article>)}</div></section>)}{!loading && !message && meta.pages > 1 && <nav className="history-pagination" aria-label="Browsing history pages"><button type="button" disabled={meta.page === 1} onClick={() => load(meta.page - 1)}>Previous</button><span>Page {meta.page} of {meta.pages}</span><button type="button" disabled={meta.page === meta.pages} onClick={() => load(meta.page + 1)}>Next</button></nav>}</main>
}
