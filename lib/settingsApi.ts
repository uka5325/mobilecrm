import { auth } from "./firebase";

export async function callSettingsApi(action: string, payload: Record<string, unknown> = {}) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error("로그인 상태를 확인할 수 없습니다.");
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
  const data = await res.json() as Record<string, unknown> & { success: boolean; message?: string };
  if (!data.success) throw new Error(data.message || "API 요청에 실패했습니다.");
  return data;
}
