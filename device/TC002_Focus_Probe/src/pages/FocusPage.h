#ifndef PAGES_FOCUSPAGE_H_
#define PAGES_FOCUSPAGE_H_

#include "focus/FocusController.h"
#include "pages/PageBase.h"
#include "utils/Surface.h"

class FocusPage : public PageBase {
public:
	FocusPage();
	virtual ~FocusPage();

	virtual void draw() override;
	virtual void onEnter() override;
	virtual void onExit() override;
	virtual bool onKeyEvent(int keyCode, int keyStatus) override;

private:
	void drawModeIcon(Surface& surface, const Color& color, FocusPhase phase);
	void drawPrompt(Surface& surface, bool focusCompleted);
	void drawVolumeOverlay(Surface& surface, int volumeLevel);
	void drawCountdown(Surface& surface, int seconds, const Color& color);
	void drawDigit(Surface& surface, int x, int y, int digit, const Color& color);
	void drawProgress(Surface& surface, int remaining, int total, const Color& color);
};

#endif
