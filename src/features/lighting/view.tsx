"use client";

import { CalendarClock, Lightbulb } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import ui from "@/components/ui/ui.module.css";
import { ActivityList, DataBoundary, outcomeText, PageTitle, Panel, Pill } from "../dashboard/view";
import styles from "../dashboard/view.module.css";
import { useHome } from "../home-provider";
import { api } from "../client-api";
import { localTime, MODE_LABEL, type LightState, type LightingCommand, type LightingController, type Snapshot } from "../model";
import { useMutation } from "../use-mutation";

function Controls({ light }: { light: LightState }) {
  const [brightness, setBrightness] = useState<number | null>(null);
  const { run, busy, issue } = useMutation();
  const value = brightness ?? light.brightness;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (await run("light", "PATCH", { brightness: value, expected_mode: "mock" }, "Đã lưu mức sáng.")) setBrightness(null);
  }

  return <Panel title="Điều khiển đèn" icon={<Lightbulb size={20} />}>
    <Pill tone="yellow">{MODE_LABEL.mock}</Pill>
    <div className={styles.displayLine}>
      <Pill tone={light.power ? "mint" : "neutral"}>{light.power ? "Đang bật" : "Đã tắt"}</Pill>
      <button className={`${ui.button} ${ui.primary}`} role="switch" aria-label="Nguồn đèn" aria-checked={light.power} disabled={busy}
        onClick={() => void run("light", "PATCH", { power: !light.power, expected_mode: "mock" }, light.power ? "Đã tắt đèn." : "Đã bật đèn.")}>
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

async function waitForAck(command: LightingCommand) {
  if (!command.commandId) throw new Error("Máy chủ chưa tạo được lệnh cho ESP32.");
  const deadline = Date.now() + 38_000;
  while (command.status === "pending" || command.status === "claimed") {
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    if (Date.now() > deadline) throw new Error("Hết thời gian chờ ESP32 phản hồi.");
    if (document.hidden) continue;
    command = await api<LightingCommand>(`light/commands/${command.commandId}`);
  }
  if (command.status === "completed") return;
  if (command.status === "expired") throw new Error("Lệnh đèn đã hết hạn.");
  if (command.status === "cancelled") throw new Error("Lệnh đèn đã bị hủy khi đổi chế độ.");
  if (command.errorCode === "DEVICE_RESTARTED") throw new Error("ESP32 đã khởi động lại trong lúc xử lý lệnh.");
  throw new Error("ESP32 không thực hiện được lệnh đèn.");
}

function SimulationControls({ controller }: { controller: LightingController }) {
  const { run, busy, issue } = useMutation();
  const [draft, setDraft] = useState<number | null>(null);
  const light = controller.reported;
  const available = controller.online && light !== null;
  const value = draft ?? light?.brightness ?? 50;

  useEffect(() => {
    if (!available || busy || draft === null) return;
    const timer = window.setTimeout(async () => {
      if (draft !== light?.brightness) {
        await run<LightingCommand>("light", "PATCH", { brightness: draft, expected_mode: "simulation", request_id: crypto.randomUUID() }, "ESP32 đã lưu mức sáng.", waitForAck);
      }
      setDraft((current) => current === draft ? null : current);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [available, busy, draft, light?.brightness, run]);

  function toggle(reported: LightState) {
    void run<LightingCommand>("light", "PATCH", { power: !reported.power, expected_mode: "simulation", request_id: crypto.randomUUID() },
      reported.power ? "ESP32 đã tắt đèn." : "ESP32 đã bật đèn.", waitForAck);
  }

  return <Panel title="Điều khiển đèn" icon={<Lightbulb size={20} />}>
    <div className={styles.displayLine}>
      <Pill tone="yellow">{MODE_LABEL.simulation}</Pill>
      <Pill tone={controller.online ? "mint" : "neutral"}>{controller.online ? "Online" : "Offline"}</Pill>
    </div>
    <p className={styles.muted}>Tín hiệu cuối {controller.lastSeenAt ? localTime(controller.lastSeenAt) : "chưa nhận được"}</p>
    <div className={styles.displayLine}>
      <Pill tone={light?.power ? "mint" : "neutral"}>{light ? light.power ? "Đang bật" : "Đã tắt" : "Chưa nhận trạng thái"}</Pill>
      <button className={`${ui.button} ${ui.primary}`} role="switch" aria-label="Nguồn đèn" aria-checked={light?.power ?? false}
        disabled={!available || busy || controller.pending} onClick={() => { if (light) toggle(light); }}>
        {light?.power ? "Tắt đèn" : "Bật đèn"}
      </button>
    </div>
    <div className={styles.brightness}>
      <div className={styles.displayLine}><label htmlFor="brightness">Độ sáng</label><output htmlFor="brightness">{light ? `${value}%` : "—"}</output></div>
      <input id="brightness" type="range" min={0} max={100} value={value} disabled={!available}
        onChange={(event) => setDraft(event.target.valueAsNumber)} />
      {light && <p className={styles.muted}>ESP32 xác nhận {light.brightness}%</p>}
    </div>
    <div role="status">
      {(busy || controller.pending) && <Pill tone="yellow">Đang chờ ESP32 phản hồi</Pill>}
      {controller.desired && <p className={styles.muted}>Yêu cầu {controller.desired.power ? "bật" : "tắt"} · {controller.desired.brightness}%</p>}
    </div>
    {issue && <p role="alert" className={ui.error}>{issue.message}</p>}
  </Panel>;
}

function LightSchedule({ data }: { data: Snapshot }) {
  const entry = data.lighting;
  const mode = data.controller?.mode ?? "mock";
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
    if (await mutation.run("light/schedule", "PUT", { ...input, expected_mode: mode }, "Đã lưu lịch đèn.")) setDraft(null);
  }

  async function cancel() {
    if (await mutation.run("light/schedule", "DELETE", { day: input.day, version: input.version, expected_mode: mode }, "Đã hủy lịch đèn.")) setDraft(null);
  }

  return <Panel title="Lịch đèn hôm nay" icon={<CalendarClock size={20} />}>
    <p className={styles.muted}>Lịch bật và tắt theo giờ Việt Nam. Mức sáng đã lưu được giữ nguyên.</p>
    {data.controller?.mode === "simulation" && <p className={styles.muted}>Giữ website mở ở tab đang dùng và để Wokwi chạy vào giờ hẹn.</p>}
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
    <DataBoundary>{data && <>
      <div className={styles.twoCol}>
        {data.controller?.mode === "simulation" ? <SimulationControls controller={data.controller} /> : data.light && <Controls light={data.light} />}
        <LightSchedule key={data.controller?.mode ?? "mock"} data={data} />
      </div>
      {data.controller?.mode === "simulation" && <Panel title="Hoạt động Wokwi" icon={<Lightbulb size={20} />}>
        <ActivityList entries={data.activity.filter((entry) => entry.event.startsWith("lighting.") || entry.event.startsWith("device."))} />
      </Panel>}
    </>}</DataBoundary>
  </div>;
}
