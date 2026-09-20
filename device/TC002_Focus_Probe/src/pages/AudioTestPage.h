#ifndef PAGES_AUDIOTESTPAGE_H_
#define PAGES_AUDIOTESTPAGE_H_

#include "pages/PageBase.h"
#include "utils/Surface.h"
#include "utils/Painter.h"
#include <mutex>

class AudioTestPage : public PageBase {
public:
    AudioTestPage();
    virtual ~AudioTestPage();

    virtual void draw() override;
    virtual void onEnter() override;
    virtual void onExit() override;
    virtual bool onKeyEvent(int keyCode, int keyStatus) override;

    void setVolumeLevel(int level);
    int getVolumeLevel() const;

    void stopAudio();

private:
    std::mutex mMutex;
    int mMicPercent;
    int mVolumeLevel;
    bool mIsPlaying;

    void drawLocked();
    void drawMicSection(Surface& surface);
    void drawVolSection(Surface& surface);
};

#endif
