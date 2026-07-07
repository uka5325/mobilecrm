from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one exact match, found {count}\n--- old ---\n{old[:500]}")
    p.write_text(text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}\n--- pattern ---\n{pattern[:500]}")
    p.write_text(updated)


# Remove temporary passthrough introduced during the permission recovery attempt.
for temporary_path in ["middleware.ts", "app/api/reservations-consistent/route.ts"]:
    Path(temporary_path).unlink(missing_ok=True)

# ---------------------------------------------------------------------------
# Client API result handling + patient-candidate decision flow + strict update
# ---------------------------------------------------------------------------
reservations_lib = "lib/reservations.ts"
replace_once(
    reservations_lib,
    '''async function callReservationsApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false as const, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (!navigator.onLine) {
    return { success: false as const, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    if (!res.ok) {
      return { success: false as const, message: `서버 오류가 발생했습니다. (${res.status})` };
    }
    return res.json() as Promise<Record<string, unknown> & { success: boolean; message?: string }>;
  } catch {
    return { success: false as const, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}''',
    '''type ReservationsApiResult = Record<string, unknown> & {
  success: boolean;
  message?: string;
  code?: string;
};

async function callReservationsApi(action: string, payload: Record<string, unknown>): Promise<ReservationsApiResult> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (!navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string" ? body.message : `서버 오류가 발생했습니다. (${res.status})`,
      };
    }
    return body as ReservationsApiResult;
  } catch {
    return { success: false, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}'''
)

replace_once(
    reservations_lib,
    '''export type AppointmentType = "상담" | "수술" | "시술" | "치료" | "경과" | "진료" | "검진";

export const APPOINTMENT_TYPES''',
    '''export type AppointmentType = "상담" | "수술" | "시술" | "치료" | "경과" | "진료" | "검진";

export type PatientCandidate = {
  patientDocId: string;
  patientId: string;
  name: string;
  birth: string;
  phone: string;
  nationality: string;
};

type PatientCreateDecision = {
  confirmNewPatient?: boolean;
  linkToPatientId?: string;
};

function parsePatientCandidates(value: unknown): PatientCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const patientId = cleanText(item.patientId);
    if (!patientId) return [];
    return [{
      patientDocId: cleanText(item.patientDocId),
      patientId,
      name: cleanText(item.name),
      birth: cleanText(item.birth),
      phone: cleanText(item.phone),
      nationality: cleanText(item.nationality),
    }];
  });
}

function askPatientDecision(candidates: PatientCandidate[]): PatientCreateDecision | null {
  if (typeof window === "undefined" || candidates.length === 0) return null;
  const choices = candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.name || "이름 없음"} / ${candidate.birth || "생년월일 없음"} / ${candidate.phone || "연락처 없음"} / ${candidate.nationality || "국적 없음"}`
  ).join("\\n");
  const answer = window.prompt(
    `유사한 기존 환자가 발견되었습니다.\\n\\n${choices}\\n\\n연결할 환자 번호를 입력하세요. 새 환자로 등록하려면 N을 입력하세요.`,
    "1"
  );
  if (answer === null || !answer.trim()) return null;
  if (answer.trim().toLowerCase() === "n") return { confirmNewPatient: true };
  const selected = candidates[Number(answer.trim()) - 1];
  return selected ? { confirmNewPatient: true, linkToPatientId: selected.patientId } : null;
}

export const APPOINTMENT_TYPES'''
)

sub_once(
    reservations_lib,
    r'export async function createReservation\(.*?\n\}\n\nexport type PatientRecord',
    '''export async function createReservation(
  params: CreateReservationParams,
  staff: StaffUser,
  decision?: PatientCreateDecision
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  const hospital = cleanText(params.hospital);
  const doctors = Array.isArray(params.doctors)
    ? params.doctors.map(cleanText).filter(Boolean)
    : [];

  if (!name) return { success: false, message: "이름을 입력하세요." };
  if (!reservationDate) return { success: false, message: "예약날짜를 선택하세요." };

  const patientId = cleanText(params.patientId) || makeDateBasedId("P");
  const reservationId = cleanText(params.reservationId) || makeDateBasedId("R");
  const parsedBirth = parseBirthInfo(params.birthInput || params.birth || "", params.gender || "");

  const patientData = {
    patientId,
    name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
  };

  const reservationData = {
    reservationId,
    patientId,
    name,
    patientName: name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
    reservationDate,
    reservationTime: cleanText(params.reservationTime),
    hospital,
    appointmentType: (params.appointmentType || "상담") as AppointmentType,
    depositAmount: cleanText(params.depositAmount),
    surgeryCost: cleanText(params.surgeryCost),
    consultArea: cleanText(params.consultArea),
    doctors,
    coordinators: Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [],
    createdBy: staff.displayName,
    createdByUid: staff.uid,
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
    isDeleted: false,
  };

  const basePayload = { patient: patientData, reservation: reservationData };
  let apiResult = await callReservationsApi("create", { ...basePayload, ...(decision || {}) });

  if (apiResult.code === "PATIENT_CANDIDATES") {
    const candidates = parsePatientCandidates(apiResult.candidates);
    const selectedDecision = decision || askPatientDecision(candidates);
    if (!selectedDecision) {
      return {
        success: false,
        code: "PATIENT_CANDIDATES",
        candidates,
        message: "기존 환자 연결 또는 새 환자 등록을 선택해야 합니다.",
      };
    }
    apiResult = await callReservationsApi("create", { ...basePayload, ...selectedDecision });
  }

  if (!apiResult.success) {
    return {
      success: false,
      code: cleanText(apiResult.code),
      candidates: parsePatientCandidates(apiResult.candidates),
      message: apiResult.message || "예약 등록에 실패했습니다.",
    };
  }

  invalidatePatientsCache();
  invalidatePatientsSummaryCache();
  const savedReservationId = String(apiResult.reservationDocId || "");
  const savedPatientId = cleanText(apiResult.patientId || patientId);

  return {
    success: true,
    reservation: mapReservationDoc(savedReservationId, {
      ...reservationData,
      patientId: savedPatientId,
      createdAt: null,
      updatedAt: null,
    }),
  };
}

export type PatientRecord'''
)

