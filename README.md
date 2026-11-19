# Reference-research

콘텐츠 레퍼런스 리서치 도구 — **YouTube · Instagram · Threads** 세 플랫폼에서
"절대 수치"가 아니라 **"그 계정 평소보다 몇 배 터졌나"(아웃라이어 배수)** 로 레퍼런스를 찾는다.

[channel-pulse](https://github.com/ujpark1/channel-pulse)의 "레퍼런스 리서치" 화면을 독립 프로젝트로 떼어내고,
Instagram · Threads 탭을 추가한 것. 빌드 과정이 없는 정적 웹앱 + 서버리스 프록시 3개로 이루어져 있다.

## 탭별 기준

| 탭 | 검색 | 아웃라이어 배수 | 계정 평균의 표본 | 데이터 |
|---|---|---|---|---|
| YouTube | 주제어 | 조회수 ÷ 채널 평균 조회수 | 채널 최근 영상 30개 | YouTube Data API v3 |
| Instagram | 해시태그 / 키워드 (포스트·릴스·전체) | 릴스: 조회수 ÷ 계정 릴스 평균 조회수 (반응수로 전환 가능) · 포스트: 반응수(좋아요+댓글) ÷ 계정 포스트 평균 반응수 | 릴스: 계정 최근 릴스 6/12개 · 포스트: 프로필의 최근 포스트 최대 12개 (고정 게시물·자기 자신 제외) | Apify |
| Threads | 키워드 | 조회수 ÷ 계정 평균 조회수 (반응수 기준으로 전환 가능) | 계정 최근 글 5/10/20개 (답글·리포스트·고정 글·자기 자신 제외) | Apify |

- 세 탭 모두 **링크 분석**(영상·게시물·글 하나의 판정, 또는 채널·계정 요약), **히스토리**(브라우저에 저장, 다시 불러올 때 비용 없음),
  **패턴 인사이트**(제목·첫 줄 패턴, 구독자·팔로워 규모, 작은 계정의 아웃라이어), **CSV/JSON 다운로드**를 지원한다.
- 결과 위 필터: 종류(YouTube는 쇼츠 제외/쇼츠만, Instagram은 포스트만/릴스만), 구독자·팔로워 규모, 최소 배수. 다시 수집하지 않고 바로 적용된다.
- Instagram은 포스트 / 릴스 / 전체 중에 골라 검색한다. 포스트 검색은 결과에 섞여 오는 릴스를 걸러내려고 2배를 가져온다(비용도 그만큼).
  계정 평균은 같은 종류끼리 비교하고(릴스는 릴스, 포스트는 포스트), 같은 종류가 3개 미만이면 전체로 비교한다.
- 프로필 스크레이퍼의 "최근 게시물"에는 **릴스가 들어 있지 않다**(2026-11 실측). 그래서 릴스 평균(조회수 포함)은 계정마다
  릴스 탭을 따로 가져와 계산한다. 릴스 검색 1회 비용이 그만큼 늘어난다(계정 수 × 표본 수 × $0.0023 — 화면에 예상 비용 표시).
  "릴스 평균 표본"을 끄면 릴스를 그 계정의 포스트 평균 반응수와 비교하고, 그런 행은 표에 * 로 표시한다.
- 조회수는 릴스에만 있어서 포스트는 반응수로만 비교한다. 좋아요를 숨긴 게시물은 반응수 기준에서 판정 불가로 나온다.
- Threads는 조회수가 기본 기준이고, 화면에서 반응수(좋아요+답글+리포스트+인용) 기준으로 바로 바꿀 수 있다(두 값을 모두 저장).
  스크레이퍼 문서는 "로그인 없이는 조회수가 드물다"고 하지만 2026-11 실측에서는 검색 글 9/9, 계정 최근 글 16/16에서 잡혔다.
  조회수가 비어 있는 글은 조회수 기준에서 판정 불가로 나온다. 좋아요 10개 미만인 글은 검색에서 제외한다(`assets/threads.js`의 `TH_MIN_LIKES`).
- Instagram · Threads는 표본이 작아서 판정 대상 게시물을 평균에서 뺀다. YouTube 주제어 검색은 원본과 같이 포함한다.

## 왜 Apify인가

Instagram · Threads는 **남의 게시물 지표를 키워드로 검색하는 공식 API가 없다**
(Instagram 해시태그 검색 API는 작성자 정보를 주지 않고, Threads 키워드 검색은 앱 심사가 필요하다).
그래서 공개 페이지를 읽어주는 [Apify](https://apify.com) Actor를 쓴다. 쓰는 만큼 과금된다.

| 용도 | Actor | 가격(2026-11 기준) |
|---|---|---|
| Instagram 검색 | `apify/instagram-hashtag-scraper` (Apify 공식) | 결과 1건 $0.0023 |
| Instagram 계정 평균 · 계정 분석 | `apify/instagram-profile-scraper` (Apify 공식) | 프로필 1건 $0.0023 |
| Instagram 게시물 링크 분석 | `apify/instagram-scraper` (Apify 공식) | 결과 1건 $0.0023 |
| Instagram 계정의 릴스 (계정 분석 · 릴스 링크 분석) | `apify/instagram-reel-scraper` (Apify 공식) | 릴스 1건 $0.0023 + 실행당 $0.001 |
| Threads 검색 · 계정 글 | `lergassy/threads-scraper` (커뮤니티) | 글 1건 $0.0018, 프로필 1건 $0.0036 |

대략 Instagram 검색 1회 포스트 $0.15~0.35 · 릴스 $0.3~0.9(표본 6개 기준), Threads 검색 1회 $0.20~1.00 (게시물 수 · 계정 표본에 비례. 화면에 예상 비용이 표시된다).
Apify 무료 플랜은 매달 $5 크레딧을 주지만, Instagram 검색은 무료 플랜에서 결과 첫 페이지까지만 나온다. Actor를 바꾸려면 `assets/apify.js`와 `api/apify.js`의 목록을 **둘 다** 고친다.

> Threads Actor는 커뮤니티 제작이라 출력 형식이나 가격이 바뀔 수 있다. 결과가 이상하면 `assets/threads.js`의 `thNorm()`부터 확인.

## 키 준비

| 키 | 어디서 | 쓰는 탭 |
|---|---|---|
| YouTube Data API 키 | Google Cloud Console → API 및 서비스 → 사용자 인증 정보 (YouTube Data API v3 사용 설정) | YouTube |
| Apify API 토큰 | console.apify.com → Settings → API & Integrations | Instagram · Threads |

키를 넣는 방법은 두 가지이고, 섞어 써도 된다.

1. **페이지에 직접 입력** — 브라우저(localStorage)에만 저장되고, 브라우저가 Google/Apify를 직접 호출한다.
2. **서버 환경변수** — `YOUTUBE_API_KEY`, `APIFY_TOKEN`. 입력칸을 비워두면 서버 프록시(`/api/*`)를 거친다.

## 실행

```bash
# 모의 데이터로 화면만 확인 (키·비용 없음)
npm run dev:mock

# 실제 호출 — .env.example 을 .env 로 복사해 키를 넣거나, 페이지에 직접 입력
npm run dev
```

http://localhost:5173 에서 열린다 (Node 18+, 설치할 의존성 없음).
`index.html`을 브라우저로 바로 열어도 동작하지만, 그때는 키를 페이지에 입력해야 하고 Instagram 썸네일은 표시되지 않는다
(Meta CDN 이미지는 서버 프록시 `/api/img`를 거쳐야 보인다).

## 배포 (Vercel)

저장소를 Vercel에 임포트하면 끝. Build Command 없음.
Environment Variables에 `YOUTUBE_API_KEY`, `APIFY_TOKEN`을 넣으면 키 입력 없이 쓸 수 있다.

⚠️ 환경변수를 넣으면 **주소를 아는 누구나 내 쿼터·크레딧을 쓸 수 있다.** Vercel의 **Deployment Protection**을 켜 두자.
프록시는 허용된 Actor·입력 상한만 통과시키지만(`api/apify.js`), 그것이 접근 제한을 대신하지는 않는다.

## 구조

```
index.html          화면 (탭 3개 + 공통 결과 영역)
assets/
  style.css         스타일 (shadcn/ui 디자인 시스템을 순수 CSS로 옮긴 것 · 라이트/다크 자동)
  core.js           공통: 탭 · 상태 · 히스토리 · 결과 테이블 · 인사이트 · 다운로드
  youtube.js        YouTube 수집 (원본 로직 그대로)
  apify.js          Apify 호출 (직접 / 프록시) + 비용 집계
  instagram.js      Instagram 수집
  threads.js        Threads 수집
api/
  yt.js             YouTube Data API 프록시
  apify.js          Apify 프록시 (허용 Actor · 입력 상한)
  img.js            Meta CDN 썸네일 프록시
dev-server.js       로컬 개발 서버
dev/mock.js         모의 데이터 (--mock 전용)
```

플랫폼을 추가하려면 `core.js`의 `PLATFORMS`에 열·라벨을 정의하고, 수집 결과를 공통 행 모양으로 만들어 `commitResults()`에 넘기면 된다.
