import type { ReactNode } from "react";
import "./globals.css";

const description =
  "Ask a question about your sales. The dashboard reshapes itself to answer it, and shows why.";

export const metadata = {
  title: "MORPH — the dashboard that adapts",
  description,
  openGraph: { title: "MORPH — the dashboard that adapts", description, type: "website" },
  twitter: { card: "summary_large_image", title: "MORPH", description },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="morph-bg min-h-screen text-foreground antialiased">{children}</body>
    </html>
  );
}
