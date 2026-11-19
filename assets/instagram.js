// Instagram 탭
// 아웃라이어 = "그 계정의 같은 종류 게시물 평균"의 몇 배인가.
//   · 포스트(이미지·캐러셀): 반응수(좋아요+댓글) ÷ 계정 최근 포스트의 평균 반응수
//   · 릴스: 조회수 ÷ 계정 최근 릴스의 평균 조회수 (기본). 기준을 반응수로 바꿀 수 있고, 두 값을 모두 저장해 즉시 전환한다
//   · 고정 게시물과 자기 자신은 평균에서 뺀다 (표본이 작아서, 터진 게시물이 자기 평균을 끌어올리면 배수가 낮게 나온다)
// 데이터 (전부 Apify):
//   · 검색            — Instagram Hashtag Scraper
//   · 팔로워 + 포스트 — Instagram Profile Scraper. "최근 게시물 12개"에 릴스는 들어 있지 않다(2026-11 실측)
//   · 계정의 릴스     — Instagram Reel Scraper. 릴스 평균(조회수 포함)은 여기서만 얻을 수 있다
"use strict";

function igBasis() { return $("ig-basis").value === "eng" ? "eng" : "views"; }

// Apify 결과 1건 → 플랫폼 내부 형태. 모드(해시태그/키워드)에 따라 필드명이 달라질 수 있어 후보를 여럿 본다.
function igNorm(p) {
  const likes = toCount(pick(p, "likesCount", "likes", "like_count"));
  const comments = toCount(pick(p, "commentsCount", "comments_count", "comment_count"));
  const type = String(pick(p, "type", "media_type") || "");
  const product = String(pick(p, "productType", "product_type") || "");
  const cap = pick(p, "caption", "text");
  const code = pick(p, "shortCode", "shortcode", "code");
  return {
    id: String(pick(p, "id", "pk") || code || ""),
    code,
    owner: String(pick(p, "ownerUsername", "owner.username", "user.username", "username") || "").toLowerCase(),
    caption: typeof cap === "string" ? cap : String(cap?.text || ""),
    kind: product === "clips" || /video|reel/i.test(type) ? "릴스"
        : /sidecar|carousel/i.test(type) ? "캐러셀" : "이미지",
    likes, comments,
    views: toCount(pick(p, "videoPlayCount", "videoViewCount", "playCount", "viewCount", "play_count", "view_count")),
    metric: likes != null ? likes + (comments || 0) : null,   // 좋아요 숨김이면 판정 불가
    date: toDate(pick(p, "timestamp", "takenAt", "taken_at", "takenAtTimestamp")),
    duration: Math.round(Number(pick(p, "videoDuration", "video_duration")) || 0),
    url: pick(p, "url", "postUrl") || (code ? `https://www.instagram.com/p/${code}/` : ""),
    thumb: pick(p, "displayUrl", "thumbnailUrl", "thumbnailSrc", "imageUrl", "images.0", "childPosts.0.displayUrl") || "",
    pinned: !!p.isPinned,
  };
}

// ---------------- 계정 평균(기준선) ----------------
// 기준선 = { avg(평균 반응수), avgViews(평균 조회수), n, metrics[], viewsList[], sameKind }
// sameKind=false 면 "릴스를 포스트 평균과 비교"처럼 다른 종류와 비교했다는 뜻.
function igBaseOf(list, target, sameKind) {
  if (target) list = list.filter(p => p.id !== target.id && (!target.code || p.code !== target.code));
  const unpinned = list.filter(p => !p.pinned);
  if (unpinned.length >= 3) list = unpinned;
  const metrics = list.map(p => p.metric).filter(v => v != null);
  const viewsList = list.map(p => p.views).filter(v => v != null);
  return { avg: mean(metrics), avgViews: mean(viewsList), n: list.length, metrics, viewsList, sameKind };
}

