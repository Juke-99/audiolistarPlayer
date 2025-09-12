import { useNavigate } from "react-router-dom";
import { useEngine } from "../contexts/EngineContext";
import { useTracks } from "../contexts/TrackContext";
import { useCallback, useState } from "react";
import type { Track } from "../types/track";
import { ACCEPT_RE } from "../constants/const";
import { readMeta } from "../audio/audioRender/readMeta";
import BackgroundWave from "../components/BackgroundWave";
import { useContinuousPreview } from "../hooks/audio/useContinuousPreview";

export default function LibraryPage() {
  const nav = useNavigate();
  const engine = useEngine();
  const { tracks, setTracks } = useTracks();
  const [enabled, setEnabled] = useState(false);
  const { currentIndex, handlePreviewClickById } = useContinuousPreview<Track>({
    tracks,
    engine,
    getId: (t) => t.id,
    getUrl: (t) => t.url,
    getPreviewStartSec: (t) => t.previewStartSec,
    getPreviewEndSec: (t) => t.previewEndSec,
    getDuration: (t) => t.meta?.durationSec,
    defaultWindowSec: 30,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
    async (t: Track) => {
      await handlePreviewClickById(t.id);
    },
    [handlePreviewClickById]
  );

  // 選択トグル
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  // 選択解除
  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // 「選択をプレイヤーで再生」
  const playSelected = async () => {
    if (!selectedIds.length) return;
    const dedup = Array.from(new Set(selectedIds));
    sessionStorage.setItem("queue", dedup.join(","));
    try {
      await engine.enable();
    } catch {}
    nav(`/play/${dedup[0]}`); // ここは既存ルートに合わせて
  };

  const now = currentIndex != null ? tracks[currentIndex] : null;
  const stop = useCallback(() => engine.stop(), [engine]);

  const haltPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const blockNavAndPropagation = (e: React.MouseEvent | React.PointerEvent) => {
    // 行が <Link> 包装の場合のナビ抑止に使う
    e.preventDefault();
    e.stopPropagation();
  };

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
            onChange={async (e) => {
              if (e.currentTarget.files) {
                await ingestFiles(e.currentTarget.files);
                await engine.enable();
              }

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
              await ingestFiles(files);
              await engine.enable();
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

        <button
          onClick={playSelected}
          disabled={selectedIds.length === 0}
          title="選んだ曲をプレイヤーで順番に再生"
        >
          ▶ 選択をプレイヤーで再生（{selectedIds.length}）
        </button>

        <button onClick={clearSelection} disabled={selectedIds.length === 0}>
          選択解除
        </button>

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
            {now?.meta?.title ??
              now?.file.name ??
              tracks[0]?.meta?.title ??
              tracks[0]?.file.name ??
              "No Track"}
          </h2>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {(now?.meta?.artist ??
              tracks[0]?.meta?.artist ??
              "Unknown Artist") +
              (now?.meta?.album ?? tracks[0]?.meta?.album
                ? ` – ${now?.meta?.album ?? tracks[0]?.meta?.album}`
                : "")}
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

                <div
                  data-no-nav // 親のガード用フラグ
                  onClick={blockNavAndPropagation} // Link遷移を確実にブロック（Linkで包んでる場合）
                  onPointerDown={blockNavAndPropagation} // 早期に止める（モバイルも安定）
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <label
                    onClick={haltPropagation}
                    onPointerDown={haltPropagation}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      onClick={haltPropagation} // 親の onClick に届かせない
                      onPointerDown={haltPropagation}
                    />
                    <span>リストに追加</span>
                  </label>
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
