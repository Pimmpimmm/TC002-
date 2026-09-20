# 示例代码说明

本文档介绍了本平台各硬件功能的使用方法及注意事项，建议结合对应的示例页面源码一起阅读。

## 硬件功能介绍

### 按键操作

本芯片提供一个旋钮和三个独立按键，共支持以下输入事件（详见 `managers/KeyManager.h`）：

| 按键码 | 说明 |
|---|---|
| `E_KEYCODE_CLOCKWISE` | 旋钮顺时针旋转 |
| `E_KEYCODE_ANTI_CLOCKWISE` | 旋钮逆时针旋转 |
| `E_KEYCODE_KNOB_BUTTON` | 旋钮按下 |
| `E_KEYCODE_LEFT_BUTTON` | 左键按下 |
| `E_KEYCODE_MIDDLE_BUTTON` | 中键按下 |
| `E_KEYCODE_RIGHT_BUTTON` | 右键按下 |

通过 `KeyManager::getInstance().addKeyEventCallback(cb)` 注册回调即可接收按键事件。示例参见 `pages/BtnTestPage.h`。

### LED 显示

LED 灯板分辨率为 **52×16** 像素，通过 SPI 总线驱动。调用 `PageBase::sendLedData(rgbData)` 发送一帧 RGB 数据（按行顺序排列，每像素 3 字节）即可刷新显示。该接口已内部处理 SPI 初始化和 `GPIO_35` 的同步控制，直接调用即可。示例参见 `pages/RgbTestPage.h`。

### Audio 播放

通过 `AudioManager`（`managers/AudioManager.h`）可控制音频的播放、暂停、停止及音量：

```cpp
#include "managers/AudioManager.h"
auto& audio = awtrix::AudioManager::getInstance();
audio.setVolume(3);          // 音量 0~6，0 为静音
audio.playAudio("/path/to/file.mp3");
audio.pauseAudio();
audio.resumeAudio();
audio.stopAudio();
```

示例参见 `pages/AudioTestPage.h`。

### MIC 音量检测

MIC 音量数据由 MCU 上报，通过 `McuManager` 读取（`managers/McuManager.h`）：

```cpp
#include "managers/McuManager.h"
McuManager::getInstance().setAutoMicReport(true);  // 开启自动上报
int micValue = McuManager::getInstance().queryMicValue();
```

`AudioTestPage` 中展示了实时显示 MIC 音量百分比的完整实现，示例参见 `pages/AudioTestPage.h`。

### WIFI + BLE

WiFi 和 BLE 功能已集成，两者存在依赖关系：**BLE 必须在 WiFi 已开启的前提下才能正常使用**。

**WiFi 启动：**
```cpp
#include <base/wifi.h>
base::wifiOnAndWait(10);  // 等待 WiFi 就绪，超时 10 秒
```

**BLE 启动：**
```cpp
#include "ble/bluetooth_service.h"
BluetoothParams params;
params.name = "MyDevice";
params.on_message = [](const std::string& msg) {
    // 处理收到的 BLE 消息
};
BluetoothService::instance().start(params);
```

支持通过配置文件 `/mnt/usb1/test.cfg`（JSON 格式）预设 WiFi 和 BLE 参数，字段说明如下：

```json
{
  "ssid":      "your_wifi_ssid",
  "pwd":       "your_wifi_password",
  "isConnect": true,
  "ble":       "MyDeviceName"
}
```

若 `ble` 字段为空，设备名将自动使用 WiFi MAC 地址后四位生成（如 `Ulanzi TC002 AB12`）。示例参见 `pages/WifiTestPage.h`。

### GPIO 接口

`GPIO_06` 和 `GPIO_85` 两个 LED 灯引脚保留供用户自由使用，通过 `utils/GpioHelper.h` 控制：

```cpp
#include "utils/GpioHelper.h"
GpioHelper::output("GPIO_06", 1);  // 高电平点亮 LED
GpioHelper::output("GPIO_06", 0);  // 低电平熄灭 LED
```

## 注意事项

- 请先阅读相关 IDE 文档和开发指南，了解编译和固件升级流程。

- **防砖检测**：系统启动后必须在入口处设置运行标志，否则系统将触发防砖回滚。

```cpp
#include <os/SystemProperties.h>
SystemProperties::setString("sys.zkapp.state", "running");
```

- **MCU 初始化**：启动时需先初始化 MCU 通信并查询版本号，LED 灯板才能正常工作。

```cpp
#include "managers/McuManager.h"
McuManager::getInstance().initialize(new PixelMcuProto::McuParse("/dev/ttyS1", 1500000));
std::string mcuVer;
McuManager::getInstance().queryMcuVersion(mcuVer);
```

- **SPI 帧率限制**：帧间隔不可小于15ms，否则可能导致 LED 显示异常。`sendLedData` 已内置节流机制，建议直接调用。
- **BLE 依赖 WiFi**：使用 BLE 功能前必须确保 WiFi 已成功开启，否则 BLE 服务将无法正常启动。
- **主动刷机**：如果想要重刷为官方固件，请按下设备上的重置按钮（位于 USB-C 旁边）并保持按住，会自动刷回官方固件。