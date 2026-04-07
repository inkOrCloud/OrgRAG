import asyncio

import bcrypt
import pytest

from lightrag.api.passwords import BCRYPT_PASSWORD_PREFIX, hash_password, verify_password


# ── passwords.py unit tests ───────────────────────────────────────────────────

def test_hash_password_returns_prefixed_value():
    hashed = hash_password("new_password")

    assert hashed.startswith(BCRYPT_PASSWORD_PREFIX)
    raw_hash = hashed[len(BCRYPT_PASSWORD_PREFIX):]
    assert bcrypt.checkpw("new_password".encode("utf-8"), raw_hash.encode("utf-8"))


def test_verify_password_correct():
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("secret123")
    assert verify_password("wrong", hashed) is False


def test_verify_password_rejects_plaintext_stored():
    # After removing the plaintext fallback, bare strings must not verify.
    assert verify_password("secret", "secret") is False


def test_verify_password_rejects_empty_hash():
    assert verify_password("secret", BCRYPT_PASSWORD_PREFIX) is False


# ── reset-password subcommand tests ──────────────────────────────────────────

def _make_db(path: str, username: str = "alice", password: str = "old_pass", role: str = "admin"):
    """Create a minimal lightrag_users.db with one user."""
    async def _create():
        from lightrag.api.user_db import UserDB
        db = UserDB(path)
        await db.initialize()
        await db.create_user(username=username, password=password, role=role)

    asyncio.run(_create())


def _run_reset_password(argv: list[str]):
    """Call reset_password_cmd directly (isolated from server init chain)."""
    from lightrag.api.user_db import reset_password_cmd
    reset_password_cmd(argv)


def test_reset_password_updates_db(tmp_path, capsys):
    db_path = str(tmp_path / "lightrag_users.db")
    _make_db(db_path, username="alice", password="old_pass")

    _run_reset_password(["alice", "--password", "new_pass", "--working-dir", str(tmp_path)])

    out = capsys.readouterr().out
    assert "alice" in out
    assert "successfully" in out

    # Verify new password works and old one doesn't
    async def _check():
        from lightrag.api.user_db import UserDB
        db = UserDB(db_path)
        await db.initialize()
        assert await db.verify_password("alice", "new_pass") is not None
        assert await db.verify_password("alice", "old_pass") is None

    asyncio.run(_check())


def test_reset_password_unknown_user_exits(tmp_path):
    db_path = str(tmp_path / "lightrag_users.db")
    _make_db(db_path, username="alice", password="pass")

    with pytest.raises(SystemExit) as exc_info:
        _run_reset_password(["nobody", "--password", "x", "--working-dir", str(tmp_path)])

    assert exc_info.value.code == 1


def test_reset_password_missing_db_exits(tmp_path):
    with pytest.raises(SystemExit) as exc_info:
        _run_reset_password(["alice", "--password", "x", "--working-dir", str(tmp_path)])

    assert exc_info.value.code == 1
