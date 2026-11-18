// 레퍼런스 리서치 — 공통 코어 (탭 · 상태 · 히스토리 · 결과 테이블 · 인사이트 · 다운로드)
// 플랫폼별 수집 로직은 youtube.js / instagram.js / threads.js 에 있고,
// 전부 아래 "행(row)" 모양으로 맞춰서 commitResults()에 넘긴다.
//
//   { id, title, kind, duration, url, thumb,
//     views, likes, comments, shares, metric,      ← metric = 아웃라이어의 기준 수치
//     channelAvg, outlier, velocity, engagement, viewsPerSub,
//     channel, subs, tier, date, patterns }
"use strict";

const ICONS = {
  search: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
  tv: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/></svg>',
  x: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  spinner: '<svg class="icon spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
};

// ---------------- 공통 유틸 ----------------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 외부 데이터에서 온 링크는 https만 허용 (javascript: 등 차단)
function safeUrl(u) {
  return /^https:\/\//i.test(u || "") ? escapeHtml(u) : "#";
}

function fmtNum(n) {
  if (n == null) return "-";
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "억";
  if (n >= 10000) return (n / 10000).toFixed(1) + "만";
  return n.toLocaleString();
}

function fmtDuration(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
               : `${m}:${String(s).padStart(2, "0")}`;
}

function classifyTitle(title) {
  const p = [];
  if (/\d/.test(title)) p.push("숫자형");
  if (/[?？]|까요|나요|을까|일까|why|how|what/i.test(title)) p.push("질문형");
  if (/충격|경고|위험|절대|최악|망함|망했|폭락|실패|후회|공포|무서운|소름/.test(title)) p.push("공포/경고형");
  if (/방법|하는 법|하는법|꿀팁|팁|가이드|총정리|정리|튜토리얼|강의|배우/.test(title)) p.push("하우투형");
  if (/비밀|진실|몰랐|아무도|숨겨진|드디어|충격적|반전|알고보니|사실/.test(title)) p.push("호기심자극형");
  if (/vs|비교|차이|순위|랭킹|top|best|추천/i.test(title)) p.push("비교/랭킹형");
  if (/브이로그|vlog|일상|하루|루틴|challenge|챌린지|해봤|해보니|직접/i.test(title)) p.push("경험/도전형");
  return p.length ? p : ["기타"];
}

function tierOf(subs) {
  if (subs == null) return "비공개";
  if (subs < 10000) return "1만 미만";
  if (subs < 100000) return "1만~10만";
  if (subs < 1000000) return "10만~100만";
  return "100만 이상";
}

