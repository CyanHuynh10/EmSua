# Sữa Smart Home

Ứng dụng quản trị ngôi nhà IoT của mèo Sữa. Mock Mode lưu trạng thái và kết quả mỗi chu trình trong PostgreSQL. Khi yêu cầu bật camera trong Mock Mode, giao diện hiển thị trạng thái ngoại tuyến.

## Công nghệ và mã nguồn

| Thư mục | Nội dung |
| --- | --- |
| `font/` | SVN-Cintra và SVN-Agency FB từ workspace |
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

## Kiểm thử

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest chạy migration thật trên PostgreSQL nhúng. Playwright khởi động database thử nghiệm riêng trên cổng 54329 và Next.js trên cổng 3100, dùng mật khẩu và khóa ngẫu nhiên theo lần chạy. Database fixture chỉ phục vụ kiểm thử, còn ứng dụng dùng Supabase qua REST trong các môi trường triển khai. Có thể dùng Chrome cài sẵn bằng cách đặt `SUA_E2E_BROWSER_CHANNEL=chrome`. Ảnh QA được lưu trong `fix/`.

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

Triển khai kênh xác thực thiết bị, giao thức lệnh có idempotency và xác nhận kết quả, điều khiển servo có giới hạn ngay trên phần cứng và thực thi lịch trên ESP32. Định nghĩa luồng streaming riêng cho ESP32-CAM. Xem [điểm tích hợp ESP32](src/devices/esp32/README.md).
