"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "./client-api";
import { useHome } from "./home-provider";

export function useMutation() {
  const active = useRef(false);
  const { refresh } = useHome();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<{ message: string; conflict: boolean } | null>(null);

  const run = useCallback(async function run<T>(path: string, method: string, payload: object, message: string, confirm?: (result: T) => Promise<void>) {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setIssue(null);
    try {
      const result = await api<T>(path, method, payload);
      if (confirm) await confirm(result);
      await refresh();
      toast(message);
      return true;
    } catch (error) {
      if (confirm) await refresh();
      setIssue({
        message: error instanceof Error ? error.message : "Không xử lý được yêu cầu.",
        conflict: error instanceof ApiError && ["VERSION_CONFLICT", "DAY_CHANGED"].includes(error.code),
      });
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [refresh, toast]);

  return { run, busy, issue, refresh, clear: () => setIssue(null) };
}
