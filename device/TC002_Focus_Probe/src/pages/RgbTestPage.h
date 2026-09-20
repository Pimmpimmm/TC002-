#ifndef PAGES_RGBTESTPAGE_H_
#define PAGES_RGBTESTPAGE_H_

#include "pages/PageBase.h"
#include "utils/Surface.h"
#include "utils/Painter.h"

class RgbTestPage : public PageBase {
public:
	RgbTestPage();
	virtual ~RgbTestPage();
	
	virtual void draw() override;
	virtual void onEnter() override;
	virtual void onExit() override;
	virtual bool onKeyEvent(int keyCode, int keyStatus) override;
	
private:
	int mColorIndex;  // 0:白，1:红，2:绿，3:蓝
	
	void drawColorRect(Surface& surface);
};

#endif
