#include "pages/WorldTimePage.h"

#include "utils/Painter.h"
#include <base/base.h>
#include <stdint.h>
#include <time.h>

namespace {

const Color COLOR_BLACK(0, 0, 0);
const Color COLOR_TIME(255, 255, 255);

// TC002 keeps its system clock in UTC. The user's local zone is China Standard
// Time, which has no daylight-saving transition.
const int64_t LOCAL_UTC_OFFSET_SECONDS = 8 * 60 * 60;

// Exact 5x10 digit shapes extracted from the stock TC002 font_image assets.
const uint8_t DIGITS[10][10] = {
	{0x1F, 0x1F, 0x1B, 0x1B, 0x1B, 0x1B, 0x1B, 0x1B, 0x1F, 0x1F},
	{0x06, 0x0E, 0x1E, 0x06, 0x06, 0x06, 0x06, 0x06, 0x1F, 0x1F},
	{0x1F, 0x1F, 0x03, 0x03, 0x1F, 0x1F, 0x18, 0x18, 0x1F, 0x1F},
	{0x1F, 0x1F, 0x03, 0x03, 0x1F, 0x1F, 0x03, 0x03, 0x1F, 0x1F},
	{0x1B, 0x1B, 0x1B, 0x1B, 0x1F, 0x1F, 0x03, 0x03, 0x03, 0x03},
	{0x1F, 0x1F, 0x18, 0x18, 0x1F, 0x1F, 0x03, 0x03, 0x1F, 0x1F},
	{0x1F, 0x1F, 0x18, 0x18, 0x1F, 0x1F, 0x1B, 0x1B, 0x1F, 0x1F},
	{0x1F, 0x1F, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03},
	{0x1F, 0x1F, 0x1B, 0x1B, 0x1F, 0x1F, 0x1B, 0x1B, 0x1F, 0x1F},
	{0x1F, 0x1F, 0x1B, 0x1B, 0x1F, 0x1F, 0x03, 0x03, 0x1F, 0x1F}
};

} // namespace

WorldTimePage::WorldTimePage() : PageBase("WorldTimePage") {
}

WorldTimePage::~WorldTimePage() {
}

void WorldTimePage::onEnter() {
	LOGI_TRACE("WorldTimePage: onEnter");
}

void WorldTimePage::onExit() {
	LOGI_TRACE("WorldTimePage: onExit");
}

bool WorldTimePage::onKeyEvent(int keyCode, int keyStatus) {
	return false;
}

void WorldTimePage::draw() {
	time_t localEpoch = time(nullptr) + LOCAL_UTC_OFFSET_SECONDS;
	tm local = {};
	gmtime_r(&localEpoch, &local);

	Surface surface(52, 16, COLOR_BLACK);
	drawTime(surface, local.tm_hour, local.tm_min, local.tm_sec, COLOR_TIME);

	std::vector<uint8_t> data;
	surface.extractRGB(data);
	sendLedData(data);
}

void WorldTimePage::drawTime(Surface& surface, int hour, int minute, int second, const Color& color) {
	drawDigit(surface, 4, 3, hour / 10, color);
	drawDigit(surface, 10, 3, hour % 10, color);
	drawColon(surface, 17, 5, color);
	drawDigit(surface, 21, 3, minute / 10, color);
	drawDigit(surface, 27, 3, minute % 10, color);
	drawColon(surface, 34, 5, color);
	drawDigit(surface, 38, 3, second / 10, color);
	drawDigit(surface, 44, 3, second % 10, color);
}

void WorldTimePage::drawDigit(Surface& surface, int x, int y, int digit, const Color& color) {
	if (digit < 0 || digit > 9) return;
	Painter& painter = Painter::getInstance();
	for (int row = 0; row < 10; ++row) {
		for (int column = 0; column < 5; ++column) {
			if (DIGITS[digit][row] & (1 << (4 - column))) {
				painter.drawPixel(surface, x + column, y + row, color);
			}
		}
	}
}

void WorldTimePage::drawColon(Surface& surface, int x, int y, const Color& color) {
	Painter& painter = Painter::getInstance();
	for (int column = 0; column < 2; ++column) {
		painter.drawPixel(surface, x + column, y, color);
		painter.drawPixel(surface, x + column, y + 1, color);
		painter.drawPixel(surface, x + column, y + 4, color);
		painter.drawPixel(surface, x + column, y + 5, color);
	}
}
