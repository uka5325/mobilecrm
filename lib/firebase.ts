import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  Auth,
  setPersistence,
} from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";
import { FirebaseStorage, getStorage } from "firebase/storage";

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

export const auth: Auth = app ? getAuth(app) : (null as unknown as Auth);
export const db: Firestore = app ? getFirestore(app) : (null as unknown as Firestore);
export const storage: FirebaseStorage = app ? getStorage(app) : (null as unknown as FirebaseStorage);

if (typeof window !== "undefined" && auth) {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error("[Firebase auth persistence error]", error);
  });
}
