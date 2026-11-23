import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/styles/globals.css";

const cintra = localFont({
  src: "../../font/SVN-Cintra.otf",
  variable: "--font-cintra",
  weight: "600 900",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "Sữa Smart Home", template: "%s | Sữa Smart Home" },
  description: "Điều khiển ngôi nhà thông minh của Sữa.",
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi" className={cintra.variable}><body>{children}</body></html>;
}
