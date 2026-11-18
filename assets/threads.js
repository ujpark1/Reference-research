// Threads 탭
// 아웃라이어 = 글의 조회수 ÷ 그 계정 최근 글의 평균 조회수 (기본).
//   · 기준을 반응수(좋아요+답글+리포스트+인용)로 바꿀 수 있다. 두 값을 모두 저장해 두고 화면에서 즉시 전환한다
//   · 조회수는 스크레이퍼의 includeViews 옵션으로 가져온다 (추가 요금 없음, 글마다 요청이 하나 더 나가 조금 느림).
//     2026-11 실측: 검색 글 9/9, 계정 최근 글 16/16 에서 조회수가 잡혔다. 비어 있는 글은 조회수 기준에서 판정 불가
//   · 계정 평균은 그 계정의 최근 글 N개(표본, 기본 10개)로 계산. 답글·리포스트·고정 글과 자기 자신은 평균에서 뺀다
// 데이터: Apify의 lergassy/threads-scraper — 검색(search)과 계정 글(posts) 두 모드를 쓴다
"use strict";

const TH_MIN_LIKES = 10;   // 이보다 반응이 적은 글은 레퍼런스 가치가 없어 검색에서 제외 (계정 평균 조회 비용도 아낌)

function thBasis() { return $("th-basis").value === "eng" ? "eng" : "views"; }
const thBasisWord = (basis = thBasis()) => basis === "views" ? "조회수" : "반응수";

function thNorm(p) {
  const likes = p.likesHidden ? null : toCount(pick(p, "likeCount", "likesCount", "likes"));
  const replies = toCount(pick(p, "replyCount", "repliesCount")) || 0;
  const reposts = toCount(pick(p, "repostCount", "repostsCount")) || 0;
  const quotes = toCount(pick(p, "quoteCount", "quotesCount")) || 0;
  const username = String(pick(p, "username", "author.username", "user.username") || "").replace(/^@/, "").toLowerCase();
  const code = pick(p, "code", "shortcode");
  const media = String(p.mediaType || "").toLowerCase();
  return {
    id: String(pick(p, "id") || code || ""),
    code, username,
    text: String(p.text || ""),
    kind: (p.videos?.length || /video/.test(media)) ? "영상"
        : (p.images?.length || /image|photo|carousel/.test(media)) ? "이미지" : "텍스트",
    likes, replies, shares: reposts + quotes,
    metric: likes != null ? likes + replies + reposts + quotes : null,
    views: toCount(pick(p, "viewCount", "viewsCount")),
    date: toDate(pick(p, "createdAt", "timestamp")),
    url: pick(p, "url") || (username && code ? `https://www.threads.com/@${username}/post/${code}` : ""),
    isReply: !!p.isReply, isRepost: !!p.isRepost, pinned: !!p.isPinned,
  };
}

// 결과에는 글 말고도 프로필·안내(notice)·오류 행이 섞여 온다
function thRowType(p) {
  const t = String(p?.type || "").toLowerCase();
  if (t === "profile" || t === "user" || t === "account") return "profile";
  if (t === "notice" || t === "error" || p?.error) return "other";
  if (p?.followerCount != null && !p.code) return "profile";
  return (p?.code || p?.text != null) && pick(p, "username") ? "post" : "other";
}

// 계정 평균 — 본인이 쓴 원글만 (답글·리포스트 제외, 고정 글은 3개 이상 남을 때 제외), exclude(판정 대상 글)는 뺀다.
// 조회수·반응수 평균을 둘 다 돌려준다.
function thBaseline(account, exclude) {
  let posts = (account?.posts || []).filter(p => !p.isRepost && !p.isReply);
  if (exclude) posts = posts.filter(p => p.id !== exclude.id && (!exclude.code || p.code !== exclude.code));
  const unpinned = posts.filter(p => !p.pinned);
  if (unpinned.length >= 3) posts = unpinned;
  const engs = posts.map(p => p.metric).filter(v => v != null);
  const views = posts.map(p => p.views).filter(v => v != null);
  return { avgEng: mean(engs), avgViews: mean(views), engs, views, n: posts.length };
}

