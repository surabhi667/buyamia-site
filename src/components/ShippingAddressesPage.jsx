import { useEffect, useState } from 'react'

const blankAddress = { fullName: '', company: '', email: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'Indonesia', deliveryInstructions: '', isDefault: false }

export default function ShippingAddressesPage() {
  const [addresses, setAddresses] = useState([])
  const [form, setForm] = useState(blankAddress)
  const [editingId, setEditingId] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')

  async function load() {
    const response = await fetch('/api/account/shipping-addresses?limit=50', { credentials: 'include' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error?.message || 'Unable to load shipping addresses.')
    setAddresses(payload.data)
  }

  useEffect(() => { load().then(() => setStatus('ready')).catch((error) => { setMessage(error.message); setStatus('error') }) }, [])
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  async function save(event) {
    event.preventDefault(); setStatus('saving'); setMessage('')
    try {
      const response = await fetch(editingId ? `/api/account/shipping-addresses/${editingId}` : '/api/account/shipping-addresses', { method: editingId ? 'PUT' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || 'Unable to save this address.')
      await load(); setForm(blankAddress); setEditingId(null); setMessage('Address saved.'); setStatus('ready')
    } catch (error) { setMessage(error.message); setStatus('ready') }
  }

  async function action(url, method = 'POST') {
    const response = await fetch(url, { method, credentials: 'include' }); const payload = await response.json()
    if (!response.ok) { setMessage(payload.error?.message || 'Unable to update this address.'); return }
    await load()
  }

  function edit(address) { setEditingId(address.id); setForm({ ...blankAddress, ...address, fullName: address.recipientName }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return <main className="address-page shell"><section className="address-page__head"><p className="eyebrow">My Account</p><h1>Shipping <em>Address</em></h1><p>Manage the saved addresses used for your Buyamia orders.</p></section><div className="address-page__grid"><form className="address-form" onSubmit={save}><h2>{editingId ? 'Edit address' : 'Add a new address'}</h2><label>Full name *<input value={form.fullName} onChange={(event) => update('fullName', event.target.value)} required /></label><label>Company<input value={form.company} onChange={(event) => update('company', event.target.value)} /></label><label>Email<input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label><label>Phone number *<input value={form.phone} onChange={(event) => update('phone', event.target.value)} required /></label><label className="wide">Street address *<input value={form.line1} onChange={(event) => update('line1', event.target.value)} required /></label><label className="wide">Apartment / Suite<input value={form.line2} onChange={(event) => update('line2', event.target.value)} /></label><label>City *<input value={form.city} onChange={(event) => update('city', event.target.value)} required /></label><label>State / Region<input value={form.state} onChange={(event) => update('state', event.target.value)} /></label><label>Postal code *<input value={form.postalCode} onChange={(event) => update('postalCode', event.target.value)} required /></label><label>Country *<input value={form.country} onChange={(event) => update('country', event.target.value)} required /></label><label className="wide">Delivery instructions<textarea value={form.deliveryInstructions} onChange={(event) => update('deliveryInstructions', event.target.value)} /></label><label className="address-default wide"><input type="checkbox" checked={form.isDefault} onChange={(event) => update('isDefault', event.target.checked)} />Set as default shipping address</label>{message && <p className={`address-message${message === 'Address saved.' ? ' is-success' : ''}`}>{message}</p>}<button className="btn btn-charcoal wide" type="submit" disabled={status === 'saving'}>{status === 'saving' ? 'Saving…' : editingId ? 'Save address' : 'Add address'}</button>{editingId && <button className="address-cancel wide" type="button" onClick={() => { setEditingId(null); setForm(blankAddress) }}>Cancel</button>}</form><section className="address-list"><h2>Saved addresses</h2>{status === 'loading' && <p>Loading addresses…</p>}{status !== 'loading' && !addresses.length && <p>No shipping addresses saved yet.</p>}{addresses.map((address) => <article key={address.id}><div><strong>{address.recipientName}{address.isDefault && <small>Default</small>}</strong><p>{address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />{address.city}{address.state ? `, ${address.state}` : ''} {address.postalCode}<br />{address.country}</p></div><nav><button type="button" onClick={() => edit(address)}>Edit</button>{!address.isDefault && <button type="button" onClick={() => action(`/api/account/shipping-addresses/${address.id}/default`, 'PATCH')}>Make default</button>}<button type="button" onClick={() => action(`/api/account/shipping-addresses/${address.id}`, 'DELETE')}>Delete</button></nav></article>)}</section></div></main>
}
