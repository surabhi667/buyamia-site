import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

const validPassword = 'StrongPassword123'
const genericLoginMessage = 'Email or password is incorrect'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-auth-'))
  testContext.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const store = createStore(join(directory, 'db.json'))
  const server = createServer(createApp(store))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  testContext.after(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const { port } = server.address()
  async function request(path, { method = 'GET', body, cookie, origin, headers: extraHeaders = {} } = {}) {
    const headers = { ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    if (origin) headers.Origin = origin
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    return { response, payload: text ? JSON.parse(text) : null }
  }

  return { request, store }
}

function sessionCookie(response) {
  const header = response.headers.get('set-cookie')
  assert.match(header, /buyamia_session=/)
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Lax/)
  assert.match(header, /Path=\//)
  assert.doesNotMatch(header, /Secure/)
  return header.split(';')[0]
}

function assertNoSecrets(value) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, /password/i)
  assert.doesNotMatch(serialized, /token/i)
  assert.doesNotMatch(serialized, /hash/i)
}

function assertClearsSessionCookie(response) {
  const header = response.headers.get('set-cookie')
  assert.match(header, /buyamia_session=/)
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Lax/)
  assert.match(header, /Path=\//)
  assert.match(header, /Max-Age=0/)
  return header
}

test('auth CORS allows credentials for an explicitly allowed origin', async (t) => {
  const { request } = await withApi(t)
  const { response } = await request('/api/auth/signup', {
    method: 'POST',
    origin: 'http://127.0.0.1:5173',
    body: { email: 'buyer@example.com', password: validPassword },
  })

  assert.equal(response.status, 201)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  assert.equal(response.headers.get('vary'), 'Origin')
  sessionCookie(response)
})

test('auth CORS preflight allows credentials for an explicitly allowed origin', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/auth/login', {
    method: 'OPTIONS',
    origin: 'http://127.0.0.1:5173',
    headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' },
  })

  assert.equal(response.status, 204)
  assert.equal(payload, null)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  assert.equal(response.headers.get('vary'), 'Origin')
})

test('auth CORS does not allow credentials for a forbidden origin', async (t) => {
  const { request } = await withApi(t)
  const { response } = await request('/api/auth/session', { origin: 'https://evil.example' })

  assert.equal(response.status, 401)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
})

test('signup creates a user and a session', async (t) => {
  const { request, store } = await withApi(t)
  const { response, payload } = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'Buyer@Example.com', password: validPassword, name: 'Buyer One' },
  })

  assert.equal(response.status, 201)
  assert.equal(payload.data.user.email, 'buyer@example.com')
  assert.equal(payload.data.user.authenticated, true)
  assert.equal(typeof payload.data.session.id, 'string')
  sessionCookie(response)
  assertNoSecrets(payload)

  const state = await store.getState()
  assert.equal(state.accounts[0].normalizedEmail, 'buyer@example.com')
  assert.notEqual(state.accountSecurity[0].passwordHash, validPassword)
  assert.equal(typeof state.accountSecurity[0].activeSessions[0].tokenHash, 'string')
})

test('signup rejects an invalid email', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'not-an-email', password: validPassword },
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
  assert.equal(payload.error.message, 'email must be a valid email address')
})

test('signup rejects an invalid password', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: 'short' },
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
  assert.equal(payload.error.message, 'password must contain between 12 and 200 characters')
})

test('signup rejects duplicate email with different casing', async (t) => {
  const { request } = await withApi(t)
  await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'Buyer@Example.com', password: validPassword },
  })
  const { response, payload } = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.COM', password: validPassword },
  })

  assert.equal(response.status, 409)
  assert.equal(payload.error.code, 'EMAIL_EXISTS')
})

test('login creates a new session for valid credentials', async (t) => {
  const { request } = await withApi(t)
  await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const { response, payload } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'BUYER@example.com', password: validPassword },
  })

  assert.equal(response.status, 200)
  assert.equal(payload.data.user.email, 'buyer@example.com')
  assert.equal(typeof payload.data.session.id, 'string')
  sessionCookie(response)
  assertNoSecrets(payload)
})

test('login rejects a bad password with a generic message', async (t) => {
  const { request } = await withApi(t)
  await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const { response, payload } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: 'WrongPassword123' },
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'INVALID_CREDENTIALS')
  assert.equal(payload.error.message, genericLoginMessage)
})

test('login rejects an unknown user with the same generic message', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'missing@example.com', password: validPassword },
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'INVALID_CREDENTIALS')
  assert.equal(payload.error.message, genericLoginMessage)
})

