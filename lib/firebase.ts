import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  initializeAuth,
  getAuth,
} from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfig.apiKey) return null;
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

const app = getFirebaseApp();

function createAuth() {
  if (!app) return null as unknown as ReturnType<typeof getAuth>;
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();

function createFirestore() {
  if (!app) return null as unknown as ReturnType<typeof getFirestore>;
  try {
    // experimentalForceLongPolling(전송 계층) + persistentLocalCache(IndexedDB 캐시 계층)는
    // 서로 다른 관심사라 충돌하지 않는다. 영속 캐시로 재구독 시 변경분만 읽어 Firestore 읽기 비용을 줄인다.
    // 멀티탭 관리자로 여러 탭이 같은 IndexedDB 캐시를 안전하게 공유한다.
    // 주의: 영속 캐시는 예약 PII를 기기 IndexedDB에 영구 저장하므로,
    //       로그아웃 시 clearAllClientCaches()가 IndexedDB까지 purge해야 한다(공용기기 PII 잔존 차단).
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createFirestore();
export const storage = app ? getStorage(app) : (null as unknown as ReturnType<typeof getStorage>);
