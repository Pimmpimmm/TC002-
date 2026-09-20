#include "pages/AudioTestPage.h"
#include "managers/McuManager.h"
#include "managers/AudioManager.h"
#include "managers/KeyManager.h"
#include "base/base.h"
#include "manager/ConfigManager.h"
static const Color COLOR_WHITE(255, 255, 255);
static const Color COLOR_GREEN(0, 255, 0);
static const Color COLOR_YELLOW(255, 255, 0);
static const Color COLOR_RED(255, 0, 0);
static const Color COLOR_BLACK(0, 0, 0);
static const Color COLOR_GRAY(80, 80, 80);

#define DISPLAY_WIDTH  52
#define DISPLAY_HEIGHT 16

AudioTestPage::AudioTestPage()
    : PageBase("AudioTestPage"),
      mMicPercent(0),
      mVolumeLevel(3),
      mIsPlaying(false) {
}

AudioTestPage::~AudioTestPage() {
}

void AudioTestPage::onEnter() {
    LOGD_TRACE("AudioTestPage: onEnter");
    std::string audioPath = CONFIGMANAGER->getResFilePath("1KHZ.MP3");
	if(base::exists("/mnt/usb1/test.mp3")) {
		audioPath = "/mnt/usb1/test.mp3";
	}
    std::lock_guard<std::mutex> lock(mMutex);
    mMicPercent = 0;
    mIsPlaying = true;
    McuManager::getInstance().setAutoMicReport(true);
    awtrix::AudioManager::getInstance().playAudio(audioPath);
    drawLocked();
}

void AudioTestPage::onExit() {
    LOGD_TRACE("AudioTestPage: onExit");
    McuManager::getInstance().setAutoMicReport(false);
    awtrix::AudioManager::getInstance().stopAudio();
    std::lock_guard<std::mutex> lock(mMutex);
    mIsPlaying = false;
}

bool AudioTestPage::onKeyEvent(int keyCode, int keyStatus) {
    if (keyStatus != 1) {
        return true;
    }

    std::lock_guard<std::mutex> lock(mMutex);
    switch (keyCode) {
        case E_KEYCODE_RIGHT_BUTTON:
            if (mVolumeLevel < 6) {
                mVolumeLevel++;
                awtrix::AudioManager::getInstance().setVolume(mVolumeLevel);
                drawLocked();
            }
            return false;
        case E_KEYCODE_LEFT_BUTTON:
            if (mVolumeLevel > 0) {
                mVolumeLevel--;
                awtrix::AudioManager::getInstance().setVolume(mVolumeLevel);
                drawLocked();
            }
            return false;
        case E_KEYCODE_MIDDLE_BUTTON:
            if (mIsPlaying) {
                awtrix::AudioManager::getInstance().pauseAudio();
                mIsPlaying = false;
            } else {
                awtrix::AudioManager::getInstance().resumeAudio();
                mIsPlaying = true;
            }
            drawLocked();
            return false;
        default:
            return true;
    }
    return true;
}

void AudioTestPage::setVolumeLevel(int level) {
    std::lock_guard<std::mutex> lock(mMutex);
    if (level < 0) level = 0;
    if (level > 6) level = 6;
    mVolumeLevel = level;
    awtrix::AudioManager::getInstance().setVolume(mVolumeLevel);
}

int AudioTestPage::getVolumeLevel() const {
    return mVolumeLevel;
}

void AudioTestPage::stopAudio() {
    awtrix::AudioManager::getInstance().stopAudio();
}

void AudioTestPage::draw() {
    std::lock_guard<std::mutex> lock(mMutex);
    drawLocked();
}

void AudioTestPage::drawLocked() {
    Surface surface(DISPLAY_WIDTH, DISPLAY_HEIGHT, COLOR_BLACK);

    int raw = McuManager::getInstance().queryMicValue();
    if (raw >= 0) {
        mMicPercent = raw * 100 / 65535;
        if (mMicPercent > 100) mMicPercent = 100;
    }

    drawMicSection(surface);
    drawVolSection(surface);

    std::vector<uint8_t> data;
    surface.extractRGB(data);
    sendLedData(data);
}

void AudioTestPage::drawMicSection(Surface& surface) {
    Painter::getInstance().drawText(surface, 0, 5, "MIC", COLOR_WHITE, 0);

    int barX = 0;
    int barY = 8;
    int barW = 24;
    int barH = 6;

    Painter::getInstance().drawRect(surface, barX, barY, barW, barH, COLOR_GRAY, false);

    int fillW = mMicPercent * (barW - 2) / 100;
    if (fillW > 0) {
        Color barColor = COLOR_GREEN;
        if (mMicPercent > 80) barColor = COLOR_RED;
        else if (mMicPercent > 50) barColor = COLOR_YELLOW;
        Painter::getInstance().drawRect(surface, barX + 1, barY + 1, fillW, barH - 2, barColor, true);
    }
}

void AudioTestPage::drawVolSection(Surface& surface) {
    int offsetX = 27;

    Painter::getInstance().drawText(surface, offsetX, 5, "VOL", COLOR_WHITE, 0);

    int barX = offsetX;
    int barY = 8;
    int barW = 24;
    int barH = 6;

    Painter::getInstance().drawRect(surface, barX, barY, barW, barH, COLOR_GRAY, false);

    for (int i = 0; i < mVolumeLevel && i < 6; i++) {
        int segX = barX + 1 + i * 4;
        Color segColor = COLOR_GREEN;
        if (i >= 4) segColor = COLOR_RED;
        else if (i >= 3) segColor = COLOR_YELLOW;
        Painter::getInstance().drawRect(surface, segX, barY + 1, 3, barH - 2, segColor, true);
    }
}
