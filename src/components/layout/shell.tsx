"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, House, Lightbulb, LogOut, PawPrint, Settings2, Utensils } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { api } from "@/features/client-api";
import { HomeProvider } from "@/features/home-provider";
import styles from "./shell.module.css";

const nav = [
  { href: "/", title: "Tổng quan", icon: House },
  { href: "/feeder", title: "Cho ăn", icon: Utensils },
  { href: "/lighting", title: "Đèn", icon: Lightbulb },
  { href: "/camera", title: "Camera", icon: Camera },
  { href: "/settings", title: "Cài đặt", icon: Settings2 },
];

function Navigation() {
  const path = usePathname();
  return <nav aria-label="Điều hướng chính" className={styles.nav}>
    {nav.map(({ href, title, icon: Icon }) => <Link key={href} href={href}
      aria-current={path === href ? "page" : undefined} className={styles.navLink}>
      <Icon size={20} strokeWidth={2.2} /><span>{title}</span>
    </Link>)}
  </nav>;
}

function ShellContent({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await api("auth/logout", "POST");
      window.location.replace("/login");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Không đăng xuất được.", true);
      setLoggingOut(false);
    }
  }

  return <div className={styles.shell}>
    <a href="#main" className={styles.skip}>Đến nội dung chính</a>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/">
        <span className={styles.mark}><PawPrint size={24} strokeWidth={2.5} /></span>
        <span><strong>Sữa</strong><small>SMART HOME</small></span>
      </Link>
      <Navigation />
      <div className={styles.footer}>
        <div className={styles.mode}><span /> Mock Mode</div>
        <p>Chưa kết nối ESP32</p>
      </div>
    </aside>
    <div className={styles.content}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.mobileBrand}><PawPrint size={20} /> Sữa Smart Home</Link>
        <span className={styles.breadcrumb}><House size={16} /> Nhà của Sữa</span>
        <button onClick={logout} disabled={loggingOut} className={styles.logout}><LogOut size={17} /> <span>Đăng xuất</span></button>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>{children}</main>
    </div>
  </div>;
}

export function Shell({ children }: { children: ReactNode }) {
  return <ToastProvider><HomeProvider><ShellContent>{children}</ShellContent></HomeProvider></ToastProvider>;
}
