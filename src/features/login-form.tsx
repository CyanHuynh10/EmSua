"use client";

import { LockKeyhole, LogIn, PawPrint } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "./client-api";
import ui from "@/components/ui/ui.module.css";
import styles from "./login.module.css";

export function LoginForm() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("auth/login", "POST", { username: form.get("username"), password: form.get("password") });
      window.location.replace("/");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Đăng nhập thất bại.");
      active.current = false;
      setBusy(false);
    }
  }

  return <main className={styles.login}>
    <div className={styles.frame}>
      <div className={styles.brand}><PawPrint size={25} /> Sữa Smart Home</div>
      <section className={styles.card}>
        <div className={styles.lock}><LockKeyhole size={27} /></div>
        <h1>Đăng nhập</h1>
        <p>Vào nhà của Sữa bằng tài khoản quản trị.</p>
        <form onSubmit={submit}>
          <label className={ui.field}>Tài khoản<input className={ui.input} name="username" autoComplete="username" maxLength={100} required /></label>
          <label className={ui.field}>Mật khẩu<input className={ui.input} name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
          {error && <p className={ui.error} role="alert">{error}</p>}
          <button className={`${ui.button} ${ui.primary}`} disabled={busy}><LogIn size={18} />{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
        </form>
      </section>
    </div>
  </main>;
}
