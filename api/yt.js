// Vercel 서버리스 프록시 — YouTube Data API 키를 서버에만 두고 중계한다.
// 클라이언트는 /api/yt?path=search&q=... 로 호출 (키 불필요).
// 키는 Vercel 프로젝트 환경변수 YOUTUBE_API_KEY 에서 읽는다.
const ALLOWED = new Set(['search', 'videos', 'channels', 'playlistItems']);

export default async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: { message: 'Vercel 환경변수 YOUTUBE_API_KEY가 설정되지 않았어요 — 프로젝트 Settings → Environment Variables에서 추가해 주세요.' },
    });
  }
  const { path, ...params } = req.query;
  if (!ALLOWED.has(path)) {
    return res.status(400).json({ error: { message: `허용되지 않은 path: ${path}` } });
  }
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`);
  const body = await r.json();
  res.setHeader('Cache-Control', 's-maxage=300');
  return res.status(r.status).json(body);
}
