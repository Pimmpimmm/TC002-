#include "pages/FocusPage.h"

#include "focus/FocusController.h"
#include "managers/KeyManager.h"
#include "utils/Painter.h"
#include <base/base.h>
#include <stdio.h>

namespace {

const Color COLOR_BLACK(0, 0, 0);
const Color COLOR_DIM(18, 18, 18);
const Color COLOR_READY(50, 130, 255);
const Color COLOR_FOCUS(40, 230, 110);
const Color COLOR_REST(255, 180, 45);
const Color COLOR_WARNING(255, 70, 35);
const Color COLOR_TEXT(225, 235, 255);

const uint8_t DIGITS[10][7] = {
	{0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E},
	{0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E},
	{0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
	{0x1E, 0x01, 0x01, 0x0E, 0x01, 0x01, 0x1E},
	{0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
	{0x1F, 0x10, 0x10, 0x1E, 0x01, 0x01, 0x1E},
	{0x0E, 0x10, 0x10, 0x1E, 0x11, 0x11, 0x0E},
	{0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
	{0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
	{0x0E, 0x11, 0x11, 0x0F, 0x01, 0x01, 0x0E}
};

} // namespace

FocusPage::FocusPage() : PageBase("FocusPage") {
}

FocusPage::~FocusPage() {
}

void FocusPage::onEnter() {
	LOGI_TRACE("FocusPage: onEnter");
}

void FocusPage::onExit() {
	LOGI_TRACE("FocusPage: onExit");
}

bool FocusPage::onKeyEvent(int keyCode, int keyStatus) {
	const bool rotation = keyCode == E_KEYCODE_CLOCKWISE || keyCode == E_KEYCODE_ANTI_CLOCKWISE;
	if ((keyCode == E_KEYCODE_MIDDLE_BUTTON && keyStatus == 1) || rotation) draw();
	return false;
}

void FocusPage::draw() {
	const FocusSnapshot state = FocusController::getInstance().snapshot();
	Surface surface(52, 16, COLOR_BLACK);
	Color accent = state.phase == FocusPhase::FOCUS ? COLOR_FOCUS
		: (state.phase == FocusPhase::REST ? COLOR_REST : COLOR_READY);
	if (state.phase != FocusPhase::READY && state.remainingSeconds <= 30) accent = COLOR_WARNING;

	drawModeIcon(surface, accent, state.phase);
	drawCountdown(surface, state.remainingSeconds,
		state.phase == FocusPhase::READY ? COLOR_TEXT : accent);

	const char* label = state.phase == FocusPhase::FOCUS ? "FOCUS"
		: (state.phase == FocusPhase::REST ? "REST" : "READY");
	Painter& painter = Painter::getInstance();
	const int labelWidth = painter.getTextWidth(label, 1);
	painter.drawText(surface, 33 - labelWidth / 2, 14, label, accent, 1);
	drawProgress(surface, state.remainingSeconds, state.totalSeconds, accent);

	std::vector<uint8_t> data;
	surface.extractRGB(data);
	sendLedData(data);
}

void FocusPage::drawModeIcon(Surface& surface, const Color& color, FocusPhase phase) {
	Painter& painter = Painter::getInstance();
	if (phase == FocusPhase::REST) {
		painter.drawLine(surface, 2, 4, 8, 4, color);
		painter.drawLine(surface, 2, 4, 2, 9, color);
		painter.drawLine(surface, 2, 9, 8, 9, color);
		painter.drawLine(surface, 8, 4, 8, 9, color);
		painter.drawLine(surface, 9, 5, 11, 5, color);
		painter.drawLine(surface, 11, 5, 11, 8, color);
		painter.drawLine(surface, 9, 8, 11, 8, color);
		painter.drawPixel(surface, 4, 2, color);
		painter.drawPixel(surface, 6, 1, color);
		return;
	}
	painter.drawCircle(surface, 6, 6, 5, color, false);
	painter.drawLine(surface, 6, 6, 6, 3, color);
	painter.drawLine(surface, 6, 6, 9, 6, color);
	painter.drawPixel(surface, 6, 6, color);
}

void FocusPage::drawCountdown(Surface& surface, int seconds, const Color& color) {
	if (seconds < 0) seconds = 0;
	if (seconds > 99 * 60 + 59) seconds = 99 * 60 + 59;
	const int minutes = seconds / 60;
	const int secs = seconds % 60;
	const int values[4] = {minutes / 10, minutes % 10, secs / 10, secs % 10};
	int x = 20;
	for (int i = 0; i < 4; ++i) {
		drawDigit(surface, x, 1, values[i], color);
		x += 6;
		if (i == 1) {
			Painter::getInstance().drawPixel(surface, x, 3, color);
			Painter::getInstance().drawPixel(surface, x, 6, color);
			x += 3;
		}
	}
}

void FocusPage::drawDigit(Surface& surface, int x, int y, int digit, const Color& color) {
	if (digit < 0 || digit > 9) return;
	Painter& painter = Painter::getInstance();
	for (int row = 0; row < 7; ++row) {
		for (int column = 0; column < 5; ++column) {
			if (DIGITS[digit][row] & (1 << (4 - column))) {
				painter.drawPixel(surface, x + column, y + row, color);
			}
		}
	}
}

void FocusPage::drawProgress(Surface& surface, int remaining, int total, const Color& color) {
	Painter& painter = Painter::getInstance();
	painter.drawLine(surface, 1, 15, 50, 15, COLOR_DIM);
	if (total <= 0 || remaining <= 0) return;
	if (remaining > total) remaining = total;
	const int width = (remaining * 50 + total - 1) / total;
	painter.drawLine(surface, 1, 15, width, 15, color);
}
