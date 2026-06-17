from pathlib import Path
from string import Template


def load_verification_template() -> str:
    template_path = Path(__file__).resolve().parent.parent / "templates" / "email_verification.html"
    if template_path.is_file():
        return template_path.read_text(encoding="utf-8")
    return """<html><body><p>Your ${app_name} verification code: <strong>${verification_code}</strong></p></body></html>"""


def format_verification_email(template_content: str, **kwargs: str) -> str:
    return Template(template_content).safe_substitute(**kwargs)
