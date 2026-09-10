from functools import lru_cache
from urllib.parse import urlparse

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("GENITHM_ENV", "GENITHM_ENVIRONMENT"),
    )
    allowed_origins: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("GENITHM_API_ALLOWED_ORIGINS", "GENITHM_ALLOWED_ORIGINS"),
    )
    supabase_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GENITHM_API_SUPABASE_URL", "SUPABASE_URL"),
    )
    supabase_publishable_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GENITHM_API_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"),
    )
    supabase_secret_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GENITHM_API_SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEY"),
    )
    readiness_timeout_seconds: float = Field(
        default=3.0,
        validation_alias=AliasChoices("GENITHM_API_READINESS_TIMEOUT_SECONDS", "GENITHM_READINESS_TIMEOUT_SECONDS"),
    )
    r2_endpoint: str | None = Field(default=None, validation_alias="GENITHM_R2_ENDPOINT")
    r2_access_key_id: str | None = Field(default=None, validation_alias="GENITHM_R2_ACCESS_KEY_ID")
    r2_secret_access_key: str | None = Field(default=None, validation_alias="GENITHM_R2_SECRET_ACCESS_KEY")
    r2_sequence_bucket: str = Field(default="genithm-sequence-inputs", validation_alias="GENITHM_R2_SEQUENCE_BUCKET")
    storage_signed_url_seconds: int = Field(default=300, validation_alias="GENITHM_STORAGE_SIGNED_URL_SECONDS")

    model_config = SettingsConfigDict(
        env_prefix="GENITHM_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def allowed_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def supabase_readiness_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_secret_key)

    @property
    def storage_gateway_configured(self) -> bool:
        if not all(
            [
                self.supabase_url,
                self.supabase_publishable_key,
                self.supabase_secret_key,
                self.r2_endpoint,
                self.r2_access_key_id,
                self.r2_secret_access_key,
                self.r2_sequence_bucket,
            ]
        ):
            return False
        parsed = urlparse(self.r2_endpoint or "")
        return parsed.scheme == "https" and bool(parsed.netloc) and 60 <= self.storage_signed_url_seconds <= 900


@lru_cache
def get_settings() -> Settings:
    return Settings()
