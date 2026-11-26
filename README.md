# Sữa Smart Home

Ứng dụng quản trị ngôi nhà IoT của mèo Sữa. Mock Mode lưu trạng thái và kết quả mỗi chu trình trong PostgreSQL. Khi yêu cầu bật camera trong Mock Mode, giao diện hiển thị trạng thái ngoại tuyến.

## Công nghệ và mã nguồn

| Thư mục | Nội dung |
| --- | --- |
| `font/` | SVN-Cintra cho thương hiệu Sữa, SVN-Gotham Ultra cho tiêu đề đậm và SVN-Gotham Light cho nội dung |
| `src/app/` | Next.js App Router, trang đăng nhập, các trang điều khiển và Route Handlers |
| `src/components/`, `src/features/` | React, Lucide, CSS Modules và các luồng tương tác |
| `src/server/`, `src/devices/` | Xác thực, truy cập Supabase, adapter Mock và điểm tích hợp ESP32 |
| `supabase/migrations/` | Schema, quyền truy cập và các giao dịch nghiệp vụ PostgreSQL |
| `tests/` | Vitest, PostgreSQL nhúng PGlite và Playwright |
| `fix/` | Artifact debug cục bộ, đã được Git bỏ qua |

## Chạy với VS Code

1. Mở thư mục `EmSua` trong VS Code. Dùng Node.js 22.12 trở lên và npm.
2. Chạy `npm ci` trong VS Code Terminal.
3. Chuẩn bị Supabase Development, áp dụng migration và tạo `.env.local` theo hướng dẫn bên dưới.
4. Chạy `npm run dev` và mở [localhost:3000](http://localhost:3000).

### Supabase Development

Trong dự án Supabase Development, chạy toàn bộ [migration khởi tạo](supabase/migrations/202611230001_init.sql) một lần bằng SQL Editor hoặc đưa vào pipeline migration của dự án. Script khởi tạo dữ liệu cho ba thiết bị và cấu hình servo. Kiểm tra các bảng và RPC `sua_snapshot`, `sua_mutate`, `sua_activity`, `sua_login_limit`. Các RPC ứng dụng dùng quyền `service_role`.

Sao chép `.env.example` thành `.env.local` và điền các giá trị:

| Biến | Giá trị |
| --- | --- |
| `SUPABASE_URL` | URL API của dự án Development |
| `SUPABASE_SECRET_KEY` | Secret key lấy từ API Keys của dự án |
| `ADMIN_USERNAME` | Tên tài khoản Admin duy nhất |
| `ADMIN_PASSWORD_HASH` | Hash scrypt của mật khẩu Admin |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên tối thiểu 32 byte |
| `APP_ORIGIN` | Origin chính xác của ứng dụng, ví dụ `http://localhost:3000` cho local |
| `DEVICE_MODE` | `mock` |
| `MOCK_FEEDER_FAILURE` | `0` bình thường, `1` để kiểm thử chu trình lỗi trên Development |
| `LIGHTING_DEVICE_TOKEN_HASH` | SHA-256 hex của token Wokwi. Bật Simulation Mode ở Development hoặc Preview sau khi xác minh migration |

Có thể tạo thông tin Admin bằng Node và PowerShell. Dán kết quả trực tiếp vào cấu hình môi trường của bạn.

```powershell
try {
  $env:SUA_PASSWORD_INPUT = Read-Host "Mật khẩu Admin" -MaskInput
  node -e "const { randomBytes, scryptSync } = require('node:crypto'); const salt = randomBytes(16); const hash = scryptSync(process.env.SUA_PASSWORD_INPUT, salt, 64); console.log('ADMIN_PASSWORD_HASH=scrypt:' + salt.toString('hex') + ':' + hash.toString('hex')); console.log('SESSION_SECRET=' + randomBytes(32).toString('hex'))"
} finally {
  Remove-Item Env:SUA_PASSWORD_INPUT -ErrorAction SilentlyContinue
}
```

Phiên Admin dùng cookie trình duyệt với thời hạn server bốn giờ. Đổi mật khẩu, tên tài khoản hoặc khóa ký để vô hiệu hóa phiên cũ. Yêu cầu ghi dữ liệu kiểm tra origin và đăng nhập được giới hạn theo cửa sổ 10 phút trong PostgreSQL.

### Mock Mode

- Máy cho ăn nhận mã yêu cầu duy nhất, ghi bắt đầu chu trình rồi hoàn tất sau thời gian servo đã cấu hình. Giao diện thấy kết quả ở lần đồng bộ kế tiếp. Khi mất kết nối sau khi gửi, xác nhận lại từ cùng tab dùng mã yêu cầu cũ.
- Trang dashboard đang hiển thị gọi bộ xử lý lịch và tải trạng thái mỗi 15 giây. Khi quay lại tab, trang đồng bộ ngay. PostgreSQL dùng giờ Việt Nam, khóa các lệnh thay đổi và chỉ nhận lịch trong 30 giây kể từ giờ đặt. Lịch cũ được ghi nhận bỏ lỡ khi xử lý trở lại.
- Đèn giữ mức sáng đã lưu khi tắt hoặc khi xử lý lịch. Lịch vẫn có hiệu lực sau thao tác bật tắt thủ công.
- Camera Mock hiển thị `off` hoặc `offline`. Khung quan sát dành cho tích hợp ESP32-CAM.
- Cấu hình servo và lịch có phiên bản. Khi nhận 409, dùng **Tải dữ liệu mới** trong giao diện rồi thực hiện lại chỉnh sửa.

### Simulation Mode của Lighting

1. Xác minh Supabase Development riêng trong dashboard. Áp dụng migration khởi tạo nếu database mới, rồi chạy [migration Lighting](supabase/migrations/202611270001_lighting_simulation.sql). Với database đã có schema khởi tạo, kiểm tra migration history và chỉ chạy phần còn thiếu.
2. Tạo token riêng cho ESP32 và đặt `LIGHTING_DEVICE_TOKEN_HASH` theo [hướng dẫn firmware](firmware/controller/README.md). Cấu hình website Preview trỏ tới Supabase Development. Bật biến này sau khi kiểm tra thấy RPC `sua_lighting_sim` trên Development. Production Vercel vô hiệu hóa Device API.
3. Đăng nhập website Preview, mở **Cài đặt → Chế độ đèn → Simulation Mode — Wokwi**. Feeder và Camera tiếp tục dùng Mock Mode. Real Mode hiện hiển thị ở trạng thái chưa khả dụng.
4. Build firmware và nạp ảnh flash hợp nhất vào project Wokwi trong Edge theo [hướng dẫn firmware](firmware/controller/README.md). Đợi **Online** trong Cài đặt hoặc trang **Đèn**. Thử bật/tắt, trượt qua 0/25/50/75/100%, kiểm tra giữ 75% khi bật lại, rồi nhấn nút và xoay biến trở trong Wokwi. Đối chiếu trang Đèn, Dashboard, Serial Monitor và nhật ký.

`lighting_controller` ghi cấu hình Mock/Simulation, heartbeat, phiên khởi động và trạng thái đã xác nhận. `lighting_commands` ghi yêu cầu Lighting và giữ riêng chu trình Feeder. RLS bật trên hai bảng, quyền truy cập và gọi RPC dành cho `service_role`. ESP32 dùng một token chỉ dành cho `sua-controller-wokwi-01` trong môi trường kiểm thử. Xoay token bằng cách cập nhật hash phía server và build lại firmware với token mới.

Lệnh tạo ở trạng thái `pending`, được lấy tuần tự bằng `claimed` và lease 10 giây, rồi kết thúc ở `completed`, `failed`, `expired` hoặc `cancelled`. Lệnh thủ công có hạn 30 giây. Server khóa thao tác tạo, claim, ACK, đổi chế độ và cập nhật lịch bằng PostgreSQL. Idempotency theo UUID của lần gửi và ACK theo command ID cùng lease ID. Website hiển thị **Yêu cầu** riêng trong lúc chờ và thông báo thành công sau ACK. Event từ Wokwi dùng phiên khởi động cùng phiên bản tăng dần. Thao tác tại chỗ sau khi thực thi lệnh sẽ thắng khi được đồng bộ. Lệnh còn chờ vẫn được thực thi theo FIFO và chỉ thay trường được yêu cầu. Bản khởi động mới báo trạng thái thực tế, mặc định OFF/50%, và chấm dứt lệnh đang claim của phiên cũ.

Firmware gửi heartbeat mỗi 10 giây và hỏi lệnh theo chu kỳ 1–3 giây. Website tính Offline theo mốc 30 giây bằng thời gian server. Dashboard và trang Đèn dùng chung trạng thái đã báo cáo. Tab ẩn tạm dừng polling. Lịch Lighting Simulation do backend xử lý khi website đang mở ở tab hiển thị. Giữ Wokwi chạy vào giờ hẹn. PostgreSQL dùng lịch riêng cho từng mode, chỉ gửi mỗi mốc một lần, kiểm tra trạng thái đã phù hợp và giới hạn trong 30 giây. Lịch chỉ hoàn thành khi nhận ACK.

| API | Xác thực và kết quả |
| --- | --- |
| `GET /api/light`, `/api/dashboard`, `/api/devices`, `/api/settings`, `/api/activity` | Phiên Admin. Trạng thái xác nhận, kết nối và hoạt động theo tài nguyên |
| `PATCH /api/settings/lighting` | Phiên Admin và origin. `{ "mode": "mock" }` hoặc `{ "mode": "simulation" }` |
| `PATCH /api/light` | Phiên Admin và origin. Nhận `power`, `brightness` hoặc cả hai. `request_id` UUID và `expected_mode` là tùy chọn. Simulation trả 202 và `commandId` khi đang xử lý |
| `GET /api/light/commands/{id}` | Phiên Admin. Trạng thái lệnh và mã lỗi nếu có |
| `POST /api/device/heartbeat` | Bearer token và `X-Device-Id`. Nhận `bootId`, `boot`, `firmwareVersion`, `stateVersion`, `state` |
| `POST /api/device/commands/claim` | Bearer token và `X-Device-Id`. Nhận `bootId`, trả `command` hoặc `null`. Lệnh có `id`, `leaseId`, `type`, `payload`, `ttlMs` |
| `POST /api/device/commands/ack` | Bearer token và `X-Device-Id`. Nhận `bootId`, `commandId`, `leaseId`, `stateVersion`, `status`, kèm `state` khi thành công hoặc `errorCode` khi lỗi |
| `POST /api/device/state` | Bearer token và `X-Device-Id`. Nhận `bootId`, `stateVersion`, `state` và `source` là `local_button`, `local_potentiometer` hoặc `serial` |

`state` gồm `power` boolean và `brightness` nguyên 0–100. API dùng JSON, `Cache-Control: no-store`, và trả mã lỗi khi xác thực, lease hoặc trạng thái sai. Trong **Vercel → Logs**, lọc theo Preview và đường dẫn `/api/device/`. Tra cùng `commandId` trong Serial Monitor và bảng `lighting_commands`/`activity_logs` của Development. Với lỗi database, dùng **Supabase → Logs Explorer** và lọc theo mốc thời gian, RPC hoặc mã PostgreSQL.

## Kiểm thử

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest chạy migration thật trên PostgreSQL nhúng. Playwright khởi động database thử nghiệm riêng trên cổng 54329 và Next.js trên cổng 3100, dùng mật khẩu và khóa ngẫu nhiên theo lần chạy. Bài kiểm thử Lighting dùng client HTTP để gửi heartbeat, claim, ACK và state cho API local. Xác nhận LED thực thi và GPIO phản hồi bằng Wokwi. Đặt `SUA_E2E_BROWSER_CHANNEL=msedge` để dùng Edge. Ảnh QA được lưu trong `fix/`.

## GitHub và Vercel

Liên kết GitHub repository với dự án Vercel đã được chọn và xác nhận nhánh Production trong Settings. Đặt biến môi trường Vercel Preview và Local trỏ đến Supabase Development. Đặt môi trường Production trỏ đến một dự án Supabase Production riêng. `APP_ORIGIN` đặt theo domain phục vụ tương ứng. Với URL mặc định của Vercel, ứng dụng nhận các URL triển khai do biến hệ thống Vercel cung cấp.

- **Chỉ UI/UX**. Kiểm tra localhost, điều hướng, dialog, toast, console và các kích thước 360, 390, 768, 1024, 1440 px. Chạy lint, typecheck, build và các test liên quan rồi mới push.
- **Backend hoặc database**. Chạy lint, typecheck, test và build. Kiểm tra migration ở Development. Sau khi đạt điều kiện, commit và tự động push nhánh đã cấu hình. Nếu có migration bắt buộc, chờ xác nhận schema Production tương thích trước khi triển khai.
- **Thay đổi cả hai**. Hoàn thành cả hai nhóm kiểm tra trước khi push.
- Kiểm tra `git status`, `git diff --check` và danh sách staged files. Giữ secrets, `.env.local` và `fix/` ở máy local.
- Người quản trị chạy migration Production theo quy trình của dự án. Cần phê duyệt riêng trước khi tự động chạy migration Production.

Sau deployment, xem **Deployments** để xác nhận trạng thái build, URL và commit. Trong **Logs**, lọc theo môi trường và tuyến API. Kiểm tra đăng nhập, kết nối database và các luồng vừa thay đổi ở Preview. Dùng **Logs Explorer** của Supabase để đối chiếu thời điểm và mã lỗi PostgreSQL. Chỉ thực hiện kiểm tra ghi dữ liệu trên Production khi có phê duyệt phù hợp.

- [Vercel Git deployments](https://vercel.com/docs/git)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel runtime logs](https://vercel.com/docs/logs/runtime)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)

## Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Đăng nhập báo dịch vụ gián đoạn | Kiểm tra định dạng hash, độ dài khóa phiên, URL Supabase và RPC giới hạn đăng nhập |
| API trả 403 khi ghi | Kiểm tra `APP_ORIGIN` khớp scheme, host và port của trang |
| Supabase trả PGRST202 | Kiểm tra migration, môi trường trỏ tới đúng dự án và schema cache của PostgREST |
| Lịch báo bỏ lỡ | Đối chiếu giờ Việt Nam và xem tab có hiển thị trong cửa sổ 30 giây |
| Kết quả cho ăn chưa rõ | Xem hoạt động gần đây, xác nhận lại cùng yêu cầu từ tab hiện tại nếu cần |
| Nhận 409 khi lưu | Tải mới dữ liệu và kiểm tra phiên bản hoặc mốc lịch đã qua |

## Chuẩn bị ESP32

Trong lần triển khai phần cứng sau này, dùng danh tính và thông tin xác thực riêng cho từng bộ điều khiển, xác minh mạch nguồn và driver LED, và chọn một nơi thực thi lịch. Trước khi đưa cập nhật lên Production, cần nghiệm thu Wokwi hai chiều, rà soát migration và cấu hình Production riêng, sau đó xin phê duyệt triển khai. Xem [điểm tích hợp ESP32](src/devices/esp32/README.md) và [báo cáo Lighting](firmware/controller/REPORT.md).
