package app

import (
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"errors"

	"infinite-canvas/backend/internal/model"
)

// stsdBox 构造仅含 first-sample-entry fourcc 的最小 stsd box（置于 moov 切片内）。
func stsdBoxWithFourcc(fourcc string) []byte {
	b := make([]byte, 24)
	binary.BigEndian.PutUint32(b[0:4], 24)
	copy(b[4:8], "stsd")
	// body: version/flags(4) + entry_count(4)=1 + entry_size(4) + fourcc(4)
	binary.BigEndian.PutUint32(b[12:16], 1)
	binary.BigEndian.PutUint32(b[16:20], 8)
	copy(b[20:24], fourcc)
	return b
}

func TestCodecFromMoov(t *testing.T) {
	cases := []struct {
		fourcc string
		want   string
	}{
		{"hvc1", videoCodecH265},
		{"hev1", videoCodecH265},
		{"avc1", videoCodecH264},
		{"av01", videoCodecAV1},
		{"vp09", videoCodecVP9},
	}
	for _, c := range cases {
		if got := codecFromMoov(stsdBoxWithFourcc(c.fourcc)); got != c.want {
			t.Errorf("codecFromMoov(%s) = %q, want %q", c.fourcc, got, c.want)
		}
	}
	if got := codecFromMoov([]byte{0, 1, 2, 3}); got != "" {
		t.Errorf("garbage moov codec = %q, want empty", got)
	}
}

