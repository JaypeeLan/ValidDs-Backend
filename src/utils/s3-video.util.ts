import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

let _client: S3Client | null = null;

function envFirst(...keys: string[]): string {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return '';
}

export function s3VideoBucket(): string {
  return envFirst('AWS_S3_BUCKET', 'Bucket_name', 'S3_BUCKET');
}

export function s3VideoPrefix(): string {
  const raw = envFirst('AWS_S3_VIDEO_PREFIX', 'S3_VIDEO_PREFIX') || 'brightdata/tiktok-videos';
  return raw.replace(/^\/+|\/+$/g, '');
}

export function isS3VideoConfigured(): boolean {
  return Boolean(
    s3VideoBucket() &&
    envFirst('AWS_ACCESS_KEY_ID', 'Access_Key_ID') &&
    envFirst('AWS_SECRET_ACCESS_KEY', 'Secret_Access_Key'),
  );
}

export function getS3Client(): S3Client {
  if (_client) return _client;
  const region = envFirst('AWS_REGION', 'AWS_DEFAULT_REGION') || 'us-east-1';
  const accessKeyId = envFirst('AWS_ACCESS_KEY_ID', 'Access_Key_ID');
  const secretAccessKey = envFirst('AWS_SECRET_ACCESS_KEY', 'Secret_Access_Key');
  const endpoint = envFirst('AWS_S3_ENDPOINT', 'S3_Endpoint');

  _client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: false } : {}),
  });
  return _client;
}

export type S3VideoObject = {
  body: Readable;
  statusCode: number;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
  etag?: string;
  lastModified?: Date;
};

export async function getS3VideoObject(
  key: string,
  rangeHeader?: string,
): Promise<S3VideoObject | null> {
  if (!key.trim() || !isS3VideoConfigured()) return null;

  try {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: s3VideoBucket(),
        Key: key,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      }),
    );

    if (!response.Body) return null;

    return {
      body: response.Body as Readable,
      statusCode: rangeHeader && response.ContentRange ? 206 : 200,
      contentType: response.ContentType || 'video/mp4',
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges,
      etag: response.ETag,
      lastModified: response.LastModified,
    };
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey' || code === 'NotFound') return null;
    throw err;
  }
}
