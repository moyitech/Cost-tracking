import base64
from types import SimpleNamespace
from io import BytesIO
from PIL import Image
from unittest.mock import Mock

import httpx
import pytest
from pydantic import SecretStr

from app.errors import ApiError
from app.wechat_codes import WechatCodes

_buffer = BytesIO()
Image.new('RGB', (440, 440), 'white').save(_buffer, format='PNG')
PNG = _buffer.getvalue()


def service(monkeypatch, handler):
    settings = SimpleNamespace(wechat_app_id='test-id', wechat_app_secret=SecretStr('test-secret'), wechat_code_env_version='trial')
    real_client = httpx.Client
    monkeypatch.setattr('app.wechat_codes.httpx.Client', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    return WechatCodes(settings)


def test_cached_credential_and_fixed_page(monkeypatch):
    calls = []
    def handle(request):
        import json
        body = json.loads(request.content)
        calls.append(request.url.path)
        if request.url.path.endswith('stable_token'):
            return httpx.Response(200, json={'access_token': 'credential', 'expires_in': 7200})
        assert body['page'] == 'pages/invitation/index'
        assert body['scene'] == 'a' * 32
        assert body['env_version'] == 'trial' and body['check_path'] is False
        return httpx.Response(200, content=PNG, headers={'content-type': 'image/png'})
    codes = service(monkeypatch, handle)
    assert base64.b64decode(codes.generate('a' * 32)) == PNG
    codes.generate('a' * 32)
    assert calls.count('/cgi-bin/stable_token') == 1
    codes._expires = 0
    codes.generate('a' * 32)
    assert calls.count('/cgi-bin/stable_token') == 2


def test_invalid_credential_refreshes_once(monkeypatch):
    tokens = 0
    images = 0
    def handle(request):
        nonlocal tokens, images
        if request.url.path.endswith('stable_token'):
            tokens += 1
            return httpx.Response(200, json={'access_token': f't{tokens}', 'expires_in': 7200})
        images += 1
        return httpx.Response(200, json={'errcode': 40001}) if images == 1 else httpx.Response(200, content=PNG)
    codes = service(monkeypatch, handle)
    codes.generate('scene')
    assert tokens == 2 and images == 2


@pytest.mark.parametrize('kind', ['json_error', 'invalid_image', 'timeout', 'http_error'])
def test_code_failure_never_leaks_upstream_details(monkeypatch, kind):
    def handle(request):
        if request.url.path.endswith('stable_token'):
            return httpx.Response(200, json={'access_token': 'secret-token', 'expires_in': 7200})
        if kind == 'timeout':
            raise httpx.ReadTimeout('secret-token in URL')
        if kind == 'http_error':
            return httpx.Response(500)
        if kind == 'invalid_image':
            return httpx.Response(200, content=b'not a png', headers={'content-type': 'image/png'})
        return httpx.Response(200, json={'errcode': 45009, 'errmsg': 'secret-token'})
    codes = service(monkeypatch, handle)
    with pytest.raises(ApiError) as err:
        codes.generate('scene')
    assert err.value.status == 503
    assert 'secret' not in err.value.message


def test_legacy_token_does_not_get_truncated(monkeypatch):
    codes = service(monkeypatch, Mock(side_effect=AssertionError('must not call WeChat')))
    with pytest.raises(ApiError) as err:
        codes.generate('a' * 43)
    assert err.value.code == 'NEW_INVITATION_REQUIRED'


def test_wechat_jpeg_is_normalized_to_png(monkeypatch):
    buffer = BytesIO()
    Image.new('RGB', (440, 440), 'white').save(buffer, format='JPEG')
    def handle(request):
        if request.url.path.endswith('stable_token'):
            return httpx.Response(200, json={'access_token': 'token', 'expires_in': 7200})
        return httpx.Response(200, content=buffer.getvalue(), headers={'content-type': 'image/jpeg'})
    codes = service(monkeypatch, handle)
    output = base64.b64decode(codes.generate('scene'))
    assert Image.open(BytesIO(output)).format == 'PNG'


def test_unpublished_page_has_actionable_error(monkeypatch):
    def handle(request):
        if request.url.path.endswith('stable_token'):
            return httpx.Response(200, json={'access_token': 'token', 'expires_in': 7200})
        return httpx.Response(200, json={'errcode': 41030})
    codes = service(monkeypatch, handle)
    with pytest.raises(ApiError) as error:
        codes.generate('scene')
    assert error.value.code == 'WECHAT_CODE_PAGE_UNAVAILABLE'
