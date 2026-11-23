"use client";

import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ui.module.css";

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const show = useCallback((message: string, error = false) => setToast({ message, error }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    function dismiss(event: PointerEvent) {
      if (!region.current?.contains(event.target as Node)) setToast(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [toast]);

  return <ToastContext.Provider value={show}>
    {children}
    <div className={styles.toastRegion} ref={region}>
      {toast && <div className={`${styles.toast} ${toast.error ? styles.toastError : ""}`} role={toast.error ? "alert" : "status"}>
        {toast.error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
        <span>{toast.message}</span>
        <button type="button" className={styles.iconButton} onClick={() => setToast(null)} aria-label="Đóng thông báo"><X size={18} /></button>
      </div>}
    </div>
  </ToastContext.Provider>;
}
