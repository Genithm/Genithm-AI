from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    allowed_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(
        env_prefix="GENITHM_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def allowed_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
