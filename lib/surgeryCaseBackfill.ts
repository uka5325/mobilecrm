export function isAutomaticSurgeryCaseCandidate(reservation: Record<string, unknown>) {
  if (reservation.cancelled === true) return false;

  const appointmentType = String(reservation.appointmentType ?? "").trim();
  return appointmentType === "상담" || appointmentType === "수술";
}
