import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, password = process.env.SUA_E2E_PASSWORD!) {
  await page.getByLabel("Tài khoản").fill("e2e-admin");
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

test("protects routes and APIs, validates login and preserves the session through reload", async ({ page, request }) => {
  const response = await request.get("/api/dashboard");
  expect(response.status()).toBe(401);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "wrong password");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Sai tài khoản hoặc mật khẩu.");
  await login(page);
  await expect(page.getByRole("heading", { name: "Nhà của Sữa" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Thiết bị" })).toBeVisible();
  const protectedResponse = await page.request.patch("/api/camera", { data: { power: true } });
  expect(protectedResponse.status()).toBe(403);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(async () => (await page.request.get("/api/settings")).status()).toBe(401);
});

test("shows the feeder confirmation, prevents double submission and dismisses the toast", async ({ page }) => {
  await page.goto("/login");
  await login(page);
  await page.getByRole("navigation").getByRole("link", { name: "Cho ăn", exact: true }).click();
  await page.getByRole("button", { name: "Cho Sữa ăn ngay" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Cho Sữa ăn ngay" }).click();
  let calls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/feeder/dispense")) calls++; });
  await page.getByRole("button", { name: "Xác nhận cho ăn" }).dblclick();
  await expect(page.getByRole("status")).toContainText("Đã bắt đầu chu trình");
  expect(calls).toBe(1);
  await page.getByRole("heading", { name: "Máy cho ăn" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("controls the light and camera and detects a stale settings version", async ({ page, baseURL }) => {
  await page.goto("/login");
  await login(page);
  await page.getByRole("link", { name: "Đèn", exact: true }).click();
  await page.getByRole("switch", { name: "Nguồn đèn" }).click();
  await expect(page.getByRole("switch", { name: "Nguồn đèn" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Độ sáng").focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Lưu độ sáng" }).click();
  await expect(page.getByRole("button", { name: "Lưu độ sáng" })).toBeDisabled();
  await page.getByRole("switch", { name: "Nguồn đèn" }).click();
  await expect(page.getByRole("switch", { name: "Nguồn đèn" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Độ sáng")).toHaveValue("100");
  await page.getByRole("link", { name: "Camera", exact: true }).click();
  await expect(page.getByText("Đã tắt").first()).toBeVisible();
  await page.getByRole("switch", { name: "Nguồn camera" }).click();
  await expect(page.getByText("Ngoại tuyến").first()).toBeVisible();
  await expect(page.locator("video, input[type=file]")).toHaveCount(0);
  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();
  const field = page.getByLabel("Thời gian mở (ms)");
  await field.fill("1100");
  const current = await (await page.request.get("/api/settings")).json();
  const change = await page.request.patch("/api/settings", {
    headers: { Origin: baseURL! }, data: { servo_ms: 1500, version: current.data.version },
  });
  expect(change.status()).toBe(200);
  await page.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Dữ liệu đã thay đổi");
  await page.getByRole("button", { name: "Tải dữ liệu mới" }).click();
  await expect(field).toHaveValue("1500");
});

test("renders all required widths without horizontal overflow, console errors or blocked navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await login(page);
  await expect(page.getByRole("heading", { name: "Thiết bị" })).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await expect(nav.getByRole("link", { name: "Tổng quan" })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const bounds = await nav.boundingBox();
    if (width <= 800) expect(bounds!.y + bounds!.height).toBeCloseTo(900);
    else expect(bounds!.x + bounds!.width).toBeLessThan(230);
    expect(await page.getByRole("link", { name: "Điều chỉnh đèn" }).evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(.01);
    await page.screenshot({ path: `fix/dashboard-${width}.png`, fullPage: true });
  }
  for (const [name, heading] of [["Cho ăn", "Máy cho ăn"], ["Đèn", "Đèn"], ["Camera", "Camera"], ["Cài đặt", "Cài đặt"]]) {
    await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
