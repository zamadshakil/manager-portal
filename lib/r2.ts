import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
  forcePathStyle: true,
})

const BUCKET = process.env.R2_BUCKET_NAME || ""
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "" // e.g. "https://pub-xxxx.r2.dev"

export async function put(pathname: string, file: File, options?: any) {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  
  let finalPathname = pathname
  if (options?.addRandomSuffix) {
    const parts = pathname.split('.')
    const ext = parts.pop()
    const base = parts.join('.')
    finalPathname = `${base}-${Math.random().toString(36).substring(2, 8)}.${ext}`
  }

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: finalPathname,
    Body: buffer,
    ContentType: options?.contentType || file.type,
  }))

  return {
    url: `${PUBLIC_URL}/${finalPathname}`,
    pathname: finalPathname
  }
}

export async function del(url: string) {
  if (!url) return;
  const key = url.replace(`${PUBLIC_URL}/`, "")
  await r2.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key
  }))
}

export async function head(url: string, options?: any) {
  if (!url) throw new Error("No URL provided");
  const key = url.replace(`${PUBLIC_URL}/`, "")
  const res = await r2.send(new HeadObjectCommand({
    Bucket: BUCKET,
    Key: key
  }))
  return {
    contentType: res.ContentType,
    contentLength: res.ContentLength,
    lastModified: res.LastModified,
    etag: res.ETag,
  }
}

export async function get(url: string, options?: any) {
  if (!url) throw new Error("No URL provided");
  const key = url.replace(`${PUBLIC_URL}/`, "")
  const res = await r2.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key
  }))

  // AWS SDK v3 returns `res.Body` as a Node.js Readable in the Node runtime,
  // which does NOT expose the Web Streams API (`.getReader()`).
  // Normalize to a Web ReadableStream so consumers can call `.getReader()`
  // (used by lib/llm/pipeline.ts) AND `for await ... of` (Web ReadableStream
  // is async-iterable in Node 18+, used by lib/pipeline/process.ts) AND pass
  // it to `new NextResponse(stream, ...)` (used by /api/download/[id]).
  const body = res.Body as any
  const stream =
    body && typeof body.transformToWebStream === "function"
      ? body.transformToWebStream()
      : body

  return {
    stream, // Web ReadableStream
    blob: {
      contentType: res.ContentType
    }
  }
}
