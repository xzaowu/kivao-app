import { DEFAULT_BRAND_NAME } from "@/lib/brand";

export function shouldShowSidebarCheckin(input: { creditsEnabled?: boolean; checkinBonusMicrocredits?: number | null; checkedInToday?: boolean }) {
    return Boolean(input.creditsEnabled && (input.checkinBonusMicrocredits || 0) > 0 && !input.checkedInToday);
}

export function sidebarCheckinTitle(brandName: string) {
    const name = brandName.trim() || DEFAULT_BRAND_NAME;
    return `${name}加油站`;
}