// 인스타 캡션·스레드 본문의 "제목" 역할 = 첫 줄(훅). 패턴 분류도 이 훅으로 한다.
function hookOf(text, max = 90) {
  const line = String(text || "").split(/\n/).map(s => s.trim()).find(Boolean) || "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

function daysSince(ts) {
  return Math.max(Math.floor((Date.now() - new Date(ts)) / 86400000), 1);
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function verdictFor(outlier, ownerWord = "채널") {
  if (outlier == null) return { emoji: "❓", text: "판정 불가", color: "var(--text-dim)",
    desc: `${ownerWord} 평균을 계산할 수 없습니다.` };
  if (outlier >= 10) return { emoji: "🚀", text: `초아웃라이어 (${outlier.toFixed(1)}x)`, color: "var(--accent)",
    desc: `${ownerWord} 평균의 10배 이상. 주제·첫 문장·비주얼에 확실히 배울 게 있는 최상급 레퍼런스입니다.` };
  if (outlier >= 3) return { emoji: "🔥", text: `아웃라이어 (${outlier.toFixed(1)}x)`, color: "var(--gold)",
    desc: `${ownerWord} 평균의 3배 이상 터졌습니다. 레퍼런스로 삼을 가치가 있습니다.` };
  if (outlier >= 1.5) return { emoji: "📈", text: `평균 이상 (${outlier.toFixed(1)}x)`, color: "var(--green)",
    desc: "평소보다 잘 됐지만 확실한 아웃라이어는 아닙니다." };
  return { emoji: "😐", text: `평범 (${outlier.toFixed(1)}x)`, color: "var(--text-dim)",
    desc: `${ownerWord}의 평소 수준입니다. 수치가 높다면 ${ownerWord}의 힘이지 이 콘텐츠의 아이디어가 특별한 게 아닐 수 있습니다.` };
}

function outlierBadge(o) {
  if (o == null) return '<span class="outlier-badge outlier-low">-</span>';
  const cls = o >= 5 ? "outlier-high" : o >= 2 ? "outlier-mid" : "outlier-low";
  return `<span class="outlier-badge ${cls}">${o.toFixed(1)}x</span>`;
}

// 쇼츠 여부 — 새 행은 short 값이 있고, 예전 히스토리 행은 "분:초" 길이 문자열에서 계산한다 (3분 이하 = 쇼츠)
function isShortRow(r) {
  if (r.short != null) return r.short;
  const parts = String(r.duration || "").split(":").map(Number);
  if (!parts.length || parts.some(isNaN)) return false;
  const sec = parts.reduce((a, b) => a * 60 + b, 0);
  return sec > 0 && sec <= 180;
}

// ---------------- 플랫폼 정의 ----------------
const cellNum = key => r => fmtNum(r[key]);
const cellHidden = key => r => r[key] != null ? fmtNum(r[key]) : "비공개";
const cellBold = key => r => r[key] != null ? `<b>${fmtNum(r[key])}</b>` : "비공개";
const cellPct = r => r.engagement != null ? r.engagement.toFixed(2) + "%" : "-";
const COL_OUTLIER = { key: "outlier", label: "아웃라이어", cell: r => outlierBadge(r.outlier) };

const PLATFORMS = {
  youtube: {
    label: "YouTube", item: "영상", owner: "채널", follower: "구독자", hook: "제목", dateLabel: "업로드",
    defaultSort: "views", thumb: "wide", costLabel: "쿼터 사용량",
    // 결과 위 종류 필터: [값, 라벨] 목록과 행 → 값
    kinds: [["all", "길이 전체"], ["long", "쇼츠 제외"], ["short", "쇼츠만"]],
    kindOf: r => isShortRow(r) ? "short" : "long",
    patternSub: "어떤 패키징이 반복적으로 터지는가 — 제목이 진짜 상품이다",
    gemSub: "구독자 후광 없이 순수하게 주제·제목·썸네일로 이긴, 가장 베낄 가치가 큰 레퍼런스 (구독자 10만 미만 · 3배 이상)",
    steps: [
      ["1. 주제어로 검색", "만들려는 영상의 주제를 검색하면 최근 터진 영상을 모아줍니다"],
      ["2. 아웃라이어로 정렬", '절대 조회수가 아니라 "평소 대비 몇 배 터졌나"로 레퍼런스를 고르세요'],
      ["3. 패턴 찾기", "제목 패턴·구독자 규모 인사이트에서 반복되는 승리 공식을 확인하세요"],
    ],
    cols: [
      { key: "views", label: "조회수", cell: r => `<b>${fmtNum(r.views)}</b>` },
      { key: "channelAvg", label: "채널평균", dim: true, cell: cellNum("channelAvg") },
      COL_OUTLIER,
      { key: "velocity", label: "일일조회수", cell: cellNum("velocity") },
      { key: "engagement", label: "참여율", tip: "(좋아요+댓글) ÷ 조회수",
        cell: r => r.engagement != null ? r.engagement.toFixed(2) + "%" : "비공개" },
      { key: "viewsPerSub", label: "구독자대비", cell: r => r.viewsPerSub != null ? r.viewsPerSub.toFixed(1) + "x" : "-" },
    ],
    csv: [
      ["title", "제목"], ["views", "조회수"], ["likes", "좋아요"], ["comments", "댓글"],
      ["outlier", "아웃라이어배수"], ["velocity", "일일조회수"], ["engagement", "참여율(%)"],
      ["viewsPerSub", "구독자대비조회수"], ["channel", "채널"], ["subs", "구독자"],
      ["tier", "구독자규모"], ["channelAvg", "채널평균조회수"], ["date", "업로드일"], ["duration", "영상길이"],
      ["patterns", "제목패턴"], ["url", "URL"], ["thumb", "썸네일URL"],
    ],
  },

  instagram: {
    label: "Instagram", item: "게시물", owner: "계정", follower: "팔로워", hook: "캡션 첫 줄", dateLabel: "게시일",
    defaultSort: "outlier", thumb: "square", costLabel: "예상 비용",
    kinds: [["all", "종류 전체"], ["post", "포스트만"], ["reel", "릴스만"]],
    kindOf: r => r.kind === "릴스" ? "reel" : "post",
    patternSub: "어떤 첫 줄(훅)이 반복적으로 터지는가 — 캡션 첫 줄이 스크롤을 멈춘다",
    gemSub: "팔로워 후광 없이 콘텐츠 자체로 이긴, 가장 베낄 가치가 큰 레퍼런스 (팔로워 10만 미만 · 3배 이상)",
    steps: [
      ["1. 해시태그·키워드로 검색", "만들려는 콘텐츠의 주제를 검색하면 그 주제의 인기 게시물을 모아줍니다"],
      ["2. 아웃라이어로 정렬", '좋아요 수가 아니라 "그 계정 평소 대비 몇 배 터졌나"로 레퍼런스를 고르세요'],
      ["3. 패턴 찾기", "첫 줄 패턴·팔로워 규모 인사이트에서 반복되는 승리 공식을 확인하세요"],
    ],
    cols: [
      { key: "metric", label: "반응수", tip: "좋아요 + 댓글", cell: cellBold("metric") },
      { key: "likes", label: "좋아요", cell: cellHidden("likes") },
      { key: "comments", label: "댓글", cell: cellNum("comments") },
      { key: "views", label: "조회수", tip: "릴스·영상만", hideIfEmpty: true, cell: cellNum("views") },
      { key: "channelAvg", label: "계정평균", tip: "그 계정 최근 게시물의 평균 반응수", dim: true, cell: cellNum("channelAvg") },
      COL_OUTLIER,
      { key: "engagement", label: "참여율", tip: "반응수 ÷ 팔로워", cell: cellPct },
    ],
    csv: [
      ["title", "캡션첫줄"], ["text", "캡션전문"], ["kind", "유형"], ["metric", "반응수"], ["likes", "좋아요"],
      ["comments", "댓글"], ["views", "조회수"], ["outlier", "아웃라이어배수"], ["velocity", "일일반응수"],
      ["engagement", "참여율(%)"], ["channel", "계정"], ["subs", "팔로워"], ["tier", "팔로워규모"],
      ["channelAvg", "계정평균반응수"], ["date", "게시일"], ["patterns", "첫줄패턴"], ["url", "URL"], ["thumb", "썸네일URL"],
    ],
  },

  threads: {
    label: "Threads", item: "글", owner: "계정", follower: "팔로워", hook: "본문 첫 줄", dateLabel: "게시일",
    defaultSort: "outlier", thumb: null, costLabel: "예상 비용",
    patternSub: "어떤 첫 문장이 반복적으로 터지는가 — 스레드는 첫 문장이 전부다",
    prepare: null,   // threads.js 가 채운다
    gemSub: "팔로워 후광 없이 글 자체로 이긴, 가장 베낄 가치가 큰 레퍼런스 (팔로워 10만 미만 · 3배 이상)",
    steps: [
      ["1. 키워드로 검색", "쓰려는 글의 주제를 검색하면 그 주제로 반응을 얻은 글을 모아줍니다"],
      ["2. 아웃라이어로 정렬", '조회수가 아니라 "그 계정 평소 대비 몇 배 터졌나"로 레퍼런스를 고르세요'],
      ["3. 패턴 찾기", "첫 문장 패턴·팔로워 규모 인사이트에서 반복되는 승리 공식을 확인하세요"],
    ],
    cols: [
      { key: "views", label: "조회수", hideIfEmpty: true, cell: r => r.views != null ? `<b>${fmtNum(r.views)}</b>` : "-" },
      { key: "metric", label: "반응수", tip: "좋아요 + 답글 + 리포스트 + 인용", cell: cellHidden("metric") },
      { key: "likes", label: "좋아요", cell: cellHidden("likes") },
      { key: "comments", label: "답글", cell: cellNum("comments") },
      { key: "shares", label: "리포스트", tip: "리포스트 + 인용", cell: cellNum("shares") },
      { key: "channelAvg", label: "계정평균", tip: "그 계정 최근 글의 평균 — 위에서 고른 기준(조회수/반응수)", dim: true, cell: cellNum("channelAvg") },
      COL_OUTLIER,
      { key: "engagement", label: "참여율", tip: "반응수 ÷ 팔로워", cell: cellPct },
    ],
    csv: [
      ["title", "본문첫줄"], ["text", "본문전문"], ["kind", "유형"], ["views", "조회수"], ["metric", "반응수"], ["likes", "좋아요"],
      ["comments", "답글"], ["shares", "리포스트+인용"], ["outlierViews", "조회수배수"], ["outlierEng", "반응수배수"],
      ["avgViews", "계정평균조회수"], ["avgEng", "계정평균반응수"], ["velocity", "일일반응수"],
      ["engagement", "참여율(%)"], ["channel", "계정"], ["subs", "팔로워"], ["tier", "팔로워규모"],
      ["date", "게시일"], ["patterns", "첫줄패턴"], ["url", "URL"],
    ],
  },
};

// ---------------- 상태 (플랫폼별로 따로 보관) ----------------
const S = {};
for (const pf of Object.keys(PLATFORMS)) {
  S[pf] = { rows: [], sort: { key: PLATFORMS[pf].defaultSort, dir: -1 }, topic: "", stats: null, busy: 0 };
}
let PF = "youtube";
const $ = id => document.getElementById(id);

function setStatus(pf, msg, pct, isError = false) {
  const el = $("status-" + pf);
  el.style.display = "block";
  el.className = "status" + (isError ? " error" : "");
  el.innerHTML = msg + (pct != null ? `<div class="progress-bar"><div style="width:${pct}%"></div></div>` : "");
}

// 버튼 잠금 + 스피너 + 탭의 "작업 중" 점. 다른 탭으로 옮겨가도 수집은 계속된다.
async function withBusy(pf, btnId, busyHTML, fn) {
  const btn = $(btnId);
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = busyHTML;
  S[pf].busy++;
  updateTabBusy();
  try { return await fn(); }
  finally {
    btn.disabled = false;
    btn.innerHTML = orig;
    S[pf].busy--;
    updateTabBusy();
  }
}

function updateTabBusy() {
  document.querySelectorAll(".tabs button").forEach(b =>
    b.classList.toggle("busy", S[b.dataset.tab].busy > 0));
}

// 수집 결과를 상태에 반영 → (보고 있는 탭이면) 화면 갱신 → 히스토리 저장
function commitResults(pf, { rows, topic, sortKey, channelCount, costText, history }) {
  const st = S[pf];
  PLATFORMS[pf].prepare?.(rows);   // 플랫폼별 후처리 (스레드: 선택한 기준의 배수로 맞춤)
  st.rows = rows;
  st.topic = topic;
  st.sort = { key: sortKey || PLATFORMS[pf].defaultSort, dir: -1 };
  st.stats = { channels: channelCount, costText };
  if (history) {
    saveHistory({ id: String(Date.now()), pf, ts: Date.now(), topic, channelCount, rows, ...history });
  }
  if (PF === pf) renderResults();
}

// ---------------- 탭 ----------------
function switchTab(pf) {
  if (!PLATFORMS[pf]) pf = "youtube";
  PF = pf;
  try { localStorage.setItem("rr_tab", pf); } catch {}
  const P = PLATFORMS[pf];

  document.querySelectorAll(".tabs button").forEach(b =>
    b.setAttribute("aria-selected", String(b.dataset.tab === pf)));
  document.querySelectorAll("[data-pf-section]").forEach(s =>
    s.classList.toggle("active", s.dataset.pfSection === pf));

  // 플랫폼에 따라 달라지는 라벨들
  $("statCountLabel").textContent = `수집 ${P.item}`;
  $("statOwnerLabel").textContent = `${P.owner} 수`;
  $("statCostLabel").textContent = P.costLabel;
  $("patternTitle").textContent = `${P.hook} 패턴별 분포`;
  $("patternSub").textContent = P.patternSub;
  $("tierTitle").textContent = `${P.follower} 규모별 분포`;
  $("tierSub").textContent = `작은 ${P.owner}의 아웃라이어를 놓치지 마라`;
  $("gemTitle").textContent = `💎 작은 ${P.owner}의 아웃라이어`;
  $("gemSub").textContent = P.gemSub;
  $("emptySteps").innerHTML = P.steps.map(([b, s]) =>
    `<div class="step"><b>${b}</b><span>${s}</span></div>`).join("");
  $("tierFilter").innerHTML = [`<option value="all">${P.follower} 규모 전체</option>`]
    .concat(["1만 미만", "1만~10만", "10만~100만", "100만 이상"].map(t => `<option value="${t}">${t}</option>`)).join("");
  $("minOutlier").value = "0";
  $("kindFilter").style.display = P.kinds ? "" : "none";
  $("kindFilter").innerHTML = (P.kinds || []).map(([v, label]) => `<option value="${v}">${label}</option>`).join("");

  renderHistory();
  renderResults();
}

// ---------------- 히스토리 ----------------
const HISTORY_KEY = "rr_history";
const HISTORY_PER_PLATFORM = 30;

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(entry) {
  let list = [entry, ...getHistory()];
  // 플랫폼별 최근 30개만 유지
  const seen = {};
  list = list.filter(h => (seen[h.pf] = (seen[h.pf] || 0) + 1) <= HISTORY_PER_PLATFORM);
  // 저장 용량 초과 시 오래된 것부터 지우며 재시도
  while (list.length) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); break; }
    catch { list.pop(); }
  }
  renderHistory();
}

