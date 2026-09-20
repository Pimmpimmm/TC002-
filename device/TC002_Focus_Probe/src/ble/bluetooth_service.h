/*
 * bluetooth_service.h
 *
 *  Created on: 2024年9月12日
 *      Author: pengzc
 */

#ifndef BLE_BLUETOOTH_SERVICE_H_
#define BLE_BLUETOOTH_SERVICE_H_

#include <string>
#include <functional>
#include <atomic>
#include <base/base.h>

struct BluetoothParams {
  /**
   * 该蓝牙被搜索时显示的蓝牙名称
   */
  std::string name;

  typedef std::function<void (const std::string& msg)> MessageListener;
  /**
   * 消息监听
   */
  MessageListener on_message;
};

class BluetoothService : public base::Task<BluetoothParams> {
public:
  virtual ~BluetoothService();

  static BluetoothService& instance();
  DISALLOW_COPY_AND_ASSIGN_METHOD(BluetoothService);

public:
  virtual void doTask(const BluetoothParams& params) override;

  /**
   * 获取启动参数的蓝牙名称
   * 如果服务已停止，则返回空字符串
   * @return
   */
  std::string bluetoothName();

  bool isConnected() const;

protected:
  void startBluetooth();
  void stopBluetooth();
  void servicing();

  void onStarted(struct gatt_db *db);
  void onConnectionChanged(bool connection);
  void onReceive(const std::string& msg);

private:
  BluetoothService();

  class Impl;
  Impl* impl_ = NULL;
  std::atomic<bool> connected_{false};
};

#endif /* BLE_BLUETOOTH_SERVICE_H_ */
