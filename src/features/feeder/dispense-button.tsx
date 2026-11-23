"use client";

import { Utensils } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import ui from "@/components/ui/ui.module.css";
import { api, ApiError } from "../client-api";
import { useHome } from "../home-provider";
import type { Outcome } from "../model";

const REQUEST_KEY = "sua.pending-feeder";

export function DispenseButton() {
  const { data, refresh } = useHome();
  const toast = useToast();
  const locked = useRef(false);
  const key = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");

  async function dispense() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setIssue("");
    try {
      key.current ??= sessionStorage.getItem(REQUEST_KEY) || crypto.randomUUID();
      sessionStorage.setItem(REQUEST_KEY, key.current);
      const result = await api<{ status: Outcome }>("feeder/dispense", "POST", { request_id: key.current });
      sessionStorage.removeItem(REQUEST_KEY);
      key.current = null;
      setOpen(false);
      if (result.status === "executing") toast("Đã bắt đầu chu trình cho Sữa ăn.");
      if (result.status === "completed") toast("Chu trình cho Sữa ăn đã hoàn thành.");
      if (result.status === "failed") toast("Chu trình cho ăn bị lỗi. Xem nhật ký để kiểm tra.", true);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && !["NETWORK_ERROR", "SERVICE_UNAVAILABLE"].includes(error.code)) {
        sessionStorage.removeItem(REQUEST_KEY);
        key.current = null;
      }
      setIssue(error instanceof Error ? error.message : "Không xác định được kết quả lệnh.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <>
    <button className={`${ui.button} ${ui.primary}`} disabled={busy || data?.feeder?.status === "executing"}
      onClick={() => { setOpen(true); setIssue(""); }}><Utensils size={17} /> Cho Sữa ăn ngay</button>
    {open && <Dialog title="Cho Sữa ăn ngay?" busy={busy} onClose={() => setOpen(false)}>
      <p>Máy sẽ chạy một chu trình mở servo trong Mock Mode.</p>
      {issue && <p className={ui.error} role="alert">{issue}</p>}
      <div className={ui.actions}>
        <button className={ui.button} autoFocus disabled={busy} onClick={() => setOpen(false)}>Quay lại</button>
        <button className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={() => void dispense()}>
          {busy ? "Đang gửi…" : "Xác nhận cho ăn"}
        </button>
      </div>
    </Dialog>}
  </>;
}