function renderHistory() {
  const P = PLATFORMS[PF];
  const list = getHistory().filter(h => h.pf === PF);
  $("historyPanel").style.display = list.length ? "block" : "none";
  $("historyList").innerHTML = list.map(h => {
    const d = new Date(h.ts);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `<div class="history-item">
      <span class="htype">${h.type === "channel" ? ICONS.tv : ICONS.search}</span>
      <span class="hname" onclick="loadHistory('${escapeHtml(h.id)}')">${escapeHtml(h.topic)}</span>
      <span class="hmeta">${escapeHtml(h.desc || "")} · ${P.item} ${h.rows.length}개 · ${when}</span>
      <button class="hdel" onclick="deleteHistory('${escapeHtml(h.id)}')" title="삭제" aria-label="히스토리 항목 삭제">${ICONS.x}</button>
    </div>`;
  }).join("");
}

function loadHistory(id) {
  const h = getHistory().find(x => x.id === id);
  if (!h) return;
  const pf = h.pf;
  commitResults(pf, {
    rows: h.rows, topic: h.topic,
    sortKey: h.type === "channel" ? "date" : null,
    channelCount: h.channelCount ?? "-",
    costText: "0 (히스토리)",
  });
  setStatus(pf, `🕘 히스토리에서 불러옴: "${escapeHtml(h.topic)}" (${new Date(h.ts).toLocaleString("ko-KR")} 수집 · 추가 비용 없음)`, null);
  $("resultsHeader").scrollIntoView({ behavior: "smooth" });
}

