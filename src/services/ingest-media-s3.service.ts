import { ensureCreatorAvatarCached, ensureShopAvatarCached } from './creator-avatar-cache.service';
import { extractTikTokVideoId } from '../utils/tiktok-url.util';
import { isMetaCreative, metaAdIdFromCreative, metaAdMp4S3Key } from '../utils/meta-video-s3.util';
import { s3ObjectExists, tiktokVideoMp4S3Key } from '../utils/s3-video.util';

function httpsUrls(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && v.startsWith('https://') && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Cache creator + shop images to S3 before product upsert. */
export async function enrichProductMediaForIngest(
  doc: Record<string, unknown>,
  market: string,
): Promise<void> {
  const pc = doc.primaryCreator;
  if (pc && typeof pc === 'object') {
    const creator = pc as Record<string, unknown>;
    const handle = String(creator.handle ?? '').trim();
    if (handle) {
      const cached = await ensureCreatorAvatarCached({
        handle,
        market,
        sourceUrls: httpsUrls(creator.avatarUrl, creator.primaryImageUrl),
        existingS3Key: typeof creator.avatarS3Key === 'string' ? creator.avatarS3Key : undefined,
      });
      if (cached?.avatarS3Key) creator.avatarS3Key = cached.avatarS3Key;
    }
  }

  const shopName = String(doc.shopName ?? '').trim();
  const shopAvatarUrl = String(doc.shopAvatarUrl ?? '');
  const creatorHandle = String(
    (doc.primaryCreator as Record<string, unknown> | undefined)?.handle ?? '',
  );
  if (
    shopName &&
    (shopAvatarUrl.startsWith('https://') || String(doc.shopUrl ?? '').startsWith('https://'))
  ) {
    const shop = await ensureShopAvatarCached({
      shopName,
      sourceUrl: shopAvatarUrl,
      shopUrl: String(doc.shopUrl ?? ''),
      creatorHandle,
      market,
      existingS3Key: typeof doc.shopAvatarS3Key === 'string' ? doc.shopAvatarS3Key : undefined,
    });
    if (shop?.shopAvatarS3Key) doc.shopAvatarS3Key = shop.shopAvatarS3Key;
    if (shop?.shopAvatarUrl) doc.shopAvatarUrl = shop.shopAvatarUrl;
  }
}

async function attachTikTokVideoS3IfPresent(slot: Record<string, unknown>): Promise<void> {
  if (typeof slot.videoS3Key === 'string' && slot.videoS3Key.trim()) return;

  const eid = String(slot.externalVideoId ?? '').trim();
  if (!/^\d+$/.test(eid)) return;

  const key = tiktokVideoMp4S3Key(eid);
  if (!key) return;

  if (await s3ObjectExists(key)) {
    slot.videoS3Key = key;
    slot.videoDownloadReadyAt = new Date();
  }
}

async function attachMetaVideoS3IfPresent(payload: Record<string, unknown>): Promise<void> {
  if (!isMetaCreative(payload)) return;
  const existing = String(payload.videoS3Key ?? '').trim();
  if (existing) return;

  const adId = metaAdIdFromCreative(payload);
  if (!adId) return;
  const key = metaAdMp4S3Key(adId);
  if (!key) return;
  if (await s3ObjectExists(key)) {
    payload.videoS3Key = key;
    payload.videoDownloadReadyAt = new Date();
  }
}

/** Link MP4s already in S3 onto the creative payload before Mongo write. */
export async function enrichCreativeVideoS3ForIngest(
  payload: Record<string, unknown>,
): Promise<void> {
  await attachTikTokVideoS3IfPresent(payload);
  await attachMetaVideoS3IfPresent(payload);

  const related = payload.relatedVideos;
  if (!Array.isArray(related)) return;

  await Promise.all(
    related.map((rv) =>
      rv && typeof rv === 'object'
        ? attachTikTokVideoS3IfPresent(rv as Record<string, unknown>)
        : Promise.resolve(),
    ),
  );
}

/** Cache shop avatar on creative denorm fields when scraper did not. */
export async function enrichCreativeShopAvatarForIngest(
  payload: Record<string, unknown>,
  market: string,
): Promise<void> {
  const shopName = String(payload.shopName ?? '').trim();
  const shopAvatarUrl = String(payload.shopAvatarUrl ?? '');
  const storeUrl = String(payload.shopUrl ?? '');
  const creatorHandle = String(
    (payload.creator as Record<string, unknown> | undefined)?.handle ?? '',
  );
  if (!shopName || (!shopAvatarUrl.startsWith('https://') && !storeUrl.startsWith('https://')))
    return;

  const shop = await ensureShopAvatarCached({
    shopName,
    sourceUrl: shopAvatarUrl,
    shopUrl: storeUrl,
    creatorHandle,
    market,
    existingS3Key:
      typeof payload.shopAvatarS3Key === 'string' ? payload.shopAvatarS3Key : undefined,
  });
  if (shop?.shopAvatarS3Key) payload.shopAvatarS3Key = shop.shopAvatarS3Key;
  if (shop?.shopAvatarUrl) payload.shopAvatarUrl = shop.shopAvatarUrl;
}

/** Resolve S3 key from tiktokPostUrl when externalVideoId missing on a slot. */
export function normalizeCreativeVideoIds(payload: Record<string, unknown>): void {
  const eid = String(payload.externalVideoId ?? '').trim();
  if (!eid) {
    const fromUrl = extractTikTokVideoId(String(payload.tiktokPostUrl ?? ''));
    if (fromUrl) payload.externalVideoId = fromUrl;
  }
}

/** Do not persist TikTok iframe embeds or CDN avatars once S3 keys exist. */
export function stripExternalPlaybackUrls(payload: Record<string, unknown>): void {
  if (!isMetaCreative(payload)) {
    delete payload.embedUrl;
    delete payload.videoPlayUrl;
  }

  const creator = payload.creator;
  if (creator && typeof creator === 'object') {
    const c = creator as Record<string, unknown>;
    if (c.avatarS3Key) {
      delete c.avatarUrl;
    }
    payload.creator = c;
  }

  if (payload.shopAvatarS3Key) {
    delete payload.shopAvatarUrl;
  }

  const related = payload.relatedVideos;
  if (!Array.isArray(related)) return;

  payload.relatedVideos = related.map((rv) => {
    if (!rv || typeof rv !== 'object') return rv;
    const row = { ...(rv as Record<string, unknown>) };
    if (!isMetaCreative(payload)) {
      delete row.embedUrl;
      delete row.videoPlayUrl;
    }
    const sub = row.creator;
    if (sub && typeof sub === 'object') {
      const sc = sub as Record<string, unknown>;
      if (sc.avatarS3Key) delete sc.avatarUrl;
      row.creator = sc;
    }
    return row;
  });
}

export function stripProductCdnAvatars(doc: Record<string, unknown>): void {
  const pc = doc.primaryCreator;
  if (pc && typeof pc === 'object') {
    const creator = pc as Record<string, unknown>;
    if (creator.avatarS3Key) {
      delete creator.avatarUrl;
      delete creator.primaryImageUrl;
    }
    doc.primaryCreator = creator;
  }
  if (doc.shopAvatarS3Key) {
    delete doc.shopAvatarUrl;
  }
}
