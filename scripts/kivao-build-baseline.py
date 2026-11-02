#!/usr/bin/env python3
"""Build the first KIVAO images locally from the exact production source archive."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


SOURCE = "eeccf718e8ad78aee98ca49d142d0594ea7000b2"
RELEASE = "kivao-1.0.0-eeccf718-r1"
PREFIX = "ghcr.io/xzaowu/kivao-app"
PLATFORM = "linux/amd64"
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
FILES = {"agent": "yingce-agent/Dockerfile", "web": "Dockerfile", "backend": "backend/Dockerfile"}
LOCKS = ["web/bun.lock", "backend/go.mod", "backend/go.sum", "backend/agent-runtime/pi/package-lock.json"]


def capture(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def validate_image(image, role, version):
    labels = image.get("Config", {}).get("Labels") or {}
    expected = {
        "org.opencontainers.image.source": "https://github.com/xzaowu/kivao-app",
        "org.opencontainers.image.revision": SOURCE,
        "org.opencontainers.image.version": version,
        "io.kivao.release": RELEASE,
    }
    if any(labels.get(k) != v for k, v in expected.items()):
        raise ValueError(f"{role}: image source/version labels do not match the release")
    if f"{image.get('Os')}/{image.get('Architecture')}" != PLATFORM:
        raise ValueError(f"{role}: unexpected image platform")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("Id", "")):
        raise ValueError(f"{role}: invalid local image ID")
    return {"id": image["Id"], "platform": PLATFORM, "labels": labels, "repo_digests": image.get("RepoDigests") or []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="build into the local Docker daemon; never push")
    parser.add_argument("--only", choices=["all", *FILES], default="all")
    args = parser.parse_args()
    repo = Path(capture(["git", "rev-parse", "--show-toplevel"]))
    version = capture(["git", "show", f"{SOURCE}:VERSION"]).strip()
    build_time = capture(["git", "show", "-s", "--format=%cI", SOURCE])
    roles = list(FILES) if args.only == "all" else [args.only]
    plan = {
        "release": RELEASE, "source_commit": SOURCE,
        "source_tree": capture(["git", "rev-parse", f"{SOURCE}^{{tree}}"]),
        "application_version": version, "build_time": build_time, "schema": 77,
        "platform": PLATFORM, "push": False,
        "build_args": {"BUILD_VERSION": version, "BUILD_COMMIT": SOURCE, "BUILD_TIME": build_time},
        "images": {r: f"{PREFIX}-{r}:{RELEASE}" for r in roles},
    }
    if not args.build:
        print(json.dumps(plan, indent=2))
        return
    if os.environ.get("DOCKER_CONTEXT") not in (None, "", "default"):
        raise ValueError("unset DOCKER_CONTEXT: this command only builds on the local daemon")
    cache = repo / ".local/cache/kivao-first-release"
    cache.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix=f"{args.only}-", dir=cache))
    source = out / "source"
    source.mkdir()
    archive = out / "source.tar"
    subprocess.run(["git", "archive", "--format=tar", f"--output={archive}", SOURCE], check=True)
    with tarfile.open(archive) as tar:
        tar.extractall(source, filter="data")
    plan["file_sha256"] = {p: hashlib.sha256((source / p).read_bytes()).hexdigest() for p in [*LOCKS, *FILES.values()]}
    plan["docker_version"] = json.loads(capture([*DOCKER, "version", "--format", "{{json .}} "]))
    plan["buildx_version"] = capture([*DOCKER, "buildx", "version"])
    plan["results"] = {}
    manifest = out / "build-result.json"
    manifest.write_text(json.dumps(plan, indent=2) + "\n")
    print(f"Evidence: {out}", flush=True)
    for role in roles:
        tag = plan["images"][role]
        log = out / f"{role}.log"
        command = [*DOCKER, "buildx", "build", "--platform", PLATFORM, "--load", "--progress=plain",
                   "--metadata-file", str(out / f"{role}.metadata.json"), "--file", FILES[role], "--tag", tag]
        for key, value in plan["build_args"].items():
            command += ["--build-arg", f"{key}={value}"]
        for key, value in {"org.opencontainers.image.source": "https://github.com/xzaowu/kivao-app",
                           "org.opencontainers.image.revision": SOURCE,
                           "org.opencontainers.image.version": version, "io.kivao.release": RELEASE}.items():
            command += ["--label", f"{key}={value}"]
        command.append(".")
        print(f"Building {role}; log: {log}", flush=True)
        with log.open("w") as output:
            result = subprocess.run(command, cwd=source, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            plan["results"][role] = {"status": "FAILED", "log": str(log), "exit_code": result.returncode}
            manifest.write_text(json.dumps(plan, indent=2) + "\n")
            raise RuntimeError(f"{role} build failed; inspect {log}")
        image = json.loads(capture([*DOCKER, "image", "inspect", tag]))[0]
        plan["results"][role] = {"status": "PASS", "tag": tag, **validate_image(image, role, version)}
        manifest.write_text(json.dumps(plan, indent=2) + "\n")
        print(f"PASS {role}: {image['Id']}", flush=True)
    print(f"Local builds complete. Registry publication NOT_RUN. Manifest: {manifest}", flush=True)


if __name__ == "__main__":
    main()
