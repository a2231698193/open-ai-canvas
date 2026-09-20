import assert from "node:assert/strict";
import test from "node:test";

// Node 原生 TypeScript 测试运行器要求保留扩展名，项目编译器不允许该写法。
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { activeVideoCreationAttachments, creationAssetKey, creationFileAccepted, isSameCreationAsset } from "./creation-assets.ts";

const image = (id: string) => ({ id, name: `${id}.png`, type: "image/png", dataUrl: id, previewUrl: id });
const video = (id: string) => ({ id, name: `${id}.mp4`, type: "video/mp4", url: id, previewUrl: id });
const audio = (id: string) => ({ id, name: `${id}.mp3`, type: "audio/mpeg", url: id, previewUrl: id });

test("同一任务的同一结果只能匹配同一个素材", () => {
    const identity = { taskId: "task-1", resultIndex: 0 };
    const asset = { metadata: { creationAssetKey: creationAssetKey(identity) } };

    assert.equal(isSameCreationAsset(asset, identity), true);
    assert.equal(isSameCreationAsset(asset, { taskId: "task-1", resultIndex: 1 }), false);
});

test("不同任务的结果不能被误判为重复素材", () => {
    const asset = { metadata: { creationAssetKey: creationAssetKey({ taskId: "task-1", resultIndex: 0 }) } };

    assert.equal(isSameCreationAsset(asset, { taskId: "task-2", resultIndex: 0 }), false);
});

test("修复前只保存任务 ID 的素材首个结果仍可被识别", () => {
    const asset = { metadata: { source: "create-generation", taskId: "task-legacy" } };

    assert.equal(isSameCreationAsset(asset, { taskId: "task-legacy", resultIndex: 0 }), true);
    assert.equal(isSameCreationAsset(asset, { taskId: "task-legacy", resultIndex: 1 }), false);
});

test("视频模式只投影当前启用的参考素材", () => {
    const attachments = [image("first"), image("last"), image("candidate"), video("clip"), audio("music")];
    assert.deepEqual(activeVideoCreationAttachments(attachments, "text"), { referenceImages: [], referenceVideos: [], referenceAudios: [] });
    assert.deepEqual(activeVideoCreationAttachments(attachments, "image", "candidate").referenceImages.map((item) => item.id), ["candidate"]);
    assert.deepEqual(activeVideoCreationAttachments(attachments, "keyframes", "candidate", "first").referenceImages.map((item) => item.id), ["candidate", "first"]);
    assert.equal(activeVideoCreationAttachments(attachments, "reference").referenceVideos.length, 1);
    assert.equal(activeVideoCreationAttachments(attachments, "reference").referenceAudios.length, 1);
});

test("视频上传类型随产品模式收窄", () => {
    const imageFile = { type: "image/png", name: "frame.png" };
    const videoFile = { type: "video/mp4", name: "clip.mp4" };
    assert.equal(creationFileAccepted("video", imageFile, "text"), false);
    assert.equal(creationFileAccepted("video", imageFile, "image"), true);
    assert.equal(creationFileAccepted("video", videoFile, "keyframes"), false);
    assert.equal(creationFileAccepted("video", videoFile, "reference"), true);
});
