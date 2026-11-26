import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("website and device HTTP client synchronize Lighting through the local database", async ({ page, request }, testInfo) => {
  const bootId = randomUUID();
  const token = process.env.SUA_E2E_LIGHTING_TOKEN!;
  const headers = { "X-Device-Id": "sua-controller-wokwi-01", Authorization: `Bearer ${token}` };
  const initial = { power: false, brightness: 50 };
  const device = (path: string, data = {}) => request.post(`/api/device/${path}`, { headers, data: { bootId, ...data } });
  const claim = async () => {
    const response = await device("commands/claim");
    if (response.status() === 429) return null;
    expect(response.ok()).toBe(true);
    return (await response.json()).data.command as { id: string; leaseId: string; payload: object } | null;
  };

  const unauthorized = await request.post("/api/device/commands/claim", {
    headers: { ...headers, Authorization: "Bearer invalid" }, data: { bootId },
  });
  expect(unauthorized.status()).toBe(401);
  const wrongDevice = await request.post("/api/device/commands/claim", {
    headers: { ...headers, "X-Device-Id": "not-this-device" }, data: { bootId },
  });
  expect(wrongDevice.status()).toBe(401);
  expect((await request.get("/api/dashboard", { headers })).status()).toBe(401);

  await page.goto("/login");
  await page.getByLabel("Tài khoản").fill("e2e-admin");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(process.env.SUA_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();
  await page.getByLabel("Chế độ đèn").selectOption("simulation");
  await expect(page.getByText("Đã đổi chế độ đèn.")).toBeVisible();
  await page.getByRole("link", { name: "Đèn", exact: true }).click();
  const power = page.getByRole("switch", { name: "Nguồn đèn" });
  const slider = page.getByRole("slider", { name: "Độ sáng" });
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(power).toBeDisabled();
  const boot = await device("heartbeat", { boot: true, firmwareVersion: "test-http-client", stateVersion: 0, state: initial });
  expect(boot.status()).toBe(200);
  await expect(page.getByText("Online", { exact: true })).toBeVisible({ timeout: 8000 });

  const accepted = page.waitForResponse((response) => response.url().endsWith("/api/light") && response.request().method() === "PATCH");
  await power.click();
  const pending = await accepted;
  const { commandId, status } = (await pending.json()).data;
  expect(pending.status()).toBe(202);
  expect(status).toBe("pending");
  await expect(page.getByText("Đang chờ ESP32 phản hồi")).toBeVisible();
  await expect(power).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("ESP32 đã bật đèn.")).toHaveCount(0);
  const on = (await claim())!;
  expect(on).toMatchObject({ id: commandId, payload: { power: true } });
  const ack = { commandId, leaseId: on.leaseId, status: "completed", stateVersion: 1, state: { ...initial, power: true } };
  expect((await device("commands/ack", ack)).status()).toBe(200);
  expect((await (await device("commands/ack", ack)).json()).data.duplicate).toBe(true);
  await expect(power).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("ESP32 đã bật đèn.")).toBeVisible();
  testInfo.annotations.push({ type: "local HTTP command", description: commandId });
  await page.screenshot({ path: testInfo.outputPath("lighting-desktop-http.png"), fullPage: true });

  expect((await device("state", { source: "local_button", stateVersion: 2, state: initial })).status()).toBe(200);
  await expect(power).toHaveAttribute("aria-checked", "false", { timeout: 8000 });
  expect((await device("state", { source: "local_potentiometer", stateVersion: 3, state: { ...initial, brightness: 75 } })).status()).toBe(200);
  await expect(slider).toHaveValue("75", { timeout: 8000 });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("lighting-mobile-http.png"), fullPage: true });

  let sliderRequests = 0;
  page.on("request", (entry) => {
    if (entry.url().endsWith("/api/light") && entry.method() === "PATCH") sliderRequests++;
  });
  await slider.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("End");
  const sliderResult: { command: Awaited<ReturnType<typeof claim>> } = { command: null };
  await expect.poll(async () => {
    sliderResult.command ??= await claim();
    return sliderResult.command?.payload;
  }).toEqual({ brightness: 100 });
  expect(sliderRequests).toBe(1);
  const brightness = sliderResult.command!;
  const failed = await device("commands/ack", { commandId: brightness.id, leaseId: brightness.leaseId,
    stateVersion: 3, status: "failed", errorCode: "LED_DRIVER_ERROR" });
  expect(failed.status()).toBe(200);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("ESP32 không thực hiện được lệnh đèn.");
  await expect(slider).toHaveValue("75");
  await page.getByRole("link", { name: "Tổng quan", exact: true }).click();
  await expect(page.getByText("Mức sáng xác nhận · 75%")).toBeVisible();

  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();
  await page.getByLabel("Chế độ đèn").selectOption("mock");
  await expect(page.getByText("Đã đổi chế độ đèn.")).toBeVisible();
  await page.getByRole("link", { name: "Đèn", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lưu độ sáng" })).toBeVisible();
  expect(await claim()).toBeNull();
});
