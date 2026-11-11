import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDirectories } from "./package-directories.mjs";

test("packaging selects the canonical source once and retains custom plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "kivao-packages-"));
  const add = async (name, id) => {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "manifest.json"), JSON.stringify({ id }));
  };
  try {
    await add("protocol", "protocol");
    await add("protocol-source-copy", "protocol");
    await add("custom-source", "kivao-custom");
    await mkdir(join(root, "notes"));
    assert.deepEqual(await packageDirectories(root), ["custom-source", "protocol"]);
    await add("another-copy", "kivao-custom");
    await assert.rejects(packageDirectories(root), /multiple source directories/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("invalid manifests fail packaging instead of silently disappearing", async () => {
  const root = await mkdtemp(join(tmpdir(), "kivao-packages-"));
  try {
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken", "manifest.json"), "{");
    await assert.rejects(packageDirectories(root), SyntaxError);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("synced video manifests equal the already tracked archives", async () => {
  // Read only: do not rebuild packages or touch locally configured custom plugins.
  const { execFileSync } = await import("node:child_process");
  for (const name of ["dashscope-wan3-video", "newapi-video-generations-v1"]) {
    const source = JSON.parse(await readFile(new URL(`./${name}/manifest.json`, import.meta.url), "utf8"));
    const archive = execFileSync("python3", ["-c", "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('manifest.json'))", new URL(`./${name}.yingce-plugin`, import.meta.url).pathname]);
    assert.deepEqual(source, JSON.parse(archive.toString()));
  }
  const ids = await packageDirectories(new URL(".", import.meta.url).pathname);
  assert.ok(ids.includes("official-payment-epay"));
});
