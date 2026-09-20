#include "pages/WifiTestPage.h"
#include "base/base.h"
#include <net/NetManager.h>
#include "ble/bluetooth_service.h"

#define WIFIMANAGER NETMANAGER->getWifiManager()

static const Color COLOR_WHITE(255, 255, 255);
static const Color COLOR_GREEN(0, 255, 0);
static const Color COLOR_YELLOW(255, 255, 0);
static const Color COLOR_RED(255, 0, 0);
static const Color COLOR_BLACK(0, 0, 0);

#define DISPLAY_WIDTH  52
#define DISPLAY_HEIGHT 16

WifiTestPage::WifiTestPage()
    : PageBase("WifiTestPage"),
      mNeedConnect(false),
      mWifiState(WIFI_IDLE),
      mBleState(BLE_IDLE),
      mRunning(false) {
}

WifiTestPage::~WifiTestPage() {
    stopTest();
}

void WifiTestPage::setWifiParams(const std::string& ssid, const std::string& pwd, bool needConnect) {
    mSsid = ssid;
    mPassword = pwd;
    mNeedConnect = needConnect;
}

void WifiTestPage::onEnter() {
    LOGD_TRACE("WifiTestPage: onEnter");

    mBleState = BluetoothService::instance().isConnected() ? BLE_CONNECTED : BLE_IDLE;

    if (mSsid.empty()) {
        mWifiState = WIFI_FAIL;
        draw();
        return;
    }

    startTest();
    draw();
}

void WifiTestPage::onExit() {
    LOGD_TRACE("WifiTestPage: onExit");
    stopTest();
}

void WifiTestPage::startTest() {
    if (mRunning) return;
    mRunning = true;
    mWifiState = WIFI_TESTING;
    mTestThread = std::thread(&WifiTestPage::testRoutine, this);
}

void WifiTestPage::stopTest() {
    mRunning = false;
    WIFIMANAGER->stopScan();
    if (mTestThread.joinable()) {
        mTestThread.join();
    }
}

void WifiTestPage::testRoutine() {
    // 扫描 WiFi，最长 30 秒
    WIFIMANAGER->startScan();

    bool found = false;
    for (int i = 0; i < 60 && mRunning; i++) {
        std::vector<WifiInfo> infos;
        WIFIMANAGER->getWifiScanInfosLock(infos);
        for (const auto& info : infos) {
            if (info.getSsid() == mSsid) {
                found = true;
                break;
            }
        }
        if (found) break;
        usleep(500 * 1000);
    }

    if (!mRunning) return;
    WIFIMANAGER->stopScan();

    if (!found) {
        mWifiState = WIFI_FAIL;
        return;
    }

    if (!mNeedConnect) {
        mWifiState = WIFI_PASS;
        return;
    }

    // 连接 WiFi，最长 30 秒
    WIFIMANAGER->connect(mSsid, mPassword);
    for (int i = 0; i < 60 && mRunning; i++) {
        if (WIFIMANAGER->isConnected()) {
            mWifiState = WIFI_PASS;
            return;
        }
        usleep(500 * 1000);
    }

    if (!mRunning) return;
    mWifiState = WIFI_FAIL;
}

bool WifiTestPage::onKeyEvent(int keyCode, int keyStatus) {
    if (keyStatus != 1) return true;
    switch (keyCode) {
        case E_KEYCODE_MIDDLE_BUTTON:
            restartTest();
            return false;
        default:
            return true;
    }
    return true;
}

void WifiTestPage::restartTest() {
    stopTest();
    if (!mSsid.empty()) {
        startTest();
    } else {
        mWifiState = WIFI_FAIL;
    }
    draw();
}

void WifiTestPage::draw() {
    Surface surface(DISPLAY_WIDTH, DISPLAY_HEIGHT, COLOR_BLACK);

    // 实时轮询 BLE 连接状态
    mBleState = BluetoothService::instance().isConnected() ? BLE_CONNECTED : BLE_IDLE;

    drawWifiSection(surface);
    drawBleSection(surface);

    std::vector<uint8_t> data;
    surface.extractRGB(data);
    sendLedData(data);
}

void WifiTestPage::drawWifiSection(Surface& surface) {
    Color color;
    switch (mWifiState.load()) {
        case WIFI_TESTING: color = COLOR_YELLOW; break;
        case WIFI_PASS:    color = COLOR_GREEN;  break;
        case WIFI_FAIL:    color = COLOR_RED;    break;
        default:           color = COLOR_WHITE;  break;
    }

    int textW = Painter::getInstance().getTextWidth("WIFI", 0);
    int startX = (26 - textW) / 2;
    Painter::getInstance().drawText(surface, startX, 11, "WIFI", color, 0);
}

void WifiTestPage::drawBleSection(Surface& surface) {
    Color color = (mBleState.load() == BLE_CONNECTED) ? COLOR_GREEN : COLOR_WHITE;

    int textW = Painter::getInstance().getTextWidth("BLE", 0);
    int startX = 26 + (26 - textW) / 2;
    Painter::getInstance().drawText(surface, startX, 11, "BLE", color, 0);
}
