import type { TestConfig, Threshold, TestResult } from '../types'

export async function apiLogin(
  email: string,
  password: string,
): Promise<{ access_token: string; user: { id: string; email: string } }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Login failed')
  return data
}

export async function apiStartTest(
  config: TestConfig,
  thresholds: Threshold[],
): Promise<void> {
  const res = await fetch('/api/test/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, thresholds }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to start test')
}

export async function apiStopTest(): Promise<void> {
  await fetch('/api/test/stop', { method: 'DELETE' })
}

export async function apiGetStatus(): Promise<{
  status: string
  result: TestResult | null
}> {
  const res = await fetch('/api/test/status')
  return res.json()
}