function deleteHistory(id) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(getHistory().filter(x => x.id !== id)));
  renderHistory();
}

function clearHistory() {
  const P = PLATFORMS[PF];
  if (!confirm(`${P.label} 히스토리를 전부 삭제할까요?`)) return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(getHistory().filter(x => x.pf !== PF)));
  renderHistory();
}

// ---------------- 결과 렌더링 ----------------
function renderResults() {
  const st = S[PF];
  const has = st.stats != null;
  $("emptyState").style.display = has ? "none" : "block";
  $("statsRow").style.display = has ? "grid" : "none";
  $("resultsHeader").style.display = has ? "flex" : "none";
  $("tableWrap").style.display = has ? "block" : "none";
  $("insights").style.display = has ? "block" : "none";
  if (!has) return;

  $("statVideos").textContent = st.rows.length;
  $("statChannels").textContent = st.stats.channels ?? "-";
  const maxOut = Math.max(0, ...st.rows.map(r => r.outlier || 0));
  $("statMaxOutlier").textContent = maxOut > 0 ? maxOut.toFixed(1) + "x" : "-";
  $("statQuota").textContent = st.stats.costText ?? "-";
  render();
  renderInsights();
}

function filteredRows() {
  const st = S[PF];
  const tier = $("tierFilter").value;
  const minOut = parseFloat($("minOutlier").value);
  const P = PLATFORMS[PF];
  const kind = P.kinds ? $("kindFilter").value : "all";
  let rows = [...st.rows];
  if (kind && kind !== "all") rows = rows.filter(r => P.kindOf(r) === kind);
  if (tier !== "all") rows = rows.filter(r => r.tier === tier);
  if (minOut > 0) rows = rows.filter(r => r.outlier != null && r.outlier >= minOut);
  const { key, dir } = st.sort;
  rows.sort((a, b) => {
    const av = a[key] ?? -Infinity, bv = b[key] ?? -Infinity;
    return dir === -1 ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
  });
  return rows;
}

