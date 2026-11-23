"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "./client-api";
import { POLL_INTERVAL, type Snapshot } from "./model";

interface HomeContext {
  data: Snapshot | null;
  issue: string;
  refresh: () => Promise<void>;
}

const Context = createContext<HomeContext | null>(null);

export function useHome() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing dashboard provider");
  return value;
}

export function HomeProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [issue, setIssue] = useState("");
  const last = useRef<Snapshot | null>(null);
  const router = useRouter();
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const next = await api<Snapshot>("dashboard");
      if (last.current && Date.parse(next.serverTime) < Date.parse(last.current.serverTime)) return;
      if (last.current?.feeder?.status === "executing" && next.feeder?.status === "completed") {
        toast("Chu trình cho Sữa ăn đã hoàn thành.");
      }
      if (last.current?.feeder?.status === "executing" && next.feeder?.status === "failed") {
        toast("Chu trình cho ăn bị lỗi. Kiểm tra nhật ký trước khi thử lại.", true);
      }
      last.current = next;
      setData(next);
      setIssue("");
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") router.replace("/login");
      setIssue(error instanceof Error ? error.message : "Không tải được dữ liệu.");
    }
  }, [router, toast]);

  useEffect(() => {
    let alive = true;
    let processing = false;
    async function poll() {
      if (document.hidden || !alive || processing) return;
      processing = true;
      try {
        await api("schedules/process", "POST");
        if (alive) await refresh();
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiError && error.code === "UNAUTHENTICATED") router.replace("/login");
        await refresh();
        if (alive) setIssue("Không xử lý được lịch. Hệ thống sẽ kiểm tra ở lượt tiếp theo.");
      } finally {
        processing = false;
      }
    }
    const initial = window.setTimeout(poll, 0);
    const interval = window.setInterval(poll, POLL_INTERVAL);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh, router]);

  return <Context.Provider value={{ data, issue, refresh }}>{children}</Context.Provider>;
}
