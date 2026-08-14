"""VOLNA authentication and event-policy bridge for Synapse 1.157.x.

The module never receives VOLNA passwords or long-lived VOLNA sessions. It consumes
one-time login grants and fails closed when VOLNA cannot confirm message permission.
"""

import hmac
import json
import re
from typing import Any, Mapping

from synapse.api.errors import SynapseError
from synapse.http.server import DirectServeJsonResource
from synapse.module_api import ModuleApi


LOGIN_TYPE = "social.volna.session"
THREAD_STATE_TYPE = "social.volna.thread"
MATRIX_ENCRYPTED_EVENT_TYPE = "m.room.encrypted"
MATRIX_MEMBER_EVENT_TYPE = "m.room.member"
TOKEN_PATTERN = re.compile(r"^vmx_[A-Za-z0-9_-]{40,}$")
THREAD_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
DEVICE_PATTERN = re.compile(r"^[A-Za-z0-9._=-]{1,255}$")
ROOM_PATTERN = re.compile(r"^![^\s:]{1,255}:[a-z0-9.-]+(?::[0-9]+)?$")


class VolnaInternalRevocationResource(DirectServeJsonResource):
    """Loopback-only authenticated endpoint used for durable device revocation."""

    def __init__(self, module):
        super().__init__()
        self.module = module

    async def _async_render_POST(self, request):
        supplied = request.getHeader("X-Volna-Matrix-Auth") or ""
        if not hmac.compare_digest(supplied.encode("utf-8"), self.module.shared_secret.encode("utf-8")):
            return 404, {"errcode": "M_NOT_FOUND", "error": "Not found"}
        content_length = request.getHeader("Content-Length")
        if content_length is not None:
            try:
                if int(content_length) > 4096:
                    return 413, {"errcode": "M_TOO_LARGE", "error": "Request too large"}
            except ValueError:
                return 400, {"errcode": "M_BAD_JSON", "error": "Invalid content length"}
        raw = request.content.read(4097)
        if len(raw) > 4096:
            return 413, {"errcode": "M_TOO_LARGE", "error": "Request too large"}
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return 400, {"errcode": "M_BAD_JSON", "error": "Invalid JSON"}
        if not isinstance(body, dict):
            return 400, {"errcode": "M_BAD_JSON", "error": "JSON object required"}
        if not await self.module.apply_revocation(body):
            return 400, {"errcode": "M_INVALID_PARAM", "error": "Invalid revocation"}
        return 200, {"ok": True}


