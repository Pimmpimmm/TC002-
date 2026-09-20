#include "focus/FocusController.h"
#include "focus/FocusConfig.h"
#include "managers/AudioManager.h"
#include "managers/KeyManager.h"

#include <base/base.h>
#include <base/log.h>
#include <chrono>
#include <sstream>
#include <time.h>

namespace {

int64_t epochSeconds() {
	return static_cast<int64_t>(time(nullptr));
}

int64_t monotonicMs() {
	timespec value = {};
	clock_gettime(CLOCK_MONOTONIC, &value);
	return static_cast<int64_t>(value.tv_sec) * 1000 + value.tv_nsec / 1000000;
}

std::string makeEnvelope(const std::string& sessionId, const char* event,
	const char* state, const char* reason, int64_t startedAt, int64_t deadline) {
	std::ostringstream json;
	json << "{\"v\":1,\"session_id\":\"" << sessionId
		 << "\",\"event\":\"" << event
		 << "\",\"state\":\"" << state
		 << "\",\"reason\":\"" << reason
		 << "\",\"started_at\":" << startedAt
		 << ",\"focus_deadline\":" << deadline << "}";
	return json.str();
}

} // namespace

FocusController::FocusController()
	: mRunning(false), mPhase(FocusPhase::READY), mAudioCommand(AudioCommand::NONE),
	  mStartedAt(0), mFocusDeadline(0), mPhaseDeadlineMonotonicMs(0),
	  mFocusSeconds(focus_config::kFocusSeconds), mRestSeconds(focus_config::kRestSeconds),
	  mVolumeLevel(focus_config::kFocusDoneAudioVolume), mVolumeOverlayUntilMs(0),
	  mLastActionMs(0), mSessionCounter(0) {
}

FocusController::~FocusController() {
	shutdown();
}

FocusController& FocusController::getInstance() {
	static FocusController instance;
	return instance;
}

void FocusController::start() {
	{
		std::lock_guard<std::mutex> lock(mMutex);
		if (mRunning) return;
		const MqttPublisher::RuntimeConfig config = mPublisher.loadConfig();
		mFocusSeconds = config.focusSeconds;
		mRestSeconds = config.restSeconds;
		mRunning = true;
		mWorker = std::thread(&FocusController::workerLoop, this);
		if (focus_config::kAudioSelfTestOnBoot) {
			requestAudio(AudioCommand::PLAY_FOCUS_DONE);
		}
	}
	LOGI_TRACE("FocusProbe: MQTT worker started");
}

void FocusController::shutdown() {
	{
		std::lock_guard<std::mutex> lock(mMutex);
		if (!mRunning) return;
		mRunning = false;
	}
	mCondition.notify_all();
	if (mWorker.joinable()) mWorker.join();
	awtrix::AudioManager::getInstance().stopAudio();
}

bool FocusController::isFocusActive() const {
	std::lock_guard<std::mutex> lock(mMutex);
	return mPhase == FocusPhase::FOCUS;
}

FocusSnapshot FocusController::snapshot() const {
	std::lock_guard<std::mutex> lock(mMutex);
	const int64_t nowMs = monotonicMs();
	const int total = mPhase == FocusPhase::REST
		? static_cast<int>(mRestSeconds)
		: static_cast<int>(mFocusSeconds);
	int remaining = total;
	if (mPhase == FocusPhase::FOCUS || mPhase == FocusPhase::REST) {
		const int64_t remainingMs = mPhaseDeadlineMonotonicMs - nowMs;
		remaining = remainingMs > 0 ? static_cast<int>((remainingMs + 999) / 1000) : 0;
	} else if (mPhase == FocusPhase::FOCUS_DONE || mPhase == FocusPhase::REST_DONE) {
		remaining = 0;
	}
	return {mPhase, remaining, total, mVolumeLevel, nowMs < mVolumeOverlayUntilMs};
}

void FocusController::onKeyEvent(int keyCode, int keyStatus) {
	const bool isRotation = keyCode == E_KEYCODE_CLOCKWISE || keyCode == E_KEYCODE_ANTI_CLOCKWISE;
	if (!isRotation && keyStatus != 1) return;
	const bool isAudioButton = keyCode == E_KEYCODE_RIGHT_BUTTON || keyCode == E_KEYCODE_LEFT_BUTTON;
	if (keyCode != E_KEYCODE_MIDDLE_BUTTON && !isRotation && !isAudioButton) return;

	const int64_t nowMs = monotonicMs();
	std::lock_guard<std::mutex> lock(mMutex);
	if (!isRotation && nowMs - mLastActionMs < 300) return;
	mLastActionMs = nowMs;
	if (keyCode == E_KEYCODE_RIGHT_BUTTON) {
		if (mVolumeLevel < 6) ++mVolumeLevel;
		mVolumeOverlayUntilMs = nowMs + 1500;
		awtrix::AudioManager::getInstance().setVolume(mVolumeLevel);
		LOGI_TRACE("FocusProbe: volume increased to %d", mVolumeLevel);
		return;
	}
	if (keyCode == E_KEYCODE_LEFT_BUTTON) {
		if (mVolumeLevel > 0) --mVolumeLevel;
		mVolumeOverlayUntilMs = nowMs + 1500;
		awtrix::AudioManager::getInstance().setVolume(mVolumeLevel);
		LOGI_TRACE("FocusProbe: volume decreased to %d", mVolumeLevel);
		return;
	}
	if (isRotation) {
		if (mPhase != FocusPhase::READY) stopCycle("rotate_away");
		return;
	}
	if (mPhase == FocusPhase::FOCUS || mPhase == FocusPhase::FOCUS_DONE) beginRest("middle_press");
	else beginFocus(epochSeconds());
}

