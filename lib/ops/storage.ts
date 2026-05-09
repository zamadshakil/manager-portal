import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3"

const BACKUP_PREFIX = "backups/db/"

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
    forcePathStyle: true,
  })
}

const BUCKET = () => process.env.R2_BUCKET_NAME || ""

export interface BackupObject {
  key: string
  size: number
  lastModified: Date
  filename: string
}

export async function listBackups(): Promise<BackupObject[]> {
  const r2 = getR2Client()
  const result = await r2.send(
    new ListObjectsV2Command({
      Bucket: BUCKET(),
      Prefix: BACKUP_PREFIX,
      MaxKeys: 200,
    })
  )
  const objects = result.Contents ?? []
  return objects
    .filter((o) => o.Key && o.Key !== BACKUP_PREFIX)
    .map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ?? new Date(0),
      filename: o.Key!.replace(BACKUP_PREFIX, ""),
    }))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
}

export async function downloadBackup(key: string): Promise<Buffer> {
  const r2 = getR2Client()
  const res = await r2.send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    })
  )
  const body = res.Body as any
  if (!body) throw new Error("Empty response body from R2")
  const chunks: Uint8Array[] = []
  for await (const chunk of body) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
