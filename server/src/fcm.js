const admin = require('firebase-admin')

let initialized = false

function init() {
  if (initialized || !process.env.FIREBASE_SERVICE_ACCOUNT) return
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    admin.initializeApp({ credential: admin.credential.cert(sa) })
    initialized = true
    console.log('✓ Firebase Admin initialized')
  } catch (err) {
    console.error('Firebase init error:', err.message)
  }
}

async function sendPush(fcmToken, title, body, data = {}) {
  if (!fcmToken) return
  init()
  if (!initialized) return

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } }
    })
  } catch (err) {
    console.error('Push send error:', err.message)
  }
}

module.exports = { sendPush }
