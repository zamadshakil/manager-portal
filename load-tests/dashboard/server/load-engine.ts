import { performance } from 'perf_hooks'

export interface TestConfig {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
  vuCount: number
  duration: number
  rampUp: number
  rateCap: number
  thinkTime: number
}

export interface MetricsSnapshot {
  type: 'metrics'
  timestamp: number
  elapsed: number
  totalRequests: number
  requestsPerSecond: number
  activeVUs: number
  errors: number
  networkErrors: number
  status429: number
  status2xx: number
  status4xx: number
  status5xx: number
  p50: number
  p95: number
  p99: number
  avgLatency: number
}

export interface Threshold {
  metric: 'p95' | 'p99' | 'error_rate' | 'rate_429'
  operator: 'lt' | 'gt'
  value: number
  label: string
}

export interface ThresholdResult extends Threshold {
  actual: number
  passed: boolean
}

export interface TestResult extends Omit<MetricsSnapshot, 'type'> {
  duration: number
  thresholds: ThresholdResult[]
}

interface LiveState {
  running: boolean
  startTime: number
  endTime: number
  totalRequests: number
  errors: number
  networkErrors: number
  status429: number
  status2xx: number
  status4xx: number
  status5xx: number
  latencies: number[]
  activeVUs: number
  windowRequests: number
  windowStart: number
  rps: number
}

class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(private readonly ratePerSecond: number) {
    this.tokens = ratePerSecond
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now()
      const elapsed = (now - this.lastRefill) / 1000
      this.tokens = Math.min(
        this.ratePerSecond,
        this.tokens + elapsed * this.ratePerSecond,
      )
      this.lastRefill = now

      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }

      const waitMs = ((1 - this.tokens) / this.ratePerSecond) * 1000
      await sleep(Math.max(5, Math.ceil(waitMs)))
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((p / 100) * sorted.length)
  return Math.round(sorted[Math.min(idx, sorted.length - 1)])
}

function buildSnapshot(state: LiveState): MetricsSnapshot {
  const sorted = [...state.latencies].sort((a, b) => a - b)
  const elapsed = (Date.now() - state.startTime) / 1000

  return {
    type: 'metrics',
    timestamp: Date.now(),
    elapsed: Math.round(elapsed * 10) / 10,
    totalRequests: state.totalRequests,
    requestsPerSecond: state.rps,
    activeVUs: state.activeVUs,
    errors: state.errors,
    networkErrors: state.networkErrors,
    status429: state.status429,
    status2xx: state.status2xx,
    status4xx: state.status4xx,
    status5xx: state.status5xx,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    avgLatency:
      sorted.length
        ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
        : 0,
  }
}

async function runVU(
  _vuId: number,
  config: TestConfig,
  state: LiveState,
  bucket: TokenBucket | null,
): Promise<void> {
  state.activeVUs += 1

  try {
    while (state.running && Date.now() < state.endTime) {
      if (bucket) await bucket.acquire()
      if (!state.running || Date.now() >= state.endTime) break

      const reqStart = performance.now()

      try {
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), 30_000)

        const init: RequestInit = {
          method: config.method,
          headers: config.headers,
          signal: controller.signal as any,
        }
        if (
          config.body &&
          config.method !== 'GET' &&
          config.method !== 'HEAD'
        ) {
          init.body = JSON.stringify(config.body)
        }

        const res = await fetch(config.url, init)
        clearTimeout(tid)

        const latency = performance.now() - reqStart
        state.totalRequests += 1

        state.latencies.push(latency)
        if (state.latencies.length > 8000) state.latencies.splice(0, 2000)

        const s = res.status
        if (s >= 200 && s < 300) state.status2xx += 1
        else if (s === 429) {
          state.status429 += 1
          state.errors += 1
        } else if (s >= 400 && s < 500) {
          state.status4xx += 1
          state.errors += 1
        } else if (s >= 500) {
          state.status5xx += 1
          state.errors += 1
        }

        const now = Date.now()
        if (now - state.windowStart >= 1000) {
          state.rps = state.windowRequests
          state.windowRequests = 0
          state.windowStart = now
        }
        state.windowRequests += 1
      } catch (err: any) {
        if (state.running) {
          state.errors += 1
          state.networkErrors += 1
          state.totalRequests += 1
          state.latencies.push(performance.now() - reqStart)
        }
      }

      if (config.thinkTime > 0) await sleep(config.thinkTime)
    }
  } finally {
    state.activeVUs = Math.max(0, state.activeVUs - 1)
  }
}

export type MetricsCallback = (snap: MetricsSnapshot) => void

export interface RunningTest {
  stop(): void
  waitForCompletion(): Promise<TestResult>
}

export function startTest(
  config: TestConfig,
  thresholds: Threshold[],
  onMetrics: MetricsCallback,
): RunningTest {
  const state: LiveState = {
    running: true,
    startTime: Date.now(),
    endTime: Date.now() + config.duration * 1000,
    totalRequests: 0,
    errors: 0,
    networkErrors: 0,
    status429: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    latencies: [],
    activeVUs: 0,
    windowRequests: 0,
    windowStart: Date.now(),
    rps: 0,
  }

  const bucket = config.rateCap > 0 ? new TokenBucket(config.rateCap) : null

  let resolveCompletion!: (r: TestResult) => void
  const done = new Promise<TestResult>((res) => {
    resolveCompletion = res
  })

  const run = async () => {
    const vuPromises: Promise<void>[] = []
    const rampStepMs =
      config.rampUp > 0 ? (config.rampUp * 1000) / config.vuCount : 0

    for (let i = 0; i < config.vuCount; i++) {
      if (!state.running) break
      vuPromises.push(runVU(i, config, state, bucket))
      if (rampStepMs > 0) await sleep(rampStepMs)
    }

    const ticker = setInterval(() => {
      if (state.running) onMetrics(buildSnapshot(state))
    }, 1000)

    await Promise.all(vuPromises)
    clearInterval(ticker)
    state.running = false

    const final = buildSnapshot(state)
    const errorRate =
      state.totalRequests > 0 ? (state.errors / state.totalRequests) * 100 : 0
    const rate429 =
      state.totalRequests > 0
        ? (state.status429 / state.totalRequests) * 100
        : 0

    const thresholdResults: ThresholdResult[] = thresholds.map((t) => {
      let actual = 0
      if (t.metric === 'p95') actual = final.p95
      else if (t.metric === 'p99') actual = final.p99
      else if (t.metric === 'error_rate') actual = errorRate
      else if (t.metric === 'rate_429') actual = rate429
      const passed =
        t.operator === 'lt' ? actual < t.value : actual > t.value
      return { ...t, actual: Math.round(actual * 100) / 100, passed }
    })

    resolveCompletion({
      ...final,
      duration: (Date.now() - state.startTime) / 1000,
      thresholds: thresholdResults,
    })
  }

  run().catch((err) => console.error('[load-engine]', err))

  return {
    stop() {
      state.running = false
      state.endTime = 0
    },
    waitForCompletion: () => done,
  }
}
