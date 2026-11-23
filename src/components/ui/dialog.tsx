"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./ui.module.css";

export function Dialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog aria-labelledby="dialog-title" className={styles.dialog} ref={dialog} onCancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <div className={styles.dialogInner}>
      <div className={styles.dialogTitle}>
        <h2 id="dialog-title">{title}</h2>
        <button className={styles.iconButton} disabled={busy} onClick={onClose} aria-label="Đóng hộp thoại"><X size={20} /></button>
      </div>
      {children}
    </div>
  </dialog>;
}
