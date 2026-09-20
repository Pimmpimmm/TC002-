/*
 * bluetooth_service.cpp
 *
 *  Created on: 2024年9月12日
 *      Author: pengzc
 */

#include "bluetooth_service.h"
#include "gatt-impl.h"
#include <base/exception.h>
#include <base/os.hpp>
#include <net/NetManager.h>
#include <base/handler.hpp>
#include <mutex>
#include <os/SystemProperties.h>
#undef LOG_TAG
#define LOG_TAG "ble"

#define SHELL(cmd) if (system(cmd)) {}
#define UUID_SERVICE          0xfff0
#define UUID_CHAR1            0xfff1
#define UUID_CHAR2            0xfff2

enum {
  HANDLER_RECV_DATA = 100,
  HANDLER_END_DATA,
};

class BluetoothService::Impl {
public:
  bt_gatt_cb_t cb_ = {0};
  std::string buffer_;
  std::mutex params_mutex_;
  const BluetoothParams* params_;
  base::handler<std::string> handler_;
};

BluetoothService::~BluetoothService() {
  stop();
  delete impl_;
}

void BluetoothService::doTask(const BluetoothParams& params) {
  if (params.name.empty() || params.name.size() > 25) {
    throwException(-1, "name length must be <= 25");
  }
  {
    std::lock_guard<std::mutex> lock(impl_->params_mutex_);
    impl_->params_ = &params;
  }

  while (true) {
    NO_EXCEPTION(servicing());
    if (!isStarted()) {
      break;
    }
    wait(3000);
  }
  {
    std::lock_guard<std::mutex> lock(impl_->params_mutex_);
    impl_->params_ = NULL;
  }
}

std::string BluetoothService::bluetoothName() {
  if (!isStarted()) {
    return "";
  }
  std::lock_guard<std::mutex> lock(impl_->params_mutex_);
  if (impl_->params_) {
    return impl_->params_->name;
  }
  return "";
}

void BluetoothService::startBluetooth() {
#if defined(__PLATFORM_Z20__) || defined(__PLATFORM_Z21__)

  if(base::exists("/lib/modules/4.9.84/aic_btusb.ko")
  || base::exists("/late/lib/modules/4.9.84/aic_btusb.ko"))
  {
	SHELL("insmod /lib/modules/4.9.84/aic_btusb.ko"); // 装载ble模块驱动
	SHELL("insmod /late/lib/modules/4.9.84/aic_btusb.ko"); // 装载ble模块驱动
  }
  else {
	SHELL("/res/bin/hciconfig hci0 down");
	SystemProperties::setString("ctl.stop", "hciattach");
	usleep(500 * 1000);
	LOGD("[ble] hci down OK\n");
	SystemProperties::setString("ctl.start", "hciattach");
	int cnt = 500;
	for (; cnt > 0; --cnt) {
		if (base::exists("/sys/class/bluetooth/hci0")) {
			break;
		}
		usleep(10 * 1000);
	}
	if (cnt == 0) {
		throwException(-1, "hciattach error");
	}
  }

  SHELL("/res/bin/hciconfig hci0 up");
#elif defined (__PLATFORM_T113EMMC__)
  //通过hciattach,来区分价签的系统和广告机系统
  auto systemInfo = base::readFile("/etc/init.rc");
  bool isAdSystem = (systemInfo.find("hciattach") != std::string::npos) ? true : false;
  LOGI_TRACE("isAdSystem = %d", isAdSystem);
  if (!isAdSystem) {
	SHELL("insmod /lib/modules/5.4.61/aic_btusb.ko"); // 装载ble模块驱动
	SHELL("insmod /late/lib/modules/5.4.61/aic_btusb.ko"); // 装载ble模块驱动
	SHELL("/res/bin/hciconfig hci0 up");
	SHELL("/res/bin/hcitool cmd 0x03 0x0003");
  }
  else {
	SHELL("/res/bin/hciconfig hci0 down");
	SystemProperties::setString("ctl.stop", "hciattach");
	usleep(500 * 1000);
	LOGD("[ble] hci down OK\n");
	SystemProperties::setString("ctl.start", "hciattach");
	int cnt = 500;
	for (; cnt > 0; --cnt) {
		if (base::exists("/sys/class/bluetooth/hci0")) {
			break;
		}
		usleep(10 * 1000);
	}
	if (cnt == 0) {
		throwException(-1, "hciattach error");
	}
	SHELL("/res/bin/hciconfig hci0 up");
	SHELL("/res/bin/hcitool cmd 0x03 0x0003");
	LOGD("[ble] hci up OK\n");
  }
#else
#error "not support platform"
#endif

  impl_->buffer_.clear();

  impl_->cb_.user_data = this;
  impl_->cb_.on_start = [](struct gatt_db *db, void* user_data) {
    auto srv = static_cast<BluetoothService*>(user_data);
    srv->onStarted(db);
  };
  impl_->cb_.on_connection_event_cb =
      [](gatt_connection_event_e event, void* user_data) {
        auto srv = static_cast<BluetoothService*>(user_data);
        srv->onConnectionChanged(event == E_BT_GATT_CONNECTED);
  };

  int ret = bt_gatt_impl_start(&impl_->cb_);
  if (ret != 0) {
    throwException(ret, "start error");
  }
}

