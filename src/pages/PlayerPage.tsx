import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTracks } from "../contexts/TrackContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const { search } = useLocation();

  const [nowId, setNowId] = useState<string | null>(null);

  const queueIds = useMemo(() => {
    const fromUrl = new URLSearchParams(search).get("queue") || "";
    const arr = (
      fromUrl
        ? fromUrl.split(",")
        : (sessionStorage.getItem("queue") || "").split(",")
    )
      .map((s) => s.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const valid = new Set(tracks.map((t) => t.id));
    const dedupFiltered: string[] = [];
    for (const x of arr)
      if (!seen.has(x) && valid.has(x)) {
        seen.add(x);
        dedupFiltered.push(x);
      }
    // キューが空なら、現在の曲のみ（単曲再生）
    return dedupFiltered.length ? dedupFiltered : id ? [id] : [];
  }, [search, tracks, id]);

  // URL > sessionStorage の順で採用し、tracksに存在するIDだけ残す
  const queue = useMemo(() => {
    const fromUrl = new URLSearchParams(search).get("queue") || "";
    const raw = fromUrl || sessionStorage.getItem("queue") || "";
    const arr = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // 重複除去＋存在チェック
    const valid = new Set(tracks.map((t) => t.id));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of arr)
      if (!seen.has(x) && valid.has(x)) {
        seen.add(x);
        out.push(x);
      }

    // キューが空なら単曲再生（現在IDのみ）
    return out.length ? out : id ? [id] : [];
  }, [search, tracks, id]);

  // 現在のID / キュー / インデックスを参照するためのref（イベント内で安定して使う）
  const idRef = useRef<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const indexRef = useRef<number>(-1);

  // キューと現在IDが変わったときにrefを更新
  useEffect(() => {
    idRef.current = id ?? null;
    queueRef.current = queue;
    indexRef.current = id ? queue.indexOf(id) : -1;
  }, [id, queue]);

  // トラックが無い場合も落ちないようにガード
  if (!tracks || tracks.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => nav("/")}>← ライブラリへ</button>
        <p style={{ marginTop: 12 }}>トラックがありません。</p>
      </div>
    );
  }

  const effectiveId = nowId ?? id ?? null;
  const track = useMemo(
    () => (effectiveId ? tracks.find((t) => t.id === effectiveId) : tracks[0]),
    [tracks, effectiveId]
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

  const advancedRef = useRef<string | null>(null);

  useEffect(() => {
    // 時間/状態の購読
    const off = engine.onTick((info) => {
      setCurrentTime(info.currentTime);
      setDuration(info.duration);
      setPaused(info.paused);
      setBuffered(info.buffered);
      setNowId(info.id ?? null);
    });

    return off;
  }, [engine]);

  useEffect(() => {
    // "queue" は ライブラリ側で selectedIds を保存しておく想定（下に例あり）
    const raw = (sessionStorage.getItem("queue") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // 存在チェック＋重複除去
    const valid = new Set(tracks.map((t) => t.id));
    const seen = new Set<string>();
    const q: string[] = [];
    for (const x of raw)
      if (valid.has(x) && !seen.has(x)) {
        seen.add(x);
        q.push(x);
      }

    // キューが空なら単曲再生扱い
    queueRef.current = q.length ? q : id ? [id] : [];
  }, [tracks, id]);

  useEffect(() => {
    // 自動次曲は: キューがあり、曲IDがあり、durationが有効な時だけ
    if (!queueIds.length || !id) return;
    if (!Number.isFinite(duration) || duration <= 0) return;

    // 終了判定（少しマージンを取る）
    const ended = paused && currentTime >= Math.max(0, duration - 0.25);

    if (ended && advancedRef.current !== id) {
      advancedRef.current = id; // 同じ曲で多重発火しないように

      const idx = queueIds.indexOf(id);
      const nextId = idx >= 0 ? queueIds[idx + 1] : undefined;
      if (!nextId) return; // 末尾は停止でOK

      // 音を確実に止めてから次へ（フェードさせたいなら stop() に置換）
      try {
        engine.pause();
      } catch {}

      const q = encodeURIComponent(queueIds.join(","));
      nav(`/play/${nextId}?queue=${q}`, { replace: true });
    }

    // 再生が再開された/シークで戻った場合は、再び発火できるように解除
    if (!ended && advancedRef.current === id) {
      advancedRef.current = null;
    }
  }, [currentTime, duration, paused, queueIds, id, nav, engine]);

  useEffect(() => {
    if (!track) return;
    (async () => {
      try {
        await engine.enable();
        await engine.play({
          id: track.id,
          url: track.url,
          previewStartSec: undefined,
          previewEndSec: undefined,
        });
        await ensurePlaying(); // ★ 追加
        setTimeout(() => {
          ensurePlaying();
        }, 50); // ★ 追加（保険）
      } catch {}
    })();
  }, [track?.id, track?.url, engine]);

  const routeIdRef = useRef<string | null>(null);
  useEffect(() => {
    routeIdRef.current = id ?? null;
  }, [id]);

  const endGuardRef = useRef(false);

  // 操作系
  const onToggle = useCallback(() => engine.toggle(), [engine]);
  const onSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.currentTarget.value);
      engine.seek(v);
    },
    [engine]
  );

  const ensurePlaying = async () => {
    try {
      const s = engine.getState?.();
      // まだ pause 中なら再開する
      if (!s || s.paused) {
        await engine.resume?.();
      }
    } catch {}
  };

  // ★ 前の曲へ
  const playPrevInQueue = useCallback(async () => {
    const q = queueRef.current;
    const curId = nowId ?? routeIdRef.current ?? null;
    if (!curId) return;

    const idx = q.indexOf(curId);
    const prevId = idx > 0 ? q[idx - 1] : null;
    if (!prevId) return;

    const prevTrack = tracks.find((t) => t.id === prevId);
    if (!prevTrack) return;

    // 切替（フェードさせたいなら先に await engine.stop()）
    await engine.play({
      id: prevTrack.id,
      url: prevTrack.url,
      previewStartSec: undefined,
      previewEndSec: undefined,
    });
    await ensurePlaying();
    setTimeout(() => {
      ensurePlaying();
    }, 50);
  }, [engine, tracks, nowId]);

  const playNextInQueue = useCallback(async () => {
    const q = queueRef.current;
    const curId = nowId ?? routeIdRef.current ?? null;
    if (!curId) return;

    const idx = q.indexOf(curId);
    const nextId = idx >= 0 ? q[idx + 1] : null;
    if (!nextId) return;

    const nextTrack = tracks.find((t) => t.id === nextId);
    if (!nextTrack) return;

    // 1) セットして
    await engine.play({
      id: nextTrack.id,
      url: nextTrack.url,
      previewStartSec: undefined,
      previewEndSec: undefined,
    });

    // 2) すぐ再生開始を強制
    await ensurePlaying();

    // 3) 念のため少し後でもう一度（ブラウザのreadyタイミング対策）
    setTimeout(() => {
      ensurePlaying();
    }, 50);
  }, [engine, tracks, nowId]);

  useEffect(() => {
    const off = engine.onPreviewEnd?.(({ reason }) => {
      if (reason !== "ended") return; // プレビューは連続させない場合
      if (endGuardRef.current) return;
      endGuardRef.current = true;
      playNextInQueue();
    });
    return () => {
      off && off();
      endGuardRef.current = false;
    };
  }, [engine, playNextInQueue]);

  useEffect(() => {
    endGuardRef.current = false;
  }, [nowId]);

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
        <button
          onClick={() => {
            // 押したら再生停止（即止めたいので pause。フェードさせたいなら stop() に）
            try {
              engine.pause();
            } catch {}
            // 履歴があれば戻る。無ければライブラリへ
            if (window.history.length > 1) nav(-1);
            else nav("/");
          }}
          aria-label="戻る"
          title="戻る"
          style={{
            width: 40,
            height: 40,
            borderRadius: "9999px",
            display: "inline-grid",
            placeItems: "center",
            border: "1px solid rgba(0,0,0,.15)",
            background: "white",
            boxShadow: "0 2px 6px rgba(0,0,0,.06)",
            cursor: "pointer",
            transition: "transform .08s ease",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          {/* 左矢印（SVG） */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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

              <button
                onClick={playPrevInQueue}
                aria-label="前の曲へ"
                title="前の曲へ（Shift+←）"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 9999,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid rgba(0,0,0,.15)",
                  background: "white",
                  boxShadow: "0 2px 6px rgba(0,0,0,.06)",
                  cursor: "pointer",
                  transition: "transform .06s ease",
                  opacity:
                    queueRef.current.indexOf(
                      nowId ?? routeIdRef.current ?? ""
                    ) > 0
                      ? 1
                      : 0.5,
                  pointerEvents:
                    queueRef.current.indexOf(
                      nowId ?? routeIdRef.current ?? ""
                    ) > 0
                      ? "auto"
                      : "none",
                }}
                onMouseDown={(e) =>
                  (e.currentTarget.style.transform = "scale(0.96)")
                }
                onMouseUp={(e) =>
                  (e.currentTarget.style.transform = "scale(1)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.transform = "scale(1)")
                }
              >
                {/* 左二重矢印 */}
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
              </button>

              <button
                onClick={playNextInQueue}
                aria-label="次の曲へ"
                title="次の曲へ（Shift+→）"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 9999,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid rgba(0,0,0,.15)",
                  background: "white",
                  boxShadow: "0 2px 6px rgba(0,0,0,.06)",
                  cursor: "pointer",
                  transition: "transform .06s ease",
                  opacity: (() => {
                    const q = queueRef.current;
                    const cur = nowId ?? routeIdRef.current ?? "";
                    const i = q.indexOf(cur);
                    return i >= 0 && i < q.length - 1 ? 1 : 0.5;
                  })(),
                  pointerEvents: (() => {
                    const q = queueRef.current;
                    const cur = nowId ?? routeIdRef.current ?? "";
                    const i = q.indexOf(cur);
                    return i >= 0 && i < q.length - 1 ? "auto" : "none";
                  })(),
                }}
                onMouseDown={(e) =>
                  (e.currentTarget.style.transform = "scale(0.96)")
                }
                onMouseUp={(e) =>
                  (e.currentTarget.style.transform = "scale(1)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.transform = "scale(1)")
                }
              >
                {/* 右二重矢印 */}
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
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
