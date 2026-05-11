import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

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

/**
 * Generate a pre-signed PUT URL so the browser can upload directly to R2,
 * bypassing the Next.js server. Returns both the upload URL and the final
 * public URL the client should store in the message record.
 *
 * @param key    R2 object key, e.g. "messaging/{convId}/{uuid}.jpg"
 * @param contentType  MIME type of the file being uploaded
 * @param expiresIn    Seconds until the pre-signed URL expires (default 300)
 */
export async function presignPut(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn })
  const publicUrl = `${PUBLIC_URL}/${key}`
  return { uploadUrl, publicUrl, key }
}

/**
 * Generate a pre-signed GET URL so the server can redirect the browser
 * directly to R2, bypassing the PUBLIC_URL prefix dependency entirely.
 *
 * @param key       R2 object key, e.g. "materials/uuid/file.pdf"
 * @param expiresIn Seconds until the pre-signed URL expires (default 60)
 */
export async function presignGet(key: string, expiresIn = 60): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(r2, command, { expiresIn })
}

export async function putRaw(
  key: string,
  body: Buffer,
  contentType: string,
  options?: { cacheControl?: string },
): Promise<{ url: string; pathname: string }> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: options?.cacheControl,
    }),
  )
  return {
    url: `${PUBLIC_URL}/${key}`,
    pathname: key,
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
  // and `for await ... of` (Web ReadableStream is async-iterable in Node 18+,
  // used by lib/llm/pipeline.ts) AND pass it to `new NextResponse(stream, ...)`
  // (used by /api/download/[id]).
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