void BluetoothService::stopBluetooth() {
  bt_gatt_impl_stop();
  system("/res/bin/hciconfig hci0 down");
  SHELL("rmmod aic_btusb");
  SystemProperties::setString("ctl.stop", "hciattach");
}

void BluetoothService::servicing() {
  auto isWifiEnable = []() -> bool {
    auto wifi = NETMANAGER->getWifiManager();
    auto ap = NETMANAGER->getSoftApManager();
    if((wifi->getEnableStatus() == E_WIFI_ENABLE_ENABLE) || (ap->getSoftApState() == E_SOFTAP_ENABLED))
    	return true;
    return false;
  };

  if(!isStarted()) {
    return;
  }
  if (!isWifiEnable()) {
    return;
  }
  try {
    startBluetooth();
    while (true) {
      if (!isWifiEnable()) {
        break;
      }
      if (!isStarted()) {
        break;
      }
      wait(1000);
    }
    LOGD_TRACE("stopping");
    stopBluetooth();
    LOGD_TRACE("stopped");
  } catch (base::Exception& e) {
    e.printStackTrace();
  } catch (std::exception& e) {
    LOGE_TRACE("%s", e.what());
  }
}

static void _char1_read_cb(struct gatt_db_attribute *attrib, unsigned int id,
    uint16_t offset, uint8_t opcode, struct bt_att *att, void *user_data) {
  uint8_t value[2] = { 1, 0 };
  gatt_db_attribute_read_result(attrib, id, 0, value, sizeof(value));
}

void BluetoothService::onStarted(struct gatt_db* db) {
  LOGI_TRACE("start");

  auto on_char_write_cb = [](
      struct gatt_db_attribute *attrib, unsigned int id,
      uint16_t offset, const uint8_t *value, size_t len, uint8_t opcode,
      struct bt_att *att, void *user_data) {
    uint8_t ecode = 0;

    LOGD_TRACE("id %d, offset %d, value %p, len %d, opcode %d",
        id, offset, value, len, opcode);

    auto srv = static_cast<BluetoothService*>(user_data);
    if (value && len > 0) {
      base::message<std::string> msg(HANDLER_RECV_DATA);
      msg.obj = std::string((char*)value, len);
      srv->impl_->handler_.send_message(msg);
    }
    if (!value) {
      ecode = BT_ATT_ERROR_INVALID_ATTRIBUTE_VALUE_LEN;
      goto done;
    }
    done:
    gatt_db_attribute_write_result(attrib, id, ecode);
  };

  bt_uuid_t uuid;
  struct gatt_db_attribute *service;

  bt_uuid16_create(&uuid, UUID_SERVICE);
  service = gatt_db_add_service(db, &uuid, true, 8);

  bt_uuid16_create(&uuid, UUID_CHAR1);
  gatt_db_service_add_characteristic(service, &uuid,
  BT_ATT_PERM_READ | BT_ATT_PERM_WRITE,
  BT_GATT_CHRC_PROP_READ | BT_GATT_CHRC_PROP_WRITE | BT_GATT_CHRC_PROP_NOTIFY,
      _char1_read_cb, on_char_write_cb, this);

  bt_uuid16_create(&uuid, GATT_CLIENT_CHARAC_CFG_UUID);
  gatt_db_service_add_descriptor(service, &uuid,
  BT_ATT_PERM_READ | BT_ATT_PERM_WRITE,
  NULL, NULL, NULL);

  bt_uuid16_create(&uuid, UUID_CHAR2);
  gatt_db_service_add_characteristic(service, &uuid,
  BT_ATT_PERM_WRITE,
  BT_GATT_CHRC_PROP_WRITE,
  NULL, on_char_write_cb,
  this);

  gatt_db_service_set_active(service, true);
  bt_gatt_impl_set_name(impl_->params_->name.c_str());
}

void BluetoothService::onConnectionChanged(bool connection) {
  LOGW_TRACE("%s", connection ? "ble is connected!" : "ble is disconnected");
  connected_ = connection;
}

bool BluetoothService::isConnected() const {
  return connected_;
}

BluetoothService& BluetoothService::instance() {
  static BluetoothService singleton;
  return singleton;
}

void BluetoothService::onReceive(const std::string& msg) {
  std::lock_guard<std::mutex> lock(impl_->params_mutex_);
  if (impl_->params_ && impl_->params_->on_message) {
    NO_EXCEPTION(impl_->params_->on_message(impl_->buffer_));
  }
}

BluetoothService::BluetoothService() {
  impl_ = new Impl();
  impl_->handler_.set_lazy(true);
  impl_->handler_.set_message_handler(
      [](const base::message<std::string>* msg, const void* user_data) {

    auto srv = (BluetoothService*)user_data;

    auto notify = [srv]() {
      if (srv->impl_->buffer_.empty()) {
        return;
      }
      srv->onReceive(srv->impl_->buffer_);
      srv->impl_->buffer_.clear();
    };

    switch (msg->what) {
      case HANDLER_RECV_DATA:
        srv->impl_->buffer_ += msg->obj;
        if (srv->impl_->buffer_.size() >= 4096) {
          LOGD_TRACE("over size %d", srv->impl_->buffer_.size());
          notify();
          break;
        }
        srv->impl_->handler_.send_unique_message_delayed(HANDLER_END_DATA, 200);
        break;
      case HANDLER_END_DATA:
        notify();
        break;
      default:
        break;
    }

  }, this);
}
