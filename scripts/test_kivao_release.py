import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import io
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("kivao-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = "a" * 40


class ReleaseTest(unittest.TestCase):
    def approval(self):
        return {"decision": "IMAGE_PUBLISH_APPROVED", "approved_by": "xzaowu", "sha": SHA,
                "release": release.release_name(SHA), "ci_run_id": 123,
                "authorization_ref": "HD-TEST-ONLY", "approved_at": "2026-01-01T10:00:00+00:00",
                "expires_at": "2026-01-01T11:00:00+00:00"}

    def context(self):
        return {"GITHUB_REPOSITORY": "xzaowu/kivao-app", "GITHUB_EVENT_NAME": "push",
                "GITHUB_ACTOR": "xzaowu", "GITHUB_TRIGGERING_ACTOR": "xzaowu",
                "GITHUB_REF": "refs/tags/" + release.release_name(SHA), "GITHUB_SHA": SHA,
                "GITHUB_RUN_ATTEMPT": "1", "KIVAO_101_PUBLISH_ENABLED": "true"}

    def registry(self):
        return {"source_commit": SHA, "registry_write": False,
                "roles": {role: {"candidate_absent": True} for role in release.ROLES}}

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
        self.assertEqual(release.release_name(SHA), "kivao-1.0.5-aaaaaaaaaaaa-r1")
        for tag in ["latest", "v1.0.5", "kivao-1.0.0-eeccf718-r1", "kivao-1.0.4-aaaaaaaaaaaa-r1", "kivao-1.0.5-bbbbbbbbbbbb-r1", "kivao-1.0.5-aaaaaaaaaaaa-r0"]:
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

    def test_rollback_is_running_kivao_104_and_agent_init_required(self):
        locks = release.paired_locks(self.reports())
        expected = {
            "web": "sha256:daa8763de0b8d48a1a3f507f37b353442f08c442142b7bcf8edb9714e2a47c1d",
            "backend": "sha256:7edf2c6871852896ebb7f8377ff663ac7f91925bd0469cad9ccd9908adae23e1",
            "agent": "sha256:833cf05370c098030a562942b9b3a10b26f0e188e89cb399f63c9b2729be0727",
        }
        self.assertEqual(locks["rollback"]["CANVAS_IMAGE_TAG"], "kivao-1.0.4-aae0d4aa4590-r1")
        self.assertTrue(locks["agent_init_required"])
        # Schema 79 needs a migration, but the rehearsal and authorization are still outstanding.
        self.assertEqual(locks["schema"], 79)
        self.assertTrue(release.POLICY["schema_changed"])
        self.assertFalse(locks["migration_authorized"])
        self.assertIs(locks["migration_authorized"], release.POLICY["migration_authorized"])
        for role, key in release.ROLES.items():
            self.assertEqual(locks["rollback"][key], f"ghcr.io/xzaowu/kivao-app-{role}@{expected[role]}")
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

    def test_only_exact_approved_workbench_files_can_change(self):
        for path, approved in release.POLICY["approved_protected_changes"].items():
            self.assertTrue(release.approved_protected_delta(path, approved))
            for extra in ["web/src/pages/plugins/plugin-category.ts", "backend/go.mod", "backend/internal/handler/model_catalog.go", "backend/internal/app/user_groups.go"]:
                self.assertFalse(release.approved_protected_delta(path, approved + [extra]))
        self.assertFalse(release.approved_protected_delta("backend", ["backend/internal/handler/model_catalog.go"]))
        self.assertFalse(release.approved_protected_delta("Dockerfile", ["Dockerfile"]))
        self.assertFalse(release.approved_protected_delta("backend", []))

    def test_ci_requires_same_sha_quality_and_three_build_only_images(self):
        report = {"source_commit": SHA, "status": "PASS", "quality_result": "success", "registry_publish": False,
                  "images": {r["role"]: r for r in self.reports(False)}, "registry_preflight": self.registry()}
        self.assertTrue(release.check_ci(report, SHA)["verified_ci"])
        for field, value in [("quality_result", "failure"), ("source_commit", "b" * 40), ("registry_publish", True), ("images", {}), ("registry_preflight", {})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.check_ci(report | {field: value}, SHA)

    def test_authorization_is_exact_owner_first_attempt_and_short_lived(self):
        now = datetime(2026, 1, 1, 10, 30, tzinfo=timezone.utc)
        def check(approval=None, context=None):
            return release.authorize_publish(SHA, release.release_name(SHA), approval or self.approval(), context or self.context(), now)
        self.assertFalse(check()["independent_review"])
        for key in self.context():
            with self.subTest(context=key), self.assertRaises(ValueError):
                check(context=self.context() | {key: "wrong"})
        for key, value in [("sha", "b" * 40), ("release", "latest"), ("approved_by", "someone"),
                           ("decision", "VISUAL_PASS"), ("ci_run_id", True), ("ci_run_id", 0),
                           ("authorization_ref", ""), ("approved_at", "2026-01-01T10:31:00+00:00"),
                           ("expires_at", "2026-01-01T10:30:00+00:00"),
                           ("expires_at", "2026-01-03T10:30:00+00:00"), ("expires_at", "2026-01-01T11:00:00")]:
            with self.subTest(approval=key, value=value), self.assertRaises(ValueError):
                check(approval=self.approval() | {key: value})
        with self.assertRaises(ValueError):
            release.authorize_publish(SHA, release.release_name(SHA), None, self.context(), now)

    def test_ci_run_is_bound_to_approved_run_workflow_branch_and_sha(self):
        run = {"id": 123, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "success",
               "path": ".github/workflows/kivao-1.0.1-ci.yml", "head_branch": "release/kivao-1.0.5"}
        self.assertTrue(release.check_ci_run(run, SHA, 123)["verified_ci_run"])
        for key in run:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.check_ci_run(run | {key: "wrong"}, SHA, 123)

    def test_registry_requires_authenticated_anchor_and_only_manifest_unknown_is_absent(self):
        def answer(url, authorization):
            if "/token?" in url:
                return 200, {}, {"token": "fixture-bearer"}
            for role, key in release.ROLES.items():
                anchor = release.POLICY["rollback"][key].split("@", 1)[1]
                if url.endswith(anchor):
                    return 200, {"Docker-Content-Digest": anchor}, {}
            return 404, {}, {"errors": [{"code": "MANIFEST_UNKNOWN"}]}
        with patch.object(release, "registry_json", side_effect=answer) as request:
            result = release.registry_preflight(SHA, None, "xzaowu", "fixture-only")
        self.assertEqual(request.call_count, 9)
        self.assertEqual(set(result["roles"]), set(release.ROLES))
        self.assertFalse(result["registry_write"])
        for status, body in [(200, {}), (401, {}), (403, {}), (429, {}), (500, {}), (404, {}),
                             (404, {"errors": [{"code": "NAME_UNKNOWN"}]})]:
            def uncertain(url, authorization):
                if url.endswith(release.release_name(SHA)):return status, {}, body
                return answer(url, authorization)
            with self.subTest(status=status, body=body), patch.object(release, "registry_json", side_effect=uncertain), self.assertRaises(ValueError):
                release.registry_preflight(SHA, None, "xzaowu", "fixture-only")
        with patch.object(release, "registry_json", return_value=(200, {}, {"token": "fixture-bearer"})), self.assertRaises(ValueError):
            release.registry_preflight(SHA, None, "xzaowu", "fixture-only")

    def test_registry_auth_errors_are_redacted_and_redirects_refused(self):
        with patch.object(release.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError("https://ghcr.io/token", 403, "forbidden", {}, io.BytesIO(b"fixture-secret"))
            with self.assertRaises(ValueError) as caught:
                release.registry_json("https://ghcr.io/token", "fixture-secret")
            self.assertNotIn("fixture-secret", str(caught.exception))
        self.assertIsNone(release.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other.invalid"))

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
        self.assertIn("kivao-1.0.5-*", publish)
        self.assertIn("check-ci", publish)
        self.assertIn('gh run download "$APPROVED_CI_RUN" --repo "$GITHUB_REPOSITORY"', publish)
        self.assertIn("KIVAO_101_PUBLISH_APPROVAL", publish)
        self.assertNotIn("environment:", publish)
        self.assertIn("needs: [authorize, registry]", publish)
        self.assertIn("packages: read", ci)


if __name__ == "__main__":
    unittest.main()
