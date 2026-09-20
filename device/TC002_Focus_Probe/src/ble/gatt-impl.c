/*
 * gatt-impl.c
 *
 *  Created on: 2023年10月19日
 *      Author: ZKSWE Develop Team
 */

#include <unistd.h>
#include <semaphore.h>
#include <pthread.h>
#include <errno.h>

#include "gatt-impl.h"
#include "ble/mainloop.h"
#include "ble/l2cap.h"
#include "utils/Log.h"

#undef LOG_TAG
#define LOG_TAG "ble"

#define ATT_CID    4

static bool _s_running;
static pthread_t _s_gatt_pid;
static int _s_wakeup_fd;
static bt_gatt_cb_t *_s_cb;

typedef struct {
	struct gatt_db *db;
	struct bt_att *att;
	struct bt_gatt_server *gatt;
} gatt_ctx_t;

static void _debug_cb(const char *str, void *user_data) {
	const char *prefix = (const char *) user_data;
	LOGD("%s%s\n", prefix, str);
}

static int _adv_enable(bool enable) {
  struct hci_request rq;
  le_set_advertising_parameters_cp adv_params_cp;
  le_set_advertise_enable_cp advertise_cp;
  uint8_t status;
  int dd, ret;
  int hdev = 0;

  dd = hci_open_dev(hdev);
  if (dd < 0) {
    LOGE("Could not open device\n");
    return -1;
  }

  memset(&adv_params_cp, 0, sizeof(adv_params_cp));
  adv_params_cp.min_interval = htobs(0x0020);
  adv_params_cp.max_interval = htobs(0x01E0);
  adv_params_cp.own_bdaddr_type = LE_PUBLIC_ADDRESS;
  adv_params_cp.advtype = 0;
  adv_params_cp.chan_map = 7;
  adv_params_cp.filter = 0;

  memset(&rq, 0, sizeof(rq));
  rq.ogf = OGF_LE_CTL;
  rq.ocf = OCF_LE_SET_ADVERTISING_PARAMETERS;
  rq.cparam = &adv_params_cp;
  rq.clen = LE_SET_ADVERTISING_PARAMETERS_CP_SIZE;
  rq.rparam = &status;
  rq.rlen = 1;

  ret = hci_send_req(dd, &rq, 1000);
  if (ret < 0) {
    goto done;
  }

  memset(&advertise_cp, 0, sizeof(advertise_cp));
  advertise_cp.enable = enable ? 1 : 0;

  memset(&rq, 0, sizeof(rq));
  rq.ogf = OGF_LE_CTL;
  rq.ocf = OCF_LE_SET_ADVERTISE_ENABLE;
  rq.cparam = &advertise_cp;
  rq.clen = LE_SET_ADVERTISE_ENABLE_CP_SIZE;
  rq.rparam = &status;
  rq.rlen = 1;

  ret = hci_send_req(dd, &rq, 1000);
  if (ret < 0) {
    LOGE("cannot send enable advertising\n");
    goto done;
  } else {
    if (status == 0) {
      LOGD("adv enable ok\n");
    } else if (status == 12) {
      LOGD("likely already advertising...\n");
    } else {
      LOGE("UnExpected status\n");
    }
  }

  hci_close_dev(dd);
  return 0;

  done: hci_close_dev(dd);
  return -1;
}

