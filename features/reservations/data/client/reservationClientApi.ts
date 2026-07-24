import { auth } from "@/lib/firebase";
import type {
  ReservationApiAction,
  ReservationApiPayload,
  ReservationApiRequest,
  ReservationApiResult,
} from "@/lib/reservationApiContracts";

// /api/reservations 공통 호출 래퍼 — 인증/오프라인/HTTP 오류를 표준 ApiResult로 정규화한다.
export async function callReservationsApi<A extends ReservationApiAction>(
  action: A,
  payload: ReservationApiPayload<A>
): Promise<ReservationApiResult<A>> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const request: ReservationApiRequest<A> = { idToken, action, payload };
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await res.json().catch(() => ({})) as ReservationApiResult<A>;
    if (!res.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${res.status})`,
      };
    }
    return body;
  } catch {
    return { success: false, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}
