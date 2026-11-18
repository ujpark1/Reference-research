// 모의 데이터 (node dev-server.js --mock 전용) — 실제 API를 부르지 않고 화면·계산을 확인하기 위한 것.
// 응답 모양은 YouTube Data API v3 와 각 Apify Actor의 출력 형식을 따른다. 배포에는 쓰이지 않는다.

// ---- 시드 고정 난수: 같은 입력이면 항상 같은 결과 ----
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed) { let x = hash(seed) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const MULTS = [0.4, 0.6, 0.8, 0.9, 1.0, 1.1, 1.3, 1.6, 2.2, 3.4, 5.5, 12];
const daysAgoISO = d => new Date(Date.now() - d * 86400000).toISOString();

const TITLES = [
  "직장인 부업 3가지, 월 100만원 버는 현실적인 방법", "아무도 알려주지 않는 진실… 이거 모르면 후회합니다",
  "퇴사 후 1년, 직접 해보니 달라진 것들", "초보자를 위한 총정리 가이드 (2026 최신)",
  "이게 된다고? 하루 10분 루틴의 반전", "A vs B 비교, 뭐가 더 나을까요?",
  "절대 하지 마세요. 제가 망했던 이유", "요즘 다들 이거 한다길래 해봤습니다",
  "오늘의 기록", "조용히 꾸준히 하는 사람들의 공통점",
];

// ================= YouTube =================
const YT_CH = Array.from({ length: 8 }, (_, k) => ({
  id: "UC" + String(k).repeat(22), title: `모의채널 ${k + 1}`,
  subs: [3200, 18000, 54000, 150000, 420000, 1300000, 7800, 0][k],
  base: [4000, 9000, 30000, 80000, 150000, 600000, 2500, 20000][k],
}));
const ytChOf = id => YT_CH[parseInt(id[1], 16) % 8];
function ytVideo(id, parts) {
  const ch = ytChOf(id), r = rnd(id);
  const views = Math.round(ch.base * MULTS[Math.floor(r() * MULTS.length)] * (0.8 + r() * 0.4));
  const v = { id };
  if (parts.includes("snippet")) v.snippet = {
    title: TITLES[hash(id) % TITLES.length], channelId: ch.id, channelTitle: ch.title,
    publishedAt: daysAgoISO(1 + Math.floor(r() * 150)),
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
  };
  if (parts.includes("statistics")) v.statistics = {
    viewCount: String(views), likeCount: String(Math.round(views * 0.03)), commentCount: String(Math.round(views * 0.004)),
  };
  if (parts.includes("contentDetails")) v.contentDetails = { duration: r() < 0.3 ? "PT45S" : `PT${3 + Math.floor(r() * 20)}M12S` };
  return v;
}
const ytId = (k, n) => "m" + k.toString(16) + String(n).padStart(9, "0");
function ytChannel(ch) {
  return {
    id: ch.id, snippet: { title: ch.title, publishedAt: "2021-03-01T00:00:00Z", thumbnails: {} },
    statistics: ch.subs ? { subscriberCount: String(ch.subs), viewCount: String(ch.base * 300), videoCount: "214" }
                        : { hiddenSubscriberCount: true, viewCount: String(ch.base * 300), videoCount: "88" },
    contentDetails: { relatedPlaylists: { uploads: "UU" + ch.id.slice(2) } },
  };
}
export function yt(req, res) {
  const q = req.query, path = q.path, ids = (q.id || "").split(",").filter(Boolean);
  let items = [];
  if (path === "search") {
    const n = Math.min(50, parseInt(q.maxResults) || 25);
    items = Array.from({ length: n }, (_, i) => ({ id: { videoId: ytId(hash(q.q + i) % 8, 1000 + i) } }));
  } else if (path === "videos") {
    items = ids.map(id => ytVideo(id, q.part || ""));
  } else if (path === "channels") {
    items = q.forHandle || q.forUsername ? [ytChannel(YT_CH[2])]
      : ids.map(id => YT_CH.find(c => c.id === id)).filter(Boolean).map(ytChannel);
  } else if (path === "playlistItems") {
    const k = parseInt(q.playlistId[2], 16) % 8;
    items = Array.from({ length: 30 }, (_, i) => ({ contentDetails: { videoId: ytId(k, i) } }));
  }
  res.status(200).json({ items });
}

// ================= Apify (Instagram · Threads) =================
const USERS = ["daily.cafe", "minji_home", "seoul.eats", "run.with.j", "studio_ohh", "book.note", "tiny_garden", "trip.kr", "hana.fit", "dev_log"];
const userBase = u => ({ subs: 800 + (hash(u) % 60) * (hash(u + "x") % 5000), base: 40 + (hash(u) % 900) });

function igPost(owner, seed, mult, extra = {}) {
  const r = rnd(seed), b = userBase(owner);
  const metric = Math.max(3, Math.round(b.base * mult * (0.8 + r() * 0.4)));
  const video = r() < 0.4, code = "C" + hash(seed).toString(36).padStart(10, "0");
  return {
    id: String(hash(seed)) + "001", type: video ? "Video" : r() < 0.5 ? "Sidecar" : "Image", productType: video ? "clips" : "feed",
    shortCode: code, url: `https://www.instagram.com/p/${code}/`,
    caption: TITLES[hash(seed) % TITLES.length] + "\n\n자세한 내용은 본문에 정리했어요.\n#모의데이터 #레퍼런스",
    likesCount: Math.round(metric * 0.92), commentsCount: Math.round(metric * 0.08),
    timestamp: daysAgoISO(1 + Math.floor(r() * 120)),
    displayUrl: `https://scontent.cdninstagram.com/mock/${code}.jpg`,
    ownerUsername: owner, ownerFullName: owner.replace(/[._]/g, " "),
    ...(video ? { videoPlayCount: metric * 14, videoViewCount: metric * 9, videoDuration: 12.5 + r() * 60 } : {}),
    ...extra,
  };
}
function igProfile(u) {
  const b = userBase(u);
  return {
    username: u, fullName: u.replace(/[._]/g, " "), followersCount: b.subs, postsCount: 120 + (hash(u) % 400),
    verified: hash(u) % 7 === 0, private: false, profilePicUrlHD: `https://scontent.cdninstagram.com/mock/${u}.jpg`,
    latestPosts: Array.from({ length: 12 }, (_, i) =>
      igPost(u, u + "#latest" + i, i === 0 ? 9 : [0.7, 0.9, 1.0, 1.1, 1.3][i % 5], { isPinned: i === 0 })),
  };
}
function thPost(owner, seed, mult, extra = {}) {
  const r = rnd(seed), b = userBase(owner);
  const metric = Math.max(12, Math.round(b.base * mult * (0.8 + r() * 0.4)));
  const code = "D" + hash(seed).toString(36).padStart(10, "0");
  return {
    type: "post", id: String(hash(seed)) + "77", code, username: owner, fullName: owner.replace(/[._]/g, " "),
    text: TITLES[hash(seed) % TITLES.length] + "\n(모의 데이터) 길게 이어지는 본문…",
    likeCount: Math.round(metric * 0.8), replyCount: Math.round(metric * 0.12), repostCount: Math.round(metric * 0.05),
    quoteCount: Math.round(metric * 0.03), shareCount: 2, viewCount: hash(seed) % 9 === 0 ? null : Math.round(metric * (20 + r() * 40)),
    createdAt: daysAgoISO(1 + Math.floor(r() * 60)), url: `https://www.threads.com/@${owner}/post/${code}`,
    isReply: false, isRepost: false, isPinned: false, likesHidden: false, mediaType: "text", images: [], videos: [],
    ...extra,
  };
}

function runActor(actor, input) {
  if (actor === "igSearch") {
    const term = input.hashtags[0];
    const posts = Array.from({ length: input.resultsLimit }, (_, i) => {
      const owner = USERS[hash(term + i) % USERS.length] + (i % 4 === 3 ? "_" + (i % 7) : "");
      const p = igPost(owner, term + "#" + i, MULTS[hash(term + "m" + i) % MULTS.length]);
      if (input.resultsType === "reels") Object.assign(p, { type: "Video", productType: "clips", videoPlayCount: p.likesCount * 14, videoDuration: 31 });
      return p;
    });
    posts[1].likesCount = -1;                       // 좋아요 숨김 사례
    posts[2].ownerUsername = "private.person";      // 프로필을 못 가져오는 사례
    return posts;
  }
  if (actor === "igProfile") {
    return input.usernames.filter(u => u !== "private.person" && u !== "no.such.user").map(igProfile);
  }
  if (actor === "igPost") {
    return [igPost("minji_home", input.directUrls[0], 6)];
  }
  if (actor === "threads") {
    if (input.mode === "search") {
      const term = input.keywords[0];
      const posts = Array.from({ length: input.maxPosts }, (_, i) =>
        thPost(USERS[hash(term + "t" + i) % USERS.length] + (i % 3 === 2 ? "." + (i % 5) : ""),
          term + "#t" + i, MULTS[hash(term + "tm" + i) % MULTS.length], { query: term, isReply: i % 6 === 5 }));
      return [...posts, { type: "notice", notice: "mock summary row" }];
    }
    return input.usernames.filter(u => u !== "no.such.user").flatMap(u => [
      ...Array.from({ length: input.maxPosts }, (_, i) =>
        thPost(u, u + "#recent" + i, [0.6, 0.8, 1.0, 1.2, 1.4, 4.5][i % 6], { sourceUsername: u, isReply: i % 5 === 4 })),
      { type: "profile", username: u, fullName: u.replace(/[._]/g, " "), followerCount: userBase(u).subs,
        biography: "모의 프로필", profilePicUrl: `https://scontent.cdninstagram.com/mock/${u}.jpg` },
    ]);
  }
  return [];
}

const RUNS = new Map();
const ACT_IDS = { igSearch: "reGe1ST3OBgYZSsZJ", igProfile: "dSCLg0C3YEZ83HzYX", igPost: "shu8hvrXbJbY3Eb9W", threads: "hcPo0mbyQuWE4agKO" };
export async function apify(req, res) {
  const { action } = req.query;
  if (action === "start") {
    // 입력 정리는 실제 프록시와 똑같이 거친다 (프록시의 허용 목록·상한까지 같이 검증하려고)
    const { default: real } = await import("../api/apify.js");
    const captured = {};
    const origFetch = globalThis.fetch;
    process.env.APIFY_TOKEN ||= "mock";
    globalThis.fetch = async (url, init) => { captured.input = JSON.parse(init.body); return new Response(JSON.stringify({ data: { actId: ACT_IDS[req.query.actor], id: "x", status: "RUNNING" } })); };
    const fake = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
    try { await real(req, fake); } finally { globalThis.fetch = origFetch; }
    if (fake.code !== 200) return res.status(fake.code).json(fake.body);
    const id = "mockRun" + String(RUNS.size + 1).padStart(6, "0");
    RUNS.set(id, { polls: 0, items: runActor(req.query.actor, captured.input) });
    return res.status(200).json({ data: { id, status: "RUNNING", defaultDatasetId: id } });
  }
  const run = RUNS.get(req.query.run || req.query.dataset);
  if (!run) return res.status(404).json({ error: { message: "mock run not found" } });
  if (action === "status") {
    await new Promise(r => setTimeout(r, 400));
    const done = ++run.polls >= 2;                  // 한 번은 "실행 중"을 보여준 뒤 완료
    return res.status(200).json({ data: { id: req.query.run, status: done ? "SUCCEEDED" : "RUNNING", defaultDatasetId: req.query.run } });
  }
  return res.status(200).json(run.items);
}

export async function img(req, res) {
  // 가짜 타일은 모의 데이터의 주소(/mock/)에만. 모의 서버에서 실제 토큰으로 수집한 진짜 주소는 진짜 프록시로 넘긴다
  if (!String(req.query.u || "").includes("/mock/")) return (await import("../api/img.js")).default(req, res);
  const label = decodeURIComponent(String(req.query.u || "")).split("/").pop().slice(0, 6);
  const hue = hash(req.query.u) % 360;
  res.setHeader("Content-Type", "image/svg+xml");
  res.status(200).send(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue} 55% 78%)"/><text x="100" y="108" font-size="22" text-anchor="middle" fill="hsl(${hue} 40% 30%)" font-family="sans-serif">${label.replace(/[<&>]/g, "")}</text></svg>`);
}
