import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Routes, Route, useNavigate, useParams, Link } from "react-router-dom";
import { drawBlockBars } from "./audio/audioRender/blockBar";
import { readMeta, type TrackMeta } from "./audio/audioRender/readMeta";
import { usePreviewEngine } from "./hooks/audio/usePreviewEngine";

/* =========================
   型
========================= */
type Track = {
  id: string;
  file: File;
  url: string; // Object URL
  meta?: TrackMeta;
  previewStartSec?: number;
  previewEndSec?: number;
};

const ACCEPT_RE = /\.(mp3|m4a|aac|wav|flac|ogg)$/i;

/* =========================
   コンテキスト
   - tracks: 楽曲リスト
   - engine: 共有の再生エンジン（★波形もこれを使う）
========================= */
const TracksCtx = createContext<{
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
} | null>(null);

const EngineCtx = createContext<{
  engine: ReturnType<typeof usePreviewEngine>;
} | null>(null);

/* =========================
   背景波形（共有エンジンの Analyser を使用）
========================= */
function BackgroundWave({
  white = true,
  square = true,
  palette = ["#fca5a5", "#93c5fd", "#86efac"],
  paletteCycleSpeed = 0.003,
  cellSize = 14,
  cellGap = 3,
  smoothing = 0.72,
}: {
  white?: boolean;
  square?: boolean;
  palette?: string[];
  paletteCycleSpeed?: number;
  cellSize?: number;
  cellGap?: number;
  smoothing?: number;
}) {
  const { engine } = useContext(EngineCtx)!; // ★共有エンジン
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cvs = bgCanvasRef.current;
    const analyser = engine.getAnalyser(); // ★同じ AudioContext / ソースの Analyser
    if (!cvs || !analyser) return;

    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.9;

    const ctx2d = cvs.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    let width = 0,
      height = 0;
    let bars = 0;
    let prevLevels = new Float32Array(0);
    let frame = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      cvs.width = Math.floor(width * dpr);
      cvs.height = Math.floor(height * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      bars = Math.max(24, Math.floor(width / 10));
      prevLevels = new Float32Array(bars + 64);
    };
    resize();
    window.addEventListener("resize", resize);

    const spectrum = new Uint8Array(analyser.frequencyBinCount);

    const loop = () => {
      analyser.getByteFrequencyData(spectrum);
      drawBlockBars(
        ctx2d,
        spectrum,
        prevLevels,
        width,
        height,
        {
          square,
          cellSize,
          cellGap,
          bgClear: white ? "white" : "#0b1020",
          palette,
          paletteMode: "perBar",
          paletteCycleSpeed,
          alphaBase: 1.0,
          alphaStep: 0.0,
          smoothing,
        },
        frame++
      );
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [
    engine,
    white,
    square,
    JSON.stringify(palette),
    paletteCycleSpeed,
    cellSize,
    cellGap,
    smoothing,
  ]);

  return (
    <canvas
      ref={bgCanvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        background: white ? "white" : "#0b1020",
      }}
    />
  );
}

