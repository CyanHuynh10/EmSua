import { House, PawPrint, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { signedIn } from "@/server/auth/session";
import { LoginForm } from "@/features/login-form";
import styles from "@/features/login.module.css";

export const metadata = { title: "Đăng nhập" };

export default async function LoginPage() {
  if (await signedIn()) redirect("/");
  return <main className={styles.login}>
    <section className={styles.panel} aria-labelledby="login-title">
      <div className={styles.illustration}>
        <div className={styles.brand}><PawPrint size={19} aria-hidden="true" /> Sữa Smart Home</div>
        <div className={styles.art} aria-hidden="true">
          <div className={styles.catPortrait}>
            <div className={styles.catHead}>
              <div className={styles.catFace}>
                <span className={styles.eyes} />
                <span className={styles.nose} />
              </div>
            </div>
          </div>
          <div className={styles.homeSticker}><House /></div>
          <Sparkles className={styles.sparkles} />
        </div>
      </div>
      <div className={styles.content}>
        <h1 id="login-title">Đăng nhập</h1>
        <LoginForm />
      </div>
    </section>
  </main>;
}
