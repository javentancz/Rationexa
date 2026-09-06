from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV_FILE, extra="ignore")

    app_name: str = "Rationexa API"
    database_url: str = f"sqlite:///{ROOT_ENV_FILE.parent / 'services/api/rationexa.db'}"
    artifact_dir: Path = ROOT_ENV_FILE.parent / "services/api/artifacts"
    artifact_storage: Literal["filesystem", "database"] = "filesystem"
    ai_provider: str = "deterministic"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3.5:9b"
    ollama_models: str = "qwen3.5:9b,gemma4:e4b,ornith-1.5:9b"
    ollama_timeout_seconds: float = 180
    ollama_status_timeout_seconds: float = 0.75
    ollama_status_cache_seconds: float = 15
    provider_model_cache_seconds: float = 60
    job_execution_mode: Literal["inline", "thread"] = "inline"
    # Local and long-running deployments can safely maintain the schema and
    # recover interrupted jobs during process startup. Serverless deployments
    # should run migrations as a release step so cold requests do not wait for
    # database inspection and job recovery.
    startup_database_maintenance: bool = True
    # Fail closed when a deployment forgets to set HOSTED_MODE. Local
    # development explicitly opts into the single-user workspace in .env.
    hosted_mode: bool = True
    custom_provider_allowed_hosts: str = ""
    openai_api_key: str | None = None
    openai_model: str = "gpt-5.4-mini"
    public_base_url: str = "http://localhost:3000"
    share_default_ttl_days: int = 30
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    local_account_id: str = "00000000-0000-4000-8000-000000000001"
    local_account_name: str = "Demo User"
    local_workspace_id: str = "00000000-0000-4000-8000-000000000002"
    local_workspace_name: str = "Personal workspace"
    secret_encryption_key: str | None = None
    secret_encryption_key_file: Path = ROOT_ENV_FILE.parent / ".rationexa-secret.key"
    local_account_email: str = "demo@rationexa.local"
    local_account_password: str | None = None
    auth_session_ttl_hours: int = 168
    guest_workspace_ttl_hours: int = 24
    guest_cleanup_batch_size: int = 200
    cron_secret: str | None = None
    session_cookie_name: str = "rationexa_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    auth_rate_limit_attempts: int = 10
    auth_rate_limit_window_seconds: int = 60
    compute_rate_limit_attempts: int = 30
    compute_rate_limit_window_seconds: int = 60
    password_reset_ttl_minutes: int = 30
    password_reset_dev_mode: bool = False
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True
    pbkdf2_iterations: int = 200_000

    @field_validator("database_url", mode="before")
    @classmethod
    def use_psycopg_driver(cls, value: object) -> object:
        if isinstance(value, str) and value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @field_validator("cron_secret", mode="before")
    @classmethod
    def validate_cron_secret(cls, value: object) -> object:
        if value is None or value == "":
            return None
        if not isinstance(value, str) or len(value) < 16:
            raise ValueError("CRON_SECRET must contain at least 16 characters")
        return value

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def configured_ollama_models(self) -> list[str]:
        models = [model.strip() for model in self.ollama_models.split(",") if model.strip()]
        return list(dict.fromkeys([self.ollama_model, *models]))

    @property
    def allowed_custom_provider_hosts(self) -> set[str]:
        return {host.strip().lower() for host in self.custom_provider_allowed_hosts.split(",") if host.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
