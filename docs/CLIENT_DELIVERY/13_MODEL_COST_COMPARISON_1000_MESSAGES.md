# Gemini 3.1 Pro vs Claude Sonnet 4.5 Cost Comparison

## Purpose

Estimate the cost of using `google/gemini-3.1-pro-preview` and `anthropic/claude-sonnet-4-5` over **1,000 messages**.

## Important Note

LLM pricing is **token-based**, not message-based. That means there is no single exact cost for 1,000 messages unless we also define the average:

- input tokens per message
- output tokens per message

This document uses current OpenRouter pricing and shows several realistic scenarios.

## Pricing Used

Source checked on **2026-05-12** from OpenRouter model pages:

- **Gemini 3.1 Pro Preview**
  - Input: **$2.00 / 1M tokens**
  - Output: **$12.00 / 1M tokens**
  - Source: `https://openrouter.ai/google/gemini-3.1-pro-preview`

- **Claude Sonnet 4.5**
  - Input: **$3.00 / 1M tokens**
  - Output: **$15.00 / 1M tokens**
  - Source: `https://openrouter.ai/anthropic/claude-sonnet-4.5`

## Formula

For **1,000 messages**:

```text
Total cost = ((input_tokens_per_message × 1000) / 1,000,000 × input_rate)
           + ((output_tokens_per_message × 1000) / 1,000,000 × output_rate)
```

## 1,000-Message Scenarios

### Scenario A: Light usage

Assumption per message:

- Input: `1,000` tokens
- Output: `300` tokens

| Model | Input Cost | Output Cost | Total for 1,000 Messages |
|---|---:|---:|---:|
| Gemini 3.1 Pro Preview | $2.00 | $3.60 | **$5.60** |
| Claude Sonnet 4.5 | $3.00 | $4.50 | **$7.50** |

### Scenario B: Medium usage

Assumption per message:

- Input: `3,000` tokens
- Output: `800` tokens

| Model | Input Cost | Output Cost | Total for 1,000 Messages |
|---|---:|---:|---:|
| Gemini 3.1 Pro Preview | $6.00 | $9.60 | **$15.60** |
| Claude Sonnet 4.5 | $9.00 | $12.00 | **$21.00** |

### Scenario C: Heavy usage

Assumption per message:

- Input: `8,000` tokens
- Output: `2,000` tokens

| Model | Input Cost | Output Cost | Total for 1,000 Messages |
|---|---:|---:|---:|
| Gemini 3.1 Pro Preview | $16.00 | $24.00 | **$40.00** |
| Claude Sonnet 4.5 | $24.00 | $30.00 | **$54.00** |

## Simple Baseline Estimate

If you want one easy baseline for planning, use:

- Input: `2,000` tokens per message
- Output: `500` tokens per message

| Model | Total for 1,000 Messages |
|---|---:|
| Gemini 3.1 Pro Preview | **$10.00** |
| Claude Sonnet 4.5 | **$13.50** |

## What This Means For Your Pipeline

Your current pipeline defaults are:

- **Validation model**: `google/gemini-3.1-pro-preview`
- **Vision model**: `google/gemini-3.1-pro-preview`
- **Summary model**: `anthropic/claude-sonnet-4-5`

That is a sensible cost/quality split because:

- **Gemini 3.1 Pro** is cheaper for repeated validation calls
- **Claude Sonnet 4.5** is more expensive, so keeping it limited to summaries helps control cost

## Pipeline-Oriented Example

If we assume for **1,000 submissions**:

- `6` validation-rule calls per submission on Gemini
- `1` summary call per submission on Claude
- average rule call = `3,000` input / `400` output tokens
- average summary call = `2,000` input / `250` output tokens

Then the rough cost is:

### Validation on Gemini

Per rule call:

- Input: `3,000 × $2 / 1M` = `$0.0060`
- Output: `400 × $12 / 1M` = `$0.0048`
- Total per rule call = **$0.0108**

For `6,000` rule calls:

- **$64.80**

### Summaries on Claude

Per summary call:

- Input: `2,000 × $3 / 1M` = `$0.0060`
- Output: `250 × $15 / 1M` = `$0.00375`
- Total per summary call = **$0.00975**

For `1,000` summary calls:

- **$9.75**

### Combined illustrative total

- **$74.55 per 1,000 submissions**

## Recommendation

If cost matters:

- keep **Gemini 3.1 Pro** for validation and vision
- keep **Claude Sonnet 4.5** only for summaries or high-value review steps

If you want a stricter budget estimate next, the best next step is to calculate from your real pipeline averages:

- average extracted text size
- average number of rules per submission
- average summary output length
- percentage of submissions using the vision path
