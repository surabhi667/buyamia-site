import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../server/app.js'
import { createStore } from '../server/data.js'

async function withApi(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'buyamia-ask-amia-'))
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
  async function request(path, { method = 'GET', body, cookie } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return { response, payload: await response.json() }
  }
  const signup = await request('/api/auth/signup', { method: 'POST', body: { name: 'Ask Amia Test User', email: `ask-${Date.now()}-${Math.random()}@example.com`, password: 'StrongPassword123' } })
  assert.equal(signup.response.status, 201)
  const cookie = signup.response.headers.get('set-cookie').split(';')[0]
  return async function postChat(body) {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask-amia/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    })
    return { response, payload: await response.json() }
  }
}

test('Ask Amia creates a conversation when conversationId is absent', async (t) => {
  const postChat = await withApi(t)
  const { response, payload } = await postChat({ prompt: 'Find handmade chairs' })

  assert.equal(response.status, 201)
  assert.equal(typeof payload.data.conversationId, 'string')
  assert.equal(payload.data.userMessage.conversationId, payload.data.conversationId)
  assert.equal(payload.data.assistantMessage.conversationId, payload.data.conversationId)
})

test('Ask Amia creates a conversation when conversationId is null', async (t) => {
  const postChat = await withApi(t)
  const { response, payload } = await postChat({ prompt: 'Find ceramic lamps', conversationId: null })

  assert.equal(response.status, 201)
  assert.equal(typeof payload.data.conversationId, 'string')
  assert.equal(payload.data.userMessage.conversationId, payload.data.conversationId)
  assert.equal(payload.data.assistantMessage.conversationId, payload.data.conversationId)
})

test('Ask Amia continues an existing conversation when conversationId is valid', async (t) => {
  const postChat = await withApi(t)
  const first = await postChat({ prompt: 'Find sustainable furniture' })
  const conversationId = first.payload.data.conversationId
  const second = await postChat({ prompt: 'Narrow it to hotels', conversationId })

  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 201)
  assert.equal(second.payload.data.conversationId, conversationId)
  assert.equal(second.payload.data.userMessage.conversationId, conversationId)
  assert.equal(second.payload.data.assistantMessage.conversationId, conversationId)
})

test('Ask Amia rejects a numeric conversationId', async (t) => {
  const postChat = await withApi(t)
  const { response, payload } = await postChat({ prompt: 'Find bamboo tables', conversationId: 123 })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
  assert.equal(payload.error.message, 'conversationId must be a string')
})

test('Ask Amia rejects an object conversationId', async (t) => {
  const postChat = await withApi(t)
  const { response, payload } = await postChat({ prompt: 'Find outdoor lighting', conversationId: { id: 'conversation_1' } })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
  assert.equal(payload.error.message, 'conversationId must be a string')
})

test('Ask Amia rejects an array conversationId', async (t) => {
  const postChat = await withApi(t)
  const { response, payload } = await postChat({ prompt: 'Find woven baskets', conversationId: ['conversation_1'] })

  assert.equal(response.status, 400)
  assert.equal(payload.error.code, 'VALIDATION_ERROR')
  assert.equal(payload.error.message, 'conversationId must be a string')
})
