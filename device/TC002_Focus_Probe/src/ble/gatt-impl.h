/*
 * gatt-impl.h
 *
 *  Created on: 2023年10月19日
 *      Author: ZKSWE Develop Team
 */

#ifndef _BLE_GATT_IMPL_H_
#define _BLE_GATT_IMPL_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "ble/att.h"
#include "ble/queue.h"
#include "ble/bluetooth.h"
#include "ble/hci.h"
#include "ble/hci_lib.h"
#include "ble/uuid.h"
#include "ble/util.h"
#include "ble/gatt-db.h"
#include "ble/gatt-server.h"
#include "ble/gatt-helpers.h"

typedef enum {
	E_BT_GATT_CONNECTED,
	E_BT_GATT_DISCONNECT,
} gatt_connection_event_e;

typedef struct {
	void (*on_start)(struct gatt_db *db, void* user_data);
	void (*on_end)(struct gatt_db *db);
	void (*on_connection_event_cb)(gatt_connection_event_e event, void* user_data);
	void* user_data;
} bt_gatt_cb_t;

int bt_gatt_impl_start(bt_gatt_cb_t *cb);
void bt_gatt_impl_stop();
int bt_gatt_impl_set_name(const char *name);

#ifdef __cplusplus
}
#endif

#endif
