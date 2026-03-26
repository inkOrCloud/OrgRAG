from datetime import datetime, timedelta
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Security, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from ..utils import logger
from .config import global_args
from .passwords import verify_password

# use the .env that is inside the current folder
# allows to use different .env file for each lightrag instance
# the OS environment variables take precedence over the .env file
load_dotenv(dotenv_path=".env", override=False)


class TokenPayload(BaseModel):
    sub: str  # Username
    exp: datetime  # Expiration time
    role: str = "user"  # User role, default is regular user
    metadata: dict = {}  # Additional metadata


class AuthHandler:
    def __init__(self):
        self.secret = global_args.token_secret
        if self.secret == "lightrag-jwt-default-secret-key!":
            logger.warning(
                "Using default TOKEN_SECRET. Please set a unique TOKEN_SECRET in your .env file for better security."
            )
        self.algorithm = global_args.jwt_algorithm
        self.expire_hours = global_args.token_expire_hours
        self.accounts = {}
        auth_accounts = global_args.auth_accounts
        invalid_accounts = []
        if auth_accounts:
            for account in auth_accounts.split(","):
                try:
                    username, password = account.split(":", 1)
                    if not username or not password:
                        raise ValueError
                    self.accounts[username] = password
                except ValueError:
                    invalid_accounts.append(account)
        if invalid_accounts:
            invalid_entries = ", ".join(invalid_accounts)
            logger.error(f"Invalid account format in AUTH_ACCOUNTS: {invalid_entries}")
            raise ValueError(
                "AUTH_ACCOUNTS must use comma-separated user:password pairs."
            )

    def verify_password(self, username: str, plain_password: str) -> bool:
        """
        Verify password for a user. Supports explicit bcrypt values and plaintext.

        Args:
            username: Username to verify
            plain_password: Plaintext password to check

        Returns:
            bool: True if password is correct, False otherwise
        """
        if username not in self.accounts:
            return False

        stored_password = self.accounts[username]
        return verify_password(plain_password, stored_password)

    def create_token(
        self,
        username: str,
        role: str = "user",
        custom_expire_hours: int = None,
        metadata: dict = None,
    ) -> str:
        """
        Create JWT token

        Args:
            username: Username
            role: User role, either "admin" or "user"
            custom_expire_hours: Custom expiration time (hours), if None use default value
            metadata: Additional metadata

        Returns:
            str: Encoded JWT token
        """
        expire_hours = custom_expire_hours if custom_expire_hours is not None else self.expire_hours

        expire = datetime.utcnow() + timedelta(hours=expire_hours)

        # Create payload
        payload = TokenPayload(
            sub=username, exp=expire, role=role, metadata=metadata or {}
        )

        return jwt.encode(payload.dict(), self.secret, algorithm=self.algorithm)

    def validate_token(self, token: str) -> dict:
        """
        Validate JWT token

        Args:
            token: JWT token

        Returns:
            dict: Dictionary containing user information

        Raises:
            HTTPException: If token is invalid or expired
        """
        try:
            payload = jwt.decode(token, self.secret, algorithms=[self.algorithm])
            expire_timestamp = payload["exp"]
            expire_time = datetime.utcfromtimestamp(expire_timestamp)

            if datetime.utcnow() > expire_time:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired"
                )

            # Return complete payload instead of just username
            return {
                "username": payload["sub"],
                "role": payload.get("role", "user"),
                "metadata": payload.get("metadata", {}),
                "exp": expire_time,
            }
        except jwt.PyJWTError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
            )


auth_handler = AuthHandler()

# ── OAuth2 scheme (reused across modules) ───────────────────────────────────
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)


async def get_current_user(token: str = Security(_oauth2_scheme)) -> dict:
    """
    FastAPI dependency: extract and validate the current user from JWT token.

    Returns a dict with keys: username, role, metadata, exp
    Raises 401 if token is missing or invalid.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please login.",
        )
    return auth_handler.validate_token(token)


async def require_admin(current_user: dict = Security(get_current_user)) -> dict:
    """
    FastAPI dependency: require admin role.
    Raises 403 if the current user is not an admin.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return current_user
