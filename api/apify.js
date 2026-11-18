// Vercel 서버리스 프록시 — Apify 토큰을 서버에만 두고 Instagram · Threads 수집을 중계한다.
// 클라이언트는 토큰 없이 아래 세 가지만 호출할 수 있다:
//   POST /api/apify?action=start&actor=<키>   (본문 = Actor 입력)  → 실행 시작
//   GET  /api/apify?action=status&run=<id>                          → 실행 상태
//   GET  /api/apify?action=items&dataset=<id>                       → 결과
// 토큰은 Vercel 프로젝트 환경변수 APIFY_TOKEN 에서 읽는다.
// 돈이 나가는 엔드포인트라서 (1) 허용된 Actor만 (2) 입력을 정해진 필드·상한으로 잘라서 넘긴다.
const API = "https://api.apify.com/v2";
const ID_RE = /^[A-Za-z0-9]{8,32}$/;

const str = (v, max = 100) => String(v ?? "").trim().slice(0, max);
const int = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const list = (v, maxLen, maxItem = 60) =>
  (Array.isArray(v) ? v : []).slice(0, maxLen).map(x => str(x, maxItem)).filter(Boolean);
const need = (arr, name) => {
  if (!arr.length) throw new Error(`${name} 값이 필요합니다`);
  return arr;
};

// ⚠️ assets/apify.js 의 APIFY_ACTORS 와 id를 똑같이 맞출 것. actId는 Apify의 고유 ID(상태 조회 검증용).
const ACTORS = {
  igSearch: {
    id: "apify~instagram-hashtag-scraper", actId: "reGe1ST3OBgYZSsZJ",
    clean: b => ({
      hashtags: need(list(b.hashtags, 1), "hashtags"),
      keywordSearch: !!b.keywordSearch,
      resultsType: b.resultsType === "reels" ? "reels" : "posts",
      resultsLimit: int(b.resultsLimit, 1, 100, 30),
    }),
  },
  igProfile: {
    id: "apify~instagram-profile-scraper", actId: "dSCLg0C3YEZ83HzYX",
    clean: b => ({ usernames: need(list(b.usernames, 60, 40), "usernames") }),
  },
  igPost: {
    id: "apify~instagram-scraper", actId: "shu8hvrXbJbY3Eb9W",
    clean: b => ({
      directUrls: need(list(b.directUrls, 1, 120)
        .filter(u => /^https:\/\/www\.instagram\.com\/(p|reel)\/[\w-]+\/$/.test(u)), "directUrls"),
      resultsType: "posts",
      resultsLimit: 1,
    }),
  },
  threads: {
    id: "lergassy~threads-scraper", actId: "hcPo0mbyQuWE4agKO",
    clean: b => {
      const common = { includeViews: b.includeViews !== false, includeRunSummary: false };
      if (b.mode === "search") {
        const max = int(b.maxPosts, 1, 60, 20);
        const out = {
          ...common, mode: "search", keywords: need(list(b.keywords, 1), "keywords"),
          maxPosts: max, maxItems: max, minLikes: int(b.minLikes, 0, 100000, 0),
        };
        if (/^\d{4}-\d{2}-\d{2}$/.test(b.postedAfter || "")) out.postedAfter = b.postedAfter;
        return out;
      }
      return {
        ...common, mode: "posts", usernames: need(list(b.usernames, 60, 40), "usernames"),
        maxPosts: int(b.maxPosts, 1, 30, 10), includeProfile: true,
      };
    },
  },
};
const ALLOWED_ACT_IDS = new Set(Object.values(ACTORS).map(a => a.actId));

export default async function handler(req, res) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: { message: "서버에 APIFY_TOKEN이 설정되지 않았어요 — Vercel 프로젝트 Settings → Environment Variables에 추가하거나, 페이지에 Apify 토큰을 직접 입력해 주세요." },
    });
  }
  const bad = (msg, code = 400) => res.status(code).json({ error: { message: msg } });
  const { action } = req.query;
  const headers = { Authorization: `Bearer ${token}` };
  res.setHeader("Cache-Control", "no-store");

  if (action === "start") {
    if (req.method !== "POST") return bad("POST로 호출해야 합니다", 405);
    const actor = ACTORS[req.query.actor];
    if (!actor) return bad(`허용되지 않은 actor: ${req.query.actor}`);
    let input;
    try { input = actor.clean(req.body && typeof req.body === "object" ? req.body : {}); }
    catch (e) { return bad(e.message); }
    const r = await fetch(`${API}/acts/${actor.id}/runs?waitForFinish=20`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return relayRun(r, res);
  }

  if (action === "status") {
    if (!ID_RE.test(req.query.run || "")) return bad("run 값이 올바르지 않습니다");
    const r = await fetch(`${API}/actor-runs/${req.query.run}?waitForFinish=20`, { headers });
    return relayRun(r, res);
  }

  if (action === "items") {
    if (!ID_RE.test(req.query.dataset || "")) return bad("dataset 값이 올바르지 않습니다");
    const r = await fetch(`${API}/datasets/${req.query.dataset}/items?clean=1&format=json&limit=2000`, { headers });
    const body = await r.json().catch(() => ({}));
    return res.status(r.status).json(body);
  }

  return bad(`허용되지 않은 action: ${action}`);
}

// 실행 정보는 필요한 필드만 돌려준다 (허용 목록 밖 Actor의 실행은 조회 거부)
async function relayRun(r, res) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(r.status).json({ error: body.error || { message: `Apify 오류 (${r.status})` } });
  const d = body.data || {};
  if (!ALLOWED_ACT_IDS.has(d.actId)) {
    return res.status(403).json({ error: { message: "이 실행은 조회할 수 없습니다" } });
  }
  return res.status(200).json({ data: { id: d.id, status: d.status, defaultDatasetId: d.defaultDatasetId } });
}
