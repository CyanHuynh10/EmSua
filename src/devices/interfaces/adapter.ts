import type { CameraState } from "@/features/model";

export interface FeederSimulation {
  fail: boolean;
}

export interface DeviceAdapter {
  readonly mode: "mock" | "esp32";
  readonly connected: boolean;
  feederSimulation(): FeederSimulation;
  cameraState(enabled: boolean): CameraState;
}
