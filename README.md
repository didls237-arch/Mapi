# Discord AI 분석 서버 v1.1

`Discord -> Bot(Node.js) -> OpenClaw -> 모델` 구조로 동작하는 분석 서버입니다.

## 핵심 기능

- Slash commands
  - `/analyze market:{kor|ex|coin} ticker:{string}`
  - `/summary scope:{macro|kor|ex|coin} thread_id:{optional}`
  - `/rollover thread_id:{id}`
  - `/status`
- 15턴 자동 토론 (턴당 1메시지)
  - 1~5: 탐색 단계
  - 6~10: 검증 및 반박 단계
  - 11~15: 수렴 및 합의 단계
- OpenClaw API 재시도(backoff) + 턴 실패 스킵 옵션
- 분석 도중 장애 시 `analysis_jobs` 기반 재개 지원
- Macro Scenario 관리자 메시지 자동 응답/공유
- Summary 체크포인트 기반 증분 요약
- 최종 PNG 리포트 생성 및 Summary 채널 업로드
- PostgreSQL 영속 저장
- Guild 자동 부트스트랩 CLI (`bootstrap:guild`)

## 보안 기본 정책

- `.env`는 git 추적 제외 (`.gitignore` 포함)
- `Create Instant Invite`는 관리자 역할만 허용
- 참가자는 `question` 채널에서만 쓰기 가능

## 빠른 시작

1. 환경 파일 생성

```bash
cp .env.example .env
```

2. 최소 입력

- `DISCORD_TOKEN`
- `DISCORD_GUILD_ID`

3. 의존성 설치

```bash
npm install
```

4. 길드 구조 자동 생성

```bash
npm run bootstrap:guild
```

5. 추가 환경값 입력

- `DISCORD_CLIENT_ID`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_OAUTH_BEARER_TOKEN`
- `PG_CONNECTION_STRING`

6. DB 마이그레이션

```bash
npm run migrate
```

7. 슬래시 명령 등록

```bash
npm run register:commands
```

8. 실행

```bash
npm run dev
```

## Bootstrap 생성 구조

- `Macro Scenario`
  - Forum: `macro-scenario`
  - Text: `summary`, `question`
- `Kor.Analysis`
  - Forum: `kor-analysis`
  - Text: `summary`, `question`
- `Ex.Analysis`
  - Forum: `ex-analysis`
  - Text: `summary`, `question`
- `Coin Analysis`
  - Forum: `coin-analysis`
  - Text: `summary`, `question`

## 테스트

```bash
npm test
```
