"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(e?: React.FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();

    setErrorMessage("");

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
        const debug = (result as { _debug?: string })._debug;
        setErrorMessage((result.message || "이메일 또는 비밀번호가 올바르지 않습니다.") + (debug ? ` [${debug}]` : ""));
        return;
      }

      router.push("/");
    } catch (error) {
      setErrorMessage("로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const menuItems = [
    { icon: "📋", label: "타임라인" },
    { icon: "👥", label: "예약관리" },
    { icon: "🧾", label: "인보이스" },
    { icon: "📊", label: "KPI 대시보드" },
  ];

  return (
    <main className="min-h-screen bg-[#f3f4f6]">
      <div className="flex min-h-screen w-full bg-white max-[1023px]:flex-col">
        {/* Side / Top Brand Area */}
        <aside className="flex w-[260px] shrink-0 flex-col justify-between bg-[#0f1923] px-6 py-8 max-[1023px]:w-full max-[1023px]:px-6 max-[1023px]:py-6">
          <div>
            {/* Brand */}
            <div className="max-[1023px]:flex max-[1023px]:items-center max-[1023px]:gap-4">
              <div className="mb-4 flex h-[38px] w-[38px] items-center justify-center rounded-lg bg-[#1d9e75] text-xl max-[1023px]:mb-0 max-[1023px]:h-12 max-[1023px]:w-12 max-[1023px]:text-2xl">
                🏥
              </div>

              <div>
                <div className="text-base font-semibold text-white max-[1023px]:text-2xl">
                  상담회 CRM
                </div>

                <div className="mt-1 text-xs leading-relaxed text-white/45 max-[1023px]:hidden">
                  해외 상담회
                  <br />
                  실시간 운영 시스템
                </div>
              </div>
            </div>

            {/* Desktop / Tablet landscape sidebar menu */}
            <nav className="mt-8 flex flex-col gap-[7px] max-[1023px]:hidden">
              {menuItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-xs text-white/50"
                >
                  <span className="w-[18px] text-center text-[15px]">
                    {item.icon}
                  </span>
                  {item.label}
                </div>
              ))}
            </nav>

            {/* Tablet portrait / mobile top menu */}
            <nav className="mt-5 hidden gap-2 overflow-x-auto pb-1 max-[1023px]:flex">
              {menuItems.map((item) => (
                <div
                  key={item.label}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-white/8 px-4 py-3 text-sm font-medium text-white/70"
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </nav>
          </div>

          <div className="text-[11px] text-white/20 max-[1023px]:hidden">
            v1.0 · Firebase / Vercel
          </div>
        </aside>

        {/* Main Login Area */}
        <section className="flex flex-1 items-center justify-center bg-[#f3f4f6] p-12 max-[1023px]:items-start max-[1023px]:p-6 max-[700px]:p-5">
          <div className="w-full max-w-[420px] rounded-[14px] border border-black/10 bg-white p-8 shadow-[0_2px_16px_rgba(0,0,0,0.07)] max-[1023px]:max-w-none max-[1023px]:p-8 max-[700px]:p-6">
            <h1 className="mb-1 text-[22px] font-bold text-[#1a1a1a] max-[700px]:text-[26px]">
              로그인
            </h1>

            <p className="mb-7 text-[13px] text-[#6b7280] max-[700px]:text-base">
              이메일로 로그인하세요
            </p>

            <form onSubmit={handleLogin}>
              <div className="mb-4">
                <label
                  htmlFor="email"
                  className="mb-[5px] block text-xs font-medium text-[#6b7280] max-[700px]:text-sm"
                >
                  이메일
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@clinic.com"
                  autoComplete="email"
                  className={`w-full rounded-md border bg-[#f9fafb] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none transition focus:border-[#1d9e75] focus:bg-white focus:shadow-[0_0_0_3px_rgba(29,158,117,0.12)] max-[700px]:px-4 max-[700px]:py-4 max-[700px]:text-base ${
                    errorMessage && !email.trim()
                      ? "border-[#e24b4a]"
                      : "border-black/10"
                  }`}
                />
              </div>

              <div className="mb-4">
                <label
                  htmlFor="password"
                  className="mb-[5px] block text-xs font-medium text-[#6b7280] max-[700px]:text-sm"
                >
                  비밀번호
                </label>

                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={`w-full rounded-md border bg-[#f9fafb] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none transition focus:border-[#1d9e75] focus:bg-white focus:shadow-[0_0_0_3px_rgba(29,158,117,0.12)] max-[700px]:px-4 max-[700px]:py-4 max-[700px]:text-base ${
                    errorMessage && !password.trim()
                      ? "border-[#e24b4a]"
                      : "border-black/10"
                  }`}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="relative w-full rounded-md bg-[#1d9e75] py-[11px] text-sm font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-60 max-[700px]:py-4 max-[700px]:text-lg"
              >
                {loading ? (
                  <span className="mx-auto block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  "로그인"
                )}
              </button>

              {errorMessage && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {errorMessage}
                </div>
              )}
            </form>

            <div className="mt-5 flex flex-wrap gap-[5px] max-[700px]:gap-2">
              <span className="rounded border border-black/10 bg-[#f3f4f6] px-2 py-[3px] text-[11px] text-[#6b7280] max-[700px]:px-3 max-[700px]:py-2 max-[700px]:text-sm">
                admin
              </span>
              <span className="rounded border border-black/10 bg-[#f3f4f6] px-2 py-[3px] text-[11px] text-[#6b7280] max-[700px]:px-3 max-[700px]:py-2 max-[700px]:text-sm">
                doctor
              </span>
              <span className="rounded border border-black/10 bg-[#f3f4f6] px-2 py-[3px] text-[11px] text-[#6b7280] max-[700px]:px-3 max-[700px]:py-2 max-[700px]:text-sm">
                coordinator
              </span>
              <span className="rounded border border-black/10 bg-[#f3f4f6] px-2 py-[3px] text-[11px] text-[#6b7280] max-[700px]:px-3 max-[700px]:py-2 max-[700px]:text-sm">
                staff
              </span>
              <span className="rounded border border-black/10 bg-[#f3f4f6] px-2 py-[3px] text-[11px] text-[#6b7280] max-[700px]:px-3 max-[700px]:py-2 max-[700px]:text-sm">
                interpreter
              </span>
            </div>

            <p className="mt-4 text-center text-xs leading-relaxed text-[#9ca3af] max-[700px]:text-sm">
              등록된 계정만 접근 가능합니다.
              <br />
              계정 문의는 관리자에게 연락하세요.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
