/**
 * Unity WebView 브릿지
 * 웹앱 → Unity: window.Unity.call(msg)
 * Unity → 웹앱: window.unityBridge.receive(msg)
 */

const isInsideUnity = () =>
  typeof window.Unity !== 'undefined' ||
  typeof window.webkit?.messageHandlers?.unityControl !== 'undefined'

// 웹앱에서 Unity로 메시지 전송
export function sendToUnity(type, payload = {}) {
  const msg = JSON.stringify({ type, ...payload })

  // gree/unity-webview Android
  if (typeof window.Unity !== 'undefined') {
    window.Unity.call(msg)
    return
  }
  // gree/unity-webview iOS
  if (typeof window.webkit?.messageHandlers?.unityControl !== 'undefined') {
    window.webkit.messageHandlers.unityControl.postMessage(msg)
    return
  }
  // 브라우저 직접 실행 시 콘솔에만 출력
  console.log('[UnityBridge → Unity]', msg)
}

// Unity가 웹앱 함수를 호출하는 수신 핸들러 등록
export function registerUnityReceiver(handler) {
  window.unityBridge = { receive: handler }
}

export { isInsideUnity }
