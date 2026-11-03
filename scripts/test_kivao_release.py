import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("kivao-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = "a" * 40


class ReleaseTest(unittest.TestCase):
    def plan(self):
        return {"source_commit": SHA, "application_version": "v1.7.3.3", "release": release.release_name(SHA)}

    def image(self):
        return {"Id": "sha256:" + "b" * 64, "Os": "linux", "Architecture": "amd64", "Config": {"Labels": {
            "org.opencontainers.image.source": "https://github.com/xzaowu/kivao-app",
            "org.opencontainers.image.revision": SHA, "org.opencontainers.image.version": "v1.7.3.3",
            "io.kivao.release": release.release_name(SHA),
        }}}

    def reports(self, published=True):
        return [{**self.plan(), **release.validate_image(self.image(), self.plan()), "role": role,
                 "build_args": {"BUILD_COMMIT": SHA}, "source_scope_verified": True, "embedded_commit_verified": True,
                 "registry_publish": published, "registry_digest": "sha256:" + str(i) * 64 if published else None}
                for i, role in enumerate(release.ROLES, 1)]

    def test_tag_is_bound_to_exact_source_and_never_latest_or_r1(self):
        self.assertEqual(release.release_name(SHA), "kivao-1.0.1-aaaaaaaaaaaa-r1")
        for tag in ["latest", "v1.0.1", "kivao-1.0.0-eeccf718-r1", "kivao-1.0.1-bbbbbbbbbbbb-r1", "kivao-1.0.1-aaaaaaaaaaaa-r0"]:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.release_name(SHA, tag)

    def test_rejects_wrong_architecture_source_version_or_release(self):
        for field in ["org.opencontainers.image.source", "org.opencontainers.image.revision", "org.opencontainers.image.version", "io.kivao.release"]:
            value = self.image()
            value["Config"]["Labels"][field] = "wrong"
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.validate_image(value, self.plan())
        with self.assertRaises(ValueError):
            release.validate_image(self.image() | {"Architecture": "arm64"}, self.plan())

    def test_local_identity_is_not_a_registry_digest(self):
        with self.assertRaises(ValueError):
            release.paired_locks(self.reports(published=False))

    def test_backend_verifies_daemon_commit_and_records_migration_hashes_without_running_them(self):
        commands = []
        def capture(args):
            commands.append(args)
            if "inspect" in args:
                return json.dumps([self.image()])
            if "sha256sum" in args[-1]:
                return "c" * 64 + "  /usr/local/bin/migration-cli"
            return ""
        with patch.object(release, "source_report", return_value=self.plan()), patch.object(release, "capture", side_effect=capture):
            result = release.verify_image(SHA, "backend", "candidate")
        grep_commands = [command[-1] for command in commands if "grep" in command[-1]]
        self.assertEqual(len(grep_commands), 1)
        self.assertTrue(grep_commands[0].endswith("/usr/local/bin/yingce-backend"))
        self.assertEqual(result["embedded_commit_scope"], "yingce-backend")
        self.assertEqual(len(result["migration_binaries"]), 2)
        self.assertTrue(all(v["execution"] == "NOT_RUN" and not v["embedded_commit_verified"] for v in result["migration_binaries"].values()))

    def test_rollback_is_current_kivao_r1_and_agent_init_required(self):
        locks = release.paired_locks(self.reports())
        manifest = json.loads((release.ROOT / "docs/operations/kivao-production-r1.json").read_text())
        self.assertTrue(locks["agent_init_required"])
        self.assertFalse(locks["migration_authorized"])
        for role, key in release.ROLES.items():
            self.assertEqual(locks["rollback"][key], manifest["images"][role]["reference"])
            self.assertNotIn("ddcat-ai", locks["rollback"][key])

    def test_rejects_missing_roles_mixed_sources_or_unverified_image(self):
        for change in ["missing", "source", "unverified", "digest"]:
            reports = self.reports()
            if change == "missing": reports.pop()
            elif change == "source": reports[1]["source_commit"] = "b" * 40
            elif change == "unverified": reports[1]["embedded_commit_verified"] = False
            else: reports[1]["registry_digest"] = "latest"
            with self.subTest(change=change), self.assertRaises(ValueError):
                release.paired_locks(reports)

    def test_ci_requires_same_sha_quality_and_three_build_only_images(self):
        report = {"source_commit": SHA, "status": "PASS", "quality_result": "success", "registry_publish": False,
                  "images": {r["role"]: r for r in self.reports(False)}}
        self.assertTrue(release.check_ci(report, SHA)["verified_ci"])
        for field, value in [("quality_result", "failure"), ("source_commit", "b" * 40), ("registry_publish", True), ("images", {})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.check_ci(report | {field: value}, SHA)

    def test_dry_run_and_atomic_apply_preserve_other_environment_bytes(self):
        bundle = release.paired_locks(self.reports())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            env = path / ".env"
            original = "UNRELATED_SETTING=fixture-only\nCANVAS_IMAGE_TAG=previous\n"
            env.write_text(original)
            env.chmod(0o600)
            lock = path / "locks.json"
            lock.write_text(json.dumps(bundle))
            command = [sys.executable, str(release.ROOT / "scripts/kivao-release.py"), "apply-lock", "--bundle", str(lock), "--env-file", str(env)]
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(env.read_text(), original)
            subprocess.run(command + ["--apply"], check=True, capture_output=True)
            self.assertIn("UNRELATED_SETTING=fixture-only\n", env.read_text())
            self.assertIn(bundle["release"]["CANVAS_WEB_IMAGE"], env.read_text())
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            subprocess.run(command + ["--rollback", "--apply"], check=True, capture_output=True)
            self.assertIn(release.POLICY["rollback"]["CANVAS_WEB_IMAGE"], env.read_text())
            for mutation in ["rollback", "image", "init"]:
                bad = copy.deepcopy(bundle)
                if mutation == "rollback": bad["rollback"]["CANVAS_IMAGE_TAG"] = "official"
                elif mutation == "image": bad["release"]["CANVAS_WEB_IMAGE"] = "ghcrxio/xzaowu/kivao-app-web@sha256:" + "a" * 64
                else: bad["agent_init_required"] = False
                lock.write_text(json.dumps(bad))
                self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_build_only_ci_and_disabled_tag_only_publish(self):
        ci = (release.ROOT / ".github/workflows/kivao-1.0.1-ci.yml").read_text()
        publish = (release.ROOT / ".github/workflows/kivao-1.0.1-publish.yml").read_text()
        self.assertIn("packages: none", ci)
        self.assertNotIn("push: true", ci)
        self.assertNotIn("docker/login-action", ci)
        self.assertIn("uses: ./.github/workflows/quality.yml", ci)
        self.assertNotIn("workflow_dispatch:", publish)
        self.assertNotIn("branches:", publish)
        self.assertIn("KIVAO_101_PUBLISH_ENABLED", publish)
        self.assertIn("kivao-1.0.1-*", publish)
        self.assertIn("check-ci", publish)


if __name__ == "__main__":
    unittest.main()
