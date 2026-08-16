import { useEffect, useState } from 'react'

const initialProfile = { firstName: '', lastName: '', email: '', phone: '', country: 'Indonesia (ID)', avatar: '/assets/avatar-1.png' }

export default function AccountPage() {
  const [profile, setProfile] = useState(initialProfile)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/account', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Unable to load your account.')
        setProfile((current) => ({ ...current, ...payload.data }))
        setStatus('ready')
      })
      .catch((error) => {
        if (error.name !== 'AbortError') { setMessage(error.message); setStatus('error') }
      })
    return () => controller.abort()
  }, [])

  function update(field, value) {
    setProfile((current) => ({ ...current, [field]: value }))
    setMessage('')
  }

  function chooseImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 350000) {
      setMessage('Choose an image smaller than 350 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => update('avatar', reader.result)
    reader.readAsDataURL(file)
  }

  async function save(event) {
    event.preventDefault()
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to save your account.')
      setProfile((current) => ({ ...current, ...payload.data }))
      setMessage('Account details saved.')
      setStatus('ready')
    } catch (error) {
      setMessage(error.message || 'Unable to save your account.')
      setStatus('ready')
    }
  }

  return (
    <>
      <main className="account-page shell">
        <section className="account-form-wrap">
          <div className="account-identity">
            <img src={profile.avatar || initialProfile.avatar} alt="Profile" />
            <div><h1>{profile.firstName || 'User'} {profile.lastName || 'Name'}</h1><p>{profile.email || 'user@example.com'}</p></div>
          </div>
          <form className="account-form" onSubmit={save}>
            <label>First name *<input value={profile.firstName} onChange={(event) => update('firstName', event.target.value)} required maxLength="80" /></label>
            <label>Last name *<input value={profile.lastName} onChange={(event) => update('lastName', event.target.value)} required maxLength="80" /></label>
            <label className="account-form__wide">Email *<input type="email" value={profile.email} onChange={(event) => update('email', event.target.value)} required maxLength="160" /></label>
            <label className="account-form__wide">Country / Region *<select value={profile.country} onChange={(event) => update('country', event.target.value)}><option>Indonesia (ID)</option><option>Australia (AU)</option><option>Singapore (SG)</option><option>United States (US)</option></select></label>
            <label className="account-form__wide">Phone Number *<input type="tel" value={profile.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+62 123 - 456 - 789" required maxLength="40" /></label>
            <label className="account-form__wide">Profile Photo<input className="account-file-input" type="file" accept="image/*" onChange={chooseImage} /><span className="account-file-button">Choose Image <span aria-hidden="true">▣</span></span></label>
            {status === 'loading' && <p className="account-message account-form__wide">Loading account details…</p>}
            {message && <p className={`account-message account-form__wide${message === 'Account details saved.' ? ' is-success' : ''}`}>{message}</p>}
            <button className="account-save account-form__wide" type="submit" disabled={status === 'loading' || status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save'}</button>
          </form>
        </section>
        <aside className="account-side">
          <div className="account-credit"><span>Credit usage</span><small>Try to up</small><b>750</b><i /></div>
          {['Account', 'Security', 'Shipping Address', 'Bank Account', 'My Orders', 'Wishlist', 'Browsing History', 'Affiliate'].map((item) => <button type="button" key={item} onClick={item === 'Shipping Address' ? () => { window.location.href = '/account/shipping-addresses' } : item === 'Security' ? () => { window.location.href = '/account/security' } : item === 'Bank Account' ? () => { window.location.href = '/account/bank-accounts' } : item === 'My Orders' ? () => { window.location.href = '/account/orders' } : item === 'Wishlist' ? () => { window.location.href = '/account/wishlist' } : item === 'Browsing History' ? () => { window.location.href = '/account/history' } : item === 'Affiliate' ? () => { window.location.href = '/account/affiliate' } : undefined}>{item}<span>›</span></button>)}
        </aside>
      </main>
      <footer className="account-footer shell"><div className="logo">buyamia</div><p>Buy some comfort. Buy<br />some care.</p><div><small>SHOP</small><span>All Products</span><span>Furniture</span><span>Home Decor</span></div><div><small>ABOUT US</small><span>About Us</span><span>Sustainability</span><span>Sell on Buyamia</span></div><div><small>SUPPORT</small><span>Help Center</span><span>Contact Us</span><span>FAQ</span></div></footer>
    </>
  )
}
