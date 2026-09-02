import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "소방점검 일정 관리",
  description: "건축물대장 기반 소방점검 자동 일정 관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-silver-100 font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
