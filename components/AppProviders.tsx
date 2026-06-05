"use client";

import type { ReactNode } from "react";
import AppShell from "./AppShell";

export default function AppProviders({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
