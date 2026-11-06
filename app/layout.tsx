import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mobile.css";
import "./modern.css";
import "./theme-user.css";

export const metadata: Metadata = {
  title: "Haaziry — Attendance & Leave",
  description: "Attendance, fingerprint machine imports, and leave management.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#246b4c" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}