static int _l2cap_le_att_listen(bdaddr_t *src, int sec, uint8_t src_type) {
	int sk;
	struct sockaddr_l2 srcaddr;
	struct bt_security btsec;

	sk = socket(PF_BLUETOOTH, SOCK_SEQPACKET, BTPROTO_L2CAP);
	if (sk < 0) {
		LOGE("Failed to create L2CAP socket\n");
		return -1;
	}

	/* Set up source address */
	memset(&srcaddr, 0, sizeof(srcaddr));
	srcaddr.l2_family = AF_BLUETOOTH;
	srcaddr.l2_cid = htobs(ATT_CID);
	srcaddr.l2_bdaddr_type = src_type;
	bacpy(&srcaddr.l2_bdaddr, src);

	if (bind(sk, (struct sockaddr *) &srcaddr, sizeof(srcaddr)) < 0) {
		LOGE("Failed to bind L2CAP socket\n");
		goto FAIL;
	}

	/* Set the security level */
	memset(&btsec, 0, sizeof(btsec));
	btsec.level = sec;
	if (setsockopt(sk, SOL_BLUETOOTH, BT_SECURITY, &btsec, sizeof(btsec)) != 0) {
		LOGE("Failed to set L2CAP security level\n");
		goto FAIL;
	}

	if (listen(sk, 5) < 0) {
		LOGE("Listening on socket failed\n");
		goto FAIL;
	}

	LOGD("Started listening on ATT channel\n");

	return sk;

FAIL:
	close(sk);
	return -1;
}

static int _l2cap_le_att_accept(int sk) {
	int nsk = -1;
	socklen_t optlen;
	struct sockaddr_l2 addr;
	char ba[18];

	memset(&addr, 0, sizeof(addr));
	optlen = sizeof(addr);
	nsk = accept(sk, (struct sockaddr *) &addr, &optlen);
	if (nsk < 0) {
		LOGE("Accept failed\n");
		return -1;
	}

	ba2str(&addr.l2_bdaddr, ba);
	LOGD("Connect from %s\n", ba);

	if (_s_cb && _s_cb->on_connection_event_cb) {
		_s_cb->on_connection_event_cb(E_BT_GATT_CONNECTED, _s_cb->user_data);
	}

	return nsk;
}

static void _att_disconnect_cb(int err, void *user_data) {
	gatt_ctx_t *ctx = (gatt_ctx_t *) user_data;

	bt_att_unref(ctx->att);
	bt_gatt_server_unref(ctx->gatt);

	ctx->att = NULL;
	ctx->gatt = NULL;

	LOGD("Device disconnected: %s\n", strerror(err));

	if (_s_cb && _s_cb->on_connection_event_cb) {
		_s_cb->on_connection_event_cb(E_BT_GATT_DISCONNECT, _s_cb->user_data);
	}

	_adv_enable(true);
}

static void _server_listen_cb(int fd, uint32_t events, void *user_data) {
	gatt_ctx_t *ctx = (gatt_ctx_t *) user_data;
	int accept_fd;
	int mtu = 517;

	if (events & (EPOLLRDHUP|EPOLLHUP|EPOLLERR)) {
		mainloop_remove_fd(fd);
		return;
	}

	accept_fd = _l2cap_le_att_accept(fd);
	if (accept_fd < 0) {
		LOGE("Accept error\n");
		return;
	}

	ctx->att = bt_att_new(accept_fd, false);
	if (!ctx->att) {
		LOGE("Failed to initialze ATT transport layer\n");
		goto FAIL;
	}

	if (!bt_att_set_close_on_unref(ctx->att, true)) {
		LOGE("Failed to set up ATT transport layer\n");
		goto FAIL;
	}

	if (!bt_att_register_disconnect(ctx->att, _att_disconnect_cb, ctx, NULL)) {
		LOGE("Failed to set ATT disconnect handler\n");
		goto FAIL;
	}

	ctx->gatt = bt_gatt_server_new(ctx->db, ctx->att, mtu, 0);
	if (!ctx->gatt) {
		LOGE("Failed to create GATT server\n");
		goto FAIL;
	}

	bt_att_set_debug(ctx->att, _debug_cb, "att: ", NULL);
	bt_gatt_server_set_debug(ctx->gatt, _debug_cb, "server: ", NULL);

	return;

FAIL:
	bt_att_unref(ctx->att);
	bt_gatt_server_unref(ctx->gatt);

	ctx->att = NULL;
	ctx->gatt = NULL;

	return;
}

static void _wakeup_cb(int fd, uint32_t events, void *user_data) {
	if (events & (EPOLLRDHUP|EPOLLHUP|EPOLLERR)) {
		LOGE("Events error\n");
	} else {
		uint8_t c;
		if (read(fd, &c, 1) < 0) {
			LOGE("Wakeup read channel error\n");
		}
	}

	mainloop_quit();
}

