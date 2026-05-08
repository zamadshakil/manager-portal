# Hierarchia — AI Model Strategy & Comparison Guide

> **Client Delivery Document** | Version 1.0 | May 2026  
> **Prepared by:** JobFlowAI Engineering

---

## 1. Executive Summary

Hierarchia's AI layer is built on **OpenRouter** — a universal API gateway that provides a single key to access 300+ AI models from every major provider (OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, and more). This architectural decision means the client can **switch or combine AI models without any code changes** — every model choice is an environment variable, not a deployment.

This document covers:
- Which models are already integrated and used today
- Which additional models are compatible and ready to activate
- A side-by-side comparison of cost, quality, and speed
- Recommended configurations for different business priorities

---

## 2. Current AI Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Hierarchia Portal (Next.js)                  │
│                                                                   │
│  Smart AI Chat ──────────────────────────────► OpenRouter Gateway │
│  (streaming + tool calling)                           │           │
│                                                       │           │
│  Validation Pipeline ────────────────────────────────┤           │
│  (structured JSON output, parallel per-rule)          │           │
│                                                       │           │
│  Summarization ──────────────────────────────────────┤           │
│  (executive summary + risk flags)                     │           │
│                                                       │           │
│  Vision / OCR ───────────────────────────────────────┘           │
│  (image & scanned PDF extraction)                                 │
│                                                                   │
│  Embeddings ─────────────────────────────────► OpenAI / OpenRouter│
│  (vector search via pgvector)                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Model Configuration (All Environment Variables)

