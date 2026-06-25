"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { ToastProvider } from "./ui/Toast";

const AppShell = dynamic(() => import("./AppShell"), { ssr: false });

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
