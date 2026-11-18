// Vercel 서버리스 프록시 — 인스타그램·스레드 썸네일 중계.
// Meta CDN 이미지는 다른 사이트에서 <img>로 바로 불러오면 차단되기 때문에 서버가 대신 받아서 넘겨준다.
// 아무 주소나 받아주는 열린 프록시가 되지 않도록 Meta CDN 호스트의 이미지만 허용한다.
const ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;
const MAX_BYTES = 5 * 1024 * 1024;

export default async function handler(req, res) {
  let u;
  try { u = new URL(String(req.query.u || "")); }
  catch { return res.status(400).json({ error: { message: "u 값이 올바르지 않습니다" } }); }
  if (u.protocol !== "https:" || !ALLOWED_HOST.test(u.hostname)) {
    return res.status(400).json({ error: { message: "허용되지 않은 이미지 주소입니다" } });
  }
  let r;
  try { r = await fetch(u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } }); }
  catch { return res.status(502).json({ error: { message: "이미지를 가져오지 못했습니다" } }); }
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.startsWith("image/")) {
    return res.status(502).json({ error: { message: "이미지를 가져오지 못했습니다 (만료된 주소일 수 있음)" } });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: { message: "이미지가 너무 큽니다" } });
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
  return res.status(200).send(buf);
}
