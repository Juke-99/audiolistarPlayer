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

type TickInfo = {
  id: string | null;
  /** 現在位置（秒） */
  currentTime: number;
  /** 総再生時間（秒、未取得時は NaN） */
  duration: number;
  /** 一時停止中か */
  paused: boolean;
  /** バッファ済みの範囲（複数レンジ） */
  buffered: { start: number; end: number }[];
};

type TickListener = (info: TickInfo) => void;

type Engine = {
  enable: () => Promise<void>;
  getAnalyser: () => AnalyserNode | null;
  play: (opts: PlayOpts) => Promise<void>;
  stop: () => Promise<void>;
  /** プレビュー区間が終わった/フルで ended に到達した通知 */
  onPreviewEnd: (cb: PreviewEndListener) => () => void;
  pause: () => void;
  resume: () => Promise<void>;
  toggle: () => Promise<void>;
  seek: (sec: number) => void;
  onTick: (cb: TickListener) => () => void;
  getState: () => TickInfo;
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
  const currentUrlRef = useRef<string | null>(null);

  // --- 連続プレビュー用（イベント購読） ---
  const listenersRef = useRef<Set<PreviewEndListener>>(new Set());
  const currentRef = useRef<{ id: string; previewEnd?: number } | null>(null);
  const boundRef = useRef(false);

  // プレイヤー状態通知用（UIの時間表示/ボタン状態）
  const tickListenersRef = useRef<Set<TickListener>>(new Set());

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

  const getBufferedArray = (
    audio: HTMLAudioElement
  ): { start: number; end: number }[] => {
    const arr: { start: number; end: number }[] = [];
    const r = audio.buffered;

    for (let i = 0; i < r.length; i++) {
      arr.push({ start: r.start(i), end: r.end(i) });
    }

    return arr;
  };

  const emitTick = () => {
    const audio = audioElRef.current;
    const id = currentRef.current?.id ?? null;
    const info: TickInfo = {
      id,
      currentTime: audio ? audio.currentTime : 0,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : NaN,
      paused: audio ? audio.paused : true,
      buffered: audio ? getBufferedArray(audio) : [],
    };

    for (const cb of tickListenersRef.current) {
      try {
        cb(info);
      } catch {}
    }
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
        analyserRef.current.smoothingTimeConstant = 0.86; // 0.8 より少し滑らか
        analyserRef.current.minDecibels = -90; // ダイナミクス拡大
        analyserRef.current.maxDecibels = -10;
      }

      mediaSrcRef.current.connect(analyserRef.current!); // 解析はゲインより前でタップ
      mediaSrcRef.current.connect(gainRef.current!); // 音はゲインへ
      gainRef.current!.connect(audioCtxRef.current!.destination); // 出力へ
    }

    // 一度だけイベントを張る（フル終了 and プレビュー終端検知）
    if (!boundRef.current && audioElRef.current) {
      const audio = audioElRef.current;

      // フル再生で自然に末端へ到達したとき
      audio.addEventListener("ended", () => {
        emitTick();
        if (currentRef.current) notifyPreviewEnd("ended");
      });

      // プレビュー終端（previewEndSec）を timeupdate で確実に検知
      audio.addEventListener("timeupdate", () => {
        const end = currentRef.current?.previewEnd;
        if (typeof end === "number" && audio.currentTime >= end - 0.03) {
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
          emitTick();
          notifyPreviewEnd("preview-end");
          return;
        }

        emitTick();
      });

      audio.addEventListener("loadedmetadata", emitTick);
      audio.addEventListener("play", emitTick);
      audio.addEventListener("pause", emitTick);
      audio.addEventListener("progress", emitTick);

      boundRef.current = true;
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
    emitTick();
  }

  async function stop() {
    if (!audioElRef.current || !audioCtxRef.current) return;
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
      emitTick();
    }, fadeOutMs);
  }

  function pause() {
    if (!audioElRef.current) return;
    audioElRef.current.pause();
    emitTick();
  }

  async function resume() {
    await enable();
    if (!audioElRef.current) return;
    await audioElRef.current.play();
    emitTick();
  }

  async function toggle() {
    const a = audioElRef.current;
    if (!a) return;
    if (a.paused) await resume();
    else pause();
  }

  function seek(sec: number) {
    const a = audioElRef.current;
    if (!a) return;
    const dur = Number.isFinite(a.duration) ? a.duration : sec;
    const end = currentRef.current?.previewEnd; // プレビュー中は飛び出さないように
    const max = typeof end === "number" ? Math.min(dur, end) : dur;
    a.currentTime = Math.max(0, Math.min(sec, max));
    emitTick();
  }

  function onTick(cb: TickListener) {
    tickListenersRef.current.add(cb);
    // 初回即時
    cb(getState());
    return () => tickListenersRef.current.delete(cb);
  }

  function getState(): TickInfo {
    const audio = audioElRef.current;
    return {
      id: currentRef.current?.id ?? null,
      currentTime: audio ? audio.currentTime : 0,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : NaN,
      paused: audio ? audio.paused : true,
      buffered: audio ? getBufferedArray(audio) : [],
    };
  }

  // Hook 的には memo で同一参照を返すだけでOK
  return useMemo<Engine>(
    () => ({
      enable,
      getAnalyser,
      play,
      stop,
      onPreviewEnd,
      pause,
      resume,
      toggle,
      seek,
      onTick,
      getState,
    }),
    []
  );
}