class VolnaMatrixModule:
    def __init__(self, config: Mapping[str, Any], api: ModuleApi):
        self.api = api
        self.consume_login_url = self._required_url(config, "consume_login_url")
        self.can_send_url = self._required_url(config, "can_send_url")
        self.shared_secret = self._required(config, "shared_secret", minimum=32)
        self.server_name = self._required(config, "server_name").lower()
        self.service_user_id = f"@volna_messaging:{self.server_name}"
        self.user_pattern = re.compile(
            rf"^@volna_[0-9a-f]{{32}}:{re.escape(self.server_name)}$"
        )
        api.register_password_auth_provider_callbacks(
            auth_checkers={(LOGIN_TYPE, ("token",)): self.check_auth},
        )
        api.register_third_party_rules_callbacks(
            check_event_allowed=self.check_event_allowed,
        )
        api.register_web_resource(
            "/_volna/internal/revoke",
            VolnaInternalRevocationResource(self),
        )

    @staticmethod
    def parse_config(config: Mapping[str, Any]) -> Mapping[str, Any]:
        if not isinstance(config, Mapping):
            raise ValueError("VOLNA Matrix module config must be a mapping")
        return config

    async def check_auth(
        self,
        username: str,
        login_type: str,
        login_dict: Mapping[str, Any],
    ):
        if login_type != LOGIN_TYPE:
            return None
        token = login_dict.get("token")
        if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
            return None
        try:
            grant = await self._post(self.consume_login_url, {"token": token})
        except Exception:
            return None
        if not isinstance(grant, dict):
            return None
        matrix_user_id = grant.get("matrixUserId")
        display_name = grant.get("displayName")
        if not isinstance(matrix_user_id, str) or not self.user_pattern.fullmatch(matrix_user_id):
            return None
        if username and username not in (
            matrix_user_id,
            matrix_user_id[1 : matrix_user_id.index(":")],
        ):
            return None
        if not isinstance(display_name, str) or not display_name or len(display_name) > 160:
            return None

        existing = await self.api.check_user_exists(matrix_user_id)
        if existing is None:
            localpart = matrix_user_id[1 : matrix_user_id.index(":")]
            try:
                await self.api.register_user(localpart, display_name)
            except SynapseError as error:
                if error.errcode != "M_USER_IN_USE":
                    return None
            existing = await self.api.check_user_exists(matrix_user_id)
        return (existing, None) if existing == matrix_user_id else None

    async def check_event_allowed(self, event, state_events):
        if event.sender == self.service_user_id:
            return True, None
        if not self.user_pattern.fullmatch(event.sender):
            return False, None
        if event.type == MATRIX_MEMBER_EVENT_TYPE:
            content = event.get_dict().get("content", {})
            membership = content.get("membership")
            return bool(
                event.state_key == event.sender
                and membership in ("join", "leave")
            ), None
        # VOLNA rooms do not accept plaintext timeline events, standard Matrix
        # reactions, or user-authored state. Clients must encrypt the complete
        # strict VOLNA event as m.room.encrypted.
        if event.type != MATRIX_ENCRYPTED_EVENT_TYPE:
            return False, None
        thread_state = state_events.get((THREAD_STATE_TYPE, ""))
        if thread_state is None:
            return False, None
        content = thread_state.get_dict().get("content", {})
        thread_id = content.get("threadId")
        if content.get("v") != 1 or not isinstance(thread_id, str) or not THREAD_PATTERN.fullmatch(thread_id):
            return False, None
        try:
            result = await self._post(
                self.can_send_url,
                {"threadId": thread_id, "senderMatrixUserId": event.sender},
            )
        except Exception:
            return False, None
        return bool(isinstance(result, dict) and result.get("allowed") is True), None

    async def apply_revocation(self, body: Mapping[str, Any]) -> bool:
        action = body.get("action")
        user_id = body.get("userId")
        if action in ("device", "user"):
            if not isinstance(user_id, str) or not self.user_pattern.fullmatch(user_id):
                return False
            if action == "device":
                device_id = body.get("deviceId")
                if not isinstance(device_id, str) or not DEVICE_PATTERN.fullmatch(device_id):
                    return False
                await self.api._device_handler.delete_devices(user_id, [device_id])
                return True
            await self.api._device_handler.delete_all_devices_for_user(user_id)
            rooms = await self.api._store.get_rooms_for_user(user_id)
            for room_id in rooms:
                await self.api.update_room_membership(
                    sender=self.service_user_id,
                    target=user_id,
                    room_id=room_id,
                    new_membership="leave",
                    content={"reason": "VOLNA account access revoked"},
                )
            return True
        if action == "room_remove":
            room_id = body.get("roomId")
            user_ids = body.get("userIds")
            if not isinstance(room_id, str) or not ROOM_PATTERN.fullmatch(room_id):
                return False
            if not isinstance(user_ids, list) or not 1 <= len(user_ids) <= 2:
                return False
            if any(not isinstance(item, str) or not self.user_pattern.fullmatch(item) for item in user_ids):
                return False
            for target in dict.fromkeys(user_ids):
                await self.api.update_room_membership(
                    sender=self.service_user_id,
                    target=target,
                    room_id=room_id,
                    new_membership="leave",
                    content={"reason": "VOLNA direct-message access revoked"},
                )
            return True
        return False

    async def _post(self, url: str, body: Mapping[str, Any]):
        return await self.api.http_client.post_json_get_json(
            uri=url,
            post_json=dict(body),
            headers={b"X-Volna-Matrix-Auth": [self.shared_secret.encode("utf-8")]},
        )

    @staticmethod
    def _required(config: Mapping[str, Any], key: str, minimum: int = 1) -> str:
        value = config.get(key)
        if not isinstance(value, str) or len(value.strip()) < minimum:
            raise ValueError(f"VOLNA Matrix module requires {key}")
        return value.strip()

    @classmethod
    def _required_url(cls, config: Mapping[str, Any], key: str) -> str:
        value = cls._required(config, key)
        if not value.startswith(("http://", "https://")):
            raise ValueError(f"VOLNA Matrix module requires an HTTP(S) {key}")
        return value.rstrip("/")
