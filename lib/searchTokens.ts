// ─────────────────────────────────────────────────────────────────────────────
// 환자 검색 토큰 (단어 단위 전체일치)
//
// 이름이 "오양가(NYAMJAV UYANGA)" 형식이라, 괄호를 공백으로 풀고 단어로 분리해
// 각 단어를 소문자 토큰으로 저장한다. Firestore array-contains로 조회하면
// "오양가"(한글 이름 전체) / "uyanga"(영문 단어)처럼 단어 단위로 매칭되어
// 검색 시 매칭된 환자만 읽는다(전체 스캔 방지).
//
// 한계: 단어 "전체일치"만 지원(부분/중간글자 검색 불가). 한글 이름 전체 또는
// 영문 단어 전체로 검색해야 한다.
//
// firebase 의존이 없는 leaf 모듈 → 서버 API·백필 스크립트·클라가 공유한다.
// ─────────────────────────────────────────────────────────────────────────────

export function makePatientSearchTokens(name: string): string[] {
  if (!name) return [];
  const words = String(name)
    .replace(/[()[\]{}]/g, " ") // 괄호류 → 공백
    .split(/[\s,/·|]+/) // 공백·구분자로 단어 분리
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(words));
}

// 검색어 정규화(토큰과 동일 규칙: trim + 소문자). array-contains 비교용.
export function normalizeSearchTerm(term: string): string {
  return String(term || "").trim().toLowerCase();
}
