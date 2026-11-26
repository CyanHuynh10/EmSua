#include "lighting.hpp"

#include <algorithm>
#include <cstdlib>

#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"

namespace {
constexpr char kTag[] = "LIGHTING";
constexpr gpio_num_t kLedPin = GPIO_NUM_23;
constexpr gpio_num_t kButtonPin = GPIO_NUM_21;
constexpr adc_channel_t kPotChannel = ADC_CHANNEL_6; // ADC1, GPIO34
constexpr int kLedCount = 16;
constexpr int kAdcSamples = 4;
constexpr int kAdcMax = 4095;
constexpr int kPotMovement = 24;
constexpr int64_t kDebounceUs = 50'000;
constexpr int64_t kAdcPeriodUs = 50'000;
constexpr int64_t kBrightnessLogPeriodUs = 200'000;
constexpr int64_t kRenderErrorLogPeriodUs = 1'000'000;

int brightnessFromAdc(int raw)
{
    // Reserve a small band at each end for mechanical travel and ADC noise.
    constexpr int edge = 32;
    constexpr int span = kAdcMax - 2 * edge;
    const int adjusted = std::clamp(raw - edge, 0, span);
    return (adjusted * 100 + span / 2) / span;
}
}

Lighting::~Lighting()
{
    if (strip_ != nullptr) {
        led_strip_del(strip_);
    }
    if (adc_ != nullptr) {
        adc_oneshot_del_unit(adc_);
    }
}

esp_err_t Lighting::begin()
{
    gpio_config_t buttonConfig{};
    buttonConfig.pin_bit_mask = 1ULL << kButtonPin;
    buttonConfig.mode = GPIO_MODE_INPUT;
    buttonConfig.pull_up_en = GPIO_PULLUP_ENABLE;
    ESP_RETURN_ON_ERROR(gpio_config(&buttonConfig), kTag, "Configure button GPIO");

    adc_oneshot_unit_init_cfg_t adcConfig{};
    adcConfig.unit_id = ADC_UNIT_1;
    ESP_RETURN_ON_ERROR(adc_oneshot_new_unit(&adcConfig, &adc_), kTag, "Initialize ADC1");
    adc_oneshot_chan_cfg_t potConfig{};
    potConfig.atten = ADC_ATTEN_DB_12;
    potConfig.bitwidth = ADC_BITWIDTH_12;
    ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(adc_, kPotChannel, &potConfig),
                        kTag, "Configure GPIO34 ADC channel");

    led_strip_config_t stripConfig{};
    stripConfig.strip_gpio_num = kLedPin;
    stripConfig.max_leds = kLedCount;
    stripConfig.led_pixel_format = LED_PIXEL_FORMAT_GRB;
    stripConfig.led_model = LED_MODEL_WS2812;
    led_strip_rmt_config_t rmtConfig{};
    rmtConfig.clk_src = RMT_CLK_SRC_DEFAULT;
    rmtConfig.resolution_hz = 10'000'000;
    ESP_RETURN_ON_ERROR(led_strip_new_rmt_device(&stripConfig, &rmtConfig, &strip_),
                        kTag, "Initialize WS2812 RMT");
    ESP_RETURN_ON_ERROR(render(0), kTag, "Clear ring at boot");

    // The starting knob position is a reference for movement, not a command.
    ESP_RETURN_ON_ERROR(readPotentiometer(potReference_), kTag, "Read initial potentiometer");
    buttonPressed_ = candidatePressed_ = gpio_get_level(kButtonPin) == 0;
    nextAdcRead_ = esp_timer_get_time() + kAdcPeriodUs;
    return ESP_OK;
}

void Lighting::update()
{
    const int64_t now = esp_timer_get_time();
    updateButton(now);
    updatePotentiometer(now);
    if (brightnessLogPending_ && now >= nextBrightnessLog_) {
        printStatus();
        brightnessLogPending_ = false;
        nextBrightnessLog_ = now + kBrightnessLogPeriodUs;
    }
}

void Lighting::turnOn()
{
    setPower(true);
}

