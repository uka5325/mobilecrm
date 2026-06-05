import type { Metadata } from "next";
import "./globals.css";
import AppProviders from "@/components/AppProviders";

export const metadata: Metadata = {
  title: "상담회 CRM",
  description: "상담회 전용 CRM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
