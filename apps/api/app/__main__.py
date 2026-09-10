from __future__ import annotations

import argparse
import os

import uvicorn


def _port_from_environment() -> int:
    raw_port = os.environ.get("PORT", "8000")
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise SystemExit("PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise SystemExit("PORT must be between 1 and 65535")
    return port


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Genithm API service.")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    port = args.port if args.port is not None else _port_from_environment()
    if not 1 <= port <= 65535:
        raise SystemExit("--port must be between 1 and 65535")

    uvicorn.run("app.main:app", host=args.host, port=port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
