import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTracks } from "../contexts/TrackContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BackgroundWave from "../components/BackgroundWave";
import { useEngine } from "../contexts/EngineContext";
import PlayerCard from "../components/PlayCard";
import GhostPlayerCard from "../components/GhostPlayerCard";

export default function PlayerPage() {
  const VISIBLE = 6; // 最大表示枚数
  const SHIFT_X = 18; // 右方向のずらし(px)
  const SHIFT_Y = 18; // 上方向のずらし(px)

  const { id } = useParams();
  const nav = useNavigate();
  const engine = useEngine();
  const { tracks } = useTracks();
  const { search } = useLocation();

  const [nowId, setNowId] = useState<string | null>(null);
  const [bufferedPct] = useState(0);

  // 再生状態（エンジンから購読）
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(NaN);
  const [paused, setPaused] = useState(true);
  const [, setBuffered] = useState<{ start: number; end: number }[]>([]);

  const advancedRef = useRef<string | null>(null);
  const routeIdRef = useRef<string | null>(null);
  const endGuardRef = useRef(false);

  // 現在のID / キュー / インデックスを参照するためのref（イベント内で安定して使う）
  const idRef = useRef<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const indexRef = useRef<number>(-1);

  // ★ パレットは安定参照に（点滅防止）
  const wavePalette = useMemo(() => ["#fca5a5", "#93c5fd", "#86efac"], []);

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

  // スタック表示用（現在→次…のみを並べる）
  const stackIds = useMemo(() => {
    if (!queueIds.length) return nowId ? [nowId] : [];

    const cur = nowId ?? id ?? queueIds[0];
    const i = queueIds.indexOf(cur);

    return i >= 0 ? queueIds.slice(i) : queueIds;
  }, [queueIds, nowId, id]);

  const effectiveId = nowId ?? id ?? null;
  const track = useMemo(
    () => (effectiveId ? tracks.find((t) => t.id === effectiveId) : tracks[0]),
    [tracks, effectiveId]
  );

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

  useEffect(() => {
    routeIdRef.current = id ?? null;
  }, [id]);

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

  // 任意IDへジャンプ
  const playById = useCallback(
    async (targetId: string) => {
      const t = tracks.find((x) => x.id === targetId);
      if (!t) return;

      await engine.play({
        id: t.id,
        url: t.url,
        previewStartSec: undefined,
        previewEndSec: undefined,
      });
      await ensurePlaying();

      setTimeout(() => {
        ensurePlaying();
      }, 60);
    },
    [engine, tracks, ensurePlaying]
  );

  // 前/次へ
  const playNextInQueue = useCallback(async () => {
    if (!queueIds.length) return;

    const cur = nowId ?? routeIdRef.current ?? queueIds[0];
    const i = queueIds.indexOf(cur ?? "");
    const nextId = i >= 0 ? queueIds[i + 1] : undefined;

    if (nextId) await playById(nextId);
  }, [queueIds, nowId, playById]);

  const playPrevInQueue = useCallback(async () => {
    if (!queueIds.length) return;

    const cur = nowId ?? routeIdRef.current ?? queueIds[0];
    const i = queueIds.indexOf(cur ?? "");
    const prevId = i > 0 ? queueIds[i - 1] : undefined;

    if (prevId) await playById(prevId);
  }, [queueIds, nowId, playById]);

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

      {/* 中央配置（スタック表示に置換） */}
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
        {/* ★ここがスタックコンテナ（大枠カードを重ねる）★ */}
        <div
          style={{
            position: "relative",
            width: "min(96vw, 1100px)",
            height: 640,
            paddingTop:
              Math.max(0, (Math.min(stackIds.length, VISIBLE) - 1) * SHIFT_Y) +
              8,
            paddingRight:
              Math.max(0, (Math.min(stackIds.length, VISIBLE) - 1) * SHIFT_X) +
              8,
            overflow: "visible",
          }}
        >
          {stackIds.slice(0, 6).map((tid, i) => {
            const t = tracks.find((x) => x.id === tid);
            if (!t) return null;

            const top = -i * SHIFT_Y; // 上へ詰める（負の top）
            const left = i * SHIFT_X; // 右へずらす
            const z = 100 - i;
            const isTop = i === 0;

            const tTitle =
              t.meta?.title ??
              t.file?.name?.replace(/\.[^.]+$/, "") ??
              "Unknown";
            const tSub =
              (t.meta?.artist ?? "Unknown Artist") +
              (t.meta?.album ? ` – ${t.meta.album}` : "");

            return (
              <div
                key={t.id}
                style={{
                  position: "absolute",
                  top,
                  left,
                  width: "100%",
                  height: "100%",
                  zIndex: z,
                }}
              >
                {isTop ? (
                  <PlayerCard
                    title={tTitle}
                    sub={tSub}
                    track={t}
                    bufferedPct={bufferedPct}
                    currentTime={currentTime}
                    duration={duration}
                    paused={paused}
                    onSeek={onSeek}
                    onToggle={onToggle}
                    onPrev={playPrevInQueue}
                    onNext={playNextInQueue}
                  />
                ) : (
                  <GhostPlayerCard
                    title={tTitle}
                    sub={tSub}
                    track={t}
                    onJump={() => playById(t.id)}
                  />
                )}
              </div>
            );
          })}

          {stackIds.length > 6 && (
            <div
              style={{
                position: "absolute",
                bottom: -10,
                right: 0,
                fontSize: 12,
                opacity: 0.8,
                padding: "2px 8px",
                borderRadius: 9999,
                background: "rgba(0,0,0,.06)",
              }}
            >
              +{stackIds.length - 6} more
            </div>
          )}
        </div>
      </div>
    </>
  );
}
