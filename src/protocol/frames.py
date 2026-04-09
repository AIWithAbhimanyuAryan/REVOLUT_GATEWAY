from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel


class ClientInfo(BaseModel):
    id: str
    version: str
    platform: str


class AuthInfo(BaseModel):
    token: str


class ConnectParams(BaseModel):
    client: ClientInfo
    auth: Optional[AuthInfo] = None


class ServerInfo(BaseModel):
    version: str
    connId: str


class FeaturesInfo(BaseModel):
    methods: list[str]
    events: list[str]


class HelloOk(BaseModel):
    type: Literal["hello-ok"] = "hello-ok"
    protocol: int
    server: ServerInfo
    features: FeaturesInfo


class ErrorShape(BaseModel):
    code: str
    message: str
    details: Optional[Any] = None


class RequestFrame(BaseModel):
    type: Literal["req"]
    id: str
    method: str
    params: Optional[Any] = None


class ResponseFrame(BaseModel):
    type: Literal["res"] = "res"
    id: str
    ok: bool
    payload: Optional[Any] = None
    error: Optional[ErrorShape] = None


class EventFrame(BaseModel):
    type: Literal["event"] = "event"
    event: str
    payload: Optional[Any] = None
    seq: Optional[int] = None
