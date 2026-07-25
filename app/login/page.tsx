"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail, loginWithGoogle, resetPassword } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleLogin(e?: React.FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();

    setErrorMessage("");
    setResetSent(false);

    if (!email.trim()) {
      setErrorMessage("이메일을 입력하세요.");
      return;
    }

    if (!password.trim()) {
      setErrorMessage("비밀번호를 입력하세요.");
      return;
    }

    setLoading(true);

    try {
      const result = await loginWithEmail(email, password);

      if (!result.success) {
        setErrorMessage(result.message || "이메일 또는 비밀번호가 올바르지 않습니다.");
        return;
      }

      router.push("/");
    } catch {
      setErrorMessage("로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    setResetLoading(true);
    setErrorMessage("");
    const result = await resetPassword(email);
    setResetLoading(false);
    if (!result.success) {
      setErrorMessage(result.message || "재설정 메일 전송에 실패했습니다.");
    } else {
      setResetSent(true);
    }
  }

  async function handleGoogleLogin() {
    setErrorMessage("");
    setResetSent(false);
    setGoogleLoading(true);
    try {
      const result = await loginWithGoogle();
      if (!result.success) {
        if (result.message) setErrorMessage(result.message);
        return;
      }
      router.push("/");
    } catch {
      setErrorMessage("Google 로그인 중 오류가 발생했습니다.");
    } finally {
      setGoogleLoading(false);
    }
  }

  const busy = loading || googleLoading || resetLoading;

  return (
    <main className="min-h-[100dvh] bg-[#061821] text-[#12151f] md:bg-[#f7f7f5] md:px-6 md:py-8">
      <section className="grid min-h-[100dvh] w-full overflow-hidden bg-white md:mx-auto md:min-h-[640px] md:max-w-[1180px] md:grid-cols-[1.08fr_0.92fr] md:rounded-[32px] md:border md:border-[#d9ddd9] md:shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
        <BrandPanel />

        <section className="relative z-10 -mt-6 flex-1 rounded-t-[28px] bg-white px-5 pb-8 pt-7 md:mt-0 md:flex md:items-center md:justify-center md:rounded-none md:px-10 md:py-12 lg:px-14">
          <div className="w-full md:max-w-[430px]">
            <div className="hidden justify-end md:flex">
              <StaffBadge />
            </div>

            <div className="md:mt-20">
              <h2 className="text-[26px] font-bold tracking-[-0.03em] text-[#12151f] md:text-[30px]">
                로그인
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#7b8290]">
                등록된 계정 정보를 입력하세요.
              </p>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleLogin} noValidate>
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-bold text-[#12151f]">
                  이메일
                </label>
                <div className="flex h-[52px] items-center rounded-xl border border-[#dfe3e8] bg-white px-4 transition focus-within:border-[#087D78] focus-within:ring-4 focus-within:ring-[#087D78]/10">
                  <MailIcon />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="이메일을 입력하세요"
                    autoComplete="email"
                    className="ml-3 min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-[#12151f] outline-none placeholder:text-[#a6adba]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-bold text-[#12151f]">
                  비밀번호
                </label>
                <div className="flex h-[52px] items-center rounded-xl border border-[#dfe3e8] bg-white px-4 transition focus-within:border-[#087D78] focus-within:ring-4 focus-within:ring-[#087D78]/10">
                  <LockIcon />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호를 입력하세요"
                    autoComplete="current-password"
                    className="ml-3 min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-[#12151f] outline-none placeholder:text-[#a6adba]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="ml-2 shrink-0 rounded-md px-1.5 py-1 text-sm font-medium text-[#12151f] transition hover:text-[#087D78] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087D78]"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                  >
                    {showPassword ? "숨기기" : "보기"}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[#4b5563]">
                  <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-[#cfd5dd] accent-[#087D78]" />
                  로그인 유지
                </label>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={resetLoading || loading}
                  className="shrink-0 text-sm font-semibold text-[#087D78] transition hover:text-[#056561] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087D78] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resetLoading ? "전송 중..." : "비밀번호 찾기"}
                </button>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="flex h-[52px] w-full items-center justify-center rounded-xl bg-[#3b82f6] px-4 text-base font-bold text-white transition hover:bg-[#2563eb] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#3b82f6]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "로그인 중..." : "로그인"}
              </button>
            </form>

            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-[#e5e7eb]" />
              <span className="shrink-0 text-sm font-medium text-[#12151f]">또는</span>
              <div className="h-px flex-1 bg-[#e5e7eb]" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={busy}
              className="flex h-[52px] w-full items-center justify-center gap-3 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm font-bold text-[#12151f] transition hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#dfe3e8] disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
            >
              {googleLoading ? <Spinner dark /> : <GoogleIcon />}
              Google 계정으로 계속하기
            </button>

            {errorMessage && (
              <p className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">
                {errorMessage}
              </p>
            )}

            {resetSent && (
              <p className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800" role="status" aria-live="polite">
                비밀번호 재설정 메일을 보냈습니다. 받은 편지함을 확인하세요.
              </p>
            )}

            <div className="mt-7 border-t border-[#eef0f3] pt-5 text-center">
              <p className="text-sm text-[#7b8290]">계정 접근에 문제가 있나요?</p>
              <p className="mt-1 text-sm font-semibold text-[#087D78]">관리자에게 문의하기</p>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function BrandPanel() {
  return (
    <section className="relative min-h-[250px] overflow-hidden bg-[linear-gradient(145deg,#061821_0%,#082D32_55%,#06413D_100%)] px-6 pb-16 pt-[calc(env(safe-area-inset-top)+1.75rem)] md:flex md:min-h-full md:items-center md:px-12 md:py-14 lg:px-16">
      <div className="pointer-events-none absolute -right-24 -top-24 h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(52,211,180,0.24)_0%,rgba(52,211,180,0)_68%)]" />
      <div className="pointer-events-none absolute -bottom-36 -left-28 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(13,148,136,0.24)_0%,rgba(13,148,136,0)_70%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <svg viewBox="0 0 700 700" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-40 500 C170 520 220 430 315 290 C420 135 565 130 760 250" fill="none" stroke="rgba(71,213,192,0.18)" strokeWidth="2" />
          <path d="M-60 610 C160 635 250 510 340 370 C455 190 595 220 770 350" fill="none" stroke="rgba(82,226,205,0.42)" strokeWidth="2" />
          <path d="M0 680 C230 690 315 570 400 455 C510 310 620 320 760 420" fill="none" stroke="rgba(42,180,165,0.15)" strokeWidth="1.5" />
        </svg>
      </div>

      <div className="relative z-10 w-full">
        <div className="flex justify-end md:hidden">
          <StaffBadge dark />
        </div>

        <div className="mt-12 max-w-[500px] md:mt-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.04em] text-white md:text-[38px] lg:text-[42px]">
            통합 고객 관리 시스템
          </h1>
          <p className="mt-4 max-w-[430px] text-sm leading-6 text-white/65 md:text-base md:leading-7">
            예약, 상담, 결제와 환자 기록을 한곳에서 관리하세요.
          </p>
        </div>
      </div>
    </section>
  );
}

function StaffBadge({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={
        dark
          ? "inline-flex rounded-lg border border-emerald-300/30 bg-emerald-300/5 px-3 py-1.5 text-xs font-medium text-emerald-200"
          : "inline-flex rounded-lg border border-[#087D78]/25 bg-[#087D78]/5 px-3 py-1.5 text-xs font-medium text-[#087D78]"
      }
    >
      직원 전용
    </span>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[#a6adba]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[#a6adba]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v3" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-1.99 3.02v2.53h3.23c1.89-1.74 2.98-4.3 2.98-7.39Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.38l-3.23-2.53c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.13H3.07v2.61A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.92A6.02 6.02 0 0 1 6.09 12c0-.67.11-1.32.31-1.92V7.47H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.53l3.33-2.61Z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.93 5.47l3.33 2.61c.79-2.37 3-4.13 5.6-4.13Z" />
    </svg>
  );
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={
        dark
          ? "h-4 w-4 animate-spin rounded-full border-2 border-[#cfd5dd] border-t-[#12151f]"
          : "h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      }
      aria-hidden="true"
    />
  );
}
