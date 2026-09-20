#include <managers/AudioManager.h>
#include <manager/ConfigManager.h>
namespace awtrix {

AudioManager::AudioManager() {
	pPlayer.reset(new base::MediaPlayer());
	base::AudioManager::instance().setIdleTimeout(0);
}

AudioManager& AudioManager::getInstance() {
	static AudioManager single;
	return single;
}

void AudioManager::stopAudio() {
	pPlayer->stop();
}

void AudioManager::playAudio(const std::string& path, bool loop) {
	if (loop) {
		pPlayer->play(path, "", 5000, base::MediaPlayer::PlayMode::Loop);
	} else {
		pPlayer->play(path);
	}
}

void AudioManager::pauseAudio() {
	pPlayer->pause();
}

void AudioManager::resumeAudio() {
	pPlayer->resume();
}

bool AudioManager::isPlaying() const {
	return pPlayer->isPlaying();
}

void AudioManager::setMute(bool isMute) {
	base::AudioManager::instance().setMute(isMute);
}

void AudioManager::setVolume(int lv) {
	if (lv < 0) lv = 0;
	if (lv > 6) lv = 6;
	// The underlying Z21 mixer accepts 0..90. Spread the six user-facing
	// steps across that range so each button press is clearly audible.
	const int volume = lv * 15;
	if (lv == 0) {
		base::AudioManager::instance().setVolume(0);
		base::AudioManager::instance().setMute(true);
	} else {
		base::AudioManager::instance().setVolume(volume);
		base::AudioManager::instance().setMute(false);
	}
}

AudioManager::~AudioManager() {
	pPlayer = nullptr;
}

} /* namespace awtrix */
