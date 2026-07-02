import { NextResponse } from "next/server";
import { adminAuth, adminDb, adminInitialized } from "@/lib/firebaseAdmin";

// ─────────────────────────────────────────────────────────────────────────────
// 공통 API 인증/인가 가드
//
// 배경: 모든 데이터 API는 firebase-admin SDK를 사용하므로 Firestore 보안 규칙을
// 우회한다. 따라서 "Firebase 로그인 여부(verifyIdToken)"만으로는 부족하고,
// staff 컬렉션에 등록된 active 직원인지 서버에서 직접 검증해야 한다.
//
// 성능: uid별 검증 결과를 5분 메모리 캐시 (반복 Firestore 읽기 비용 절감).
// 보안: checkRevoked로 토큰 폐기(퇴사/비활성화) 즉시 반영 옵션 지원.
// ─────────────────────────────────────────────────────────────────────────────

export type StaffContext = {
  uid: string;
  role: string;
  name: string;
  email: string;
  staffCode: string;
  active: boolean;
};

type CacheEntry = StaffContext & { at: number };
const _staffCache = new Map<string, CacheEntry>();
const STAFF_CACHE_TTL = 5 * 60 * 1000;

// 테스트 전용: 케이스 간 staff 캐시 오염을 막기 위한 리셋 헬퍼.
// 프로덕션 코드 경로에서는 호출되지 않는다.
export function __resetStaffCacheForTests() {
  _staffCache.clear();
}

async function lookupStaff(uid: string, email: string): Promise<StaffContext> {
  // uid 필드 우선 → 문서 ID fallback (기존 라우트들과 동일한 조회 규칙 유지)
  let data: FirebaseFirestore.DocumentData | null = null;

  const snap = await adminDb.collection("staff").where("uid", "==", uid).limit(1).get();
  if (!snap.empty) {
    data = snap.docs[0].data();
  } else {
    const byId = await adminDb.collection("staff").doc(uid).get();
    if (byId.exists) data = byId.data() ?? null;
  }

  if (!data) {
    return { uid, role: "", name: "", email, staffCode: "", active: false };
  }

  return {
    uid,
    role: String(data.role || ""),
    name: String(data.displayName || ""),
    email: String(data.email || email || ""),
    staffCode: String(data.staffCode || ""),
    active: data.active === true,
  };
}

export class ApiAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * idToken을 검증하고 active 직원인지 확인한 뒤 StaffContext를 반환한다.
 * 실패 시 ApiAuthError를 throw (호출부에서 toAuthErrorResponse로 변환).
 *
 * @param idToken 클라이언트가 보낸 Firebase ID 토큰
 * @param opts.checkRevoked 토큰 폐기 검사 (쓰기/삭제 등 민감 작업에 권장)
 */
export async function requireActiveStaff(
  idToken: string | undefined,
  opts: { checkRevoked?: boolean } = {}
): Promise<StaffContext> {
  if (!adminInitialized) {
    throw new ApiAuthError(503, "서버가 초기화되지 않았습니다. 관리자에게 문의하세요.");
  }
  if (!idToken) {
    throw new ApiAuthError(401, "인증 토큰이 없습니다.");
  }

  let uid: string;
  let email = "";
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, opts.checkRevoked === true);
    uid = decoded.uid;
    email = decoded.email || "";
  } catch {
    throw new ApiAuthError(401, "인증이 유효하지 않습니다.");
  }

  const cached = _staffCache.get(uid);
  let ctx: StaffContext;
  // 쓰기/민감 작업(checkRevoked)은 staff 캐시를 우회해 fresh lookup → active/role 변경을 즉시 반영.
  // (읽기 전용 요청만 최대 5분 캐시. 비활성화된 직원의 쓰기가 최대 5분 열리던 창을 닫는다.)
  if (!opts.checkRevoked && cached && Date.now() - cached.at < STAFF_CACHE_TTL) {
    ctx = cached;
  } else {
    ctx = await lookupStaff(uid, email);
    _staffCache.set(uid, { ...ctx, at: Date.now() });
  }

  if (!ctx.active) {
    throw new ApiAuthError(403, "권한이 없습니다.");
  }
  return ctx;
}

/** ApiAuthError를 NextResponse로 변환. 그 외 에러는 null 반환(호출부에서 500 처리). */
export function toAuthErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof ApiAuthError) {
    return NextResponse.json({ success: false, message: e.message }, { status: e.status });
  }
  return null;
}
