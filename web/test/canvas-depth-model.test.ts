import { describe, expect, test } from "bun:test";

import { applyDepthRange, depthInputSize, depthRangeFromSamples, normalizeDepthInput, resampleDepth } from "../src/lib/canvas/depth/depth-model";

describe("depthInputSize", () => {
    test("keeps aspect ratio on the long edge and aligns both sides to 14", () => {
        expect(depthInputSize(1376, 768)).toEqual({ width: 518, height: 294 });
        expect(depthInputSize(768, 1376)).toEqual({ width: 294, height: 518 });
        expect(depthInputSize(1000, 1000)).toEqual({ width: 518, height: 518 });
    });

    test("rejects invalid dimensions", () => {
        expect(() => depthInputSize(0, 100)).toThrow();
        expect(() => depthInputSize(Number.NaN, 100)).toThrow();
    });
});

describe("normalizeDepthInput", () => {
    test("converts RGBA to normalized CHW planes", () => {
        // 两个像素：纯红、纯绿。CHW 布局下前 2 个是 R 平面，接着是 G 平面、B 平面。
        const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
        const tensor = normalizeDepthInput(pixels, 2, 1);
        expect(tensor.length).toBe(6);
        expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
        expect(tensor[1]).toBeCloseTo((0 - 0.485) / 0.229, 5);
        expect(tensor[2]).toBeCloseTo((0 - 0.456) / 0.224, 5);
        expect(tensor[3]).toBeCloseTo((1 - 0.456) / 0.224, 5);
        expect(tensor[4]).toBeCloseTo((0 - 0.406) / 0.225, 5);
        expect(tensor[5]).toBeCloseTo((0 - 0.406) / 0.225, 5);
    });

    test("rejects a buffer whose size does not match the dimensions", () => {
        expect(() => normalizeDepthInput(new Uint8ClampedArray(4), 2, 2)).toThrow();
    });
});

describe("depthRangeFromSamples", () => {
    test("derives a stable range from percentile points", () => {
        const samples = [Array.from({ length: 100 }, (_, index) => index)];
        const range = depthRangeFromSamples(samples);
        expect(range.near).toBeLessThan(range.far);
        expect(range.near).toBeGreaterThanOrEqual(0);
        expect(range.far).toBeLessThanOrEqual(99);
    });

    test("ignores non-finite values and guarantees a non-zero span", () => {
        const range = depthRangeFromSamples([[5, 5, 5, Number.NaN, Number.POSITIVE_INFINITY]]);
        expect(range.far).toBeGreaterThan(range.near);
    });

    test("throws when there is nothing to sample", () => {
        expect(() => depthRangeFromSamples([])).toThrow();
        expect(() => depthRangeFromSamples([[Number.NaN]])).toThrow();
    });
});

describe("applyDepthRange", () => {
    test("maps near to white and far to black", () => {
        const output = applyDepthRange([0, 5, 10], 0, 10);
        expect(output[0]).toBe(0);
        expect(output[1]).toBe(128);
        expect(output[2]).toBe(255);
    });

    test("clamps out-of-range depth instead of wrapping", () => {
        const output = applyDepthRange([-5, 20], 0, 10);
        expect(output[0]).toBe(0);
        expect(output[1]).toBe(255);
    });

    test("rejects an inverted range", () => {
        expect(() => applyDepthRange([1], 10, 5)).toThrow();
    });
});

describe("resampleDepth", () => {
    test("averages blocks when downscaling", () => {
        const source = [0, 2, 4, 6];
        const output = resampleDepth(source, 2, 2, 1, 1);
        expect(output[0]).toBe(3);
    });

    test("replicates when upscaling a single pixel", () => {
        const output = resampleDepth([8], 1, 1, 2, 2);
        expect(Array.from(output)).toEqual([8, 8, 8, 8]);
    });

    test("preserves the value range", () => {
        const output = resampleDepth([0, 1, 2, 3, 4, 5, 6, 7, 8], 3, 3, 2, 2);
        for (const value of output) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(8);
        }
    });
});