// 프로필의 최근 게시물(포스트만 들어 있다)로 만든 기준선. 같은 종류가 3개 이상이면 그것끼리만 비교한다.
function igBaseline(profile, target) {
  const posts = (profile?.latestPosts || []).map(igNorm);
  if (target) {
    const same = posts.filter(p => (p.kind === "릴스") === (target.kind === "릴스")
      && p.id !== target.id && (!target.code || p.code !== target.code));
    if (same.length >= 3) return igBaseOf(same, target, true);
  }
  return igBaseOf(posts, target, !target);
}

// 그 계정의 릴스들로 만든 기준선. 비교할 릴스가 2개 미만이면 null (호출한 쪽에서 포스트 기준선으로 대신한다)
function igReelBaseline(reels, target) {
  const base = igBaseOf(reels || [], target, true);
  return base.n >= 2 ? base : null;
}

// 검색 결과에 가끔 이미지·조회수가 빠진 "반쪽" 게시물이 섞여 온다(2026-11 실측 12개 중 1개).
// 같은 게시물이 이미 가져온 그 계정의 게시물 목록에 있으면 거기서 채운다 (추가 비용 없음).
function igFill(n, candidates) {
  if (n.thumb && (n.kind !== "릴스" || n.views != null)) return n;
  const m = (candidates || []).find(p => (n.code && p.code === n.code) || p.id === n.id);
  if (m) {
    n.thumb ||= m.thumb;
    n.views ??= m.views;
    n.duration ||= m.duration;
  }
  return n;
}

function igRow(n, subs, base) {
  base = base || {};
  const title = hookOf(n.caption);
  const ratio = (v, avg) => (avg > 0 && v != null ? v / avg : null);
  const isReel = n.kind === "릴스";
  // 조회수 평균은 릴스를 릴스끼리 비교했을 때만 의미가 있다
  const avgViews = isReel && base.sameKind ? base.avgViews : null;
  const row = {
    id: n.id,
    title,
    text: n.caption.slice(0, 500),
    kind: n.kind,
    duration: isReel ? fmtDuration(n.duration) : "",
    views: n.views, likes: n.likes, comments: n.comments, metric: n.metric, subs,
    avgEng: base.avg != null ? Math.round(base.avg) : null,
    avgViews: avgViews != null ? Math.round(avgViews) : null,
    outlierEng: ratio(n.metric, base.avg),
    outlierViews: ratio(n.views, avgViews),
    mixedBase: isReel && base.avg != null && !base.sameKind,   // 릴스인데 포스트 평균과 비교됨
    velocity: n.metric != null && n.date ? Math.round(n.metric / daysSince(n.date)) : null,
    engagement: subs && n.metric != null ? n.metric / subs * 100 : null,
    channel: n.owner ? "@" + n.owner : "-",
    tier: tierOf(subs),
    date: n.date ? n.date.toISOString().slice(0, 10) : "",
    patterns: classifyTitle(title),
    url: n.url,
    thumb: n.thumb,
  };
  return igApplyBasis([row])[0];
}

// 표가 읽는 칸(outlier, channelAvg)에 선택한 기준의 값을 옮겨 담는다.
// 조회수 기준은 릴스에만 적용되고(포스트는 조회수가 없다), 릴스 평균 조회수가 없으면 반응수로 대신한다.
// 기준 전환 전에 저장된 옛 히스토리 행(두 값이 없는 행)은 그대로 둔다.
function igApplyBasis(rows, basis = igBasis()) {
  for (const r of rows) {
    if (r.outlierEng === undefined && r.outlierViews === undefined) continue;
    const byViews = basis === "views" && r.kind === "릴스" && r.outlierViews != null;
    r.outlier = (byViews ? r.outlierViews : r.outlierEng) ?? null;
    r.channelAvg = (byViews ? r.avgViews : r.avgEng) ?? null;
    r.basis = byViews ? "조회수" : "반응수";
  }
  return rows;
}

