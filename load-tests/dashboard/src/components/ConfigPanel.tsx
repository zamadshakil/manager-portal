import { useState } from 'react'
import type { TestConfig } from '../types'
import { ENDPOINT_PRESETS } from '../types'

interface Props {
  config: TestConfig
  setConfig: (c: TestConfig) => void
  targetUrl: string
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  zero = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  zero?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-mono font-medium">
          {value === 0 && zero ? zero : `${value}${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-500 cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-gray-600">
        <span>{min === 0 && zero ? zero : `${min}${unit}`}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

export function ConfigPanel({ config, setConfig, targetUrl }: Props) {
  const [bodyText, setBodyText] = useState(
    config.body ? JSON.stringify(config.body, null, 2) : '',
  )
  const [bodyError, setBodyError] = useState('')
  const [customHeaders, setCustomHeaders] = useState('')

  const update = (patch: Partial<TestConfig>) =>
    setConfig({ ...config, ...patch })

  const handlePresetChange = (idx: number) => {
    const p = ENDPOINT_PRESETS[idx]
    const fullUrl = `${targetUrl}${p.path}`
    const body = p.body ?? undefined
    setBodyText(body ? JSON.stringify(body, null, 2) : '')
    setBodyError('')
    update({ url: fullUrl, method: p.method, body })
  }

  const handleBodyChange = (text: string) => {
    setBodyText(text)
    if (!text.trim()) {
      setBodyError('')
      update({ body: undefined })
      return
    }
    try {
      update({ body: JSON.parse(text) })
      setBodyError('')
    } catch {
      setBodyError('Invalid JSON')
    }
  }

  const handleHeadersChange = (text: string) => {
    setCustomHeaders(text)
    try {
      const parsed = text.trim()
        ? (JSON.parse(text) as Record<string, string>)
        : {}
      update({ headers: parsed })
    } catch {
      // ignore parse errors while typing
    }
  }

  const selectedPresetIdx = ENDPOINT_PRESETS.findIndex(
    (p) => config.url.endsWith(p.path) && config.method === p.method,
  )

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-4">
      <h2 className="font-semibold text-white text-sm">Configuration</h2>

      {/* Target URL */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Target URL</label>
        <input
          type="url"
          value={config.url}
          onChange={(e) => update({ url: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Endpoint preset */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Endpoint Preset
        </label>
        <select
          value={selectedPresetIdx}
          onChange={(e) => handlePresetChange(Number(e.target.value))}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {ENDPOINT_PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.method} — {p.label}
            </option>
          ))}
        </select>
        {selectedPresetIdx >= 0 && (
          <p className="text-[10px] text-gray-500 mt-1">
            {ENDPOINT_PRESETS[selectedPresetIdx]?.description}
          </p>
        )}
      </div>

      {/* Method + Path row */}
      <div className="flex gap-2">
        <div className="w-24">
          <label className="block text-xs font-medium text-gray-400 mb-1">Method</label>
          <select
            value={config.method}
            onChange={(e) => update({ method: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-400 mb-1">Path override</label>
          <input
            type="text"
            placeholder="/api/custom/path"
            value={config.url.replace(targetUrl, '')}
            onChange={(e) => update({ url: `${targetUrl}${e.target.value}` })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Request body */}
      {config.method !== 'GET' && config.method !== 'HEAD' && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Request Body (JSON)
          </label>
          <textarea
            rows={4}
            value={bodyText}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder='{"key": "value"}'
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
          {bodyError && (
            <p className="text-xs text-red-400 mt-1">{bodyError}</p>
          )}
        </div>
      )}

      {/* Custom headers */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Extra Headers (JSON object)
        </label>
        <textarea
          rows={2}
          value={customHeaders}
          onChange={(e) => handleHeadersChange(e.target.value)}
          placeholder='{"X-Custom": "value"}'
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />
      </div>

      <div className="border-t border-gray-800 pt-4 space-y-4">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Load Shape
        </h3>

        <Slider
          label="Virtual Users (VUs)"
          value={config.vuCount}
          min={1}
          max={1000}
          step={1}
          onChange={(v) => update({ vuCount: v })}
        />

        <Slider
          label="Duration"
          value={config.duration}
          min={10}
          max={600}
          unit="s"
          onChange={(v) => update({ duration: v })}
        />

        <Slider
          label="Ramp-up time"
          value={config.rampUp}
          min={0}
          max={120}
          unit="s"
          zero="instant"
          onChange={(v) => update({ rampUp: v })}
        />

        <Slider
          label="Max req/s (rate cap)"
          value={config.rateCap}
          min={0}
          max={500}
          zero="unlimited"
          onChange={(v) => update({ rateCap: v })}
        />

        <Slider
          label="Think time per VU"
          value={config.thinkTime}
          min={0}
          max={5000}
          step={50}
          unit="ms"
          zero="none"
          onChange={(v) => update({ thinkTime: v })}
        />
      </div>
    </div>
  )
}
