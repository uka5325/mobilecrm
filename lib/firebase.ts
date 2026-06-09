import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
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

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Use initializeAuth with IndexedDB first so OAuth state survives
// iOS Safari's storage partitioning across redirect cycles.
// Falls back to localStorage then sessionStorage on older browsers.
function createAuth() {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
    });
  } catch {
    // Already initialized (e.g. HMR re-evaluation)
    return getAuth(app);
  }
}

export const auth = createAuth();

function createDb(app: FirebaseApp) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Already initialized (e.g. HMR re-evaluation) — return existing instance
    return getFirestore(app);
  }
}

export const db = createDb(app);
export const storage = getStorage(app);

