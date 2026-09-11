import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MINIMA Resize Studio",
  description: "Professional batch image resize and visual editing workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
