import {
  assertConsumerSession,
  assertPartnerSession,
  countCookieRows,
  trimNetscapeCookies,
} from '../src/utils/trim-cookies.util';

describe('trimNetscapeCookies', () => {
  const sample = [
    '# Netscape HTTP Cookie File',
    '.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc',
    '.tiktok.com\tTRUE\t/\tTRUE\t0\tsid_tt\tdef',
    '.google.com\tTRUE\t/\tFALSE\t0\tNID\txyz',
    'partner.us.tiktokshop.com\tFALSE\t/\tTRUE\t0\tuid_tt\tghi',
    '',
  ].join('\n');

  it('keeps only TikTok-related domains', () => {
    const out = trimNetscapeCookies(sample);
    expect(out).toContain('sessionid');
    expect(out).toContain('partner.us.tiktokshop.com');
    expect(out).not.toContain('google.com');
    expect(countCookieRows(out)).toBe(3);
  });

  it('validates consumer session cookies', () => {
    const out = trimNetscapeCookies(sample);
    expect(() => assertConsumerSession(out)).not.toThrow();
    expect(() => assertConsumerSession('# empty\n')).toThrow(/sessionid/);
  });

  it('validates partner session cookies', () => {
    const out = trimNetscapeCookies(sample);
    expect(() => assertPartnerSession(out)).not.toThrow();
  });
});
