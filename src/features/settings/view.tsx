"use client";

import { Cable, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import ui from "@/components/ui/ui.module.css";
import { DataBoundary, PageTitle, Panel, Pill } from "../dashboard/view";
import styles from "../dashboard/view.module.css";
import { useHome } from "../home-provider";
import { LIGHTING_DEVICE_ID, localTime, MODE_LABEL, SERVO_MAX, SERVO_MIN, type LightingController, type Snapshot } from "../model";
import { useMutation } from "../use-mutation";

function SettingsForm({ settings }: { settings: Snapshot["settings"] }) {
  const mutation = useMutation();
  const [draft, setDraft] = useState<{ servo_ms: string; version: number } | null>(null);
  const input = draft ?? { servo_ms: String(settings.servo_ms), version: settings.version };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await mutation.run("settings", "PATCH", { servo_ms: Number(input.servo_ms), version: input.version }, "Đã lưu cấu hình servo.")) setDraft(null);
  }

  return <Panel title="Servo cho ăn" icon={<Settings2 size={20} />}>
    <form className={styles.form} onSubmit={submit}>
      <label className={ui.field}>Thời gian mở (ms)<input type="number" className={ui.input} min={SERVO_MIN} max={SERVO_MAX} step={1}
        value={input.servo_ms} required disabled={mutation.busy} aria-describedby="servo-range"
        onChange={(event) => setDraft({ ...input, servo_ms: event.target.value })} /></label>
      <p className={styles.muted} id="servo-range">Phạm vi an toàn {SERVO_MIN}–{SERVO_MAX} ms.</p>
      {mutation.issue && <p role="alert" className={ui.error}>{mutation.issue.message}</p>}
      <div className={ui.actions}>
        <button className={`${ui.button} ${ui.primary}`} disabled={mutation.busy}>Lưu cài đặt</button>
        {mutation.issue?.conflict && <button type="button" className={ui.button} onClick={() => void mutation.refresh().then(() => { setDraft(null); mutation.clear(); })}>Tải dữ liệu mới</button>}
      </div>
    </form>
  </Panel>;
}

function LightingSettings({ controller }: { controller?: LightingController }) {
  const { run, busy, issue } = useMutation();
  const mode = controller?.mode ?? "mock";
  return <Panel title="Kết nối đèn" icon={<Cable size={20} />}>
    <label className={ui.field}>Chế độ đèn
      <select className={ui.input} value={mode} disabled={!controller || busy} onChange={(event) => {
        void run("settings/lighting", "PATCH", { mode: event.target.value }, "Đã đổi chế độ đèn.");
      }}>
        <option value="mock">{MODE_LABEL.mock}</option>
        <option value="simulation" disabled={!controller}>{MODE_LABEL.simulation}</option>
        <option value="real" disabled>{MODE_LABEL.real}</option>
      </select>
    </label>
    <p className={styles.muted}>{controller ? controller.deviceId : LIGHTING_DEVICE_ID}</p>
    {controller ? <>
      <Pill tone={controller.online ? "mint" : "neutral"}>{controller.online ? "Online" : "Offline"}</Pill>
      <p className={styles.muted}>Tín hiệu cuối {controller.lastSeenAt ? localTime(controller.lastSeenAt) : "chưa nhận được"}</p>
      {controller.firmwareVersion && <p className={styles.muted}>Firmware {controller.firmwareVersion}</p>}
    </> : <p className={styles.muted}>Simulation Mode chưa được cấu hình trong môi trường này.</p>}
    {issue && <p role="alert" className={ui.error}>{issue.message}</p>}
  </Panel>;
}

export function SettingsView() {
  const { data } = useHome();
  return <div className={styles.page}>
    <PageTitle title="Cài đặt" subtitle="Cấu hình servo và kiểm tra chế độ hoạt động của hệ thống." />
    <DataBoundary>{data && <div className={styles.twoCol}>
      <SettingsForm settings={data.settings} />
      <LightingSettings controller={data.controller} />
    </div>}</DataBoundary>
  </div>;
}