void FocusController::beginFocus(int64_t now) {
	requestAudio(AudioCommand::STOP);
	mVolumeOverlayUntilMs = 0;
	mPhase = FocusPhase::FOCUS;
	mStartedAt = now;
	mFocusDeadline = now + mFocusSeconds;
	mPhaseDeadlineMonotonicMs = monotonicMs() + mFocusSeconds * 1000;
	std::ostringstream id;
	id << "sess-" << now << "-" << ++mSessionCounter;
	mSessionId = id.str();
	enqueue(makeEnvelope(mSessionId, "start", "FOCUS", "middle_press", mStartedAt, mFocusDeadline));
	LOGI_TRACE("FocusProbe: focus started");
}

void FocusController::beginRest(const char* reason) {
	requestAudio(AudioCommand::STOP);
	mVolumeOverlayUntilMs = 0;
	enqueue(makeEnvelope(mSessionId, "stop", "REST", reason, mStartedAt, mFocusDeadline));
	mPhase = FocusPhase::REST;
	mPhaseDeadlineMonotonicMs = monotonicMs() + mRestSeconds * 1000;
	mCondition.notify_all();
	LOGI_TRACE("FocusProbe: rest started (%s)", reason);
}

void FocusController::stopCycle(const char* reason) {
	requestAudio(AudioCommand::STOP);
	mVolumeOverlayUntilMs = 0;
	if (mPhase == FocusPhase::FOCUS) {
		enqueue(makeEnvelope(mSessionId, "stop", "IDLE", reason, mStartedAt, mFocusDeadline));
	}
	mPhase = FocusPhase::READY;
	mPhaseDeadlineMonotonicMs = 0;
	mCondition.notify_all();
	LOGI_TRACE("FocusProbe: cycle stopped (%s)", reason);
}

void FocusController::requestAudio(AudioCommand command) {
	mAudioCommand = command;
	mCondition.notify_one();
}

void FocusController::enqueue(const std::string& payload) {
	if (mQueue.size() >= 16) {
		LOGE_TRACE("FocusProbe: MQTT queue full; dropping newest event");
		return;
	}
	mQueue.push_back(payload);
	mCondition.notify_one();
}

void FocusController::workerLoop() {
	while (true) {
		std::string payload;
		AudioCommand audioCommand = AudioCommand::NONE;
		int audioVolume = focus_config::kFocusDoneAudioVolume;
		{
			std::unique_lock<std::mutex> lock(mMutex);
			while (mRunning) {
				const int64_t nowMs = monotonicMs();
				if (mPhase == FocusPhase::FOCUS && nowMs >= mPhaseDeadlineMonotonicMs) {
					mPhase = FocusPhase::FOCUS_DONE;
					mPhaseDeadlineMonotonicMs = 0;
					requestAudio(AudioCommand::PLAY_FOCUS_DONE);
					LOGI_TRACE("FocusProbe: focus completed; waiting for middle press to start rest");
				} else if (mPhase == FocusPhase::REST && nowMs >= mPhaseDeadlineMonotonicMs) {
					mPhase = FocusPhase::REST_DONE;
					mPhaseDeadlineMonotonicMs = 0;
					requestAudio(AudioCommand::PLAY_FOCUS_DONE);
					LOGI_TRACE("FocusProbe: rest completed; waiting for middle press to start focus");
				}
				if (mAudioCommand != AudioCommand::NONE) {
					audioCommand = mAudioCommand;
					mAudioCommand = AudioCommand::NONE;
					break;
				}
				if (!mQueue.empty()) break;
				if (mPhase == FocusPhase::FOCUS || mPhase == FocusPhase::REST) {
					const int64_t waitMs = mPhaseDeadlineMonotonicMs - monotonicMs();
					mCondition.wait_for(lock, std::chrono::milliseconds(waitMs > 0 ? waitMs : 1));
				} else {
					mCondition.wait(lock);
				}
			}
			if (!mRunning) return;
			if (audioCommand == AudioCommand::PLAY_FOCUS_DONE) audioVolume = mVolumeLevel;
			if (audioCommand == AudioCommand::NONE) payload = mQueue.front();
		}
		if (audioCommand == AudioCommand::PLAY_FOCUS_DONE) {
			awtrix::AudioManager::getInstance().setVolume(audioVolume);
			LOGI_TRACE("FocusProbe: playing completion audio path=%s exists=%d volume=%d",
				focus_config::kFocusDoneAudioPath,
				base::exists(focus_config::kFocusDoneAudioPath) ? 1 : 0,
				audioVolume);
			awtrix::AudioManager::getInstance().playAudio(focus_config::kFocusDoneAudioPath, true);
			LOGI_TRACE("FocusProbe: completion audio started in loop mode");
			continue;
		}
		if (audioCommand == AudioCommand::STOP) {
			awtrix::AudioManager::getInstance().stopAudio();
			continue;
		}
		if (mPublisher.publish(payload)) {
			std::lock_guard<std::mutex> lock(mMutex);
			if (!mQueue.empty() && mQueue.front() == payload) mQueue.pop_front();
			continue;
		}
		std::unique_lock<std::mutex> lock(mMutex);
		mCondition.wait_for(lock, std::chrono::seconds(2), [this] { return !mRunning; });
	}
}
