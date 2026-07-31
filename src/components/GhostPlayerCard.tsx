import type { Track } from "../types/track";

export default function GhostPlayerCard(props: {
  title: string;
  sub: string;
  track: Track;
  onJump: () => void;
}) {
  const { title, sub, track, onJump } = props;

  return (
    <button
      onClick={onJump}
      title="この曲へスキップ"
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
        cursor: "pointer",
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

      {/* 右：情報（コントロールは省略） */}
      <div style={{ display: "grid", gap: 14, textAlign: "left" }}>
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

        <div style={{ fontSize: 12, color: "#6b7280" }}>
          クリックでこの曲へスキップ
        </div>
      </div>
    </button>
  );
}
