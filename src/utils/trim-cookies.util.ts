/**
 * Trim Netscape cookies.txt to TikTok-related domains (Render secret-file size limit).
 * Mirrors scraper/bin/trim_cookies_for_render.py
 */

const MAX_SECRET_BYTES = 500 * 1024;

function isTikTokDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\./, '');
  return (
    d.includes('tiktok') ||
    d.endsWith('ttwstatic.com') ||
    d.includes('byteoversea') ||
    d.includes('musical.ly')
  );
}

export function trimNetscapeCookies(text: string): string {
  const header: string[] = [];
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) {
      header.push(line);
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    if (isTikTokDomain(parts[0] ?? '')) kept.push(line);
  }
  const hdr =
    header.length > 0
      ? header
      : ['# Netscape HTTP Cookie File', '# Trimmed for Render deploy (TikTok domains only)'];
  return `${[...hdr, '', ...kept].join('\n')}\n`;
}

export function cookieNamesFromNetscape(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length >= 7 && parts[5]) names.add(parts[5]);
  }
  return names;
}

export function assertConsumerSession(trimmed: string): void {
  const names = cookieNamesFromNetscape(trimmed);
  const hasAuth = names.has('sessionid') && (names.has('sid_tt') || names.has('sid_guard'));
  if (!hasAuth) {
    throw new Error(
      'Consumer cookies missing sessionid/sid_tt — re-export while logged into TikTok',
    );
  }
}

export function assertPartnerSession(trimmed: string): void {
  const names = cookieNamesFromNetscape(trimmed);
  const hasAuth = names.has('sessionid') && (names.has('sid_tt') || names.has('sid_guard'));
  if (!hasAuth) {
    throw new Error(
      'Partner Center cookies missing sessionid/sid_tt — re-export while logged into partner.us.tiktokshop.com',
    );
  }
}

export function assertSecretSize(trimmed: string): void {
  const bytes = Buffer.byteLength(trimmed, 'utf8');
  if (bytes === 0) {
    throw new Error('Trimmed cookies are empty — paste a full Netscape cookies.txt export');
  }
  if (bytes > MAX_SECRET_BYTES) {
    throw new Error(
      `Trimmed cookies still ${bytes} bytes (Render limit ${MAX_SECRET_BYTES}) — unexpected`,
    );
  }
}

export function countCookieRows(trimmed: string): number {
  let n = 0;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.split('\t').length >= 7) n += 1;
  }
  return n;
}
