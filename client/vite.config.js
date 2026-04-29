import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 모드: LAN 접근 허용 + 서버 API 프록시 (브라우저 단독 테스트 가능)
// 사용법:
//   npm run dev          → http://localhost:3000 (브라우저 테스트)
//   npm run dev -- --host → LAN IP에서도 접속 가능 (Unity 실기기 연결용)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // 0.0.0.0으로 listen — Unity 디바이스에서 PC IP로 접근 가능
    proxy: {
      // /api/* 요청은 production 서버로 프록시 (프론트만 로컬 개발)
      '/api': {
        target: process.env.VITE_API_TARGET || 'https://arr-production.up.railway.app',
        changeOrigin: true,
        secure: true
      }
    }
  }
})
