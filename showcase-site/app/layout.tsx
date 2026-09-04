import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "../../app/globals.css";
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
export const metadata: Metadata = {
  metadataBase: new URL("https://showcase.zamdevai.com"),
  title: "Hierarchia | Your process, built into every review",
  description:
    "Custom-deployed document review workflows for agencies, ecommerce and training teams. Request a workflow audit or explore the interactive sample.",
  robots: { index: false, follow: true },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
