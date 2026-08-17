import { useEffect, useState } from 'react'

function money(value, currency) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value || 0) }

async function api(url, options) {
  const response = await fetch(url, options)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message || 'Unable to load affiliate information.')
  return payload.data
}

function ExternalPrograms() {
  return <section className="affiliate-external"><p className="eyebrow">Affiliate programs explained</p><h2>Buyamia and external programs</h2><div><article><h3>Buyamia Affiliate Program</h3><p>Apply directly with Buyamia, select the categories you understand, and manage Buyamia referral activity from your account.</p></article><article><h3>Amazon Associates and Shopify</h3><p>Amazon Associates and Shopify affiliate or partner programs are separate external programs with their own applications, links, terms, and reporting. They are not connected automatically to Buyamia.</p></article></div></section>
}

function AffiliateRegistration() {
  const [categories, setCategories] = useState([])
  const [application, setApplication] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', publicName: '', website: '', country: '', preferredLanguage: 'English', biography: '', motivation: '', categoryIds: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([api('/api/affiliate-program'), api('/api/affiliate-program/application'), api('/api/categories?limit=100'), api('/api/account')])
      .then(([, savedApplication, categoryPayload, account]) => {
        setApplication(savedApplication)
        setCategories(categoryPayload || [])
        setForm((current) => ({ ...current, name: [account.firstName, account.lastName].filter(Boolean).join(' '), email: account.email || '', country: account.country || '' }))
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false))
  }, [])

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); setMessage('') }
  function toggleCategory(id) { setForm((current) => ({ ...current, categoryIds: current.categoryIds.includes(id) ? current.categoryIds.filter((item) => item !== id) : [...current.categoryIds, id] })); setMessage('') }
  async function submit(event) {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const saved = await api('/api/affiliate-program/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      setApplication(saved)
      setMessage('Affiliate application submitted successfully.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  return <main className="affiliate-page shell"><div className="brand-breadcrumb"><a href="/account/affiliate">Affiliate Program</a><span>›</span>Application</div><header className="affiliate-page__head"><p className="eyebrow">Affiliate onboarding</p><h1>Create an Affiliate Program</h1><p>Tell us how you plan to introduce Buyamia products to your audience.</p></header>{loading && <p className="history-state">Loading affiliate application…</p>}{!loading && application && <section className="affiliate-application-status" role="status"><small>Application status</small><strong>{application.status}</strong><p>Submitted on {new Date(application.createdAt).toLocaleDateString()} with {application.categoryIds.length} category interest{application.categoryIds.length === 1 ? '' : 's'}.</p><a className="btn btn-charcoal" href="/account/affiliate">Back to Affiliate Program</a></section>}{!loading && !application && message && <p className="history-state history-state--error" role="alert">{message}</p>}{!loading && !application && !message && <form className="affiliate-registration" onSubmit={submit}><label>Name *<input required minLength="2" maxLength="120" value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label>Email *<input required type="email" maxLength="160" value={form.email} onChange={(event) => update('email', event.target.value)} /></label><label>Affiliate / public name<input maxLength="120" value={form.publicName} onChange={(event) => update('publicName', event.target.value)} /></label><label>Website or social profile<input type="url" maxLength="240" value={form.website} onChange={(event) => update('website', event.target.value)} placeholder="https://" /></label><label>Country *<input required maxLength="80" value={form.country} onChange={(event) => update('country', event.target.value)} /></label><label>Preferred language *<input required maxLength="40" value={form.preferredLanguage} onChange={(event) => update('preferredLanguage', event.target.value)} /></label><label className="affiliate-registration__wide">About you *<textarea required minLength="10" maxLength="600" value={form.biography} onChange={(event) => update('biography', event.target.value)} /></label><label className="affiliate-registration__wide">How will you promote Buyamia? *<textarea required minLength="10" maxLength="1500" value={form.motivation} onChange={(event) => update('motivation', event.target.value)} /></label><fieldset className="affiliate-registration__wide"><legend>Category interests *</legend><div>{categories.map((category) => <label key={category.id}><input type="checkbox" checked={form.categoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} />{category.name}</label>)}</div></fieldset>{message && <p className="affiliate-registration__wide affiliate-registration__message" role="alert">{message}</p>}<footer className="affiliate-registration__wide"><a href="/account/affiliate">Cancel</a><button className="btn btn-charcoal" type="submit" disabled={saving || !form.categoryIds.length}>{saving ? 'Submitting…' : 'Submit Application'}</button></footer></form>}<ExternalPrograms /></main>
}

export default function AffiliatePage() {
  const registering = window.location.pathname === '/account/affiliate/register'
  const [dashboard, setDashboard] = useState(null); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('')
  async function load() { setLoading(true); setMessage(''); try { setDashboard(await api('/api/account/affiliate')) } catch (error) { setMessage(error.message) } finally { setLoading(false) } }
  useEffect(() => { if (!registering) load() }, [registering])
  async function copyLink() { try { const profile = await api('/api/account/affiliate/link', { method: 'POST' }); const url = new URL(profile.referralUrl, window.location.origin).href; await navigator.clipboard.writeText(url); setMessage('Referral link copied.') } catch (error) { setMessage(error.message || 'Unable to copy your referral link.') } }
  if (registering) return <AffiliateRegistration />
  const stats = dashboard?.statistics
  return <main className="affiliate-page shell"><header className="affiliate-page__head"><p className="eyebrow">My Account</p><h1>Affiliate <em>Program</em></h1><p>Share Buyamia and earn rewards for successful referrals.</p><a className="btn btn-charcoal affiliate-create-action" href="/account/affiliate/register">Create an Affiliate Program</a></header>{loading && <p className="history-state">Loading affiliate dashboard…</p>}{!loading && message && <p className={`history-state${message === 'Referral link copied.' ? '' : ' history-state--error'}`}>{message}</p>}{!loading && dashboard && <><section className="affiliate-link"><div><small>Your referral link</small><strong>{new URL(dashboard.profile.referralUrl, window.location.origin).href}</strong><em>{dashboard.profile.status}</em></div><button type="button" className="btn btn-charcoal" onClick={copyLink}>Copy link</button></section><section className="affiliate-stats"><article><small>Total referrals</small><strong>{stats.totalReferrals}</strong></article><article><small>Successful referrals</small><strong>{stats.successfulReferrals}</strong></article><article><small>Pending earnings</small><strong>{money(stats.pendingEarnings, stats.currency)}</strong></article><article><small>Total earnings</small><strong>{money(stats.totalEarnings, stats.currency)}</strong></article></section><section className="affiliate-history"><h2>Commission history</h2>{!dashboard.commissions.length && <p>No commissions yet. Your referral activity will appear here.</p>}{dashboard.commissions.map((commission) => <article key={commission.id}><span><strong>{commission.description || 'Referral commission'}</strong><small>{new Date(commission.createdAt).toLocaleDateString()} · {commission.status}</small></span><b>{money(commission.amount, stats.currency)}</b></article>)}</section><section className="affiliate-history"><h2>Referral history</h2>{!dashboard.referrals.length && <p>No referrals yet. Share your link to get started.</p>}{dashboard.referrals.map((referral) => <article key={referral.id}><span><strong>{referral.name || referral.email || 'Referral'}</strong><small>{new Date(referral.createdAt).toLocaleDateString()} · {referral.status}</small></span></article>)}</section></>}<ExternalPrograms /></main>
}
