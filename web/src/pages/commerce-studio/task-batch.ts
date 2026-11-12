import type { EcommercePlanImage, EcommerceProject } from "@/services/api/commerce-studio";

// A lost HTTP receipt must not create another paid image when the user retries.
// The server checks the full request fingerprint against this stable identity.
export async function commerceImageBatch(project: EcommerceProject, image: Pick<EcommercePlanImage, "id">) {
    if (!project.id || !image.id) throw new Error("图片任务缺少项目或方案标识");
    const identity = JSON.stringify(["kivao-commerce-image-v1", project.id, project.activeRoundId || "active", image.id]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { id, index: 0, count: 1 };
}
