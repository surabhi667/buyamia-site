import { useEffect, useState } from 'react'

const emptyTicket = { title: '', description: '', categoryId: '', priority: 'normal' }
function requestAuth() { window.dispatchEvent(new CustomEvent('buyamia:auth-required', { detail: { mode: 'login' } })) }

export default function SupportPage() {
  const [categories, setCategories] = useState([])
  const [faqs, setFaqs] = useState([])
  const [tickets, setTickets] = useState([])
  const [ticket, setTicket] = useState(emptyTicket)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [faqQuery, setFaqQuery] = useState('')

  async function load() {
    const [categoryResponse, faqResponse, ticketResponse] = await Promise.all(['/api/support/categories', '/api/support/faqs?limit=6', '/api/support/tickets?limit=5'].map((url) => fetch(url, { credentials: 'include' })))
    const [categoryPayload, faqPayload, ticketPayload] = await Promise.all([categoryResponse, faqResponse, ticketResponse].map((response) => response.json()))
    if (!categoryResponse.ok || !faqResponse.ok) throw new Error(categoryPayload.error?.message || faqPayload.error?.message || 'Unable to load support.')
    setCategories(categoryPayload.data)
    setFaqs(faqPayload.data)
    setTickets(ticketResponse.ok ? ticketPayload.data : [])
  }

  useEffect(() => {
    load().then(() => setStatus('ready')).catch((error) => { setMessage(error.message); setStatus('error') })
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !window.location.hash) return
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
  }, [status])

  async function searchFaqs(event) {
    const value = event.target.value
    setFaqQuery(value)
    try {
      const response = await fetch(`/api/support/faqs?limit=6&q=${encodeURIComponent(value)}`, { credentials: 'include' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message)
      setFaqs(payload.data)
    } catch (error) { setMessage(error.message || 'Unable to search FAQs.') }
  }

  async function submit(event) {
    event.preventDefault()
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/support/tickets', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ticket) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to submit your request.')
      setTickets((current) => [payload.data, ...current])
      setTicket(emptyTicket)
      setMessage('Your support request has been submitted.')
      setStatus('ready')
    } catch (error) { if (error.message.includes('Sign in') || error.message.includes('Authentication')) requestAuth(); setMessage(error.message || 'Unable to submit your request.'); setStatus('ready') }
  }

  return <main className="support-page shell">
    <section className="support-intro"><p className="eyebrow">Support</p><h1>How can we <em>help?</em></h1><p>Find an answer, review your requests, or send our team a message.</p></section>
    <section className="support-grid">
      <form className="support-form" id="contact" onSubmit={submit}>
        <h2>Send a request</h2>
        <label>Subject<input value={ticket.title} onChange={(event) => setTicket({ ...ticket, title: event.target.value })} maxLength="160" required /></label>
        <label>Category<select value={ticket.categoryId} onChange={(event) => setTicket({ ...ticket, categoryId: event.target.value })} required><option value="">Select a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>Priority<select value={ticket.priority} onChange={(event) => setTicket({ ...ticket, priority: event.target.value })}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label>
        <label>Description<textarea value={ticket.description} onChange={(event) => setTicket({ ...ticket, description: event.target.value })} minLength="10" maxLength="4000" required /></label>
        {message && <p className={`support-message${message.includes('submitted') ? ' is-success' : ''}`}>{message}</p>}
        <button className="btn btn-charcoal" type="submit" disabled={status === 'loading' || status === 'saving'}>{status === 'saving' ? 'Sending…' : 'Submit request'}</button>
      </form>
      <aside className="support-tickets"><h2>Your requests</h2>{status === 'loading' && <p>Loading requests…</p>}{status !== 'loading' && tickets.length === 0 && <p>No support requests yet.</p>}{tickets.map((item) => <article key={item.id}><span><small>{item.status}</small><strong>{item.title}</strong></span><time>{new Date(item.updatedAt).toLocaleDateString()}</time></article>)}</aside>
    </section>
    <section className="support-faq" id="faq"><div><p className="eyebrow">Help Centre</p><h2>Frequently asked questions</h2></div><label className="support-faq-search"><span className="visually-hidden">Search FAQs</span><input value={faqQuery} onChange={searchFaqs} placeholder="Search help topics" /></label><div className="support-faq-list">{faqs.length ? faqs.map((faq) => <details key={faq.id}><summary>{faq.question}</summary><p>{faq.answer}</p></details>) : <p>No FAQ results found.</p>}</div></section>
  </main>
}
