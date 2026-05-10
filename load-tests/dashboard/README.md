# Load Test Dashboard

A standalone browser-based load testing dashboard for `system.zamdevai.com`.
Fires real HTTP requests from a Node.js backend with live real-time charts.

## Quick Start

### 1. Install dependencies

```bash
cd load-tests/dashboard
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in 2 values from your `manager-portal/.env.local`:

```env
VITE_TARGET_URL=https://system.zamdevai.com       # already set

VITE_SUPABASE_URL=<paste NEXT_PUBLIC_SUPABASE_URL>
VITE_SUPABASE_ANON_KEY=<paste NEXT_PUBLIC_SUPABASE_ANON_KEY>
```

### 3. Run

```bash
pnpm dev
```

Opens:
- **UI** → http://localhost:5173
- **API backend** → http://localhost:4000

### 4. Use the dashboard

1. **Sign In** — enter your portal admin email/password. A JWT is fetched automatically.
2. **Pick an endpoint** — choose from the presets or type a custom path.
3. **Set load shape** — adjust VU count (1–1000), duration, ramp-up, rate cap, think time.
4. **Set thresholds** — define pass/fail SLOs (e.g. p95 < 800ms).
5. **Start Test** — watch real-time charts update every second.
6. **Review results** — see the final pass/fail report with threshold evaluation.

---

## Controls reference

| Control | What it does |
|---|---|
| **VUs** | Number of virtual users sending concurrent requests |
| **Duration** | How long the test runs (seconds) |
| **Ramp-up** | Time to gradually reach full VU count (0 = instant) |
| **Rate cap** | Maximum total requests/sec (0 = unlimited, let VUs run free) |
| **Think time** | Pause between each request per VU (simulates real user behaviour) |

## Rate limits in system.zamdevai.com

These are expected to fire under heavy load — tracked separately in the dashboard:

| Endpoint | Limit |
|---|---|
| POST `/api/messaging/messages` | 60 msg/user/min |
| POST `/api/smart-ai/chat` | 30 queries/user/min |
| POST `/api/messaging/upload/*` | 20 uploads/user/min |

429s are displayed as their own series so you can distinguish rate-limit ceiling from real errors.

## Architecture

```
load-tests/dashboard/
  server/           Express backend (port 4000) — runs load tests, proxies auth
    index.ts        REST API + SSE stream
    load-engine.ts  Concurrent fetch engine with token-bucket rate cap
    auth.ts         Supabase password login → JWT
    sse.ts          Server-Sent Events channel
  src/              Vite React frontend (port 5173)
    App.tsx         Main layout + SSE listener
    components/
      LoginForm     Supabase auth form
      ConfigPanel   All load shape controls + endpoint picker
      ThresholdEditor  Pass/fail SLO editor
      MetricsPanel  Live counters + progress bar + status breakdown
      Charts        4 live Recharts charts (req/s, latency, VUs, status codes)
```
