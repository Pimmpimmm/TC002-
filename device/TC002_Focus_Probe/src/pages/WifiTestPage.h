#ifndef PAGES_WIFITESTPAGE_H_
#define PAGES_WIFITESTPAGE_H_

#include "pages/PageBase.h"
#include "utils/Surface.h"
#include "utils/Painter.h"
#include "managers/KeyManager.h"
#include <string>
#include <thread>
#include <atomic>

class WifiTestPage : public PageBase {
public:
    enum WifiState { WIFI_IDLE, WIFI_TESTING, WIFI_PASS, WIFI_FAIL };
    enum BleState  { BLE_IDLE, BLE_CONNECTED };

    WifiTestPage();
    virtual ~WifiTestPage();

    virtual void draw() override;
    virtual void onEnter() override;
    virtual void onExit() override;
    virtual bool onKeyEvent(int keyCode, int keyStatus) override;

    void setWifiParams(const std::string& ssid, const std::string& pwd, bool needConnect);

private:
    std::string mSsid;
    std::string mPassword;
    bool mNeedConnect;

    std::atomic<int> mWifiState;
    std::atomic<int> mBleState;
    std::atomic<bool> mRunning;

    std::thread mTestThread;

    void startTest();
    void stopTest();
    void restartTest();
    void testRoutine();

    void drawWifiSection(Surface& surface);
    void drawBleSection(Surface& surface);
};

#endif
