import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env.local manually (Node scripts don't get Vite's env loading)
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=')
  if (key && !key.startsWith('#') && rest.length) {
    process.env[key.trim()] = rest.join('=').trim()
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID

// ── config ────────────────────────────────────────────────────────────────────
const TARGET_URL      = 'https://galaxy-home-automation-crm.vercel.app'
const CHECK_INTERVAL  = 60_000                    // check every 60 seconds
const TIMEOUT_MS      = 5_000                     // alert if response takes > 5s
// ──────────────────────────────────────────────────────────────────────────────

let wasDown = false

async function sendTelegram(message) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' }),
    })
  } catch (e) {
    console.error('[watchdog] Failed to send Telegram alert:', e.message)
  }
}

async function check() {
  const timestamp = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const start = Date.now()
    const res = await fetch(TARGET_URL, { signal: controller.signal })
    clearTimeout(timer)
    const ms = Date.now() - start

    if (res.ok) {
      console.log(`[${timestamp}] ✅ OK  ${res.status}  ${ms}ms`)
      if (wasDown) {
        await sendTelegram(`✅ <b>Galaxy CRM recovered</b>\nBack online at ${timestamp} IST`)
        wasDown = false
      }
    } else {
      console.warn(`[${timestamp}] ⚠️  HTTP ${res.status}`)
      if (!wasDown) {
        await sendTelegram(`⚠️ <b>Galaxy CRM returned HTTP ${res.status}</b>\nURL: ${TARGET_URL}\nTime: ${timestamp} IST`)
        wasDown = true
      }
    }
  } catch (err) {
    clearTimeout(timer)
    const reason = controller.signal.aborted ? `Timeout (>${TIMEOUT_MS}ms)` : err.message
    console.error(`[${timestamp}] ❌ DOWN — ${reason}`)
    if (!wasDown) {
      await sendTelegram(`🚨 <b>Galaxy CRM is DOWN</b>\nReason: ${reason}\nURL: ${TARGET_URL}\nTime: ${timestamp} IST`)
      wasDown = true
    }
  }
}

console.log(`[watchdog] Monitoring ${TARGET_URL} every ${CHECK_INTERVAL / 1000}s`)
await sendTelegram(`🟢 <b>Galaxy CRM Watchdog started</b>\nMonitoring: ${TARGET_URL}`)
check()
setInterval(check, CHECK_INTERVAL)
