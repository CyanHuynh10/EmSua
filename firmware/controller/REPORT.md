# Báo cáo thực thi Lighting Sữa Smart Home

## Lighting Integration V1.0 · 27/11/2026

- Website đã có Simulation Mode cho Lighting. Device API xác thực bằng token riêng. Hàng đợi FIFO lưu lệnh trong PostgreSQL và chỉ hoàn thành lệnh khi ESP32 gửi ACK hợp lệ. Dashboard dùng trạng thái do thiết bị báo cáo.
- Supabase project Mock hiện có (`thuyqvqqtjcmjpupzrvu`) đã nhận `lighting_simulation` (`20261126173235`) và `scope_lighting_controller` (`20261126174625`) sau khi người dùng phê duyệt việc dùng chung với Production. Bản bổ sung xử lý lỗi `21000` bằng cách giới hạn cập nhật theo Device ID để tương thích `pg-safeupdate` của PostgREST. Đã xác minh RLS, quyền RPC của `service_role` và việc từ chối quyền RPC của `anon`. Lịch Mock và Simulation dùng hai tập bản ghi trong cùng bảng. Feeder và Camera dùng Mock. [Cấu hình Postgres của Supabase](https://supabase.com/docs/guides/database/custom-postgres-config)
- Website dùng Next.js 16.4.6 và Node.js 24.16.0 trong phiên kiểm thử. Lint, typecheck, build và 15 ca Vitest/PGlite đã qua. Năm ca Playwright trên Edge dùng website local và client HTTP thay mặt thiết bị để kiểm tra ACK, lỗi driver, trạng thái hai chiều, đăng nhập, điều hướng và responsive. Mã lệnh của ca local là `aac6ec09-778e-440f-afcc-aa9905da2508`. [Kết quả Playwright local](../../fix/lighting-edge-results.json)
- Firmware ESP-IDF v5.5.4 build được cho ESP32. Lớp Lighting dùng GPIO23 cho NeoPixel, GPIO21 cho nút và ADC1_CH6/GPIO34 cho biến trở. Wi-Fi, SNTP, HTTPS và xác nhận lệnh chạy trong task riêng. Cấu hình test nằm ngoài Git.
- Đã push nhánh `codex/lighting-wokwi-integration`. Bản Vercel Preview dùng để nghiệm thu build `READY` từ `a3999f7`; runtime log ghi `claim` và `ack` theo command ID. Preview có cấu hình tài khoản kiểm thử riêng cho nhánh. [Vercel Preview](https://emsua-itojl1wcb-cyanhuynh10s-projects.vercel.app) · [Nhánh trên GitHub](https://github.com/CyanHuynh10/EmSua/tree/codex/lighting-wokwi-integration)
- Simulator chạy từ [project Wokwi Em Sữa trên Edge](https://wokwi.com/projects/481740025407666177) trong một cửa sổ kiểm thử riêng. Đã nạp ảnh ESP-IDF hợp nhất qua lệnh trình soạn thảo và xác minh khởi động OFF/50%, nút nhấn chuyển ON và biến trở tăng lên 100%. Wokwi CLI 0.29.1 lint sơ đồ thành công, có một thông báo `unsupported-part` mức info. Luồng mô phỏng web chạy được với F1, không phụ thuộc `WOKWI_CLI_TOKEN`. [Ảnh kiểm thử độc lập](../../fix/wokwi-edge-standalone-on.png) · [Hướng dẫn firmware](README.md)

### Nghiệm thu Vercel Preview ↔ Wokwi trên Edge

| Ca kiểm thử | Trạng thái | Bằng chứng |
| --- | --- | --- |
| E2E-01 Device Connection | PASS | Serial báo HTTPS đã xác thực. Supabase lưu heartbeat và Preview hiện Online, OFF/50% |
| E2E-02 Website Turn ON | PASS | `4a0e7fc3-66a8-474f-86ff-bc9514a39b70` trả HTTP 202, sau đó `completed`. Cả 16 LED ở RGB 128 và website hiện thông báo đã bật |
| E2E-03 Website Turn OFF | PASS | `49fa3674-09cb-4fbd-907b-fb709a63c926` nhận ACK. Cả 16 LED về RGB 0 và website hiện OFF |
| E2E-04 Website Brightness | PASS | Năm lệnh cho 0/25/50/75/100% đều hoàn thành. Giá trị RGB đọc từ 16 pixel khớp 0/64/128/191/255 |
| E2E-05 Brightness Memory | PASS | Tắt rồi bật lại ở 75%. Lệnh bật lại `35b88b0d-e0dc-49fe-addf-a61a0e799bf8` xác nhận 75% |
| E2E-06 Wokwi Pushbutton | PASS | Nút xanh tắt vòng LED. Event `lighting.local_power_changed` ghi OFF/75%. Dashboard nhận trạng thái mới |
| E2E-07 Wokwi Potentiometer | PASS | Biến trở báo 100% khi đèn OFF. Slider đồng bộ lên 100% |
| E2E-08 Device Offline | PASS | Dừng simulator. Preview hiện Offline và khóa nút nguồn. API trả 409 `DEVICE_OFFLINE` |
| E2E-09 Reconnection | PASS | Nạp lại firmware. Heartbeat hoạt động và vòng LED khởi động OFF/50%, `stateVersion=0`. Lệnh `0a43217a-4b3e-4f00-9886-64d870b44a9a` chuyển sang `expired` trong thời gian simulator dừng và giữ trạng thái đó sau khi Wokwi kết nối lại |
| E2E-10 Duplicate Commands | PASS | Gửi lại yêu cầu bật trả cùng command ID và `duplicate=true`. Vitest và HTTP local xác minh ACK trùng có tính idempotent |
| E2E-11 Rapid Brightness Changes | PASS | Bốn thay đổi liên tiếp tạo một PATCH. Lệnh `c54fafa5-4603-4e1e-94d0-eed4418eb1d8` được xác nhận ở 65% |
| E2E-12 Invalid Authentication | PASS | Preview trả HTTP 401 `INVALID_DEVICE_CREDENTIALS` với token sai |
| E2E-13 Mode Isolation | PASS | Lệnh Mock trả kết quả trực tiếp, vòng LED Wokwi giữ OFF và reported state vẫn OFF/50%. Trạng thái Mock ban đầu được khôi phục sau kiểm thử |
| E2E-14 Lighting Schedule | PASS | Ngày 27/11/2026, lịch bật lúc 00:55 và tắt lúc 00:56 theo giờ Việt Nam. Hai lệnh `bfd624b4-be65-44b2-bc70-6f6fbf7d6576` và `ec922c90-d5e3-4aa6-acad-0702f9cdab47` đều nhận ACK. Vòng LED sáng rồi tắt. Chỉ có hai lệnh hoàn thành từ lịch |

Xem [kết quả 14 ca E2E](../../fix/lighting-wokwi-e2e.json), [kiểm tra lệnh hết hạn](../../fix/lighting-wokwi-expiry.json), [Serial Monitor](../../fix/wokwi-edge-serial.txt), [ảnh Preview sau ACK](../../fix/lighting-preview-ack.png) và [ảnh vòng LED đang sáng trên Wokwi](../../fix/wokwi-edge-preview-on.png). Tài khoản đăng nhập kiểm thử chỉ áp dụng cho nhánh Preview. Lịch nghiệm thu ngày 27/11 được giữ để đối chiếu với hai ACK. Vercel Production hiện phục vụ nhánh `main` tại `ce9a7bf`.

### Vận hành sau nghiệm thu

Website Preview và Device API đã qua nghiệm thu với Wokwi trên Edge. Quyền truy cập Preview tạm đã được thu hồi. Sau thu hồi, cookie và liên kết thử nghiệm đều nhận HTTP 401 ở lớp bảo vệ Vercel. Để chạy lại simulator, cấp quyền truy cập Preview mới, cấu hình thông tin thiết bị trong file local, build ảnh hợp nhất và nạp vào tab [Em Sữa](https://wokwi.com/projects/481740025407666177). Đăng nhập Preview, mở **Đèn**, đợi Online và kiểm tra cả lệnh từ website lẫn thao tác tại chỗ. Lịch chạy khi website có tab đang hiển thị và Wokwi đang hoạt động. Xem [cách chạy và đối chiếu log](README.md).

Production Lighting cần phê duyệt triển khai riêng, cấu hình môi trường dành cho vận hành và nghiệm thu phần cứng trước khi mở Real Mode. Phiên này đã dùng Supabase chung với Production theo phê duyệt của người dùng và chạy ứng dụng tích hợp trên Vercel Preview.

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
