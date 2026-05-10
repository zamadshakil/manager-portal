import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  AuthState,
  MetricsSnapshot,
  TestConfig,
  TestResult,
  TestStatus,
  Threshold,
} from './types'
import { LoginForm } from './components/LoginForm'
import { ConfigPanel } from './components/ConfigPanel'
import { MetricsPanel } from './components/MetricsPanel'
import { Charts } from './components/Charts'
import { ThresholdEditor } from './components/ThresholdEditor'
import { apiStartTest, apiStopTest } from './lib/api'

const TARGET_URL =
  (import.meta as any).env?.VITE_TARGET_URL ?? 'https://system.zamdevai.com'

const DEFAULT_CONFIG: TestConfig = {
  url: `${TARGET_URL}/api/messaging/conversations`,
  method: 'GET',
  headers: {},
  body: undefined,
  vuCount: 50,
  duration: 60,
  rampUp: 10,
  rateCap: 0,
  thinkTime: 0,
}

const DEFAULT_THRESHOLDS: Threshold[] = [
  {
    id: '1',
    metric: 'p95',
    operator: 'lt',
    value: 800,
    label: 'p95 < 800ms',
  },
  {
    id: '2',
    metric: 'error_rate',
    operator: 'lt',
    value: 2,
    label: 'Error rate < 2%',
  },
  {
    id: '3',
    metric: 'rate_429',
    operator: 'lt',
    value: 20,
    label: '429 rate < 20%',
  },
]