sub_once(
    reservations_lib,
    r'export async function createPatientOnly\(.*?\n\}\n\n// 환자 목록 인메모리 캐시',
    '''export async function createPatientOnly(
  params: { name: string; birthInput: string; phone: string; nationality: string; patientId?: string },
  currentUser: StaffUser,
  decision?: PatientCreateDecision
): Promise<{ success: boolean; message?: string; patientDocId?: string; patientId?: string; code?: string; candidates?: PatientCandidate[] }> {
  const name = cleanText(params.name);
  if (!name) return { success: false, message: "이름을 입력하세요." };

  const patientId = cleanText(params.patientId) || makeDateBasedId("P");
  const parsed = parseBirthInfo(params.birthInput || "", "");
  const patient = {
    patientId,
    name,
    birth: parsed.birth,
    birthInput: parsed.birthInput,
    gender: parsed.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
    createdBy: currentUser.displayName,
    createdByUid: currentUser.uid,
    updatedBy: currentUser.displayName,
    updatedByUid: currentUser.uid,
  };

  const basePayload = { patient };
  let result = await callReservationsApi("create_patient", { ...basePayload, ...(decision || {}) });
  if (result.code === "PATIENT_CANDIDATES") {
    const candidates = parsePatientCandidates(result.candidates);
    const selectedDecision = decision || askPatientDecision(candidates);
    if (!selectedDecision) {
      return {
        success: false,
        code: "PATIENT_CANDIDATES",
        candidates,
        message: "기존 환자 연결 또는 새 환자 등록을 선택해야 합니다.",
      };
    }
    result = await callReservationsApi("create_patient", { ...basePayload, ...selectedDecision });
  }

  if (result.success) {
    invalidatePatientsCache();
    invalidatePatientsSummaryCache();
    return {
      success: true,
      patientDocId: String(result.patientDocId || ""),
      patientId: cleanText(result.patientId || patientId),
    };
  }
  return {
    success: false,
    code: cleanText(result.code),
    candidates: parsePatientCandidates(result.candidates),
    message: cleanText(result.message) || "등록 실패",
  };
}

// 환자 목록 인메모리 캐시'''
)

replace_once(
    reservations_lib,
    '''  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 수정에 실패했습니다." };
  }

  return { success: true };''',
    '''  if (!apiResult.success) {
    throw new Error(String(apiResult.message || "예약 수정에 실패했습니다."));
  }

  return { success: true };'''
)

# ---------------------------------------------------------------------------
# Reservation note client: preserve HTTP errors and reject failed mutations
# ---------------------------------------------------------------------------
notes_lib = "lib/reservationNotes.ts"
replace_once(
    notes_lib,
    '''async function callNotesApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return { success: false as const };
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/reservation-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
  return res.json() as Promise<Record<string, unknown> & { success: boolean; message?: string }>;
}''',
    '''async function callNotesApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return { success: false as const, message: "로그인이 필요합니다." };
  try {
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch("/api/reservation-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ...body,
        success: false as const,
        message: typeof body.message === "string" ? body.message : `서버 오류가 발생했습니다. (${res.status})`,
      };
    }
    return body as Record<string, unknown> & { success: boolean; message?: string };
  } catch {
    return { success: false as const, message: "네트워크 오류가 발생했습니다." };
  }
}'''
)
replace_once(notes_lib, '''  return result.success
    ? { success: true, id: String(result.id || "") }
    : { success: false, message: result.message || "저장 실패" };''', '''  if (!result.success) throw new Error(String(result.message || "메모 저장 실패"));
  return { success: true, id: String(result.id || "") };''')
replace_once(notes_lib, '''  return result.success ? { success: true } : { success: false, message: result.message || "수정 실패" };''', '''  if (!result.success) throw new Error(String(result.message || "메모 수정 실패"));
  return { success: true };''')
