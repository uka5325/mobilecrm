// ─────────────────────────────────────────────────────────────────────────────
// CSV 생성 공통 유틸 — formula injection 방어 + 안전한 quoting.
//
// 배경: Excel/Sheets는 셀이 = + - @ (또는 탭/CR)로 시작하면 수식으로 해석한다.
// 환자명·메모 등 사용자 입력이 그대로 셀에 들어가면 =HYPERLINK(...)/+SUM(...) 같은
// 값이 열람자 PC에서 실행될 수 있다(CSV injection). 위험 접두 값 앞에 '를 붙여 무력화하고,
// 모든 셀을 이중 따옴표로 감싸(내부 따옴표는 "" 이스케이프) 쉼표·줄바꿈을 안전하게 담는다.
// ─────────────────────────────────────────────────────────────────────────────

// UTF-8 BOM — Excel이 한글을 올바른 인코딩으로 열도록 파일 앞에 붙인다.
export const CSV_BOM = "﻿";

// 단일 셀 정규화: 위험 접두 escape + 따옴표 이스케이프 + 항상 quoting.
export function sanitizeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  // = + - @ 및 탭/CR로 시작하면 수식 해석 방지용 '를 앞에 붙인다.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

// 행(문자열/값 배열)들을 CSV 문자열로 조립. 기본으로 BOM 포함.
export function buildCsvContent(rows: unknown[][], opts: { bom?: boolean } = {}): string {
  const bom = opts.bom === false ? "" : CSV_BOM;
  return bom + rows.map((row) => row.map(sanitizeCsvCell).join(",")).join("\n");
}
