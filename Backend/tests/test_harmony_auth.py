import httpx
import pytest
from pydantic import SecretStr

from app import harmony
from app.settings import Settings


def test_settings_load_edl_token_as_secret_without_exposing_it(monkeypatch):
    monkeypatch.setenv("EDL_TOKEN", "test-secret")
    settings = Settings()
    assert settings.edl_token is not None
    assert bool(settings.edl_token.get_secret_value().strip())
    assert "**********" in repr(settings.edl_token)


def test_harmony_auth_uses_bearer_header(monkeypatch):
    monkeypatch.setattr(harmony, "get_settings", lambda: Settings(
        harmony_base_url="https://harmony.earthdata.nasa.gov",
        edl_token=SecretStr("test-secret"),
    ))
    assert harmony.auth_kwargs() == {"headers": {"Authorization": "Bearer test-secret"}}


def test_harmony_auth_is_not_attached_to_external_result_host(monkeypatch):
    monkeypatch.setattr(harmony, "get_settings", lambda: Settings(
        harmony_base_url="https://harmony.earthdata.nasa.gov",
        edl_token=SecretStr("test-secret"),
    ))
    assert harmony.auth_kwargs("https://results.example.net/file.tif") == {}


def test_missing_edl_token_raises_configuration_error(monkeypatch):
    monkeypatch.setattr(harmony, "get_settings", lambda: Settings(
        harmony_base_url="https://harmony.earthdata.nasa.gov",
        edl_token=None,
    ))
    with pytest.raises(harmony.HarmonyConfigurationError, match="EDL_TOKEN is missing"):
        harmony.auth_kwargs()


def test_legacy_earthdata_token_is_used_only_as_fallback(monkeypatch):
    monkeypatch.setattr(harmony, "get_settings", lambda: Settings(
        harmony_base_url="https://harmony.earthdata.nasa.gov",
        edl_token=SecretStr(""),
        earthdata_token="legacy-secret",
    ))
    assert harmony.auth_kwargs() == {"headers": {"Authorization": "Bearer legacy-secret"}}


@pytest.mark.asyncio
async def test_cross_host_redirect_does_not_forward_bearer_token(monkeypatch):
    monkeypatch.setattr(harmony, "get_settings", lambda: Settings(
        harmony_base_url="https://harmony.earthdata.nasa.gov",
        edl_token=SecretStr("test-secret"),
    ))
    observed = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "harmony.earthdata.nasa.gov":
            return httpx.Response(302, headers={"Location": "https://results.example.net/metadata.json"})
        observed["authorization"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"status": "ok"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        response = await harmony._get_with_retry(
            client,
            "https://harmony.earthdata.nasa.gov/test",
            **harmony.auth_kwargs("https://harmony.earthdata.nasa.gov/test"),
        )
    assert response.status_code == 200
    assert observed["authorization"] is None
