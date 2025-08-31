import { useEffect, useRef } from "react";
import { drawBlockBars } from "../audio/audioRender/blockBar";
import { useEngine } from "../contexts/EngineContext";

type Props = {
  white?: boolean;
  square?: boolean;
  palette?: string[];
  paletteCycleSpeed?: number;
  cellSize?: number;
  cellGap?: number;
  smoothing?: number;
};

export default function BackgroundWave({
  white = true,
  square = true,
  palette = ["#fca5a5", "#93c5fd", "#86efac"],
  paletteCycleSpeed = 0.003,
  cellSize = 14,
  cellGap = 3,
  smoothing = 0.72,
}: Props) {
  const engine = useEngine();
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cvs = bgCanvasRef.current;
    if (!cvs) return;
    const ctx2d = cvs.getContext("2d");
    if (!ctx2d) return;

    const dpr = window.devicePixelRatio || 1;
    let width = 0,
      height = 0,
      frame = 0;
    let prevLevels = new Float32Array(0);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      cvs.width = Math.floor(width * dpr);
      cvs.height = Math.floor(height * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      prevLevels = new Float32Array(Math.max(24, Math.floor(width / 10)) + 64);
    };
    resize();
    window.addEventListener("resize", resize);

    const idle = (t: number) => {
      // 解析器がまだ無いときの控えめな背景アニメ
      ctx2d.fillStyle = white ? "white" : "#0b1020";
      ctx2d.fillRect(0, 0, width, height);
      ctx2d.globalAlpha = 0.08;
      ctx2d.beginPath();
      const A = height * 0.08;
      const mid = height * 0.55;
      for (let x = 0; x < width; x++) {
        const y = mid + Math.sin((x + t * 120) * 0.01) * A;
        if (x === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;
    };

    let spectrum = new Uint8Array(1024); // サイズは後で合わせる

    const loop = () => {
      const analyser = engine.getAnalyser?.();
      if (analyser) {
        // ここで毎フレーム確実に設定（初期化後でも反映される）
        if (analyser.fftSize !== 1024) analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.9;

        if (spectrum.length !== analyser.frequencyBinCount) {
          spectrum = new Uint8Array(analyser.frequencyBinCount);
        }
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
      } else {
        idle(performance.now() * 0.0015);
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    loop();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
    // 依存はUI系だけ。engine は参照安定のはずなので1回でOK
  }, [
    engine,
    white,
    square,
    palette,
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
