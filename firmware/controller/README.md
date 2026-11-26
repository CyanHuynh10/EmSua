# Sữa Smart Home · Lighting

Firmware local cho ESP32 DevKitC V4, dùng C++, ESP-IDF, FreeRTOS, CMake, ESP-IDF Component Manager, GPIO, ADC Oneshot và RMT. Nút xanh bật/tắt cả vòng 16 LED trắng. Biến trở điều chỉnh độ sáng 0–100%. Khi khởi động, đèn ở trạng thái OFF với độ sáng 50%. Mức sáng được giữ trong RAM khi bật/tắt và trở về 50% khi khởi động lại.

Môi trường được cài bằng Espressif Installation Manager là ESP-IDF v5.5.4, GCC Xtensa 14.2.0 (`esp-14.2.0_20260121`), Python 3.11.15, CMake 3.30.2, Ninja 1.12.1 và ESP-IDF Component Manager 2.5.2. Driver `espressif/led_strip` 2.5.5 được khóa trong `main/idf_component.yml`.

## Sơ đồ Wokwi

Project gốc mang tên **Em Sữa ✨🍼**, ID **481740025407666177**. Sơ đồ được tải trực tiếp ngày **26/11/2026** vào workspace. Bản local giữ ID, tọa độ, thuộc tính, màu và đường đi của tám dây phần cứng, cùng hai kết nối UART ảo. NeoPixel rời `rgb1` để trống trong bản gốc đã được bỏ khỏi bản local. [Project Wokwi gốc](https://wokwi.com/projects/481740025407666177)

Wokwi for VS Code mở `firmware/controller/diagram.json` và nạp bộ artifact local qua `wokwi.toml`. Liên kết với project web là tham chiếu một chiều. Để cập nhật sơ đồ, mở project web, sao chép tab `diagram.json` hoặc tải project theo hướng dẫn Wokwi, rồi đối chiếu GPIO, ID linh kiện và dây trước khi thay nội dung local. Các thay đổi mã nguồn của giai đoạn này được lưu local. [Hướng dẫn chuyển project Wokwi sang VS Code](https://docs.wokwi.com/vscode/migrating)

| Linh kiện | ID | Vị trí |
| --- | --- | --- |
| ESP32 DevKitC V4 38 chân | `esp` | Giữa |
| Vòng NeoPixel tương thích WS2812, 16 LED | `ring1` | Trên bên phải |
| Nút nhấn xanh | `btn1` | Dưới bên phải |
| Biến trở tuyến tính | `pot1` | Bên trái |

| ESP32 | Linh kiện | Màu dây |
| --- | --- | --- |
| GPIO23 | `ring1:DIN` | Vàng |
| 5V | `ring1:VCC` | Đỏ |
| GND.2 | `ring1:GND` | Xám |
| GPIO21 | `btn1:1.l` | Xanh lá |
| GND.3 | `btn1:2.l` | Xám |
| GPIO34, ADC1 Channel 6 | `pot1:SIG` | Xanh dương |
| 3V3 | `pot1:VCC` | Đỏ |
| GND.1 | `pot1:GND` | Xám |

GPIO21 dùng pull-up nội và nút kéo xuống GND khi nhấn. DOUT của vòng LED để trống. UART0 dùng hai kết nối ảo giữa ESP32 và `$serialMonitor`. Sơ đồ cấp nguồn 5V cho NeoPixel chỉ phục vụ mô phỏng.

Wokwi CLI 0.29.1 lint trả mã 0, với một thông báo mức info `unsupported-part` cho `board-esp32-devkit-c-v4`. Tài liệu Wokwi liệt kê đúng mã này trong danh sách board được hỗ trợ. Đối chiếu với sơ đồ gốc xác nhận board, chân, thuộc tính và cả mười kết nối. [Định dạng sơ đồ Wokwi](https://docs.wokwi.com/diagram-format)

## Cấu trúc và môi trường

- `main/main.cpp` khởi tạo hệ thống và điều phối nút, ADC, UART và lệnh mạng trong task điều khiển LED.
- `main/lighting.hpp` và `main/lighting.cpp` quản lý trạng thái nguồn, độ sáng, debounce 50 ms và xuất khung RGB qua RMT.
- `main/device_client.cpp` chạy Wi-Fi, SNTP và HTTPS trong task riêng. FreeRTOS queue truyền lệnh, trạng thái và kết quả giữa hai task.
- `CMakeLists.txt`, `main/CMakeLists.txt`, `main/idf_component.yml` và `sdkconfig.defaults` cấu hình build cho target `esp32`.
- `diagram.json` và `wokwi.toml` cấu hình mạch và firmware Wokwi.
- `tests/lighting.scenario.yaml` mô tả kiểm thử nút, biến trở và lệnh UART bằng Wokwi CLI.
- Lịch Wokwi do scheduler của website/backend gửi khi tab hiển thị. Firmware xử lý lệnh lịch qua cùng hàng đợi Lighting.

Các extension có trên máy là ESP-IDF 2.3.0, Wokwi 4.1.0 và C/C++ 1.35.6. Mở riêng thư mục `firmware/controller` trong VS Code bằng **File → Open Folder**. Có thể dùng shortcut **IDF PowerShell** do EIM tạo. Với terminal PowerShell mở tại `firmware/controller`, kích hoạt bộ công cụ local và build bằng các lệnh sau.

```powershell
. ../../fix/esp-tools/Microsoft.v5.5.4.PowerShell_profile.ps1
$env:IDF_PYTHON_ENV_PATH = (Resolve-Path -LiteralPath $env:IDF_PYTHON_ENV_PATH).Path
idf.py --version
idf.py build
```

Để dùng **ESP-IDF: Open ESP-IDF Terminal** trong extension, chỉ đường dẫn setting `idf.eimIdfJsonPath` đến file `fix/esp-tools/eim_idf.json` bằng đường dẫn tuyệt đối của máy, rồi chạy **ESP-IDF: Select Current ESP-IDF Version** và chọn v5.5.4. [Cấu hình ESP-IDF Extension với EIM](https://docs.espressif.com/projects/vscode-esp-idf-extension/en/latest/installation.html)

Target mặc định là `esp32`. Nếu terminal đang ép target khác, bỏ biến môi trường `IDF_TARGET` ở shell đó và chạy `idf.py set-target esp32` trước khi build. Cấu hình Wokwi sử dụng `build/flasher_args.json` và `build/controller.elf`. Bootloader, bảng phân vùng và binary ứng dụng được tham chiếu qua `flasher_args.json`. [Wokwi cho dự án ESP-IDF](https://docs.wokwi.com/vscode/esp-idf)

Build đã hoàn thành cho ESP32 với `led_strip` 2.5.5 và tạo `controller.bin`, `controller.elf`, `bootloader/bootloader.bin`, `partition_table/partition-table.bin` và `flasher_args.json` trong `build/`. Nhật ký build nằm tại `fix/lighting-build.log` trong repo.

## Chạy mô phỏng và kiểm thử

Mở [project Em Sữa trong Edge](https://wokwi.com/projects/481740025407666177). Từ thư mục `firmware/controller`, hợp nhất các ảnh ESP-IDF thành một file để mô phỏng trên web.

```powershell
idf.py build
python -m esptool --chip esp32 merge_bin -o build/wokwi-controller.bin --flash_mode dio --flash_size 4MB --flash_freq 40m 0x1000 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0x10000 build/controller.bin
```

Kiểm tra offsets trong `build/flasher_args.json` nếu thay đổi bảng phân vùng. Trong trình soạn thảo Wokwi, nhấn **F1 → Upload Firmware and Start Simulation…** và chọn `build/wokwi-controller.bin`. Lệnh này nạp binary vào phiên mô phỏng của tab. Giữ project gốc bằng cách không bấm **Save** sau những thay đổi thử nghiệm. [Nạp firmware ESP32 trên Wokwi](https://docs.wokwi.com/guides/esp32#custom-application-firmware)

### Kết nối Simulation Mode với website

Trong PowerShell tại thư mục `firmware/controller`, chọn URL HTTPS của Vercel Preview hoặc Development có thể truy cập từ Wokwi. Lệnh dưới tạo token 32 byte, lưu trong `main/device_config.local.hpp` và chỉ in SHA-256 để điền vào biến `LIGHTING_DEVICE_TOKEN_HASH` ở server. Lệnh giữ nguyên file nếu cấu hình local đã tồn tại. Với cấu hình có sẵn, chỉnh file cùng biến Preview qua giao diện quản trị tương ứng.

```powershell
try {
  $env:SUA_TEST_BACKEND = Read-Host 'URL HTTPS của Preview hoặc Development'
  @'
const { randomBytes, createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const url = new URL(process.env.SUA_TEST_BACKEND);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('Nhập origin HTTPS của website kiểm thử');
}
const token = randomBytes(32).toString('base64url');
writeFileSync('main/device_config.local.hpp', [
  '#pragma once',
  '#define SUA_DEVICE_BACKEND_URL ' + JSON.stringify(url.origin),
  '#define SUA_DEVICE_TOKEN ' + JSON.stringify(token),
  '#define SUA_VERCEL_BYPASS ""',
  '#define SUA_VERCEL_COOKIE ""',
  '',
].join('\n'), { flag: 'wx' });
console.log('LIGHTING_DEVICE_TOKEN_HASH=' + createHash('sha256').update(token).digest('hex'));
'@ | node
} finally {
  Remove-Item Env:SUA_TEST_BACKEND -ErrorAction SilentlyContinue
}
```

Nếu Preview dùng Deployment Protection, có thể dùng cookie truy cập có thời hạn của deployment Preview qua `SUA_VERCEL_COOKIE`, hoặc dùng token automation đã được quản trị viên cấp qua `SUA_VERCEL_BYPASS`. Giữ các giá trị này, token thiết bị và binary trong workspace local. Khi quyền truy cập ngắn hạn hết hạn, cập nhật giá trị và build lại trước phiên Wokwi tiếp theo. Firmware kết nối `Wokwi-GUEST` kênh 6, lấy thời gian qua SNTP và xác thực TLS qua ESP-IDF certificate bundle. Với `sdkconfig` cũ, có thể chạy `idf.py menuconfig` rồi kiểm tra **Partition Table → Single factory app (large), no OTA** và **Component config → mbedTLS → Certificate Bundle**. [Wokwi Wi-Fi](https://docs.wokwi.com/guides/esp32-wifi) · [Bảo vệ deployment Vercel](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection)

Khi kết nối thành công, xem dòng `HTTPS authenticated, heartbeat acknowledged`. Command ID trong dòng `Command received` và `ACK accepted for` dùng để đối chiếu với Vercel và Supabase. Mở **Cài đặt** để chọn Simulation Mode và xem heartbeat. Bật/tắt và thay đổi độ sáng trên trang **Đèn**, sau đó thử thao tác tại chỗ. `firmware/controller/main/device_config.example.hpp` giữ cấu hình rỗng để mô phỏng độc lập. Tài liệu schema, API và quy tắc xử lý lịch nằm trong [README website](../../README.md).

| UART0 (115200) | Tác dụng |
| --- | --- |
| `1` | Bật |
| `0` | Tắt |
| `t` | Đảo trạng thái |
| `+` | Tăng 10 điểm phần trăm |
| `-` | Giảm 10 điểm phần trăm |
| `s` | In trạng thái |

Các lệnh ON/OFF trùng trạng thái in `Skipped`. Mỗi lần ADC đọc trung bình bốn mẫu theo chu kỳ 50 ms. Biến trở phải dịch chuyển đủ để cập nhật mức sáng sau khi khởi động hoặc sau lệnh Serial. Khi OFF, thay đổi độ sáng chỉ cập nhật giá trị trong RAM. Khi ON ở 0%, vòng LED vẫn tối. Các mốc 0%, 25%, 50%, 75% và 100% tương ứng giá trị 0, 64, 128, 191 và 255 cho mỗi kênh RGB.

1. Mở Serial Monitor và kiểm tra `State: OFF | Brightness: 50%`, `Ready`, cùng vòng LED tối.
2. Nhấn nút xanh để bật 16 LED trắng, giữ nút hơn một giây, rồi nhả. Kiểm tra mỗi lần nhấn ổn định chỉ đảo một lần. Lặp lại với các lần nhấn nhanh có khoảng nhả.
3. Xoay biến trở từ thấp đến cao. Kiểm tra các mốc 0/25/50/75/100% bằng log và quan sát cả vòng sáng đồng đều. Có thể dùng Home/End khi biến trở có tiêu điểm.
4. Đặt 75%, tắt rồi bật và kiểm tra mức 75%. Tắt, đổi độ sáng, xác nhận vòng vẫn tối rồi bật lại để kiểm tra mức mới.
5. Gửi `11`, `00`, `t`, `+`, `-`, `s`. Kiểm tra log skipped và xác nhận biến trở đứng yên giữ mức Serial. Thử nút và biến trở xen kẽ khi gửi lệnh.
6. Khởi động lại simulator và kiểm tra OFF/50%. Lặp lại các thao tác và theo dõi lỗi ADC, RMT, bộ nhớ, watchdog hoặc reset bất ngờ.

Có thể dùng CLI để kiểm tra sơ đồ và chạy bài kiểm thử logic qua Serial khi có token Wokwi hợp lệ. Bài kiểm thử tự động đọc log, phần quan sát vòng LED và xác minh reset cần chạy theo checklist trên. [Tài liệu bài kiểm thử Wokwi CLI](https://docs.wokwi.com/wokwi-ci/automation-scenarios)

```powershell
wokwi-cli lint
wokwi-cli . --timeout 15000 --scenario tests/lighting.scenario.yaml
```

Trong phiên bàn giao, CLI báo thiếu `WOKWI_CLI_TOKEN` và chưa xác minh được license VS Code. Kiểm thử C++ trên máy đã chạy lớp `Lighting` với driver giả lập cho các ca debounce, bật/tắt, RGB, giữ độ sáng và xử lý lỗi ADC/RMT. Kiểm thử Wokwi và xác minh UART vẫn chờ chạy.

## Xử lý lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| PowerShell báo không tìm thấy `idf.py` | Mở terminal ESP-IDF đã kích hoạt SDK và kiểm tra `idf.py --version`. |
| Component Manager không tải được `led_strip` | Kiểm tra truy cập Component Registry và phiên bản ESP-IDF từ 5.5 đến trước 6.0. |
| Wokwi báo thiếu image | Chạy build từ thư mục controller và kiểm tra các file trong `build/` theo `wokwi.toml`. |
| Wokwi báo thiếu license hoặc CLI báo thiếu token | Dùng luồng kích hoạt của extension hoặc token Wokwi CI tương ứng. |
| Wi-Fi đã kết nối, HTTPS chưa bắt đầu | Xem SNTP, DNS và mạng Internet của Wokwi. Giữ xác thực chứng chỉ TLS bật. |
| API Device trả 401 hoặc 403 | Kiểm tra đúng Device ID, SHA-256 của token, quyền truy cập Preview và cấu hình bypass nếu có. |
| API Device trả 409 | Đối chiếu command ID, lease, thời hạn và phiên khởi động. Chạy một simulator cho mỗi Device ID. |
| Có log khởi tạo nhưng thiếu `Ready` | Kiểm tra mã lỗi bên cạnh cấu hình GPIO, ADC hoặc RMT trong Serial Monitor. |
| Serial chỉ có log đầu ra | Kiểm tra UART0 và hai kết nối `esp:TX` → `$serialMonitor:RX`, `esp:RX` ← `$serialMonitor:TX`. |

## Giới hạn

Giai đoạn này tập trung vào mô phỏng Lighting. Thiết kế nguồn 5V, dòng tổng, GND chung, chuyển mức 3,3V sang 5V, bảo vệ đường dữ liệu, tụ lọc và tản nhiệt cần xác minh riêng trước khi dùng phần cứng thật. Có thể mở rộng các module sau qua interface `Lighting`, với các lời gọi chạy cùng task hoặc có đồng bộ khi chuyển sang nhiều task.
