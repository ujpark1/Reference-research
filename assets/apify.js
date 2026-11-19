// Apify 클라이언트 — Instagram · Threads 탭이 같이 쓴다.
// 인스타·스레드는 "남의 게시물 지표"를 주는 공식 API가 없어서 Apify 스크레이퍼(Actor)로 공개 데이터를 읽는다.
// 토큰이 있으면 브라우저에서 Apify로 직접, 없으면 서버 프록시(/api/apify, 환경변수 APIFY_TOKEN)로 호출한다.
"use strict";

const APIFY_API = "https://api.apify.com/v2";

// 쓰는 Actor와 결과 1건당 가격(USD, 2026-11 기준 · 예상 비용 표시에만 사용).
// ⚠️ api/apify.js 의 ACTORS 와 id를 똑같이 맞출 것 (프록시는 이 목록만 허용)
const APIFY_ACTORS = {
  igSearch:  { id: "apify~instagram-hashtag-scraper", price: 0.0023 },
  igProfile: { id: "apify~instagram-profile-scraper", price: 0.0023 },
  igPost:    { id: "apify~instagram-scraper",         price: 0.0023 },
  igReels:   { id: "apify~instagram-reel-scraper",    price: 0.0023, start: 0.001 },   // 계정의 릴스 탭
  threads:   { id: "lergassy~threads-scraper",        price: 0.0018, profilePrice: 0.0036 },
};

function apifyToken() { return localStorage.getItem("apify_token") || ""; }

function apifyInit() {
  // 인스타·스레드 탭의 토큰 입력칸은 같은 값을 공유한다
  const inputs = document.querySelectorAll(".apify-token");
  inputs.forEach(input => {
    input.value = apifyToken();
    input.addEventListener("change", () => {
      localStorage.setItem("apify_token", input.value.trim());
      inputs.forEach(o => { o.value = input.value.trim(); });
    });
  });
  apifyUpdateMonth();
}

// 토큰도 없고 프록시도 못 쓰는 상황(file://)이면 미리 알려준다
function apifyReady(pf) {
  if (apifyToken() || location.protocol !== "file:") return true;
  setStatus(pf, "⚠️ Apify API 토큰을 입력하세요. (console.apify.com → Settings → API & Integrations)", null, true);
  return false;
}

// ---------------- 이번 달 사용액 (이 브라우저에서 쓴 예상치만 집계) ----------------
function apifyMonthKey() { return new Date().toISOString().slice(0, 7); }
function apifyLoadMonth() {
  try {
    const d = JSON.parse(localStorage.getItem("apify_cost_month") || "{}");
    return d.month === apifyMonthKey() ? (d.usd || 0) : 0;
  } catch { return 0; }
}
function apifyAddCost(usd) {
  localStorage.setItem("apify_cost_month", JSON.stringify({ month: apifyMonthKey(), usd: apifyLoadMonth() + usd }));
  apifyUpdateMonth();
}
function apifyUpdateMonth() {
  const usd = apifyLoadMonth();
  document.querySelectorAll(".apify-month").forEach(el => {
    el.textContent = `이번 달 사용: 약 $${usd.toFixed(2)}`;
    el.style.color = usd >= 4 ? "var(--danger)" : usd >= 2.5 ? "var(--gold)" : "var(--green)";
  });
}
const fmtUsd = usd => "약 $" + (usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2));

