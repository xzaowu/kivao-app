import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = (name) => Bun.YAML.parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));

function allowed(condition, repository, ref, verified) {
    // Evaluate only the checked-in job expressions, without running workflow steps.
    const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
    const needs = {
        reuse: { outputs: { verified } },
        checks: { result: verified === "true" ? "skipped" : "success" },
        prepare: { result: "success" },
        build: { result: "success" },
        publish: { result: "success" },
    };
    return Function(
        "github",
        "needs",
        "cancelled",
        "startsWith",
        `return (${expression});`,
    )(
        { repository, ref },
        needs,
        () => false,
        (value, prefix) => value.startsWith(prefix),
    );
}

test("KIVAO and other forks cannot run upstream publishing jobs, even when dependencies succeed", () => {
    const release = workflow("publish-images.yml");
    for (const repository of ["xzaowu/kivao-app", "another/fork"]) {
        for (const ref of ["refs/heads/main", "refs/tags/v1.9.0", "refs/tags/kivao-2.0.0-example-r1"]) {
            for (const verified of ["true", "false"]) {
                for (const job of Object.values(release.jobs)) {
                    expect(typeof job.if).toBe("string");
                    expect(allowed(job.if, repository, ref, verified)).toBe(false);
                }
            }
        }
    }
});

test("the repository boundary preserves the official workflow's successful release path", () => {
    const { jobs } = workflow("publish-images.yml");
    for (const [id, job] of Object.entries(jobs)) {
        expect(allowed(job.if, "ddcat-ai/open-ai-canvas", "refs/tags/v1.9.0", "false")).toBe(true);
        if (id === "checks") expect(allowed(job.if, "ddcat-ai/open-ai-canvas", "refs/tags/v1.9.0", "true")).toBe(false);
    }
});

test("pull requests retain independent read-only quality checks", () => {
    const quality = workflow("quality.yml");
    expect(Object.hasOwn(quality.on, "pull_request")).toBe(true);
    expect(Object.hasOwn(quality.on, "workflow_call")).toBe(true);
    expect(quality.permissions.contents).toBe("read");
    expect(Object.values(quality.jobs).every((job) => job.permissions?.packages !== "write" && job.permissions?.contents !== "write")).toBe(true);
});
