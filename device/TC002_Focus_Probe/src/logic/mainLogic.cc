#include "uart/ProtocolSender.h"
#include "base/base.h"
#include <base/wifi.h>
#include "managers/KeyManager.h"
#include "managers/PageManager.h"
#include "managers/McuManager.h"
#include "pages/FocusPage.h"
#include "pages/WorldTimePage.h"
#include "focus/FocusController.h"
#include <net/NetManager.h>
#include <thread>
#include <unistd.h>
#include <os/SystemProperties.h>

#define WIFIMANAGER NETMANAGER->getWifiManager()
namespace {

void startWifiInBackground() {
	LOGI_TRACE("FocusProbe boot 10: WiFi worker entered");
	if (!base::wifiOnAndWait(10)) {
		LOGE_TRACE("FocusProbe: WiFi failed to start; MQTT worker will retry");
		return;
	}

	// A debug launch inherits the stock app's existing connection. A cold boot of
	// the persistent image does not, so explicitly ask wpa_supplicant to reuse
	// the network already saved under /data. No SSID or password is embedded in
	// this application image.
	for (int attempt = 0; attempt < 60; ++attempt) {
		if (WIFIMANAGER->isConnected()) {
			LOGI_TRACE("FocusProbe: WiFi connected, ip=%s", WIFIMANAGER->getIp());
			return;
		}
		if (attempt == 0 || attempt == 30) {
			WIFIMANAGER->reconnect();
		}
		usleep(500 * 1000);
	}
	LOGE_TRACE("FocusProbe: WiFi reconnect timed out; MQTT worker will retry");
}

}

static S_ACTIVITY_TIMEER REGISTER_ACTIVITY_TIMER_TAB[] = {

};

/**
 * 当界面构造时触发
 */
static void onUI_init(){
	LOGI_TRACE("FocusProbe boot 03: mainActivity init entered");
	//防砖属性
	SystemProperties::setString("sys.zkapp.state", "running");
	LOGI_TRACE("FocusProbe boot 04: app state marked running");
	//初始化串口
	McuManager::getInstance().initialize(new PixelMcuProto::McuParse("/dev/ttyS1", 1500000));
	LOGI_TRACE("FocusProbe boot 05: MCU transport initialized");

	//每次开机必须先请求一下版本,才可以显示画面
	std::string mcuVer;
	LOGI_TRACE("FocusProbe boot 06: querying MCU version");
	const int mcuResult = McuManager::getInstance().queryMcuVersion(mcuVer);
	LOGI_TRACE("FocusProbe boot 07: MCU query finished, result=%d, version=[%s]",
		mcuResult, mcuVer.c_str());

	PageManager::getInstance().registerPage(std::unique_ptr<PageBase>(new FocusPage()));
	PageManager::getInstance().registerPage(std::unique_ptr<PageBase>(new WorldTimePage()));
	LOGI_TRACE("FocusProbe boot 08: page registered");

	KeyManager::getInstance().start();
	FocusController::getInstance().start();
	LOGI_TRACE("FocusProbe boot 09: key and focus workers started");
	std::thread(startWifiInBackground).detach();
	LOGI_TRACE("FocusProbe boot 11: opening btnTestActivity");
    EASYUICONTEXT->openActivity("btnTestActivity", nullptr);
	LOGI_TRACE("FocusProbe boot 12: btnTestActivity open requested");
}

/**
 * 当切换到该界面时触发
 */
static void onUI_intent(const Intent *intentPtr) {
    if (intentPtr != NULL) {
        //TODO
    }
}

/*
 * 当界面显示时触发
 */
static void onUI_show() {
}

/*
 * 当界面隐藏时触发
 */
static void onUI_hide() {

}

/*
 * 当界面完全退出时触发
 */
static void onUI_quit() {
	FocusController::getInstance().shutdown();
}

/**
 * 串口数据回调接口
 */
static void onProtocolDataUpdate(const SProtocolData &data) {

}

/**
 * 定时器触发函数
 * 不建议在此函数中写耗时操作，否则将影响UI刷新
 * 参数： id
 *         当前所触发定时器的id，与注册时的id相同
 * 返回值: true
 *             继续运行当前定时器
 *         false
 *             停止运行当前定时器
 */
static bool onUI_Timer(int id){
	switch (id) {

		default:
			break;
	}
    return true;
}

/**
 * 有新的触摸事件时触发
 * 参数：ev
 *         新的触摸事件
 * 返回值：true
 *            表示该触摸事件在此被拦截，系统不再将此触摸事件传递到控件上
 *         false
 *            触摸事件将继续传递到控件上
 */
static bool onmainActivityTouchEvent(const MotionEvent &ev) {
    switch (ev.mActionStatus) {
		case MotionEvent::E_ACTION_DOWN://触摸按下
			//LOGD("时刻 = %ld 坐标  x = %d, y = %d", ev.mEventTime, ev.mX, ev.mY);
			break;
		case MotionEvent::E_ACTION_MOVE://触摸滑动
			break;
		case MotionEvent::E_ACTION_UP:  //触摸抬起
			break;
		default:
			break;
	}
	return false;
}
