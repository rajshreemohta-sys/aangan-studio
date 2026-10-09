import type { Metadata } from "next";
import { Questrial } from "next/font/google";
import "./globals.css";

const questrial = Questrial({ weight: "400", subsets: ["latin"], variable: "--font-questrial" });

export const metadata: Metadata = {
  title: "Aangan Studio · Vaani",
  description: "Every enquiry call answered, qualified and handed to a designer.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={questrial.variable}>
      <body className="min-h-screen">
        <div className="blobs" aria-hidden>
          <div className="blob blob-pink" />
          <div className="blob blob-blue" />
          <div className="blob blob-lime" />
        </div>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