function setSort(key) {
  const st = S[PF];
  if (st.sort.key === key) st.sort.dir *= -1;
  else st.sort = { key, dir: -1 };
  render();
}

// 인스타·스레드 CDN 이미지는 다른 사이트에서 바로 못 불러온다 → 서버 프록시(/api/img) 경유.
// 프록시가 없는 file:// 실행이나 만료된 주소는 onerror에서 자리표시로 바뀐다.
function thumbSrc(url) {
  if (!url) return "";
  if (/^https:\/\/[^/]*\.(cdninstagram\.com|fbcdn\.net)\//.test(url) && location.protocol !== "file:") {
    return "/api/img?u=" + encodeURIComponent(url);
  }
  return url;
}

function thumbImg(r) {
  const src = thumbSrc(r.thumb);
  const kind = r.kind || "미리보기 없음";
  if (!/^(https:\/\/|\/api\/img\?)/.test(src)) return `<div class="thumb-ph">${escapeHtml(kind)}</div>`;
  return `<img src="${escapeHtml(src)}" loading="lazy" referrerpolicy="no-referrer" data-kind="${escapeHtml(kind)}"
    alt="${escapeHtml(r.title)} 썸네일" onerror="thumbFail(this)">`;
}

function thumbFail(img) {
  const d = document.createElement("div");
  d.className = "thumb-ph";
  d.textContent = img.dataset.kind || "미리보기 없음";
  img.replaceWith(d);
}

