#pragma once

#include "focus/MqttPublisher.h"

#include <condition_variable>
#include <deque>
#include <mutex>
#include <stdint.h>
#include <string>
#include <thread>

enum class FocusPhase {
	READY,
	FOCUS,
	REST
};

struct FocusSnapshot {
	FocusPhase phase;
	int remainingSeconds;
	int totalSeconds;
};

class FocusController {
public:
	static FocusController& getInstance();
	void start();
	void shutdown();
	void onKeyEvent(int keyCode, int keyStatus);
	bool isFocusActive() const;
	FocusSnapshot snapshot() const;

private:
	enum class AudioCommand {
		NONE,
		PLAY_FOCUS_DONE,
		STOP
	};

	FocusController();
	~FocusController();
	FocusController(const FocusController&) = delete;
	FocusController& operator=(const FocusController&) = delete;

	void beginFocus(int64_t now);
	void beginRest(const char* reason);
	void stopCycle(const char* reason);
	void requestAudio(AudioCommand command);
	void enqueue(const std::string& payload);
	void workerLoop();

	mutable std::mutex mMutex;
	std::condition_variable mCondition;
	std::deque<std::string> mQueue;
	std::thread mWorker;
	MqttPublisher mPublisher;
	bool mRunning;
	FocusPhase mPhase;
	AudioCommand mAudioCommand;
	int64_t mStartedAt;
	int64_t mFocusDeadline;
	int64_t mPhaseDeadlineMonotonicMs;
	int64_t mFocusSeconds;
	int64_t mRestSeconds;
	int64_t mLastActionMs;
	uint32_t mSessionCounter;
	std::string mSessionId;
};
