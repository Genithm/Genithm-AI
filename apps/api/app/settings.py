from functools import lru_cache

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
    supabase_secret_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GENITHM_API_SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEY"),
    )
    readiness_timeout_seconds: float = Field(
        default=3.0,
        validation_alias=AliasChoices("GENITHM_API_READINESS_TIMEOUT_SECONDS", "GENITHM_READINESS_TIMEOUT_SECONDS"),
    )

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
