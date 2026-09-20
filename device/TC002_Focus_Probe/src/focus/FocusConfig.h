#pragma once

#include <stdint.h>

namespace focus_config {

// The Mac running EMQX. This is ordinary LAN metadata, never a credential.
// Documentation-only fallback. Per-user installs override this via device.conf.
static const char kBrokerHost[] = "192.0.2.100";
static const uint16_t kBrokerPort = 1883;
static const char kEventTopic[] = "ulanzi/tc002-focus/events/focus";
static const int64_t kFocusSeconds = 2700;
static const int64_t kRestSeconds = 300;
static const char kFocusDoneAudioPath[] = "/tmp/ui/audio/focus_done.mp3";
static const int kFocusDoneAudioVolume = 6;
// Temporary hardware test: play the configured sound once after app startup.
static const bool kAudioSelfTestOnBoot = false;

} // namespace focus_config
