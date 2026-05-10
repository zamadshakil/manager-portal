import express from 'express'
import cors from 'cors'
import { loginWithPassword } from './auth.js'
import {
  startTest,
  type TestConfig,
  type Threshold,
  type MetricsSnapshot,
} from './load-engine.js'
import { SSEChannel } from './sse.js'

const app = express()
const PORT = 4000

app.use(cors())
app.use(express.json({ limit: '1mb' }))

const sse = new SSEChannel()
let currentTest: ReturnType<typeof startTest> | null = null
let testStatus: 'idle' | 'running' | 'completed' | 'stopped' = 'idle'
let lastResult: unknown = null

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''

  if (!supabaseUrl || !anonKey) {
    res.status(500).json({
      error:
        'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set in .env — copy them from manager-portal/.env.local',
    })
    return
  }

  try {
    const result = await loginWithPassword(supabaseUrl, anonKey, email, password)
    res.json({ access_token: result.access_token, user: result.user })
  } catch (err: any) {
    res.status(401).json({ error: err.message ?? 'Authentication failed' })
  }
})

// ── Start test ────────────────────────────────────────────────────────────────
app.post('/api/test/start', (req, res) => {
  if (testStatus === 'running') {
    res.status(409).json({ error: 'A test is already running. Stop it first.' })
    return
  }

  const { config, thresholds } = req.body as {
    config: TestConfig
    thresholds: Threshold[]
  }

  if (!config?.url) {
    res.status(400).json({ error: 'config.url is required' })
    return
  }

  testStatus = 'running'
  lastResult = null

  currentTest = startTest(
    config,
    thresholds ?? [],
    (snapshot: MetricsSnapshot) => {
      sse.broadcast(snapshot)
    },
  )

  currentTest.waitForCompletion().then((result) => {
    lastResult = result
    testStatus = 'completed'
    sse.broadcast({ type: 'complete', result })
    currentTest = null
  })

  res.json({ ok: true, status: 'started' })
})

// ── Stop test ─────────────────────────────────────────────────────────────────
app.delete('/api/test/stop', (_req, res) => {
  if (currentTest) {
    currentTest.stop()
    testStatus = 'stopped'
    sse.broadcast({ type: 'stopped' })
    currentTest = null
  }
  res.json({ ok: true })
})

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/test/status', (_req, res) => {
  res.json({ status: testStatus, result: lastResult })
})

// ── SSE stream ────────────────────────────────────────────────────────────────
app.get('/api/test/stream', (req, res) => {
  sse.addClient(res)
})

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: testStatus,
    supabaseConfigured: !!(
      process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY
    ),
  })
})

app.listen(PORT, () => {
  console.log(`\n[load-test] Backend running → http://localhost:${PORT}`)
  const supabaseOk = !!(
    process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY
  )
  console.log(
    `[load-test] Supabase config : ${supabaseOk ? '✓ loaded' : '✗ missing — fill in .env'}`,
  )
  console.log(`[load-test] UI             → http://localhost:5173\n`)
})
