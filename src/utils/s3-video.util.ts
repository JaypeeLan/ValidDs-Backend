import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export function s3ImagePrefix(): string {
  const raw = envFirst('AWS_S3_IMAGE_PREFIX', 'S3_IMAGE_PREFIX') || 'validds/creator-assets';
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

function isS3NotFoundOrDenied(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e?.$metadata?.httpStatusCode;
  if (status === 403 || status === 404) return true;
  const code = e?.name;
  return (
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    code === 'NotFoundException' ||
    code === 'AccessDenied' ||
    code === 'Forbidden'
  );
}

/** Uses GetObject (byte range) — does not require s3:HeadObject on the IAM policy. */
export async function s3ObjectExists(key: string): Promise<boolean> {
  if (!key.trim() || !isS3VideoConfigured()) return false;
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: s3VideoBucket(),
        Key: key,
        Range: 'bytes=0-0',
      }),
    );
    return Boolean(response.Body);
  } catch (err) {
    if (isS3NotFoundOrDenied(err)) return false;
    throw err;
  }
}

export async function putS3Object(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!key.trim() || !isS3VideoConfigured()) return;
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: s3VideoBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function getS3VideoObject(
  key: string,
  rangeHeader?: string,
  defaultContentType = 'video/mp4',
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
      contentType: response.ContentType || defaultContentType,
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges,
      etag: response.ETag,
      lastModified: response.LastModified,
    };
  } catch (err) {
    if (isS3NotFoundOrDenied(err)) return null;
    throw err;
  }
}

/** Alias for images and other cached assets in the same bucket. */
export const getS3Object = getS3VideoObject;
export const isS3Configured = isS3VideoConfigured;
