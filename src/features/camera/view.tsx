"use client";

import { Camera, CameraOff, WifiOff } from "lucide-react";
import ui from "@/components/ui/ui.module.css";
import { cameraText, DataBoundary, PageTitle, Panel, Pill } from "../dashboard/view";
import styles from "../dashboard/view.module.css";
import { useHome } from "../home-provider";
import { useMutation } from "../use-mutation";

export function CameraView() {
  const { data } = useHome();
  const { run, busy, issue } = useMutation();
  const enabled = data?.camera !== "off";

  return <div className={styles.page}>
    <PageTitle title="Camera" subtitle="Kiểm tra trạng thái kết nối của ESP32-CAM." />
    <DataBoundary>{data && <Panel title="Khung quan sát" icon={<Camera size={21} />}>
      <div className={styles.displayLine}>
        <Pill tone={data.camera === "offline" ? "yellow" : "neutral"}>{cameraText[data.camera]}</Pill>
        <button className={`${ui.button} ${ui.primary}`} role="switch" aria-label="Nguồn camera" aria-checked={enabled} disabled={busy}
          onClick={() => void run("camera", "PATCH", { power: !enabled }, enabled ? "Đã tắt camera." : "Đã lưu yêu cầu bật. Camera đang ngoại tuyến.")}>
          {enabled ? "Tắt camera" : "Bật camera"}
        </button>
      </div>
      {issue && <p className={ui.error} role="alert">{issue.message}</p>}
      <div className={styles.cameraFrame}><div>
        {enabled ? <WifiOff size={32} /> : <CameraOff size={32} />}
        <strong>{cameraText[data.camera]}</strong>
        {enabled && <p>Chưa kết nối phần cứng ESP32-CAM.</p>}
      </div></div>
    </Panel>}</DataBoundary>
  </div>;
}
