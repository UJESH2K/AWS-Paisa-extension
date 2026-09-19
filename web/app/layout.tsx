import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Paisa — your AWS bill in rupees",
  description:
    "See what your AWS bill actually costs in INR after forex, card markup and GST, before the invoice lands.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-faint">
          Every figure is an estimate. Your bank&apos;s rate on the settlement date and your
          AWS entity decide the real number.
        </footer>
      </body>
    </html>
  );
}
