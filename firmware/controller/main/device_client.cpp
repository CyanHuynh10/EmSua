#include "device_client.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <memory>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#if __has_include("device_config.local.hpp")
#include "device_config.local.hpp"
#else
#include "device_config.example.hpp"
#endif

#ifndef SUA_VERCEL_COOKIE
#define SUA_VERCEL_COOKIE ""
#endif

namespace {
constexpr char kTag[] = "DEVICE";
constexpr char kDeviceId[] = "sua-controller-wokwi-01";
constexpr char kFirmware[] = "lighting-integration-1.0";
constexpr int64_t kSecond = 1000000;
constexpr EventBits_t kConnected = BIT0;
using Json = std::unique_ptr<cJSON, decltype(&cJSON_Delete)>;
QueueHandle_t commands;
QueueHandle_t states;
QueueHandle_t results;
EventGroupHandle_t wifiEvents;

void wifiEvent(void*, esp_event_base_t base, int32_t id, void*)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(wifiEvents, kConnected);
        ESP_LOGW(kTag, "Wi-Fi disconnected");
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(wifiEvents, kConnected);
        ESP_LOGI(kTag, "Wi-Fi connected");
    }
}

esp_err_t initWifi()
{
    esp_err_t result = nvs_flash_init();
    if (result != ESP_OK) return result;
    result = esp_netif_init();
    if (result != ESP_OK) return result;
    result = esp_event_loop_create_default();
    if (result != ESP_OK) return result;
    if (!esp_netif_create_default_wifi_sta()) return ESP_FAIL;
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    result = esp_wifi_init(&init);
    if (result != ESP_OK) return result;
    result = esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, wifiEvent, nullptr);
    if (result != ESP_OK) return result;
    result = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifiEvent, nullptr);
    if (result != ESP_OK) return result;
    result = esp_wifi_set_storage(WIFI_STORAGE_RAM);
    if (result != ESP_OK) return result;
    result = esp_wifi_set_mode(WIFI_MODE_STA);
    if (result != ESP_OK) return result;
    wifi_config_t config{};
    std::memcpy(config.sta.ssid, "Wokwi-GUEST", sizeof("Wokwi-GUEST"));
    config.sta.channel = 6;
    config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    result = esp_wifi_set_config(WIFI_IF_STA, &config);
    return result == ESP_OK ? esp_wifi_start() : result;
}

struct ReplyBuffer {
    char data[1536]{};
    size_t used = 0;
    bool overflow = false;
};

esp_err_t receiveHttpData(esp_http_client_event_t* event)
{
    if (event->event_id != HTTP_EVENT_ON_DATA || event->data_len <= 0) return ESP_OK;
    auto& reply = *static_cast<ReplyBuffer*>(event->user_data);
    if (reply.overflow || static_cast<size_t>(event->data_len) >= sizeof(reply.data) - reply.used) {
        reply.overflow = true;
        return ESP_FAIL;
    }
    std::memcpy(reply.data + reply.used, event->data, event->data_len);
    reply.used += event->data_len;
    return ESP_OK;
}

struct Response {
    int status = 0;
    Json body{nullptr, cJSON_Delete};

    const cJSON* data() const { return cJSON_GetObjectItemCaseSensitive(body.get(), "data"); }
    bool ok() const {
        return status == 200 && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(body.get(), "success")) && cJSON_IsObject(data());
    }
    bool error(const char* expected) const {
        const auto* value = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(
            cJSON_GetObjectItemCaseSensitive(body.get(), "error"), "code"));
        return value && std::strcmp(value, expected) == 0;
    }
};

