#include "entry/EasyUIContext.h"
#include "uart/UartContext.h"
#include "manager/ConfigManager.h"
#include <base/log.h>
#ifdef __cplusplus
extern "C" {
#endif  /* __cplusplus */

void onEasyUIInit(EasyUIContext *pContext) {
	LOGI_TRACE("FocusProbe boot 01: EasyUI init entered");
	// 初始化时打开串口
//	UARTCONTEXT->openUart(CONFIGMANAGER->getUartName().c_str(), CONFIGMANAGER->getUartBaudRate());
}

void onEasyUIDeinit(EasyUIContext *pContext) {
	UARTCONTEXT->closeUart();
}

const char* onStartupApp(EasyUIContext *pContext) {
	LOGI_TRACE("FocusProbe boot 02: selecting mainActivity");
	return "mainActivity";
}


#ifdef __cplusplus

}

#endif  /* __cplusplus */
