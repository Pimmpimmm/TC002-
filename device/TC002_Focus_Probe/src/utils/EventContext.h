/*
 * EventContext.h
 *
 *  Created on: 2022年4月29日
 *      Author: guoxs
 */

#ifndef _EVENT_CONTEXT_H_
#define _EVENT_CONTEXT_H_

typedef void (*on_key_event_cb)(int keyCode, int keyStatus);

enum EKeyCode {
	E_KEYCODE_CLOCKWISE,        // 顺时针
	E_KEYCODE_ANTI_CLOCKWISE,   // 逆时针
	E_KEYCODE_KNOB_BUTTON = 0x67,   // 旋钮按键
	E_KEYCODE_LEFT_BUTTON = 0x6C,   // 左键
	E_KEYCODE_MIDDLE_BUTTON = 0x69, // 中键
	E_KEYCODE_RIGHT_BUTTON = 0x6A,  // 右键
};

namespace event {

bool start();

void stop();

void add_key_event_cb(on_key_event_cb cb);

void remove_key_event_cb(on_key_event_cb cb);

}

#endif /* _EVENT_CONTEXT_H_ */
