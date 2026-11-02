#!/usr/bin/env python3
"""Validate an image-only environment change; write only with --apply."""

import argparse
import os
from pathlib import Path
import re
import stat
import tempfile

RELEASE = "kivao-1.0.0-eeccf718-r1"
ROLES = {"CANVAS_BACKEND_IMAGE": "backend", "CANVAS_WEB_IMAGE": "web", "CANVAS_YINGCE_AGENT_IMAGE": "agent"}
OLD = {
    "CANVAS_BACKEND_IMAGE": "ghcr.io/ddcat-ai/open-ai-canvas-backend@sha256:bc144b5834ffc5358d3c7757f50166c200130295d21bf2b8297c73567e64d53f",
    "CANVAS_WEB_IMAGE": "ghcr.io/ddcat-ai/open-ai-canvas-web@sha256:75e55e92370011751448467b3720b3a3558e639adde6023f6c3f7c23586b0326",
    "CANVAS_YINGCE_AGENT_IMAGE": "ghcr.io/ddcat-ai/open-ai-canvas-yingce-agent@sha256:c2dc010158ba6eb19344fa1dc99a40a26f93f5e9c2cb0b9a0045532ccb7bcbb2",
    "CANVAS_IMAGE_TAG": "1.7.3.3",
}


def read_lock(text, rollback=False):
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key not in OLD or key in values:
            raise ValueError("image lock contains an unknown, duplicate or malformed entry")
        values[key] = value
    if set(values) != set(OLD):
        raise ValueError("image lock must contain exactly the four release keys")
    if rollback:
        if values != OLD:
            raise ValueError("rollback lock does not match the audited original digests")
    else:
        if values["CANVAS_IMAGE_TAG"] != RELEASE:
            raise ValueError("unexpected KIVAO release revision")
        for key, role in ROLES.items():
            if not re.fullmatch(rf"ghcr\.io/xzaowu/kivao-app-{role}@sha256:[0-9a-f]{{64}}", values[key]):
                raise ValueError("candidate image must use its KIVAO repository and a full registry digest")
    return values


def replace_keys(text, values):
    seen = set()
    lines = []
    for line in text.splitlines(keepends=True):
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        key = match.group(1) if match else None
        if key in values:
            if key in seen:
                raise ValueError("existing environment has duplicate release keys")
            seen.add(key)
            lines.append(f"{key}={values[key]}\n")
        else:
            lines.append(line)
    result = "".join(lines)
    if result and not result.endswith("\n"):
        result += "\n"
    return result + "".join(f"{key}={value}\n" for key, value in values.items() if key not in seen)


def apply_lock(env_path, values, apply=False):
    if env_path.is_symlink() or not env_path.is_file():
        raise ValueError("environment must be an existing regular file, not a symlink")
    info = env_path.stat()
    original = env_path.read_bytes()
    next_value = replace_keys(original.decode(), values).encode()
    if not apply:
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".kivao-env-", dir=env_path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            if (os.geteuid(), os.getegid()) != (info.st_uid, info.st_gid):
                os.fchown(output.fileno(), info.st_uid, info.st_gid)
            output.write(next_value)
            output.flush()
            os.fsync(output.fileno())
        if env_path.is_symlink() or env_path.read_bytes() != original:
            raise ValueError("environment changed during preparation; refusing to overwrite it")
        os.replace(temporary, env_path)
        directory = os.open(env_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--lock-file", required=True, type=Path)
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    values = read_lock(args.lock_file.read_text(), args.rollback)
    apply_lock(args.env_file, values, args.apply)
    print("Applied four image/version keys" if args.apply else "Validated four image/version keys; no files changed")


if __name__ == "__main__":
    main()
