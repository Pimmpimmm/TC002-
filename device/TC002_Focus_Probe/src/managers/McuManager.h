#ifndef MANAGERS_MCUMANAGER_H_
#define MANAGERS_MCUMANAGER_H_

#include <mcuProtocol/mcuProtoParse.h>
#include <string>
#include <utility>
#include <mutex>

class McuManager {
public:
    static McuManager& getInstance() {
        static McuManager instance;
        return instance;
    }
    
    McuManager(const McuManager&) = delete;
    McuManager& operator=(const McuManager&) = delete;
    
    /**
     * @brief 初始化 MCU 实例
     * @param mcu MCU 通信实例指针
     */
    void initialize(PixelMcuProto::McuParse* mcu);
    
    /**
     * @brief 检查是否已初始化
     */
    bool isInitialized() const { return mMcu != nullptr; }
    

    void setMicValue(int value);
    /**
     * @brief 查询麦克风值
     * @return 麦克风值
     */
    int queryMicValue();
    
    void setUsbState(int state);
    /**
     * @brief 查询 USB 连接状态
     * @return USB 状态
     */
    int queryUsbState();
    
    void setBatteryState(const std::pair<int, int>& state);
    /**
     * @brief 查询电池电量
     * @return pair<电量百分比, 充电状态> (0-100, 0=未充电/1=充电中)
     */
    std::pair<int, int> queryBatteryPower();
    
    /**
     * @brief 设置Mic是否自动上报
     */
    void setAutoMicReport(bool sw);
    /**
     * @brief 关机
     */
    void powerOff();
    
    /**
     * @brief 查询 MCU 版本
     * @param mcuVer 输出参数，MCU 版本字符串
     * @return 0=成功, 其他=失败
     */
    int queryMcuVersion(std::string& mcuVer);
    
private:
    McuManager() : mMcu(nullptr), mMicValue(-1), mUsbState(-1), mBatterState({-1, -1}) {}
    ~McuManager() {}
    
    PixelMcuProto::McuParse* mMcu;
    int mMicValue;
    int mUsbState;
    std::pair<int, int> mBatterState;

    mutable std::mutex mMutex;
};

#endif
