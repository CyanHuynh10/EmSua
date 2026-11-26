#include "lighting.hpp"
#include "device_client.hpp"

#include <cstdint>

#include "driver/uart.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace {
constexpr char kTag[] = "SYSTEM";
constexpr uart_port_t kConsole = UART_NUM_0;
constexpr int kRxBufferSize = 256;
constexpr int kBrightnessStep = 10;

void handleSerial(Lighting& lighting)
{
    // Keep a bounded receive budget so input cannot starve the button or ADC.
    uint8_t commands[16];
    const int count = uart_read_bytes(kConsole, commands, sizeof(commands), 0);
    for (int i = 0; i < count; ++i) {
        switch (commands[i]) {
            case '1': lighting.turnOn(); break;
            case '0': lighting.turnOff(); break;
            case 't': lighting.toggle(); break;
            case '+': lighting.setBrightness(lighting.getBrightness() + kBrightnessStep); break;
            case '-': lighting.setBrightness(lighting.getBrightness() - kBrightnessStep); break;
            case 's': lighting.printStatus(); break;
        }
    }
}
}

extern "C" void app_main()
{
    ESP_LOGI(kTag, "SUA SMART HOME | LIGHTING SIMULATION | ESP-IDF + C++ | 16 LEDs");

    Lighting lighting;
    const esp_err_t lightingResult = lighting.begin();
    if (lightingResult != ESP_OK) {
        ESP_LOGE(kTag, "Lighting initialization failed: %s", esp_err_to_name(lightingResult));
        return;
    }

    // ESP-IDF already sets the console clock, pins and baud rate. Install RX
    // buffering while leaving console output on the standard logging backend.
    const esp_err_t uartResult = uart_driver_install(kConsole, kRxBufferSize, 0, 0, nullptr, 0);
    if (uartResult != ESP_OK) {
        ESP_LOGW(kTag, "Serial commands unavailable: %s", esp_err_to_name(uartResult));
    }

    lighting.printStatus();
    ESP_LOGI(kTag, "Ready");
    DeviceState state{lighting.isOn(), lighting.getBrightness(), 0, LocalSource::Serial, esp_timer_get_time()};
    startDeviceClient(state);
    auto capture = [&](LocalSource source, bool force = false) {
        const bool power = lighting.isOn();
        const int brightness = lighting.getBrightness();
        if (!force && power == state.power && brightness == state.brightness) return;
        state = {power, brightness, state.version + 1, power != state.power && source != LocalSource::Serial
            ? LocalSource::Button : source, esp_timer_get_time()};
        publishDeviceState(state);
    };
    while (true) {
        DeviceCommand command{};
        if (receiveDeviceCommand(command)) {
            const char* error = nullptr;
            if (esp_timer_get_time() >= command.deadline) {
                error = "COMMAND_EXPIRED";
            } else if (!lighting.setState(command.hasPower ? command.power : lighting.isOn(),
                                          command.hasBrightness ? command.brightness : lighting.getBrightness())) {
                error = "LED_DRIVER_ERROR";
            } else {
                capture(LocalSource::Serial, true);
            }
            publishDeviceResult({command, state, error});
        }
        lighting.update();
        capture(LocalSource::Potentiometer);
        if (uartResult == ESP_OK) {
            handleSerial(lighting);
            capture(LocalSource::Serial);
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}
