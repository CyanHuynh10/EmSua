# Báo cáo thực thi Lighting Sữa Smart Home

## Lighting Integration V1.0 · 27/11/2026

- Website đã có Simulation Mode cho Lighting. Device API xác thực bằng token riêng. Hàng đợi FIFO lưu lệnh trong PostgreSQL và chỉ hoàn thành lệnh khi ESP32 gửi ACK hợp lệ. Dashboard dùng trạng thái do thiết bị báo cáo.
- Supabase project Mock hiện có đã nhận migration `lighting_simulation`, phiên bản hosted `20261126173235`, sau khi người dùng phê duyệt việc dùng chung với Production. Đã kiểm tra RLS của hàng đợi, quyền thực thi dành cho `service_role` và quyền bị từ chối với `anon`. Lịch Mock và Simulation dùng hai tập bản ghi trong cùng bảng. Feeder và Camera dùng Mock.
- Website dùng Next.js 16.4.6 và Node.js 24.16.0 trong phiên kiểm thử. Vitest chạy 15 ca trên PostgreSQL PGlite. Playwright chạy kiểm thử website trên Microsoft Edge với client HTTP đóng vai thiết bị. Các kiểm thử này xác minh ACK, lỗi driver mô phỏng, trạng thái hai chiều và giao diện desktop/mobile. Bằng chứng phần cứng cần lấy từ tab Wokwi.
- Firmware ESP-IDF v5.5.4 build được cho ESP32. Lớp Lighting dùng GPIO23 cho NeoPixel, GPIO21 cho nút và ADC1_CH6/GPIO34 cho biến trở. Wi-Fi, SNTP, HTTPS và xác nhận lệnh chạy trong task riêng. Cấu hình test nằm ngoài Git.
- Nhánh tích hợp dự kiến `codex/lighting-wokwi-integration` dùng Vercel Preview của project `emsua`. Phiên nghiệm thu sử dụng [project Wokwi Em Sữa trong Edge](https://wokwi.com/projects/481740025407666177). Xem các bước chạy, log và cấu hình trong [tài liệu firmware](README.md).

## Lighting Simulation độc lập · Báo cáo lịch sử

**Phiên 26/11/2026 · Phase 01 · Workspace EmSua**

Firmware Lighting đã được dựng lại và build thành công cho ESP32. Sơ đồ đã qua kiểm tra tĩnh và các ca kiểm thử C++ trên máy đã đạt. Mô phỏng Wokwi vẫn **BLOCKED** vì CLI thiếu token và chưa tìm thấy license VS Code đã lưu. Tiêu chí nghiệm thu Lighting trên simulator còn mở.

## A. Môi trường thực thi

| Thành phần | Phiên bản xác minh |
| --- | --- |
| Hệ điều hành và shell | Windows build 26300, PowerShell 7.6.9 |
| IDE | VS Code 1.147.0 |
| Extension | ESP-IDF 2.3.0, Wokwi 4.1.0, C/C++ 1.35.6 |
| SDK và compiler | ESP-IDF v5.5.4, Xtensa GCC 14.2.0 |
| Công cụ build | CMake 3.30.2, Ninja 1.12.1, Python 3.11.15 |
| Dependency | Component Manager 2.5.2, `espressif/led_strip` 2.5.5 |
| Trình mô phỏng | Wokwi CLI 0.29.1 và extension Wokwi đã cài |

Espressif Installation Manager cài SDK và công cụ vào `fix/esp-tools/`. Installer cũng tạo shortcut IDF PowerShell.

## B. Sơ đồ Wokwi

Wokwi trả HTTP 200 khi tải sơ đồ project **Em Sữa ✨🍼**, ID `481740025407666177`. Bản local giữ nguyên ID, tọa độ, thuộc tính, màu và đường đi của tám dây phần cứng cùng hai đường UART ảo. Thay đổi duy nhất là bỏ NeoPixel rời `rgb1` vốn để trống. Sơ đồ local có thể cập nhật bằng cách sao chép và đối chiếu lại với project web. [Project gốc](https://wokwi.com/projects/481740025407666177) · [Sơ đồ local](diagram.json)

Lệnh `wokwi-cli lint --warnings-as-errors` trả mã 0 và ghi một thông báo mức info `unsupported-part` cho `board-esp32-devkit-c-v4`. Mã part này có trong danh sách board được hỗ trợ của Wokwi. [Định dạng sơ đồ Wokwi](https://docs.wokwi.com/diagram-format)

## C. File bàn giao

| Đường dẫn trong controller | Nội dung |
| --- | --- |
| `main/main.cpp`, `main/lighting.cpp`, `main/lighting.hpp` | Firmware C++ và lớp Lighting |
| `CMakeLists.txt`, `main/CMakeLists.txt`, `sdkconfig.defaults` | Cấu hình build ESP32 |
| `main/idf_component.yml`, `dependencies.lock` | Phiên bản dependency đã khóa |
| `diagram.json`, `wokwi.toml` | Sơ đồ và cấu hình mô phỏng |
| `tests/lighting.scenario.yaml` | Kịch bản kiểm thử Wokwi |
| `.gitignore`, `README.md`, `REPORT.md` | Quy tắc bỏ qua artifact, hướng dẫn và báo cáo |

ESP-IDF đã tạo `sdkconfig`, `managed_components/` và `build/`. `firmware/camera/` là thư mục trống.

## D. Phần cứng

| Kết nối | GPIO hoặc nguồn |
| --- | --- |
| DIN của vòng WS2812 16 LED | GPIO23 |
| VCC và GND của vòng | 5V và GND.2 |
| Nút xanh `1.l` và `2.l` | GPIO21 và GND.3 |
| SIG của biến trở | GPIO34, ADC1 Channel 6 |
| VCC và GND của biến trở | 3V3 và GND.1 |

ESP32 DevKitC V4 38 chân nằm giữa sơ đồ, biến trở bên trái, vòng LED phía trên bên phải và nút xanh phía dưới bên phải. GPIO21 dùng pull-up nội, DOUT của vòng để trống. Cấp nguồn 5V cho vòng LED là cấu hình mô phỏng.

## E. Firmware

Lighting khởi tạo OFF/50% và điều khiển 16 LED trắng qua RMT. Nút nhấn dùng cạnh xuống với debounce 50 ms. ADC Oneshot lấy trung bình bốn mẫu mỗi 50 ms và chỉ cập nhật khi phát hiện biến trở dịch chuyển đủ. Mức sáng 0–100% được giữ trong RAM qua các lần bật/tắt, kể cả khi chỉnh lúc OFF.

UART0 đọc không chờ các lệnh `1`, `0`, `t`, `+`, `-` và `s`. Lệnh nguồn trùng trạng thái ghi `Skipped`. Khi driver LED báo lỗi, firmware ghi log và giữ giá trị trạng thái đã xác nhận trước lần ghi đó.

## F. Build ESP32

**PASS.** Đã chạy `idf.py --version`, `cmake --version`, `ninja --version` và `idf.py build`. CMake chọn target `esp32` từ cấu hình mặc định. Build đầy đủ không ghi nhận lỗi hay cảnh báo compiler. Cảnh báo đường dẫn Python venv của lần đầu biến mất khi chuẩn hóa đường dẫn và build lại. [Log build đầy đủ](../../fix/lighting-build.log) · [Log build lại](../../fix/lighting-rebuild.log)

| Artifact | Kết quả xác minh |
| --- | --- |
| `build/controller.bin` | 185.040 byte tại offset `0x10000`, phân vùng ứng dụng còn 82% |
| `build/controller.elf` | 3.115.836 byte, xác minh chữ ký ELF |
| `build/bootloader/bootloader.bin` | 26.160 byte tại offset `0x1000` |
| `build/partition_table/partition-table.bin` | 3.072 byte tại offset `0x8000` |
| `build/flasher_args.json` | Target ESP32, flash 4 MB, đủ ảnh flash mà cấu hình tham chiếu |

## G. Kiểm thử Wokwi

Các ca kiểm thử C++ trên máy chạy lớp `Lighting` thật với driver giả lập. Trạng thái trong bảng phản ánh kết quả kiểm tra sơ đồ và những ca đã chạy trên Wokwi.

| Ca kiểm thử | Trạng thái Wokwi | Bằng chứng hiện có |
| --- | --- | --- |
| Kiểm tra sơ đồ | PASS | Lint mã 0 và đối chiếu với sơ đồ đã tải |
| Khởi động | NOT TESTED | C++ trên máy xác nhận khởi tạo OFF/50% |
| Bật | NOT TESTED | C++ trên máy xác nhận 16 giá trị RGB bằng nhau |
| Tắt | NOT TESTED | C++ trên máy xác nhận RGB về 0 |
| Debounce | NOT TESTED | C++ trên máy xác nhận bỏ qua xung ngắn và giữ nút chỉ đảo một lần |
| Điều chỉnh sáng | NOT TESTED | C++ trên máy xác nhận thay đổi giá trị ADC cập nhật mức sáng |
| Các mốc độ sáng | NOT TESTED | C++ trên máy xác nhận RGB tại 0%, 25%, 50%, 75% và 100% |
| Giữ độ sáng | NOT TESTED | C++ trên máy xác nhận bật lại ở 75% |
| Chỉnh sáng khi OFF | NOT TESTED | C++ trên máy xác nhận giữ OFF và dùng mức mới khi bật |
| Lệnh trùng trạng thái | NOT TESTED | C++ trên máy xác nhận log skipped và bỏ qua ghi LED dư thừa |
| Lệnh Serial | NOT TESTED | Kịch bản YAML đọc được và có đủ sáu lệnh |
| Khởi động lại | NOT TESTED | C++ trên máy xác nhận lần khởi tạo mới trở về OFF/50% |
| Độ ổn định | NOT TESTED | Đã kiểm tra xử lý lỗi ADC và RMT bằng driver giả lập trong bộ kiểm thử C++ |

## H. Điều kiện nghiệm thu còn mở

CLI dừng với lỗi `Missing WOKWI_CLI_TOKEN` khi chạy kịch bản. Chưa tìm thấy license đã lưu cho extension VS Code. Cần một trong hai hình thức kích hoạt để xác minh vòng LED, nút nhấn, biến trở, UART, reset và độ ổn định trong simulator. [Hướng dẫn kích hoạt Wokwi](https://docs.wokwi.com/vscode/getting-started)

## I. Phạm vi thay đổi

File bàn giao nằm trong `firmware/`. Bộ công cụ, bản sao sơ đồ nguồn và log nằm trong `fix/`. Các lệnh Git trên repository EmSua chỉ đọc trạng thái và diff. Các thao tác stage, commit, push, deploy, flash thiết bị, sửa website, sửa Supabase và ghi vào project Wokwi trực tuyến đều không được thực hiện.

## J. Chạy nghiệm thu

1. Mở riêng `firmware/controller` trong VS Code và mở ESP-IDF Terminal theo [README](README.md).
2. Chạy `idf.py build`. Nếu cần license, dùng **Wokwi: Request a New License** rồi chọn **Wokwi: Start Simulator**.
3. Xác nhận log `Ready` và vòng LED tắt lúc boot. Thử nút nhấn, quét biến trở từ 0% đến 100% và kiểm tra giữ mức sáng qua OFF/ON.
4. Gửi sáu lệnh UART, khởi động lại simulator và theo dõi Serial Monitor. Nếu có lỗi, lưu log từ lúc boot đến thao tác gây lỗi.
