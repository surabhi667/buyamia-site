import { useEffect, useRef, useState } from 'react'
import LogoutFeedbackModal from './LogoutFeedbackModal'

const icons = {
  panel: '◧',
  ask: '✦',
  cart: '▢',
  saved: '♡',
  pool: '⊕',
  credit: '◉',
  location: '⌖',
  currency: '¤',
  account: '◎',
  support: '♧',
  commerce: '◫',
  chat: '◇',
}

function Icon({ name }) {
  return <span className="sidebar-icon" aria-hidden="true">{icons[name]}</span>
}

function RailButton({ icon, label, onClick, controls, expanded }) {
  return (
    <button
      className="rail-button"
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-controls={controls}
      aria-expanded={expanded}
      title={label}
    >
      <Icon name={icon} />
    </button>
  )
}

export function LeftSidebar({ open, onToggle }) {
  return (
    <aside className={`app-sidebar app-sidebar--left${open ? ' is-open' : ''}`} aria-label="Shopping sidebar">
      <div className="sidebar-rail">
        <RailButton icon="panel" label={open ? 'Close shopping sidebar' : 'Open shopping sidebar'} onClick={onToggle} controls="left-sidebar-panel" expanded={open} />
        <div className="rail-rule" />
        <RailButton icon="ask" label="Ask Amia" onClick={() => { window.location.href = '/ask-amia' }} />
        <RailButton icon="cart" label="Cart" onClick={() => { window.location.href = '/cart' }} />
        <RailButton icon="saved" label="Saved items" onClick={() => { window.location.href = '/saved' }} />
        <RailButton icon="pool" label="Buying Pools" onClick={() => { window.location.href = '/buying-pools' }} />
        <div className="rail-rule" />
        <RailButton icon="credit" label="Credit usage" onClick={onToggle} controls="left-sidebar-panel" expanded={open} />
        <RailButton icon="location" label="Location and currency" onClick={onToggle} controls="left-sidebar-panel" expanded={open} />
        <div className="rail-spacer" />
        <RailButton icon="account" label="My account" onClick={() => { window.location.href = '/account' }} />
        <RailButton icon="support" label="Support" onClick={() => { window.location.href = '/support' }} />
      </div>

      <div className="sidebar-panel" id="left-sidebar-panel" aria-hidden={!open}>
        <div className="sidebar-heading">
          <span>Stay Buy-A-Mazing!</span>
          <button type="button" onClick={onToggle} aria-label="Close shopping sidebar"><Icon name="panel" /></button>
        </div>

        <nav className="sidebar-links" aria-label="Shopping tools">
          <a href="/ask-amia"><Icon name="ask" /><span>Ask Amia</span></a>
          <a href="/cart"><Icon name="cart" /><span>Cart</span></a>
          <a href="/saved"><Icon name="saved" /><span>Saved</span></a>
          <a href="/buying-pools"><Icon name="pool" /><span>Buying Pools</span></a>
        </nav>

        <section className="sidebar-card credit-card">
          <div className="card-title"><span>Credit usage</span><Icon name="credit" /></div>
          <a href="/account">Top up <span>→</span></a>
          <div className="credit-meta"><span>750</span><span>Available 21,000</span></div>
          <div className="credit-track"><span /></div>
        </section>

        <section className="sidebar-card location-card">
          <label>
            <span className="visually-hidden">Location</span>
            <select defaultValue="bali" aria-label="Location">
              <option value="bali">Bali, Indonesia</option>
              <option value="jakarta">Jakarta, Indonesia</option>
            </select>
            <Icon name="location" />
          </label>
          <label>
            <span className="visually-hidden">Currency</span>
            <select defaultValue="idr" aria-label="Currency">
              <option value="idr">IDR</option>
              <option value="usd">USD</option>
            </select>
            <Icon name="currency" />
          </label>
          <div className="location-meta"><span>10:15 am</span><span>04 Aug 26</span></div>
        </section>

        <section className="sidebar-section category-links">
          <h3>Shop by Category</h3>
          <a href="/categories?category=furniture">Furniture</a>
              <a href="/categories?category=clothing-shoes">Clothing &amp; Shoes</a>
          <a href="/categories?category=jewelry-accessories">Accessories</a>
          <a href="/categories">View all categories <span>→</span></a>
        </section>

        <nav className="sidebar-links sidebar-links--bottom" aria-label="Account links">
          <a href="/account"><Icon name="account" /><span>My Account</span></a>
          <a href="/support"><Icon name="support" /><span>Support</span></a>
        </nav>
      </div>
    </aside>
  )
}

