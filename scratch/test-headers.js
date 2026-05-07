const https = require('https');

const urlStr = "https://echosell-images.tos-ap-southeast-1.volces.com/product-cover/834/1729679758111249333_0.webp";

const referers = [
  "",
  "https://echotik.live/",
  "https://open.echotik.live/",
  "https://echotik.thirdparty/",
  "https://echotik.com/",
  "https://tiktok.com/",
  "https://seller.tiktok.com/",
  "https://validds.com/"
];

const userAgents = [
  "",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "EchoTik API Client",
  "PostmanRuntime/7.32.3"
];

async function check(ref, ua) {
  return new Promise((resolve) => {
    const { hostname, pathname } = new URL(urlStr);
    const options = {
      hostname,
      path: pathname,
      method: 'HEAD',
      headers: {}
    };
    if (ref) options.headers['Referer'] = ref;
    if (ua) options.headers['User-Agent'] = ua;

    const req = https.request(options, (res) => {
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(500));
    req.end();
  });
}

async function run() {
  for (const ref of referers) {
    for (const ua of userAgents) {
      const code = await check(ref, ua);
      if (code === 200 || code === 304) {
        console.log(`SUCCESS! Referer: "${ref}", UA: "${ua}"`);
        return;
      }
    }
  }
  console.log('All failed.');
}
run();
