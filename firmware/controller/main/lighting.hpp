#pragma once

#include <cstdint>

#include "esp_adc/adc_oneshot.h"
#include "esp_err.h"
#include "led_strip.h"

// Call these methods from the same task after begin() succeeds.
class Lighting {
public:
    Lighting() = default;
    ~Lighting();
    Lighting(const Lighting&) = delete;
    Lighting& operator=(const Lighting&) = delete;

    esp_err_t begin();
    void update();

    void turnOn();
    void turnOff();
    void toggle();
    void setBrightness(int percent);
    bool setState(bool on, int percent);

    bool isOn() const { return on_; }
    int getBrightness() const { return brightness_; }
    void printStatus() const;

private:
    esp_err_t render(int level);
    bool apply(bool on, int brightness);
    void setPower(bool on);
    void updateButton(int64_t now);
    void updatePotentiometer(int64_t now);
    esp_err_t readPotentiometer(int& raw) const;

    led_strip_handle_t strip_ = nullptr;
    adc_oneshot_unit_handle_t adc_ = nullptr;
    bool on_ = false;
    int brightness_ = 50;
    int displayedLevel_ = -1;

    bool buttonPressed_ = false;
    bool candidatePressed_ = false;
    int64_t buttonChangedAt_ = 0;

    int potReference_ = 0;
    int64_t nextAdcRead_ = 0;
    int64_t nextBrightnessLog_ = 0;
    bool brightnessLogPending_ = false;
    bool adcReadFailed_ = false;
    int64_t nextRenderErrorLog_ = 0;
};