const flashSaleProducts = [
  { image: '/assets/featured-1.png', title: 'Eco Friendly Bamboo side table', metric: '-50%', rating: '5/5' },
  { image: '/assets/featured-2.png', title: 'Sculptural timber side table', metric: '-30%', rating: '5/5' },
  { image: '/assets/featured-3.png', title: 'Hand-finished accent chair', metric: '-70%', rating: '5/5' },
]

const fastSellingProducts = [
  { image: '/assets/product-thumb.png', title: 'Eco Friendly Bamboo side table', metric: '1.5M Sold', rating: '5/5' },
  { image: '/assets/product-1.jpeg', title: 'Artisan mushroom table lamp', metric: '5.3k Sold', rating: '5/5' },
  { image: '/assets/product-2.jpeg', title: 'Hand-thrown ceramic collection', metric: '17k Sold', rating: '5/5' },
]

const auctionProducts = [
  { image: '/assets/carved-chair.jpeg', title: 'Hand carved armchair', bid: 'IDR 850,000', time: 'Ends in 02:14:32' },
  { image: '/assets/product-3.jpeg', title: 'Abstract face sculpture', bid: 'IDR 420,000', time: 'Ends in 06:42:18' },
]

const sellerPromos = [
  { avatar: '/assets/avatar-1.png', name: 'Sari Living', category: 'Furniture', text: 'New stock available — artisan side tables made for modern spaces.' },
  { avatar: '/assets/avatar-2.png', name: 'Island Botanics', category: 'Beauty & Care', text: 'Handmade essentials selling out fast. Discover today’s collection.' },
  { avatar: '/assets/avatar-3.png', name: 'Nusa Studio', category: 'Furniture', text: 'New sustainable pieces have just arrived in our workshop.' },
  { avatar: '/assets/review-1.png', name: 'Bali Homeware', category: 'Decor', text: 'Small-batch home accents ready to ship from Indonesia.' },
]

const discussionMessages = [
  { avatar: '/assets/avatar-2.png', name: 'Maya', text: 'Has anyone sourced hand-carved dining chairs recently?' },
  { avatar: '/assets/avatar-1.png', name: 'Daniel', text: 'The rattan collection is beautiful. I can share my supplier notes.' },
]

function ProductRows({ items, variant }) {
  return <div className="commerce-products">{items.map((item) => (
    <a href={variant === 'flash' ? '/flash-sales' : variant === 'fast' ? '/fast-selling' : '/categories'} className="commerce-product" key={`${variant}-${item.title}`}>
      <img src={item.image} alt="" />
      <span className="commerce-product__copy">
        <strong>{item.title}</strong>
        <span className="commerce-product__meta">
          <small className={variant === 'flash' ? 'is-discount' : 'is-sold'}>{item.metric}</small>
          <small className="commerce-rating">☆ {item.rating}</small>
        </span>
      </span>
    </a>
  ))}</div>
}

function SellerPromoFeed() {
  return <div className="seller-feed">{sellerPromos.map((promo) => (
    <article className="seller-promo" key={promo.name}>
      <img src={promo.avatar} alt="" />
      <div>
        <div className="seller-promo__meta"><span>{promo.name}</span><small>{promo.category}</small></div>
        <p>{promo.text}</p>
      </div>
    </article>
  ))}</div>
}

function AuctionRows() {
  return (
    <div className="auction-products">
      {auctionProducts.map((item) => (
        <a href="/auctions" className="auction-product" key={item.title}>
          <img src={item.image} alt="" />
          <span>
            <strong>{item.title}</strong>
            <small>{item.time}</small>
            <b>Current bid {item.bid}</b>
          </span>
        </a>
      ))}
    </div>
  )
}

