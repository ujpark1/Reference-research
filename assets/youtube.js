// YouTube 탭 — channel-pulse의 reference.html 로직을 그대로 옮긴 것.
// 아웃라이어 = 조회수 ÷ 그 채널 최근 영상 30개의 평균 조회수.
// 키가 있으면 구글에 직접, 없으면 서버 프록시(/api/yt)로 호출한다.
"use strict";

const YT_API = "https://www.googleapis.com/youtube/v3";
let ytQuotaUsed = 0;

function ytKey() { return $("yt-apiKey").value.trim(); }

function ytInit() {
  const input = $("yt-apiKey");
  input.value = localStorage.getItem("yt_api_key") || "";
  input.addEventListener("change", () => localStorage.setItem("yt_api_key", input.value.trim()));
  ytUpdateQuota();
}

// ---------------- 일일 쿼터 추적 ----------------
// 쿼터는 태평양 시간 자정에 리셋되므로 그 기준 날짜로 누적 저장 (이 브라우저 사용량만 집계)
function ytQuotaDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}
function ytLoadDailyQuota() {
  try {
    const d = JSON.parse(localStorage.getItem("yt_quota_daily") || "{}");
    return d.date === ytQuotaDateKey() ? (d.units || 0) : 0;
  } catch { return 0; }
}
function ytAddDailyQuota(cost) {
  const units = ytLoadDailyQuota() + cost;
  localStorage.setItem("yt_quota_daily", JSON.stringify({ date: ytQuotaDateKey(), units }));
  ytUpdateQuota();
}
function ytUpdateQuota() {
  const u = ytLoadDailyQuota();
  const el = $("yt-quotaToday");
  el.textContent = `오늘 사용: 약 ${u.toLocaleString()} / 10,000유닛`;
  el.style.color = u >= 9000 ? "var(--danger)" : u >= 6000 ? "var(--gold)" : "var(--green)";
}

