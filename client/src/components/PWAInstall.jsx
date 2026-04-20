import { useState, useEffect } from 'react'

export default function PWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState('default')
  const [showPanel, setShowPanel] = useState(false)

  useEffect(() => {
    // 설치 프롬프트 저장
    const handleBeforeInstall = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    }

    // 이미 설치됐는지 확인
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
    }

    // 알림 권한 확인
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', () => setIsInstalled(true))

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
    }
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) {
      alert('브라우저 메뉴에서 "홈 화면에 추가"를 선택하세요')
      return
    }

    installPrompt.prompt()
    const result = await installPrompt.userChoice
    if (result.outcome === 'accepted') {
      setIsInstalled(true)
    }
    setInstallPrompt(null)
  }

  const handleNotification = async () => {
    if (!('Notification' in window)) {
      alert('이 브라우저는 알림을 지원하지 않습니다')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)

    if (permission === 'granted') {
      // 서비스 워커에 푸시 구독 등록
      try {
        const reg = await navigator.serviceWorker.ready
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            // 테스트용 VAPID public key (나중에 실제 키로 교체)
            'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
          )
        })
        console.log('Push subscription:', subscription)

        // 서버에 구독 정보 저장 (나중에 구현)
        // await fetch('/api/push/subscribe', { ... })

        alert('알림이 활성화되었습니다!')
      } catch (err) {
        console.error('Push subscription failed:', err)
        alert('알림 설정에 실패했습니다')
      }
    }
  }

  // 이미 설치되고 알림도 허용됐으면 표시 안함
  if (isInstalled && notificationPermission === 'granted') {
    return null
  }

  return (
    <>
      {/* 작은 버튼 */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        style={styles.toggleBtn}
      >
        ⚙️
      </button>

      {/* 설정 패널 */}
      {showPanel && (
        <div style={styles.panel}>
          <h4 style={styles.title}>앱 설정</h4>

          {!isInstalled && (
            <button onClick={handleInstall} style={styles.btn}>
              📲 앱으로 설치
            </button>
          )}

          {notificationPermission !== 'granted' && (
            <button onClick={handleNotification} style={styles.btn}>
              🔔 알림 허용
            </button>
          )}

          {isInstalled && (
            <div style={styles.status}>✅ 앱 설치됨</div>
          )}

          {notificationPermission === 'granted' && (
            <div style={styles.status}>✅ 알림 허용됨</div>
          )}

          <button onClick={() => setShowPanel(false)} style={styles.closeBtn}>
            닫기
          </button>
        </div>
      )}
    </>
  )
}

// VAPID key 변환 함수
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

const styles = {
  toggleBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.8)',
    border: 'none',
    fontSize: 20,
    cursor: 'pointer',
    zIndex: 1000
  },
  panel: {
    position: 'absolute',
    top: 70,
    right: 20,
    background: 'rgba(0,0,0,0.9)',
    padding: 16,
    borderRadius: 12,
    color: 'white',
    zIndex: 1000,
    minWidth: 180
  },
  title: {
    marginBottom: 12,
    fontSize: 14
  },
  btn: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    marginBottom: 8,
    background: '#00ff88',
    color: 'black',
    border: 'none',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 14
  },
  status: {
    padding: '8px 0',
    fontSize: 13,
    color: '#00ff88'
  },
  closeBtn: {
    width: '100%',
    padding: 8,
    marginTop: 8,
    background: 'transparent',
    color: '#888',
    border: '1px solid #444',
    borderRadius: 6,
    cursor: 'pointer'
  }
}
