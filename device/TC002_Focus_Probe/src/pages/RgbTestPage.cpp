#include "pages/RgbTestPage.h"
#include "base/base.h"

static const Color COLOR_WHITE(255, 255, 255);
static const Color COLOR_RED(255, 0, 0);
static const Color COLOR_GREEN(0, 255, 0);
static const Color COLOR_BLUE(0, 0, 255);
static const Color COLOR_BLACK(0, 0, 0);

#define DISPLAY_WIDTH  52
#define DISPLAY_HEIGHT 16

RgbTestPage::RgbTestPage() 
	: PageBase("RgbTestPage"), mColorIndex(0) {
}

RgbTestPage::~RgbTestPage() {
}

void RgbTestPage::onEnter() {
	LOGD_TRACE("RgbTestPage: onEnter");
	mColorIndex = 0;
}

void RgbTestPage::onExit() {
	LOGD_TRACE("RgbTestPage: onExit");
}

bool RgbTestPage::onKeyEvent(int keyCode, int keyStatus) {
	if (keyStatus != 1) {
		return true;
	}
	
	switch (keyCode) {
		case E_KEYCODE_LEFT_BUTTON:
			mColorIndex = (mColorIndex - 1 + 4) % 4;
			LOGD_TRACE("RgbTestPage: Color changed to index %d", mColorIndex);
			draw();
			return false;
		case E_KEYCODE_RIGHT_BUTTON:
			mColorIndex = (mColorIndex + 1) % 4;
			LOGD_TRACE("RgbTestPage: Color changed to index %d", mColorIndex);
			draw();
			return false;
		default:
			return true;
	}
	return true;
}

void RgbTestPage::draw() {
	Surface surface(DISPLAY_WIDTH, DISPLAY_HEIGHT, COLOR_BLACK);
	
	drawColorRect(surface);
	
	std::vector<uint8_t> data;
	surface.extractRGB(data);
	sendLedData(data);
}

void RgbTestPage::drawColorRect(Surface& surface) {
	Color currentColor;
	
	switch (mColorIndex) {
		case 0:
			currentColor = COLOR_WHITE;
			break;
		case 1:
			currentColor = COLOR_RED;
			break;
		case 2:
			currentColor = COLOR_GREEN;
			break;
		case 3:
			currentColor = COLOR_BLUE;
			break;
		default:
			currentColor = COLOR_WHITE;
			break;
	}
	Painter::getInstance().drawRect(surface, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, currentColor, true);
}