// ---------------- API ----------------
async function ytGet(endpoint, params, cost) {
  const key = ytKey();
  let url;
  if (key) {
    url = new URL(`${YT_API}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("key", key);
  } else {
    if (location.protocol === "file:") {
      throw new Error("YouTube API 키를 입력하세요. (파일로 직접 열면 서버 프록시를 쓸 수 없습니다)");
    }
    url = new URL("/api/yt", location.origin);
    url.searchParams.set("path", endpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const resp = await fetch(url);
  ytQuotaUsed += cost;
  ytAddDailyQuota(cost);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || "";
    if (["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(reason)) {
      throw new Error(`QUOTA::API 쿼터 초과 (약 ${ytQuotaUsed}유닛 사용). 내일 다시 시도하세요.`);
    }
    throw new Error(ytExplainError(body?.error || {}, resp.status));
  }
  return resp.json();
}

// Google의 영어 오류를 그대로 보여주면 원인을 알기 어려워서, 사유 코드를 읽어 "무엇을 고치면 되는지"를 앞에 붙인다.
// 사유 코드는 error.errors[].reason(구형) · error.status · error.details[].reason(신형) 세 군데에 나뉘어 온다.
function ytExplainError(err, httpStatus) {
  const reasons = [...new Set([
    ...(err.errors || []).map(e => e.reason), err.status, ...(err.details || []).map(d => d.reason),
  ].filter(Boolean))];
  const has = re => reasons.some(r => re.test(r));
  const msg = err.message || `API 오류 (${httpStatus})`;
  let hint = "";
  if (has(/SERVICE_DISABLED|accessNotConfigured/i) || /has not been used|is disabled/i.test(msg)) {
    hint = "이 키가 속한 Google Cloud 프로젝트에서 YouTube Data API v3가 꺼져 있습니다. 콘솔 → API 및 서비스 → 라이브러리에서 'YouTube Data API v3'를 찾아 '사용 설정'을 눌러주세요 (반영까지 1~2분).";
  } else if (has(/API_KEY_SERVICE_BLOCKED/)) {
    hint = "이 키의 'API 제한사항'에 YouTube Data API v3가 빠져 있습니다. 콘솔 → 사용자 인증 정보 → 키 수정에서 YouTube Data API v3를 추가해주세요.";
  } else if (has(/REFERRER_BLOCKED|IP_ADDRESS_BLOCKED|ANDROID_APP_BLOCKED|IOS_APP_BLOCKED/)) {
    hint = "이 키의 '애플리케이션 제한사항'(웹사이트·IP) 때문에 이 주소에서는 쓸 수 없습니다. 제한을 '없음'으로 바꾸거나 이 페이지 주소를 허용해주세요.";
  } else if (has(/API_KEY_INVALID|keyInvalid/i) || /API key not valid/i.test(msg)) {
    hint = "API 키가 올바르지 않습니다. 복사하다 빠진 글자가 없는지, Google Cloud에서 만든 API 키가 맞는지 확인해주세요.";
  } else if (httpStatus === 401 || httpStatus === 403 || has(/PERMISSION_DENIED|forbidden/i)) {
    hint = "이 키로는 YouTube Data API를 쓸 권한이 없습니다. ① 키가 속한 프로젝트에서 YouTube Data API v3를 '사용 설정'했는지 ② 키의 'API 제한사항'에 YouTube Data API v3가 들어 있는지 ③ Gemini(AI Studio) 등 다른 서비스용 키를 넣은 건 아닌지 확인해주세요.";
  }
  return (hint ? hint + "\n" : "") + `Google 응답: ${msg}` + (reasons.length ? ` [${reasons.join(" · ")}]` : "");
}

async function ytSearchVideos(query, publishedAfter, maxResults) {
  const ids = [];
  let pageToken = null;
  while (ids.length < maxResults) {
    const params = {
      part: "id", q: query, type: "video", order: "viewCount",
      maxResults: Math.min(50, maxResults - ids.length),
      publishedAfter, relevanceLanguage: "ko",
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await ytGet("search", params, 100);
    for (const item of data.items || []) {
      if (item.id?.videoId) ids.push(item.id.videoId);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return ids.slice(0, maxResults);
}

async function ytBatchList(endpoint, part, ids, extra = {}) {
  const items = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await ytGet(endpoint, {
      part, id: ids.slice(i, i + 50).join(","), maxResults: 50, ...extra,
    }, 1);
    items.push(...(data.items || []));
  }
  return items;
}

async function ytUploadsIds(playlistId, limit) {
  const data = await ytGet("playlistItems", {
    part: "contentDetails", playlistId, maxResults: Math.min(50, limit),
  }, 1);
  return (data.items || []).map(it => it.contentDetails?.videoId).filter(Boolean);
}

// ---------------- 지표 ----------------
function ytParseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

// 영상 하나 → 공통 행. avg = 아웃라이어 기준이 되는 채널 평균 조회수
function ytRow(v, subs, avg) {
  const s = v.snippet, st = v.statistics || {};
  const views = st.viewCount != null ? parseInt(st.viewCount) : 0;
  const likes = st.likeCount != null ? parseInt(st.likeCount) : null;
  const comments = st.commentCount != null ? parseInt(st.commentCount) : null;
  const t = s.thumbnails || {};
  return {
    id: v.id,
    title: s.title,
    views, likes, comments, subs,
    metric: views,
    outlier: avg > 0 ? views / avg : null,
    velocity: Math.round(views / daysSince(s.publishedAt)),
    engagement: (views > 0 && likes != null) ? ((likes + (comments || 0)) / views * 100) : null,
    viewsPerSub: subs ? views / subs : null,
    channel: s.channelTitle,
    channelAvg: avg ? Math.round(avg) : null,
    tier: tierOf(subs),
    date: s.publishedAt.slice(0, 10),
    duration: fmtDuration(ytParseDuration(v.contentDetails?.duration)),
    patterns: classifyTitle(s.title),
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumb: (t.high || t.medium || t.default || {}).url || "",
  };
}

function ytSubs(chSt) {
  return chSt.hiddenSubscriberCount ? null
    : (chSt.subscriberCount != null ? parseInt(chSt.subscriberCount) : null);
}

// ---------------- 주제어 검색 ----------------
async function ytRun() {
  const pf = "youtube";
  const topic = $("yt-topic").value.trim();
  if (!topic) { setStatus(pf, "⚠️ 주제어를 입력하세요.", null, true); return; }
  if (!ytKey() && location.protocol === "file:") { setStatus(pf, "⚠️ API 키를 입력하세요.", null, true); return; }

  const months = parseInt($("yt-months").value);
  const maxVideos = parseInt($("yt-max").value);
  const excludeShorts = $("yt-shorts").value === "exclude";
  ytQuotaUsed = 0;

  const publishedAfter = months > 0
    ? new Date(Date.now() - months * 30 * 86400000).toISOString()
    : "1970-01-01T00:00:00Z";

  await withBusy(pf, "yt-runBtn", ICONS.spinner + " 수집 중...", async () => {
    try {
      setStatus(pf, "🔎 [1/4] 영상 검색 중... (search.list, 100유닛/호출)", 10);
      const videoIds = await ytSearchVideos(topic, publishedAfter, maxVideos);
      if (!videoIds.length) throw new Error("검색 결과가 없습니다. 주제어나 기간을 바꿔보세요.");

      setStatus(pf, `📈 [2/4] 영상 ${videoIds.length}개 통계 수집 중...`, 30);
      let videos = await ytBatchList("videos", "snippet,statistics,contentDetails", videoIds);

      // 쇼츠 제외 (3분 = 180초 이하를 쇼츠로 간주)
      let excludedShorts = 0;
      if (excludeShorts) {
        const before = videos.length;
        videos = videos.filter(v => ytParseDuration(v.contentDetails?.duration) > 180);
        excludedShorts = before - videos.length;
        if (!videos.length) throw new Error("쇼츠를 제외하니 남는 영상이 없습니다. 다른 주제어로 시도해보세요.");
      }

      setStatus(pf, "📺 [3/4] 채널 정보 수집 중...", 45);
      const channelIds = [...new Set(videos.map(v => v.snippet.channelId))];
      const channels = await ytBatchList("channels", "snippet,statistics,contentDetails", channelIds);
      const channelMap = Object.fromEntries(channels.map(c => [c.id, c]));

      // 채널 평균 조회수
      const recentByChannel = {};
      for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        setStatus(pf, `📊 [4/4] 채널 평균 계산 중... (${i + 1}/${channels.length}) ${escapeHtml(ch.snippet.title)}`,
          45 + (i / channels.length) * 45);
        const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
        if (!uploads) continue;
        try {
          recentByChannel[ch.id] = await ytUploadsIds(uploads, 30);
        } catch (e) {
          if (String(e.message).startsWith("QUOTA::")) throw e;
          console.warn("채널 업로드 조회 실패:", ch.snippet.title, e);
        }
      }
      const flatIds = Object.values(recentByChannel).flat();
      const statItems = await ytBatchList("videos", "statistics", flatIds);
      const viewMap = Object.fromEntries(
        statItems.filter(it => it.statistics?.viewCount != null)
          .map(it => [it.id, parseInt(it.statistics.viewCount)])
      );
      const channelAvg = {};
      for (const [cid, ids] of Object.entries(recentByChannel)) {
        const vs = ids.map(id => viewMap[id]).filter(v => v != null);
        if (vs.length) channelAvg[cid] = vs.reduce((a, b) => a + b, 0) / vs.length;
      }

      const rows = videos.map(v => {
        const ch = channelMap[v.snippet.channelId] || {};
        return ytRow(v, ytSubs(ch.statistics || {}), channelAvg[v.snippet.channelId]);
      });

      setStatus(pf, `✅ 완료! 영상 ${rows.length}개 · 채널 ${channels.length}개`
        + (excludedShorts ? ` · 쇼츠 ${excludedShorts}개 제외` : "")
        + ` · 쿼터 약 ${ytQuotaUsed}유닛 사용`, 100);

      commitResults(pf, {
        rows, topic, channelCount: channels.length, costText: `~${ytQuotaUsed} 유닛`,
        history: {
          type: "search",
          desc: (months > 0 ? `최근 ${months}개월` : "전체 기간") + (excludeShorts ? " · 쇼츠 제외" : ""),
        },
      });
    } catch (e) {
      const msg = String(e.message || e).replace(/^QUOTA::/, "");
      setStatus(pf, `❌ ${escapeHtml(msg).replace(/\n/g, "<br>")}` + (S[pf].rows.length ? "<br>이전 결과는 유지됩니다." : ""), null, true);
    }
  });
}

// ---------------- 단일 영상 아웃라이어 분석 ----------------
function ytExtractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtube\.com\/(?:shorts|embed|live)\/|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = p.exec(url.trim());
    if (m) return m[1];
  }
  return null;
}

function ytExtractChannelRef(input) {
  const s = input.trim();
  let m;
  if ((m = /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(s)) || (m = /^(UC[A-Za-z0-9_-]{22})$/.exec(s)))
    return { param: "id", value: m[1] };
  if ((m = /youtube\.com\/@([\w.\-가-힣]+)/.exec(s)) || (m = /^@([\w.\-가-힣]+)$/.exec(s)))
    return { param: "forHandle", value: "@" + m[1] };
  if ((m = /youtube\.com\/user\/([\w.\-]+)/.exec(s)))
    return { param: "forUsername", value: m[1] };
  return null;
}

function analyzeError(el, e) {
  const msg = String(e.message || e).replace(/^QUOTA::/, "");
  el.innerHTML = `<div class="note" style="margin-top:10px;color:var(--danger)">❌ ${escapeHtml(msg).replace(/\n/g, "<br>")}</div>`;
}

async function ytAnalyze() {
  const input = $("yt-link").value;
  const resultEl = $("yt-analyzeResult");

  // 영상 링크가 아니면 채널로 시도
  const vid = ytExtractVideoId(input);
  if (!vid) {
    const chRef = ytExtractChannelRef(input);
    if (chRef) return ytAnalyzeChannel(chRef);
    resultEl.innerHTML = `<div class="note" style="margin-top:10px;color:var(--danger)">⚠️ 영상 링크나 채널 링크(@핸들)를 인식하지 못했습니다.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="note" style="margin-top:10px">분석 중...</div>`;
  await withBusy("youtube", "yt-analyzeBtn", ICONS.spinner, async () => {
    try {
      const [video] = await ytBatchList("videos", "snippet,statistics,contentDetails", [vid]);
      if (!video) throw new Error("영상을 찾을 수 없습니다 (삭제되었거나 비공개일 수 있음).");
      const s = video.snippet, st = video.statistics || {};

      const [ch] = await ytBatchList("channels", "snippet,statistics,contentDetails", [s.channelId]);
      const uploads = ch?.contentDetails?.relatedPlaylists?.uploads;

      // 채널 최근 영상들의 조회수 → 평균과 순위 (평균은 이 영상을 빼고 계산)
      let avg = null, rank = null, sampleSize = 0;
      if (uploads) {
        const recentIds = await ytUploadsIds(uploads, 30);
        const stats = await ytBatchList("videos", "statistics", recentIds);
        const views = stats.filter(it => it.statistics?.viewCount != null)
          .map(it => ({ id: it.id, v: parseInt(it.statistics.viewCount) }));
        const others = views.filter(x => x.id !== vid);
        sampleSize = views.length;
        if (others.length) avg = others.reduce((a, b) => a + b.v, 0) / others.length;
        const myViews = parseInt(st.viewCount || 0);
        rank = views.filter(x => x.v > myViews).length + 1;
      }

      const subs = ytSubs(ch?.statistics || {});
      const r = ytRow(video, subs, avg);
      const days = daysSince(s.publishedAt);
      const verdict = verdictFor(r.outlier, "채널");
      const t = s.thumbnails || {};
      const thumb = (t.maxres || t.high || t.medium || {}).url || "";

      resultEl.innerHTML = `
        <div class="analyze-card">
          <a href="${safeUrl(r.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(s.title)} 썸네일"></a>
          <div class="body">
            <div class="verdict" style="color:${verdict.color}">${verdict.emoji} ${verdict.text}</div>
            <div class="vtitle"><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></div>
            <div class="vch">${escapeHtml(s.channelTitle)} · 구독자 ${subs != null ? fmtNum(subs) : "비공개"} (${tierOf(subs)})
              · ${r.date} 업로드 (${days}일 전)${r.duration ? " · ⏱ " + r.duration : ""}
              · ${r.patterns.map(p => `<span class="pattern-tag">${p}</span>`).join("")}</div>
            <div class="metric-grid">
              <div class="m"><div class="k">이 영상 조회수</div><div class="v">${fmtNum(r.views)}</div></div>
              <div class="m"><div class="k">채널 평균 조회수</div><div class="v">${avg != null ? fmtNum(Math.round(avg)) : "-"}</div></div>
              <div class="m"><div class="k">아웃라이어 배수</div><div class="v" style="color:${verdict.color}">${r.outlier != null ? r.outlier.toFixed(1) + "x" : "-"}</div></div>
              <div class="m"><div class="k">일일 조회수</div><div class="v">${fmtNum(r.velocity)}</div></div>
              <div class="m"><div class="k">참여율</div><div class="v">${r.engagement != null ? r.engagement.toFixed(2) + "%" : "비공개"}</div></div>
              <div class="m"><div class="k">구독자 대비 조회수</div><div class="v">${r.viewsPerSub != null ? r.viewsPerSub.toFixed(1) + "x" : "-"}</div></div>
            </div>
            <div class="note">
              ${verdict.desc}
              ${rank != null ? `<br>📊 이 채널 최근 업로드 ${sampleSize}개 중 조회수 <b>${rank}위</b>` : ""}
              ${r.engagement != null && r.outlier >= 3 ? (r.engagement >= 2
                ? "<br>✅ 참여율도 건강해서 낚시가 아니라 실제로 시청자를 만족시킨 영상으로 보입니다."
                : "<br>⚠️ 배수는 높지만 참여율이 낮습니다. 낚시성 클릭 유도일 가능성을 열어두고 직접 확인해보세요.") : ""}
            </div>
          </div>
        </div>`;
    } catch (e) { analyzeError(resultEl, e); }
  });
}

// ---------------- 채널 분석 ----------------
async function ytAnalyzeChannel(chRef) {
  const pf = "youtube";
  const resultEl = $("yt-analyzeResult");
  resultEl.innerHTML = `<div class="note" style="margin-top:10px">채널 분석 중...</div>`;
  ytQuotaUsed = 0;
  await withBusy(pf, "yt-analyzeBtn", ICONS.spinner, async () => {
    try {
      const data = await ytGet("channels", {
        part: "snippet,statistics,contentDetails",
        [chRef.param]: chRef.value, maxResults: 1,
      }, 1);
      const ch = (data.items || [])[0];
      if (!ch) throw new Error("채널을 찾을 수 없습니다. 링크나 핸들을 확인해주세요.");
      const chSt = ch.statistics || {};
      const subs = ytSubs(chSt);
      const totalViews = chSt.viewCount != null ? parseInt(chSt.viewCount) : null;
      const videoCount = chSt.videoCount != null ? parseInt(chSt.videoCount) : null;

      const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new Error("이 채널의 업로드 목록을 가져올 수 없습니다.");
      const recentIds = await ytUploadsIds(uploads, 30);
      let videos = await ytBatchList("videos", "snippet,statistics,contentDetails", recentIds);

      let excludedShorts = 0;
      if ($("yt-shorts").value === "exclude") {
        const before = videos.length;
        videos = videos.filter(v => ytParseDuration(v.contentDetails?.duration) > 180);
        excludedShorts = before - videos.length;
      }
      if (!videos.length) throw new Error("분석할 영상이 없습니다 (쇼츠 제외 필터를 확인해보세요).");

      // 채널 평균 = 가져온 최근 영상들의 평균 조회수
      const viewList = videos.map(v => v.statistics?.viewCount != null ? parseInt(v.statistics.viewCount) : 0);
      const avg = viewList.reduce((a, b) => a + b, 0) / viewList.length;

      // 업로드 빈도: 최근 영상들이 걸친 기간으로 계산
      const dates = videos.map(v => new Date(v.snippet.publishedAt)).sort((a, b) => a - b);
      const spanDays = Math.max((dates[dates.length - 1] - dates[0]) / 86400000, 1);
      const perWeek = (videos.length / spanDays * 7);

      const rows = videos.map(v => ytRow(v, subs, avg));
      const chThumb = (ch.snippet.thumbnails?.high || ch.snippet.thumbnails?.medium || {}).url || "";
      const best = [...rows].sort((a, b) => (b.outlier || 0) - (a.outlier || 0))[0];
      resultEl.innerHTML = `
        <div class="analyze-card">
          ${chThumb ? `<img src="${escapeHtml(chThumb)}" style="width:110px;height:110px;border-radius:50%;object-fit:cover" alt="${escapeHtml(ch.snippet.title)} 채널 프로필">` : ""}
          <div class="body">
            <div class="verdict">📺 ${escapeHtml(ch.snippet.title)}</div>
            <div class="vch">${tierOf(subs)} 채널 · 개설일 ${(ch.snippet.publishedAt || "").slice(0, 10)}
              ${excludedShorts ? ` · 쇼츠 ${excludedShorts}개 제외` : ""}</div>
            <div class="metric-grid">
              <div class="m"><div class="k">구독자</div><div class="v">${subs != null ? fmtNum(subs) : "비공개"}</div></div>
              <div class="m"><div class="k">총 영상 수</div><div class="v">${videoCount != null ? videoCount.toLocaleString() : "-"}</div></div>
              <div class="m"><div class="k">채널 총 조회수</div><div class="v">${totalViews != null ? fmtNum(totalViews) : "-"}</div></div>
              <div class="m"><div class="k">최근 ${videos.length}개 평균 조회수</div><div class="v" style="color:var(--blue)">${fmtNum(Math.round(avg))}</div></div>
              <div class="m"><div class="k">업로드 빈도</div><div class="v">주 ${perWeek.toFixed(1)}개</div></div>
              <div class="m"><div class="k">최고 아웃라이어</div><div class="v" style="color:var(--accent)">${best?.outlier ? best.outlier.toFixed(1) + "x" : "-"}</div></div>
            </div>
            <div class="note">⬇️ 아래 결과 테이블에 이 채널의 최근 영상 ${videos.length}개가 로드되었습니다.
              아웃라이어 배수는 이 채널 평균(${fmtNum(Math.round(avg))}) 기준입니다.</div>
          </div>
        </div>`;

      commitResults(pf, {
        rows, topic: ch.snippet.title, sortKey: "date", channelCount: 1, costText: `~${ytQuotaUsed} 유닛`,
        history: { type: "channel", desc: `채널 분석 · 구독자 ${subs != null ? fmtNum(subs) : "비공개"}` },
      });
    } catch (e) { analyzeError(resultEl, e); }
  });
}
