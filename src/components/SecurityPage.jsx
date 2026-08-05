import { useEffect, useState } from 'react'

export default function SecurityPage() {
  const [security, setSecurity] = useState(null)
  const [sessions, setSessions] = useState([])
  const [history, setHistory] = useState([])
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    const responses = await Promise.all(['/api/account/security', '/api/account/sessions', '/api/account/login-history?limit=5'].map((url) => fetch(url)))
    const data = await Promise.all(responses.map((response) => response.json()))
    if (responses.some((response) => !response.ok)) throw new Error(data.find((item) => item.error)?.error?.message || 'Unable to load security settings.')
    setSecurity(data[0].data); setSessions(data[1].data); setHistory(data[2].data)
  }

  useEffect(() => { load().catch((error) => setMessage(error.message)).finally(() => setLoading(false)) }, [])
  async function request(url, options) { const response = await fetch(url, options); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || 'Unable to update security settings.'); return payload.data }

  async function changePassword(event) { event.preventDefault(); setMessage(''); try { const next = await request('/api/account/password', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(passwords) }); setSecurity(next); setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' }); setMessage('Password updated. Other sessions have been signed out.') } catch (error) { setMessage(error.message) } }
  async function toggleTwoFactor(event) { try { const next = await request('/api/account/security', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ twoFactorEnabled: event.target.checked }) }); setSecurity(next) } catch (error) { setMessage(error.message) } }
  async function logoutAll() { try { const next = await request('/api/account/security/logout-all', { method: 'POST' }); setSecurity(next); setSessions(next.activeSessions); setMessage('Other sessions have been signed out.') } catch (error) { setMessage(error.message) } }
  async function endSession(id) { try { await request(`/api/account/sessions/${id}`, { method: 'DELETE' }); setSessions((current) => current.filter((session) => session.id !== id)); setMessage('Session signed out.') } catch (error) { setMessage(error.message) } }

  return <main className="security-page shell"><section className="security-page__head"><p className="eyebrow">My Account</p><h1>Security <em>settings</em></h1><p>Manage your password, account verification, and signed-in devices.</p></section>{loading ? <p>Loading security settings…</p> : <div className="security-grid"><form className="security-card security-password" onSubmit={changePassword}><h2>{security?.passwordConfigured ? 'Change password' : 'Set a password'}</h2>{security?.passwordConfigured && <label>Current password<input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} required /></label>}<label>New password<input type="password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} required minLength="12" /></label><label>Confirm new password<input type="password" value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} required minLength="12" /></label><small>Use at least 12 characters with uppercase, lowercase, and a number.</small><button className="btn btn-charcoal" type="submit">Save password</button>{message && <p className="security-message">{message}</p>}</form><section className="security-card"><h2>Verification</h2><p>Email verification <strong>{security?.emailVerified ? 'Verified' : 'Not verified'}</strong></p><p>Phone verification <strong>{security?.phoneVerified ? 'Verified' : 'Not verified'}</strong></p><label className="security-toggle"><span>Two-factor authentication<small>Authenticator integration is coming soon.</small></span><input type="checkbox" checked={Boolean(security?.twoFactorEnabled)} onChange={toggleTwoFactor} /></label></section><section className="security-card security-sessions"><h2>Active sessions</h2>{sessions.map((session) => <article key={session.id}><span><strong>{session.device}</strong><small>{session.browser} · {session.operatingSystem} · {session.location}</small></span>{session.current ? <em>Current</em> : <button type="button" onClick={() => endSession(session.id)}>Sign out</button>}</article>)}<button className="security-link" type="button" onClick={logoutAll}>Sign out of all other devices</button></section><section className="security-card security-history"><h2>Recent login activity</h2>{history.map((entry) => <article key={entry.id}><span><strong>{entry.device}</strong><small>{entry.browser} · {entry.location}</small></span><time>{new Date(entry.createdAt).toLocaleDateString()}</time></article>)}</section></div>}</main>
}
