import { useMemo, useRef } from "react";

type PlayOpts = {
  id: string;
  url: string;
  /** 任意：プレビュー開始秒（指定しない＝フル再生） */
  previewStartSec?: number;
  /** 任意：プレビュー終了秒（指定しない＝フル再生） */
  previewEndSec?: number;
};

type PreviewEndInfo = { id: string; reason: "preview-end" | "ended" };
type PreviewEndListener = (info: PreviewEndInfo) => void;

type Engine = {
  enable: () => Promise<void>;
  getAnalyser: () => AnalyserNode | null;
  play: (opts: PlayOpts) => Promise<void>;
  stop: () => Promise<void>;
  /** プレビュー区間が終わった/フルで ended に到達した通知 */
  onPreviewEnd: (cb: PreviewEndListener) => () => void;
};

export function usePreviewEngine({
  fadeInMs = 120,
  fadeOutMs = 140,
}: { fadeInMs?: number; fadeOutMs?: number } = {}): Engine {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mediaSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // 以前の setTimeout 用の参照（現在は未使用。残しておくが実質 noop）
  const previewTimerRef = useRef<number | null>(null);
  const currentUrlRef = useRef<string | null>(null);

  // --- 連続プレビュー用（イベント購読） ---
  const listenersRef = useRef<Set<PreviewEndListener>>(new Set());
  const currentRef = useRef<{ id: string; previewEnd?: number } | null>(null);
  const boundRef = useRef(false);

  const onPreviewEnd = (cb: PreviewEndListener) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  };

  const notifyPreviewEnd = (reason: "preview-end" | "ended") => {
    const cur = currentRef.current;
    if (!cur) return;
    for (const cb of listenersRef.current) {
      try {
        cb({ id: cur.id, reason });
      } catch {}
    }
    // 多重発火防止：いったんクリア（次の play() で再設定）
    currentRef.current = null;
  };

  async function ensureNodes() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    if (!audioElRef.current) {
      const el = document.createElement("audio");
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.loop = false;
      audioElRef.current = el;
    }

    // Graph を（未構築/ズレていたら）構築
    if (
      !mediaSrcRef.current ||
      mediaSrcRef.current.mediaElement !== audioElRef.current
    ) {
      // 既存ノードの切断
      try {
        mediaSrcRef.current?.disconnect();
        gainRef.current?.disconnect();
        analyserRef.current?.disconnect();
      } catch {}

      // 新規構築
      mediaSrcRef.current = audioCtxRef.current!.createMediaElementSource(
        audioElRef.current!
      );

      if (!gainRef.current) {
        gainRef.current = audioCtxRef.current!.createGain();
        gainRef.current.gain.value = 0; // 初期はミュート（フェードインで上げる）
      }
      if (!analyserRef.current) {
        analyserRef.current = audioCtxRef.current!.createAnalyser();
        analyserRef.current.fftSize = 2048;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      mediaSrcRef.current.connect(gainRef.current);
      gainRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioCtxRef.current!.destination);
    }

    // 一度だけイベントを張る（フル終了 and プレビュー終端検知）
    if (!boundRef.current && audioElRef.current) {
      const audio = audioElRef.current;

      // フル再生で自然に末端へ到達したとき
      audio.addEventListener("ended", () => {
        if (currentRef.current) notifyPreviewEnd("ended");
      });

      // プレビュー終端（previewEndSec）を timeupdate で確実に検知
      audio.addEventListener("timeupdate", () => {
        const end = currentRef.current?.previewEnd;
        if (typeof end !== "number") return;
        // 少し手前でフェードアウト開始（クリック音対策）
        if (audio.currentTime >= end - 0.03) {
          try {
            const now = audioCtxRef.current!.currentTime;
            const g = gainRef.current!;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(
              0,
              now + Math.min(0.08, fadeOutMs / 1000)
            );
          } catch {}
          audio.pause();
          audio.currentTime = end;
          notifyPreviewEnd("preview-end");
        }
      });

      boundRef.current = true;
    }
  }

  function clearPreviewTimer() {
    if (previewTimerRef.current != null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }

  async function enable() {
    await ensureNodes();
    if (audioCtxRef.current!.state === "suspended") {
      await audioCtxRef.current!.resume();
    }
  }

  function getAnalyser() {
    return analyserRef.current ?? null;
  }

  async function play(opts: PlayOpts) {
    await ensureNodes();
    await enable(); // ユーザー操作内で呼ばれる想定（クリック時など）

    const audio = audioElRef.current!;
    const gain = gainRef.current!;
    clearPreviewTimer();

    // ソースが変わる時は停止→URL差し替え
    if (currentUrlRef.current !== opts.url) {
      // 一応フェードアウト
      try {
        const now = audioCtxRef.current!.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeOutMs / 1000);
      } catch {}
      audio.pause();
      audio.src = opts.url;
      currentUrlRef.current = opts.url;
    }

    // 再生位置（フル再生なら 0 へ、プレビューなら start へ）
    const hasPreviewRange =
      typeof opts.previewStartSec === "number" &&
      typeof opts.previewEndSec === "number" &&
      opts.previewEndSec! > opts.previewStartSec!;

    audio.currentTime = hasPreviewRange ? opts.previewStartSec! : 0;

    // いまのプレビュー終端を記録（フル再生は undefined）
    currentRef.current = { id: opts.id, previewEnd: opts.previewEndSec };

    // フェードインして再生
    const now = audioCtxRef.current!.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeInMs / 1000);

    await audio.play();
  }

  async function stop() {
    if (!audioElRef.current || !audioCtxRef.current) return;
    clearPreviewTimer();
    const audio = audioElRef.current!;
    const gain = gainRef.current!;
    const now = audioCtxRef.current!.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeOutMs / 1000);
    } catch {}
    setTimeout(() => {
      audio.pause();
    }, fadeOutMs);
  }

  // Hook 的には memo で同一参照を返すだけでOK
  return useMemo<Engine>(
    () => ({ enable, getAnalyser, play, stop, onPreviewEnd }),
    []
  );
}