function render() {
  const P = PLATFORMS[PF], st = S[PF];
  const rows = filteredRows();
  const cols = P.cols.filter(c => !c.hideIfEmpty || st.rows.some(r => r[c.key] != null));

  const th = (key, label, cls = "", tip = "") => {
    const active = st.sort.key === key;
    return `<th class="${cls}${active ? " sorted" : ""}" data-sort="${key}" onclick="setSort('${key}')"
      aria-sort="${active ? (st.sort.dir === -1 ? "descending" : "ascending") : "none"}"${tip ? ` title="${escapeHtml(tip)}"` : ""}>${label}</th>`;
  };
  $("thead").innerHTML = "<th>#</th>"
    + (P.thumb ? "<th>썸네일</th>" : "")
    + `<th>${P.hook} / 패턴</th>`
    + cols.map(c => th(c.key, c.label, "num", c.tip)).join("")
    + `<th>${P.owner}</th>`
    + th("subs", P.follower, "num")
    + th("date", P.dateLabel);

  $("resultCount").textContent = `${rows.length}개`;

  $("tbody").innerHTML = rows.map((r, i) => {
    const gem = r.outlier >= 3 && r.subs != null && r.subs < 100000;
    const tags = [
      r.duration ? `⏱ ${r.duration}` : "",
      PF !== "youtube" && r.kind ? r.kind : "",
      ...r.patterns,
    ].filter(Boolean).map(t => `<span class="pattern-tag">${escapeHtml(t)}</span>`).join("");
    return `<tr>
      <td class="num">${gem ? '<span class="gem">💎</span>' : ""}${i + 1}</td>
      ${P.thumb ? `<td class="thumb${P.thumb === "square" ? " square" : ""}"><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${thumbImg(r)}</a></td>` : ""}
      <td class="title-cell${PF === "youtube" ? "" : " text-cell"}">
        <a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title) || "(본문 없음)"}</a>
        <div class="meta">${tags}</div>
      </td>
      ${cols.map(c => `<td class="num"${c.dim ? ' style="color:var(--text-dim)"' : ""}>${c.cell(r)}</td>`).join("")}
      <td>${escapeHtml(r.channel)}</td>
      <td class="num">${r.subs != null ? fmtNum(r.subs) : "비공개"}</td>
      <td style="white-space:nowrap">${escapeHtml(r.date)}</td>
    </tr>`;
  }).join("");
}