replace_once(notes_lib, '''  return result.success ? { success: true } : { success: false, message: result.message || "삭제 실패" };''', '''  if (!result.success) throw new Error(String(result.message || "메모 삭제 실패"));
  return { success: true };''')

# ---------------------------------------------------------------------------
# UI callers: explicitly inspect results and preserve input/edit state on fail
# ---------------------------------------------------------------------------
page = "app/reservations/page.tsx"
replace_once(
    page,
    '''      await updateReservationFull(
        item.id,
        item.reservationId,
        item.patientId,
        {''',
    '''      const result = await updateReservationFull(
        item.id,
        item.reservationId,
        item.patientId,
        {'''
)
replace_once(
    page,
    '''        currentUser
      );
      setInlineEditId(null);''',
    '''        currentUser
      );
      if (!result.success) {
        setPageError(result.message || "예약 수정에 실패했습니다.");
        return;
      }
      setInlineEditId(null);'''
)
replace_once(
    page,
    '''    await updateReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      memoText: editingNoteText,
      staff: currentUser,
    });
    setEditingNoteId(null);''',
    '''    try {
      const result = await updateReservationNote({
        noteId: note.id,
        reservationId: note.reservationId,
        patientId: note.patientId || memoPopover.item.patientId || "",
        memoText: editingNoteText,
        staff: currentUser,
      });
      if (!result.success) throw new Error(result.message || "메모 수정 실패");
    } catch (error) {
      const message = error instanceof Error ? error.message : "메모 수정 실패";
      setPageError(message);
      throw error;
    }
    setEditingNoteId(null);'''
)
replace_once(
    page,
    '''    await deleteReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      staff: currentUser,
    });
    const notes = await getReservationNotes''',
    '''    try {
      const result = await deleteReservationNote({
        noteId: note.id,
        reservationId: note.reservationId,
        patientId: note.patientId || memoPopover.item.patientId || "",
        staff: currentUser,
      });
      if (!result.success) throw new Error(result.message || "메모 삭제 실패");
    } catch (error) {
      const message = error instanceof Error ? error.message : "메모 삭제 실패";
      setPageError(message);
      throw error;
    }
    const notes = await getReservationNotes'''
)
replace_once(
    page,
    '''    await addReservationNote({
      reservationId: item.reservationId,
      reservationDocId: item.id,
      patientId: item.patientId || "",
      memoText: text,
      staff: currentUser,
    });
    const notes = await getReservationNotes''',
    '''    try {
      const result = await addReservationNote({
        reservationId: item.reservationId,
        reservationDocId: item.id,
        patientId: item.patientId || "",
        memoText: text,
        staff: currentUser,
      });
      if (!result.success) throw new Error(result.message || "메모 저장 실패");
    } catch (error) {
      const message = error instanceof Error ? error.message : "메모 저장 실패";
      setPageError(message);
      throw error;
    }
    const notes = await getReservationNotes'''
)

detail = "components/timeline/DetailDrawer.tsx"
sub_once(
    detail,
    r'  async function handleUpdateNote\(note: ReservationNote, newText: string\) \{.*?\n  \}\n\n  async function handleDeleteNote',
    '''  async function handleUpdateNote(note: ReservationNote, newText: string) {
    if (!selectedReservation) return;
    setMemoError("");
    try {
      const result = await updateReservationNote({
        noteId: note.id,
        reservationId: selectedReservation.reservationId,
        patientId: selectedReservation.patientId || "",
        memoText: newText,
        staff: currentUser,
      });
      if (!result.success) throw new Error(result.message || "메모 수정 실패");
      await loadNotes(selectedReservation);
      await loadLogs(selectedReservation);
      await onRefreshLatestLog(selectedReservation);
    } catch (error) {
      setMemoError(error instanceof Error ? error.message : "메모 수정 실패");
      throw error;
    }
  }

  async function handleDeleteNote'''
)
sub_once(
    detail,
    r'  async function handleDeleteNote\(note: ReservationNote\) \{.*?\n  \}\n\n\n  // Stable reference',
    '''  async function handleDeleteNote(note: ReservationNote) {
    if (!selectedReservation) return;
    if (!confirm("메모를 삭제할까요?")) return;
    setMemoError("");
    try {
      const result = await deleteReservationNote({
        noteId: note.id,
        reservationId: selectedReservation.reservationId,
        patientId: selectedReservation.patientId || "",
        staff: currentUser,
      });
      if (!result.success) throw new Error(result.message || "메모 삭제 실패");
      await loadNotes(selectedReservation);
      await loadLogs(selectedReservation);
      await onRefreshLatestLog(selectedReservation);
    } catch (error) {
      setMemoError(error instanceof Error ? error.message : "메모 삭제 실패");
      throw error;
    }
  }


  // Stable reference'''
)

memo_popover = "components/reservations/MemoPopover.tsx"
replace_once(memo_popover, '''  onUpdate: (note: ReservationNote) => void;
  onDelete: (note: ReservationNote) => void;''', '''  onUpdate: (note: ReservationNote) => Promise<void>;
  onDelete: (note: ReservationNote) => Promise<void>;''')
