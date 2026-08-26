from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Rationexa API"
    database_url: str = "sqlite:///./rationexa.db"
    artifact_dir: Path = Path("./artifacts")
    ai_provider: str = "deterministic"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3.5:9b"
    ollama_models: str = "qwen3.5:9b,gemma4:e4b,ornith-1.5:9b"
    ollama_timeout_seconds: float = 180
    openai_api_key: str | None = None
    openai_model: str = "gpt-5.4-mini"
    public_base_url: str = "http://localhost:3000"
    share_default_ttl_days: int = 30
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def configured_ollama_models(self) -> list[str]:
        models = [model.strip() for model in self.ollama_models.split(",") if model.strip()]
        return list(dict.fromkeys([self.ollama_model, *models]))


@lru_cache
def get_settings() -> Settings:
    return Settings()
