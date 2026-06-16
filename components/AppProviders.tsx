"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const AppShell = dynamic(() => import("./AppShell"), { ssr: false });

export default function AppProviders({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
