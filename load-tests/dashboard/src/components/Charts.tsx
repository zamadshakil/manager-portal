import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from 'recharts'
import type { MetricsSnapshot } from '../types'

interface Props {
  metrics: MetricsSnapshot[]
}

const TICK_STYLE = { fill: '#6b7280', fontSize: 11 }

function ChartCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-2">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {title}
      </h3>
      {children}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs space-y-1">
      <p className="text-gray-400">{label}s elapsed</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <strong>{p.value}</strong>
          {p.name?.includes('ms') || p.name?.includes('Latency') ? '' : ''}
        </p>
      ))}
    </div>
  )
}

export function Charts({ metrics }: Props) {
  const data = metrics.map((m) => ({
    elapsed: m.elapsed,
    rps: m.requestsPerSecond,
    p50: m.p50,
    p95: m.p95,
    p99: m.p99,
    avg: m.avgLatency,
    errors: m.errors,
    vus: m.activeVUs,
    s2xx: m.status2xx,
    s429: m.status429,
    s4xx: m.status4xx - m.status429,
    s5xx: m.status5xx,
  }))

  if (data.length === 0) {
    return (
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-8 text-center text-gray-600 text-sm">
        Charts will appear here once the test starts
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {/* Requests per second */}
      <ChartCard title="Requests / sec">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="rpsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="elapsed"
              tick={TICK_STYLE}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis tick={TICK_STYLE} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="rps"
              name="Req/s"
              stroke="#6366f1"
              fill="url(#rpsGrad)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Response time percentiles */}
      <ChartCard title="Response Time (ms)">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="elapsed"
              tick={TICK_STYLE}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis tick={TICK_STYLE} unit="ms" />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
            />
            <Line
              type="monotone"
              dataKey="p50"
              name="p50"
              stroke="#22c55e"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="p95"
              name="p95"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="p99"
              name="p99"
              stroke="#ef4444"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 2"
            />
            <Line
              type="monotone"
              dataKey="avg"
              name="avg"
              stroke="#6b7280"
              strokeWidth={1}
              dot={false}
              strokeDasharray="2 2"
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Active VUs */}
      <ChartCard title="Active Virtual Users">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="vuGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="elapsed"
              tick={TICK_STYLE}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis tick={TICK_STYLE} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="vus"
              name="Active VUs"
              stroke="#a78bfa"
              fill="url(#vuGrad)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Status code distribution over time */}
      <ChartCard title="Status Codes (cumulative)">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="elapsed"
              tick={TICK_STYLE}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis tick={TICK_STYLE} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            <Line
              type="monotone"
              dataKey="s2xx"
              name="2xx"
              stroke="#22c55e"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="s429"
              name="429"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="s4xx"
              name="4xx"
              stroke="#f97316"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="s5xx"
              name="5xx"
              stroke="#ef4444"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
