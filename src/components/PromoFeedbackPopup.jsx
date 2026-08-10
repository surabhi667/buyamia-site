import { useEffect, useRef, useState } from 'react'

const storageKey = 'buyamia-promo-feedback-v1'

export default function PromoFeedbackPopup() {
  const [open, setOpen] = useState(false); const [email, setEmail] = useState(''); const [feedback, setFeedback] = useState(''); const [status, setStatus] = useState('idle'); const [message, setMessage] = useState(''); const closeButton = useRef(null)
  useEffect(() => {
    let dismissed = false
    try { dismissed = Boolean(window.localStorage.getItem(storageKey)) } catch { dismissed = false }
    if (dismissed) return
    const timer = window.setTimeout(() => setOpen(true), 650)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; closeButton.current?.focus()
    const escape = (event) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('keydown', escape)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', escape) }
  }, [open])
  const remember = (value) => { try { window.localStorage.setItem(storageKey, value) } catch { /* Storage can be unavailable in private browsing. */ } }
  const dismiss = () => { remember('dismissed'); setOpen(false) }
  const submit = async (event) => {
    event.preventDefault(); setStatus('submitting'); setMessage('')
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, feedback }) }); const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to submit your feedback.')
      setStatus('success'); setMessage('Thank you. Your feedback has been received.'); remember('completed'); window.setTimeout(() => setOpen(false), 1200)
    } catch (error) { setStatus('error'); setMessage(error.message) }
  }
  if (!open) return null
  return <div className="promo-feedback-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss() }}><section className="promo-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="promo-feedback-title"><div className="promo-feedback-visual"><span>b</span></div><div className="promo-feedback-content"><button ref={closeButton} className="promo-feedback-close" type="button" onClick={dismiss} aria-label="Close feedback popup">×</button><h2 id="promo-feedback-title">Help us serve<br />you better</h2><p>We’re always working to make Buyamia a better experience. Tell us what’s working and what isn’t — your feedback goes directly to the people building the platform.</p><p>As a thank you, you’ll receive <em>10% off your next purchase</em> once you complete this short survey.</p><hr /><form onSubmit={submit}><label><span className="visually-hidden">Email address</span><input required type="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="john@email.com" /></label><label><span className="visually-hidden">Feedback</span><textarea required minLength="10" maxLength="2000" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="How could we serve you better?…" /></label><button type="submit" disabled={status === 'submitting'}>{status === 'submitting' ? 'Submitting…' : 'Submit'}<span>▷</span></button></form>{message && <p className={`promo-feedback-message ${status}`} role="status">{message}</p>}</div></section></div>
}
