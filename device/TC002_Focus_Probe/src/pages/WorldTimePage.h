#ifndef PAGES_WORLDTIMEPAGE_H_
#define PAGES_WORLDTIMEPAGE_H_

#include "pages/PageBase.h"
#include "utils/Surface.h"

class WorldTimePage : public PageBase {
public:
	WorldTimePage();
	virtual ~WorldTimePage();

	virtual void draw() override;
	virtual void onEnter() override;
	virtual void onExit() override;
	virtual bool onKeyEvent(int keyCode, int keyStatus) override;

private:
	void drawTime(Surface& surface, int hour, int minute, int second, const Color& color);
	void drawDigit(Surface& surface, int x, int y, int digit, const Color& color);
	void drawColon(Surface& surface, int x, int y, const Color& color);
};

#endif