replace_once(memo_popover, '''  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);''', '''  const [adding, setAdding] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [page, setPage] = useState(1);''')
replace_once(memo_popover, '''    setAdding(true);
    try {
      await onAdd(newText.trim());
      setNewText("");
    } finally {
      setAdding(false);
    }
  }''', '''    setAdding(true);
    setMutationError("");
    try {
      await onAdd(newText.trim());
      setNewText("");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "메모 저장에 실패했습니다.");
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdate(note: ReservationNote) {
    setMutatingId(note.id);
    setMutationError("");
    try {
      await onUpdate(note);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "메모 수정에 실패했습니다.");
    } finally {
      setMutatingId(null);
    }
  }

  async function handleDelete(note: ReservationNote) {
    setMutatingId(note.id);
    setMutationError("");
    try {
      await onDelete(note);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "메모 삭제에 실패했습니다.");
    } finally {
      setMutatingId(null);
    }
  }''')
replace_once(memo_popover, '''          <button
            onClick={handleAdd}''', '''          {mutationError && (
            <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{mutationError}</div>
          )}
          <button
            onClick={handleAdd}''')
replace_once(memo_popover, '''                           <button onClick={() => onUpdate(note)} className="text-xs text-emerald-600 hover:underline">저장</button>''', '''                           <button disabled={mutatingId === note.id} onClick={() => handleUpdate(note)} className="text-xs text-emerald-600 hover:underline disabled:opacity-50">저장</button>''')
replace_once(memo_popover, '''                           <button onClick={() => onDelete(note)} className="text-xs text-red-400 hover:underline">삭제</button>''', '''                           <button disabled={mutatingId === note.id} onClick={() => handleDelete(note)} className="text-xs text-red-400 hover:underline disabled:opacity-50">삭제</button>''')

note_card = "components/timeline/NoteCard.tsx"
replace_once(note_card, '''  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.memoText);''', '''  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.memoText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");''')
replace_once(note_card, '''  async function handleSave() {
    await onUpdate(note, editText);
    setEditing(false);
  }''', '''  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onUpdate(note, editText);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "메모 수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError("");
    try {
      await onDelete(note);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "메모 삭제에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }''')
replace_once(note_card, '''            <button onClick={handleSave} className="font-semibold text-blue-600 hover:underline">
              저장
            </button>''', '''            <button disabled={saving} onClick={handleSave} className="font-semibold text-blue-600 hover:underline disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>''')
replace_once(note_card, '''            <button onClick={() => onDelete(note)} className="text-red-500 hover:underline">
              삭제
            </button>''', '''            <button disabled={saving} onClick={handleDelete} className="text-red-500 hover:underline disabled:opacity-50">
              삭제
            </button>''')
replace_once(note_card, '''      )}
    </div>''', '''      )}
      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
    </div>''')

# ---------------------------------------------------------------------------
# Notes API: each mutation and its audit log commit atomically in one batch
# ---------------------------------------------------------------------------
notes_api = "app/api/reservation-notes/route.ts"
replace_once(
    notes_api,
    '''      const ref = await adminDb.collection("reservationNotes").add({
        reservationId,
        reservationDocId,
        patientId,
        memoText: memoText.trim(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: staffName,
        createdByUid: staffUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
        isDeleted: false,
      });

      // Also write a log entry
      await adminDb.collection("logs").add({''',
    '''      const ref = adminDb.collection("reservationNotes").doc();
      const now = FieldValue.serverTimestamp();
      const batch = adminDb.batch();
      batch.set(ref, {
        reservationId,
        reservationDocId,
        patientId,
        memoText: memoText.trim(),
        createdAt: now,
        createdBy: staffName,
        createdByUid: staffUid,
        updatedAt: now,
        updatedBy: staffName,
        updatedByUid: staffUid,
        isDeleted: false,
      });

      batch.set(adminDb.collection("logs").doc(), {'''
)
replace_once(notes_api, '''        createdAt: FieldValue.serverTimestamp(),
      });

      // 고객관리 요약(메모 개수) 재계산 — best-effort''', '''        createdAt: now,
      });
      await batch.commit();

      // 고객관리 요약(메모 개수) 재계산 — best-effort''')
replace_once(
    notes_api,
    '''      await noteRef.update({
        memoText: memoText.trim(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await adminDb.collection("logs").add({''',
    '''      const now = FieldValue.serverTimestamp();
      const batch = adminDb.batch();
      batch.update(noteRef, {
        memoText: memoText.trim(),
        updatedAt: now,
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      batch.set(adminDb.collection("logs").doc(), {'''
)
replace_once(notes_api, '''        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ success: true });''', '''        createdAt: now,
      });
      await batch.commit();

      return NextResponse.json({ success: true });''')
