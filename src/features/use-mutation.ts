"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "./client-api";
import { useHome } from "./home-provider";

export function useMutation() {
  const active = useRef(false);
  const { refresh } = useHome();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<{ message: string; conflict: boolean } | null>(null);

  async function run(path: string, method: string, payload: object, message: string) {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setIssue(null);
    try {
      await api(path, method, payload);
      await refresh();
      toast(message);
      return true;
    } catch (error) {
      setIssue({
        message: error instanceof Error ? error.message : "Không xử lý được yêu cầu.",
        conflict: error instanceof ApiError && ["VERSION_CONFLICT", "DAY_CHANGED"].includes(error.code),
      });
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return { run, busy, issue, refresh, clear: () => setIssue(null) };
}