function thRow(n, subs, base) {
  const title = hookOf(n.text);
  const ratio = (v, avg) => (avg > 0 && v != null ? v / avg : null);
  const row = {
    id: n.id,
    title,
    text: n.text.slice(0, 500),
    kind: n.isReply ? "답글" : n.kind,
    duration: "",
    views: n.views, likes: n.likes, comments: n.replies, shares: n.shares, metric: n.metric, subs,
    avgViews: base.avgViews != null ? Math.round(base.avgViews) : null,
    avgEng: base.avgEng != null ? Math.round(base.avgEng) : null,
    outlierViews: ratio(n.views, base.avgViews),
    outlierEng: ratio(n.metric, base.avgEng),
    velocity: n.metric != null && n.date ? Math.round(n.metric / daysSince(n.date)) : null,
    engagement: subs && n.metric != null ? n.metric / subs * 100 : null,
    channel: n.username ? "@" + n.username : "-",
    tier: tierOf(subs),
    date: n.date ? n.date.toISOString().slice(0, 10) : "",
    patterns: classifyTitle(title),
    url: n.url,
    thumb: "",
  };
  return thApplyBasis([row])[0];
}

// 선택한 기준(조회수/반응수)의 배수·평균을 표가 읽는 칸(outlier, channelAvg)에 옮겨 담는다.
// 기준 전환 전에 저장된 옛 히스토리 행(두 값이 없는 행)은 그대로 둔다.
function thApplyBasis(rows, basis = thBasis()) {
  for (const r of rows) {
    if (r.outlierViews === undefined && r.outlierEng === undefined) continue;
    r.outlier = (basis === "views" ? r.outlierViews : r.outlierEng) ?? null;
    r.channelAvg = (basis === "views" ? r.avgViews : r.avgEng) ?? null;
  }
  return rows;
}

// 계정들의 최근 글 + 프로필(팔로워) 한 번에 조회 → { 계정: { subs, posts[] } }
async function thAccounts(usernames, sample, onTick) {
  const items = await apifyRun("threads", {
    usernames, mode: "posts", maxPosts: sample,
    includeViews: true, includeProfile: true, includeRunSummary: false,
  }, onTick);
  const acc = {};
  const of = u => (acc[u] ??= { subs: null, posts: [], profile: null });
  let billedPosts = 0, billedProfiles = 0;
  for (const it of items) {
    const type = thRowType(it);
    if (type === "profile") {
      billedProfiles++;
      const u = String(pick(it, "username") || "").replace(/^@/, "").toLowerCase();
      if (!u) continue;
      of(u).subs = toCount(it.followerCount);
      of(u).profile = it;
    } else if (type === "post") {
      billedPosts++;
      const n = thNorm(it);
      // 리포스트는 원글 작성자 이름으로 오므로, 어느 계정을 읽다 나온 행인지(sourceUsername)를 우선한다
      const u = String(it.sourceUsername || n.username).replace(/^@/, "").toLowerCase();
      if (u) of(u).posts.push(n);
    }
  }
  const a = APIFY_ACTORS.threads;
  return { acc, cost: billedPosts * a.price + billedProfiles * a.profilePrice };
}

function thInit() {
  ["th-max", "th-sample"].forEach(id => $(id).addEventListener("change", thUpdateEstimate));
  thUpdateEstimate();
  // 기준을 바꾸면 다시 수집하지 않고 저장해 둔 값으로 즉시 다시 계산
  PLATFORMS.threads.prepare = thApplyBasis;
  $("th-basis").addEventListener("change", () => {
    thApplyBasis(S.threads.rows);
    if (PF === "threads") renderResults();
  });
}

