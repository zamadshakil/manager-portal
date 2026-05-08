import "server-only"
import { get as r2Get } from "@/lib/r2"
import { extractArchiveText } from "@/lib/parse/archive"
import { indexDocument, joinContent } from "@/lib/smart-ai/indexer"
import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Drain a Web ReadableStream into a Buffer (mirrors the pattern in
// app/api/export/route.ts — keeps logic consistent across the codebase).
// ---------------------------------------------------------------------------

async function drainStream(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer)
    chunks.push(buf)
    total += buf.byteLength
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Non-blocking background job — call with `void processArchiveBackground(...)`.
 *
 * 1. Streams the archive from R2 and collects it into a Buffer.
 * 2. Extracts text from each inner document.
 * 3. Upserts the RAG index.
 * 4. Flips `archive_status` to "done" or "failed".
 */
export async function processArchiveBackground(
  materialId: string,
  blobUrl: string,
  mimeType: string,
  teamId: string | null,
  ownerId: string,
  title: string,
): Promise<void> {
  const supabase = createAdminClient()

  try {
    console.log(`[archive-processor] starting materialId=${materialId}`)

    // 1. Stream archive from R2
    const { stream } = await r2Get(blobUrl)
    const buf = await drainStream(stream as AsyncIterable<Uint8Array>)
    console.log(`[archive-processor] downloaded ${buf.byteLength} bytes`)

    // 2. Extract text from inner documents
    const parseResult = await extractArchiveText(buf, mimeType)
    console.log(
      `[archive-processor] extracted ${parseResult.text.length} chars, truncated=${parseResult.truncated}`,
    )

    if (parseResult.warning) {
      console.warn(`[archive-processor] extraction warnings: ${parseResult.warning}`)
    }

    // 3. RAG indexing — only when there's usable text
    if (parseResult.text.trim().length >= 16) {
      await indexDocument({
        source_type: "material",
        source_id: materialId,
        team_id: teamId,
        owner_id: ownerId,
        title,
        content: joinContent([title, parseResult.text]),
        metadata: {
          mime: mimeType,
          archive: true,
          truncated: parseResult.truncated,
        },
      })
    }

    // 4. Mark done
    await supabase
      .from("materials")
      .update({ archive_status: "done" } as any)
      .eq("id", materialId)

    console.log(`[archive-processor] done materialId=${materialId}`)
  } catch (err: any) {
    console.error(`[archive-processor] failed materialId=${materialId}:`, err?.message ?? err)

    supabase
      .from("materials")
      .update({ archive_status: "failed" } as any)
      .eq("id", materialId)
      .then(({ error }) => {
        if (error) console.error("[archive-processor] status update to failed also failed:", error.message)
      })
  }
}