static void* _gatt_run(void *arg) {
	struct gatt_db *db = NULL;
	int fd = -1;
	gatt_ctx_t ctx = { 0 };
	int sockfds[2] = { -1, -1 };
	bdaddr_t src_addr;
	sem_t *sem = (sem_t *) arg;
	int ret;

	bacpy(&src_addr, BDADDR_ANY);
	fd = _l2cap_le_att_listen(&src_addr, BT_SECURITY_LOW, BDADDR_LE_PUBLIC);
	if (fd < 0) {
		goto END;
	}

	ret = socketpair(PF_UNIX, SOCK_STREAM|SOCK_NONBLOCK|SOCK_CLOEXEC, 0, sockfds);
	if (ret == -1) {
		LOGE("Couldn't create paired sockets\n");
		goto END;
	}
	_s_wakeup_fd = sockfds[1];

	db = gatt_db_new();
	if (!db) {
		goto END;
	}
	ctx.db = db;

	mainloop_init();

	if (mainloop_add_fd(fd, EPOLLIN, _server_listen_cb, &ctx, NULL) < 0) {
		LOGE("Failed to add listen socket\n");
		goto END;
	}

	if (mainloop_add_fd(sockfds[0], EPOLLIN, _wakeup_cb, NULL, NULL) < 0) {
		LOGE("Failed to install command handler\n");
		goto END;
	}

	LOGD("gatt wake up main thread\n");

	_s_running = true;
	sem_post(sem);

	if (_s_cb && _s_cb->on_start) {
		_s_cb->on_start(db, _s_cb->user_data);
	}

	_adv_enable(true);
	LOGD("mainloop_run start");
	mainloop_run();
	LOGD("mainloop_run end");

	if (_s_cb && _s_cb->on_end) {
		_s_cb->on_end(db);
	}

END:
	if (!_s_running) {
		sem_post(sem);
	}

	gatt_db_unref(ctx.db);
	bt_att_unref(ctx.att);
	bt_gatt_server_unref(ctx.gatt);

	close(sockfds[0]);
	close(sockfds[1]);
	close(fd);

	return NULL;
}

int bt_gatt_impl_start(bt_gatt_cb_t *cb) {
	sem_t sem;
	if (sem_init(&sem, 0, 0)) {
		LOGE("sem_init failed\n");
		return -1;
	}

	_s_cb = cb;

	int ret = pthread_create(&_s_gatt_pid, NULL, _gatt_run, &sem);
	if (ret == 0) {
		sem_wait(&sem);
	} else {
		LOGE("pthread_create error %s\n", strerror(errno));
	}
	sem_destroy(&sem);

	LOGD("gatt thread run %s\n", _s_running ? "success" : "fail");

	return _s_running ? 0 : -1;
}

void bt_gatt_impl_stop() {
	if (!_s_running) {
		return;
	}

	ssize_t n;
	do {
		n = write(_s_wakeup_fd, "W", 1);
	} while ((n == -1) && (errno == EINTR));

	pthread_join(_s_gatt_pid, NULL);
	_s_running = false;
}

int bt_gatt_impl_set_name(const char *name) {
	int dd = hci_open_dev(0);
	if (dd < 0) {
		LOGE("Could not open device\n");
		return -1;
	}

	int name_len = strlen(name);//strlen(name);
	char advdata[32] = { 0 };

	advdata[1] = 2;      // flag len
	advdata[2] = 0x01;   // type for flag
	advdata[3] = 0x50;
	advdata[4] = name_len + 1;
	advdata[5] = 0x09;   // type for local name

	memcpy(advdata + 6, name, name_len);
	advdata[0] = name_len + 5;

	uint16_t ogf = 0x0008;
	uint16_t ocf = 0x0008;

	if (hci_send_cmd(dd, ogf, ocf, 32, advdata) < 0) {
		LOGE("Send failed\n");
		return -1;
	}
	LOGD("set ble name done!");

	hci_close_dev(dd);

	return 0;
}
