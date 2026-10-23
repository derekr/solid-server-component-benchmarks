// Production server: Qwik City's node middleware, fronted by the same
// compression the Solid apps use (brotli quality 4 for streamed responses,
// flushed per chunk so streaming boundaries survive; quality 9 for static
// assets, compressed once).
//
// The middleware listens on an internal port in this same process and the
// front proxies to it over loopback.
import http from "node:http";
import zlib from "node:zlib";
import { router, notFound, staticFile } from "./server/entry.node-server.js";

const PORT = Number(process.env.PORT || 3010);
const INNER = PORT + 1000;

await new Promise(r =>
  http
    .createServer((req, res) => staticFile(req, res, () => router(req, res, () => notFound(req, res, () => {}))))
    .listen(INNER, "127.0.0.1", r)
);

const staticBrotli = new Map();

http
  .createServer((req, res) => {
    const up = http.request(
      { host: "127.0.0.1", port: INNER, path: req.url, method: req.method, headers: { ...req.headers, "accept-encoding": "identity" } },
      u => {
        const headers = { ...u.headers };
        const br = /\bbr\b/.test(req.headers["accept-encoding"] || "") && /text|javascript|json|svg|x-component/.test(headers["content-type"] || "");
        if (!br) {
          res.writeHead(u.statusCode, headers);
          return u.pipe(res);
        }
        delete headers["content-length"];
        headers["content-encoding"] = "br";
        headers.vary = "Accept-Encoding";
        if (/^\/(build|assets)\//.test(req.url)) {
          const cached = staticBrotli.get(req.url);
          if (cached) {
            res.writeHead(u.statusCode, headers);
            u.resume();
            return res.end(cached);
          }
          const chunks = [];
          u.on("data", c => chunks.push(c));
          u.on("end", () => {
            const body = zlib.brotliCompressSync(Buffer.concat(chunks), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
            if (u.statusCode === 200) staticBrotli.set(req.url, body);
            res.writeHead(u.statusCode, headers);
            res.end(body);
          });
          return;
        }
        res.writeHead(u.statusCode, headers);
        const enc = zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
        enc.pipe(res);
        u.on("data", c => {
          enc.write(c);
          enc.flush();
        });
        u.on("end", () => enc.end());
      }
    );
    up.on("error", e => {
      res.statusCode = 502;
      res.end(e.message);
    });
    req.pipe(up);
  })
  .listen(PORT, () => console.log(`HackerNews (Qwik City) on http://localhost:${PORT}`));
