import { http } from "./request";
import type { GenerationTask } from "./task-center";

export type EcommerceReference = { resourceId: string; role: "primary" | "detail" | "style" };
export type EcommerceDraft = { productName: string; description: string; platform: string; language: string; imageType: "main" | "detail"; count: number; references: EcommerceReference[] };
export type EcommerceDirection = { id: string; name: string; description: string };
export type EcommerceImage = { id: string; title: string; copy: string; prompt: string; taskId?: string; previousTaskIds?: string[] };
export type EcommerceState = {
    visionTaskId?: string;
    visionApplied?: string;
    directions?: { productSummary: string; confirmedFacts: string[]; uncertainFacts: string[]; directions: EcommerceDirection[] };
    selectedDirectionId?: string;
    planningTaskId?: string;
    planningApplied?: string;
    plan?: { summary: string; images: EcommerceImage[] };
};
export type EcommerceProject = { id: string; name: string; status: string; revision: number; activeRoundId: string; createdAt: string; updatedAt: string; draft: EcommerceDraft; state: EcommerceState; tasks: GenerationTask[] };
export type EcommerceRound = { id: string; projectId: string; ordinal: number; createdAt: string; draft: EcommerceDraft; state: EcommerceState; tasks: GenerationTask[] };
export type EcommerceModelChoice = { logicalModelId?: string; channelId?: string; model?: string };
export type EcommerceSettings = { vision: EcommerceModelChoice; planning: EcommerceModelChoice };
export type EcommerceQuote = { quoteHash: string; amountMicrocredits: number; estimated: boolean; billingMode: string; expiresAt: string };
export type EcommerceTaskRequest = {
    revision: number;
    requestId: string;
    stage: "vision" | "planning" | "image";
    imageId?: string;
    model?: EcommerceModelChoice;
    size?: string;
    quality?: string;
    imageResolution?: string;
    quoteHash?: string;
    maxCharge: number;
    quoteExpiresAt?: string;
};

const projectPath = (id: string) => `/ecommerce/projects/${encodeURIComponent(id)}`;
export const ecommerceStatus = (signal?: AbortSignal) => http.get<{ configured: boolean; enabled: boolean }>("/ecommerce/status", { signal });
export const listEcommerceProjects = (page = 1, signal?: AbortSignal) => http.get<{ projects: EcommerceProject[] }>("/ecommerce/projects", { params: { page }, signal });
export const getEcommerceProject = (id: string, signal?: AbortSignal) => http.get<EcommerceProject>(projectPath(id), { signal });
export const createEcommerceProject = (id: string, draft: EcommerceDraft) => http.post<EcommerceProject>("/ecommerce/projects", { id, draft });
export const saveEcommerceDraft = (id: string, revision: number, draft: EcommerceDraft, newRound: boolean, clientKey: string) => http.put<EcommerceProject>(`${projectPath(id)}/draft`, { revision, draft, newRound, clientKey });
export const archiveEcommerceProject = (id: string, revision: number) => http.post(`${projectPath(id)}/archive`, { revision });
export const listEcommerceRounds = (id: string, page = 1) => http.get<{ rounds: EcommerceRound[] }>(`${projectPath(id)}/rounds`, { params: { page } });
export const quoteEcommerceTask = (id: string, request: EcommerceTaskRequest) => http.post<EcommerceQuote>(`${projectPath(id)}/quote`, request);
export async function submitEcommerceTask(id: string, request: EcommerceTaskRequest) {
    const task = await http.post<GenerationTask>(`${projectPath(id)}/tasks`, request);
    window.dispatchEvent(new CustomEvent("wallet:updated"));
    return task;
}
export const ecommerceReceipt = (id: string, requestId: string) => http.get<{ task: GenerationTask | null }>(`${projectPath(id)}/receipts/${encodeURIComponent(requestId)}`);
export const acceptEcommerceStage = (id: string, revision: number, taskId: string, directionId?: string) => http.post<EcommerceProject>(`${projectPath(id)}/accept`, { revision, taskId, directionId });
export const editEcommerceImage = (id: string, revision: number, image: EcommerceImage) => http.patch<EcommerceProject>(`${projectPath(id)}/images/${encodeURIComponent(image.id)}`, { revision, title: image.title, copy: image.copy, prompt: image.prompt });
export const getEcommerceSettings = () => http.get<EcommerceSettings>("/admin/ecommerce/settings");
export const saveEcommerceSettings = (settings: EcommerceSettings) => http.put("/admin/ecommerce/settings", settings);
