// 생년월일 파싱 공통 유틸. (Firebase/Next 의존 없음 → 단위 테스트 가능)
//
// 여러 feature(reservations, invoices)가 공유하는 프리미티브라 lib에 둔다.
// 저장 표준은 `lib/patientIdentity.ts`가 명시하는 birth = YYYYMMDD 이다.
//   - birth        : "19891210"   (신원 키/조회에 쓰는 표준값)
//   - birthDisplay : "1989.12.10" (화면 표시용)
// 파싱에 실패하면 원본을 보존한다(정보를 유실하지 않는다).

export type ParsedBirthInfo = {
  birth: string;
  birthInput: string;
  birthDisplay: string;
  ageText: string;
  gender: string;
};

function cleanDigits(value: string) {
  return String(value || "").replace(/[^0-9]/g, "");
}

export function parseBirthInfo(
  rawValue: string,
  rawGender?: string
): ParsedBirthInfo {
  const raw = String(rawValue || "").trim();
  const digits = cleanDigits(raw);
  const genderSource = String(rawGender || "").trim().toLowerCase();

  let year = "";
  let mm = "";
  let dd = "";
  let gender = "";

  // 891210-1 형식
  if (/^\d{6}-[1-4]$/.test(raw)) {
    const yy = raw.substring(0, 2);
    mm = raw.substring(2, 4);
    dd = raw.substring(4, 6);

    const code = raw.substring(7, 8);

    year = code === "1" || code === "2" ? "19" + yy : "20" + yy;
    gender = code === "1" || code === "3" ? "남" : "여";
  }

  // 8912101 형식
  else if (/^\d{7}$/.test(digits)) {
    const yy = digits.substring(0, 2);
    mm = digits.substring(2, 4);
    dd = digits.substring(4, 6);

    const code = digits.substring(6, 7);

    year = code === "1" || code === "2" ? "19" + yy : "20" + yy;
    gender = code === "1" || code === "3" ? "남" : "여";
  }

  // 19891210 또는 19891210-1 / 198912101 형식
  else if (digits.length >= 8) {
    year = digits.substring(0, 4);
    mm = digits.substring(4, 6);
    dd = digits.substring(6, 8);

    const code = digits.length >= 9 ? digits.substring(8, 9) : "";

    if (code === "1" || code === "3") gender = "남";
    if (code === "2" || code === "4") gender = "여";
  }

  if (!gender) {
    if (rawGender?.includes("남") || genderSource === "male" || genderSource === "m") {
      gender = "남";
    }

    if (rawGender?.includes("여") || genderSource === "female" || genderSource === "f") {
      gender = "여";
    }
  }

  if (!year || !mm || !dd) {
    return {
      birth: raw,
      birthInput: raw,
      birthDisplay: raw,
      ageText: "",
      gender,
    };
  }

  const birth = `${year}${mm}${dd}`;
  const birthDisplay = `${year}.${mm}.${dd}`;

  const now = new Date();
  let age = now.getFullYear() - Number(year);

  const birthdayThisYear = new Date(
    now.getFullYear(),
    Number(mm) - 1,
    Number(dd)
  );

  if (now < birthdayThisYear) {
    age -= 1;
  }

  return {
    birth,
    birthInput: raw,
    birthDisplay,
    ageText: `만 ${age}세`,
    gender,
  };
}

export function formatBirthDisplay(value: string) {
  const digits = cleanDigits(value);

  if (/^\d{8}$/.test(digits)) {
    return `${digits.substring(0, 4)}.${digits.substring(4, 6)}.${digits.substring(6, 8)}`;
  }

  return value || "";
}
