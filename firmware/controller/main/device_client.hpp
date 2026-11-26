#pragma once

#include <cstdint>

enum class LocalSource { Button, Potentiometer, Serial };

struct DeviceState {
    bool power;
    int brightness;
    int version;
    LocalSource source;
    int64_t changedAt;
};

struct DeviceCommand {
    char id[37];
    char leaseId[37];
    bool hasPower;
    bool power;
    bool hasBrightness;
    int brightness;
    int64_t deadline;
};

struct DeviceResult {
    DeviceCommand command;
    DeviceState state;
    const char* error;
};

// Hardware task publishes snapshots and receives commands without blocking.
void startDeviceClient(const DeviceState& initial);
bool receiveDeviceCommand(DeviceCommand& command);
void publishDeviceState(const DeviceState& state);
void publishDeviceResult(const DeviceResult& result);
