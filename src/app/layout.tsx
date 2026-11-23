import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/styles/globals.css";

const cintra = localFont({ src: "../../font/SVN-Cintra.otf", variable: "--font-display", weight: "400", display: "swap" });
const agency = localFont({ src: "../../font/SVN-Agency FB.ttf", variable: "--font-condensed", weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Sữa Smart Home", template: "%s | Sữa Smart Home" },
  description: "Điều khiển ngôi nhà thông minh của Sữa.",
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi" className={`${cintra.variable} ${agency.variable}`}><body>{children}</body></html>;
}
