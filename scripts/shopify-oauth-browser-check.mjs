import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node shopify-oauth-browser-check.mjs <authorizeUrl>');
  process.exit(1);
}

const outDir = path.resolve('tmp/shopify-oauth-check');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

const log = [];
page.on('response', (res) => {
  if (res.status() >= 400) {
    log.push(`HTTP ${res.status()} ${res.url()}`);
  }
});
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    log.push(`NAV ${frame.url()}`);
  }
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const finalUrl = page.url();
  const title = await page.title();
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '');

  const screenshot = path.join(outDir, 'page.png');
  await page.screenshot({ path: screenshot, fullPage: true });

  const report = {
    startUrl: url,
    finalUrl,
    title,
    log,
    textPreview: text.replace(/\s+/g, ' ').trim().slice(0, 2000),
    errorSnippets: [
      ...(text.match(/oauth error[^\n]*/gi) ?? []),
      ...(text.match(/redirect_uri[^\n]*/gi) ?? []),
      ...(text.match(/something went wrong[^\n]*/gi) ?? []),
      ...(text.match(/invalid_request[^\n]*/gi) ?? []),
      ...(text.match(/not whitelisted[^\n]*/gi) ?? []),
      ...(text.match(/couldn't find[^\n]*/gi) ?? []),
      ...(text.match(/doesn't exist[^\n]*/gi) ?? []),
    ],
  };

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('SCREENSHOT=' + screenshot);
} finally {
  await browser.close();
}
