from email.message import EmailMessage
from smtplib import SMTP
from urllib.parse import quote

from .config import Settings


def send_password_reset_email(settings: Settings, email: str, token: str) -> bool:
    """Deliver a one-time reset link without logging or returning the token."""
    if not settings.smtp_host or not settings.smtp_from_email:
        return False
    link = f"{settings.public_base_url.rstrip('/')}/account/reset?token={quote(token, safe='')}"
    message = EmailMessage()
    message["Subject"] = "Reset your Rationexa password"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        "A password reset was requested for your Rationexa pilot workspace.\n\n"
        f"Open this one-time link within {settings.password_reset_ttl_minutes} minutes:\n{link}\n\n"
        "If you did not request this, you can ignore this message."
    )
    with SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password or "")
        client.send_message(message)
    return True
