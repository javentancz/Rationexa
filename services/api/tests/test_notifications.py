from rationexa_api.config import Settings
from rationexa_api.notifications import send_password_reset_email


class _SmtpCapture:
    message = None

    def __init__(self, *_args, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def starttls(self):
        pass

    def login(self, *_args):
        pass

    def send_message(self, message):
        type(self).message = message


def test_password_reset_email_uses_a_clean_path(monkeypatch) -> None:
    from rationexa_api import notifications

    monkeypatch.setattr(notifications, "SMTP", _SmtpCapture)
    settings = Settings(
        public_base_url="https://staging.rationexa.example",
        smtp_host="smtp.example",
        smtp_from_email="no-reply@rationexa.example",
        smtp_use_tls=False,
    )

    assert send_password_reset_email(settings, "pilot@example.com", "token+/=") is True
    body = _SmtpCapture.message.get_content()
    assert "https://staging.rationexa.example/account/reset?token=token%2B%2F%3D" in body
    assert "#account-reset" not in body