export default function App() {
  const [auth, setAuth] = useState<AuthState>({
    token: null,
    email: null,
    loading: false,
    error: null,
  })
  const [config, setConfig] = useState<TestConfig>(DEFAULT_CONFIG)
  const [thresholds, setThresholds] =
    useState<Threshold[]>(DEFAULT_THRESHOLDS)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [metrics, setMetrics] = useState<MetricsSnapshot[]>([])
  const [currentSnapshot, setCurrentSnapshot] =
    useState<MetricsSnapshot | null>(null)
  const [result, setResult] = useState<TestResult | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const connectSSE = useCallback(() => {
    esRef.current?.close()
    const es = new EventSource('/api/test/stream')
    esRef.current = es
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'metrics') {
          const snap = data as MetricsSnapshot
          setCurrentSnapshot(snap)
          setMetrics((prev) => [...prev.slice(-180), snap])
        } else if (data.type === 'complete') {
          setResult(data.result as TestResult)
          setTestStatus('completed')
        } else if (data.type === 'stopped') {
          setTestStatus('stopped')
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [])

  useEffect(() => {
    connectSSE()
    return () => esRef.current?.close()
  }, [connectSSE])

  const handleStart = async () => {
    if (!auth.token) return
    setStartError(null)
    setMetrics([])
    setCurrentSnapshot(null)
    setResult(null)
    setTestStatus('running')

    const configWithAuth: TestConfig = {
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
    }

    try {
      await apiStartTest(configWithAuth, thresholds)
    } catch (err: any) {
      setStartError(err.message)
      setTestStatus('idle')
    }
  }

  const handleStop = async () => {
    await apiStopTest()
    setTestStatus('stopped')
  }

  const handleReset = () => {
    setTestStatus('idle')
    setMetrics([])
    setCurrentSnapshot(null)
    setResult(null)
    setStartError(null)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
            LT
          </div>
          <h1 className="font-semibold text-white">Load Test Dashboard</h1>
          <span className="text-gray-600 text-xs hidden sm:block">
            target:{' '}
            <span className="font-mono text-indigo-400">{TARGET_URL}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {auth.token && (
            <span className="text-xs bg-green-900/40 text-green-400 border border-green-800/50 rounded-full px-2.5 py-0.5">
              ✓ {auth.email}
            </span>
          )}
          {auth.token && (
            <button
              onClick={() =>
                setAuth({ token: null, email: null, loading: false, error: null })
              }
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-80 flex-shrink-0 border-r border-gray-800 overflow-y-auto p-3 space-y-3">
          {!auth.token ? (
            <LoginForm auth={auth} setAuth={setAuth} />
          ) : (
            <>
              <ConfigPanel
                config={config}
                setConfig={setConfig}
                targetUrl={TARGET_URL}
              />
              <ThresholdEditor
                thresholds={thresholds}
                setThresholds={setThresholds}
              />

              {/* Action buttons */}
              <div className="space-y-2 pb-4">
                {startError && (
                  <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/40 rounded-lg px-3 py-2">
                    {startError}
                  </p>
                )}

                {testStatus === 'running' ? (
                  <button
                    onClick={handleStop}
                    className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="w-3 h-3 bg-white rounded-sm inline-block" />
                    Stop Test
                  </button>
                ) : (
                  <button
                    onClick={
                      testStatus === 'idle' ? handleStart : handleReset
                    }
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {testStatus === 'idle'
                      ? '▶  Start Test'
                      : '↺  Run Again'}
                  </button>
                )}

                <div className="text-center text-xs text-gray-600">
                  Status:{' '}
                  <span
                    className={
                      testStatus === 'running'
                        ? 'text-green-400 animate-pulse'
                        : testStatus === 'completed'
                        ? 'text-blue-400'
                        : testStatus === 'stopped'
                        ? 'text-yellow-400'
                        : 'text-gray-500'
                    }
                  >
                    {testStatus}
                  </span>
                </div>
              </div>
            </>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {!auth.token ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Sign in on the left to start testing
            </div>
          ) : (
            <>
              <MetricsPanel
                snapshot={currentSnapshot}
                config={config}
                testStatus={testStatus}
              />
              <Charts metrics={metrics} />
              {result && <ResultCard result={result} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function ResultCard({ result }: { result: TestResult }) {
  const allPassed = result.thresholds.every((t) => t.passed)
  return (
    <div
      className={`rounded-xl border p-5 space-y-4 ${
        allPassed
          ? 'border-green-800 bg-green-950/20'
          : 'border-red-800 bg-red-950/20'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{allPassed ? '✅' : '❌'}</span>
        <div>
          <h3 className="font-semibold text-white">
            Test {allPassed ? 'PASSED' : 'FAILED'}
          </h3>
          <p className="text-xs text-gray-400">
            Completed in {result.duration.toFixed(1)}s —{' '}
            {result.totalRequests.toLocaleString()} total requests
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Stat label="p50" value={`${result.p50}ms`} />
        <Stat label="p95" value={`${result.p95}ms`} />
        <Stat label="p99" value={`${result.p99}ms`} />
        <Stat label="Avg" value={`${result.avgLatency}ms`} />
        <Stat label="2xx" value={result.status2xx.toLocaleString()} color="text-green-400" />
        <Stat label="429" value={result.status429.toLocaleString()} color="text-yellow-400" />
        <Stat label="4xx" value={(result.status4xx - result.status429).toLocaleString()} color="text-orange-400" />
        <Stat label="5xx" value={result.status5xx.toLocaleString()} color="text-red-400" />
      </div>

      {result.thresholds.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Thresholds
          </h4>
          <div className="space-y-1.5">
            {result.thresholds.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span>{t.passed ? '✅' : '❌'}</span>
                <span className="text-gray-300 flex-1">{t.label}</span>
                <span
                  className={`font-mono ${t.passed ? 'text-green-400' : 'text-red-400'}`}
                >
                  actual: {t.actual}
                  {t.metric === 'p95' || t.metric === 'p99' ? 'ms' : '%'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  color = 'text-white',
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="bg-gray-900/60 rounded-lg p-2.5">
      <p className="text-gray-500 text-[10px] uppercase">{label}</p>
      <p className={`font-mono font-semibold ${color}`}>{value}</p>
    </div>
  )
}
