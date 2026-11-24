"use client";

import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, UserRound } from "lucide-react";
import { api } from "./client-api";
import ui from "@/components/ui/ui.module.css";
import styles from "./login.module.css";

export function LoginForm() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  return <form className={styles.form} aria-label="Đăng nhập" onSubmit={submit}>
    <div className={styles.field}>
      <label htmlFor="login-username">Tài khoản</label>
      <div className={styles.control}>
        <UserRound size={19} aria-hidden="true" />
        <input id="login-username" className={ui.input} name="username" autoComplete="username" maxLength={100} required />
      </div>
    </div>
    <div className={styles.field}>
      <label htmlFor="login-password">Mật khẩu</label>
      <div className={`${styles.control} ${styles.password}`}>
        <KeyRound size={19} aria-hidden="true" />
        <input id="login-password" className={ui.input} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" maxLength={256} required />
        <button type="button" className={`${ui.iconButton} ${styles.reveal}`}
          aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-controls="login-password"
          onClick={() => setShowPassword((visible) => !visible)}>
          {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
        </button>
      </div>
    </div>
    {error && <p className={ui.error} role="alert">{error}</p>}
    <button className={`${ui.button} ${ui.primary}`} disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
  </form>;
}