// 결과 표의 열. 조회수 기준으로 볼 수 있는 릴스가 있으면 [조회수 | 평균 조회수 | 아웃라이어]를 앞에 둔다.
function igCols() {
  const rows = S.instagram.rows;
  const byViews = igBasis() === "views" && rows.some(r => r.basis === "조회수");
  const strong = key => r => r[key] != null ? `<b>${fmtNum(r[key])}</b>` : (key === "metric" ? "비공개" : "-");
  const views = { key: "views", label: "조회수", tip: "릴스만", hideIfEmpty: true, cell: byViews ? strong("views") : cellNum("views") };
  const avgViews = { key: "avgViews", label: "평균 조회수", tip: "그 계정 최근 릴스의 평균 조회수 (고정 게시물·이 릴스 제외)", dim: true, hideIfEmpty: true, cell: cellNum("avgViews") };
  const metric = { key: "metric", label: "반응수", tip: "좋아요 + 댓글", cell: byViews ? cellHidden("metric") : strong("metric") };
  const avgEng = { key: "avgEng", label: "평균 반응수", tip: "그 계정 최근 게시물의 평균 반응수 (같은 종류끼리)", dim: true,
    cell: r => fmtNum(r.avgEng ?? (r.outlierEng === undefined ? r.channelAvg : null)) + (r.mixedBase ? ' <span title="이 계정의 릴스를 가져오지 못해 포스트 평균과 비교했습니다">*</span>' : "") };
  const outlier = { ...COL_OUTLIER, tip: "같은 종류 평균의 몇 배인가 — 릴스는 위에서 고른 기준, 포스트는 반응수",
    cell: r => outlierBadge(r.outlier) };
  const rest = [
    { key: "likes", label: "좋아요", cell: cellHidden("likes") },
    { key: "comments", label: "댓글", cell: cellNum("comments") },
    { key: "engagement", label: "참여율", tip: "반응수 ÷ 팔로워", cell: cellPct },
  ];
  return byViews ? [views, avgViews, outlier, metric, avgEng, ...rest]
                 : [metric, avgEng, outlier, views, avgViews, ...rest];
}

// ---------------- Apify 호출 ----------------
async function igProfiles(usernames, onTick) {
  const items = await apifyRun("igProfile", { usernames }, onTick);
  const map = {};
  for (const p of items) {
    if (p?.username && !p.error) map[String(p.username).toLowerCase()] = p;
  }
  return { map, billed: items.length };
}

// 계정들의 릴스 탭에서 최근 릴스를 계정당 limit개씩 → { 계정: [릴스...] }
async function igReelsOf(usernames, limit, onTick) {
  const items = await apifyRun("igReels", {
    username: usernames, resultsLimit: limit,
    includeSharesCount: false, includeTranscript: false, includeDownloadedVideo: false,   // 건당 추가 요금 옵션은 끔
  }, onTick);
  const byOwner = {};
  for (const it of items) {
    if (!it || it.error) continue;
    const n = { ...igNorm(it), kind: "릴스" };
    // 계정이 하나면 그 계정 것이 확실하다. 여러 계정이면 결과의 ownerUsername 으로 나눈다
    const owner = n.owner || (usernames.length === 1 ? usernames[0] : "");
    if (!owner) continue;
    n.owner = owner;
    (byOwner[owner] ??= []).push(n);
  }
  const a = APIFY_ACTORS.igReels;
  return { byOwner, cost: a.start + items.length * a.price };
}

function igInit() {
  PLATFORMS.instagram.prepare = igApplyBasis;
  // 기준을 바꾸면 다시 수집하지 않고 저장해 둔 값으로 즉시 다시 계산
  $("ig-basis").addEventListener("change", () => {
    igApplyBasis(S.instagram.rows);
    if (PF === "instagram") renderResults();
  });
  ["ig-type", "ig-max", "ig-reelSample"].forEach(id => $(id).addEventListener("change", igUpdateEstimate));
  igUpdateEstimate();
}

