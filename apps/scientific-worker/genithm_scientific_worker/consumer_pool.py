"""Bounded independent consumers of the existing transactional science queue.

No work is pre-fetched into an in-memory queue, and no scientific approval,
lease, retry, ownership, or result-validation policy is bypassed. The database
continues to decide which job each process can claim. Default capacity is one.
"""
from __future__ import annotations

import argparse
import logging
import multiprocessing
import signal
import threading
import time
from typing import Any, Callable

LOGGER = logging.getLogger("genithm.scientific-capacity")
MAX_CONCURRENCY = 4


def concurrency_value(raw: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("Scientific concurrency must be an integer from 1 to 4") from exc
    if not 1 <= value <= MAX_CONCURRENCY:
        raise argparse.ArgumentTypeError("Scientific concurrency must be an integer from 1 to 4")
    return value


def consume_until_stopped(client: Any, process_one: Callable[[Any], bool], stop: Any) -> None:
    """Finish the current job on shutdown and stop claiming new work.

    An RPC exception escaping process_one can have an ambiguous claim/commit
    outcome. Never blindly retry it here: exit and let operations inspect the
    durable job state. Validated job retries remain inside existing RPC logic.
    """
    while not stop.is_set():
        if not process_one(client):
            stop.wait(client.config.poll_seconds)


def _signal_handlers(stop: Any) -> dict[Any, Any]:
    old: dict[Any, Any] = {}
    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM, signal.SIGINT):
            old[signum] = signal.getsignal(signum)
            signal.signal(signum, lambda _signum, _frame: stop.set())
    return old


def _restore_handlers(old: dict[Any, Any]) -> None:
    for signum, handler in old.items():
        signal.signal(signum, handler)


def _science_consumer(stop: Any, config: Any) -> None:
    # Import inside spawned child. Each slot owns its own HTTP client and job.
    from .runtime_v4 import Client, process_one

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    previous = _signal_handlers(stop)
    try:
        consume_until_stopped(Client(config), process_one, stop)
    except Exception as exc:
        # RPC exception messages can contain operational detail: log type only.
        LOGGER.error("scientific consumer stopped error_type=%s", type(exc).__name__)
        raise SystemExit(1) from None
    finally:
        _restore_handlers(previous)


def supervise_consumers(
    target: Callable[..., None],
    target_args: tuple[Any, ...],
    *,
    concurrency: int,
    grace_seconds: float = 300,
    stop_event: Any = None,
) -> int:
    """Spawn 1-4 CPU-capable workers; fail visibly if any exits unexpectedly.

    SIGTERM/SIGINT stop new claims and allow current work to finish within the
    grace period. A hard timeout never invents a result or replays a job.
    Operators must inspect any interrupted durable job before authorizing work.
    """
    concurrency_value(str(concurrency))
    if not 0 <= grace_seconds <= 900:
        raise ValueError("Invalid scientific shutdown grace period")
    context = multiprocessing.get_context("spawn")
    stop = stop_event if stop_event is not None else context.Event()
    processes: list[Any] = []
    previous = _signal_handlers(stop)
    result = 0
    try:
        for slot in range(concurrency):
            child = context.Process(target=target, args=(stop, *target_args), name=f"science-slot-{slot + 1}")
            child.start()
            processes.append(child)
        LOGGER.info("scientific capacity started slots=%d", concurrency)
        while not stop.wait(0.2):
            if any(child.exitcode is not None for child in processes):
                result = 1
                LOGGER.error("scientific consumer exited; stopping claims and draining active work")
                stop.set()
                break
    except Exception as exc:
        LOGGER.error("scientific capacity failed error_type=%s", type(exc).__name__)
        result = 1
    finally:
        stop.set()
        deadline = time.monotonic() + grace_seconds
        for child in processes:
            child.join(max(0, deadline - time.monotonic()))
        for child in processes:
            if child.is_alive():
                result = 1
                LOGGER.error("scientific shutdown grace expired slot=%s; inspect interrupted job state", child.name)
                child.kill()
                child.join(5)
            if child.exitcode not in (0, None):
                result = 1
            if not child.is_alive():
                child.close()
        _restore_handlers(previous)
    return result


def run_scientific_consumers(config: Any, concurrency: int) -> int:
    return supervise_consumers(_science_consumer, (config,), concurrency=concurrency,
                               grace_seconds=config.visibility_seconds)
