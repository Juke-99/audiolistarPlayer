import type { Track } from "../types/track";
import RoundIconButton from "./button/RoundIconButton";

type PlayerCardType = {
  title: string;
  sub: string;
  track: Track;
  bufferedPct: number;
  currentTime: number;
  duration: number;
  paused: boolean;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export default function PlayerCard(props: PlayerCardType) {
  const {
    title,
    sub,
    track,
    bufferedPct,
    currentTime,
    duration,
    paused,
    onSeek,
    onToggle,
    onPrev,
    onNext,
  } = props;

  // 再生済み%
  const pct =
    Number.isFinite(duration) && duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;

  function formatTime(sec: number) {
    if (!Number.isFinite(sec)) return "0:00";

    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);

    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div
      style={{
        width: "100%",
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
        height: "100%",
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

        {/* バッファ＆再生済みバー */}
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
          {/* バッファ済み */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${bufferedPct}%`,
              background: "rgba(0,0,0,0.18)",
            }}
          />
          {/* 再生済み */}
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

        {/* シーク（操作） */}
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
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
            onClick={() => {
              /* 先頭へ */
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "white",
            }}
            title="先頭へ"
            onClickCapture={(e) => e.stopPropagation()}
          >
            ⏮ 先頭
          </button>

          {/* 前へ */}
          <RoundIconButton label="前の曲へ" onClick={onPrev}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M11 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M19 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </RoundIconButton>

          {/* 次へ */}
          <RoundIconButton label="次の曲へ" onClick={onNext}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </RoundIconButton>
        </div>
      </div>
    </div>
  );
}