test('login rejects an account without a password hash with the same generic message', async (t) => {
  const { request, store } = await withApi(t)
  await store.mutate((db) => {
    db.accounts.push({ userId: 'user_without_hash', firstName: 'No', lastName: 'Hash', username: 'no-hash', email: 'no-hash@example.com', normalizedEmail: 'no-hash@example.com', avatar: '/assets/avatar-1.png', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    db.accountSecurity.push({ userId: 'user_without_hash', activeSessions: [], loginHistory: [] })
  })
  const { response, payload } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'no-hash@example.com', password: validPassword },
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'INVALID_CREDENTIALS')
  assert.equal(payload.error.message, genericLoginMessage)
})

test('session returns public user data with a valid cookie', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword, name: 'Buyer One' },
  })
  const cookie = sessionCookie(signup.response)
  const { response, payload } = await request('/api/auth/session', { cookie })

  assert.equal(response.status, 200)
  assert.equal(payload.data.user.email, 'buyer@example.com')
  assert.equal(payload.data.user.authenticated, true)
  assertNoSecrets(payload)
})

test('valid session cookie remains functional', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword, name: 'Buyer One' },
  })
  const cookie = sessionCookie(signup.response)
  const { response, payload } = await request('/api/auth/session', { cookie })

  assert.equal(response.status, 200)
  assert.equal(payload.data.user.email, 'buyer@example.com')
  assert.equal(payload.data.user.authenticated, true)
})

test('account sessions never include tokenHash or token data', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword, name: 'Buyer One' },
  })
  const userId = signup.payload.data.user.userId
  const { response, payload } = await request('/api/account/sessions', {
    headers: { 'X-User-Id': userId, 'X-User-Name': 'Buyer One' },
  })

  assert.equal(response.status, 200)
  assert.equal(Array.isArray(payload.data), true)
  assert.equal(typeof payload.data[0].id, 'string')
  assertNoSecrets(payload)
})

test('profile email updates normalize normalizedEmail and move login to the new email', async (t) => {
  const { request, store } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'old@example.com', password: validPassword, name: 'Buyer One' },
  })
  const userId = signup.payload.data.user.userId
  const update = await request('/api/account', {
    method: 'PATCH',
    headers: { 'X-User-Id': userId, 'X-User-Name': 'Buyer One' },
    body: { email: 'NewEmail@Example.COM', phone: '+62123456789' },
  })

  assert.equal(update.response.status, 200)
  assert.equal(update.payload.data.email, 'newemail@example.com')
  assert.equal(update.payload.data.normalizedEmail, 'newemail@example.com')
  const state = await store.getState()
  assert.equal(state.accounts.find((item) => item.userId === userId).normalizedEmail, 'newemail@example.com')

  const newLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'newemail@example.com', password: validPassword },
  })
  const oldLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'old@example.com', password: validPassword },
  })

  assert.equal(newLogin.response.status, 200)
  assert.equal(oldLogin.response.status, 401)
  assert.equal(oldLogin.payload.error.message, genericLoginMessage)
})

test('profile email update rejects an email already used with different casing', async (t) => {
  const { request } = await withApi(t)
  const first = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'first@example.com', password: validPassword, name: 'First User' },
  })
  await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'Taken@Example.com', password: validPassword, name: 'Taken User' },
  })
  const response = await request('/api/account', {
    method: 'PATCH',
    headers: { 'X-User-Id': first.payload.data.user.userId, 'X-User-Name': 'First User' },
    body: { email: 'taken@example.COM', phone: '+62123456789' },
  })

  assert.equal(response.response.status, 409)
  assert.equal(response.payload.error.code, 'EMAIL_EXISTS')
})