Response post(const char* endpoint, const cJSON* body)
{
    Response result;
    const auto* backend = SUA_DEVICE_BACKEND_URL;
    char url[320];
    const size_t length = std::strlen(backend);
    const int written = std::snprintf(url, sizeof(url), "%s%sapi/device/%s", backend,
        length > 0 && backend[length - 1] == '/' ? "" : "/", endpoint);
    if (written <= 0 || static_cast<size_t>(written) >= sizeof(url)) return result;
    std::unique_ptr<char, decltype(&cJSON_free)> payload(cJSON_PrintUnformatted(body), cJSON_free);
    if (!payload) return result;
    ReplyBuffer reply;
    esp_http_client_config_t config{};
    config.url = url;
    config.method = HTTP_METHOD_POST;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.timeout_ms = 4500;
    config.event_handler = receiveHttpData;
    config.user_data = &reply;
    config.disable_auto_redirect = true;
    auto client = esp_http_client_init(&config);
    if (!client) return result;
    char authorization[51];
    std::snprintf(authorization, sizeof(authorization), "Bearer %s", SUA_DEVICE_TOKEN);
    esp_http_client_set_header(client, "Authorization", authorization);
    esp_http_client_set_header(client, "X-Device-Id", kDeviceId);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    if (SUA_VERCEL_BYPASS[0] != '\0') {
        esp_http_client_set_header(client, "x-vercel-protection-bypass", SUA_VERCEL_BYPASS);
    }
    if (SUA_VERCEL_COOKIE[0] != '\0') {
        esp_http_client_set_header(client, "Cookie", SUA_VERCEL_COOKIE);
    }
    esp_http_client_set_post_field(client, payload.get(), std::strlen(payload.get()));
    const auto error = esp_http_client_perform(client);
    if (error == ESP_OK && !reply.overflow) {
        result.status = esp_http_client_get_status_code(client);
        result.body.reset(cJSON_ParseWithLengthOpts(reply.data, reply.used + 1, nullptr, true));
    } else {
        ESP_LOGW(kTag, "HTTPS %s failed: %s", endpoint, esp_err_to_name(error));
    }
    esp_http_client_cleanup(client);
    if (result.status && !result.ok()) ESP_LOGW(kTag, "HTTPS %s returned %d or invalid JSON", endpoint, result.status);
    return result;
}

void makeUuid(char (&id)[37])
{
    uint8_t bytes[16];
    esp_fill_random(bytes, sizeof(bytes));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    constexpr char digits[] = "0123456789abcdef";
    size_t pos = 0;
    for (size_t i = 0; i < sizeof(bytes); ++i) {
        if (i == 4 || i == 6 || i == 8 || i == 10) id[pos++] = '-';
        id[pos++] = digits[bytes[i] >> 4];
        id[pos++] = digits[bytes[i] & 0x0f];
    }
    id[pos] = '\0';
}

bool readUuid(const cJSON* object, const char* key, char (&id)[37])
{
    const auto* value = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(object, key));
    if (!value || std::strlen(value) != 36) return false;
    for (int i = 0; i < 36; ++i) {
        const char ch = value[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (ch != '-') return false;
        } else if (!(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'f')) return false;
    }
    std::memcpy(id, value, 37);
    return true;
}

bool readCommand(const cJSON* item, int64_t started, DeviceCommand& command)
{
    if (!readUuid(item, "id", command.id) || !readUuid(item, "leaseId", command.leaseId)) return false;
    const auto* ttl = cJSON_GetObjectItemCaseSensitive(item, "ttlMs");
    if (!cJSON_IsNumber(ttl) || ttl->valuedouble != ttl->valueint || ttl->valueint < 0 || ttl->valueint > 30000) return false;
    const auto* payload = cJSON_GetObjectItemCaseSensitive(item, "payload");
    const auto* power = cJSON_GetObjectItemCaseSensitive(payload, "power");
    const auto* brightness = cJSON_GetObjectItemCaseSensitive(payload, "brightness");
    const auto* type = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(item, "type"));
    if (!cJSON_IsObject(payload) || !type || (!power && !brightness)) return false;
    if ((power && !cJSON_IsBool(power)) || (brightness && (!cJSON_IsNumber(brightness) ||
        brightness->valuedouble != brightness->valueint || brightness->valueint < 0 || brightness->valueint > 100))) return false;
    const char* expected = power ? brightness ? "lighting.set_state" : "lighting.set_power" : "lighting.set_brightness";
    if (std::strcmp(type, expected) != 0) return false;
    command.hasPower = power != nullptr;
    command.power = cJSON_IsTrue(power);
    command.hasBrightness = brightness != nullptr;
    command.brightness = brightness ? brightness->valueint : 0;
    // Anchor to the request start so response latency cannot extend server expiry.
    command.deadline = started + static_cast<int64_t>(ttl->valueint) * 1000;
    return true;
}

