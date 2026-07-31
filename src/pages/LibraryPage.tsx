import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router-dom";
import { useEngine } from "../contexts/EngineContext";
import { useTracks } from "../contexts/TrackContext";
import type { Track } from "../types/track";
import { ACCEPT_RE } from "../constants/const";
import { readMeta } from "../audio/audioRender/readMeta";
import BackgroundWave from "../components/BackgroundWave";
import { useContinuousPreview } from "../hooks/audio/useContinuousPreview";
import { collectDroppedFiles } from "../utils/dropEntries";
import { db, saveLyrics, trackToStored } from "../utils/db";
import type { EmbeddedLyrics } from "../utils/extractEmbeddedLyrics";
import { serializeLrc } from "../utils/lrc";

type PreviewMap = Record<string, { start: number; end: number }>;

export default function LibraryPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewMap, setPreviewMap] = useState<PreviewMap>({});
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState("");

  const compatFolderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  const pillBtn: CSSProperties = {
    padding: "8px 14px",
    borderRadius: 9999,
    border: "1px solid rgba(0,0,0,.15)",
    background: "white",
    boxShadow: "0 2px 6px rgba(0,0,0,.06)",
    cursor: "pointer",
    fontSize: 14,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#111",
  };

  const nav = useNavigate();
  const engine = useEngine();
  const { tracks, setTracks } = useTracks();

  const { currentIndex, handlePreviewClickById } = useContinuousPreview<Track>({
    tracks,
    engine,
    getId: (t) => t.id,
    getUrl: (t) => t.url,
    getPreviewStartSec: (t) => getPreviewStartSec(t),
    getPreviewEndSec: (t) => getPreviewEndSec(t),
    getDuration: (t) => t.meta?.durationSec,
    defaultWindowSec: 30,
  });

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const next: Track[] = [];

      for (const f of Array.from(files)) {
        if (!ACCEPT_RE.test(f.name)) continue;

        const url = URL.createObjectURL(f);
        const { meta, embeddedLyrics } = await readMeta(f);
        const id = crypto.randomUUID();

        next.push({
          id,
          file: f,
          url,
          meta,
          previewStartSec: 45,
          previewEndSec: 75,
        });

        // 埋め込み歌詞があれば、後で IDB に書くために控えておく
        (next[next.length - 1] as any).__embeddedLyrics = embeddedLyrics;
      }

      let added: Track[] = [];

      setTracks((prev) => {
        // 既存トラックと name+size で重複判定
        const existingKeys = new Set(
          prev.map((t) => `${t.file.name}|${t.file.size}`),
        );

        const dups: Track[] = [];
        const fresh: Track[] = [];

        for (const t of next) {
          const key = `${t.file.name}|${t.file.size}`;

          if (existingKeys.has(key)) {
            dups.push(t);
          } else {
            fresh.push(t);
          }
        }

        // 重複分はメモリリーク防止のため URL 解放
        for (const t of dups) {
          URL.revokeObjectURL(t.url);
          const u = t.meta?.pictureUrl;

          if (u && u.startsWith("blob:")) URL.revokeObjectURL(u);
        }

        added = fresh;
        return [...prev, ...fresh];
      });

      for (const t of added) {
        try {
          const stored = await trackToStored(t);
          await db.tracks.put(stored);
        } catch (e) {
          console.warn(`Failed to persist track ${t.id}`, e);
        }

        // ★ 追加: 歌詞の永続化
        const emb = (t as any).__embeddedLyrics as EmbeddedLyrics | undefined;
        if (emb) {
          try {
            if (emb.source === "sylt") {
              await saveLyrics({
                trackId: t.id,
                source: "sylt",
                format: emb.parsed.format,
                content: serializeLrc(emb.parsed),
                edited: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            } else {
              await saveLyrics({
                trackId: t.id,
                source: "uslt",
                format: "text-only",
                content: emb.text,
                edited: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          } catch (e) {
            console.warn(`Failed to persist lyrics for ${t.id}`, e);
          }
          delete (t as any).__embeddedLyrics;
        }
      }
    },
    [setTracks],
  );

  const pickFolder = useCallback(async () => {
    try {
      await engine.enable();
    } catch {}

    // @ts-ignore
    if (window.showDirectoryPicker) {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker({ mode: "read" });
        const files: File[] = [];
        for await (const entry of dirHandle.values()) {
          if (entry.kind === "file") {
            const f = await entry.getFile();
            if (ACCEPT_RE.test(f.name)) files.push(f);
          }
        }
        await ingestFiles(files);
      } catch (e) {
        console.debug(e);
      }
    } else {
      // 互換ブラウザは webkitdirectory にフォールバック
      compatFolderInputRef.current?.click();
    }
  }, [engine, ingestFiles]);

  const pickFiles = useCallback(() => {
    filesInputRef.current?.click();
  }, []);

  const preview = useCallback(
    async (t: Track) => {
      await handlePreviewClickById(t.id);
    },
    [handlePreviewClickById],
  );

  // 選択トグル
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
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
  const displayTrack = now ?? tracks[0] ?? null;
  const stop = useCallback(() => engine.stop(), [engine]);

  const getPreviewStartSec = (track: Track) => {
    const key = track.file?.name as string | undefined;
    const cfg = key ? previewMap[key] : undefined;
    const start = cfg?.start ?? track.previewStartSec ?? 0;
    const dur = track.meta?.durationSec;

    if (typeof dur === "number" && isFinite(dur) && start >= dur) {
      return Math.max(0, Math.floor(dur - 1));
    }

    return Math.max(0, start);
  };

  const getPreviewEndSec = (track: Track) => {
    const key = track.file?.name as string | undefined;
    const cfg = key ? previewMap[key] : undefined;
    const fallbackStart = (track.previewStartSec ?? 0) | 0;
    let end = (cfg?.end ?? track.previewEndSec ?? fallbackStart + 30) | 0;
    const dur = track.meta?.durationSec;

    if (typeof dur === "number" && isFinite(dur)) {
      end = Math.min(Math.floor(dur), Math.max(0, end));
    }

    const startResolved = (cfg?.start ?? track.previewStartSec ?? 0) | 0;
    if (end <= startResolved) end = startResolved + 1;

    return end;
  };

  const visibleTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;

    return tracks.filter((t) => {
      const title = (t.meta?.title ?? t.file.name).toLowerCase();
      const artist = (t.meta?.artist ?? "").toLowerCase();
      const album = (t.meta?.album ?? "").toLowerCase();
      const fileName = t.file.name.toLowerCase();

      return (
        title.includes(q) ||
        artist.includes(q) ||
        album.includes(q) ||
        fileName.includes(q)
      );
    });
  }, [query, tracks]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/previewMap.json", { cache: "no-store" });
        if (!res.ok) return;

        const json = (await res.json()) as PreviewMap;
        if (!cancelled) setPreviewMap(json ?? {});
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let counter = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;

      e.preventDefault();
      counter++;

      if (counter === 1) setIsDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // これを止めるとドロップが発火しない
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;

      counter--;

      if (counter <= 0) {
        counter = 0;
        setIsDragging(false);
      }
    };

    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;

      e.preventDefault();
      counter = 0;
      setIsDragging(false);

      const files = await collectDroppedFiles(e.dataTransfer.items);

      if (files.length) {
        try {
          await engine.enable();
        } catch {}

        await ingestFiles(files);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [engine, ingestFiles]);

  return (
    <>
      <BackgroundWave white />

      {isDragging && (
        <div
          style={{
            position: "fixed",
            inset: 16,
            zIndex: 100,
            borderRadius: 16,
            background: "rgba(59,130,246,0.12)",
            border: "3px dashed rgba(59,130,246,0.8)",
            pointerEvents: "none",
            display: "grid",
            placeItems: "center",
            color: "#1e3a8a",
            fontSize: 22,
            fontWeight: 800,
            backdropFilter: "blur(2px)",
          }}
        >
          📂 ここにドロップで取り込み
        </div>
      )}

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
        <button onClick={pickFolder} style={pillBtn}>
          📁 フォルダから取り込む
        </button>

        <button onClick={pickFiles} style={pillBtn}>
          🎵 ファイルから取り込む
        </button>

        <div
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 12,
              fontSize: 14,
              opacity: 0.5,
              pointerEvents: "none",
            }}
          >
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="曲名・アーティストで検索"
            style={{
              height: 36,
              paddingLeft: 34,
              paddingRight: query ? 32 : 12,
              borderRadius: 9999,
              border: "1px solid rgba(0,0,0,.15)",
              background: "white",
              boxShadow: "0 2px 6px rgba(0,0,0,.06)",
              fontSize: 14,
              color: "#111",
              width: 240,
              outline: "none",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              title="検索をクリア"
              style={{
                position: "absolute",
                right: 8,
                width: 20,
                height: 20,
                borderRadius: 9999,
                border: "none",
                background: "rgba(0,0,0,.08)",
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
                display: "grid",
                placeItems: "center",
                color: "#111",
              }}
            >
              ×
            </button>
          )}
        </div>

        {selectedIds.length > 0 && (
          <>
            <div
              style={{
                width: 1,
                height: 24,
                background: "rgba(0,0,0,.1)",
                margin: "0 4px",
              }}
            />

            <button
              onClick={playSelected}
              style={{
                ...pillBtn,
                background: "#111",
                color: "white",
                borderColor: "#111",
              }}
              title="選んだ曲をプレイヤーで順番に再生"
            >
              ▶ プレイヤーで再生（{selectedIds.length}）
            </button>
            <button onClick={clearSelection} style={pillBtn}>
              選択解除
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={stop} style={pillBtn} title="プレビュー再生を停止">
          ⏹ 停止
        </button>

        <button
          onClick={async () => {
            if (
              !confirm(
                "ライブラリの全曲を削除しますか？（永続データも消えます）",
              )
            )
              return;
            // 既存の Object URL を解放
            tracks.forEach((t) => {
              URL.revokeObjectURL(t.url);
              const u = t.meta?.pictureUrl;
              if (u && u.startsWith("blob:")) URL.revokeObjectURL(u);
            });
            try {
              await db.tracks.clear();
            } catch (e) {
              console.warn("Failed to clear IndexedDB", e);
            }
            setTracks([]);
            setSelectedIds([]);
          }}
          style={pillBtn}
          title="ライブラリの全曲を削除"
        >
          🗑 全消去
        </button>

        <span style={{ opacity: 0.8 }}>
          クリックでフル再生画面に遷移 / ▶︎でプレビュー
        </span>

        <input
          ref={compatFolderInputRef}
          type="file"
          style={{ display: "none" }}
          // @ts-ignore
          webkitdirectory="true"
          multiple
          accept=".mp3,.m4a,.aac,.wav,.flac,.ogg"
          onChange={async (e) => {
            const filesArr = e.currentTarget.files
              ? Array.from(e.currentTarget.files)
              : [];

            e.currentTarget.value = "";

            if (filesArr.length) {
              try {
                await engine.enable();
              } catch {}

              await ingestFiles(filesArr);
            }
          }}
        />

        <input
          ref={filesInputRef}
          type="file"
          style={{ display: "none" }}
          multiple
          accept=".mp3,.m4a,.aac,.wav,.flac,.ogg"
          onChange={async (e) => {
            const filesArr = e.currentTarget.files
              ? Array.from(e.currentTarget.files)
              : [];

            e.currentTarget.value = ""; // 先に同期で空に

            if (filesArr.length) {
              try {
                await engine.enable();
              } catch {}

              await ingestFiles(filesArr);
            }
          }}
        />
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
            {displayTrack?.meta?.pictureUrl ? (
              <img
                src={displayTrack.meta.pictureUrl}
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
            {displayTrack?.meta?.title ?? displayTrack?.file.name ?? "No Track"}
          </h2>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {(displayTrack?.meta?.artist ?? "Unknown Artist") +
              (displayTrack?.meta?.album
                ? ` – ${displayTrack.meta.album}`
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
            {visibleTracks.map((t) => {
              const selected = selectedIds.includes(t.id);

              return (
                <li
                  key={t.id}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => toggleSelect(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelect(t.id);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: selected
                      ? "rgba(59,130,246,0.12)"
                      : "rgba(0,0,0,0.04)",
                    border: selected
                      ? "1px solid rgba(59,130,246,0.5)"
                      : "1px solid transparent",
                    cursor: "pointer",
                    transition: "background .12s ease, border-color .12s ease",
                  }}
                  title={
                    selected
                      ? "クリックで選択を解除"
                      : "クリックでプレイリストに追加"
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    {/* 選択インジケータ */}
                    <div
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        border: selected
                          ? "2px solid rgba(59,130,246,0.95)"
                          : "2px solid rgba(0,0,0,0.25)",
                        background: selected
                          ? "rgba(59,130,246,0.95)"
                          : "transparent",
                        color: "white",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        fontWeight: 800,
                        flex: "0 0 auto",
                      }}
                    >
                      {selected ? "✓" : ""}
                    </div>

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

                  {/* 操作ボタン群（行クリックを発火させない） */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      flex: "0 0 auto",
                    }}
                  >
                    {/* プレビュー試聴 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        preview(t);
                      }}
                      title="プレビュー試聴"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 9999,
                        border: "1px solid rgba(0,0,0,0.15)",
                        background: "white",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      ▶︎
                    </button>

                    {/* この曲だけプレイヤーで再生 */}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await engine.enable();
                        } catch {}
                        sessionStorage.setItem("queue", t.id);
                        engine.play({ id: t.id, url: t.url });
                        nav(`/play/${t.id}`);
                      }}
                      title="この曲をプレイヤーで再生"
                      style={{
                        height: 36,
                        padding: "0 12px",
                        borderRadius: 9999,
                        border: "1px solid rgba(0,0,0,0.15)",
                        background: "white",
                        cursor: "pointer",
                        fontSize: 13,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      ▶ 再生
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {query && visibleTracks.length === 0 && (
            <div
              style={{
                padding: "24px 12px",
                textAlign: "center",
                color: "#6b7280",
                fontSize: 14,
              }}
            >
              「{query}」に一致する曲がありません
            </div>
          )}
        </section>
      </div>
    </>
  );
}
