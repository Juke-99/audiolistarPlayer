import { useNavigate, useParams } from "react-router-dom";
import { useTracks } from "../contexts/TrackContext";
import { useMemo } from "react";
import BackgroundWave from "../components/BackgroundWave";

export default function PlayerPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { tracks } = useTracks();

  const track = useMemo(() => tracks.find((t) => t.id === id), [tracks, id]);

  // useEffect(() => {
  //   if (!track) return;
  //   (async () => {
  //     await engine.enable(); // ★ユーザー操作後なら通る
  //     engine.play({ id: track.id, url: track.url }); // フル再生（start/endなし）
  //   })();
  //   return () => engine.stop();
  // }, [track, engine]);

  const title = track?.meta?.title ?? track?.file.name ?? "Unknown";
  const sub =
    (track?.meta?.artist ?? "Unknown Artist") +
    (track?.meta?.album ? ` – ${track?.meta?.album}` : "");

  return (
    <>
      <BackgroundWave
        white
        square
        palette={["#fca5a5", "#93c5fd", "#86efac"]}
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
          padding: "16px",
        }}
      >
        <div
          style={{
            width: "min(60vw, 520px)",
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

        <div
          style={{
            marginTop: 16,
            textAlign: "center",
            color: "#111",
            maxWidth: 720,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>
            {title}
          </div>
          <div style={{ fontSize: 14, opacity: 0.8, marginTop: 6 }}>{sub}</div>
        </div>
      </div>
    </>
  );
}