function renderInsights() {
  const P = PLATFORMS[PF], st = S[PF];
  const bars = (entries) => {
    const max = Math.max(1, ...entries.map(([, s]) => s.count));
    return entries.map(([name, s]) => {
      const avg = s.outs.length ? s.outs.reduce((a, b) => a + b, 0) / s.outs.length : 0;
      return barRow(name, s.count, max, `${s.count}개 · 평균 ${avg.toFixed(1)}x`);
    }).join("");
  };

  // 제목/첫 줄 패턴별
  const pat = {};
  for (const r of st.rows) for (const p of r.patterns) {
    (pat[p] ??= { count: 0, outs: [] }).count++;
    if (r.outlier != null) pat[p].outs.push(r.outlier);
  }
  $("patternBars").innerHTML = bars(Object.entries(pat).sort((a, b) => b[1].count - a[1].count));

  // 구독자/팔로워 규모별
  const tiers = {};
  for (const r of st.rows) {
    (tiers[r.tier] ??= { count: 0, outs: [] }).count++;
    if (r.outlier != null) tiers[r.tier].outs.push(r.outlier);
  }
  const order = ["1만 미만", "1만~10만", "10만~100만", "100만 이상", "비공개"];
  $("tierBars").innerHTML = bars(order.filter(t => tiers[t]).map(t => [t, tiers[t]]));

  // 작은 채널/계정의 아웃라이어
  const gems = st.rows
    .filter(r => r.outlier != null && r.outlier >= 3 && r.subs != null && r.subs < 100000)
    .sort((a, b) => b.outlier - a.outlier).slice(0, 8);
  const mainNum = r => PF === "youtube" ? `조회수 ${fmtNum(r.views)}`
    : (r.views != null ? `조회수 ${fmtNum(r.views)} · ` : "") + `반응수 ${fmtNum(r.metric)}`;
  $("gems").innerHTML = gems.length ? gems.map(r => `
    <div class="gem-item">
      ${P.thumb ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${thumbImg(r)}</a>` : ""}
      <div class="info">
        <a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title) || "(본문 없음)"}</a>
        <div class="ch">${escapeHtml(r.channel)} · ${P.follower} ${fmtNum(r.subs)} · ${mainNum(r)} · 참여율 ${r.engagement != null ? r.engagement.toFixed(1) + "%" : "비공개"}</div>
      </div>
      <div class="mult">${r.outlier.toFixed(1)}x</div>
    </div>`).join("")
    : `<div style="color:var(--text-dim);font-size:13px">조건에 맞는 ${P.item}이 없습니다.</div>`;
}

function barRow(name, val, max, label) {
  return `<div class="bar-row">
    <span class="name">${escapeHtml(name)}</span>
    <div class="bar"><div style="width:${(val / max * 100).toFixed(0)}%"></div></div>
    <span class="val">${label}</span>
  </div>`;
}

// ---------------- 다운로드 ----------------
function csvValue(r, key) {
  let v = r[key];
  if (key === "patterns") v = (v || []).join(", ");
  if (v == null) v = ["likes", "comments", "subs", "engagement", "metric"].includes(key) ? "비공개" : "";
  if (typeof v === "number" && !Number.isInteger(v)) v = v.toFixed(2);
  v = String(v);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadName(ext) {
  const topic = (S[PF].topic || "results").replace(/[\\/:*?"<>|]/g, "_");
  return `references_${PF}_${topic}_${dateStr()}.${ext}`;
}

function downloadCSV() {
  const fields = PLATFORMS[PF].csv;
  const header = fields.map(([, ko]) => ko).join(",");
  const lines = filteredRows().map(r => fields.map(([k]) => csvValue(r, k)).join(","));
  downloadBlob("﻿" + [header, ...lines].join("\n"), downloadName("csv"), "text/csv;charset=utf-8");
}

function downloadJSON() {
  downloadBlob(JSON.stringify(filteredRows(), null, 2), downloadName("json"), "application/json");
}

// ---------------- 시작 ----------------
function initApp() {
  ytInit();
  apifyInit();
  thInit();
  // 필터 변경 시 즉시 재렌더
  $("kindFilter").addEventListener("change", () => S[PF].stats && render());
  $("tierFilter").addEventListener("change", () => S[PF].stats && render());
  $("minOutlier").addEventListener("change", () => S[PF].stats && render());

  let start = location.hash.slice(1);
  if (!PLATFORMS[start]) {
    try { start = localStorage.getItem("rr_tab"); } catch {}
  }
  switchTab(start || "youtube");
}
