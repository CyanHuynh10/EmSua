import type { DeviceAdapter } from "../interfaces/adapter";

export class MockAdapter implements DeviceAdapter {
  readonly mode = "mock";
  readonly connected = false;

  feederSimulation() {
    return { fail: process.env.MOCK_FEEDER_FAILURE === "1" };
  }

  cameraState(enabled: boolean) {
    return enabled ? "offline" as const : "off" as const;
  }
}
