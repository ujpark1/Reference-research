// Instagram 탭
// 아웃라이어 = 게시물의 반응수(좋아요+댓글) ÷ 그 계정 최근 게시물의 평균 반응수.
//   · 조회수는 릴스에만 있고 계정 평균을 내기 어려워서 기준에서 뺐다 (표에는 참고로 보여준다)
//   · 계정 평균은 프로필의 최근 게시물(최대 12개)로 계산. 고정 게시물과 자기 자신은 평균에서 뺀다
//     (표본이 작아서, 터진 게시물이 자기 평균을 끌어올리면 배수가 실제보다 낮게 나오기 때문)
// 데이터: Apify의 Instagram Hashtag Scraper(검색) + Instagram Profile Scraper(계정 평균)
"use strict";

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
    thumb: pick(p, "displayUrl", "thumbnailUrl", "imageUrl", "images.0") || "",
    pinned: !!p.isPinned,
  };
}

// 프로필의 최근 게시물로 계정 평균 반응수 계산
function igBaseline(profile, exclude) {
  let posts = (profile?.latestPosts || []).map(igNorm).filter(p => p.metric != null);
  const unpinned = posts.filter(p => !p.pinned);
  if (unpinned.length >= 3) posts = unpinned;
  if (exclude) posts = posts.filter(p => p.id !== exclude.id && (!exclude.code || p.code !== exclude.code));
  return { avg: mean(posts.map(p => p.metric)), n: posts.length, metrics: posts.map(p => p.metric) };
}

function igRow(n, subs, avg) {
  const title = hookOf(n.caption);
  return {
    id: n.id,
    title,
    text: n.caption.slice(0, 500),
    kind: n.kind,
    duration: n.kind === "릴스" ? fmtDuration(n.duration) : "",
    views: n.views, likes: n.likes, comments: n.comments, metric: n.metric, subs,
    outlier: avg > 0 && n.metric != null ? n.metric / avg : null,
    velocity: n.metric != null && n.date ? Math.round(n.metric / daysSince(n.date)) : null,
    engagement: subs && n.metric != null ? n.metric / subs * 100 : null,
    channel: n.owner ? "@" + n.owner : "-",
    channelAvg: avg != null ? Math.round(avg) : null,
    tier: tierOf(subs),
    date: n.date ? n.date.toISOString().slice(0, 10) : "",
    patterns: classifyTitle(title),
    url: n.url,
    thumb: n.thumb,
  };
}

