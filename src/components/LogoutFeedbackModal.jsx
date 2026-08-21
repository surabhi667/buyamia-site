import { useEffect, useRef, useState } from 'react'

const ratings = [
  { value: 'BAD', emoji: '😞', label: 'Bad' },
  { value: 'OKAY', emoji: '😐', label: 'Okay' },
  { value: 'GOOD', emoji: '🙂', label: 'Good' },
  { value: 'GREAT', emoji: '🤩', label: 'Great' },
]

const reasons = [
  { value: 'EASY_TO_USE', label: 'Easy to use' },
  { value: 'GOOD_PRODUCTS', label: 'Good products' },
  { value: 'USEFUL_FEATURES', label: 'Useful features' },
  { value: 'FAST_EXPERIENCE', label: 'Fast experience' },
  { value: 'HARD_TO_NAVIGATE', label: 'Hard to navigate' },
  { value: 'COULD_NOT_FIND', label: "Couldn't find what I needed" },
  { value: 'TECHNICAL_ISSUE', label: 'Technical issue' },
  { value: 'OTHER', label: 'Other' },
]

export default function LogoutFeedbackModal({ open, busy, onClose, onSkip, onSubmit }) {
  const [rating, setRating] = useState('')
  const [selectedReasons, setSelectedReasons] = useState([])
  const [comment, setComment] = useState('')
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    setRating('')
    setSelectedReasons([])
    setComment('')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not([disabled]), textarea:not([disabled])') || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeyDown) }
  }, [open, busy, onClose])

  if (!open) return null

  function toggleReason(value) {
    setSelectedReasons((current) => current.includes(value) ? current.filter((reason) => reason !== value) : current.length < 4 ? [...current, value] : current)
  }

  const positive = rating === 'GOOD' || rating === 'GREAT'
  return (
    <div className="logout-feedback-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <section className="logout-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-feedback-title" aria-describedby="logout-feedback-subtitle" ref={dialogRef}>
        <button ref={closeButtonRef} className="logout-feedback-close" type="button" onClick={onClose} disabled={busy} aria-label="Close logout feedback dialog">×</button>
        <h2 id="logout-feedback-title">Before you go…</h2>
        <p id="logout-feedback-subtitle">How was your Buyamia experience today?</p>
        <div className="logout-feedback-ratings" role="radiogroup" aria-label="Experience rating">
          {ratings.map((item) => <button key={item.value} type="button" role="radio" aria-checked={rating === item.value} className={rating === item.value ? 'is-selected' : ''} onClick={() => setRating(item.value)} disabled={busy}><span aria-hidden="true">{item.emoji}</span><small>{item.label}</small></button>)}
        </div>
        {rating && <div className="logout-feedback-followup"><p>{positive ? 'What did you like most?' : 'What could we do better?'}</p><div className="logout-feedback-reasons">{reasons.map((reason) => <button key={reason.value} type="button" className={selectedReasons.includes(reason.value) ? 'is-selected' : ''} aria-pressed={selectedReasons.includes(reason.value)} onClick={() => toggleReason(reason.value)} disabled={busy}>{reason.label}</button>)}</div><label htmlFor="logout-feedback-comment" className="visually-hidden">Optional feedback comment</label><textarea id="logout-feedback-comment" maxLength="500" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Tell us in a few words…" disabled={busy} /><small className="logout-feedback-count">{comment.length}/500</small></div>}
        <div className="logout-feedback-actions"><button type="button" className="btn btn-charcoal" onClick={() => onSubmit({ rating, reasons: selectedReasons, comment })} disabled={!rating || busy}>{busy ? 'Logging out…' : 'Submit & log out'}</button><button type="button" className="logout-feedback-skip" onClick={onSkip} disabled={busy}>Skip & log out</button></div>
      </section>
    </div>
  )
}
