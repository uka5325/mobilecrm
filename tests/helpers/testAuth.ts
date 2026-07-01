/**
 * API 라우트 테스트용 인증 헬퍼.
 *
 * Firebase Auth 에뮬레이터(firebase.json의 emulators.auth, 기본 127.0.0.1:9099)에
 * REST API로 직접 가입 요청을 보내 실제 idToken을 발급받는다. adminAuth.verifyIdToken을
 * 목(mock)하지 않고 진짜 토큰 검증 경로를 그대로 태우기 위함 — lib/apiAuth.ts의
 * requireActiveStaff를 손대지 않고도 신뢰도 높은 테스트가 가능하다.
 *
 * 사용 전 반드시 FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST 환경변수가
 * 설정되어 있어야 한다(firebase emulators:exec가 자동으로 주입).
 */

const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

export type TestUser = { uid: string; idToken: string; email: string };

let counter = 0;

/** Auth 에뮬레이터에 신규 사용자를 만들고 idToken을 반환한다. */
export async function createTestUser(emailPrefix = "user"): Promise<TestUser> {
  counter += 1;
  const email = `${emailPrefix}${Date.now()}_${counter}@example.com`;
  const password = "test-password-123";

  const res = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );

  if (!res.ok) {
    throw new Error(`[testAuth] Auth 에뮬레이터 회원가입 실패: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { localId: string; idToken: string };
  return { uid: data.localId, idToken: data.idToken, email };
}

export function bearer(idToken: string): string {
  return `Bearer ${idToken}`;
}
