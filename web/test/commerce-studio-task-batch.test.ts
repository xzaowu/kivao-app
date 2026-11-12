import { expect, test } from "bun:test";
import { commerceImageBatch } from "@/pages/commerce-studio/task-batch";
import type { EcommerceProject } from "@/services/api/commerce-studio";

test("an image keeps one batch identity across lost receipts and reloads", async () => {
    const project = { id: "project-a", activeRoundId: "round-a" } as EcommerceProject;
    const first = await commerceImageBatch(project, { id: "image-a" });
    expect(first).toEqual(await commerceImageBatch({ ...project }, { id: "image-a" }));
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toEqual(await commerceImageBatch(project, { id: "image-b" }));
    expect(first).not.toEqual(await commerceImageBatch({ ...project, activeRoundId: "round-b" }, { id: "image-a" }));
    expect(first).not.toEqual(await commerceImageBatch({ ...project, id: "project-b" }, { id: "image-a" }));
    await expect(commerceImageBatch({ id: "" } as EcommerceProject, { id: "image-a" })).rejects.toThrow();
});
