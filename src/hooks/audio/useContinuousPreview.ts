import { useCallback, useEffect, useState } from "react";

/** 最小要件だけ満たすエンジン型（usePreviewEngine の公開APIに一致） */
type PreviewEngine = {
  enable: () => Promise<void>;
  play: (opts: {
    id: string;
    url: string;
    previewStartSec?: number;
    previewEndSec?: number;
  }) => Promise<void>;
  stop: () => Promise<void>;
  onPreviewEnd: (
    cb: (info: { id: string; reason: "preview-end" | "ended" }) => void
  ) => () => void;
};

type Options<T> = {
  tracks: T[];
  engine: PreviewEngine;

  /** あなたの Track 型から必要な情報を取り出すゲッター */
  getId: (t: T) => string;
  getUrl: (t: T) => string;
  getPreviewStartSec?: (t: T) => number | undefined;
  getPreviewEndSec?: (t: T) => number | undefined;
  getDuration?: (t: T) => number | undefined;

  /** プレビュー区間未指定の時のフォールバック（秒） */
  defaultWindowSec?: number;

  /** 曲が切り替わった時に呼ばれる（任意） */
  onTrackChange?: (info: { index: number; id: string; track: T }) => void;
};

export function useContinuousPreview<T>(opts: Options<T>) {
  const {
    tracks,
    engine,
    getId,
    getUrl,
    getPreviewStartSec,
    getPreviewEndSec,
    getDuration,
    defaultWindowSec = 30,
    onTrackChange,
  } = opts;

  const [running, setRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const notifyChange = useCallback(
    (i: number) => {
      const t = tracks[i];
      const id = getId(t);
      setCurrentIndex(i);
      setCurrentId(id);
      onTrackChange?.({ index: i, id, track: t });
    },
    [tracks, getId, onTrackChange]
  );

  const playIndex = useCallback(
    async (i: number) => {
      const t = tracks[i];
      if (t == null) return false;

      const start = getPreviewStartSec?.(t) ?? 0;

      let end = getPreviewEndSec?.(t);
      if (typeof end !== "number") {
        const dur = getDuration?.(t);
        end = Math.min(defaultWindowSec, dur ?? defaultWindowSec);
      }

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end!) ||
        end! - start <= 0.2
      ) {
        return false; // 無効区間はスキップ判定
      }

      await engine.enable();
      await engine.play({
        id: getId(t),
        url: getUrl(t),
        previewStartSec: start,
        previewEndSec: end,
      });
      notifyChange(i);
      return true;
    },
    [
      tracks,
      engine,
      getId,
      getUrl,
      getPreviewStartSec,
      getPreviewEndSec,
      getDuration,
      defaultWindowSec,
      notifyChange,
    ]
  );

  const startFromIndex = useCallback(
    async (i: number) => {
      setRunning(true);
      const ok = await playIndex(i);
      if (!ok) {
        // 無効区間なら次へ
        const next = i + 1;
        if (next < tracks.length) void startFromIndex(next);
        else setRunning(false);
      }
    },
    [playIndex, tracks.length]
  );

  const startFromId = useCallback(
    async (id: string) => {
      const i = tracks.findIndex((t) => getId(t) === id);
      if (i >= 0) await startFromIndex(i);
    },
    [tracks, getId, startFromIndex]
  );

  // 既存プレビューボタンに割り当てる用
  const handlePreviewClickByIndex = useCallback(
    async (i: number) => {
      await startFromIndex(i); // ← これだけで“この曲から順に”が始まる
    },
    [startFromIndex]
  );

  const handlePreviewClickById = useCallback(
    async (id: string) => {
      await startFromId(id);
    },
    [startFromId]
  );

  const stopContinuous = useCallback(() => {
    setRunning(false);
    setCurrentIndex(null);
    setCurrentId(null);
    engine.stop();
  }, [engine]);

  // プレビュー終了→次の曲へ
  useEffect(() => {
    const off = engine.onPreviewEnd(({ id }) => {
      if (!running) return;

      // 現在位置の確定
      const cur =
        currentIndex != null
          ? currentIndex
          : tracks.findIndex((t) => getId(t) === id);

      const next = cur + 1;
      if (next < tracks.length) {
        void playIndex(next);
      } else {
        setRunning(false);
        setCurrentIndex(null);
        setCurrentId(null);
      }
    });
    return off;
  }, [engine, running, currentIndex, tracks, playIndex, getId]);

  return {
    running,
    currentIndex, // ← これで表示を更新できる
    currentId,
    handlePreviewClickByIndex,
    handlePreviewClickById,
    startFromIndex,
    startFromId,
    stopContinuous,
  };
}