replace_once(
    notes_api,
    '''      await noteRef.update({
        isDeleted: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await adminDb.collection("logs").add({''',
    '''      const now = FieldValue.serverTimestamp();
      const batch = adminDb.batch();
      batch.update(noteRef, {
        isDeleted: true,
        updatedAt: now,
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      batch.set(adminDb.collection("logs").doc(), {'''
)
# second occurrence is delete block, after update block was already replaced
replace_once(notes_api, '''        createdAt: FieldValue.serverTimestamp(),
      });

      // 고객관리 요약(메모 개수) 재계산 — note 문서의 patientId 우선(payload 폴백)''', '''        createdAt: now,
      });
      await batch.commit();

      // 고객관리 요약(메모 개수) 재계산 — note 문서의 patientId 우선(payload 폴백)''')

# ---------------------------------------------------------------------------
# Invoice API: include audit log in the same Firestore transaction
# ---------------------------------------------------------------------------
invoices_api = "app/api/invoices/route.ts"
replace_once(
    invoices_api,
    '''async function writeLog(params: {
  action: string; targetType: string; targetId: string;
  staffUid: string; staffName: string; staffEmail: string; staffRole: string; staffCode: string;
  patientId: string; reservationId: string; message: string;
  before?: unknown; after?: unknown;
}) {
  await adminDb.collection("logs").add({
    ...params,
    invoiceId: params.targetId,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}''',
    '''function buildInvoiceLog(params: {
  action: string; targetType: string; targetId: string;
  staffUid: string; staffName: string; staffEmail: string; staffRole: string; staffCode: string;
  patientId: string; reservationId: string; message: string;
  before?: unknown; after?: unknown;
}, now: FirebaseFirestore.FieldValue) {
  return {
    ...params,
    invoiceId: params.targetId,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: now,
  };
}'''
)
replace_once(
    invoices_api,
    '''        tx.update(reservationRef, {
          invoiceId,
          invoiceDocId: invoiceRef.id,
          invoiceStatus: "draft",
          invoiceUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        return { kind: "created" as const, invoiceDocId: invoiceRef.id };''',
    '''        tx.update(reservationRef, {
          invoiceId,
          invoiceDocId: invoiceRef.id,
          invoiceStatus: "draft",
          invoiceUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        tx.set(adminDb.collection("logs").doc(), buildInvoiceLog({
          action: "invoice_create", targetType: "invoice", targetId: invoiceRef.id,
          staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
          patientId: cleanText(reservation.patientId),
          reservationId: cleanText(reservation.reservationId),
          message: `${staffName}님이 인보이스를 생성했습니다.`,
          after: { invoiceId, invoiceDocId: invoiceRef.id },
        }, FieldValue.serverTimestamp()));
        return { kind: "created" as const, invoiceDocId: invoiceRef.id };'''
)
sub_once(
    invoices_api,
    r'\n      await writeLog\(\{\n        action: "invoice_create".*?\n      \}\);\n',
    '\n'
)
replace_once(
    invoices_api,
    '''        tx.update(
          adminDb.collection("reservations").doc(cleanText(current.reservationDocId)),
          {
            invoiceId: current.invoiceId,
            invoiceDocId: cleanText(invoiceDocId),
            invoiceStatus: patch.status,
            invoiceUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: staffName,
            updatedByUid: staffUid,
          }
        );
      });

      await writeLog({
        action: "invoice_update", targetType: "invoice", targetId: cleanText(current.invoiceId),
        staffUid: cleanText(staffUid), staffName: cleanText(staffName),
        staffEmail: cleanText(staffEmail), staffRole: cleanText(staffRole), staffCode: cleanText(staffCode),
        patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
        message: `${cleanText(staffName)}님이 인보이스를 수정했습니다.`,
        after: { invoiceId: current.invoiceId, totalAmount: patch.totalAmount, status: patch.status },
      });''',
    '''        tx.update(
          adminDb.collection("reservations").doc(cleanText(current.reservationDocId)),
          {
            invoiceId: current.invoiceId,
            invoiceDocId: cleanText(invoiceDocId),
            invoiceStatus: patch.status,
            invoiceUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: staffName,
            updatedByUid: staffUid,
          }
        );
        tx.set(adminDb.collection("logs").doc(), buildInvoiceLog({
          action: "invoice_update", targetType: "invoice", targetId: cleanText(current.invoiceId),
          staffUid: cleanText(staffUid), staffName: cleanText(staffName),
          staffEmail: cleanText(staffEmail), staffRole: cleanText(staffRole), staffCode: cleanText(staffCode),
          patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
          message: `${cleanText(staffName)}님이 인보이스를 수정했습니다.`,
          after: { invoiceId: current.invoiceId, totalAmount: patch.totalAmount, status: patch.status },
        }, FieldValue.serverTimestamp()));
      });'''
)
replace_once(
    invoices_api,
    '''        tx.update(linkedReservationRef, {
          invoiceId: "",
          invoiceDocId: "",
          invoiceStatus: "",
          invoiceUpdatedAt: now,
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
      });

      await writeLog({
        action: "invoice_delete", targetType: "invoice", targetId: cleanText(current.invoiceId),
        staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
        patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
        message: `${staffName}님이 인보이스를 삭제했습니다.`,
        before: { invoiceId: current.invoiceId },
      });''',
    '''        tx.update(linkedReservationRef, {
          invoiceId: "",
          invoiceDocId: "",
          invoiceStatus: "",
          invoiceUpdatedAt: now,
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        tx.set(adminDb.collection("logs").doc(), buildInvoiceLog({
          action: "invoice_delete", targetType: "invoice", targetId: cleanText(current.invoiceId),
          staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
          patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
          message: `${staffName}님이 인보이스를 삭제했습니다.`,
          before: { invoiceId: current.invoiceId },
        }, now));
      });'''
)

