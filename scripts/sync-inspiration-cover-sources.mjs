import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const sources = {};
const hosts = new Set([
  "media.goodcase.ai",
  "goodcase.ai",
  "cms-assets.youmind.com",
  "www.haohaoxue.com",
]);
for (const source of ["seedance", "haohaoxue", "youmind"]) {
  const catalog = JSON.parse(
    await readFile(
      new URL(`web/public/inspirations/${source}.json`, root),
      "utf8",
    ),
  );
  for (const entry of catalog.entries) {
    if (!entry.image?.startsWith("https://")) continue;
    const url = new URL(entry.image);
    if (
      !entry.id?.startsWith(`${source}:`) ||
      !hosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      throw new Error(`Unsupported cover source in ${source}: ${entry.id}`);
    }
    if (sources[entry.id] && sources[entry.id] !== entry.image)
      throw new Error(`Duplicate cover ID: ${entry.id}`);
    sources[entry.id] = entry.image;
  }
}
const output = new URL(
  "backend/internal/inspirations/cover_sources.json",
  root,
);
const encoded =
  JSON.stringify(
    Object.fromEntries(
      Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    null,
    2,
  ) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== encoded)
    throw new Error(
      "Cover registry is stale; run bun scripts/sync-inspiration-cover-sources.mjs",
    );
} else {
  await writeFile(output, encoded);
}
console.log(
  `${Object.keys(sources).length} registered inspiration covers: ${fileURLToPath(output)}`,
);
