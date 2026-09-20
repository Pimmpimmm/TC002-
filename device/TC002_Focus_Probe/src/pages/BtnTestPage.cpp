#include "pages/BtnTestPage.h"
#include "base/base.h"

static const Color COLOR_WHITE(255, 255, 255);
static const Color COLOR_GREEN(0, 255, 0);
static const Color COLOR_BLACK(0, 0, 0);

#define DISPLAY_WIDTH  52
#define DISPLAY_HEIGHT 16

#define BTN_WIDTH    12
#define BTN_GAP      1
#define BTN_HEIGHT   16

BtnTestPage::BtnTestPage() 
	: PageBase("BtnTestPage") {
    memset(mBtnStates, 0, sizeof(mBtnStates));
}

BtnTestPage::~BtnTestPage() {
}

void BtnTestPage::onEnter() {
	LOGD_TRACE("BtnTestPage: onEnter");
	memset(mBtnStates, 0, sizeof(mBtnStates));
}

void BtnTestPage::onExit() {
	LOGD_TRACE("BtnTestPage: onExit");
}

bool BtnTestPage::onKeyEvent(int keyCode, int keyStatus) {
	int index = getKeyIndex(keyCode);
	if (index >= 0 && index < 4) {
		mBtnStates[index] = (keyStatus == 1);
		LOGD_TRACE("BtnTestPage: Button %d state changed to %s", 
				   index, mBtnStates[index] ? "PRESSED" : "RELEASED");
		draw();
		return false;
	}
	return true;
}

int BtnTestPage::getKeyIndex(int keyCode) {
	switch (keyCode) {
		case E_KEYCODE_KNOB_BUTTON:
			return 0;
		case E_KEYCODE_LEFT_BUTTON:
			return 1;
		case E_KEYCODE_MIDDLE_BUTTON:
			return 2;
		case E_KEYCODE_RIGHT_BUTTON:
			return 3;
		default:
			return -1;
	}
    return -1;
}

void BtnTestPage::draw() {
	Surface surface(52, 16, COLOR_BLACK);
	
	for (int i = 0; i < 4; i++) {
		drawButtonRegion(surface, i, mBtnStates[i]);
	}
	std::vector<uint8_t> data;
	surface.extractRGB(data);
    sendLedData(data);
}

void BtnTestPage::drawButtonRegion(Surface& surface, int index, bool isPressed) {
	int x = index * (BTN_WIDTH + BTN_GAP);
	int y = 0;
	
	Color color = isPressed ? COLOR_GREEN : COLOR_WHITE;
	
	Painter::getInstance().drawRect(surface, x, y, BTN_WIDTH, BTN_HEIGHT, color, true);
}
