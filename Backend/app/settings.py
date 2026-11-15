from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "Backend/.env"), extra="ignore")

    earthdata_token: str | None = None
    edl_token: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("EDL_TOKEN", "EARTHDATA_TOKEN"),
    )
    nisar_gcov_collection: str = "C2854338529-ASF"
    harmony_base_url: str = "https://harmony.earthdata.nasa.gov"
    cmr_base_url: str = "https://cmr.earthdata.nasa.gov/search"
    data_dir: Path = Path("data")
    frontend_origin: str = "http://localhost:5173"
    max_polygon_area_km2: float = 100_000
    discovery_timeout_seconds: float = 30
    harmony_submission_connect_timeout_seconds: float = 20
    harmony_submission_read_timeout_seconds: float = 180
    processing_timeout_seconds: float = 1800
    download_timeout_seconds: float = 300
    visualization_temp_dir: Path = Path("/tmp/delta-earth/visualization")
    visualization_session_ttl_seconds: int = 3600
    visualization_max_sessions: int = 16
    visualization_max_storage_bytes: int = 1073741824
    visualization_max_dimension: int = 1024

    @property
    def resolved_data_dir(self) -> Path:
        path = self.data_dir
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[2] / path
        return path.resolve()

    @property
    def resolved_visualization_temp_dir(self) -> Path:
        return self.visualization_temp_dir.expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