/* =========================
   画面A：ライブラリ
========================= */
function LibraryPage() {
  const nav = useNavigate();
  const { engine } = useContext(EngineCtx)!;
  const { tracks, setTracks } = useContext(TracksCtx)!;
  const [enabled, setEnabled] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const next: Track[] = [];
      for (const f of Array.from(files)) {
        if (!ACCEPT_RE.test(f.name)) continue;
        const url = URL.createObjectURL(f);
        const meta = await readMeta(f);
        next.push({
          id: crypto.randomUUID(),
          file: f,
          url,
          meta,
          previewStartSec: 45,
          previewEndSec: 75,
        });
      }
      setTracks((prev) => {
        prev.forEach((t) => {
          URL.revokeObjectURL(t.url);
          const u = t.meta?.pictureUrl;
          if (u && u.startsWith("blob:")) URL.revokeObjectURL(u);
        });
        return next;
      });
    },
    [setTracks]
  );

  const enableSound = useCallback(async () => {
    await engine.enable();
    setEnabled(true);
  }, [engine]);

  const preview = useCallback(
    (t: Track) => {
      setCurrentId(t.id);
      engine.play({
        id: t.id,
        url: t.url,
        previewStartSec: t.previewStartSec,
        previewEndSec: t.previewEndSec,
      });
    },
    [engine]
  );

  const stop = useCallback(() => engine.stop(), [engine]);

  return (
    <>
      <BackgroundWave white />

      {/* ツールバー */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "12px 16px",
          color: "#111",
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          📁 フォルダ選択（互換）
          <input
            type="file"
            style={{ display: "none" }}
            // @ts-ignore
            webkitdirectory="true"
            multiple
            accept=".mp3,.m4a,.aac,.wav,.flac,.ogg"
            onChange={(e) => {
              if (e.currentTarget.files) ingestFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>

        <button
          onClick={async () => {
            // @ts-ignore
            if (!window.showDirectoryPicker) {
              alert(
                "このブラウザは File System Access API に未対応です。『フォルダ選択（互換）』を使ってください。"
              );
              return;
            }
            try {
              // @ts-ignore
              const dirHandle = await window.showDirectoryPicker({
                mode: "read",
              });
              const files: File[] = [];
              for await (const entry of dirHandle.values()) {
                if (entry.kind === "file") {
                  const f = await entry.getFile();
                  if (ACCEPT_RE.test(f.name)) files.push(f);
                }
              }
              ingestFiles(files);
            } catch (e) {
              console.debug(e);
            }
          }}
        >
          📂 フォルダ選択（高速・推奨）
        </button>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          🎵 ファイル選択
          <input
            type="file"
            style={{ display: "none" }}
            multiple
            accept=".mp3,.m4a,.aac,.wav,.flac,.ogg"
            onChange={(e) => {
              if (e.currentTarget.files) ingestFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>

        {!enabled && (
          <button onClick={enableSound}>🔊 サウンド有効化（初回）</button>
        )}
        <button onClick={stop}>⏹ 停止</button>
        <span style={{ opacity: 0.8 }}>
          クリックでフル再生画面に遷移 / ▶︎でプレビュー
        </span>
      </div>

      {/* 2カラム */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          padding: "8px 16px 24px",
          minHeight: "calc(100vh - 64px)",
          color: "#111",
        }}
      >
        {/* 左：簡易プレビュー表示（任意） */}
        <section
          aria-label="Now Playing"
          style={{
            display: "grid",
            gridTemplateRows: "auto auto auto",
            alignContent: "start",
            gap: 12,
          }}
        >
          <div
            style={{
              position: "relative",
              width: "80%",
              aspectRatio: "1 / 1",
              borderRadius: 16,
              overflow: "hidden",
              margin: "0 auto",
              background: "#f3f4f6",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          >
            {tracks[0]?.meta?.pictureUrl ? (
              <img
                src={tracks[0].meta!.pictureUrl!}
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
                }}
              >
                No Artwork
              </div>
            )}
          </div>

          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
            {tracks[0]?.meta?.title ?? tracks[0]?.file.name ?? "No Track"}
          </h2>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {(tracks[0]?.meta?.artist ?? "Unknown Artist") +
              (tracks[0]?.meta?.album ? ` – ${tracks[0]?.meta?.album}` : "")}
          </div>
        </section>

        {/* 右：曲リスト（クリックでプレイヤー画面へ遷移） */}
        <section
          aria-label="曲リスト"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <ul
            role="listbox"
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: 8,
              overflow: "auto",
              maxHeight: "calc(100vh - 220px)",
            }}
          >
            {tracks.map((t) => (
              <li
                key={t.id}
                role="option"
                tabIndex={0}
                onClick={async () => {
                  await engine.enable(); // ← クリック(ユーザー操作)内で許可
                  engine.play({ id: t.id, url: t.url }); // ← プレビューではなくフル再生
                  nav(`/play/${t.id}`); // ← そのまま遷移
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    await engine.enable();
                    engine.play({ id: t.id, url: t.url });
                    nav(`/play/${t.id}`);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(0,0,0,0.04)",
                  cursor: "pointer",
                }}
                title="クリックでフル再生画面へ"
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    minWidth: 0,
                  }}
                >
                  {t.meta?.pictureUrl ? (
                    <img
                      src={t.meta.pictureUrl}
                      alt=""
                      width={44}
                      height={44}
                      style={{
                        borderRadius: 8,
                        objectFit: "cover",
                        flex: "0 0 auto",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        background: "rgba(0,0,0,0.06)",
                        flex: "0 0 auto",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        color: "#6b7280",
                      }}
                    >
                      No Art
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.meta?.title ?? t.file.name.replace(/\.[^.]+$/, "")}
                    </div>
                    <div
                      style={{
                        opacity: 0.85,
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.meta?.artist ?? "Unknown Artist"}
                      {t.meta?.album ? ` – ${t.meta.album}` : ""}
                    </div>
                  </div>
                </div>

                {/* ▶︎ プレビュー */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    preview(t);
                  }}
                  title="プレビュー"
                >
                  ▶︎
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

/* =========================
   画面B：プレイヤー（中央アートワークでフル再生）
========================= */
function PlayerPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { engine } = useContext(EngineCtx)!;
  const { tracks } = useContext(TracksCtx)!;

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

/* =========================
   ルート / プロバイダ
========================= */
export default function App() {
  // ★ここで 1 個だけエンジンを作る（全画面共通）
  const engine = usePreviewEngine({ fadeInMs: 120, fadeOutMs: 140 });
  const [tracks, setTracks] = useState<Track[]>([]);

  return (
    <EngineCtx.Provider value={{ engine }}>
      <TracksCtx.Provider value={{ tracks, setTracks }}>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/play/:id" element={<PlayerPage />} />
          <Route
            path="*"
            element={
              <div style={{ padding: 24 }}>
                <p>ページが見つかりません。</p>
                <Link to="/">トップへ戻る</Link>
              </div>
            }
          />
        </Routes>
      </TracksCtx.Provider>
    </EngineCtx.Provider>
  );
}
