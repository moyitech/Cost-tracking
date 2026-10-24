"""Server-only WeChat credentials and invitation mini-program codes."""
import base64
from io import BytesIO
import threading
import time

import httpx
from PIL import Image

from app.errors import ApiError


class WechatCodes:
    def __init__(self, settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._token = ""
        self._expires = 0.0

    def _credential(self, client, stale=None):
        with self._lock:
            if self._token and time.monotonic() < self._expires and self._token != stale:
                return self._token
            response = client.post("https://api.weixin.qq.com/cgi-bin/stable_token", json={
                "grant_type": "client_credential", "appid": self.settings.wechat_app_id,
                "secret": self.settings.wechat_app_secret.get_secret_value(),
                "force_refresh": stale is not None,
            })
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict) or not data.get("access_token"):
                raise ValueError("credential unavailable")
            self._token = data["access_token"]
            self._expires = time.monotonic() + max(0, int(data.get("expires_in", 0)) - 120)
            return self._token

    def generate(self, token):
        if not self.settings.wechat_app_id or not self.settings.wechat_app_secret.get_secret_value():
            raise ApiError(503, "WECHAT_CODE_UNAVAILABLE", "小程序码尚未配置，可以先分享给好友")
        if len(token) > 32:
            raise ApiError(409, "NEW_INVITATION_REQUIRED", "此邀请不支持小程序码，请重新生成邀请")
        try:
            with httpx.Client(timeout=15) as client:
                credential = self._credential(client)
                for attempt in range(2):
                    response = client.post("https://api.weixin.qq.com/wxa/getwxacodeunlimit",
                        params={"access_token": credential}, json={
                            "scene": token, "page": "pages/invitation/index", "width": 440,
                            "env_version": self.settings.wechat_code_env_version,
                            "check_path": self.settings.wechat_code_env_version == "release",
                            "auto_color": False, "line_color": {"r": 30, "g": 53, "b": 48},
                        })
                    response.raise_for_status()
                    if response.content.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")):
                        # WeChat may return JPEG; the public response is always a verified PNG.
                        with Image.open(BytesIO(response.content)) as image:
                            image.load()
                            if image.width > 1280 or image.height > 1280:
                                raise ValueError("unexpected code size")
                            output = BytesIO()
                            image.convert("RGB").save(output, format="PNG")
                        return base64.b64encode(output.getvalue()).decode("ascii")
                    data = response.json()
                    if isinstance(data, dict) and data.get("errcode") in (40001, 40014, 42001) and attempt == 0:
                        credential = self._credential(client, stale=credential)
                        continue
                    if isinstance(data, dict) and data.get("errcode") == 41030:
                        raise ApiError(503, "WECHAT_CODE_PAGE_UNAVAILABLE", "当前小程序版本尚未发布邀请页，请联系管理者更新版本；也可先分享给好友")
                    raise ValueError("invalid code response")
        except (httpx.HTTPError, ValueError, TypeError, KeyError, OSError):
            # Never expose upstream URLs, credentials or secrets in application errors.
            raise ApiError(503, "WECHAT_CODE_UNAVAILABLE", "小程序码暂时无法生成，请重试或直接分享给好友") from None
        raise ApiError(503, "WECHAT_CODE_UNAVAILABLE", "小程序码暂不可用")
