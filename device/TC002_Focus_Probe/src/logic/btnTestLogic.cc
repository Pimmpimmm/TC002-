#pragma once
#include "uart/ProtocolSender.h"
#include "managers/KeyManager.h"
#include "managers/PageManager.h"
#include "focus/FocusController.h"
#include <base/log.h>
namespace {
bool worldTimeVisible = false;

void keyEventCb(int keyCode, int keyStatus) {
	LOGI_TRACE("FocusProbe key: code=%d status=%d", keyCode, keyStatus);
	FocusController::getInstance().onKeyEvent(keyCode, keyStatus);
	const bool rotation = keyCode == E_KEYCODE_CLOCKWISE || keyCode == E_KEYCODE_ANTI_CLOCKWISE;
	if (rotation) {
		worldTimeVisible = !worldTimeVisible;
		PageManager::getInstance().navigateTo(worldTimeVisible ? "WorldTimePage" : "FocusPage");
		return;
	}
	if (worldTimeVisible && keyCode == E_KEYCODE_MIDDLE_BUTTON && keyStatus == 1) {
		worldTimeVisible = false;
		PageManager::getInstance().navigateTo("FocusPage");
		return;
	}
	PageManager::getInstance().onKeyEvent(keyCode, keyStatus);
}


}

#define TIMER_FOCUS_REFRESH 1
#define TIMER_FOCUS_REFRESH_TIME 1000
static S_ACTIVITY_TIMEER REGISTER_ACTIVITY_TIMER_TAB[] = {
	{TIMER_FOCUS_REFRESH, TIMER_FOCUS_REFRESH_TIME}
};

static void onUI_init(){


}

static void onUI_intent(const Intent *intentPtr) {
    if (intentPtr != NULL) {
        //TODO
    }
}


static void onUI_show() {
	LOGI_TRACE("FocusProbe boot 13: btnTestActivity shown; registering key callback");
	worldTimeVisible = false;
	KeyManager::getInstance().addKeyEventCallback(keyEventCb);
	PageManager::getInstance().navigateTo("FocusPage");
	LOGI_TRACE("FocusProbe boot 14: FocusPage active");
}


static void onUI_hide() {
	KeyManager::getInstance().removeKeyEventCallback(keyEventCb);
}

static void onUI_quit() {
	KeyManager::getInstance().removeKeyEventCallback(keyEventCb);
}

static void onProtocolDataUpdate(const SProtocolData &data) {

}

static bool onUI_Timer(int id){
	switch (id) {
		case TIMER_FOCUS_REFRESH:
			PageManager::getInstance().drawCurrentPage();
			break;
		default:
			break;
	}
    return true;
}

static bool onbtnTestActivityTouchEvent(const MotionEvent &ev) {
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
