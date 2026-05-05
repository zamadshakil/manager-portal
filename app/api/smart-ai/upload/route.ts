import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { put } from "@/lib/r2"
import { extractText } from "@/lib/parse"
import { indexDocument } from "@/lib/smart-ai/indexer"
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"
import { uploadLimiter } from "@/lib/redis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Smart AI Upload Endpoint
 * ========================
 *
 *   1. Authenticate the user via Supabase session.
 *   2. Validate file size + MIME (defense-in-depth — the client validates too).
 *   3. Upload the raw bytes to Cloudflare R2 under a per-user prefix.
 *   4. Extract text content for vector indexing.
 *   5. Insert a row into `chat_documents` (RLS scopes it to auth.uid()).
 *   6. Push the parsed text to the RAG service. We deliberately await this
 *      and update `rag_status` to "completed" / "failed" so the UI can
 *      reflect indexing health without a second round-trip.
 *
 * The response shape matches what the chat panel expects:
 *
 *   { id, file_name, file_url, file_type, rag_status, thread_id }
 */

const ACCEPTED = new Set<string>(ACCEPTED_MIME_TYPES as readonly string[])

export async function POST(req: Request) {
  let profile: Awaited<ReturnType<typeof requireProfile>>
  try {
    profile = await requireProfile()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { success } = await uploadLimiter().limit(profile.id)
  if (!success) {
    return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const file = formData.get("file")
  const threadId = (formData.get("thread_id") as string | null) || null

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  // ---- 2. Validation ---------------------------------------------------
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `File exceeds the ${Math.round(
          MAX_FILE_SIZE_BYTES / (1024 * 1024),
        )} MB limit`,
      },
      { status: 413 },
    )
  }
  if (file.type && !ACCEPTED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 },
    )
  }

  try {
    // ---- 3. R2 upload -------------------------------------------------
    // Strip path separators from the filename so users can't escape the prefix.
    const safeName = file.name.replace(/[/\\]/g, "_").slice(0, 200)
    const path = `chat-documents/${profile.id}/${Date.now()}-${safeName}`
    const uploadResult = await put(path, file, {
      contentType: file.type,
      addRandomSuffix: false,
    })

    // ---- 4. Text extraction (best-effort) -----------------------------
    let parsedText = ""
    let parsedPages: number | undefined
    let parsedTruncated = false
    let parseWarning: string | undefined
    let parseFailed = false
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const parseResult = await extractText(buffer, file.type)
      parsedText = parseResult.text ?? ""
      parsedPages = parseResult.pages
      parsedTruncated = parseResult.truncated
      parseWarning = parseResult.warning
    } catch (parseErr) {
      console.error("[upload] parse failed", parseErr)
      parseWarning = "Text extraction failed; the document was uploaded but is not searchable yet."
      parseFailed = true
    }

    // ---- 5. DB row ----------------------------------------------------
    const supabase = await createClient()
    
    // Ensure the thread exists before referencing it to prevent FK violations.
    // The frontend mints thread IDs locally before any message is sent.
    if (threadId) {
      await supabase
        .from("chat_threads")
        .upsert(
          { id: threadId, user_id: profile.id, title: "New conversation" },
          { onConflict: "id", ignoreDuplicates: true }
        )
    }

    const { data: doc, error: dbError } = await supabase
      .from("chat_documents")
      .insert({
        user_id: profile.id,
        thread_id: threadId,
        file_name: file.name.replace(/\0/g, ""),
        file_url: uploadResult.pathname,
        file_type: file.type,
        rag_status: parseFailed ? "failed" : (parsedText.trim().length >= 16 ? "processing" : "skipped"),
        text_excerpt: parsedText ? parsedText.slice(0, 4_000) : null,
      })
      .select()
      .single()

    if (dbError || !doc) {
      console.error("[upload] DB insert failed", dbError)
      return NextResponse.json(
        { error: "Failed to save document metadata", detail: dbError?.message },
        { status: 500 },
      )
    }

    // ---- 6. RAG indexing ---------------------------------------------
    // We await so we can flip `rag_status` to "completed" / "failed" before
    // returning. Worst case it adds a few hundred ms to the upload — that
    // tradeoff is worth the clearer UX.
    let ragStatus: "completed" | "failed" | "skipped" = "skipped"
    if (parsedText.trim().length >= 16) {
      const indexResult = await indexDocument({
        source_type: "chat_attachment",
        source_id: doc.id,
        owner_id: profile.id,
        team_id: profile.team_id,
        title: file.name,
        content: parsedText,
        metadata: {
          file_url: uploadResult.pathname,
          file_type: file.type,
          pages: parsedPages,
          truncated: parsedTruncated,
          thread_id: threadId,
        },
      })
      if (indexResult.ok) {
        ragStatus = "completed"
      } else if (indexResult.reason === "disabled" || indexResult.reason?.startsWith("skipped")) {
        ragStatus = "skipped"
      } else {
        console.error("[upload] RAG indexing failed", indexResult.reason)
        ragStatus = "failed"
      }
    }

    if (ragStatus !== "skipped") {
      await supabase
        .from("chat_documents")
        .update({ rag_status: ragStatus, indexed_at: new Date().toISOString() })
        .eq("id", doc.id)
    }

    return NextResponse.json({
      id: doc.id,
      file_name: doc.file_name,
      file_url: doc.file_url,
      file_type: doc.file_type,
      thread_id: doc.thread_id,
      rag_status: ragStatus,
      pages: parsedPages,
      truncated: parsedTruncated,
      warning: parseWarning,
    })
  } catch (err: any) {
    console.error("[upload] unexpected error", err)
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    )
  }
}
