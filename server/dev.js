import { spawn } from 'node:child_process'
import { startApiServer } from './index.js'

const api = await startApiServer()
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const client = spawn(npmExecutable, ['run', 'dev:client', '--', ...process.argv.slice(2)], { stdio: 'inherit', shell: process.platform === 'win32' })

function stop(signal = 'SIGTERM') {
  api.close()
  if (!client.killed) client.kill(signal)
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
client.once('exit', (code) => {
  api.close(() => process.exit(code ?? 0))
})

console.log('Buyamia API listening on http://127.0.0.1:8787')
