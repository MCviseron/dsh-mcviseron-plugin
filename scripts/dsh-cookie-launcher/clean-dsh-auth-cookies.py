#!/usr/bin/env python3
"""Delete old DSH desktop authentication cookies before launching DSH.

Chromium stores cookies by host, not port. DSH uses a new loopback port on every
launch, so its 30-day dsh-auth-* cookies accumulate until the Cookie request
header exceeds the Host's 16 KiB limit. This runs before the app starts, while
the cookie DB is unlocked.

Only rows for 127.0.0.1 whose name starts with dsh-auth- are removed. The DB is
backed up first. DSH_COOKIE_DB / DSH_COOKIE_LAUNCHER_DIR are test overrides.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

HOST = "127.0.0.1"
PREFIX = "dsh-auth-"
WHERE = "host_key = ? and name like ?"
ARGS = (HOST, PREFIX + "%")


def main() -> int:
    appdata = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    db = Path(os.environ.get("DSH_COOKIE_DB", appdata / "@deepseek-ai" / "dsh-desktop" / "Network" / "Cookies"))
    base = Path(os.environ.get("DSH_COOKIE_LAUNCHER_DIR", Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "dsh-mcviseron"))
    backups = base / "backups"
    log_path = base / "launcher.log"
    base.mkdir(parents=True, exist_ok=True)

    def log(message: str) -> None:
        try:
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(datetime.now().astimezone().isoformat() + " " + message + "\n")
        except OSError:
            pass

    if not db.is_file():
        log("cookie database missing: " + str(db))
        return 0

    try:
        con = sqlite3.connect(str(db), timeout=2)
        try:
            before = con.execute("select count(*) from cookies where " + WHERE, ARGS).fetchone()[0]
        finally:
            con.close()
    except Exception as error:
        log("cookie database unavailable (DSH may still be running): " + repr(error))
        return 0

    if before == 0:
        log("no stale dsh-auth cookies")
        return 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backups.mkdir(parents=True, exist_ok=True)
    backup = backups / ("Cookies-" + stamp)
    try:
        shutil.copy2(db, backup)
        for suffix in ("-wal", "-shm"):
            side = Path(str(db) + suffix)
            if side.is_file():
                shutil.copy2(side, Path(str(backup) + suffix))
        log("backup " + str(backup))
    except OSError as error:
        log("backup failed: " + repr(error))

    try:
        con = sqlite3.connect(str(db), timeout=2)
        try:
            deleted = con.execute("delete from cookies where " + WHERE, ARGS).rowcount
            con.commit()
            after = con.execute("select count(*) from cookies where " + WHERE, ARGS).fetchone()[0]
        finally:
            con.close()
        log("deleted=" + str(deleted) + " remaining=" + str(after))
    except Exception as error:
        log("delete failed: " + repr(error))

    try:
        old = sorted(backups.glob("Cookies-*"), key=lambda item: item.stat().st_mtime, reverse=True)
        for extra in old[10:]:
            extra.unlink(missing_ok=True)
            for suffix in ("-wal", "-shm"):
                Path(str(extra) + suffix).unlink(missing_ok=True)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
