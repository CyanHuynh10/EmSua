"use client";

import Link from "next/link";
import { Activity as ActivityIcon, CalendarClock, Camera, CircleAlert, Clock3, Lightbulb, RefreshCw, Utensils } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../client-api";
import { useHome } from "../home-provider";
import { localTime, TIME_ZONE, type Activity, type CameraState, type Outcome } from "../model";
import { DispenseButton } from "../feeder/dispense-button";
import { HomeHero } from "./home-hero";
import ui from "@/components/ui/ui.module.css";
import styles from "./view.module.css";

export const cameraText: Record<CameraState, string> = {
  off: "Đã tắt", connecting: "Đang kết nối", online: "Đã kết nối", offline: "Ngoại tuyến", error: "Lỗi kết nối",
};

const outcomes: Record<Outcome, string> = {
  executing: "Đang chạy", completed: "Hoàn thành", failed: "Thất bại", missed: "Đã bỏ lỡ", skipped_already_satisfied: "Đã đúng trạng thái",
};

export function outcomeText(value: Outcome | null | undefined) {
  return value ? outcomes[value] : "Đang chờ";
}

export function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className={styles.pageHeading}><h1>{title}</h1><p>{subtitle}</p></header>;
}

export function DataBoundary({ children }: { children: ReactNode }) {
  const { data, issue, refresh } = useHome();
  return <>
    {issue && <div className={styles.issue} role="alert"><CircleAlert size={19} /><span>{issue}</span>
      <button className={ui.button} onClick={() => void refresh()}><RefreshCw size={16} /> Tải lại</button></div>}
    {data ? children : !issue && <p className={styles.loading} role="status">Đang tải dữ liệu…</p>}
  </>;
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "mint" | "pink" | "yellow" }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}

export function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className={styles.panel}>
    <h2 className={styles.panelTitle}>{icon}{title}</h2>
    {children}
  </section>;
}

const labels: Record<string, string> = {
  feed_executing: "Bắt đầu chu trình cho ăn",
  feed_completed: "Đã hoàn thành chu trình cho ăn",
  feed_failed: "Chu trình cho ăn gặp lỗi",
  light_changed: "Đã cập nhật trạng thái đèn",
  light_skipped: "Đèn đã ở trạng thái yêu cầu",
  camera_changed: "Đã cập nhật camera",
  camera_skipped: "Camera đã ở trạng thái yêu cầu",
  settings_changed: "Đã lưu cấu hình servo",
  feed_schedule: "Đã lưu lịch cho ăn",
  cancel_feed: "Đã hủy lịch cho ăn",
  light_schedule: "Đã lưu lịch đèn",
  cancel_light: "Đã hủy lịch đèn",
};

const scheduleActions: Record<string, string> = { feed: "Cho ăn", on: "Bật đèn", off: "Tắt đèn" };

function eventLabel(entry: Activity) {
  if (labels[entry.event]) return labels[entry.event];
  if (entry.event.startsWith("schedule_")) {
    const action = scheduleActions[entry.detail.action ?? ""] ?? "Lịch thiết bị";
    return `${action} · ${outcomes[entry.event.slice(9) as Outcome] ?? "Đã xử lý"}`;
  }
  return "Hoạt động hệ thống";
}

