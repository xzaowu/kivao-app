import { expect, test } from "bun:test";
import { groupReferenceSamples, referenceSampleTimes, referenceTime } from "@/pages/ecommerce/product-video-reference-sampling";

test("短片或一小时参考片均只抽取有限数量的真实时间点，避开结尾", () => {
    for (const ms of [1, 150, 7_240, 15_000, 3_600_000]) {
        const times = referenceSampleTimes(ms);
        expect(times.length).toBeGreaterThan(0);
        expect(times.length).toBeLessThanOrEqual(25);
        expect(times.at(-1)!).toBeLessThan(ms);
        expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    }
});

test("画面变化产生连续分段和真实缩略帧，相邻闪动不会生成极短片段", () => {
    const samples = referenceSampleTimes(9000).map((timeMs, i) => ({ timeMs, thumbnail: `frame-${i}`, change: [6, 12].includes(i) ? 0.7 : 0.01 }));
    const result = groupReferenceSamples(samples, 9000);
    expect(result.byChange).toBe(true);
    expect(result.clips.map((c) => [c.startMs, c.endMs])).toEqual([
        [0, 3000],
        [3000, 6000],
        [6000, 9000],
    ]);
    for (const clip of result.clips) {
        expect(samples).toContain(clip.sample);
        expect(clip.sample.timeMs).toBeGreaterThanOrEqual(clip.startMs);
        expect(clip.sample.timeMs).toBeLessThan(clip.endMs);
    }
    const noisy = referenceSampleTimes(6000).map((timeMs, i) => ({ timeMs, thumbnail: String(i), change: 0.9 }));
    const groups = groupReferenceSamples(noisy, 6000).clips;
    expect(groups.length).toBeLessThanOrEqual(6);
    expect(groups.every((group) => group.endMs - group.startMs >= 400)).toBe(true);
});

test("无明显变化时按参考片实际时长预览，不虚构切镜、不借用目标 15 秒", () => {
    const samples = referenceSampleTimes(6000).map((timeMs) => ({ timeMs, thumbnail: "same", change: 0 }));
    const result = groupReferenceSamples(samples, 6000);
    expect(result.byChange).toBe(false);
    expect(result.clips.map((clip) => clip.endMs)).toEqual([2000, 4000, 6000]);
    expect(referenceTime(62500)).toBe("1:02.5");
    expect(() => groupReferenceSamples([], 6000)).toThrow();
});