# ---------------------------------------------------------------------------
# Upload compensation: never hide failed cleanup, and cover helper path too
# ---------------------------------------------------------------------------
files_lib = "lib/reservationFiles.ts"
replace_once(
    files_lib,
    '''export async function deleteStorageFile(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // best-effort cleanup
  }
}''',
    '''export type StorageCleanupResult =
  | { deleted: true }
  | { deleted: false; errorCode: string };

export async function deleteStorageFile(storagePath: string): Promise<StorageCleanupResult> {
  try {
    await deleteObject(ref(storage, storagePath));
    return { deleted: true };
  } catch (error) {
    const code = (error as { code?: string })?.code || "unknown";
    if (code === "storage/object-not-found") return { deleted: true };
    return { deleted: false, errorCode: code };
  }
}'''
)
replace_once(
    files_lib,
    '''  const { storagePath } = await uploadPhotoToStorage(reservationDocId, file);
  return savePhotoRecord(reservationDocId, reservationId, patientId, file, storagePath, staff);''',
    '''  const { storagePath } = await uploadPhotoToStorage(reservationDocId, file);
  try {
    return await savePhotoRecord(reservationDocId, reservationId, patientId, file, storagePath, staff);
  } catch (error) {
    const cleanup = await deleteStorageFile(storagePath);
    if (!cleanup.deleted) {
      throw new Error(`사진 정보 저장과 원본 정리에 모두 실패했습니다. (cleanup=${cleanup.errorCode})`);
    }
    throw error;
  }'''
)

files_tab = "components/timeline/tabs/FilesTab.tsx"
replace_once(files_tab, '''import { compressImage } from "@/lib/imageCompress";''', '''import { compressImage } from "@/lib/imageCompress";
import { createLog } from "@/lib/logs";''')
replace_once(
    files_tab,
    '''            .catch(async () => {
              URL.revokeObjectURL(objectUrls[i]);
              await deleteStorageFile(storagePath);
              setPhotos((prev) => prev.filter((p) => p.id !== tempId));
              setError("사진 정보 저장에 실패했습니다. 다시 업로드해 주세요.");
            });''',
    '''            .catch(async () => {
              URL.revokeObjectURL(objectUrls[i]);
              const cleanup = await deleteStorageFile(storagePath);
              setPhotos((prev) => prev.filter((p) => p.id !== tempId));
              if (!cleanup.deleted) {
                await createLog({
                  action: "STORAGE_DELETE_FAILED",
                  targetType: "file",
                  targetId: reservationDocId,
                  staff: currentUser,
                  message: `사진 저장 실패 후 Storage 보상 삭제 실패 (code=${cleanup.errorCode})`,
                  reservationId,
                  patientId,
                }).catch(() => {});
                setError(`사진 정보 저장에 실패했고 업로드 원본 정리도 실패했습니다. 관리자에게 알려주세요. (${cleanup.errorCode})`);
                return;
              }
              setError("사진 정보 저장에 실패해 업로드 원본을 정리했습니다. 다시 업로드해 주세요.");
            });'''
)

# ---------------------------------------------------------------------------
# Stop heuristic auto-merge on both create and create_patient, fix lock identity
# ---------------------------------------------------------------------------
route = "app/api/reservations/route.ts"
sub_once(
    route,
    r'function dedupByIdentity\(rows: unknown\[\]\): unknown\[\] \{.*?\n\}',
    '''function dedupByIdentity(rows: unknown[]): unknown[] {
  // identityKey는 후보 탐색용이지 유일키가 아니다. 사용자가 새 환자를 선택한 동명이인을 숨기지 않는다.
  return rows;
}'''
)