function SidebarSection({ id, label, color, open, onToggle, children, className = '' }) {
  return (
    <section className={`commerce-section${open ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} aria-controls={`${id}-sidebar-content`}>
        <span className="section-chevron">›</span>
        {color && <i style={{ background: color }} />}
        <span>{label}</span>
      </button>
      <div className="commerce-section__body" id={`${id}-sidebar-content`} aria-hidden={!open}><div>{children}</div></div>
    </section>
  )
}

function AuthModal({ mode, open, onAuthenticated, onClose, onModeChange }) {
  const dialogRef = useRef(null)
  const emailRef = useRef(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const isSignup = mode === 'signup'
  const titleId = 'auth-modal-title'

  useEffect(() => {
    if (!open) return undefined
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setStatus('idle')
    setError('')
    const frame = window.requestAnimationFrame(() => emailRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, mode])

  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function submit(event) {
    event.preventDefault()
    if (status === 'submitting') return
    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setStatus('submitting')
    setError('')
    try {
      const response = await fetch(isSignup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message || 'Authentication failed.')
      onAuthenticated(payload.data.user)
    } catch (caught) {
      setError(caught.message || 'Authentication failed.')
      setStatus('error')
    }
  }

  function switchMode(nextMode) {
    if (status === 'submitting') return
    onModeChange(nextMode)
  }

  return (
    <div className="auth-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="auth-modal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <button className="auth-modal-close" type="button" onClick={onClose} aria-label="Close authentication dialog">×</button>
        <h2 id={titleId}>{isSignup ? 'Create your account' : 'Log In'}</h2>
        <form className="auth-modal-form" onSubmit={submit}>
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" ref={emailRef} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength="254" disabled={status === 'submitting'} />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={isSignup ? 12 : 1} maxLength="200" disabled={status === 'submitting'} />
          {isSignup && (
            <>
              <label htmlFor="auth-confirm-password">Confirm password</label>
              <input id="auth-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength="12" maxLength="200" disabled={status === 'submitting'} />
              <small>Password must contain at least 12 characters.</small>
            </>
          )}
          {error && <p className="auth-modal-error" role="alert">{error}</p>}
          <button className="auth-modal-submit" type="submit" disabled={status === 'submitting'}>{status === 'submitting' ? 'Loading…' : isSignup ? 'Sign Up' : 'Log In'}</button>
        </form>
        <button className="auth-modal-switch" type="button" onClick={() => switchMode(isSignup ? 'login' : 'signup')} disabled={status === 'submitting'}>{isSignup ? 'Log In' : 'Create an account'}</button>
      </section>
    </div>
  )
}

function CommunityChat({ loggedIn, loggingOut, onLogin, onLogout, onSignup }) {
  const [messages, setMessages] = useState(discussionMessages)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/community/messages?limit=20', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Unable to load community messages.')
        setMessages(payload.data.map((item) => ({ avatar: item.avatar, name: item.userName, text: item.text })))
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setMessage(error.message)
      })
    return () => controller.abort()
  }, [])

  async function sendMessage(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setMessage('')
    try {
      const response = await fetch('/api/community/messages', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to send your message.')
      setMessages((current) => [...current, { avatar: payload.data.avatar, name: payload.data.userName, text: payload.data.text }])
      setDraft('')
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <div className="community-chat">
      <div className="chat-history" aria-live="polite">
        {(loggedIn ? messages : discussionMessages).map((message, index) => (
          <article className="chat-message" key={`${message.name}-${index}`}>
            <img src={message.avatar} alt="" />
            <div><small>{message.name}</small><p>{message.text}</p>{!loggedIn && <button type="button" onClick={onLogin}>read more</button>}</div>
          </article>
        ))}
      </div>
      {loggedIn ? (
        <>
          <div className="chat-login"><small>Signed in</small><div><button type="button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? 'Logging out...' : 'Logout'}</button></div></div>
          <form className="chat-composer" onSubmit={sendMessage}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write your message..." aria-label="Community chat message" />
            <button type="submit" aria-label="Send message">↑</button>
          </form>
        </>
      ) : (
        <div className="chat-login"><small>To chat, please</small><div><button type="button" onClick={onLogin}>Log In</button><button type="button" onClick={onSignup}>Sign Up</button></div></div>
      )}
      {message && <p className="chat-privacy" role="status">{message}</p>}
      <p className="chat-privacy">By chatting on Buyamia, you agree to our Privacy Policy.</p>
    </div>
  )
}

export function RightSidebar({ open, onToggle }) {
  const [expanded, setExpanded] = useState(() => new Set(['flash', 'fast', 'promo']))
  const [authUser, setAuthUser] = useState(null)
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' })
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutFeedbackOpen, setLogoutFeedbackOpen] = useState(false)
  const logoutReturnFocus = useRef(null)
  const authReturnFocus = useRef(null)
  const [whatsapp, setWhatsapp] = useState({ url: '', error: '' })
  const [telegram, setTelegram] = useState({ status: 'loading', error: '' })
  const loggedIn = Boolean(authUser)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/session', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return null
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Unable to restore session')
        return payload.data.user
      })
      .then((user) => {
        if (user) setAuthUser(user)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setAuthUser(null)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    function handleAuthRequired(event) {
      authReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setAuthModal({ open: true, mode: event.detail?.mode === 'signup' ? 'signup' : 'login' })
      if (!open) onToggle()
    }

    window.addEventListener('buyamia:auth-required', handleAuthRequired)
    return () => window.removeEventListener('buyamia:auth-required', handleAuthRequired)
  }, [open, onToggle])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/concierge/whatsapp', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'WhatsApp concierge is unavailable')
        setWhatsapp({ url: payload.data.url, error: '' })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setWhatsapp({ url: '', error: error.message })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/concierge/telegram/status', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Telegram concierge is unavailable')
        setTelegram({ status: payload.data.connected ? 'connected' : 'ready', error: '' })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setTelegram({ status: 'error', error: error.message })
      })
    return () => controller.abort()
  }, [])

  async function startTelegram(event) {
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    setTelegram((current) => ({ ...current, status: 'starting', error: '' }))
    try {
      const response = await fetch('/api/concierge/telegram/start', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const payload = await response.json()
      if (response.status === 401) {
        popup?.close()
        openAuthModal('login', event)
        setTelegram((current) => ({ ...current, status: 'ready', error: payload.error?.message || 'Authentication required' }))
        return
      }
      if (!response.ok) throw new Error(payload.error?.message || 'Telegram concierge is unavailable')
      if (popup) popup.location.href = payload.data.url
      else window.location.href = payload.data.url
      setTelegram((current) => ({ ...current, status: 'started', error: '' }))
    } catch (error) {
      popup?.close()
      setTelegram({ status: 'error', error: error.message })
    }
  }

  function toggleSection(id) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openAuthModal(mode, event) {
    authReturnFocus.current = event.currentTarget
    setAuthModal({ open: true, mode })
  }

  function closeAuthModal() {
    setAuthModal((current) => ({ ...current, open: false }))
    window.requestAnimationFrame(() => authReturnFocus.current?.focus())
  }

  function authenticated(user) {
    setAuthUser(user)
    closeAuthModal()
  }

  function requestLogout(event) {
    logoutReturnFocus.current = event.currentTarget
    setLogoutFeedbackOpen(true)
  }

  function cancelLogout() {
    setLogoutFeedbackOpen(false)
    window.requestAnimationFrame(() => logoutReturnFocus.current?.focus())
  }

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      setLogoutFeedbackOpen(false)
      setAuthUser(null)
      setLoggingOut(false)
    }
  }

  async function submitLogoutFeedback(feedback) {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/feedback/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feedback) })
    } catch {
      // Feedback is optional and must never prevent logout.
    } finally {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } finally {
        setLogoutFeedbackOpen(false)
        setAuthUser(null)
        setLoggingOut(false)
      }
    }
  }

  return (
    <aside className={`app-sidebar app-sidebar--right${open ? ' is-open' : ''}`} aria-label="We-Commerce sidebar">
      <div className="sidebar-rail">
        <RailButton icon="panel" label={open ? 'Close We-Commerce sidebar' : 'Open We-Commerce sidebar'} onClick={onToggle} controls="right-sidebar-panel" expanded={open} />
        <div className="rail-rule" />
        <RailButton icon="commerce" label="We-Commerce" onClick={onToggle} controls="right-sidebar-panel" expanded={open} />
        <div className="rail-spacer" />
        <RailButton icon="chat" label="Community chat" onClick={onToggle} controls="right-sidebar-panel" expanded={open} />
      </div>

      <div className="sidebar-panel" id="right-sidebar-panel" aria-hidden={!open}>
        <div className="sidebar-heading">
          <button type="button" onClick={onToggle} aria-label="Close We-Commerce sidebar"><Icon name="panel" /></button>
          <span>We-Commerce</span>
        </div>

        <div className="commerce-sections">
          <SidebarSection id="flash" label="Flash Sale" color="var(--pink)" open={expanded.has('flash')} onToggle={() => { window.location.href = '/flash-sales' }}>
            <ProductRows items={flashSaleProducts} variant="flash" />
          </SidebarSection>
          <SidebarSection id="fast" label="Fast Selling" color="var(--olive)" open={expanded.has('fast')} onToggle={() => { window.location.href = '/fast-selling' }}>
            <ProductRows items={fastSellingProducts} variant="fast" />
          </SidebarSection>
          <SidebarSection id="promo" label="Seller's Promo" color="var(--light-charcoal)" open={expanded.has('promo')} onToggle={() => { window.location.href = '/seller-promotions' }}>
            <SellerPromoFeed />
          </SidebarSection>
          <SidebarSection id="auctions" label="Auctions" color="#5296ee" open={expanded.has('auctions')} onToggle={() => { window.location.href = '/auctions' }}>
            <AuctionRows />
          </SidebarSection>
          <SidebarSection id="affiliate" label="Affiliate Program" open={expanded.has('affiliate')} onToggle={toggleSection}>
            <div className="affiliate-card">
              <p>Earn rewards. Create impact.<br />Connect the world.</p>
              <button type="button" onClick={() => { window.location.href = '/account/affiliate/register' }}>Apply Today <span aria-hidden="true">→</span></button>
            </div>
          </SidebarSection>
        </div>

        <section className="concierge-card">
          <div><strong>Concierge Bot</strong><Icon name="support" /></div>
          <small>Amia goes where you go.</small>
          <p>Browse, search, and purchase directly from WhatsApp or Telegram — without opening a browser.</p>
          <div className="concierge-actions"><button type="button" disabled={!whatsapp.url} title={whatsapp.error || 'Open Buyamia concierge on WhatsApp'} onClick={() => window.open(whatsapp.url, '_blank', 'noopener,noreferrer')}>WhatsApp</button><button type="button" disabled={telegram.status === 'loading' || telegram.status === 'starting'} title={telegram.error || (telegram.status === 'connected' ? 'Telegram account connected' : 'Open Buyamia concierge on Telegram')} onClick={startTelegram}>{telegram.status === 'starting' ? 'Opening…' : telegram.status === 'started' || telegram.status === 'connected' ? 'Telegram ✓' : 'Telegram'}</button></div>
        </section>

        <SidebarSection id="community" label="Community Chat" open={expanded.has('community')} onToggle={toggleSection} className="community-section">
          <CommunityChat loggedIn={loggedIn} loggingOut={loggingOut} onLogin={(event) => openAuthModal('login', event)} onLogout={requestLogout} onSignup={(event) => openAuthModal('signup', event)} />
        </SidebarSection>
      </div>
      <AuthModal mode={authModal.mode} open={authModal.open} onAuthenticated={authenticated} onClose={closeAuthModal} onModeChange={(mode) => setAuthModal((current) => ({ ...current, mode }))} />
      <LogoutFeedbackModal open={logoutFeedbackOpen} busy={loggingOut} onClose={cancelLogout} onSkip={logout} onSubmit={submitLogoutFeedback} />
    </aside>
  )
}
