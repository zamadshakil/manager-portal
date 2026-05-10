import type { MetricsSnapshot, TestConfig, TestStatus } from '../types'

interface Props {
  snapshot: MetricsSnapshot | null
  config: TestConfig
  testStatus: TestStatus
}

function BigStat({
  label,
  value,
  color = 'text-white',
  sub,
}: {
  label: string
  value: string | number
  color?: string
  sub?: string
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={`text-3xl font-bold font-mono ${color}`}>{value}</span>
      {sub && <span className="text-xs text-gray-600">{sub}</span>}
    </div>
  )
}

export function MetricsPanel({ snapshot, config, testStatus }: Props) {
  const s = snapshot

  const errorRate =
    s && s.totalRequests > 0
      ? ((s.errors / s.totalRequests) * 100).toFixed(1)
      : '0.0'

  const rate429 =
    s && s.totalRequests > 0
      ? ((s.status429 / s.totalRequests) * 100).toFixed(1)
      : '0.0'

  const progressPct =
    s && config.duration > 0
      ? Math.min(100, Math.round((s.elapsed / config.duration) * 100))
      : 0

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-white">
            {testStatus === 'running'
              ? 'Test running…'
              : testStatus === 'completed'
              ? 'Test completed'
              : testStatus === 'stopped'
              ? 'Test stopped'
              : 'Ready'}
          </span>
          <span className="text-gray-400 font-mono text-xs">
            {s ? `${s.elapsed}s / ${config.duration}s` : `0s / ${config.duration}s`}
          </span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              testStatus === 'running'
                ? 'bg-indigo-500'
                : testStatus === 'completed'
                ? 'bg-green-500'
                : testStatus === 'stopped'
                ? 'bg-yellow-500'
                : 'bg-gray-700'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          <span>VUs: <strong className="text-white">{s?.activeVUs ?? 0}</strong> / {config.vuCount}</span>
          <span>Ramp: <strong className="text-white">{config.rampUp}s</strong></span>
          <span>Rate cap: <strong className="text-white">{config.rateCap > 0 ? `${config.rateCap} req/s` : 'unlimited'}</strong></span>
        </div>
      </div>

      {/* Big counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <BigStat
          label="Req / sec"
          value={s?.requestsPerSecond ?? 0}
          color="text-indigo-400"
        />
        <BigStat
          label="Total Requests"
          value={(s?.totalRequests ?? 0).toLocaleString()}
        />
        <BigStat
          label="p95 Latency"
          value={s ? `${s.p95}ms` : '—'}
          color={s && s.p95 > 1000 ? 'text-red-400' : s && s.p95 > 500 ? 'text-yellow-400' : 'text-green-400'}
          sub={s ? `p50: ${s.p50}ms  p99: ${s.p99}ms` : undefined}
        />
        <BigStat
          label="Avg Latency"
          value={s ? `${s.avgLatency}ms` : '—'}
          color="text-gray-300"
        />
      </div>

      {/* Status code breakdown */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Response Breakdown
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <StatusPill
            label="2xx Success"
            count={s?.status2xx ?? 0}
            total={s?.totalRequests ?? 0}
            color="bg-green-500"
            textColor="text-green-400"
          />
          <StatusPill
            label="429 Rate Limited"
            count={s?.status429 ?? 0}
            total={s?.totalRequests ?? 0}
            color="bg-yellow-500"
            textColor="text-yellow-400"
          />
          <StatusPill
            label="4xx Client Error"
            count={s?.status4xx ?? 0}
            total={s?.totalRequests ?? 0}
            color="bg-orange-500"
            textColor="text-orange-400"
          />
          <StatusPill
            label="5xx Server Error"
            count={s?.status5xx ?? 0}
            total={s?.totalRequests ?? 0}
            color="bg-red-500"
            textColor="text-red-400"
          />
          <StatusPill
            label="Network Errors"
            count={s?.networkErrors ?? 0}
            total={s?.totalRequests ?? 0}
            color="bg-purple-500"
            textColor="text-purple-400"
            hint="Timeouts / connection refused / Cloudflare blocks"
          />
        </div>

        {s && s.totalRequests > 0 && (
          <div className="flex gap-1 h-3 rounded-full overflow-hidden">
            <div
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${(s.status2xx / s.totalRequests) * 100}%` }}
            />
            <div
              className="bg-yellow-500 transition-all duration-500"
              style={{ width: `${(s.status429 / s.totalRequests) * 100}%` }}
            />
            <div
              className="bg-orange-500 transition-all duration-500"
              style={{ width: `${(s.status4xx / s.totalRequests) * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${(s.status5xx / s.totalRequests) * 100}%` }}
            />
            <div
              className="bg-purple-500 transition-all duration-500"
              style={{ width: `${(s.networkErrors / s.totalRequests) * 100}%` }}
            />
          </div>
        )}

        <div className="flex gap-4 text-xs">
          <span className="text-gray-500">
            Error rate:{' '}
            <strong
              className={
                Number(errorRate) > 5
                  ? 'text-red-400'
                  : Number(errorRate) > 2
                  ? 'text-yellow-400'
                  : 'text-green-400'
              }
            >
              {errorRate}%
            </strong>
          </span>
          <span className="text-gray-500">
            429 rate:{' '}
            <strong
              className={Number(rate429) > 30 ? 'text-yellow-400' : 'text-gray-300'}
            >
              {rate429}%
            </strong>
          </span>
        </div>
      </div>
    </div>
  )
}

function StatusPill({
  label,
  count,
  total,
  color,
  textColor,
  hint,
}: {
  label: string
  count: number
  total: number
  color: string
  textColor: string
  hint?: string
}) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
  return (
    <div className="flex flex-col gap-1" title={hint}>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <span className={`text-xl font-bold font-mono ${textColor}`}>
        {count.toLocaleString()}
      </span>
      <span className="text-[10px] text-gray-600">{pct}% of total</span>
      {hint && <span className="text-[9px] text-gray-700 leading-tight">{hint}</span>}
    </div>
  )
}
