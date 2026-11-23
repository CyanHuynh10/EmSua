"use client";

import { CalendarClock, Utensils } from "lucide-react";
import { useState, type FormEvent } from "react";
import ui from "@/components/ui/ui.module.css";
import { DataBoundary, outcomeText, PageTitle, Panel, Pill } from "../dashboard/view";
import styles from "../dashboard/view.module.css";
import { useHome } from "../home-provider";
import { localTime, type Snapshot } from "../model";
import { useMutation } from "../use-mutation";
import { DispenseButton } from "./dispense-button";

function FeederSchedule({ data }: { data: Snapshot }) {
  const schedule = data.feeding;
  const enabled = schedule && !schedule.cancelled;
  const locked = Boolean(enabled && (schedule.outcome || schedule.feed_at.slice(0,5) <= localTime(data.serverTime)));
  const mutation = useMutation();
  const [draft, setDraft] = useState<{ value: string; version: number; day: string } | null>(null);
  const current = { value: enabled ? schedule.feed_at.slice(0,5) : "", version: schedule?.version ?? 0, day: data.day };
  const input = draft ?? current;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await mutation.run("feeder/schedule", "PUT", { day: input.day, version: input.version, feed_at: input.value }, "Đã lưu lịch cho ăn.")) setDraft(null);
  }

  async function cancel() {
    if (await mutation.run("feeder/schedule", "DELETE", { day: input.day, version: input.version }, "Đã hủy lịch cho ăn.")) setDraft(null);
  }

  return <Panel title="Lịch cho ăn hôm nay" icon={<CalendarClock size={20} />}>
    <p className={styles.muted}>Một lần trong ngày, theo giờ Việt Nam. Lịch tự hết hiệu lực lúc nửa đêm.</p>
    {enabled && <Pill tone="yellow">{outcomeText(schedule.outcome)}</Pill>}
    <form className={styles.form} onSubmit={submit}>
      <label className={ui.field}>Giờ cho ăn<input className={ui.input} type="time" value={input.value} required
        disabled={locked || mutation.busy} onChange={(event) => setDraft({ ...input, value: event.target.value })} /></label>
      {mutation.issue && <p className={ui.error} role="alert">{mutation.issue.message}</p>}
      <div className={ui.actions}>
        <button className={`${ui.button} ${ui.primary}`} disabled={locked || mutation.busy}>Lưu lịch</button>
        {enabled && <button className={ui.button} type="button" disabled={locked || mutation.busy} onClick={() => void cancel()}>Hủy lịch</button>}
        {mutation.issue?.conflict && <button type="button" className={ui.button} onClick={() => void mutation.refresh().then(() => { setDraft(null); mutation.clear(); })}>Tải dữ liệu mới</button>}
      </div>
    </form>
  </Panel>;
}

export function FeederView() {
  const { data } = useHome();
  return <div className={styles.page}>
    <PageTitle title="Máy cho ăn" subtitle="Chạy một chu trình servo hoặc đặt giờ cho Sữa ăn hôm nay." />
    <DataBoundary>{data && <div className={styles.twoCol}>
      <Panel title="Cho ăn thủ công" icon={<Utensils size={20} />}>
        <Pill tone={data.feeder?.status === "failed" ? "pink" : "neutral"}>{data.feeder ? outcomeText(data.feeder.status) : "Sẵn sàng"}</Pill>
        <p className={styles.muted}>{data.feeder ? `Lần gần nhất lúc ${localTime(data.feeder.created_at)}.` : "Chưa có chu trình cho ăn."}</p>
        <div><DispenseButton /></div>
      </Panel>
      <FeederSchedule data={data} />
    </div>}</DataBoundary>
  </div>;
}
