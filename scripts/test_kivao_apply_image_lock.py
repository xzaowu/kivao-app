import importlib.util
from pathlib import Path
import stat
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("lock", Path(__file__).with_name("kivao-apply-image-lock.py"))
lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lock)


class ImageLockTest(unittest.TestCase):
    def candidate(self):
        return {key: f"ghcr.io/xzaowu/kivao-app-{role}@sha256:" + "a" * 64 for key, role in lock.ROLES.items()} | {"CANVAS_IMAGE_TAG": lock.RELEASE}

    def text(self, values):
        return "".join(f"{k}={v}\n" for k, v in values.items())

    def test_rejects_shell_payloads_wrong_repositories_and_latest(self):
        for bad in ["$(touch /tmp/not-allowed)", "ghcr.io/xzaowu/other@sha256:" + "a" * 64,
                    "ghcr.io/xzaowu/kivao-app-web:latest"]:
            with self.assertRaises(ValueError):
                lock.read_lock(self.text(self.candidate() | {"CANVAS_WEB_IMAGE": bad}))

    def test_rejects_missing_duplicate_and_additional_entries(self):
        valid = self.text(self.candidate())
        for bad in ["\n".join(valid.splitlines()[:-1]), valid + "CANVAS_WEB_IMAGE=x\n", valid + "DATABASE_URL=forbidden\n"]:
            with self.assertRaises(ValueError):
                lock.read_lock(bad)

    def test_rollback_requires_the_original_audited_digests(self):
        self.assertEqual(lock.read_lock(self.text(lock.OLD), rollback=True), lock.OLD)
        with self.assertRaises(ValueError):
            lock.read_lock(self.text(self.candidate()), rollback=True)

    def test_preserves_unrelated_lines_dry_run_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            original = "# keep\nDATABASE_URL=synthetic-only\nCANVAS_WEB_IMAGE=old\nCUSTOM='literal $(text)'\n"
            env.write_text(original)
            env.chmod(0o640)
            lock.apply_lock(env, self.candidate())
            self.assertEqual(env.read_text(), original)
            lock.apply_lock(env, self.candidate(), apply=True)
            self.assertIn("DATABASE_URL=synthetic-only\n", env.read_text())
            self.assertIn("CUSTOM='literal $(text)'\n", env.read_text())
            self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o640)
            self.assertNotIn("CANVAS_WEB_IMAGE=old", env.read_text())

    def test_refuses_symlinks_and_duplicate_existing_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / ".env"
            original.write_text("CANVAS_WEB_IMAGE=a\nexport CANVAS_WEB_IMAGE=b\n")
            with self.assertRaises(ValueError):
                lock.apply_lock(original, self.candidate(), apply=True)
            link = Path(directory) / "link"
            link.symlink_to(original)
            with self.assertRaises(ValueError):
                lock.apply_lock(link, self.candidate(), apply=True)


if __name__ == "__main__":
    unittest.main()