replace_once(
    route,
    '''      const { patient } = payload as { patient: Record<string, unknown> };''',
    '''      const { patient, confirmNewPatient, linkToPatientId } = payload as {
        patient: Record<string, unknown>;
        confirmNewPatient?: boolean;
        linkToPatientId?: string;
      };'''
)
replace_once(
    route,
    '''      // 신원(이름+생년월일+국적+성별) 기반 중복 방지: 같은 사람이 서로 다른 랜덤 patientId로
      // 여러 문서로 저장되던 문제를 막는다. 신원 일치 활성 환자가 있으면 그 문서로 연결한다.
      const identityKey = identityKeyForPatient(safePatient);
      if (identityKey) {
        const existingByIdentity = await adminDb
          .collection("patients")
          .where("identityKey", "==", identityKey)
          .where("isDeleted", "==", false)
          .limit(1)
          .get();
        if (!existingByIdentity.empty) {
          const doc = existingByIdentity.docs[0];
          return NextResponse.json({
            success: true,
            patientDocId: doc.id,
            patientId: String(doc.data().patientId || ""),
            linkedExistingPatient: true,
          });
        }
      }''',
    '''      // identityKey는 자동 병합 근거가 아니라 직원 확인용 후보 검색에만 쓴다.
      const identityKey = identityKeyForPatient(safePatient);
      if (linkToPatientId) {
        const linked = await adminDb.collection("patients")
          .where("patientId", "==", String(linkToPatientId))
          .where("isDeleted", "==", false)
          .limit(1)
          .get();
        if (linked.empty) {
          return NextResponse.json({ success: false, code: "PATIENT_NOT_FOUND", message: "선택한 기존 환자를 찾을 수 없습니다." }, { status: 400 });
        }
        const doc = linked.docs[0];
        return NextResponse.json({
          success: true,
          patientDocId: doc.id,
          patientId: String(doc.data().patientId || ""),
          linkedExistingPatient: true,
        });
      }
      if (identityKey && confirmNewPatient !== true) {
        const existingByIdentity = await adminDb.collection("patients")
          .where("identityKey", "==", identityKey)
          .where("isDeleted", "==", false)
          .limit(5)
          .get();
        if (!existingByIdentity.empty) {
          const candidates = existingByIdentity.docs.map((doc) => {
            const data = doc.data() as Record<string, unknown>;
            return {
              patientDocId: doc.id,
              patientId: String(data.patientId || ""),
              name: String(data.name || ""),
              birth: String(data.birth || ""),
              phone: String(data.phone || "").replace(/(.{3}).+(.{4})$/, "$1****$2"),
              nationality: String(data.nationality || ""),
            };
          });
          return NextResponse.json({
            success: false,
            code: "PATIENT_CANDIDATES",
            message: "유사한 기존 환자가 발견되었습니다. 기존 환자에 연결하거나 새 환자로 등록해 주세요.",
            candidates,
          }, { status: 409 });
        }
      }'''
)

replace_once(
    route,
    '''      const dupResId = String(safeReservation.reservationId || "");
      // 중복 방지 lock — 이름/날짜/시간/전화/병원/유형/원장 조합의 sha256을 문서 ID로 쓴다.
      // (공통 helper lib/reservationLocks.ts — create/update/cancel/delete/스크립트가 동일 규칙 사용)
      const lockId = lockIdForReservation(safeReservation);
      const lockRef = lockId ? adminDb.collection(RESERVATION_LOCKS).doc(lockId) : null;
''',
    '''      const dupResId = String(safeReservation.reservationId || "");
      // canonical patientId 확정 후 계산한 lockId를 로그와 응답에 사용한다.
      let committedLockId = "";
'''
)
sub_once(
    route,
    r'          if \(lockRef\) \{\n            const lockSnap = await tx\.get\(lockRef\);.*?\n          \}\n          // 기존 환자에 예약 추가',
    '''          // 기존 환자에 예약 추가'''
)
replace_once(
    route,
    '''          // 기존 환자로 연결되면 예약의 patientId도 대표 값으로 맞춘다(랜덤 값 폐기 → 이력/요약 정합).
          if (canonicalPatientId) safeReservation.patientId = canonicalPatientId;

          // ── 쓰기(원자적) ──────────────────────────────────────────────
          if (lockRef) tx.set(lockRef, buildLockDoc({
            reservationDocId: reservationRef.id,
            reservationId: dupResId,
            patientId: incomingPatientId,
            lockId: lockId,
            now,
          }));''',
    '''          // 기존 환자로 연결되면 예약의 patientId도 대표 값으로 맞춘다(랜덤 값 폐기 → 이력/요약 정합).
          if (canonicalPatientId) safeReservation.patientId = canonicalPatientId;

          // canonical patientId가 확정된 데이터로 lock을 읽고 검증한다.
          const effectiveLockId = lockIdForReservation(safeReservation);
          const effectiveLockRef = effectiveLockId
            ? adminDb.collection(RESERVATION_LOCKS).doc(effectiveLockId)
            : null;
          if (effectiveLockRef) {
            const lockSnap = await tx.get(effectiveLockRef);
            if (lockSnap.exists) {
              const targetDocId = String(lockSnap.data()?.reservationDocId || "");
              let targetData: Record<string, unknown> | null = null;
              if (targetDocId) {
                const targetSnap = await tx.get(adminDb.collection("reservations").doc(targetDocId));
                targetData = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;
              }
              if (!isLockStale(effectiveLockId, targetData)) throw new DuplicateReservationError();
              staleLockRepaired = true;
            }
          }
          committedLockId = effectiveLockId;

          // ── 쓰기(원자적) ──────────────────────────────────────────────
          if (effectiveLockRef) tx.set(effectiveLockRef, buildLockDoc({
            reservationDocId: reservationRef.id,
            reservationId: dupResId,
            patientId: String(safeReservation.patientId || ""),
            lockId: effectiveLockId,
            now,
          }));'''
)
replace_once(route, '''          after: { lockId, reservationDocId: reservationRef.id },''', '''          after: { lockId: committedLockId, reservationDocId: reservationRef.id },''')
replace_once(
    route,
    '''        patientDocId: resultPatientDocId,
        reservationDocId: reservationRef.id,
        ...(linkedExistingPatient ? { linkedExistingPatient: true } : {}),''',
    '''        patientDocId: resultPatientDocId,
        patientId: String(safeReservation.patientId || ""),
        reservationDocId: reservationRef.id,
        ...(linkedExistingPatient ? { linkedExistingPatient: true } : {}),'''
)