| Role | Env Variable | Current Default | Swappable Without Code? |
|------|-------------|-----------------|------------------------|
| Smart AI Chat | `SMART_AI_MODEL` | `anthropic/claude-sonnet-4-5` | ✅ Yes — any OpenRouter model |
| Validation Rules | `VALIDATION_MODEL` | `google/gemini-2.0-flash-001` | ✅ Yes — any OpenRouter model |
| Summarization | `SUMMARY_MODEL` | `google/gemini-2.0-flash-001` | ✅ Yes — any OpenRouter model |
| Vision / OCR | `VISION_MODEL` | `google/gemini-2.0-flash-001` | ✅ Yes — multimodal models only |
| Embeddings | `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | ⚠️ Partial — must stay 1536-dim* |

> **Note on Embeddings**: The pgvector database schema stores 1536-dimensional vectors. Switching to a different embedding provider requires a one-time database migration to re-index all documents. OpenAI's `text-embedding-3-small` and `text-embedding-3-large` (requires column resize to 3072d) are the recommended options.

---

## 3. Models Already Installed & Available Today

The following SDKs are **already installed** in the project (`package.json`). Models from these providers can be activated directly, either via OpenRouter or via their native SDK — no `npm install` required.

| SDK Package | Provider | Status |
|-------------|----------|--------|
| `@ai-sdk/openai` | OpenAI (GPT-4o, o3, etc.) | ✅ Installed |
| `@ai-sdk/google` | Google Gemini (1.5, 2.0, 2.5) | ✅ Installed |
| `@ai-sdk/groq` | Groq (ultra-fast Llama / Mixtral) | ✅ Installed |
| Via OpenRouter | Anthropic, Meta, Mistral, DeepSeek, Qwen | ✅ Active Gateway |

---

## 4. Compatible Models — Full Catalogue

### 4.1 Smart AI Chat (`SMART_AI_MODEL`)

These models support **streaming text + tool/function calling** — the two hard requirements for Smart AI Chat.

| Model | Provider | OpenRouter Slug | Tier | Notes |
|-------|----------|----------------|------|-------|
| **Claude Sonnet 4.5** *(current)* | Anthropic | `anthropic/claude-sonnet-4-5` | Premium | Best overall reasoning + tool use |
| **Claude 3.5 Haiku** | Anthropic | `anthropic/claude-3-5-haiku` | Budget | 3× faster, 80% cheaper than Sonnet |
| **Claude Opus 4.5** | Anthropic | `anthropic/claude-opus-4-5` | Ultra | Highest intelligence, max cost |
| **GPT-4o** | OpenAI | `openai/gpt-4o` | Premium | Excellent tool calling, multimodal |
| **GPT-4o-mini** | OpenAI | `openai/gpt-4o-mini` | Budget | Extremely cheap, solid for simple queries |
| **o3-mini** | OpenAI | `openai/o3-mini` | Reasoning | Step-by-step reasoning tasks |
| **Gemini 2.5 Pro** | Google | `google/gemini-2.5-pro-preview` | Premium | 1M token context window |
| **Gemini 2.5 Flash** | Google | `google/gemini-2.5-flash-preview` | Budget | Fastest Google model, very cheap |
| **Llama 3.3 70B** | Meta (via OpenRouter) | `meta-llama/llama-3.3-70b-instruct` | Budget | Open source, no data-sharing concerns |
| **Llama 3.3 70B (Groq)** | Meta (via Groq SDK) | native `@ai-sdk/groq` | Speed | Sub-300ms response, ideal for high-volume |
| **DeepSeek R1** | DeepSeek | `deepseek/deepseek-r1` | Budget | Exceptional at structured reasoning, very low cost |
| **Mistral Large** | Mistral | `mistralai/mistral-large-2411` | Premium | EU-hosted option, GDPR-native |

---

### 4.2 Validation & Summarization (`VALIDATION_MODEL`, `SUMMARY_MODEL`)

These models must support **structured JSON output** (`generateObject` in Vercel AI SDK). Vision requirement is separate (see 4.3).

| Model | Provider | OpenRouter Slug | Structured Output | Speed | Cost |
|-------|----------|----------------|-------------------|-------|------|
| **Gemini 2.0 Flash** *(current)* | Google | `google/gemini-2.0-flash-001` | ✅ Excellent | Fast | Very Low |
| **Gemini 2.5 Flash** | Google | `google/gemini-2.5-flash-preview` | ✅ Excellent | Very Fast | Very Low |
| **GPT-4o-mini** | OpenAI | `openai/gpt-4o-mini` | ✅ Excellent | Fast | Low |
| **GPT-4o** | OpenAI | `openai/gpt-4o` | ✅ Excellent | Medium | Medium |
| **Claude 3.5 Haiku** | Anthropic | `anthropic/claude-3-5-haiku` | ✅ Good | Fast | Low |
| **Llama 3.3 70B** | Meta | `meta-llama/llama-3.3-70b-instruct` | ✅ Good | Fast | Very Low |
| **DeepSeek R1** | DeepSeek | `deepseek/deepseek-r1` | ✅ Good | Medium | Very Low |
| **Mistral Large** | Mistral | `mistralai/mistral-large-2411` | ✅ Good | Medium | Low |

---

### 4.3 Vision / OCR (`VISION_MODEL`)

These models must accept **image input** alongside text. Used for processing image uploads and scanned PDF pages.

| Model | Provider | OpenRouter Slug | OCR Quality | Speed | Notes |
|-------|----------|----------------|-------------|-------|-------|
| **Gemini 2.0 Flash** *(current)* | Google | `google/gemini-2.0-flash-001` | ⭐⭐⭐⭐ | Fast | Excellent handwriting & table recognition |
| **Gemini 2.5 Pro** | Google | `google/gemini-2.5-pro-preview` | ⭐⭐⭐⭐⭐ | Medium | Best accuracy, especially complex layouts |
| **GPT-4o** | OpenAI | `openai/gpt-4o` | ⭐⭐⭐⭐ | Medium | Very reliable, strong at mixed content |
| **Claude 3.5 Sonnet** | Anthropic | `anthropic/claude-sonnet-4-5` | ⭐⭐⭐⭐ | Medium | Good at structured documents |
| **Llama 4 Scout** | Meta | `meta-llama/llama-4-scout` | ⭐⭐⭐ | Fast | Open source multimodal, budget option |

---

## 5. Cost Comparison (Per-Pipeline Estimates)

> All prices are **approximate OpenRouter rates** as of May 2026 in **USD per 1 million tokens**. Prices vary by traffic tier and are subject to change — verify at [openrouter.ai/models](https://openrouter.ai/models).

### 5.1 Smart AI Chat Cost per Conversation

Assumptions: ~2,000 input tokens (system prompt + history) + ~500 output tokens per exchange.

| Model | Input $/1M | Output $/1M | Cost per Message | Monthly (1,000 msgs) |
|-------|-----------|------------|-----------------|---------------------|
| GPT-4o-mini | $0.15 | $0.60 | **~$0.0006** | ~$0.60 |
| Gemini 2.5 Flash | $0.15 | $0.60 | **~$0.0006** | ~$0.60 |
| Claude 3.5 Haiku | $0.80 | $4.00 | **~$0.0036** | ~$3.60 |
| Llama 3.3 70B | $0.12 | $0.30 | **~$0.0004** | ~$0.40 |
| DeepSeek R1 | $0.14 | $0.28 | **~$0.0004** | ~$0.40 |
| **Claude Sonnet 4.5** *(current)* | $3.00 | $15.00 | **~$0.0135** | ~$13.50 |
| GPT-4o | $2.50 | $10.00 | **~$0.0100** | ~$10.00 |
| Claude Opus 4.5 | $15.00 | $75.00 | **~$0.0675** | ~$67.50 |

---

### 5.2 Validation Pipeline Cost per Document

Assumptions: ~1,500 tokens input (document excerpt + rule prompt) + ~200 tokens output per rule. Average 3 rules per submission.

| Model | Cost per Rule | Cost per Document (3 rules) | Monthly (500 docs) |
|-------|-------------|---------------------------|-------------------|
| **Gemini 2.0 Flash** *(current)* | ~$0.0002 | **~$0.0006** | ~$0.30 |
| Gemini 2.5 Flash | ~$0.0002 | **~$0.0006** | ~$0.30 |
| GPT-4o-mini | ~$0.0003 | **~$0.0009** | ~$0.45 |
| Llama 3.3 70B | ~$0.0002 | **~$0.0006** | ~$0.30 |
| DeepSeek R1 | ~$0.0002 | **~$0.0006** | ~$0.30 |
| GPT-4o | ~$0.0038 | **~$0.0113** | ~$5.65 |
| Claude Sonnet 4.5 | ~$0.0045 | **~$0.0135** | ~$6.75 |

> **Key Insight**: The current validation setup (Gemini 2.0 Flash) is already among the most cost-efficient options. The main opportunity for cost reduction is in the Smart AI Chat model — switching from Claude Sonnet to a budget model like GPT-4o-mini or Gemini 2.5 Flash saves **95%+ on chat costs** with minimal quality trade-off for routine queries.

---

## 6. Quality Comparison

> Ratings are based on public benchmarks (MMLU, HumanEval, MATH) + Hierarchia-specific task performance profiles.

### 6.1 Chat / Reasoning Quality

| Model | General Reasoning | Tool Calling | Document Analysis | Code | Context Window |
|-------|-----------------|-------------|------------------|------|----------------|
| **Claude Opus 4.5** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 200K tokens |
| **Claude Sonnet 4.5** *(current)* | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 200K tokens |
| **GPT-4o** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 128K tokens |
| **Gemini 2.5 Pro** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 1M tokens |
| **DeepSeek R1** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 128K tokens |
| **Claude 3.5 Haiku** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 200K tokens |
| **GPT-4o-mini** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 128K tokens |
| **Gemini 2.5 Flash** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 1M tokens |
| **Llama 3.3 70B** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 128K tokens |

---

### 6.2 Structured Output Reliability (Validation Pipeline)

The validation pipeline uses `generateObject` which requires the model to reliably produce schema-conformant JSON. Failure here causes validation to fail.

| Model | JSON Reliability | Notes |
|-------|----------------|-------|
| **Gemini 2.0 Flash** *(current)* | ✅ Excellent | Native JSON mode, schema enforcement |
| Gemini 2.5 Flash | ✅ Excellent | Improved over 2.0 |
| GPT-4o / GPT-4o-mini | ✅ Excellent | OpenAI Structured Outputs |
| Claude models | ✅ Very Good | Tool-use JSON mode |
| Llama 3.3 70B | ⚠️ Good | Occasional schema drift on complex rules |
| DeepSeek R1 | ⚠️ Good | Best for reasoning steps, occasional drift |
| Mistral Large | ✅ Good | Reliable JSON mode |

---

## 7. Speed / Efficiency Comparison

> Response time measurements are approximate medians under normal load. Latency varies by region, token count, and provider load.

### 7.1 Time-to-First-Token (Smart AI Chat)

| Model | Median TTFT | Throughput (tokens/sec) | Rating |
|-------|------------|------------------------|--------|
| Llama 3.3 70B (via **Groq SDK**) | ~100–250ms | ~800 t/s | ⚡⚡⚡⚡⚡ Instant |
| GPT-4o-mini | ~300–500ms | ~150 t/s | ⚡⚡⚡⚡ Very Fast |
| Gemini 2.5 Flash | ~300–600ms | ~200 t/s | ⚡⚡⚡⚡ Very Fast |
| Claude 3.5 Haiku | ~400–700ms | ~180 t/s | ⚡⚡⚡ Fast |
| **Claude Sonnet 4.5** *(current)* | ~600–1200ms | ~120 t/s | ⚡⚡⚡ Fast |
| GPT-4o | ~500–1000ms | ~100 t/s | ⚡⚡⚡ Fast |
| DeepSeek R1 | ~800–1500ms | ~60 t/s | ⚡⚡ Medium |
| Gemini 2.5 Pro | ~1000–2000ms | ~80 t/s | ⚡⚡ Medium |
| Claude Opus 4.5 | ~1500–3000ms | ~50 t/s | ⚡ Slow |

### 7.2 Validation Pipeline Throughput

Since validation runs **parallel per rule**, total document processing time is bounded by the slowest rule, not the sum.

| Model | Per-rule Latency | Docs/min (3 rules, 5 concurrent) | Rating |
|-------|-----------------|----------------------------------|--------|
| **Gemini 2.0 Flash** *(current)* | ~800–1200ms | ~15 docs/min | ⚡⚡⚡⚡⚡ |
| Gemini 2.5 Flash | ~700–1000ms | ~18 docs/min | ⚡⚡⚡⚡⚡ |
| GPT-4o-mini | ~600–900ms | ~20 docs/min | ⚡⚡⚡⚡⚡ |
| Llama 3.3 70B (Groq) | ~200–400ms | ~40 docs/min | ⚡⚡⚡⚡⚡ |
| GPT-4o | ~1000–1800ms | ~8 docs/min | ⚡⚡⚡ |
| Claude Haiku | ~800–1400ms | ~12 docs/min | ⚡⚡⚡⚡ |

---

## 8. Recommended Configurations by Business Priority

### Option A: Maximum Quality (Enterprise / High-Stakes Validation)
> **Use case**: Large organizations where document quality matters most; compliance-sensitive industries.

| Role | Model | Rationale |
|------|-------|-----------|
| Smart AI Chat | `anthropic/claude-opus-4-5` | Best reasoning for complex queries |
| Validation | `openai/gpt-4o` | Rock-solid structured output, excellent at nuanced rules |
| Summarization | `openai/gpt-4o` | Best executive summaries |
| Vision / OCR | `google/gemini-2.5-pro-preview` | Highest accuracy on complex document images |
| Embeddings | `openai/text-embedding-3-small` | Unchanged |

**Estimated cost uplift**: ~8–12× the current baseline.

---

### Option B: Balanced Quality + Cost *(current default)*
> **Use case**: Standard business use; good quality at reasonable cost.

| Role | Model | Rationale |
|------|-------|-----------|
| Smart AI Chat | `anthropic/claude-sonnet-4-5` | Excellent quality, manageable cost |
| Validation | `google/gemini-2.0-flash-001` | Fast, cheap, reliable structured output |
| Summarization | `google/gemini-2.0-flash-001` | Same |
| Vision / OCR | `google/gemini-2.0-flash-001` | Native multimodal, great OCR |
| Embeddings | `openai/text-embedding-3-small` | Unchanged |

**Index cost**: Baseline (1.0×).

---

### Option C: Cost-Optimized (High Volume / Startup Budget)
> **Use case**: Maximizing number of users/documents processed within a tight AI budget.

| Role | Model | Rationale |
|------|-------|-----------|
| Smart AI Chat | `google/gemini-2.5-flash-preview` | 95% cheaper than Sonnet, strong quality |
| Validation | `google/gemini-2.5-flash-preview` | Marginally better than 2.0, same price |
| Summarization | `google/gemini-2.5-flash-preview` | Same |
| Vision / OCR | `google/gemini-2.5-flash-preview` | Same |
| Embeddings | `openai/text-embedding-3-small` | Unchanged |

**Estimated cost reduction**: ~85–90% vs current baseline.

---

### Option D: Privacy-First (On-Prem / EU GDPR)
> **Use case**: Organizations requiring data residency in the EU or no data-sharing with US providers.

| Role | Model | Rationale |
|------|-------|-----------|
| Smart AI Chat | `mistralai/mistral-large-2411` | EU-based provider, GDPR-native |
| Validation | `mistralai/mistral-large-2411` | Same |
| Summarization | `mistralai/mistral-large-2411` | Same |
| Vision / OCR | `openai/gpt-4o` *(via OpenRouter EU routing)* | Mistral lacks strong vision today |
| Embeddings | `openai/text-embedding-3-small` | Unchanged (or switch to Mistral Embed) |

**Notes**: Mistral AI is headquartered in Paris and processes data in EU data centers. OpenRouter also supports EU region routing.

---

### Option E: Maximum Speed (High-Frequency Real-Time Use)
> **Use case**: Very high submission volume where validation latency is a bottleneck; live events.

| Role | Model | Provider | Rationale |
|------|-------|----------|-----------|
| Smart AI Chat | `llama-3.3-70b-versatile` | **Groq SDK** (direct) | Sub-300ms responses via Groq's LPU hardware |
| Validation | `llama-3.3-70b-versatile` | **Groq SDK** (direct) | ~200ms per rule — fastest available |
| Summarization | `llama-3.3-70b-versatile` | **Groq SDK** (direct) | Same |
| Vision / OCR | `google/gemini-2.0-flash-001` | OpenRouter | Llama lacks vision; Gemini Flash kept |
| Embeddings | `openai/text-embedding-3-small` | OpenAI | Unchanged |

**Notes**: `@ai-sdk/groq` is already installed. Requires a Groq API key (`GROQ_API_KEY`). Groq's free tier is generous for testing.

---

## 9. How to Switch Models (Technical Reference)

All model changes are **environment variable updates** — no code deployment required. Update in Railway dashboard (or `.env.local` for local testing).

```bash
# Smart AI Chat — switch to GPT-4o-mini (cost-optimized)
SMART_AI_MODEL=openai/gpt-4o-mini

