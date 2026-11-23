"use client";

import { Cable, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import ui from "@/components/ui/ui.module.css";
import { DataBoundary, PageTitle, Panel, Pill } from "../dashboard/view";
import styles from "../dashboard/view.module.css";
import { useHome } from "../home-provider";
import { SERVO_MAX, SERVO_MIN, type Snapshot } from "../model";
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

export function SettingsView() {
  const { data } = useHome();
  return <div className={styles.page}>
    <PageTitle title="Cài đặt" subtitle="Cấu hình servo và kiểm tra chế độ hoạt động của hệ thống." />
    <DataBoundary>{data && <div className={styles.twoCol}>
      <SettingsForm settings={data.settings} />
      <Panel title="Kết nối thiết bị" icon={<Cable size={20} />}>
        <Pill tone="yellow">Mock Mode</Pill><p>Chưa kết nối ESP32.</p>
        <p className={styles.muted}>Real Mode sẽ khả dụng khi backend và phần cứng sẵn sàng.</p>
      </Panel>
    </div>}</DataBoundary>
  </div>;
}
