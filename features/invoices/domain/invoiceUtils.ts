// 인보이스 관련 순수 유틸. (Firebase/Next 의존 없음 → 단위 테스트 가능)

export type BirthInfo = { birth: string; birthDisplay: string; gender: string };

/**
 * 주민번호/생년월일 문자열을 표준 birth(YYYY-MM-DD)·표시값·성별로 파싱.
 * 지원 형식:
 *   - "900101-1" (앞 6자리 + 성별코드)
 *   - "9001011" (7자리)
 *   - "19900101" 이상 (8자리+, 9번째 자리가 성별코드면 사용)
 */
export function parseBirthInfo(rawValue: string, rawGender?: string): BirthInfo {
  const raw = String(rawValue || "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  let year = "", mm2 = "", dd2 = "", gender = "";

  if (/^\d{6}-[1-4]$/.test(raw)) {
    year = (raw[7] === "1" || raw[7] === "2") ? "19" + raw.slice(0, 2) : "20" + raw.slice(0, 2);
    mm2 = raw.slice(2, 4);
    dd2 = raw.slice(4, 6);
    gender = (raw[7] === "1" || raw[7] === "3") ? "남" : "여";
  } else if (/^\d{7}$/.test(digits)) {
    year = (digits[6] === "1" || digits[6] === "2") ? "19" + digits.slice(0, 2) : "20" + digits.slice(0, 2);
    mm2 = digits.slice(2, 4);
    dd2 = digits.slice(4, 6);
    gender = (digits[6] === "1" || digits[6] === "3") ? "남" : "여";
  } else if (digits.length >= 8) {
    year = digits.slice(0, 4);
    mm2 = digits.slice(4, 6);
    dd2 = digits.slice(6, 8);
    const code = digits.length >= 9 ? digits[8] : "";
    if (code === "1" || code === "3") gender = "남";
    if (code === "2" || code === "4") gender = "여";
  }

  if (!gender && rawGender) gender = rawGender;
  const birth = year && mm2 && dd2 ? `${year}-${mm2}-${dd2}` : "";
  const birthDisplay = year && mm2 && dd2 ? `${year.slice(2)}${mm2}${dd2}` : "";
  return { birth, birthDisplay, gender };
}