void addState(cJSON* body, const DeviceState& state)
{
    auto* value = cJSON_AddObjectToObject(body, "state");
    cJSON_AddBoolToObject(value, "power", state.power);
    cJSON_AddNumberToObject(value, "brightness", state.brightness);
}

const char* sourceName(LocalSource source)
{
    switch (source) {
        case LocalSource::Button: return "local_button";
        case LocalSource::Potentiometer: return "local_potentiometer";
        default: return "serial";
    }
}

void networkLoop(void*)
{
    const auto wifi = initWifi();
    if (wifi != ESP_OK) {
        ESP_LOGE(kTag, "Wi-Fi initialization failed: %s", esp_err_to_name(wifi));
        vTaskDelete(nullptr);
        return;
    }
    char bootId[37]{};
    bool registered = false;
    bool sntp = false;
    int64_t heartbeatAt = 0;
    int64_t claimAt = 0;
    int64_t stateAt = 0;
    int64_t retryAt = 0;
    int64_t wifiAt = 0;
    int64_t clockLogAt = 0;
    int64_t communicationBackoff = kSecond;
    int64_t wifiBackoff = 2 * kSecond;
    DeviceState sent{};
    DeviceResult cached{};
    bool waitingForAck = false;
    bool executing = false;

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(100));
        const int64_t now = esp_timer_get_time();
        if (!(xEventGroupGetBits(wifiEvents) & kConnected)) {
            if (now >= wifiAt) {
                const auto result = esp_wifi_connect();
                if (result != ESP_OK) ESP_LOGW(kTag, "Wi-Fi connect: %s", esp_err_to_name(result));
                wifiAt = now + wifiBackoff;
                wifiBackoff = std::min(20 * kSecond, wifiBackoff * 2);
            }
            continue;
        }
        wifiBackoff = 2 * kSecond;
        if (!sntp) {
            if (now < retryAt) continue;
            esp_sntp_config_t config = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
            const auto result = esp_netif_sntp_init(&config);
            sntp = result == ESP_OK;
            if (!sntp) {
                ESP_LOGW(kTag, "SNTP initialization failed: %s", esp_err_to_name(result));
                retryAt = now + 5 * kSecond;
                continue;
            }
        }
        if (std::time(nullptr) < 1700000000) {
            if (now >= clockLogAt) {
                ESP_LOGI(kTag, "Waiting for SNTP before HTTPS");
                clockLogAt = now + 10 * kSecond;
            }
            continue;
        }
        if (now < retryAt) continue;
        if (!bootId[0]) makeUuid(bootId);

        DeviceState latest{};
        xQueuePeek(states, &latest, 0);
        if (executing && xQueueReceive(results, &cached, 0) == pdTRUE) {
            executing = false;
            waitingForAck = true;
        }
        Json body(cJSON_CreateObject(), cJSON_Delete);
        if (!body) continue;
        cJSON_AddStringToObject(body.get(), "bootId", bootId);
        Response response;
        if (!registered || (!waitingForAck && now >= heartbeatAt)) {
            const DeviceState state = registered ? sent : latest;
            cJSON_AddBoolToObject(body.get(), "boot", !registered);
            cJSON_AddStringToObject(body.get(), "firmwareVersion", kFirmware);
            cJSON_AddNumberToObject(body.get(), "stateVersion", state.version);
            addState(body.get(), state);
            response = post("heartbeat", body.get());
            if (response.ok()) {
                if (!registered) ESP_LOGI(kTag, "HTTPS authenticated, heartbeat acknowledged");
                registered = true;
                sent = state;
                heartbeatAt = now + 10 * kSecond;
            }
        } else if (waitingForAck) {
            cJSON_AddStringToObject(body.get(), "commandId", cached.command.id);
            cJSON_AddStringToObject(body.get(), "leaseId", cached.command.leaseId);
            cJSON_AddNumberToObject(body.get(), "stateVersion", cached.state.version);
            cJSON_AddStringToObject(body.get(), "status", cached.error ? "failed" : "completed");
            if (cached.error) cJSON_AddStringToObject(body.get(), "errorCode", cached.error);
            else addState(body.get(), cached.state);
            response = post("commands/ack", body.get());
            if (response.ok()) {
                if (!cached.error) sent = cached.state;
                waitingForAck = false;
                ESP_LOGI(kTag, "ACK accepted for %s (%s)", cached.command.id, cached.error ? cached.error : "completed");
            } else if (response.error("COMMAND_EXPIRED") || response.error("COMMAND_NOT_FOUND") ||
                       response.error("VERSION_CONFLICT") || response.error("STATE_MISMATCH")) {
                waitingForAck = false;
            }
        } else if (!executing && latest.version > sent.version && now >= stateAt &&
                   (latest.source != LocalSource::Potentiometer || now - latest.changedAt >= 250000 || now - stateAt >= kSecond)) {
            cJSON_AddNumberToObject(body.get(), "stateVersion", latest.version);
            cJSON_AddStringToObject(body.get(), "source", sourceName(latest.source));
            addState(body.get(), latest);
            response = post("state", body.get());
            if (response.ok()) {
                sent = latest;
                stateAt = now + 500000;
            }
        } else if (!executing && now >= claimAt) {
            response = post("commands/claim", body.get());
            claimAt = now + 3 * kSecond;
            if (response.ok()) {
                const auto* item = cJSON_GetObjectItemCaseSensitive(response.data(), "command");
                if (!cJSON_IsNull(item)) {
                    DeviceCommand command{};
                    if (!readCommand(item, now, command)) {
                        ESP_LOGW(kTag, "Invalid claim response");
                    } else if (std::strcmp(cached.command.id, command.id) == 0) {
                        cached.command = command;
                        waitingForAck = true;
                    } else {
                        executing = xQueueSend(commands, &command, 0) == pdTRUE;
                        ESP_LOGI(kTag, "Command received %s", command.id);
                    }
                    claimAt = now + kSecond;
                }
            }
        } else {
            continue;
        }

        if (response.ok()) {
            communicationBackoff = kSecond;
        } else if (response.error("SESSION_CHANGED")) {
            ESP_LOGW(kTag, "Another simulator session owns this device");
            retryAt = now + 30 * kSecond;
        } else {
            retryAt = esp_timer_get_time() + communicationBackoff;
            communicationBackoff = std::min(30 * kSecond, communicationBackoff * 2);
        }
    }
}
}

