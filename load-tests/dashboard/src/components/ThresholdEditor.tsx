import type { Threshold } from '../types'

interface Props {
  thresholds: Threshold[]
  setThresholds: (t: Threshold[]) => void
}

const METRIC_LABELS: Record<Threshold['metric'], string> = {
  p95: 'p95 latency (ms)',
  p99: 'p99 latency (ms)',
  error_rate: 'Error rate (%)',
  rate_429: '429 rate (%)',
}

export function ThresholdEditor({ thresholds, setThresholds }: Props) {
  const update = (id: string, patch: Partial<Threshold>) =>
    setThresholds(thresholds.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const remove = (id: string) =>
    setThresholds(thresholds.filter((t) => t.id !== id))

  const add = () =>
    setThresholds([
      ...thresholds,
      {
        id: crypto.randomUUID(),
        metric: 'p95',
        operator: 'lt',
        value: 1000,
        label: 'p95 < 1000ms',
      },
    ])

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white text-sm">Pass / Fail Thresholds</h2>
        <button
          onClick={add}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          + Add
        </button>
      </div>

      {thresholds.length === 0 && (
        <p className="text-xs text-gray-500 italic">No thresholds — all results will pass</p>
      )}

      <div className="space-y-2">
        {thresholds.map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-xs">
            <select
              value={t.metric}
              onChange={(e) =>
                update(t.id, { metric: e.target.value as Threshold['metric'] })
              }
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {Object.entries(METRIC_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <select
              value={t.operator}
              onChange={(e) =>
                update(t.id, {
                  operator: e.target.value as Threshold['operator'],
                })
              }
              className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="lt">&lt;</option>
              <option value="gt">&gt;</option>
            </select>

            <input
              type="number"
              value={t.value}
              min={0}
              onChange={(e) => update(t.id, { value: Number(e.target.value) })}
              className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            <button
              onClick={() => remove(t.id)}
              className="text-gray-600 hover:text-red-400 transition-colors px-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
