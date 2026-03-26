import bcrypt
import pytest

from lightrag.api.passwords import BCRYPT_PASSWORD_PREFIX, hash_password
from lightrag.tools.hash_password import main as hash_password_main


def test_hash_password_returns_prefixed_value():
    hashed = hash_password("new_password")

    assert hashed.startswith(BCRYPT_PASSWORD_PREFIX)
    raw_hash = hashed[len(BCRYPT_PASSWORD_PREFIX):]
    assert bcrypt.checkpw("new_password".encode("utf-8"), raw_hash.encode("utf-8"))


def test_hash_password_cli_outputs_hashed_entry(capsys):
    exit_code = hash_password_main(["--username", "admin", "secret"])

    assert exit_code == 0
    output = capsys.readouterr().out.strip()
    username, hashed = output.split(":", 1)
    assert username == "admin"
    assert hashed.startswith(BCRYPT_PASSWORD_PREFIX)
    raw_hash = hashed[len(BCRYPT_PASSWORD_PREFIX):]
    assert bcrypt.checkpw("secret".encode("utf-8"), raw_hash.encode("utf-8"))
