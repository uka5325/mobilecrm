import { deleteObject, ref } from "firebase/storage";
import { auth, storage } from "./firebase";

export * from "./reservationFiles";

const LOCAL_CLEANUP_KEY = "crm_pending_storage_cleanup";

function rememberLocalCleanup(storagePath: string) {
  if (typeof window === "undefined") return;
  try {
    const previous = JSON.parse(localStorage.getItem(LOCAL_CLEANUP_KEY) || "[]") as Array<{
      storagePath: string;
      createdAt: number;
    }>;
    const next = [
      ...previous.filter((item) => item.storagePath !== storagePath),
      { storagePath, createdAt: Date.now() },
    ].slice(-50);
    localStorage.setItem(LOCAL_CLEANUP_KEY, JSON.stringify(next));
  } catch {
    // localStorage가 막혀 있어도 사용자 경고는 아래에서 계속 표시한다.
  }
}

async function requestServerCleanup(storagePath: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/storage-cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, storagePath }),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return body.success === true && (body.deleted === true || body.queued === true);
  } catch {
    return false;
  }
}

// 사진 메타데이터 저장 실패 후 호출되는 보상 삭제 경로.
// 1) 클라이언트 Storage 삭제
// 2) 실패 시 서버 관리자 권한으로 재시도
// 3) 서버도 즉시 삭제하지 못하면 storageCleanupJobs에 pending job 기록
// 4) 서버 호출 자체도 실패하면 로컬 대기열과 명시적 경고를 남긴다.
export async function deleteStorageFile(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
    return;
  } catch (error) {
    const code = (error as { code?: string })?.code || "";
    if (code === "storage/object-not-found") return;
  }

  if (await requestServerCleanup(storagePath)) return;

  rememberLocalCleanup(storagePath);
  if (typeof window !== "undefined") {
    window.alert(
      "사진 정보 저장에 실패했고 원본 파일 자동 정리도 완료되지 않았습니다. 관리자에게 알려주세요."
    );
  }
}
