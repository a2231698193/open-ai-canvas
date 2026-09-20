import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { inferVideoGenerationMode, videoGenerationModeFromMetadata, videoModeImageRoles, videoModeOperation } from "./video-generation-mode.ts";

test("四种视频产品模式映射到稳定的后端操作和图片角色", () => {
    assert.equal(videoModeOperation("text"), "text_to_video");
    assert.equal(videoModeOperation("image"), "image_to_video");
    assert.equal(videoModeOperation("keyframes"), "image_to_video");
    assert.equal(videoModeOperation("reference"), "reference_to_video");
    assert.deepEqual(videoModeImageRoles("text"), []);
    assert.deepEqual(videoModeImageRoles("image"), ["first_frame"]);
    assert.deepEqual(videoModeImageRoles("keyframes"), ["first_frame", "last_frame"]);
    assert.deepEqual(videoModeImageRoles("reference"), ["reference_image"]);
});

test("显式视频模式优先于历史 operation 和帧字段", () => {
    assert.equal(videoGenerationModeFromMetadata({ videoMode: "text", videoEditOperation: "reference_to_video", videoEndFrameNodeId: "end" }), "text");
    assert.equal(videoGenerationModeFromMetadata({ videoEndFrameNodeId: "end" }), "keyframes");
    assert.equal(videoGenerationModeFromMetadata({ videoEditOperation: "image_to_video" }), "image");
    assert.equal(videoGenerationModeFromMetadata({ videoEditOperation: "reference_to_video" }), "reference");
});

test("没有显式模式的历史输入仍可按媒体数量推导", () => {
    const input = (imageCount: number, videoCount = 0, audioCount = 0) => ({ textCount: 1, imageCount, videoCount, audioCount, characterCount: 0 });
    assert.equal(inferVideoGenerationMode(input(0)), "text");
    assert.equal(inferVideoGenerationMode(input(1)), "image");
    assert.equal(inferVideoGenerationMode(input(2)), "keyframes");
    assert.equal(inferVideoGenerationMode(input(3)), "reference");
    assert.equal(inferVideoGenerationMode(input(0, 1)), "reference");
    assert.equal(videoGenerationModeFromMetadata(undefined, input(2)), "keyframes");
});
