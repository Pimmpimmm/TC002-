#ifndef PAGES_BTNTESTPAGE_H_
#define PAGES_BTNTESTPAGE_H_

#include "pages/PageBase.h"
#include "utils/Surface.h"
#include "utils/Painter.h"

class BtnTestPage : public PageBase {
public:
	BtnTestPage();
	virtual ~BtnTestPage();
	
	virtual void draw() override;
	virtual void onEnter() override;
	virtual void onExit() override;
	virtual bool onKeyEvent(int keyCode, int keyStatus) override;
	
private:
	bool mBtnStates[4];

	void drawButtonRegion(Surface& surface, int index, bool isPressed);
	
	int getKeyIndex(int keyCode);
};

#endif
