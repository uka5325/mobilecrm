import { parseBirthInfo } from "@/lib/birthUtils";

// 예약 문서 모양({birth, birthInput, gender})에 특화된 래퍼.
// 공통 파싱 로직은 @/lib/birthUtils 에 있다.
export function getReservationBirthInfo(item: {
  birth?: string;
  birthInput?: string;
  gender?: string;
}) {
  const raw = item.birthInput || item.birth || "";
  return parseBirthInfo(raw, item.gender);
}