export function ActivityList({ entries }: { entries: Activity[] }) {
  if (!entries.length) return <p className={styles.muted}>Chưa có hoạt động.</p>;
  return <ul className={styles.list}>
    {entries.map((entry) => <li key={entry.id}><span>{eventLabel(entry)}</span>
      <time dateTime={entry.created_at}>{new Intl.DateTimeFormat("vi-VN", {
        timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(new Date(entry.created_at))}</time></li>)}
  </ul>;
}

function RecentActivity({ entries }: { entries: Activity[] }) {
  const [history, setHistory] = useState<Activity[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");

  async function load() {
    setBusy(true);
    setIssue("");
    try {
      const page = await api<{ items: Activity[]; nextCursor: string | null }>(
        `activity?limit=10${cursor ? `&before=${cursor}` : ""}`,
      );
      setHistory((previous) => [...(previous ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "Không tải được nhật ký.");
    } finally {
      setBusy(false);
    }
  }

  return <Panel title="Hoạt động gần đây" icon={<ActivityIcon size={20} />}>
    <ActivityList entries={history ?? entries} />
    {issue && <p className={ui.error} role="alert">{issue}</p>}
    {(cursor || (!history && entries.length > 0)) && <div><button className={ui.button} disabled={busy} onClick={() => void load()}>
      {busy ? "Đang tải…" : history ? "Tải thêm" : "Xem nhật ký"}
    </button></div>}
    {history && <div><button className={styles.textButton} onClick={() => { setHistory(null); setCursor(null); setIssue(""); }}>Về hoạt động mới nhất</button></div>}
  </Panel>;
}

export function Dashboard() {
  const { data } = useHome();

  return <div className={styles.page}>
    <HomeHero serverTime={data?.serverTime} />
    <DataBoundary>{data && <>
      <div className={styles.sectionHeading}>
        <h2>Thiết bị</h2><span className={styles.muted}>Chưa kết nối ESP32</span>
      </div>
      <div className={styles.deviceGrid}>
        <section className={styles.deviceCard}>
          <div className={styles.deviceTop}><div className={`${styles.deviceIcon} ${styles.pink}`}><Utensils size={25} /></div>
            <Pill tone={data.feeder?.status === "failed" ? "pink" : "neutral"}>{data.feeder ? outcomeText(data.feeder.status) : "Sẵn sàng"}</Pill></div>
          <h3>Máy cho ăn</h3><p>{data.feeder ? `Lần gần nhất · ${localTime(data.feeder.created_at)}` : "Chưa có chu trình cho ăn."}</p>
          <DispenseButton />
        </section>
        <section className={styles.deviceCard}>
          <div className={styles.deviceTop}><div className={`${styles.deviceIcon} ${styles.yellow}`}><Lightbulb size={25} /></div>
            <Pill tone={data.light.power ? "mint" : "neutral"}>{data.light.power ? "Đang bật" : "Đã tắt"}</Pill></div>
          <h3>Đèn</h3><p>Mức sáng đã lưu · {data.light.brightness}%</p><Link className={ui.button} href="/lighting">Điều chỉnh đèn</Link>
        </section>
        <section className={styles.deviceCard}>
          <div className={styles.deviceTop}><div className={`${styles.deviceIcon} ${styles.blue}`}><Camera size={25} /></div>
            <Pill>{cameraText[data.camera]}</Pill></div>
          <h3>Camera</h3><p>Chưa kết nối camera ESP32-CAM.</p><Link className={ui.button} href="/camera">Mở camera</Link>
        </section>
      </div>
      <div className={styles.twoCol}>
        <Panel title="Lịch hôm nay" icon={<CalendarClock size={20} />}>
          <ul className={styles.list}>
            <li><Link href="/feeder"><Utensils size={17} /> Cho ăn</Link><span>{data.feeding && !data.feeding.cancelled ? `${data.feeding.feed_at.slice(0,5)} · ${outcomeText(data.feeding.outcome)}` : "Chưa đặt lịch"}</span></li>
            <li><Link href="/lighting"><Lightbulb size={17} /> Bật đèn</Link><span>{data.lighting && !data.lighting.cancelled ? `${data.lighting.on_at.slice(0,5)} · ${outcomeText(data.lighting.on_outcome)}` : "Chưa đặt lịch"}</span></li>
            <li><Link href="/lighting"><Lightbulb size={17} /> Tắt đèn</Link><span>{data.lighting && !data.lighting.cancelled ? `${data.lighting.off_at.slice(0,5)} · ${outcomeText(data.lighting.off_outcome)}` : "Chưa đặt lịch"}</span></li>
          </ul>
          <p className={styles.muted}><Clock3 size={16} /> Giờ Việt Nam · UTC+7</p>
        </Panel>
        <RecentActivity entries={data.activity} />
      </div>
    </>}</DataBoundary>
  </div>;
}