test('session rejects requests without a cookie', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/auth/session')

  assert.equal(response.status, 401)
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('session rejects a malformed session cookie without crashing', async (t) => {
  const { request } = await withApi(t)
  const { response, payload } = await request('/api/auth/session', { cookie: 'buyamia_session=%' })

  assert.equal(response.status, 401)
  assert.notEqual(response.status, 500)
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('logout invalidates the current session and clears the cookie', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  const logout = await request('/api/auth/logout', { method: 'POST', cookie })

  assert.equal(logout.response.status, 200)
  assertClearsSessionCookie(logout.response)
  assertNoSecrets(logout.payload)

  const afterLogout = await request('/api/auth/session', { cookie })
  assert.equal(afterLogout.response.status, 401)
  assert.equal(afterLogout.payload.error.code, 'AUTHENTICATION_REQUIRED')
})

test('logout succeeds with an explicitly allowed origin', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  const logout = await request('/api/auth/logout', {
    method: 'POST',
    cookie,
    origin: 'http://127.0.0.1:5173',
  })

  assert.equal(logout.response.status, 200)
  assert.equal(logout.response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
  assert.equal(logout.response.headers.get('access-control-allow-credentials'), 'true')
  assertClearsSessionCookie(logout.response)
})

test('logout rejects a forbidden origin without invalidating the session', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  const blocked = await request('/api/auth/logout', {
    method: 'POST',
    cookie,
    origin: 'https://forbidden.example',
  })
  const stillValid = await request('/api/auth/session', { cookie })

  assert.equal(blocked.response.status, 403)
  assert.equal(blocked.payload.error.code, 'ORIGIN_NOT_ALLOWED')
  assert.equal(blocked.response.headers.get('access-control-allow-origin'), null)
  assert.equal(blocked.response.headers.get('access-control-allow-credentials'), null)
  assert.equal(blocked.response.headers.get('set-cookie'), null)
  assert.equal(stillValid.response.status, 200)
  assert.equal(stillValid.payload.data.user.email, 'buyer@example.com')
})

test('logout rejects a same-site unauthorized origin', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  const blocked = await request('/api/auth/logout', {
    method: 'POST',
    cookie,
    origin: 'https://evil.example.com',
  })

  assert.equal(blocked.response.status, 403)
  assert.equal(blocked.payload.error.code, 'ORIGIN_NOT_ALLOWED')
  assert.equal(blocked.response.headers.get('access-control-allow-origin'), null)
  assert.equal(blocked.response.headers.get('access-control-allow-credentials'), null)
})

test('logout rejects Origin null without invalidating the session', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  const blocked = await request('/api/auth/logout', {
    method: 'POST',
    cookie,
    origin: 'null',
  })
  const stillValid = await request('/api/auth/session', { cookie })

  assert.equal(blocked.response.status, 403)
  assert.equal(blocked.payload.error.code, 'ORIGIN_NOT_ALLOWED')
  assert.equal(blocked.response.headers.get('access-control-allow-origin'), null)
  assert.equal(blocked.response.headers.get('access-control-allow-credentials'), null)
  assert.equal(blocked.response.headers.get('set-cookie'), null)
  assert.equal(stillValid.response.status, 200)
})

test('logout clears the cookie for an invalid session cookie', async (t) => {
  const { request } = await withApi(t)
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: 'buyamia_session=invalid-token' })

  assert.equal(logout.response.status, 200)
  assert.equal(logout.payload.data.authenticated, false)
  assertClearsSessionCookie(logout.response)
})

test('logout clears a malformed session cookie without crashing', async (t) => {
  const { request } = await withApi(t)
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: 'buyamia_session=%' })

  assert.equal(logout.response.status, 200)
  assert.notEqual(logout.response.status, 500)
  assert.equal(logout.payload.data.authenticated, false)
  assertClearsSessionCookie(logout.response)
})

test('logout handles malformed session cookie alongside other cookies', async (t) => {
  const { request } = await withApi(t)
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: 'theme=dark; buyamia_session=%; locale=en' })

  assert.equal(logout.response.status, 200)
  assert.notEqual(logout.response.status, 500)
  assert.equal(logout.payload.data.authenticated, false)
  assertClearsSessionCookie(logout.response)
})

test('logout clears the cookie when no session cookie is sent', async (t) => {
  const { request } = await withApi(t)
  const logout = await request('/api/auth/logout', { method: 'POST' })

  assert.equal(logout.response.status, 200)
  assert.equal(logout.payload.data.authenticated, false)
  assertClearsSessionCookie(logout.response)
})

test('logout clears the cookie for an expired session', async (t) => {
  const { request, store } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  await store.mutate((db) => {
    for (const security of db.accountSecurity) {
      for (const session of security.activeSessions || []) session.expiresAt = '2000-01-01T00:00:00.000Z'
    }
  })
  const logout = await request('/api/auth/logout', { method: 'POST', cookie })

  assert.equal(logout.response.status, 200)
  assert.equal(logout.payload.data.authenticated, false)
  assertClearsSessionCookie(logout.response)
})

test('auth responses never include password, hash, or token fields', async (t) => {
  const { request } = await withApi(t)
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const cookie = sessionCookie(signup.response)
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'buyer@example.com', password: validPassword },
  })
  const currentSession = await request('/api/auth/session', { cookie })
  const logout = await request('/api/auth/logout', { method: 'POST', cookie })

  assertNoSecrets(signup.payload)
  assertNoSecrets(login.payload)
  assertNoSecrets(currentSession.payload)
  assertNoSecrets(logout.payload)
})
