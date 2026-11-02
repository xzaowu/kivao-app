import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("kivao-build-baseline.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ImageIdentityTest(unittest.TestCase):
    def image(self):
        return {"Id": "sha256:" + "a" * 64, "Os": "linux", "Architecture": "amd64", "Config": {"Labels": {
            "org.opencontainers.image.source": "https://github.com/xzaowu/kivao-app",
            "org.opencontainers.image.revision": release.SOURCE,
            "org.opencontainers.image.version": "v1.7.3.3", "io.kivao.release": release.RELEASE,
        }}}

    def test_accepts_local_identity_without_claiming_a_registry_digest(self):
        self.assertEqual(release.validate_image(self.image(), "web", "v1.7.3.3")["repo_digests"], [])

    def test_rejects_other_architecture(self):
        image = self.image()
        image["Architecture"] = "arm64"
        with self.assertRaises(ValueError):
            release.validate_image(image, "backend", "v1.7.3.3")

    def test_rejects_wrong_source_or_version(self):
        for field in ["org.opencontainers.image.source", "org.opencontainers.image.revision",
                      "org.opencontainers.image.version", "io.kivao.release"]:
            with self.subTest(field=field):
                image = self.image()
                image["Config"]["Labels"][field] = "wrong"
                with self.assertRaises(ValueError):
                    release.validate_image(image, "web", "v1.7.3.3")

    def test_rejects_missing_labels_and_malformed_identity(self):
        for change in [{"Config": {"Labels": None}}, {"Id": "latest"}]:
            image = self.image() | change
            with self.assertRaises(ValueError):
                release.validate_image(image, "agent", "v1.7.3.3")


if __name__ == "__main__":
    unittest.main()
