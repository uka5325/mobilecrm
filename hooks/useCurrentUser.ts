"use client";

// 전역 단일 직원 상태(components/CurrentUserProvider.tsx)를 그대로 재노출한다.
// 예전에는 이 훅이 자체적으로 onAuthStateChanged 구독 + getStaffByUid()를 또 돌려서
// AppShell의 동일 로직과 로그인 시점에 경쟁(중복 verify-staff 호출)했다 — 이제는
// Provider가 유일한 출처이므로 여기서는 그 결과를 읽기만 한다. 반환 형태
// ({currentUser, authReady, firebaseReady})는 기존과 동일해 호출부 변경이 필요 없다.
export { useCurrentUserContext as useCurrentUser } from "@/components/CurrentUserProvider";