async function igProfiles(usernames, onTick) {
  const items = await apifyRun("igProfile", { usernames }, onTick);
  const map = {};
  for (const p of items) {
    if (p?.username && !p.error) map[String(p.username).toLowerCase()] = p;
  }
  return { map, billed: items.length };
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

  let term = raw.replace(/^#+/, "").trim();
  if (mode === "hashtag") term = term.replace(/\s+/g, "");
  if (!term || /[!?.,:;\-+=*&%$#@/\\~^|<>()[\]{}"'`]/.test(term)) {
    setStatus(pf, "⚠️ 검색어에는 글자·숫자·밑줄만 쓸 수 있습니다 (특수문자 제외).", null, true);
    return;
  }
  const label = (mode === "hashtag" ? "#" : "") + term;
  const price = APIFY_ACTORS.igSearch.price;
  let cost = 0;

  await withBusy(pf, "ig-runBtn", ICONS.spinner + " 수집 중...", async () => {
    try {
      const step1 = sec => setStatus(pf, `🔎 [1/3] 인스타그램에서 "${escapeHtml(label)}" ${type === "reels" ? "릴스" : "게시물"} 찾는 중...${waitMsg(sec)}`, 15);
      step1(0);
      const found = await apifyRun("igSearch", {
        hashtags: [term], keywordSearch: mode === "keyword", resultsType: type, resultsLimit: max,
      }, step1);
      cost += found.length * price;
      apifyAddCost(found.length * price);

      const seen = new Set();
      let posts = found.filter(p => p && !p.error).map(igNorm)
        .filter(p => p.owner && p.id && !seen.has(p.id) && seen.add(p.id));
      if (!posts.length) throw new Error("검색 결과가 없습니다. 검색어나 검색 방식을 바꿔보세요.");

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
      const step2 = sec => setStatus(pf, `📊 [2/3] 계정 ${owners.length}개의 평소 반응수 계산 중...${waitMsg(sec)}`, 55);
      step2(0);
      const { map: profiles, billed } = await igProfiles(owners, step2);
      cost += billed * APIFY_ACTORS.igProfile.price;
      apifyAddCost(billed * APIFY_ACTORS.igProfile.price);

      setStatus(pf, "🧮 [3/3] 아웃라이어 배수 계산 중...", 90);
      const rows = posts.map(n => {
        const prof = profiles[n.owner];
        return igRow(n, prof ? toCount(prof.followersCount) : null, igBaseline(prof, n).avg);
      });
      const noBase = rows.filter(r => r.outlier == null).length;

      setStatus(pf, `✅ 완료! 게시물 ${rows.length}개 · 계정 ${owners.length}개`
        + (outOfRange ? ` · 기간 밖 ${outOfRange}개 제외` : "")
        + (noBase ? ` · 판정 불가 ${noBase}개(비공개 계정·좋아요 숨김)` : "")
        + ` · 비용 ${fmtUsd(cost)}`, 100);

      commitResults(pf, {
        rows, topic: label, channelCount: owners.length, costText: fmtUsd(cost),
        history: {
          type: "search",
          desc: (mode === "hashtag" ? "해시태그" : "키워드") + (type === "reels" ? " · 릴스만" : "")
            + (months > 0 ? ` · 최근 ${months}개월` : ""),
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
  const { map, billed } = await igProfiles([handle], tick);
  const cost = billed * APIFY_ACTORS.igProfile.price;
  apifyAddCost(cost);
  const prof = map[handle] || Object.values(map)[0];
  if (!prof) throw new Error("계정을 찾을 수 없습니다. 아이디를 확인해주세요.");
  if (prof.private) throw new Error("비공개 계정이라 게시물을 볼 수 없습니다.");

  const subs = toCount(prof.followersCount);
  const base = igBaseline(prof);
  const posts = (prof.latestPosts || []).map(igNorm).map(n => ({ ...n, owner: n.owner || handle }));
  if (!posts.length) throw new Error("분석할 게시물이 없습니다.");
  const rows = posts.map(n => igRow(n, subs, base.avg));
  const best = [...rows].sort((a, b) => (b.outlier || 0) - (a.outlier || 0))[0];
  const perWeek = perWeekOf(posts.filter(p => !p.pinned).map(p => p.date));
  const name = prof.fullName || "@" + handle;

  resultEl.innerHTML = `
    <div class="analyze-card">
      ${avatarImg(prof.profilePicUrlHD || prof.profilePicUrl, name)}
      <div class="body">
        <div class="verdict">📷 ${escapeHtml(name)}</div>
        <div class="vch"><a href="https://www.instagram.com/${escapeHtml(handle)}/" target="_blank" rel="noopener">@${escapeHtml(handle)}</a>
          · ${tierOf(subs)} 계정${prof.verified ? " · 인증됨" : ""}</div>
        ${metricGrid([
          ["팔로워", subs != null ? fmtNum(subs) : "비공개"],
          ["총 게시물 수", prof.postsCount != null ? Number(prof.postsCount).toLocaleString() : "-"],
          [`최근 ${base.n}개 평균 반응수`, base.avg != null ? fmtNum(Math.round(base.avg)) : "-", "var(--blue)"],
          ["평균 참여율", subs && base.avg != null ? (base.avg / subs * 100).toFixed(2) + "%" : "-"],
          ["게시 빈도", perWeek != null ? `주 ${perWeek.toFixed(1)}개` : "-"],
          ["최고 아웃라이어", best?.outlier ? best.outlier.toFixed(1) + "x" : "-", "var(--accent)"],
        ])}
        <div class="note">⬇️ 아래 결과 테이블에 이 계정의 최근 게시물 ${rows.length}개가 로드되었습니다.
          아웃라이어 배수는 이 계정 평균 반응수(${base.avg != null ? fmtNum(Math.round(base.avg)) : "-"}, 고정 게시물 제외) 기준입니다.</div>
      </div>
    </div>`;

  commitResults(pf, {
    rows, topic: "@" + handle, sortKey: "date", channelCount: 1, costText: fmtUsd(cost),
    history: { type: "channel", desc: `계정 분석 · 팔로워 ${subs != null ? fmtNum(subs) : "비공개"}` },
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

  const t2 = waiting(`@${escapeHtml(n.owner)} 계정의 평소 반응수 계산 중...`);
  t2(0);
  const { map, billed } = await igProfiles([n.owner], t2);
  apifyAddCost(billed * APIFY_ACTORS.igProfile.price);
  const prof = map[n.owner];
  const subs = prof ? toCount(prof.followersCount) : null;
  const base = igBaseline(prof, n);
  const r = igRow(n, subs, base.avg);
  const verdict = verdictFor(r.outlier, "계정");
  const rank = r.metric != null ? base.metrics.filter(m => m > r.metric).length + 1 : null;
  const days = n.date ? daysSince(n.date) : null;
  const thumb = thumbSrc(n.thumb);

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
          ["이 게시물 반응수", r.metric != null ? fmtNum(r.metric) : "비공개"],
          ["계정 평균 반응수", base.avg != null ? fmtNum(Math.round(base.avg)) : "-"],
          ["아웃라이어 배수", r.outlier != null ? r.outlier.toFixed(1) + "x" : "-", verdict.color],
          ["좋아요 · 댓글", `${r.likes != null ? fmtNum(r.likes) : "비공개"} · ${fmtNum(r.comments)}`],
          ["조회수", r.views != null ? fmtNum(r.views) : "-"],
          ["참여율 (팔로워 대비)", r.engagement != null ? r.engagement.toFixed(2) + "%" : "-"],
        ])}
        <div class="note">
          ${verdict.desc}
          ${rank != null && base.n ? `<br>📊 이 계정 최근 게시물 ${base.n}개와 비교하면 반응수 <b>${rank}위</b> 수준 (고정 게시물 제외)` : ""}
          ${r.metric == null ? "<br>⚠️ 좋아요 수가 숨겨져 있어 배수를 계산할 수 없습니다." : ""}
          ${!prof ? "<br>⚠️ 계정 정보를 불러오지 못해 평균을 계산할 수 없습니다." : ""}
        </div>
      </div>
    </div>`;
}
