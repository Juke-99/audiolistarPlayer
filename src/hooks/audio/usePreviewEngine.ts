// src/audio/usePreviewEngine.ts
import { useMemo, useRef } from "react";

type PlayOpts = {
  id: string;
  url: string;
  /** 任意：プレビュー開始秒（指定しない＝フル再生） */
  previewStartSec?: number;
  /** 任意：プレビュー終了秒（指定しない＝フル再生） */
  previewEndSec?: number;
};

type Engine = {
  enable: () => Promise<void>;
  getAnalyser: () => AnalyserNode | null;
  play: (opts: PlayOpts) => Promise<void>;
  stop: () => Promise<void>;
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
  const previewTimerRef = useRef<number | null>(null);
  const currentUrlRef = useRef<string | null>(null);

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
    if (
      !mediaSrcRef.current ||
      mediaSrcRef.current.mediaElement !== audioElRef.current
    ) {
      // 再作成（同一audioでもOK）
      if (mediaSrcRef.current) {
        try {
          mediaSrcRef.current.disconnect();
        } catch {}
      }
      const ctx = audioCtxRef.current!;
      mediaSrcRef.current = ctx.createMediaElementSource(audioElRef.current!);

      // ノード鎖：media -> gain -> analyser -> destination
      if (!gainRef.current) {
        gainRef.current = audioCtxRef.current!.createGain();
        gainRef.current.gain.value = 0;
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

    try {
      audio.currentTime = hasPreviewRange ? opts.previewStartSec! : 0;
    } catch {
      // たまに ready 前に set で例外になるブラウザがあるので保険
      audio.addEventListener(
        "loadedmetadata",
        () => {
          audio.currentTime = hasPreviewRange ? opts.previewStartSec! : 0;
        },
        { once: true }
      );
    }

    // ループや区切りは明示的に無効化
    audio.loop = false;
    audio.onended = null;

    // フル再生：preview タイマーは張らない
    // プレビュー：end で止めるタイマーを張る
    if (hasPreviewRange) {
      const playWindow = Math.max(
        0,
        (opts.previewEndSec! - opts.previewStartSec!) * 1000
      );
      previewTimerRef.current = window.setTimeout(async () => {
        previewTimerRef.current = null;
        // やさしく止める
        const now = audioCtxRef.current!.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeOutMs / 1000);
        setTimeout(() => {
          audio.pause();
        }, fadeOutMs);
      }, playWindow);
    }

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
  return useMemo<Engine>(() => ({ enable, getAnalyser, play, stop }), []);
}
