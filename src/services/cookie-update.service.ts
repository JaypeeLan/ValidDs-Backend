import { AppError } from '../middleware/error.middleware';
import {
  assertConsumerSession,
  assertPartnerSession,
  assertSecretSize,
  countCookieRows,
  trimNetscapeCookies,
} from '../utils/trim-cookies.util';
import {
  isRenderConfigured,
  restartRenderService,
  updateEnvGroupSecretFile,
} from './render.service';

export type CookieServiceId = 'scraper' | 'live_scraper';
export type CookieKind = 'consumer' | 'partner';

export type CookieTarget = {
  id: string;
  service: CookieServiceId;
  cookieKind: CookieKind;
  label: string;
  description: string;
  renderServiceName: string;
  envGroupName: string;
  secretFileName: string;
};

/** Product-maintenance has no cookie secret files — intentionally omitted. */
export const COOKIE_TARGETS: CookieTarget[] = [
  {
    id: 'scraper:consumer',
    service: 'scraper',
    cookieKind: 'consumer',
    label: 'Scraper — consumer TikTok',
    description: 'Shop/profile Playwright session (cookies.txt)',
    renderServiceName: 'validds-scraper',
    envGroupName: 'validds-scraper-shared',
    secretFileName: 'cookies.txt',
  },
  {
    id: 'scraper:partner',
    service: 'scraper',
    cookieKind: 'partner',
    label: 'Partner Center (scraper)',
    description: 'Affiliate / high-opportunity / partner pool session (partner-center-cookies.txt)',
    renderServiceName: 'validds-scraper',
    envGroupName: 'validds-scraper-shared',
    secretFileName: 'partner-center-cookies.txt',
  },
  {
    id: 'live_scraper:consumer',
    service: 'live_scraper',
    cookieKind: 'consumer',
    label: 'Live scraper — consumer TikTok',
    description: 'Live discovery session (cookies.txt)',
    renderServiceName: 'validds-live-scraper',
    envGroupName: 'validds-live-scraper-shared',
    secretFileName: 'cookies.txt',
  },
];

export function listCookieTargets(): {
  configured: boolean;
  targets: CookieTarget[];
  note: string;
} {
  return {
    configured: isRenderConfigured(),
    targets: COOKIE_TARGETS,
    note: 'Product maintenance does not use TikTok cookies. Paste a full Netscape export; the API trims TikTok domains, uploads the secret file, and restarts the worker.',
  };
}

function findTarget(service: CookieServiceId, cookieKind: CookieKind): CookieTarget {
  const target = COOKIE_TARGETS.find((t) => t.service === service && t.cookieKind === cookieKind);
  if (!target) {
    throw new AppError(
      400,
      `No cookie target for service=${service} kind=${cookieKind}`,
      'COOKIE_TARGET_INVALID',
    );
  }
  return target;
}

export async function updateServiceCookies(input: {
  service: CookieServiceId;
  cookieKind: CookieKind;
  content: string;
  updatedBy?: string | null;
}): Promise<{
  service: CookieServiceId;
  cookieKind: CookieKind;
  secretFileName: string;
  envGroupName: string;
  renderServiceName: string;
  cookieCount: number;
  trimmedBytes: number;
  deployId: string;
  updatedBy: string | null;
}> {
  if (!isRenderConfigured()) {
    throw new AppError(
      503,
      'RENDER_API_KEY is not set — cannot update Render secret files',
      'RENDER_NOT_CONFIGURED',
    );
  }

  const raw = (input.content ?? '').trim();
  if (!raw) {
    throw new AppError(400, 'Cookie content is required', 'COOKIE_CONTENT_REQUIRED');
  }

  const target = findTarget(input.service, input.cookieKind);
  let trimmed: string;
  try {
    trimmed = trimNetscapeCookies(raw);
    assertSecretSize(trimmed);
    if (input.cookieKind === 'partner') {
      assertPartnerSession(trimmed);
    } else {
      assertConsumerSession(trimmed);
    }
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : String(err), 'COOKIE_INVALID');
  }

  await updateEnvGroupSecretFile(target.envGroupName, target.secretFileName, trimmed);
  const { deployId } = await restartRenderService(target.renderServiceName);

  return {
    service: target.service,
    cookieKind: target.cookieKind,
    secretFileName: target.secretFileName,
    envGroupName: target.envGroupName,
    renderServiceName: target.renderServiceName,
    cookieCount: countCookieRows(trimmed),
    trimmedBytes: Buffer.byteLength(trimmed, 'utf8'),
    deployId,
    updatedBy: input.updatedBy ?? null,
  };
}
