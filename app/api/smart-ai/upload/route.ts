import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { put } from "@/lib/r2"
import { extractText } from "@/lib/parse"
import { indexDocument } from "@/lib/smart-ai/indexer"

export const runtime = "nodejs"

/**
 * Smart AI Upload Endpoint
 * 
 * 1. Authenticates the user via Supabase session.
 * 2. Uploads the raw file to Cloudflare R2.
 * 3. Extracts text content for vector indexing.
 * 4. Stores metadata in the `chat_attachments` Postgres table.
 * 5. Pushes the content to the RAG service for semantic retrieval.
 */
export async function POST(req: Request) {
  try {
    const profile = await requireProfile()
    const formData = await req.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // 1. Upload to Cloudflare R2
    // We prefix with the user ID to prevent namespace collisions.
    const path = `chat-attachments/${profile.id}/${Date.now()}-${file.name}`
    const uploadResult = await put(path, file, { 
      contentType: file.type,
      addRandomSuffix: false // We already added timestamp
    })

    // 2. Extract text for RAG indexing
    const buffer = Buffer.from(await file.arrayBuffer())
    const parseResult = await extractText(buffer, file.type)

    // 3. Persist metadata to Postgres
    const supabase = await createClient()
    const { data: attachment, error: dbError } = await supabase
      .from("chat_attachments")
      .insert({
        user_id: profile.id,
        r2_url: uploadResult.url,
        filename: file.name,
        content_type: file.type,
      })
      .select()
      .single()

    if (dbError) {
      console.error("[upload] DB error:", dbError)
      return NextResponse.json({ error: "Failed to save metadata" }, { status: 500 })
    }

    // 4. Index content in RAG service
    // We index immediately so the AI can "read" the file in the same conversation.
    await indexDocument({
      source_type: "chat_attachment",
      source_id: attachment.id,
      owner_id: profile.id,
      team_id: profile.team_id,
      title: file.name,
      content: parseResult.text || `[File attachment: ${file.name}]`,
      metadata: {
        r2_url: uploadResult.url,
        content_type: file.type,
        truncated: parseResult.truncated,
        pages: parseResult.pages,
      }
    })

    return NextResponse.json(attachment)
  } catch (err: any) {
    console.error("[upload] Internal error:", err)
    return NextResponse.json(
      { error: err.message || "Internal server error" }, 
      { status: 500 }
    )
  }
}
