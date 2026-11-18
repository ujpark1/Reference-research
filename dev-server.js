// 로컬 개발 서버 (의존성 없음) — 정적 파일 + api/*.js 를 Vercel과 같은 방식으로 실행한다.
//   node dev-server.js          → .env 의 YOUTUBE_API_KEY / APIFY_TOKEN 으로 실제 호출
//   node dev-server.js --mock   → 가짜 데이터로 응답 (키·비용 없이 화면 확인용)
//   --port=5173 으로 포트 변경 가능
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MOCK = process.argv.includes("--mock") || process.env.MOCK === "1";
const portArg = process.argv.find(a => a.startsWith("--port="));
const PORT = Number(portArg?.split("=")[1] || process.env.PORT) || 5173;

const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const API = {
  "/api/yt": () => MOCK ? import("./dev/mock.js").then(m => m.yt) : import("./api/yt.js").then(m => m.default),
  "/api/apify": () => MOCK ? import("./dev/mock.js").then(m => m.apify) : import("./api/apify.js").then(m => m.default),
  "/api/img": () => MOCK ? import("./dev/mock.js").then(m => m.img) : import("./api/img.js").then(m => m.default),
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (API[url.pathname]) {
      // Vercel 함수와 같은 모양의 req/res 를 흉내낸다
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readBody(req);
      res.status = code => { res.statusCode = code; return res; };
      res.json = obj => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); return res; };
      res.send = data => { res.end(data); return res; };
      return await (await API[url.pathname]())(req, res);
    }
    // 정적 파일은 index.html 과 assets/ 만 내보낸다 (.env 등이 새지 않게)
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(ROOT, rel);
    const ok = rel === "index.html" || (file.startsWith(path.join(ROOT, "assets") + path.sep));
    if (!ok || !existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", (TYPES[path.extname(file)] || "application/octet-stream") + "; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: String(e.message || e) } }));
  }
}).listen(PORT, () => {
  console.log(`레퍼런스 리서치 → http://localhost:${PORT}${MOCK ? "  (모의 데이터 모드)" : ""}`);
});