void startDeviceClient(const DeviceState& initial)
{
    if (!SUA_DEVICE_BACKEND_URL[0] && !SUA_DEVICE_TOKEN[0]) {
        ESP_LOGI(kTag, "Standalone lighting (no device configuration)");
        return;
    }
    if (std::strncmp(SUA_DEVICE_BACKEND_URL, "https://", 8) != 0 || std::strlen(SUA_DEVICE_TOKEN) != 43) {
        ESP_LOGE(kTag, "Device configuration requires an HTTPS backend and a 43-character token");
        return;
    }
    wifiEvents = xEventGroupCreate();
    commands = xQueueCreate(1, sizeof(DeviceCommand));
    states = xQueueCreate(1, sizeof(DeviceState));
    results = xQueueCreate(1, sizeof(DeviceResult));
    if (!wifiEvents || !commands || !states || !results) {
        ESP_LOGE(kTag, "Device task resources unavailable");
        return;
    }
    publishDeviceState(initial);
    if (xTaskCreate(networkLoop, "device_network", 10240, nullptr, 4, nullptr) != pdPASS) {
        ESP_LOGE(kTag, "Device network task creation failed");
    }
}

bool receiveDeviceCommand(DeviceCommand& command) { return commands && xQueueReceive(commands, &command, 0) == pdTRUE; }
void publishDeviceState(const DeviceState& state) { if (states) xQueueOverwrite(states, &state); }
void publishDeviceResult(const DeviceResult& result) { if (results) xQueueOverwrite(results, &result); }
