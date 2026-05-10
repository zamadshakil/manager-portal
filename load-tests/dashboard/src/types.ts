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
  tokens?: string[]
}

export interface Threshold {
  id: string
  metric: 'p95' | 'p99' | 'error_rate' | 'rate_429'
  operator: 'lt' | 'gt'
  value: number
  label: string
}

export interface ThresholdResult extends Threshold {
  actual: number
  passed: boolean
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

export interface TestResult extends Omit<MetricsSnapshot, 'type'> {
  duration: number
  thresholds: ThresholdResult[]
}

export interface AuthState {
  token: string | null
  email: string | null
  loading: boolean
  error: string | null
}

export interface EndpointPreset {
  label: string
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT'
  path: string
  body?: unknown
  description: string
}

export type TestStatus = 'idle' | 'running' | 'completed' | 'stopped'

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    label: '🔬 Health check (no auth needed)',
    method: 'GET',
    path: '/api/health',
    description: 'Public health endpoint — use this to test raw infra throughput with no rate limits or auth overhead',
  },
  {
    label: 'List Conversations',
    method: 'GET',
    path: '/api/messaging/conversations',
    description: 'Fetch all conversations for the authenticated user',
  },
  {
    label: 'Fetch Messages',
    method: 'GET',
    path: '/api/messaging/messages?conv=00000000-0000-0000-0000-000000000000',
    description: 'GET messages for a conversation (replace UUID)',
  },
  {
    label: 'Send Message',
    method: 'POST',
    path: '/api/messaging/messages',
    body: {
      conversation_id: '00000000-0000-0000-0000-000000000000',
      content: 'Load test message',
      type: 'text',
    },
    description: 'POST a text message (replace conversation_id UUID)',
  },
  {
    label: 'Add Reaction',
    method: 'POST',
    path: '/api/messaging/messages/00000000-0000-0000-0000-000000000000/reactions',
    body: { emoji: '👍' },
    description: 'Toggle a reaction on a message (replace UUID)',
  },
  {
    label: 'AI Thread List',
    method: 'GET',
    path: '/api/smart-ai/threads',
    description: 'List Smart AI chat threads',
  },
  {
    label: 'AI Analytics',
    method: 'GET',
    path: '/api/smart-ai/analytics',
    description: 'Smart AI usage analytics dashboard data',
  },
  {
    label: 'AI Credits',
    method: 'GET',
    path: '/api/ai-credits/me',
    description: 'Current user AI credit quota',
  },
  {
    label: 'Custom endpoint',
    method: 'GET',
    path: '/api/',
    description: 'Enter any custom path below',
  },
]
