#include "pages/FocusPage.h"

#include "focus/FocusController.h"
#include "managers/KeyManager.h"
#include "utils/Painter.h"
#include <base/base.h>
#include <stdio.h>

namespace {

const Color COLOR_BLACK(0, 0, 0);
const Color COLOR_DIM(18, 18, 18);
const Color COLOR_READY(255, 255, 255);
const Color COLOR_FOCUS(40, 230, 110);
const Color COLOR_REST(40, 120, 255);
const Color COLOR_ALERT(255, 40, 40);
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

// Six compact 7x9 ASCII pairs used for the two completion prompts. Each block
// contains two 3x7 letters. drawPrompt() scales every source pixel to a 2x2
// cell, making GO REST / GO WORK fill the matrix while leaving a one-cell edge.
const uint8_t GLYPH_GO[9] = {0x77, 0x45, 0x45, 0x55, 0x55, 0x55, 0x77, 0x00, 0x00};
const uint8_t GLYPH_RE[9] = {0x67, 0x54, 0x54, 0x66, 0x54, 0x54, 0x57, 0x00, 0x00};
const uint8_t GLYPH_ST[9] = {0x77, 0x42, 0x42, 0x72, 0x12, 0x12, 0x72, 0x00, 0x00};
const uint8_t GLYPH_BLANK[9] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
const uint8_t GLYPH_WO[9] = {0x57, 0x55, 0x55, 0x75, 0x75, 0x75, 0x27, 0x00, 0x00};
const uint8_t GLYPH_RK[9] = {0x65, 0x55, 0x56, 0x64, 0x56, 0x55, 0x55, 0x00, 0x00};
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
	const bool volume = (keyCode == E_KEYCODE_LEFT_BUTTON || keyCode == E_KEYCODE_RIGHT_BUTTON)
		&& keyStatus == 1;
	if ((keyCode == E_KEYCODE_MIDDLE_BUTTON && keyStatus == 1) || rotation || volume) draw();
	return false;
}

void FocusPage::draw() {
	const FocusSnapshot state = FocusController::getInstance().snapshot();
	Surface surface(52, 16, COLOR_BLACK);
	Color accent = COLOR_READY;
	if (state.phase == FocusPhase::FOCUS) accent = COLOR_FOCUS;
	else if (state.phase == FocusPhase::REST) accent = COLOR_REST;
	else if (state.phase == FocusPhase::FOCUS_DONE || state.phase == FocusPhase::REST_DONE) accent = COLOR_ALERT;

	if (state.volumeVisible) {
		drawVolumeOverlay(surface, state.volumeLevel);
	} else if (state.phase == FocusPhase::FOCUS_DONE || state.phase == FocusPhase::REST_DONE) {
		drawPrompt(surface, state.phase == FocusPhase::FOCUS_DONE);
	} else {
		drawModeIcon(surface, accent, state.phase);
		drawCountdown(surface, state.remainingSeconds, accent);

		const char* label = state.phase == FocusPhase::FOCUS ? "FOCUS"
			: (state.phase == FocusPhase::REST ? "REST" : "READY");
		Painter& painter = Painter::getInstance();
		const int labelWidth = painter.getTextWidth(label, 1);
		painter.drawText(surface, 33 - labelWidth / 2, 14, label, accent, 1);
		drawProgress(surface, state.remainingSeconds, state.totalSeconds, accent);
	}

	std::vector<uint8_t> data;
	surface.extractRGB(data);
	sendLedData(data);
}

void FocusPage::drawVolumeOverlay(Surface& surface, int volumeLevel) {
	Painter& painter = Painter::getInstance();
	const Color COLOR_BAR(70, 70, 70);
	painter.drawText(surface, 0, 4, "VOL", COLOR_READY, 0);
	const int barX = 17;
	const int barY = 3;
	const int barW = 34;
	const int barH = 8;
	painter.drawRect(surface, barX, barY, barW, barH, COLOR_BAR, false);
	for (int index = 0; index < 6; ++index) {
		const int segmentX = barX + 2 + index * 5;
		const Color& color = index < volumeLevel ? COLOR_READY : COLOR_DIM;
		painter.drawRect(surface, segmentX, barY + 2, 4, 4, color, true);
	}
}

void FocusPage::drawPrompt(Surface& surface, bool focusCompleted) {
	static const uint8_t* const restPrompt[] = {
		GLYPH_GO, GLYPH_RE, GLYPH_ST
	};
	static const uint8_t* const workPrompt[] = {
		GLYPH_GO, GLYPH_WO, GLYPH_RK
	};
	const uint8_t* const* glyphs = focusCompleted ? restPrompt : workPrompt;
	const int glyphCount = 3;
	const int glyphWidth = 7;
	const int scale = 2;
	const int gap = 4;
	const int blockWidth = glyphWidth * scale;
	const int totalWidth = glyphCount * blockWidth + (glyphCount - 1) * gap;
	const int startX = (52 - totalWidth) / 2;
	const int startY = 1;
	Painter& painter = Painter::getInstance();
	const Color& promptColor = focusCompleted ? COLOR_REST : COLOR_FOCUS;
	for (int index = 0; index < glyphCount; ++index) {
		for (int row = 0; row < 7; ++row) {
			for (int column = 0; column < glyphWidth; ++column) {
				if (glyphs[index][row] & (1 << (glyphWidth - 1 - column))) {
					for (int dy = 0; dy < scale; ++dy) {
						for (int dx = 0; dx < scale; ++dx) {
							painter.drawPixel(surface,
								startX + index * (blockWidth + gap) + column * scale + dx,
								startY + row * scale + dy, promptColor);
						}
					}
				}
			}
		}
	}
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
