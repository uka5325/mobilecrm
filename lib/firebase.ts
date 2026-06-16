import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  initializeAuth,
  getAuth,
} from "firebase/auth";
import { initializeFirestore, getFirestore } from "firebase/firestore";
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

// Use initializeAuth with IndexedDB first so OAuth state survives
// iOS Safari's storage partitioning across redirect cycles.
// Falls back to localStorage then sessionStorage on older browsers.
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

function createDb(firebaseApp: FirebaseApp) {
  try {
    return initializeFirestore(firebaseApp, {});
  } catch {
    return getFirestore(firebaseApp);
  }
}

export const auth = createAuth();
export const db = app ? createDb(app) : (null as unknown as ReturnType<typeof getFirestore>);
export const storage = app ? getStorage(app) : (null as unknown as ReturnType<typeof getStorage>);
