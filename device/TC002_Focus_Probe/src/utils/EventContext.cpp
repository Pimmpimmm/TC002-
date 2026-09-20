/*
 * EventContext.cpp
 *
 *  Created on: 2022年4月29日
 *      Author: guoxs
 */

#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/select.h>
#include <linux/vt.h>
#include <linux/kd.h>
#include <linux/keyboard.h>
#include <linux/input.h>
#include <utils/EventContext.h>
#include <unordered_set>

#include "system/Thread.h"
#include "base/log.h"

namespace event {

#define TABLE_SIZE(x)		(sizeof(x)/sizeof(x[0]))

// 顺时针
#define CLOCKWISE_START_STATUS         0x8
#define CLOCKWISE_STOP_STATUS          0x1
// 逆时针
#define ANTI_CLOCKWISE_START_STATUS    0xD
#define ANTI_CLOCKWISE_STOP_STATUS     0xB

static uint32_t _s_last_event_val;

typedef struct {
	const char *dev;
	int fd;
} event_node_info_t;

static event_node_info_t _s_event_node_list[] = {
	{ "/dev/input/event67", -1 },
	{ "/dev/input/event68", -1 }
};

static int _s_wake_fds[2] = { -1, -1 };

static std::unordered_set<on_key_event_cb> _s_cb_set;
static Mutex _s_mutex;

static void _notify_key_event_cb(int keyCode, int keyStatus) {
	Mutex::Autolock _l(_s_mutex);
	for (std::unordered_set<on_key_event_cb>::iterator it = _s_cb_set.begin();
			it != _s_cb_set.end(); ++it) {
		if (*it) {
			(*it)(keyCode, keyStatus);
		}
	}
}

class EventThread : public Thread {
protected:
	virtual bool threadLoop() {
		fd_set fdset;
		FD_ZERO(&fdset);

		FD_SET(_s_wake_fds[0], &fdset);

		int maxFD = _s_wake_fds[0];

		for (int i = 0; i < (int) TABLE_SIZE(_s_event_node_list); ++i) {
			if (_s_event_node_list[i].fd >= 0) {
				FD_SET(_s_event_node_list[i].fd, &fdset);
				if (maxFD < _s_event_node_list[i].fd) {
					maxFD = _s_event_node_list[i].fd;
				}
			}
		}

		if (select(maxFD + 1, &fdset, NULL, NULL, NULL) > 0) {
			for (int i = 0; i < (int) TABLE_SIZE(_s_event_node_list); ++i) {
				int fd = _s_event_node_list[i].fd;
				if (fd >= 0) {
					if (FD_ISSET(fd, &fdset)) {
						struct input_event event;
						if (read(fd, &event, sizeof(event)) == sizeof(event)) {
							if (event.type == EV_ABS) {
//								LOGD("--%d-- --%s-- EV_ABS event code: %d, value: %d\n", __LINE__, __FILE__, event.code, event.value);

								switch (event.value) {

								case CLOCKWISE_START_STATUS:
								case ANTI_CLOCKWISE_START_STATUS:
									_s_last_event_val = event.value;
									break;

								case CLOCKWISE_STOP_STATUS:
									if (_s_last_event_val == CLOCKWISE_START_STATUS) {
										_notify_key_event_cb(E_KEYCODE_CLOCKWISE, 0);
									}
									break;

								case ANTI_CLOCKWISE_STOP_STATUS:
									if (_s_last_event_val == ANTI_CLOCKWISE_START_STATUS) {
										_notify_key_event_cb(E_KEYCODE_ANTI_CLOCKWISE, 0);
									}
									break;
								}
							}

							if (event.type == EV_KEY) {
//								LOGD("EV_KEY event code: 0x%02X, value: %d\n", event.code, event.value);
								
								// 处理按键事件
								// event.code: 按键码
								// event.value: 0=释放, 1=按下, 2=重复
								switch (event.code) {
								case E_KEYCODE_KNOB_BUTTON:
								case E_KEYCODE_LEFT_BUTTON:
								case E_KEYCODE_MIDDLE_BUTTON:
								case E_KEYCODE_RIGHT_BUTTON:
									if (event.value == 1) {  // 按下
										_notify_key_event_cb(event.code, 1);
									} else if (event.value == 0) {  // 释放
										_notify_key_event_cb(event.code, 0);
									}
									// 忽略 value==2 的重复事件
									break;
								default:
									// 未知按键码，可以打印日志调试
									// LOGD("Unknown key code: 0x%02X, value: %d\n", event.code, event.value);
									break;
								}
							}
						}
					}
				}
			}

			if (FD_ISSET(_s_wake_fds[0], &fdset)) {
				LOGD("wait_event wake up ...\n");
				close(_s_wake_fds[0]);
				_s_wake_fds[0] = -1;
				return false;
			}
		}

		return true;
	}
};

static EventThread _s_event_thread;

bool start() {
	int cnt = 0;
	for (int i = 0; i < (int) TABLE_SIZE(_s_event_node_list); ++i) {
		int fd = open(_s_event_node_list[i].dev, O_RDONLY);
		if (fd >= 0) {
			_s_event_node_list[i].fd = fd;
			cnt++;
		}
	}

	if (cnt == 0) {
		LOGE_TRACE("No event dev open!\n");
		return false;
	}

	if (pipe(_s_wake_fds) < 0) {
		LOGE_TRACE("Create pipe error!\n");
		return false;
	}

	return _s_event_thread.run("event");
}

void stop() {
	if (_s_wake_fds[1] >= 0) {
		LOGD("Want to wake up wait_event...\n");

		ssize_t nWrite;
		do {
			nWrite = write(_s_wake_fds[1], "W", 1);
		} while ((nWrite == -1) && (errno == EINTR));

		while (_s_wake_fds[0] >= 0) {
			usleep(10000);
		}

		close(_s_wake_fds[1]);
		_s_wake_fds[1] = -1;
	}

	for (int i = 0; i < (int) TABLE_SIZE(_s_event_node_list); ++i) {
		if (_s_event_node_list[i].fd >= 0) {
			close(_s_event_node_list[i].fd);
			_s_event_node_list[i].fd = -1;
		}
	}
}

void add_key_event_cb(on_key_event_cb cb) {
	Mutex::Autolock _l(_s_mutex);
	_s_cb_set.insert(cb);
}

void remove_key_event_cb(on_key_event_cb cb) {
	Mutex::Autolock _l(_s_mutex);
	_s_cb_set.erase(cb);
}

}
