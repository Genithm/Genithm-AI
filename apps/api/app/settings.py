from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    allowed_origins: str = "http://localhost:3000"
    supabase_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GENITHM_API_SUPABASE_URL", "SUPABASE_URL"),
    )
    supabase_secret_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GENITHM_API_SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEY"),
    )
    readiness_timeout_seconds: float = 3.0

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
