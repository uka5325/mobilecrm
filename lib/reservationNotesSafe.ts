import * as base from "./reservationNotes";

export * from "./reservationNotes";

export async function addReservationNote(
  params: Parameters<typeof base.addReservationNote>[0]
) {
  const result = await base.addReservationNote(params);
  if (!result.success) throw new Error(result.message || "메모 저장에 실패했습니다.");
  return result;
}

export async function updateReservationNote(
  params: Parameters<typeof base.updateReservationNote>[0]
) {
  const result = await base.updateReservationNote(params);
  if (!result.success) throw new Error(result.message || "메모 수정에 실패했습니다.");
  return result;
}

export async function deleteReservationNote(
  params: Parameters<typeof base.deleteReservationNote>[0]
) {
  const result = await base.deleteReservationNote(params);
  if (!result.success) throw new Error(result.message || "메모 삭제에 실패했습니다.");
  return result;
}
