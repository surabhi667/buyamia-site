import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createStore } from './data.js'
import { createApp } from './app.js'

const serverDirectory = dirname(fileURLToPath(import.meta.url))

export function startApiServer({ port = Number(process.env.API_PORT || 8787), host = process.env.API_HOST || '127.0.0.1', databasePath = process.env.BUYAMIA_DB_PATH || join(serverDirectory, 'data', 'buyamia-db.json') } = {}) {
  const store = createStore(databasePath)
  const server = createServer(createApp(store))
  return new Promise((resolveServer, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolveServer(server))
  })
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  const server = await startApiServer()
  const address = server.address()
  console.log(`Buyamia API listening on http://${address.address}:${address.port}`)
}