function igUpdateEstimate() {
  const type = $("ig-type").value, max = parseInt($("ig-max").value), sample = parseInt($("ig-reelSample").value);
  const price = APIFY_ACTORS.igSearch.price;
  const fetched = type === "posts" ? Math.min(max * 2, 100) : max;
  const owners = Math.round(max * 0.85);                                   // 보통 게시물 수의 80~90%가 서로 다른 계정
  const reelOwners = type === "reels" ? owners : type === "all" ? Math.round(owners * 0.6) : 0;
  const usd = fetched * price + owners * price + (sample ? reelOwners * sample * price + APIFY_ACTORS.igReels.start : 0);
  $("ig-reelSample").disabled = type === "posts";
  $("ig-estimate").textContent = `이 설정으로 1회 최대 약 $${usd.toFixed(2)}`
    + (type === "posts" ? " (포스트는 릴스를 걸러내느라 2배를 가져옵니다)"
      : sample ? ` (릴스 계정 약 ${reelOwners}개 × 릴스 ${sample}개 포함)` : " (릴스 평균 없이 — 포스트 평균과 비교)");
}

// ---------------- 해시태그 · 키워드 검색 ----------------
async function igRun() {
  const pf = "instagram";
  const raw = $("ig-topic").value.trim();
  if (!raw) { setStatus(pf, "⚠️ 검색어를 입력하세요.", null, true); return; }
  if (!apifyReady(pf)) return;

  const mode = $("ig-mode").value;
  const type = $("ig-type").value;
  const months = parseInt($("ig-months").value);
  const max = parseInt($("ig-max").value);
  const reelSample = type === "posts" ? 0 : parseInt($("ig-reelSample").value);

  let term = raw.replace(/^#+/, "").trim();
  if (mode === "hashtag") term = term.replace(/\s+/g, "");
  if (!term || /[!?.,:;\-+=*&%$#@/\\~^|<>()[\]{}"'`]/.test(term)) {
    setStatus(pf, "⚠️ 검색어에는 글자·숫자·밑줄만 쓸 수 있습니다 (특수문자 제외).", null, true);
    return;
  }
  const label = (mode === "hashtag" ? "#" : "") + term;
  const wantReels = type === "reels";
  const kindWord = { posts: "포스트", reels: "릴스", all: "게시물" }[type] || "게시물";
  // "posts" 결과에는 릴스가 많이 섞여 온다 → 포스트만 볼 때는 2배를 가져와서 릴스를 걸러낸다
  const fetchLimit = type === "posts" ? Math.min(max * 2, 100) : max;
  const price = APIFY_ACTORS.igSearch.price;
  const steps = reelSample ? 4 : 3;
  let cost = 0;

  await withBusy(pf, "ig-runBtn", ICONS.spinner + " 수집 중...", async () => {
    try {
      const step1 = sec => setStatus(pf, `🔎 [1/${steps}] 인스타그램에서 "${escapeHtml(label)}" ${kindWord} 찾는 중...${waitMsg(sec)}`, 12);
      step1(0);
      const found = await apifyRun("igSearch", {
        hashtags: [term], keywordSearch: mode === "keyword", resultsType: wantReels ? "reels" : "posts", resultsLimit: fetchLimit,
      }, step1);
      cost += found.length * price;
      apifyAddCost(found.length * price);

      const seen = new Set();
      let posts = found.filter(p => p && !p.error).map(igNorm)
        .filter(p => p.owner && p.id && !seen.has(p.id) && seen.add(p.id));
      if (!posts.length) throw new Error("검색 결과가 없습니다. 검색어나 검색 방식을 바꿔보세요.");

      // 포스트 / 릴스 / 전체. 릴스 검색 결과는 전부 릴스이므로 종류 표시만 맞춰주고, 전체는 섞인 그대로 둔다
      let otherKind = 0;
      if (wantReels) {
        posts.forEach(p => { p.kind = "릴스"; });
      } else if (type === "posts") {
        const before = posts.length;
        posts = posts.filter(p => p.kind !== "릴스");
        otherKind = before - posts.length;
        if (!posts.length) throw new Error(`"${label}" 인기 게시물 ${before}개가 전부 릴스라 포스트가 없습니다. 콘텐츠를 '릴스'로 바꿔 검색해보세요.`);
      }

      let outOfRange = 0;
      if (months > 0) {
        const after = monthsAgo(months);
        const before = posts.length;
        posts = posts.filter(p => p.date && p.date >= after);
        outOfRange = before - posts.length;
        if (!posts.length) throw new Error(`최근 ${months}개월 안에 올라온 게시물이 없습니다. 기간을 넓혀보세요.`);
      }
      posts = posts.slice(0, max);

      const owners = [...new Set(posts.map(p => p.owner))];
      const step2 = sec => setStatus(pf, `📊 [2/${steps}] 계정 ${owners.length}개의 팔로워·포스트 평균 계산 중...${waitMsg(sec)}`, 40);
      step2(0);
      const { map: profiles, billed } = await igProfiles(owners, step2);
      cost += billed * APIFY_ACTORS.igProfile.price;
      apifyAddCost(billed * APIFY_ACTORS.igProfile.price);

      // 릴스는 그 계정의 릴스 탭을 따로 가져와야 릴스끼리(조회수 포함) 비교할 수 있다
      let reelsByOwner = {}, reelsFailed = null;
      const reelOwners = [...new Set(posts.filter(p => p.kind === "릴스").map(p => p.owner))];
      if (reelSample && reelOwners.length) {
        const step3 = sec => setStatus(pf, `🎬 [3/${steps}] 계정 ${reelOwners.length}개의 최근 릴스 ${reelSample}개씩 가져오는 중... (평균 조회수 계산용)${waitMsg(sec)}`, 65);
        step3(0);
        try {
          const res = await igReelsOf(reelOwners, reelSample, step3);
          reelsByOwner = res.byOwner;
          cost += res.cost;
          apifyAddCost(res.cost);
        } catch (e) { reelsFailed = e; }
      }

      setStatus(pf, `🧮 [${steps}/${steps}] 아웃라이어 배수 계산 중...`, 90);
      const rows = posts.map(n => {
        const prof = profiles[n.owner];
        const subs = prof ? toCount(prof.followersCount) : null;
        const ownReels = reelsByOwner[n.owner];
        igFill(n, ownReels);
        igFill(n, (prof?.latestPosts || []).map(igNorm));
        const base = (n.kind === "릴스" && igReelBaseline(ownReels, n)) || igBaseline(prof, n);
        return igRow(n, subs, base);
      });
      const noBase = rows.filter(r => r.outlier == null).length;
      const mixed = rows.filter(r => r.mixedBase).length;
      const byViews = rows.filter(r => r.basis === "조회수").length;

      setStatus(pf, `✅ 완료! ${kindWord} ${rows.length}개 · 계정 ${owners.length}개`
        + (otherKind ? ` · 릴스 ${otherKind}개 제외` : "")
        + (outOfRange ? ` · 기간 밖 ${outOfRange}개 제외` : "")
        + (noBase ? ` · 판정 불가 ${noBase}개(비공개 계정·좋아요 숨김)` : "")
        + ` · 비용 ${fmtUsd(cost)}`
        + (reelsFailed ? `<br>⚠️ 계정별 릴스를 가져오지 못했습니다: ${escapeHtml(reelsFailed.message || reelsFailed)}` : "")
        + (mixed ? `<br>ℹ️ 릴스 ${mixed}개는 그 계정의 <b>포스트</b> 평균 반응수와 비교했습니다 (표에 * 표시)`
            + (reelSample ? " — 그 계정의 다른 릴스를 충분히 가져오지 못했습니다." : " — '릴스 평균 표본'이 꺼져 있습니다.")
            + " 릴스는 보통 반응이 더 커서 배수가 높게 나올 수 있어요." : ""), 100);

      commitResults(pf, {
        rows, topic: label, channelCount: owners.length, costText: fmtUsd(cost),
        history: {
          type: "search",
          desc: (mode === "hashtag" ? "해시태그" : "키워드") + " · " + (type === "all" ? "전체" : kindWord)
            + (months > 0 ? ` · 최근 ${months}개월` : "") + (byViews ? ` · 릴스 표본 ${reelSample}개` : ""),
        },
      });
    } catch (e) {
      setStatus(pf, `❌ ${escapeHtml(e.message || e)}`
        + (cost ? `<br>여기까지 쓴 비용: ${fmtUsd(cost)}` : "")
        + (S[pf].rows.length ? "<br>이전 결과는 유지됩니다." : ""), null, true);
    }
  });
}

// ---------------- 게시물 · 계정 분석 ----------------
function igParseLink(input) {
  const s = input.trim();
  let m;
  if ((m = /instagram\.com\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/i.exec(s))) {
    return { kind: "post", url: `https://www.instagram.com/${/^reel/i.test(m[1]) ? "reel" : "p"}/${m[2]}/`, code: m[2] };
  }
  if ((m = /instagram\.com\/([\w.]{1,30})\/?(?:[?#].*)?$/i.exec(s)) || (m = /^@?([\w.]{1,30})$/.exec(s))) {
    return { kind: "account", handle: m[1].toLowerCase() };
  }
  return null;
}

async function igAnalyze() {
  const pf = "instagram";
  const resultEl = $("ig-analyzeResult");
  const ref = igParseLink($("ig-link").value);
  if (!ref) {
    resultEl.innerHTML = `<div class="note" style="margin-top:10px;color:var(--danger)">⚠️ 게시물 링크나 계정(@아이디)을 인식하지 못했습니다.</div>`;
    return;
  }
  if (!apifyToken() && location.protocol === "file:") {
    resultEl.innerHTML = `<div class="note" style="margin-top:10px;color:var(--danger)">⚠️ Apify API 토큰을 입력하세요.</div>`;
    return;
  }
  const waiting = what => sec => {
    resultEl.innerHTML = `<div class="note" style="margin-top:10px">${what}${waitMsg(sec)}</div>`;
  };
  await withBusy(pf, "ig-analyzeBtn", ICONS.spinner, async () => {
    try {
      if (ref.kind === "account") await igAnalyzeAccount(ref.handle, resultEl, waiting("계정 분석 중..."));
      else await igAnalyzePost(ref, resultEl, waiting);
    } catch (e) { analyzeError(resultEl, e); }
  });
}

async function igAnalyzeAccount(handle, resultEl, tick) {
  const pf = "instagram";
  tick(0);
  // 프로필(팔로워 + 최근 포스트)과 릴스를 동시에 가져온다. 릴스가 실패해도 포스트만으로 분석은 계속
  let reelsError = null;
  const [{ map, billed }, reelRes] = await Promise.all([
    igProfiles([handle], tick),
    igReelsOf([handle], 12).catch(e => { reelsError = e; return { byOwner: {}, cost: 0 }; }),
  ]);
  const cost = billed * APIFY_ACTORS.igProfile.price + reelRes.cost;
  apifyAddCost(cost);
  const prof = map[handle] || Object.values(map)[0];
  if (!prof) throw new Error("계정을 찾을 수 없습니다. 아이디를 확인해주세요.");
  if (prof.private) throw new Error("비공개 계정이라 게시물을 볼 수 없습니다.");

  const subs = toCount(prof.followersCount);
  // 프로필의 최근 게시물 + 릴스 탭을 합친다 (같은 게시물이 양쪽에 있으면 릴스 쪽 데이터 우선 — 조회수가 있다)
  const reelList = reelRes.byOwner[handle] || Object.values(reelRes.byOwner)[0] || [];
  const reelCodes = new Set(reelList.map(r => r.code));
  const fromProfile = (prof.latestPosts || []).map(igNorm)
    .map(n => ({ ...n, owner: n.owner || handle })).filter(n => !reelCodes.has(n.code));
  const all = [...fromProfile, ...reelList];
  if (!all.length) throw new Error("분석할 게시물이 없습니다.");
  const posts = all.filter(n => n.kind !== "릴스"), reels = all.filter(n => n.kind === "릴스");
  // 계정 전체를 볼 때는 유튜브 채널 분석처럼 자기 자신도 평균에 넣는다
  const basePost = igBaseOf(posts, null, true), baseReel = igBaseOf(reels, null, true);

  const rows = all.map(n => igRow(n, subs, n.kind === "릴스" ? baseReel : basePost));
  const best = [...rows].sort((a, b) => (b.outlier || 0) - (a.outlier || 0))[0];
  const perWeek = perWeekOf(all.filter(p => !p.pinned).map(p => p.date));
  const name = prof.fullName || "@" + handle;
  const num = v => v != null ? fmtNum(Math.round(v)) : "-";

  resultEl.innerHTML = `
    <div class="analyze-card">
      ${avatarImg(prof.profilePicUrlHD || prof.profilePicUrl, name)}
      <div class="body">
        <div class="verdict">📷 ${escapeHtml(name)}</div>
        <div class="vch"><a href="https://www.instagram.com/${escapeHtml(handle)}/" target="_blank" rel="noopener">@${escapeHtml(handle)}</a>
          · ${tierOf(subs)} 계정${prof.verified ? " · 인증됨" : ""}
          · 총 게시물 ${prof.postsCount != null ? Number(prof.postsCount).toLocaleString() : "-"}개${perWeek != null ? ` · 주 ${perWeek.toFixed(1)}개 게시` : ""}</div>
        ${metricGrid([
          ["팔로워", subs != null ? fmtNum(subs) : "비공개"],
          [`릴스 평균 조회수 (${baseReel.n}개)`, num(baseReel.avgViews), "var(--blue)"],
          [`릴스 평균 반응수 (${baseReel.n}개)`, num(baseReel.avg)],
          [`포스트 평균 반응수 (${basePost.n}개)`, num(basePost.avg), "var(--blue)"],
          ["평균 참여율 (포스트)", subs && basePost.avg != null ? (basePost.avg / subs * 100).toFixed(2) + "%" : "-"],
          ["최고 아웃라이어", best?.outlier ? `${best.outlier.toFixed(1)}x (${best.kind === "릴스" ? "릴스 " + best.basis : "포스트"})` : "-", "var(--accent)"],
        ])}
        <div class="note">⬇️ 아래 결과 테이블에 최근 포스트 ${posts.length}개와 릴스 ${reels.length}개가 로드되었습니다. 표 위의 "종류" 필터로 나눠 볼 수 있습니다.
          아웃라이어 배수는 같은 종류의 평균과 비교합니다 (릴스는 릴스 평균 ${igBasis() === "views" ? "조회수" : "반응수"}, 포스트는 포스트 평균 반응수 · 고정 게시물 제외).
          ${reelsError ? `<br>⚠️ 릴스는 가져오지 못했습니다: ${escapeHtml(reelsError.message || reelsError)}` : ""}
          ${!reelsError && !reels.length ? "<br>이 계정에는 릴스가 없습니다." : ""}</div>
      </div>
    </div>`;

  commitResults(pf, {
    rows, topic: "@" + handle, sortKey: "date", channelCount: 1, costText: fmtUsd(cost),
    history: { type: "channel", desc: `계정 분석 · 팔로워 ${subs != null ? fmtNum(subs) : "비공개"} · 포스트 ${posts.length} · 릴스 ${reels.length}` },
  });
}

async function igAnalyzePost(ref, resultEl, waiting) {
  const t1 = waiting("게시물 불러오는 중...");
  t1(0);
  const items = await apifyRun("igPost", { directUrls: [ref.url], resultsType: "posts", resultsLimit: 1 }, t1);
  apifyAddCost(items.length * APIFY_ACTORS.igPost.price);
  const raw = items.find(p => p && !p.error);
  if (!raw) throw new Error("게시물을 찾을 수 없습니다 (삭제되었거나 비공개 계정일 수 있음).");
  const n = igNorm(raw);
  if (!n.code) n.code = ref.code;
  if (!n.owner) throw new Error("게시물의 계정 정보를 가져오지 못했습니다.");

  const t2 = waiting(`@${escapeHtml(n.owner)} 계정의 평소 수치 계산 중...`);
  t2(0);
  const { map, billed } = await igProfiles([n.owner], t2);
  apifyAddCost(billed * APIFY_ACTORS.igProfile.price);
  const prof = map[n.owner];
  const subs = prof ? toCount(prof.followersCount) : null;
  let base = igBaseline(prof, n);
  if (n.kind === "릴스") {
    // 프로필의 최근 게시물에는 릴스가 없으므로, 릴스는 그 계정의 릴스 탭과 비교한다
    const t3 = waiting(`@${escapeHtml(n.owner)} 계정의 다른 릴스와 비교 중...`);
    t3(0);
    try {
      const { byOwner, cost } = await igReelsOf([n.owner], 12, t3);
      apifyAddCost(cost);
      const own = byOwner[n.owner] || Object.values(byOwner)[0];
      igFill(n, own);
      base = igReelBaseline(own, n) || base;
    } catch (e) { console.warn("릴스 비교 실패 — 포스트 평균으로 대신 비교", e); }
  }
  const r = igRow(n, subs, base);
  const byViews = r.basis === "조회수";
  const word = byViews ? "조회수" : "반응수";
  const mine = byViews ? r.views : r.metric;
  const others = byViews ? base.viewsList : base.metrics;
  const verdict = verdictFor(r.outlier, "계정");
  const rank = mine != null && others.length ? others.filter(m => m > mine).length + 1 : null;
  const days = n.date ? daysSince(n.date) : null;
  const thumb = thumbSrc(n.thumb);
  const num = v => v != null ? fmtNum(Math.round(v)) : "-";

  resultEl.innerHTML = `
    <div class="analyze-card">
      ${/^(https:\/\/|\/api\/img\?)/.test(thumb) ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(thumb)}" referrerpolicy="no-referrer" onerror="this.remove()" alt="게시물 미리보기"></a>` : ""}
      <div class="body">
        <div class="verdict" style="color:${verdict.color}">${verdict.emoji} ${verdict.text}</div>
        <div class="vtitle"><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title) || "(캡션 없음)"}</a></div>
        <div class="vch">@${escapeHtml(n.owner)} · 팔로워 ${subs != null ? fmtNum(subs) : "비공개"} (${tierOf(subs)})
          · ${r.kind}${r.date ? ` · ${r.date} 게시 (${days}일 전)` : ""}${r.duration ? " · ⏱ " + r.duration : ""}
          · ${r.patterns.map(p => `<span class="pattern-tag">${p}</span>`).join("")}</div>
        ${metricGrid([
          [`이 게시물 ${word}`, mine != null ? fmtNum(mine) : (byViews ? "-" : "비공개")],
          [`계정 평균 ${word}`, num(byViews ? base.avgViews : base.avg)],
          [`아웃라이어 배수 (${word})`, r.outlier != null ? r.outlier.toFixed(1) + "x" : "-", verdict.color],
          byViews ? ["반응수 (평균 대비)", `${r.metric != null ? fmtNum(r.metric) : "비공개"}${r.outlierEng != null ? ` · ${r.outlierEng.toFixed(1)}x` : ""}`]
                  : ["조회수", r.views != null ? fmtNum(r.views) : "-"],
          ["좋아요 · 댓글", `${r.likes != null ? fmtNum(r.likes) : "비공개"} · ${fmtNum(r.comments)}`],
          ["참여율 (팔로워 대비)", r.engagement != null ? r.engagement.toFixed(2) + "%" : "-"],
        ])}
        <div class="note">
          ${verdict.desc}
          ${rank != null ? `<br>📊 이 계정 최근 ${base.sameKind ? (n.kind === "릴스" ? "릴스" : "포스트") : "게시물"} ${others.length}개와 비교하면 ${word} <b>${rank}위</b> 수준 (고정 게시물 제외)` : ""}
          ${r.mixedBase ? "<br>⚠️ 이 계정의 다른 릴스를 충분히 가져오지 못해 포스트 평균 반응수와 비교했습니다. 릴스는 보통 반응이 더 커서 배수가 높게 나올 수 있습니다." : ""}
          ${r.metric == null && !byViews ? "<br>⚠️ 좋아요 수가 숨겨져 있어 배수를 계산할 수 없습니다." : ""}
          ${!prof ? "<br>⚠️ 계정 정보를 불러오지 못해 팔로워 수를 알 수 없습니다." : ""}
        </div>
      </div>
    </div>`;
}