# Smart AI Chat — switch to Gemini 2.5 Flash (speed + cost)
SMART_AI_MODEL=google/gemini-2.5-flash-preview

# Validation — upgrade to Gemini 2.5 Flash
VALIDATION_MODEL=google/gemini-2.5-flash-preview
SUMMARY_MODEL=google/gemini-2.5-flash-preview
VISION_MODEL=google/gemini-2.5-flash-preview

# Run A/B test: different models for validation vs chat
SMART_AI_MODEL=anthropic/claude-sonnet-4-5    # Keep quality chat
VALIDATION_MODEL=google/gemini-2.5-flash-preview  # Cheaper validation
```

> **Zero-downtime**: Railway environment variable changes take effect on the next request. A service restart is recommended but not strictly required.

---

## 10. Future Model Additions (Roadmap)

The following models are **not yet integrated** but are architecturally compatible and can be added in a future sprint:

| Model | Provider | Why It's Interesting | Integration Effort |
|-------|----------|---------------------|-------------------|
| **Claude 4 Sonnet / Opus** | Anthropic | Next generation releases | Low — env var only |
| **GPT-5** | OpenAI | Next OpenAI flagship | Low — env var only |
| **Gemini 3.0** | Google | Google's next gen | Low — env var only |
| **Llama 4 Scout/Maverick** | Meta | New multimodal open model | Low — env var (vision support) |
| **Mistral Embed** | Mistral | EU embedding alternative | Medium — pgvector migration |
| **Custom fine-tuned model** | Any | Organization-specific rules | High — fine-tuning pipeline |
| **Self-hosted Ollama** | Any open source | Full on-prem, zero API cost | High — infrastructure setup |

---

## 11. AI Credit System

Hierarchia includes a **per-user AI credit quota system** that gives the organization full visibility and control over AI spend:

- **Per-user limits**: Each user has a configurable monthly/weekly/daily credit allowance
- **Admin controls**: Main admins can set, raise, or restrict any user's AI credits from the dashboard
- **Auto-reset**: Credit periods reset automatically — no manual intervention needed
- **Near-limit alerts**: Users receive proactive warnings when 90%+ of their quota is consumed
- **Usage tracking**: Full history of credit consumption per user accessible at `/dashboard/ai-usage`
- **Model-agnostic**: Credit counting works regardless of which underlying model is active

> This system makes it practical to offer premium models (e.g. Claude Opus) to power users while keeping budget models (e.g. Gemini Flash) as the default for the wider team — all from the same admin interface.

---

## 12. Summary Decision Matrix

| Priority | Recommended Config | Monthly AI Cost (500 docs + 1K chat msgs) |
|----------|-------------------|------------------------------------------|
| **Maximum Quality** | Claude Opus + GPT-4o + Gemini 2.5 Pro | ~$80–$120 |
| **Balanced** *(current)* | Claude Sonnet + Gemini 2.0 Flash | ~$15–$25 |
| **Cost-Optimized** | Gemini 2.5 Flash (all roles) | ~$2–$5 |
| **Privacy-First (EU)** | Mistral Large (all roles) | ~$20–$35 |
| **Maximum Speed** | Groq Llama 3.3 70B | ~$1–$3 |

> All costs assume standard OpenRouter rates. Volume discounts apply for high-traffic deployments. Contact OpenRouter or individual providers for enterprise pricing.

---

*Previous: [06 — Presentation Guide](./06_PRESENTATION_GUIDE.md)*  
*Back to index: [README](./README.md)*
