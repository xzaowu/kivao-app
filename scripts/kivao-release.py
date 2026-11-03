#!/usr/bin/env python3
"""KIVAO 1.0.1 source/image evidence and paired locks; never builds, pushes or deploys."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
POLICY = json.loads((ROOT / ".github/kivao-1.0.1.json").read_text())
ROLES = {"web": "CANVAS_WEB_IMAGE", "backend": "CANVAS_BACKEND_IMAGE", "agent": "CANVAS_YINGCE_AGENT_IMAGE"}
DOCKERFILES = {"web": "Dockerfile", "backend": "backend/Dockerfile", "agent": "yingce-agent/Dockerfile"}
LOCKFILES = ["web/bun.lock", "backend/go.mod", "backend/go.sum", "backend/agent-runtime/pi/package-lock.json"]
PROTECTED = ["backend", "plugin-packages", "web/src/services/api", "web/src/lib/plugins", "web/src/pages/plugins",
             "yingce-agent/server.mjs", "Dockerfile", "docker", "docker-compose.deploy.yml", "nginx.conf", "VERSION",
             "web/package.json", "web/bun.lock", ".github/workflows/quality.yml", ".github/workflows/publish-images.yml",
             ".github/workflows/kivao-baseline.yml", "scripts/kivao-build-baseline.py", "scripts/kivao-apply-image-lock.py"]
PREPARATION = {
    ".github/kivao-1.0.1.json", ".github/workflows/kivao-1.0.1-ci.yml", ".github/workflows/kivao-1.0.1-publish.yml",
    "scripts/kivao-release.py", "scripts/test_kivao_release.py", "yingce-agent/Dockerfile",
}


def capture(args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def git(*args):
    return capture(["git", *args])


def digest(value):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", value or ""):
        raise ValueError("expected a full sha256 digest")
    return value


def release_name(sha, value=None):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("expected a complete candidate SHA")
    value = value or f"kivao-1.0.1-{sha[:12]}-r1"
    if not re.fullmatch(rf"kivao-1\.0\.1-{sha[:12]}-r[1-9][0-9]*", value):
        raise ValueError("release tag must identify this exact candidate; r1 baseline/latest/v* forbidden")
    return value


def source_report(sha, release=None):
    release = release_name(sha, release)
    if git("rev-parse", "HEAD") != sha or git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("checkout must be the clean candidate commit")
    git("merge-base", "--is-ancestor", POLICY["product_commit"], sha)
    git("merge-base", "--is-ancestor", POLICY["production_commit"], sha)
    if git("merge-base", sha, POLICY["excluded_main"]) != POLICY["production_source"]:
        raise ValueError("candidate includes excluded main ancestry")
    if git("rev-list", "--min-parents=2", f'{POLICY["production_commit"]}..{sha}'):
        raise ValueError("unexpected merge in the production release lineage")
    changed = git("diff", "--name-only", POLICY["product_commit"], sha).splitlines()
    if any(p not in PREPARATION and not p.startswith("docs/") for p in changed):
        raise ValueError("changes beyond frozen product scope and release preparation")
    fingerprints = {}
    for path in PROTECTED:
        before = git("rev-parse", f'{POLICY["production_commit"]}:{path}')
        after = git("rev-parse", f"{sha}:{path}")
        if before != after:
            raise ValueError(f"protected schema/protocol/dependency/deployment path changed: {path}")
        fingerprints[path] = after
    if hashlib.sha256((ROOT / DOCKERFILES["agent"]).read_bytes()).hexdigest() != POLICY["agent_dockerfile_sha256"]:
        raise ValueError("Agent Dockerfile exceeds the approved build-metadata-only change")
    if hashlib.sha256((ROOT / "web/public/kivao-mark.png").read_bytes()).hexdigest() != POLICY["brand_sha256"]:
        raise ValueError("unapproved brand asset")
    version = (ROOT / "VERSION").read_text().strip()
    if not re.fullmatch(r"v[0-9.]+", version):
        raise ValueError("unexpected source application version")
    return {
        "format_version": 1, "source_commit": sha, "source_tree": git("rev-parse", f"{sha}^{{tree}}"),
        "product_commit": POLICY["product_commit"], "release": release, "application_version": version,
        "platform": POLICY["platform"], "schema": POLICY["schema"], "schema_changed": False,
        "excluded_main_commits": 14, "source_scope_verified": True, "registry_publish": False,
        "protected_fingerprints": fingerprints,
        "build_args": {"BUILD_VERSION": version, "BUILD_COMMIT": sha, "BUILD_TIME": git("show", "-s", "--format=%cI", sha)},
        "file_sha256": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in [*LOCKFILES, *DOCKERFILES.values()]},
        "changed_from_production": git("diff", "--name-only", POLICY["production_commit"], sha).splitlines(),
    }


def validate_image(image, plan):
    labels = image.get("Config", {}).get("Labels") or {}
    expected = {"org.opencontainers.image.source": "https://github.com/" + POLICY["repository"],
                "org.opencontainers.image.revision": plan["source_commit"],
                "org.opencontainers.image.version": plan["application_version"], "io.kivao.release": plan["release"]}
    if any(labels.get(k) != v for k, v in expected.items()):
        raise ValueError("OCI source/revision/version/release mismatch")
    if f"{image.get('Os')}/{image.get('Architecture')}" != POLICY["platform"]:
        raise ValueError("candidate architecture mismatch")
    return {"image_id": digest(image.get("Id")), "platform": POLICY["platform"], "labels": expected}


def verify_image(sha, role, reference, release=None, registry_digest=None):
    plan = source_report(sha, release)
    docker = ["docker", "--host", "unix:///var/run/docker.sock"]
    info = validate_image(json.loads(capture([*docker, "image", "inspect", reference]))[0], plan)
    command = [*docker, "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "sh", reference, "-ec"]
    if role == "web":
        capture([*command, f"grep -rlF -- '{sha}' /opt/canvas-release/assets >/dev/null"])
        actual = capture([*command, "sha256sum /opt/canvas-release/kivao-mark.png"]).split()[0]
        if actual != POLICY["brand_sha256"]:
            raise ValueError("Web image does not contain the approved kite asset")
    elif role == "backend":
        for binary in ["yingce-backend", "migrate-schema", "migrate-sqlite-postgres"]:
            capture([*command, f"grep -aqF -- '{sha}' /usr/local/bin/{binary}"])
    else:
        embedded = json.loads(capture([*command, "cat /app/build-info.json"]))
        if embedded != {"version": plan["application_version"], "commit": sha, "buildTime": plan["build_args"]["BUILD_TIME"]}:
            raise ValueError("Agent embedded BUILD_COMMIT/version/time mismatch")
    if registry_digest:
        digest(registry_digest)
        full = f"ghcr.io/{POLICY['repository']}-{role}@{registry_digest}"
        # The repository is kivao-app; the role suffix is shared by all KIVAO images.
        if full not in json.loads(capture([*docker, "image", "inspect", full]))[0].get("RepoDigests", []):
            raise ValueError("registry identity not present on the verified image")
        remote = json.loads(capture([*docker, "image", "inspect", full]))[0]
        if remote["Id"] != info["image_id"]:
            raise ValueError("pushed image differs from the verified candidate")
    return {**plan, "role": role, "image": reference, **info, "embedded_commit_verified": True,
            "registry_digest": registry_digest, "registry_publish": bool(registry_digest)}


def read_reports(directory):
    reports = [json.loads((directory / f"image-{role}.json").read_text()) for role in ROLES]
    sha = reports[0]["source_commit"]
    for role, report in zip(ROLES, reports):
        if report["role"] != role or report["source_commit"] != sha or not report.get("embedded_commit_verified"):
            raise ValueError("incomplete, mixed or unverified image reports")
        validate_image({"Id": report["image_id"], "Os": "linux", "Architecture": "amd64", "Config": {"Labels": report["labels"]}}, report)
        if report["platform"] != POLICY["platform"] or not report.get("source_scope_verified"):
            raise ValueError("source/platform evidence missing")
    return reports


def paired_locks(reports):
    releases = {r["release"] for r in reports}
    if len(releases) != 1 or len(reports) != 3 or {r["role"] for r in reports} != set(ROLES):
        raise ValueError("three roles with one release are required")
    release = releases.pop()
    sha = reports[0]["source_commit"]
    release_name(sha, release)
    values = {"CANVAS_IMAGE_TAG": release}
    for report in reports:
        if report["source_commit"] != sha or not report.get("embedded_commit_verified") or not report.get("registry_publish"):
            raise ValueError("release lock requires verified published registry identities")
        values[ROLES[report["role"]]] = f"ghcr.io/{POLICY['repository']}-{report['role']}@{digest(report.get('registry_digest'))}"
    return {"source_commit": sha, "release": values, "rollback": POLICY["rollback"], "agent_init_required": True,
            "migrate_image_key": "CANVAS_BACKEND_IMAGE", "schema": 77, "migration_authorized": False,
            "preserve": ["yingce", "PostgreSQL 17", "Redis", "existing bind mounts", "127.0.0.1:13100"]}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def check_ci(report, sha):
    if report.get("source_commit") != sha or report.get("status") != "PASS" or report.get("quality_result") != "success":
        raise ValueError("CI report does not prove all checks passed on this candidate")
    if set(report.get("images", {})) != set(ROLES) or report.get("registry_publish") is not False:
        raise ValueError("not a complete build-only candidate CI report")
    for role, value in report["images"].items():
        if value.get("source_commit") != sha or value.get("build_args", {}).get("BUILD_COMMIT") != sha or not value.get("embedded_commit_verified"):
            raise ValueError("CI source/build identity mismatch")
        validate_image({"Id": value["image_id"], "Os": "linux", "Architecture": "amd64", "Config": {"Labels": value["labels"]}}, value)
    return {"source_commit": sha, "verified_ci": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ["source", "verify-image"]:
        item = sub.add_parser(name)
        item.add_argument("--sha", required=True)
        item.add_argument("--release")
        item.add_argument("--output", required=True, type=Path)
        if name == "verify-image":
            item.add_argument("--role", required=True, choices=ROLES)
            item.add_argument("--image", required=True)
            item.add_argument("--registry-digest")
    for name in ["summary", "locks"]:
        item = sub.add_parser(name)
        item.add_argument("--directory", required=True, type=Path)
        item.add_argument("--output", required=True, type=Path)
        if name == "summary":
            item.add_argument("--quality-result", required=True, choices=["success"])
    ci = sub.add_parser("check-ci")
    ci.add_argument("--sha", required=True)
    ci.add_argument("--report", required=True, type=Path)
    ci.add_argument("--output", required=True, type=Path)
    apply = sub.add_parser("apply-lock")
    apply.add_argument("--bundle", required=True, type=Path)
    apply.add_argument("--env-file", required=True, type=Path)
    apply.add_argument("--rollback", action="store_true")
    apply.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.command == "source":
        result = source_report(args.sha, args.release)
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a") as stream:
                for key, value in {"sha": args.sha, "release": result["release"], "version": result["application_version"], "time": result["build_args"]["BUILD_TIME"]}.items():
                    stream.write(f"{key}={value}\n")
    elif args.command == "verify-image":
        result = verify_image(args.sha, args.role, args.image, args.release, args.registry_digest)
    elif args.command == "check-ci":
        result = check_ci(json.loads(args.report.read_text()), args.sha)
    elif args.command in ("summary", "locks"):
        reports = read_reports(args.directory)
        if args.command == "summary":
            result = {"source_commit": reports[0]["source_commit"], "status": "PASS", "registry_publish": False,
                      "quality_result": args.quality_result, "images": {r["role"]: r for r in reports},
                      "image_publish_ready": True, "ci_run": os.environ.get("GITHUB_RUN_ID")}
        else:
            result = paired_locks(reports)
            args.output.mkdir(parents=True, exist_ok=True)
            for mode in ["release", "rollback"]:
                path = args.output / f"{mode}-images.env"
                if path.exists():
                    raise ValueError("refusing to overwrite release locks")
                path.write_text("".join(f"{k}={v}\n" for k, v in result[mode].items()))
            args.output /= "image-locks.json"
    else:
        bundle = json.loads(args.bundle.read_text())
        # Reconstruct and validate both locks before allowing the existing atomic writer.
        expected = (bundle["rollback"] == POLICY["rollback"] and bundle.get("agent_init_required") is True
                    and bundle.get("schema") == 77 and bundle.get("migration_authorized") is False)
        release_name(bundle["source_commit"], bundle["release"]["CANVAS_IMAGE_TAG"])
        if not expected or set(bundle["release"]) != set(POLICY["rollback"]):
            raise ValueError("bundle lacks the fixed KIVAO r1 rollback or Agent init requirement")
        for role, key in ROLES.items():
            if not re.fullmatch(re.escape(f"ghcr.io/{POLICY['repository']}-{role}@") + r"sha256:[0-9a-f]{64}", bundle["release"][key]):
                raise ValueError("release lock contains an unapproved repository or mutable image")
        spec = importlib.util.spec_from_file_location("atomic_lock", ROOT / "scripts/kivao-apply-image-lock.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.apply_lock(args.env_file, bundle["rollback" if args.rollback else "release"], args.apply)
        print("Applied four image/version keys" if args.apply else "Validated paired locks; no files changed")
        return
    write_json(args.output, result)


if __name__ == "__main__":
    main()