// ---------------- 호출 ----------------
async function apifyFetch(direct, proxy, body) {
  const token = apifyToken();
  let url, opts = { method: body ? "POST" : "GET", headers: {} };
  if (token) {
    url = new URL(APIFY_API + direct.path);
    Object.entries(direct.query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    opts.headers.Authorization = "Bearer " + token;
  } else {
    if (location.protocol === "file:") throw new Error("Apify API 토큰을 입력하세요.");
    url = new URL("/api/apify", location.origin);
    Object.entries(proxy).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let resp;
  try { resp = await fetch(url, opts); }
  catch { throw new Error("Apify에 연결하지 못했습니다. 네트워크를 확인하거나 잠시 후 다시 시도하세요."); }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || `Apify 오류 (${resp.status})`;
    if (resp.status === 401) throw new Error("Apify 토큰이 올바르지 않습니다. 토큰을 다시 확인해주세요.");
    if (resp.status === 402 || /usage|credit|limit/i.test(data?.error?.type || "")) {
      throw new Error("Apify 크레딧이 부족하거나 사용 한도에 걸렸습니다 — " + msg);
    }
    throw new Error(msg);
  }
  return data;
}

const APIFY_DONE = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];

// Actor 실행 → 끝날 때까지 대기 → 결과(dataset) 반환.
// onTick(경과초)로 진행 상황을 알려준다. 스크레이핑이라 보통 20초~2분 걸린다.
async function apifyRun(actorKey, input, onTick) {
  const actor = APIFY_ACTORS[actorKey];
  const t0 = Date.now();
  let run = (await apifyFetch(
    { path: `/acts/${actor.id}/runs`, query: { waitForFinish: 20 } },
    { action: "start", actor: actorKey }, input)).data;

  while (!APIFY_DONE.includes(run.status)) {
    if (Date.now() - t0 > 8 * 60 * 1000) {
      throw new Error("수집이 8분 넘게 걸려 기다리기를 멈췄습니다. Apify 콘솔에서 실행 상태를 확인해보세요.");
    }
    onTick?.(Math.round((Date.now() - t0) / 1000));
    run = (await apifyFetch(
      { path: `/actor-runs/${run.id}`, query: { waitForFinish: 20 } },
      { action: "status", run: run.id })).data;
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify 실행이 끝까지 완료되지 못했습니다 (${run.status}). 잠시 후 다시 시도해보세요.`);
  }
  const items = await apifyFetch(
    { path: `/datasets/${run.defaultDatasetId}/items`, query: { clean: 1, format: "json", limit: 2000 } },
    { action: "items", dataset: run.defaultDatasetId });
  return Array.isArray(items) ? items : [];
}

// 여러 후보 필드 중 처음으로 값이 있는 것 (Actor마다·모드마다 필드명이 조금씩 달라서)
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => (o == null ? o : o[part]), obj);
    if (v != null && v !== "") return v;
  }
  return null;
}

function toCount(v) {
  const n = typeof v === "string" ? parseInt(v.replace(/,/g, ""), 10) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;   // -1 = 비공개
}

function toDate(v) {
  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return isNaN(d) ? null : d;
}

function monthsAgo(months) {
  return new Date(Date.now() - months * 30 * 86400000);
}

// ---------------- 분석 카드 공통 조각 ----------------
function metricGrid(list) {
  return `<div class="metric-grid">` + list.map(([k, v, color]) =>
    `<div class="m"><div class="k">${k}</div><div class="v"${color ? ` style="color:${color}"` : ""}>${v}</div></div>`
  ).join("") + `</div>`;
}

function avatarImg(url, alt) {
  const src = thumbSrc(url);
  if (!/^(https:\/\/|\/api\/img\?)/.test(src)) return "";
  return `<img src="${escapeHtml(src)}" referrerpolicy="no-referrer" onerror="this.remove()"
    style="width:110px;height:110px;border-radius:50%;object-fit:cover" alt="${escapeHtml(alt)} 프로필">`;
}

// 최근 게시물들이 걸친 기간으로 주당 게시 빈도 계산
function perWeekOf(dates) {
  const ds = dates.filter(Boolean).sort((a, b) => a - b);
  if (ds.length < 2) return null;
  const spanDays = Math.max((ds[ds.length - 1] - ds[0]) / 86400000, 1);
  return ds.length / spanDays * 7;
}

function waitMsg(sec) {
  return sec ? ` (${sec}초 경과 · 보통 30초~2분)` : "";
}