function thUpdateEstimate() {
  const a = APIFY_ACTORS.threads;
  const max = parseInt($("th-max").value), sample = parseInt($("th-sample").value);
  const authors = Math.round(max * 0.85);   // 보통 글 수의 80~90%가 서로 다른 계정
  const usd = max * a.price + authors * (sample * a.price + a.profilePrice);
  $("th-estimate").textContent = `이 설정으로 1회 최대 약 $${usd.toFixed(2)} (글 ${max}개 + 계정 약 ${authors}개 × 최근 ${sample}개)`;
}

// ---------------- 키워드 검색 ----------------
async function thRun() {
  const pf = "threads";
  const topic = $("th-topic").value.trim().replace(/^#+/, "");
  if (!topic) { setStatus(pf, "⚠️ 검색어를 입력하세요.", null, true); return; }
  if (!apifyReady(pf)) return;

  const months = parseInt($("th-months").value);
  const max = parseInt($("th-max").value);
  const sample = parseInt($("th-sample").value);
  const includeReplies = $("th-replies").value === "include";
  let cost = 0;

  await withBusy(pf, "th-runBtn", ICONS.spinner + " 수집 중...", async () => {
    try {
      const step1 = sec => setStatus(pf, `🔎 [1/3] 스레드에서 "${escapeHtml(topic)}" 글 찾는 중...${waitMsg(sec)}`, 15);
      step1(0);
      const input = {
        keywords: [topic], mode: "search", maxPosts: max, maxItems: max,
        minLikes: TH_MIN_LIKES, includeViews: true, includeRunSummary: false,
      };
      if (months > 0) input.postedAfter = monthsAgo(months).toISOString().slice(0, 10);
      const found = await apifyRun("threads", input, step1);
      const foundPosts = found.filter(p => thRowType(p) === "post");
      cost += foundPosts.length * APIFY_ACTORS.threads.price;
      apifyAddCost(foundPosts.length * APIFY_ACTORS.threads.price);

      const seen = new Set();
      let posts = foundPosts.map(thNorm)
        .filter(p => p.username && p.id && !p.isRepost && !seen.has(p.id) && seen.add(p.id));
      let droppedReplies = 0;
      if (!includeReplies) {
        const before = posts.length;
        posts = posts.filter(p => !p.isReply);
        droppedReplies = before - posts.length;
      }
      if (!posts.length) {
        throw new Error("조건에 맞는 글이 없습니다. 검색어를 한 단어로 줄이거나 기간을 넓혀보세요."
          + " (스레드는 로그인 없이 볼 수 있는 검색 결과가 제한적입니다)");
      }

      const owners = [...new Set(posts.map(p => p.username))];
      const step2 = sec => setStatus(pf, `📊 [2/3] 계정 ${owners.length}개의 평소 수치 계산 중... (계정당 최근 ${sample}개)${waitMsg(sec)}`, 50);
      step2(0);
      const { acc, cost: c2 } = await thAccounts(owners, sample, step2);
      cost += c2;
      apifyAddCost(c2);

      setStatus(pf, "🧮 [3/3] 아웃라이어 배수 계산 중...", 90);
      const rows = posts.map(n => thRow(n, acc[n.username]?.subs ?? null, thBaseline(acc[n.username], n)));
      const noBase = rows.filter(r => r.outlier == null).length;
      const noViews = rows.filter(r => r.views == null).length;

      setStatus(pf, `✅ 완료! 글 ${rows.length}개 · 계정 ${owners.length}개`
        + (foundPosts.length < max ? ` (요청 ${max}개 중 스레드가 보여준 건 ${foundPosts.length}개)` : "")
        + (droppedReplies ? ` · 답글 ${droppedReplies}개 제외` : "")
        + (noViews ? ` · 조회수 없는 글 ${noViews}개` : "")
        + (noBase ? ` · ${thBasisWord()} 기준 판정 불가 ${noBase}개` : "")
        + ` · 비용 ${fmtUsd(cost)}`, 100);

      commitResults(pf, {
        rows, topic, channelCount: owners.length, costText: fmtUsd(cost),
        history: {
          type: "search",
          desc: (months > 0 ? `최근 ${months}개월` : "전체 기간") + ` · 표본 ${sample}개` + (includeReplies ? " · 답글 포함" : ""),
        },
      });
    } catch (e) {
      setStatus(pf, `❌ ${escapeHtml(e.message || e)}`
        + (cost ? `<br>여기까지 쓴 비용: ${fmtUsd(cost)}` : "")
        + (S[pf].rows.length ? "<br>이전 결과는 유지됩니다." : ""), null, true);
    }
  });
}

// ---------------- 글 · 계정 분석 ----------------
function thParseLink(input) {
  const s = input.trim();
  let m;
  if ((m = /threads\.(?:net|com)\/@([\w.]{1,30})(?:\/post\/([\w-]+))?/i.exec(s))) {
    return { handle: m[1].toLowerCase(), code: m[2] || null };
  }
  if ((m = /^@?([\w.]{1,30})$/.exec(s))) return { handle: m[1].toLowerCase(), code: null };
  return null;
}

async function thAnalyze() {
  const pf = "threads";
  const resultEl = $("th-analyzeResult");
  const ref = thParseLink($("th-link").value);
  if (!ref) {
    resultEl.innerHTML = `<div class="note" style="margin-top:10px;color:var(--danger)">⚠️ 글 링크나 계정(@아이디)을 인식하지 못했습니다.</div>`;
    return;
  }
  if (!apifyToken() && location.protocol === "file:") {
    resultEl.innerHTML = `<div class="note" style="margin-top:10px;color:var(--danger)">⚠️ Apify API 토큰을 입력하세요.</div>`;
    return;
  }
  const tick = sec => {
    resultEl.innerHTML = `<div class="note" style="margin-top:10px">@${escapeHtml(ref.handle)} 계정의 최근 글 분석 중...${waitMsg(sec)}</div>`;
  };
  await withBusy(pf, "th-analyzeBtn", ICONS.spinner, async () => {
    try {
      tick(0);
      const { acc, cost } = await thAccounts([ref.handle], 30, tick);
      apifyAddCost(cost);
      const account = acc[ref.handle];
      const own = (account?.posts || []).filter(p => !p.isRepost && !p.isReply);
      if (!own.length) throw new Error("이 계정의 글을 찾을 수 없습니다. 아이디를 확인해주세요 (비공개 계정은 볼 수 없습니다).");
      const subs = account.subs;
      const name = account.profile?.fullName || "@" + ref.handle;
      const basis = thBasis(), word = thBasisWord(basis);
      const byViews = basis === "views";
      const num = v => v != null ? fmtNum(Math.round(v)) : "-";

      // 계정 전체 요약 + 표
      const base = thBaseline(account);
      const rows = own.map(n => thRow({ ...n, username: n.username || ref.handle }, subs, base));
      const best = [...rows].sort((a, b) => (b.outlier || 0) - (a.outlier || 0))[0];
      const perWeek = perWeekOf(own.map(p => p.date));
      let html = "";

      // 글 링크였다면 그 글의 판정 카드를 먼저
      if (ref.code) {
        const target = (account.posts || []).find(p => p.code === ref.code);
        if (!target) {
          html += `<div class="note" style="margin-top:10px;color:var(--gold)">⚠️ 이 글이 계정의 최근 글 30개 안에 없어서 개별 판정은 못 했습니다. 아래 계정 요약을 참고하세요.</div>`;
        } else {
          const b = thBaseline(account, target);
          const r = thRow(target, subs, b);
          const verdict = verdictFor(r.outlier, "계정");
          const mine = byViews ? r.views : r.metric;
          const others = byViews ? b.views : b.engs;
          const rank = mine != null ? others.filter(m => m > mine).length + 1 : null;
          html += `
            <div class="analyze-card">
              <div class="body">
                <div class="verdict" style="color:${verdict.color}">${verdict.emoji} ${verdict.text}</div>
                <div class="vtitle"><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title) || "(본문 없음)"}</a></div>
                <div class="vch">@${escapeHtml(ref.handle)} · 팔로워 ${subs != null ? fmtNum(subs) : "비공개"} (${tierOf(subs)})
                  · ${r.kind}${r.date ? ` · ${r.date} 게시 (${daysSince(target.date)}일 전)` : ""}
                  · ${r.patterns.map(p => `<span class="pattern-tag">${p}</span>`).join("")}</div>
                ${metricGrid([
                  [`이 글 ${word}`, mine != null ? fmtNum(mine) : "-"],
                  [`계정 평균 ${word}`, num(byViews ? b.avgViews : b.avgEng)],
                  [`아웃라이어 배수 (${word})`, r.outlier != null ? r.outlier.toFixed(1) + "x" : "-", verdict.color],
                  byViews ? ["반응수", r.metric != null ? fmtNum(r.metric) : "비공개"] : ["조회수", fmtNum(r.views)],
                  ["좋아요 · 답글 · 리포스트", `${r.likes != null ? fmtNum(r.likes) : "비공개"} · ${fmtNum(r.comments)} · ${fmtNum(r.shares)}`],
                  ["참여율 (팔로워 대비)", r.engagement != null ? r.engagement.toFixed(2) + "%" : "-"],
                ])}
                <div class="note">${verdict.desc}
                  ${rank != null && others.length ? `<br>📊 이 계정 최근 글 ${others.length}개와 비교하면 ${word} <b>${rank}위</b> 수준` : ""}
                  ${mine == null ? `<br>⚠️ 이 글의 ${word}를 읽지 못해 배수를 계산할 수 없습니다. 위에서 기준을 바꿔보세요.` : ""}</div>
              </div>
            </div>`;
        }
      }

      html += `
        <div class="analyze-card">
          ${avatarImg(account.profile?.profilePicUrl, name)}
          <div class="body">
            <div class="verdict">🧵 ${escapeHtml(name)}</div>
            <div class="vch"><a href="https://www.threads.com/@${escapeHtml(ref.handle)}" target="_blank" rel="noopener">@${escapeHtml(ref.handle)}</a>
              · ${tierOf(subs)} 계정</div>
            ${metricGrid([
              ["팔로워", subs != null ? fmtNum(subs) : "비공개"],
              [`최근 ${base.n}개 평균 조회수`, num(base.avgViews), byViews ? "var(--blue)" : ""],
              [`최근 ${base.n}개 평균 반응수`, num(base.avgEng), byViews ? "" : "var(--blue)"],
              ["평균 참여율", subs && base.avgEng != null ? (base.avgEng / subs * 100).toFixed(2) + "%" : "-"],
              ["게시 빈도", perWeek != null ? `주 ${perWeek.toFixed(1)}개` : "-"],
              [`최고 아웃라이어 (${word})`, best?.outlier ? best.outlier.toFixed(1) + "x" : "-", "var(--accent)"],
            ])}
            <div class="note">⬇️ 아래 결과 테이블에 이 계정의 최근 글 ${rows.length}개가 로드되었습니다 (답글·리포스트 제외).
              아웃라이어 배수는 이 계정 평균 ${word}(${num(byViews ? base.avgViews : base.avgEng)}, 고정 글 제외) 기준입니다.</div>
          </div>
        </div>`;
      resultEl.innerHTML = html;

      commitResults(pf, {
        rows, topic: "@" + ref.handle, sortKey: "date", channelCount: 1, costText: fmtUsd(cost),
        history: { type: "channel", desc: `계정 분석 · 팔로워 ${subs != null ? fmtNum(subs) : "비공개"}` },
      });
    } catch (e) { analyzeError(resultEl, e); }
  });
}
