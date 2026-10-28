import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Haazir App — Attendance & Leave",
  description: "Attendance, fingerprint machine imports, and leave management.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

