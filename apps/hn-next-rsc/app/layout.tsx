import "./globals.css";
import type { Metadata, Viewport } from "next";
import Nav from "../components/nav";

export const metadata: Metadata = {
  title: "Next RSC Hackernews",
  description: "Simple Hackernews Demo",
  icons: "/favicon.ico"
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
