import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strafrechts-Assistent",
  description: "KI-gestützter Agent für Strafrechtsanalyse mit StGB/StPO-Kommentaren",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased bg-gray-950 text-white">
        {children}
      </body>
    </html>
  );
}
