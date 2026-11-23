"use client";

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

  return <form className={styles.form} aria-label="Đăng nhập" onSubmit={submit}>
    <input className={ui.input} name="username" aria-label="Tài khoản" placeholder="Tài khoản" autoComplete="username" maxLength={100} required />
    <input className={ui.input} name="password" aria-label="Mật khẩu" placeholder="Mật khẩu" type="password" autoComplete="current-password" maxLength={256} required />
    {error && <p className={ui.error} role="alert">{error}</p>}
    <button className={`${ui.button} ${ui.primary}`} disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
  </form>;
}
