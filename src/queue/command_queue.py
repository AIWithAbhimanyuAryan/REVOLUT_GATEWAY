from __future__ import annotations
import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any, TypeVar

T = TypeVar("T")


class CommandLaneClearedError(Exception):
    pass


class GatewayDrainingError(Exception):
    pass


@dataclass
class _LaneState:
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    running: int = 0
    max_concurrent: int = 1
    draining: bool = False


_lanes: dict[str, _LaneState] = {}
_gateway_draining = False


def _get_lane(name: str) -> _LaneState:
    if name not in _lanes:
        _lanes[name] = _LaneState()
    return _lanes[name]


async def enqueue_in_lane(
    lane: str, task: Callable[[], Coroutine[Any, Any, T]]
) -> T:
    if _gateway_draining:
        raise GatewayDrainingError("Gateway is draining")
    state = _get_lane(lane)
    if state.draining:
        raise GatewayDrainingError(f"Lane '{lane}' is draining")

    loop = asyncio.get_running_loop()
    future: asyncio.Future[T] = loop.create_future()
    await state.queue.put((task, future))
    asyncio.create_task(_drain_lane(lane))
    return await future


async def enqueue(task: Callable[[], Coroutine[Any, Any, T]]) -> T:
    return await enqueue_in_lane("main", task)


async def _drain_lane(lane: str) -> None:
    state = _get_lane(lane)
    while not state.queue.empty() and state.running < state.max_concurrent:
        try:
            task, future = state.queue.get_nowait()
        except asyncio.QueueEmpty:
            break
        state.running += 1

        async def _run(t: Any = task, f: Any = future) -> None:
            try:
                result = await t()
                if not f.done():
                    f.set_result(result)
            except Exception as e:
                if not f.done():
                    f.set_exception(e)
            finally:
                state.running -= 1
                asyncio.create_task(_drain_lane(lane))

        asyncio.create_task(_run())


def get_queue_depth(lane: str = "main") -> int:
    if lane not in _lanes:
        return 0
    s = _lanes[lane]
    return s.queue.qsize() + s.running


def clear_lane(lane: str) -> None:
    if lane not in _lanes:
        return
    state = _lanes[lane]
    state.draining = True
    while not state.queue.empty():
        try:
            _, future = state.queue.get_nowait()
            if not future.done():
                future.set_exception(CommandLaneClearedError(f"Lane '{lane}' cleared"))
        except asyncio.QueueEmpty:
            break
    state.draining = False


def mark_draining() -> None:
    global _gateway_draining
    _gateway_draining = True


def reset_all() -> None:
    global _gateway_draining
    _gateway_draining = False
    _lanes.clear()