# ---------------------------------------------------------------------------
# Regression tests: candidates require explicit decision for both flows
# ---------------------------------------------------------------------------
tests = "tests/api/reservations.test.ts"
sub_once(
    tests,
    r'test\("create: patientId가 달라도 이름\+생년월일\+국적\+성별이 같으면 같은 환자로 연결된다".*?\n\}\);\n\ntest\("create: 성별이 다르면',
    '''test("create: 동일 신원 후보는 자동 병합하지 않고 선택한 기존 환자에 연결한다", async () => {
  __resetStaffCacheForTests();
  const name = `신원중복${Date.now()}`;
  const identity = { name, birth: "19910531", nationality: "몽골", gender: "여" };
  const pidA = `P-IDENT-A-${Date.now()}`;
  const first = await POST(makeReq(staff.idToken, "create", {
    patient: { ...identity, patientId: pidA },
    reservation: { ...identity, patientId: pidA, reservationId: `R-IDENT1-${Date.now()}`, reservationDate: "2026-08-01", doctors: [], isDeleted: false },
  }));
  const b1 = await first.json();
  assert.equal(b1.success, true);
  createdReservationDocIds.push(b1.reservationDocId);
  createdPatientDocIds.push(b1.patientDocId);

  const pidB = `P-IDENT-B-${Date.now()}`;
  const secondPayload = {
    patient: { ...identity, patientId: pidB },
    reservation: { ...identity, patientId: pidB, reservationId: `R-IDENT2-${Date.now()}`, reservationDate: "2026-08-02", doctors: [], isDeleted: false },
  };
  const candidatesRes = await POST(makeReq(staff.idToken, "create", secondPayload));
  assert.equal(candidatesRes.status, 409);
  const candidatesBody = await candidatesRes.json();
  assert.equal(candidatesBody.code, "PATIENT_CANDIDATES");
  assert.ok(candidatesBody.candidates.some((candidate: Record<string, unknown>) => candidate.patientId === pidA));

  const linkedRes = await POST(makeReq(staff.idToken, "create", {
    ...secondPayload,
    confirmNewPatient: true,
    linkToPatientId: pidA,
  }));
  const linkedBody = await linkedRes.json();
  assert.equal(linkedBody.success, true);
  assert.equal(linkedBody.linkedExistingPatient, true);
  assert.equal(linkedBody.patientId, pidA);
  createdReservationDocIds.push(linkedBody.reservationDocId);

  const res2 = await adminDb.collection("reservations").doc(linkedBody.reservationDocId).get();
  assert.equal(res2.data()?.patientId, pidA);
  const canonicalLockId = lockIdForReservation(res2.data() as Record<string, unknown>);
  assert.equal((await adminDb.collection(RESERVATION_LOCKS).doc(canonicalLockId).get()).data()?.reservationDocId, linkedBody.reservationDocId);
});

test("create: 성별이 다르면'''
)
sub_once(
    tests,
    r'test\("create_patient: 이름\+생년월일\+국적\+성별이 같으면 기존 환자로 연결된다".*?\n\}\);\n\ntest\("update 필드 보존',
    '''test("create_patient: 동일 신원 후보는 명시적 선택 전까지 자동 연결하지 않는다", async () => {
  __resetStaffCacheForTests();
  const name = `단독신원${Date.now()}`;
  const identity = { name, birth: "20000829", nationality: "몽골", gender: "여" };
  const pidA = `P-CP-A-${Date.now()}`;
  const first = await POST(makeReq(staff.idToken, "create_patient", { patient: { ...identity, patientId: pidA } }));
  const b1 = await first.json();
  assert.equal(b1.success, true);
  createdPatientDocIds.push(b1.patientDocId);

  const candidate = await POST(makeReq(staff.idToken, "create_patient", {
    patient: { ...identity, patientId: `P-CP-B-${Date.now()}` },
  }));
  assert.equal(candidate.status, 409);
  assert.equal((await candidate.json()).code, "PATIENT_CANDIDATES");

  const linked = await POST(makeReq(staff.idToken, "create_patient", {
    patient: { ...identity, patientId: `P-CP-C-${Date.now()}` },
    linkToPatientId: pidA,
  }));
  const linkedBody = await linked.json();
  assert.equal(linkedBody.success, true);
  assert.equal(linkedBody.linkedExistingPatient, true);
  assert.equal(linkedBody.patientId, pidA);
});

test("update 필드 보존'''
)

print("first-wave patch applied")
