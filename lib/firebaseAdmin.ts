import * as admin from "firebase-admin";

if (!admin.apps.length) {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (key) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(key) as admin.ServiceAccount),
    });
  }
}

export const adminAuth = admin.apps.length ? admin.auth() : null!;
export const adminDb = admin.apps.length ? admin.firestore() : null!;
export const FieldValue = admin.firestore.FieldValue;
