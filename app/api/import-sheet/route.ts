import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { todayString } from "@/lib/dateUtils";
import { cleanText } from "@/lib/stringUtils";

type ImportPayload = {
  name: string;
  birthInput: string;
  birth: string;
  phone: string;
  nationality: string;
  consultArea: string;
  reservationDate: string;
  reservationTime: string;
  doctors: string[];
  coordinators: string[];
  depositAmount: string;
};

function extractSheetId(url: string) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : "";
}

function extractGid(url: string) {
  const match = url.match(/[?&#]gid=([0-9]+)/);
  return match ? match[1] : "0";
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;

      row.push(cell);
      cell = "";

      if (row.some((v) => String(v).trim() !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((v) => String(v).trim() !== "")) {
    rows.push(row);
  }

  return rows;
}


function normalizeHeader(value: unknown) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "");
}

function findCol(headers: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/\s+/g, "");
    const index = headers.findIndex((header) => header.includes(key));
    if (index > -1) return index;
  }

  return -1;
}

function normalizeDate(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";

  const digits = raw.replace(/[^0-9]/g, "");

  if (/^\d{8}$/.test(digits)) {
    return `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`;
  }

  if (/^\d{6}$/.test(digits)) {
    const yy = Number(digits.substring(0, 2));
    const yyyy = yy >= 50 ? `19${digits.substring(0, 2)}` : `20${digits.substring(0, 2)}`;
    return `${yyyy}-${digits.substring(2, 4)}-${digits.substring(4, 6)}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }

  return raw;
}

function normalizeTime(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";

  const hm = raw.match(/(\d{1,2})[:시]\s*(\d{1,2})?/);
  if (hm) {
    const hh = String(Number(hm[1])).padStart(2, "0");
    const mm = String(Number(hm[2] || 0)).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const digits = raw.replace(/[^0-9]/g, "");

  if (/^\d{4}$/.test(digits)) {
    return `${digits.substring(0, 2)}:${digits.substring(2, 4)}`;
  }

  if (/^\d{3}$/.test(digits)) {
    return `0${digits.substring(0, 1)}:${digits.substring(1, 3)}`;
  }

  return raw;
}

function getCell(row: string[], index: number) {
  if (index < 0) return "";
  return cleanText(row[index]);
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  try {
    await requireActiveStaff(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
  } catch (authErr) {
    const res = toAuthErrorResponse(authErr);
    if (res) return res;
    throw authErr;
  }

  try {
    const body = await req.json();
    const url = cleanText(body.url);

    if (!url) {
      return NextResponse.json(
        { success: false, message: "구글시트 URL을 입력하세요." },
        { status: 400 }
      );
    }

    const sheetId = extractSheetId(url);
    const gid = extractGid(url);

    if (!sheetId) {
      return NextResponse.json(
        { success: false, message: "유효한 구글시트 URL이 아닙니다." },
        { status: 400 }
      );
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    const response = await fetch(csvUrl, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            "구글시트를 불러오지 못했습니다. 시트 공유 권한을 '링크가 있는 모든 사용자 보기 가능'으로 설정했는지 확인하세요.",
        },
        { status: 400 }
      );
    }

    const csvText = await response.text();

    if (
      csvText.includes("<!DOCTYPE html") ||
      csvText.includes("<html") ||
      csvText.includes("ServiceLogin")
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "구글시트 접근 권한이 없습니다. 링크 공유 설정을 확인하세요.",
        },
        { status: 400 }
      );
    }

    const rows = parseCsv(csvText);

    if (rows.length < 2) {
      return NextResponse.json(
        { success: false, message: "가져올 데이터가 없습니다." },
        { status: 400 }
      );
    }

    const headers = rows[0].map(normalizeHeader);

    const colMap = {
      name: findCol(headers, ["이름", "name", "성함", "고객명", "환자명"]),
      birth: findCol(headers, ["생년월일", "birth", "birthday", "주민", "생일"]),
      phone: findCol(headers, ["연락처", "phone", "전화", "휴대폰", "번호"]),
      nationality: findCol(headers, ["국적", "nationality", "country", "국가"]),
      consultArea: findCol(headers, ["상담부위", "consult", "상담", "부위", "시술", "수술"]),
      date: findCol(headers, ["예약날짜", "날짜", "date", "reservationdate"]),
      time: findCol(headers, ["예약시간", "시간", "time", "reservationtime"]),
      doctor: findCol(headers, ["원장", "doctor", "지정원장", "의사"]),
      coordinator: findCol(headers, ["실장", "coordinator", "담당", "상담실장"]),
      deposit: findCol(headers, ["예약금", "deposit", "금액"]),
    };

    if (colMap.name === -1) {
      return NextResponse.json(
        { success: false, message: '"이름" 컬럼을 찾을 수 없습니다.' },
        { status: 400 }
      );
    }

    const payloads: ImportPayload[] = rows
      .slice(1)
      .map((row) => {
        const name = getCell(row, colMap.name);
        const doctorValue = getCell(row, colMap.doctor);
        const coordinatorValue = getCell(row, colMap.coordinator);

        return {
          name,
          birthInput: getCell(row, colMap.birth),
          birth: getCell(row, colMap.birth),
          phone: getCell(row, colMap.phone),
          nationality: getCell(row, colMap.nationality),
          consultArea: getCell(row, colMap.consultArea),
          reservationDate:
            normalizeDate(getCell(row, colMap.date)) || todayString(),
          reservationTime: normalizeTime(getCell(row, colMap.time)),
          doctors: doctorValue
            ? doctorValue
                .split(/[,/|·]/)
                .map((item) => item.trim())
                .filter(Boolean)
            : [],
          coordinators: coordinatorValue
            ? coordinatorValue
                .split(/[,/|·]/)
                .map((item) => item.trim())
                .filter(Boolean)
            : [],
          depositAmount: getCell(row, colMap.deposit),
        };
      })
      .filter((item) => item.name);

    if (!payloads.length) {
      return NextResponse.json(
        { success: false, message: "유효한 예약 데이터가 없습니다." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      count: payloads.length,
      payloads,
      columns: colMap,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "가져오기 중 오류가 발생했습니다.";

    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
