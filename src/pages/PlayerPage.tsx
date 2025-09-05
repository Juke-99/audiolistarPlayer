import { useNavigate, useParams } from "react-router-dom";
import { useTracks } from "../contexts/TrackContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import BackgroundWave from "../components/BackgroundWave";
import { useEngine } from "../contexts/EngineContext";

function formatTime(sec: number) {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PlayerPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const engine = useEngine();
  const { tracks } = useTracks();

  // トラックが無い場合も落ちないようにガード
  if (!tracks || tracks.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => nav("/")}>← ライブラリへ</button>
        <p style={{ marginTop: 12 }}>トラックがありません。</p>
      </div>
    );
  }

  const track = useMemo(
    () => tracks.find((t) => t.id === id) ?? tracks[0],
    [tracks, id]
  );

  // 再生状態（エンジンから購読）
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(NaN);
  const [paused, setPaused] = useState(true);
  const [buffered, setBuffered] = useState<{ start: number; end: number }[]>(
    []
  );

  // ★ パレットは安定参照に（点滅防止）
  const wavePalette = useMemo(() => ["#fca5a5", "#93c5fd", "#86efac"], []);

  useEffect(() => {
    // 時間/状態の購読
    const off = engine.onTick((info) => {
      setCurrentTime(info.currentTime);
      setDuration(info.duration);
      setPaused(info.paused);
      setBuffered(info.buffered);
    });

    return off;
  }, [engine]);

  // ページ遷移時にフル再生へ（previewEnd を外す）
  useEffect(() => {
    if (!track) return;
    const s = engine.getState();

    if (s.id !== track.id || !Number.isFinite(s.duration)) {
      (async () => {
        await engine.enable();
        await engine.play({ id: track.id, url: track.url });
      })();
    }
  }, [track?.id, track?.url]);

  // 操作系
  const onToggle = useCallback(() => engine.toggle(), [engine]);
  const onSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.currentTarget.value);
      engine.seek(v);
    },
    [engine]
  );

  const title =
    track?.meta?.title ??
    track?.file?.name?.replace(/\.[^.]+$/, "") ??
    "Unknown";
  const sub =
    (track?.meta?.artist ?? "Unknown Artist") +
    (track?.meta?.album ? ` – ${track?.meta?.album}` : "");
  const pct =
    Number.isFinite(duration) && duration > 0
      ? (currentTime / duration) * 100
      : 0;

  // バッファ済み・再生済みの表示用スタイル
  const bufferedBars =
    Number.isFinite(duration) && duration > 0
      ? buffered.map((r, i) => {
          const left = Math.max(0, Math.min(100, (r.start / duration) * 100));
          const right = Math.max(0, Math.min(100, (r.end / duration) * 100));
          const width = Math.max(0, right - left);

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.18)", // バッファ済みは薄め
              }}
            />
          );
        })
      : null;

  return (
    <>
      <BackgroundWave
        white
        square
        palette={wavePalette}
        paletteCycleSpeed={0.003}
      />

      {/* ヘッダ */}
      <div style={{ position: "relative", zIndex: 2, padding: "12px 16px" }}>
        <button onClick={() => nav("/")}>&larr; ライブラリに戻る</button>
      </div>

      {/* 中央配置 */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "calc(100vh - 80px)",
          display: "grid",
          placeItems: "center",
          padding: 16,
          color: "#111",
        }}
      >
        <div
          style={{
            width: "min(96vw, 1100px)",
            display: "grid",
            gap: 18,
            background: "rgba(255,255,255,0.65)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(0,0,0,0.05)",
            borderRadius: 16,
            boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
            padding: 18,
            gridTemplateColumns: "1.3fr 1fr",
            alignItems: "center",
            transform: "translateY(-25px)",
          }}
        >
          {/* 左：アートワーク */}
          <div style={{ display: "grid", placeItems: "center" }}>
            <div
              style={{
                position: "relative",
                width: "clamp(280px, 48vw, 560px)",
                aspectRatio: "1 / 1",
                borderRadius: 16,
                overflow: "hidden",
                background: "#f3f4f6",
                boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
              }}
              title={title}
            >
              {track?.meta?.pictureUrl ? (
                <img
                  src={track.meta.pictureUrl}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    backgroundColor: "#fff",
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    color: "#6b7280",
                    background:
                      "linear-gradient(135deg, #e5e7eb 0%, #f3f4f6 50%, #ffffff 100%)",
                  }}
                >
                  No Artwork
                </div>
              )}
            </div>
          </div>

          {/* 右：情報＋コントロール */}
          <div style={{ display: "grid", gap: 14 }}>
            {/* タイトル/アーティスト */}
            <div>
              <div style={{ fontSize: 14, opacity: 0.85 }}>{sub}</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  marginTop: 4,
                }}
              >
                {title}
              </div>
            </div>

            {/* 「再生済み/バッファ済み」を重ねた可視化バー */}
            <div
              style={{
                position: "relative",
                height: 10,
                width: "100%",
                background: "rgba(0,0,0,0.08)",
                borderRadius: 9999,
                overflow: "hidden",
              }}
              aria-label="buffered-and-played-visual"
            >
              {/* バッファ済み（複数レンジに対応） */}
              {bufferedBars}
              {/* 再生済み（濃い帯） */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: "rgba(0,0,0,0.55)",
                }}
              />
            </div>

            {/* シーク（操作用） */}
            <input
              type="range"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 0}
              step={0.01}
              value={Number.isFinite(currentTime) ? currentTime : 0}
              onChange={onSeek}
              style={{ width: "100%" }}
            />

            {/* 時間表示 */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                opacity: 0.8,
              }}
            >
              <span>{formatTime(currentTime)}</span>
              <span>
                {Number.isFinite(duration) ? formatTime(duration) : "--:--"}
              </span>
            </div>

            {/* コントロール */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={onToggle}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: "white",
                  fontWeight: 700,
                }}
                title={paused ? "再生" : "一時停止"}
              >
                {paused ? "▶︎ 再生" : "⏸ 一時停止"}
              </button>

              <button
                onClick={() => engine.seek(0)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: "white",
                }}
                title="先頭へ"
              >
                ⏮ 先頭
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
