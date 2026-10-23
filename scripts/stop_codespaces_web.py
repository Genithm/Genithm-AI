#!/usr/bin/env python3
"""Stop only this checkout's owned Next.js or recovery processes, never arbitrary port users."""
from __future__ import annotations
import os
import re
from pathlib import Path
import signal
import socket
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def is_web_command(command: str) -> bool:
    return bool(re.match(r"^(?:next-server(?: |$)|npm run (?:dev|start)(?: |$))", command) or
                re.search(r"(?:^| )[^ ]*/next/dist/bin/next (?:dev|start)(?: |$)", command))


def is_recovery_command(arguments: list[str], web: Path) -> bool:
    expected = str((web.parent.parent / 'scripts/codespaces_recovery.py').resolve())
    return (len(arguments) == 5 and Path(arguments[0]).name.startswith('python') and
            arguments[1] == expected and arguments[2:4] == ['--serve', '--reason'] and
            arguments[4] in {'startup', 'configuration'})


def identity(pid: int, web: Path):
    try:
        proc = Path('/proc') / str(pid)
        if proc.stat().st_uid != os.getuid() or (proc / 'cwd').resolve() != web.resolve():
            return None
        arguments = (proc / 'cmdline').read_bytes().rstrip(b'\0').decode('utf8', 'replace').split('\0')
        command = ' '.join(arguments).strip()
        if not is_web_command(command) and not is_recovery_command(arguments, web):
            return None
        fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return None
        return fields[19]
    except (OSError, ValueError, IndexError):
        return None


def stop(root: Path = ROOT) -> None:
    web = root / 'apps/web'
    targets = {}
    for proc in Path('/proc').iterdir():
        if proc.name.isdigit():
            pid = int(proc.name)
            stamp = identity(pid, web)
            if stamp is not None:
                targets[pid] = stamp
    for pid, stamp in targets.items():
        if identity(pid, web) == stamp:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5
    while any(identity(pid, web) == stamp for pid, stamp in targets.items()):
        if time.monotonic() >= deadline:
            raise RuntimeError('The previous Genithm server did not stop. Stop it in the terminal and retry.')
        time.sleep(0.1)
    # /proc can disappear just before the kernel releases the listening socket.
    # Only allow a brief release grace period when this call stopped owned targets.
    release_deadline = time.monotonic() + (2 if targets else 0)
    while True:
        try:
            with socket.create_connection(('127.0.0.1', 3000), timeout=0.5):
                pass
        except OSError:
            break
        if time.monotonic() >= release_deadline:
            raise RuntimeError('Port 3000 is occupied by another process; it was not killed. Stop that process and retry.')
        time.sleep(0.1)
    (root / '.codespaces-web.pid').unlink(missing_ok=True)
    print('[Genithm] Previous web runtime stopped; port 3000 is available.')


if __name__ == '__main__':
    try:
        stop()
    except (OSError, RuntimeError) as error:
        print(f'[Genithm] {error}', file=sys.stderr)
        raise SystemExit(4)
