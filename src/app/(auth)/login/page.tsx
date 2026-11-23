import { redirect } from "next/navigation";
import { signedIn } from "@/server/auth/session";
import { LoginForm } from "@/features/login-form";
import { HomeHero } from "@/features/dashboard/home-hero";
import styles from "@/features/login.module.css";

export const metadata = { title: "Đăng nhập" };

export default async function LoginPage() {
  if (await signedIn()) redirect("/");
  return <main className={styles.login}>
    <HomeHero serverTime={new Date().toISOString()} />
    <LoginForm />
  </main>;
}