void Lighting::turnOff()
{
    setPower(false);
}

void Lighting::toggle()
{
    setPower(!on_);
}

void Lighting::setPower(bool on)
{
    if (on == on_) {
        ESP_LOGI(kTag, "Skipped: already %s", on_ ? "ON" : "OFF");
    } else if (apply(on, brightness_)) {
        printStatus();
        brightnessLogPending_ = false;
    }
}

void Lighting::setBrightness(int percent)
{
    const int brightness = std::clamp(percent, 0, 100);
    if (brightness != brightness_ && apply(on_, brightness)) {
        printStatus();
        brightnessLogPending_ = false;
    }
}

bool Lighting::setState(bool on, int percent)
{
    if (!apply(on, std::clamp(percent, 0, 100))) return false;
    printStatus();
    brightnessLogPending_ = false;
    return true;
}

void Lighting::printStatus() const
{
    ESP_LOGI(kTag, "State: %s | Brightness: %d%%", on_ ? "ON" : "OFF", brightness_);
}

bool Lighting::apply(bool on, int brightness)
{
    const int level = on ? (brightness * 255 + 50) / 100 : 0;
    if (level != displayedLevel_) {
        const esp_err_t result = render(level);
        if (result != ESP_OK) {
            const int64_t now = esp_timer_get_time();
            if (now >= nextRenderErrorLog_) {
                ESP_LOGE(kTag, "WS2812 update failed: %s", esp_err_to_name(result));
                nextRenderErrorLog_ = now + kRenderErrorLogPeriodUs;
            }
            return false;
        }
    }
    on_ = on;
    brightness_ = brightness;
    return true;
}

esp_err_t Lighting::render(int level)
{
    for (int pixel = 0; pixel < kLedCount; ++pixel) {
        const esp_err_t result = led_strip_set_pixel(strip_, pixel, level, level, level);
        if (result != ESP_OK) {
            return result;
        }
    }
    const esp_err_t result = led_strip_refresh(strip_);
    if (result == ESP_OK) {
        displayedLevel_ = level;
    } else {
        // A failed transfer leaves the visible state unknown.
        displayedLevel_ = -1;
    }
    return result;
}

void Lighting::updateButton(int64_t now)
{
    const bool pressed = gpio_get_level(kButtonPin) == 0;
    if (pressed != candidatePressed_) {
        candidatePressed_ = pressed;
        buttonChangedAt_ = now;
    } else if (pressed != buttonPressed_ && now - buttonChangedAt_ >= kDebounceUs) {
        buttonPressed_ = pressed;
        if (buttonPressed_) {
            toggle();
        }
    }
}

esp_err_t Lighting::readPotentiometer(int& raw) const
{
    int total = 0;
    for (int i = 0; i < kAdcSamples; ++i) {
        int sample = 0;
        const esp_err_t result = adc_oneshot_read(adc_, kPotChannel, &sample);
        if (result != ESP_OK) {
            return result;
        }
        total += sample;
    }
    raw = total / kAdcSamples;
    return ESP_OK;
}

void Lighting::updatePotentiometer(int64_t now)
{
    if (now < nextAdcRead_) {
        return;
    }
    nextAdcRead_ = now + kAdcPeriodUs;

    int raw = 0;
    const esp_err_t result = readPotentiometer(raw);
    if (result != ESP_OK) {
        if (!adcReadFailed_) {
            ESP_LOGW(kTag, "ADC read failed: %s", esp_err_to_name(result));
        }
        adcReadFailed_ = true;
        return;
    }
    if (adcReadFailed_) {
        ESP_LOGI(kTag, "ADC reads recovered");
        adcReadFailed_ = false;
    }

    // A stationary knob leaves both startup and serial brightness intact.
    if (std::abs(raw - potReference_) < kPotMovement) {
        return;
    }
    const int brightness = brightnessFromAdc(raw);
    if (brightness == brightness_) {
        potReference_ = raw;
    } else if (apply(on_, brightness)) {
        potReference_ = raw;
        brightnessLogPending_ = true;
    }
}
