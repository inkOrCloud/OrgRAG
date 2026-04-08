from datetime import datetime, timedelta
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Security, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from ..utils import logger
from .config import global_args

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
    """JWT auth handler.

    Configuration is read lazily from ``global_args`` on first property access
    so that merely importing this module (and constructing the singleton below)
    does NOT trigger ``parse_args()`` / ``initialize_config()``.  This lets
    CLI sub-commands such as ``reset-password`` import safely without argparse
    rejecting their own arguments.
    """

    # Cached values – None means "not yet read from global_args"
    _secret: Optional[str] = None
    _algorithm: Optional[str] = None
    _expire_hours: Optional[int] = None

    @property
    def secret(self) -> str:
        if self._secret is None:
            self._secret = global_args.token_secret
            if self._secret == "lightrag-jwt-default-secret-key!":
                logger.warning(
                    "Using default TOKEN_SECRET. Please set a unique TOKEN_SECRET "
                    "in your .env file for better security."
                )
        return self._secret

    @secret.setter
    def secret(self, value: str) -> None:
        self._secret = value

    @property
    def algorithm(self) -> str:
        if self._algorithm is None:
            self._algorithm = global_args.jwt_algorithm
        return self._algorithm

    @algorithm.setter
    def algorithm(self, value: str) -> None:
        self._algorithm = value

    @property
    def expire_hours(self) -> int:
        if self._expire_hours is None:
            self._expire_hours = global_args.token_expire_hours
        return self._expire_hours

    @expire_hours.setter
    def expire_hours(self, value: int) -> None:
        self._expire_hours = value

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
        expire_hours = (
            custom_expire_hours
            if custom_expire_hours is not None
            else self.expire_hours
        )

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
