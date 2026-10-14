"""Run a verification command with a wall-clock deadline and owned-group cleanup."""
import os
import signal
import subprocess
import sys
import time


def members(group):
    rows = subprocess.check_output(["ps", "-ax", "-o", "pid=,pgid="], text=True)
    return [int(pid) for pid, pgid in (line.split() for line in rows.splitlines())
            if int(pgid) == group]


def run(argv, timeout=60):
    process = subprocess.Popen(argv, start_new_session=True)
    try:
        try:
            return process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            print(f"Verification exceeded {timeout}s", file=sys.stderr, flush=True)
            return 124
    finally:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass
            if sig == signal.SIGTERM:
                time.sleep(0.2)
        process.wait(timeout=2)
        deadline = time.monotonic() + 3
        while members(process.pid) and time.monotonic() < deadline:
            time.sleep(0.05)
        remaining = members(process.pid)
        if remaining:
            raise RuntimeError(f"Verification processes remain: {remaining}")
        print(f"Verification group {process.pid}: 0 remaining processes", flush=True)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python tests/run-bounded.py COMMAND [ARG ...]")
    raise SystemExit(run(sys.argv[1:]))
