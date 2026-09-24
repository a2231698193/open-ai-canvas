import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { clampVideoGenerationMode, inferVideoGenerationMode, supportedVideoGenerationModes, videoFrameSelectionPatch, videoGenerationModeFromMetadata, videoModeImageRoles, videoModeOperation } from "./video-generation-mode.ts";

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

test("先选首帧不会把首尾帧模式收成图生视频", () => {
    const twoImages = { textCount: 0, imageCount: 2, videoCount: 0, audioCount: 0, characterCount: 0 };
    // 回归：以前这里会返回 image，用户在面板上点完首帧，尾帧下拉就消失了。
    assert.equal(videoGenerationModeFromMetadata({ videoStartFrameNodeId: "start" }, twoImages), "keyframes");
    // 只连一张图时仍然是图生视频。
    assert.equal(videoGenerationModeFromMetadata({ videoStartFrameNodeId: "start" }, { ...twoImages, imageCount: 1 }), "image");
    // 没有输入摘要时保持旧行为。
    assert.equal(videoGenerationModeFromMetadata({ videoStartFrameNodeId: "start" }), "image");
});

test("选帧时把当前模式一起固定下来", () => {
    assert.deepEqual(videoFrameSelectionPatch("keyframes", "videoStartFrameNodeId", "a"), {
        videoMode: "keyframes",
        videoEditOperation: "image_to_video",
        videoStartFrameNodeId: "a",
    });
    assert.deepEqual(videoFrameSelectionPatch("image", "videoEndFrameNodeId", undefined), {
        videoMode: "image",
        videoEditOperation: "image_to_video",
        videoEndFrameNodeId: undefined,
    });
    // 固定下来的模式不会再被帧字段推导翻掉。
    assert.equal(videoGenerationModeFromMetadata(videoFrameSelectionPatch("keyframes", "videoStartFrameNodeId", "a"), { ...{ textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } }), "keyframes");
});

test("模式下拉按能力过滤：只配首帧的模型不再列出首尾帧与全能参考", () => {
    // APIMart Kling 3.0 Turbo 的画像：只支持 text/image_to_video、只有 first_frame、仅 1 张图。
    const kling = { operations: ["text_to_video", "image_to_video"], references: { imageRoles: ["first_frame"], maxImages: 1 } };
    assert.deepEqual(supportedVideoGenerationModes(kling), ["text", "image"]);
    // 声明了 reference_image 角色就允许全能参考；只给参考视频/音频槽位同样允许。
    assert.deepEqual(supportedVideoGenerationModes({ operations: ["reference_to_video"], references: { imageRoles: ["reference_image"], maxVideos: 0, maxAudios: 0 } }), ["reference"]);
    assert.deepEqual(supportedVideoGenerationModes({ operations: ["reference_to_video"], references: { imageRoles: [], maxVideos: 3 } }), ["reference"]);
    // 既没有参考图角色、也没有参考视频/音频槽位时不允许。
    assert.deepEqual(supportedVideoGenerationModes({ operations: ["reference_to_video"], references: { imageRoles: [], maxVideos: 0, maxAudios: 0 } }), []);
});

test("模式下拉保留能力齐全的模型，以及能力缺失时的全量", () => {
    const full = { operations: ["text_to_video", "image_to_video", "reference_to_video"], references: { imageRoles: ["first_frame", "last_frame", "reference_image"] } };
    assert.deepEqual(supportedVideoGenerationModes(full), ["text", "image", "keyframes", "reference"]);
    // 没有首帧角色时不能给出图片类模式。
    assert.deepEqual(supportedVideoGenerationModes({ operations: ["image_to_video"], references: { imageRoles: ["last_frame"] } }), []);
    // 模型未解析时保留全部，避免把可选项清空。
    assert.deepEqual(supportedVideoGenerationModes(undefined), ["text", "image", "keyframes", "reference"]);
    assert.deepEqual(supportedVideoGenerationModes(null), ["text", "image", "keyframes", "reference"]);
});

test("收敛模式：不支持时回落到第一个可用项，已支持或无可选项时原样返回", () => {
    const kling = { operations: ["text_to_video", "image_to_video"], references: { imageRoles: ["first_frame"] } };
    assert.equal(clampVideoGenerationMode("reference", kling), "text");
    assert.equal(clampVideoGenerationMode("keyframes", kling), "text");
    assert.equal(clampVideoGenerationMode("image", kling), "image");
    assert.equal(clampVideoGenerationMode("keyframes", undefined), "keyframes");
    assert.equal(clampVideoGenerationMode("keyframes", { operations: ["reference_to_video"], references: { imageRoles: [] } }), "keyframes");
});
