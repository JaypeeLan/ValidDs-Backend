const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4180);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type });
  res.end(body);
}

http
  .createServer((req, res) => {
    if (req.url === "/products.json") {
      const productsFile = path.join(ROOT, "..", "..", "products.json");
      return fs.readFile(productsFile, (err, data) => {
        if (err) return send(res, 404, "Not Found");
        send(res, 200, data, MIME[".json"]);
      });
    }

    if (req.url === "/db_full_export_20260506_183201.json") {
      const exportFile = path.join(ROOT, "..", "..", "db_full_export_20260506_183201.json");
      return fs.readFile(exportFile, (err, data) => {
        if (err) return send(res, 404, "Not Found");
        send(res, 200, data, MIME[".json"]);
      });
    }

    const reqPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = path.join(ROOT, path.normalize(reqPath));
    if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");

    fs.readFile(file, (err, data) => {
      if (err) {
        // SPA fallback: unknown paths with no file extension serve index.html
        // so OAuth callbacks (/stores/shopify/callback?status=...) load the app.
        const ext = path.extname(reqPath).toLowerCase();
        if (ext) return send(res, 404, "Not Found");
        const indexFile = path.join(ROOT, "index.html");
        return fs.readFile(indexFile, (err2, html) => {
          if (err2) return send(res, 404, "Not Found");
          send(res, 200, html, MIME[".html"]);
        });
      }
      const ext = path.extname(file).toLowerCase();
      send(res, 200, data, MIME[ext] || "application/octet-stream");
    });
  })
  .listen(PORT, () => {
    process.stdout.write(`React frontend test app running: http://localhost:${PORT}\n`);
  });
