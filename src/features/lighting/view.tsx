"use client";

import { CalendarClock, Lightbulb } from "lucide-react";
import { useState, type FormEvent } from "react";
import ui from "@/components/ui/ui.module.css";
import { DataBoundary, outcomeText, PageTitle, Panel, Pill } from "../dashboard/view";
import styles from "../dashboard/view.module.css";
import { useHome } from "../home-provider";
import { localTime, type Snapshot } from "../model";
import { useMutation } from "../use-mutation";

function Controls({ light }: { light: Snapshot["light"] }) {
  const [brightness, setBrightness] = useState<number | null>(null);
  const { run, busy, issue } = useMutation();
  const value = brightness ?? light.brightness;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (await run("light", "PATCH", { brightness: value }, "Đã lưu mức sáng.")) setBrightness(null);
  }

  return <Panel title="Điều khiển đèn" icon={<Lightbulb size={20} />}>
    <div className={styles.displayLine}>
      <Pill tone={light.power ? "mint" : "neutral"}>{light.power ? "Đang bật" : "Đã tắt"}</Pill>
      <button className={`${ui.button} ${ui.primary}`} role="switch" aria-label="Nguồn đèn" aria-checked={light.power} disabled={busy}
        onClick={() => void run("light", "PATCH", { power: !light.power }, light.power ? "Đã tắt đèn." : "Đã bật đèn.")}>
        {light.power ? "Tắt đèn" : "Bật đèn"}
      </button>
    </div>
    <form className={styles.form} onSubmit={save}>
      <div className={styles.brightness}>
        <div className={styles.displayLine}><label htmlFor="brightness">Độ sáng</label><output htmlFor="brightness">{value}%</output></div>
        <input id="brightness" type="range" min={0} max={100} value={value} disabled={busy} onChange={(event) => setBrightness(event.target.valueAsNumber)} />
      </div>
      {issue && <p className={ui.error} role="alert">{issue.message}</p>}
      <div><button className={ui.button} disabled={busy || value === light.brightness}>Lưu độ sáng</button></div>
    </form>
  </Panel>;
}

function LightSchedule({ data }: { data: Snapshot }) {
  const entry = data.lighting;
  const enabled = entry && !entry.cancelled;
  const now = localTime(data.serverTime);
  const onLocked = Boolean(enabled && (entry.on_outcome || entry.on_at.slice(0,5) <= now));
  const offLocked = Boolean(enabled && (entry.off_outcome || entry.off_at.slice(0,5) <= now));
  const mutation = useMutation();
  const [draft, setDraft] = useState<{ on_at: string; off_at: string; version: number; day: string } | null>(null);
  const [validation, setValidation] = useState("");
  const input = draft ?? { on_at: enabled ? entry.on_at.slice(0,5) : "", off_at: enabled ? entry.off_at.slice(0,5) : "", version: entry?.version ?? 0, day: data.day };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (input.on_at >= input.off_at) {
      setValidation("Giờ tắt phải sau giờ bật trong cùng ngày.");
      return;
    }
    setValidation("");
    if (await mutation.run("light/schedule", "PUT", input, "Đã lưu lịch đèn.")) setDraft(null);
  }

  async function cancel() {
    if (await mutation.run("light/schedule", "DELETE", { day: input.day, version: input.version }, "Đã hủy lịch đèn.")) setDraft(null);
  }

  return <Panel title="Lịch đèn hôm nay" icon={<CalendarClock size={20} />}>
    <p className={styles.muted}>Lịch bật và tắt theo giờ Việt Nam. Mức sáng đã lưu được giữ nguyên.</p>
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.timeFields}>
        <div className={styles.form}><label className={ui.field}>Giờ bật<input className={ui.input} type="time" required
          value={input.on_at} disabled={onLocked || mutation.busy} onChange={(event) => setDraft({ ...input, on_at: event.target.value })} /></label>
          {enabled && <Pill>{outcomeText(entry.on_outcome)}</Pill>}</div>
        <div className={styles.form}><label className={ui.field}>Giờ tắt<input className={ui.input} type="time" required
          value={input.off_at} disabled={offLocked || mutation.busy} onChange={(event) => setDraft({ ...input, off_at: event.target.value })} /></label>
          {enabled && <Pill>{outcomeText(entry.off_outcome)}</Pill>}</div>
      </div>
      {(validation || mutation.issue) && <p className={ui.error} role="alert">{validation || mutation.issue?.message}</p>}
      <div className={ui.actions}>
        <button className={`${ui.button} ${ui.primary}`} disabled={offLocked || mutation.busy}>Lưu lịch</button>
        {enabled && <button className={ui.button} type="button" disabled={onLocked || mutation.busy} onClick={() => void cancel()}>Hủy lịch</button>}
        {mutation.issue?.conflict && <button type="button" className={ui.button} onClick={() => void mutation.refresh().then(() => { setDraft(null); mutation.clear(); })}>Tải dữ liệu mới</button>}
      </div>
    </form>
  </Panel>;
}

export function LightingView() {
  const { data } = useHome();
  return <div className={styles.page}>
    <PageTitle title="Đèn" subtitle="Bật, tắt, điều chỉnh độ sáng và đặt lịch trong ngày." />
    <DataBoundary>{data && <div className={styles.twoCol}><Controls light={data.light} /><LightSchedule data={data} /></div>}</DataBoundary>
  </div>;
}
