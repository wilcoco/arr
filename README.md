# Guardian AR - 수호신 전략 게임

위치 기반 수호신 전략 게임. 맵에서 영역을 확장하고 수호신으로 방어하세요.

## 구조

```
arr-game/
├── client/          # React + Mapbox (프론트엔드)
├── server/          # Node.js + Express (백엔드 API)
└── README.md
```

## 기술 스택

### Client
- React 18
- Mapbox GL JS
- Zustand (상태관리)

### Server
- Node.js + Express
- PostgreSQL + PostGIS
- Firebase Auth

### 배포
- Client: Vercel / Netlify
- Server: Railway
- DB: Railway PostgreSQL

## 핵심 기능

- 수호신 생성 (타입 + 파츠 조합)
- 영역 확장 (동심원)
- 고정/생산 수호신 배치
- 전투 시스템 (자동 + 궁극기)
- 동맹 시스템
- 지역 점유율 랭킹

## 개발 시작

```bash
# Client
cd client
npm install
npm run dev

# Server
cd server
npm install
npm run dev
```

## 환경 변수

### Client (.env)
```
VITE_MAPBOX_TOKEN=your_mapbox_token
VITE_API_URL=http://localhost:3001
```

### Server (.env)
```
DATABASE_URL=postgresql://...
FIREBASE_CONFIG=...
PORT=3001
```