func TestProbeVideoCodecReadsRealFile(t *testing.T) {
	// 构造 ftyp + moov(含 hvc1 stsd) 的最小 mp4 文件，验证 probeVideoCodec 走文件读取路径。
	stsd := stsdBoxWithFourcc("hvc1")
	moov := make([]byte, 8+len(stsd))
	binary.BigEndian.PutUint32(moov[0:4], uint32(len(moov)))
	copy(moov[4:8], "moov")
	copy(moov[8:], stsd)
	full := make([]byte, 0, 16+len(moov))
	ftyp := make([]byte, 16)
	binary.BigEndian.PutUint32(ftyp[0:4], 16)
	copy(ftyp[4:8], "ftyp")
	copy(ftyp[8:12], "isom")
	full = append(full, ftyp...)
	full = append(full, moov...)

	path := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(path, full, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := probeVideoCodec(path); got != videoCodecH265 {
		t.Errorf("probeVideoCodec = %q, want h265", got)
	}
}

// TestBackfillRejudgesLegacyNoneVideos 覆盖修复：判定规则变更前（H.265/MPEG-4 Part 2
// 曾被误判可播）落 none 的存量本地视频，启动回填必须重新按 codec 判定——
// H.264 保持 none（幂等），MPEG-4 触发转码并最终落到 failed/ready 终态。
func TestBackfillRejudgesLegacyNoneVideos(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	dataDir := t.TempDir()
	service.dataDir = dataDir

	seedLegacy := func(id, fourcc string) {
		t.Helper()
		stsd := stsdBoxWithFourcc(fourcc)
		moov := make([]byte, 8+len(stsd))
		binary.BigEndian.PutUint32(moov[0:4], uint32(len(moov)))
		copy(moov[4:8], "moov")
		copy(moov[8:], stsd)
		ftyp := make([]byte, 16)
		binary.BigEndian.PutUint32(ftyp[0:4], 16)
		copy(ftyp[4:8], "ftyp")
		copy(ftyp[8:12], "isom")
		full := append(append([]byte{}, ftyp...), moov...)
		rel := filepath.Join("clips", id+".mp4")
		p := filepath.Join(dataDir, "resources", filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, full, 0o644); err != nil {
			t.Fatal(err)
		}
		res := model.Resource{
			ID: id, UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady,
			Provider: "local", ObjectKey: rel, PlaybackStatus: model.PlaybackStatusNone,
		}
		if err := db.Create(&res).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedLegacy("legacy-h264", "avc1")
	seedLegacy("legacy-mpeg4", "mp4v")

	service.BackfillPlaybackTranscodes()

	var h264 model.Resource
	if err := db.First(&h264, "id = ?", "legacy-h264").Error; err != nil {
		t.Fatal(err)
	}
	if h264.PlaybackStatus != model.PlaybackStatusNone {
		t.Fatalf("H.264 存量 none 行被错误改判为 %q", h264.PlaybackStatus)
	}

	// MPEG-4 行应被抢占转码。fake mp4 不含真实视频流，ffmpeg 解码必败 → failed；
	// 若某环境恰有同名 ready 副本则也接受。轮询直到终态，避免 goroutine 竞态。
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Log("无 ffmpeg，跳过 MPEG-4 终态断言")
		return
	}
	var mp4v model.Resource
	deadline := time.Now().Add(10 * time.Second)
	for {
		if err := db.First(&mp4v, "id = ?", "legacy-mpeg4").Error; err != nil {
			t.Fatal(err)
		}
		if mp4v.PlaybackStatus == model.PlaybackStatusFailed || mp4v.PlaybackStatus == model.PlaybackStatusReady {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("MPEG-4 存量行未达终态，停在 %q（error=%q）", mp4v.PlaybackStatus, mp4v.PlaybackError)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if mp4v.PlaybackStatus != model.PlaybackStatusFailed {
		t.Fatalf("fake mp4v 应转码失败落 failed，实际 %q", mp4v.PlaybackStatus)
	}
}

type failingResourceSaver struct {
	failTimes int
	calls     int
}

func (s *failingResourceSaver) SaveResource(*model.Resource) error {
	s.calls++
	if s.calls <= s.failTimes {
		return errors.New("db busy")
	}
	return nil
}

func TestPersistPlaybackResourceRetriesThenSucceeds(t *testing.T) {
	saver := &failingResourceSaver{failTimes: 2}
	if err := persistPlaybackResource(saver, &model.Resource{ID: "r1"}, "test"); err != nil {
		t.Fatal(err)
	}
	if saver.calls != playbackPersistAttempts {
		t.Fatalf("calls = %d, want %d", saver.calls, playbackPersistAttempts)
	}
}

func TestPersistPlaybackResourceReturnsAfterExhaustedRetries(t *testing.T) {
	saver := &failingResourceSaver{failTimes: 10}
	if err := persistPlaybackResource(saver, &model.Resource{ID: "r1"}, "test"); err == nil {
		t.Fatal("expected persist error")
	}
	if saver.calls != playbackPersistAttempts {
		t.Fatalf("calls = %d, want %d", saver.calls, playbackPersistAttempts)
	}
}

// boxOf 构造一个 box；full 为真时带 version/flags（mvhd/tkhd 是 full box，
// moov/trak/mdat/ftyp 不是）。
func boxOf(boxType string, version byte, payload []byte, full bool) []byte {
	body := payload
	if full {
		body = make([]byte, 4+len(payload))
		body[0] = version
		copy(body[4:], payload)
	}
	out := make([]byte, 8+len(body))
	binary.BigEndian.PutUint32(out[0:4], uint32(len(out)))
	copy(out[4:8], boxType)
	copy(out[8:], body)
	return out
}

// metadataMP4 造一个含 mvhd（timescale/duration）与视频轨 tkhd（16.16 定点宽高）的最小 mp4。
// withTrailingMoov 模拟"mdat 在前、moov 在尾部"的流式写入形态。
func metadataMP4(timescale, duration uint32, width, height uint16, withTrailingMoov bool) []byte {
	mvhd := make([]byte, 96)
	binary.BigEndian.PutUint32(mvhd[8:12], timescale)
	binary.BigEndian.PutUint32(mvhd[12:16], duration)
	tkhd := make([]byte, 80)
	binary.BigEndian.PutUint32(tkhd[72:76], uint32(width)<<16)
	binary.BigEndian.PutUint32(tkhd[76:80], uint32(height)<<16)
	moov := append(boxOf("mvhd", 0, mvhd, true), boxOf("trak", 0, boxOf("tkhd", 0, tkhd, true), false)...)
	ftyp := boxOf("ftyp", 0, []byte("isom\x00\x00\x02\x00isomiso2"), false)
	mdat := boxOf("mdat", 0, make([]byte, 64), false)
	if withTrailingMoov {
		return append(append(ftyp, mdat...), boxOf("moov", 0, moov, false)...)
	}
	return append(append(ftyp, boxOf("moov", 0, moov, false)...), mdat...)
}

// 视频落盘和读取都要能拿到真实时长与分辨率：上游基本不回传这两项，
// 少了它们"生成成功"就无法核对是不是 15s / 16:9。
func TestProbeMP4MetadataReadsDurationAndResolution(t *testing.T) {
	width, height, durationMs := probeMP4Metadata(metadataMP4(1000, 15000, 1920, 1080, false))
	if width != 1920 || height != 1080 || durationMs != 15000 {
		t.Fatalf("probeMP4Metadata = %d×%d, %dms", width, height, durationMs)
	}

	path := filepath.Join(t.TempDir(), "trailing.mp4")
	if err := os.WriteFile(path, metadataMP4(600, 9000, 720, 1280, true), 0o600); err != nil {
		t.Fatal(err)
	}
	width, height, durationMs = probeMP4FileMetadata(path)
	if width != 720 || height != 1280 || durationMs != 15000 {
		t.Fatalf("moov 在尾部的文件 = %d×%d, %dms", width, height, durationMs)
	}

	// 解析不出来时返回未知，不编造数字。
	if w, h, d := probeMP4Metadata([]byte("not a video")); w != 0 || h != 0 || d != 0 {
		t.Fatalf("非 mp4 应当返回未知：%d×%d, %dms", w, h, d)
	}
	if w, h, d := probeMP4FileMetadata(filepath.Join(t.TempDir(), "missing.mp4")); w != 0 || h != 0 || d != 0 {
		t.Fatalf("不存在的文件应当返回未知：%d×%d, %dms", w, h, d)
	}
}
