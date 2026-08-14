import re
import unittest

from volna_matrix_module import (
    MATRIX_ENCRYPTED_EVENT_TYPE,
    MATRIX_MEMBER_EVENT_TYPE,
    THREAD_STATE_TYPE,
    VolnaMatrixModule,
)


class FakeEvent:
    def __init__(self, sender, event_type, content=None, state_key=None):
        self.sender = sender
        self.type = event_type
        self.state_key = state_key
        self._content = content or {}

    def get_dict(self):
        return {"content": self._content}


class VolnaMatrixEventPolicyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.module = VolnaMatrixModule.__new__(VolnaMatrixModule)
        self.module.service_user_id = "@volna_messaging:volna.social"
        self.module.user_pattern = re.compile(
            r"^@volna_[0-9a-f]{32}:volna\.social$"
        )
        self.module.can_send_url = "http://api/messaging/matrix/internal/can-send"
        self.sender = "@volna_0123456789abcdef0123456789abcdef:volna.social"
        self.thread_state = {
            (THREAD_STATE_TYPE, ""): FakeEvent(
                self.module.service_user_id,
                THREAD_STATE_TYPE,
                {"v": 1, "threadId": "thread_12345678"},
                "",
            )
        }

    async def test_rejects_every_user_plaintext_timeline_event(self):
        for event_type in ("m.room.message", "m.reaction", "m.room.redaction"):
            with self.subTest(event_type=event_type):
                allowed, _ = await self.module.check_event_allowed(
                    FakeEvent(self.sender, event_type, {"body": "plaintext"}),
                    self.thread_state,
                )
                self.assertFalse(allowed)

    async def test_only_allows_self_join_or_leave_membership(self):
        for membership in ("join", "leave"):
            allowed, _ = await self.module.check_event_allowed(
                FakeEvent(
                    self.sender,
                    MATRIX_MEMBER_EVENT_TYPE,
                    {"membership": membership},
                    self.sender,
                ),
                self.thread_state,
            )
            self.assertTrue(allowed)

        allowed, _ = await self.module.check_event_allowed(
            FakeEvent(
                self.sender,
                MATRIX_MEMBER_EVENT_TYPE,
                {"membership": "invite"},
                "@volna_ffffffffffffffffffffffffffffffff:volna.social",
            ),
            self.thread_state,
        )
        self.assertFalse(allowed)

    async def test_encrypted_event_requires_live_volna_permission(self):
        calls = []

        async def allow(url, body):
            calls.append((url, body))
            return {"allowed": True}

        self.module._post = allow
        allowed, _ = await self.module.check_event_allowed(
            FakeEvent(self.sender, MATRIX_ENCRYPTED_EVENT_TYPE),
            self.thread_state,
        )
        self.assertTrue(allowed)
        self.assertEqual(
            calls,
            [
                (
                    self.module.can_send_url,
                    {
                        "threadId": "thread_12345678",
                        "senderMatrixUserId": self.sender,
                    },
                )
            ],
        )

        async def unavailable(url, body):
            raise RuntimeError("VOLNA API unavailable")

        self.module._post = unavailable
        allowed, _ = await self.module.check_event_allowed(
            FakeEvent(self.sender, MATRIX_ENCRYPTED_EVENT_TYPE),
            self.thread_state,
        )
        self.assertFalse(allowed)


class VolnaMatrixAuthenticationTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_the_synapse_auth_callback_tuple(self):
        module = VolnaMatrixModule.__new__(VolnaMatrixModule)
        module.user_pattern = re.compile(
            r"^@volna_[0-9a-f]{32}:volna\.social$"
        )
        matrix_user_id = "@volna_0123456789abcdef0123456789abcdef:volna.social"

        class FakeApi:
            async def check_user_exists(self, user_id):
                return user_id

        module.api = FakeApi()

        async def consume(url, body):
            return {"matrixUserId": matrix_user_id, "displayName": "VOLNA Test"}

        module._post = consume
        module.consume_login_url = "http://api/consume-login"
        result = await module.check_auth(
            matrix_user_id,
            "social.volna.session",
            {"token": "vmx_" + "a" * 43},
        )
        self.assertEqual(result, (matrix_user_id, None))


class VolnaMatrixRevocationTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.module = VolnaMatrixModule.__new__(VolnaMatrixModule)
        self.module.service_user_id = "@volna_messaging:volna.social"
        self.module.user_pattern = re.compile(r"^@volna_[0-9a-f]{32}:volna\.social$")
        self.user_id = "@volna_0123456789abcdef0123456789abcdef:volna.social"
        self.calls = []

        calls = self.calls

        class DeviceHandler:
            async def delete_devices(self, user_id, device_ids):
                calls.append(("devices", user_id, device_ids))

            async def delete_all_devices_for_user(self, user_id):
                calls.append(("user", user_id))

        class Store:
            async def get_rooms_for_user(self, user_id):
                calls.append(("rooms", user_id))
                return {"!room123:volna.social"}

        class FakeApi:
            _device_handler = DeviceHandler()
            _store = Store()

            async def update_room_membership(self, **kwargs):
                calls.append(("membership", kwargs))

        self.module.api = FakeApi()

    async def test_deletes_one_exact_device(self):
        allowed = await self.module.apply_revocation({
            "action": "device",
            "userId": self.user_id,
            "deviceId": "VOLNA_WEB_123",
        })
        self.assertTrue(allowed)
        self.assertEqual(self.calls, [("devices", self.user_id, ["VOLNA_WEB_123"])])

    async def test_user_revocation_deletes_devices_and_leaves_rooms(self):
        self.assertTrue(await self.module.apply_revocation({"action": "user", "userId": self.user_id}))
        self.assertEqual(self.calls[0], ("user", self.user_id))
        self.assertEqual(self.calls[1], ("rooms", self.user_id))
        self.assertEqual(self.calls[2][0], "membership")

    async def test_room_removal_rejects_unknown_users(self):
        self.assertFalse(await self.module.apply_revocation({
            "action": "room_remove",
            "roomId": "!room123:volna.social",
            "userIds": ["@mallory:volna.social"],
        }))

if __name__ == "__main__":
    unittest.main()
