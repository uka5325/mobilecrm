import * as admin from "firebase-admin";

if (!admin.apps.length) {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (key) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(key) as admin.ServiceAccount),
      });
    } catch (e) {
      // 잘못된 키 형식 등 초기화 실패 시 명확히 로깅 (앱 부팅은 막지 않음)
      console.error(
        "[firebaseAdmin] 초기화 실패 — FIREBASE_SERVICE_ACCOUNT_KEY가 올바른 JSON 서비스 계정 키인지 확인하세요.",
        e
      );
    }
  } else {
    console.error(
      "[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 설정되지 않았습니다. 모든 API가 비활성화됩니다."
    );
  }
}

export const adminInitialized = admin.apps.length > 0;

export const adminAuth = adminInitialized ? admin.auth() : null!;
export const adminDb = adminInitialized ? admin.firestore() : null!;
export const FieldValue = admin.firestore.FieldValue;
