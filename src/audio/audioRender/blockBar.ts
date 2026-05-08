export type BlockBarsOptions = {
  // 従来パラメータ
  bars?: number;
  gap?: number;
  blockHeight?: number;
  smoothing?: number;
  bgClear?: string | null;
  composite?: GlobalCompositeOperation;

  // ★正方形セルモード
  square?: boolean; // true: 正方形セルで描画
  cellSize?: number; // セル一辺の長さ(px) 例: 12
  cellGap?: number; // セル間の隙間(px)     例: 2

  // 色（パレット or 固定色 or HSL）
  color?: string; // 固定色（指定時は他を無視）
  palette?: string[]; // 例: ["#ff4d4f","#22c55e","#3b82f6"]
  paletteMode?: "perBar" | "perBlock";
  paletteCycleSpeed?: number;

  // HSL（パレット/固定色なしの時だけ使用）
  hueBase?: number;
  hueRotate?: number;
  hueStride?: number;
  sat?: number;
  satRiseBoost?: number;
  light?: number;
  lightRiseBoost?: number;
  alphaBase?: number;
  alphaStep?: number;

  // 対数周波数マッピング用
  sampleRate?: number; // analyser.context.sampleRate を渡す
  fMin?: number; // 既定: 30 Hz
  fMax?: number; // 既定: min(sampleRate/2, 16000)
  logScale?: boolean; // 既定: sampleRate が渡されていれば true
  tiltDbPerOctave?: number; // 既定: 0（3〜6 で高音側を明るくできる）
};

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));
const safe = (v: unknown, fb: number) =>
  Number.isFinite(Number(v)) ? Number(v) : fb;

// rgb/palette helpers
type RGB = { r: number; g: number; b: number };
const hexToRgb = (hex: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 255, g: 0, b: 128 };
  const v = parseInt(m[1], 16);

  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
};
const rgbToCss = ({ r, g, b }: RGB, a = 1) =>
  `rgba(${r | 0},${g | 0},${b | 0},${clamp(a, 0, 1)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});
const samplePalette = (palette: string[], phase: number, alpha = 1): string => {
  if (!palette.length) return "rgba(255,0,128,1)";
  if (palette.length === 1) return rgbToCss(hexToRgb(palette[0]), alpha);

  const p = ((phase % 1) + 1) % 1;
  const seg = 1 / palette.length;
  const idx = Math.floor(p / seg);
  const t = (p - idx * seg) / seg;
  const c1 = hexToRgb(palette[idx]);
  const c2 = hexToRgb(palette[(idx + 1) % palette.length]);

  return rgbToCss(mix(c1, c2, t), alpha);
};

const hslaSafe = (
  h: number,
  s: number,
  l: number,
  a: number,
  fb = "rgb(255,0,128)",
) => {
  const H = Math.round(clamp(safe(h, 0), 0, 360));
  const S = Math.round(clamp(safe(s, 0), 0, 100));
  const L = Math.round(clamp(safe(l, 0), 0, 100));
  const A = Math.round(clamp(safe(a, 1), 0, 1) * 1000) / 1000;
  const str = `hsla(${H}, ${S}%, ${L}%, ${A})`;

  return Number.isFinite(H) &&
    Number.isFinite(S) &&
    Number.isFinite(L) &&
    Number.isFinite(A)
    ? str
    : fb;
};

export function drawBlockBars(
  ctx: CanvasRenderingContext2D,
  spectrum: Uint8Array,
  prevLevels: Float32Array,
  width: number,
  height: number,
  opt: BlockBarsOptions = {},
  frame = 0,
) {
  // ----- ベース設定 -----
  const smoothing = clamp(safe(opt.smoothing ?? 0.6, 0.6), 0, 0.99);

  // 背景は必ず塗る（透明クリアで白地に負けるのを防ぐ）
  if (opt.bgClear) {
    ctx.fillStyle = opt.bgClear;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  const prevComp = ctx.globalCompositeOperation;
  if (opt.composite) ctx.globalCompositeOperation = opt.composite;

  // ----- レイアウト（通常 or 正方形セル） -----
  const square = !!opt.square;
  const cellSize = Math.max(2, Math.floor(safe(opt.cellSize ?? 12, 12)));
  const cellGap = Math.max(0, Math.floor(safe(opt.cellGap ?? 2, 2)));
  let bars: number, barW: number, gap: number, blockH: number;

  if (square) {
    // 横方向のセル数 = (width + gap) / (cell + gap)
    bars = clamp(Math.floor((width + cellGap) / (cellSize + cellGap)), 1, 2000);
    barW = cellSize;
    gap = cellGap;
    blockH = cellSize; // ← 正方形
  } else {
    // 従来互換
    const cfgBars = Math.max(
      8,
      Math.floor(safe(opt.bars ?? Math.floor(width / 7), width / 7)),
    );

    bars = cfgBars;
    gap = safe(opt.gap ?? 1.5, 1.5);
    blockH = Math.max(1, Math.floor(safe(opt.blockHeight ?? 3, 3)));
    barW = Math.max(1, Math.floor((width - (bars - 1) * gap) / bars));
  }

  // バーごとの担当ビン範囲を事前計算
  const sr = opt.sampleRate;
  const useLog = opt.logScale !== false && !!sr;
  const binHz = sr ? sr / (spectrum.length * 2) : 0; // 1ビンの周波数幅

  const fMin = clamp(safe(opt.fMin ?? 30, 30), 1, sr ? sr / 2 : 22000);
  const fMaxDefault = sr ? Math.min(sr / 2, 16000) : 16000;
  const fMax = clamp(
    safe(opt.fMax ?? fMaxDefault, fMaxDefault),
    fMin * 2,
    sr ? sr / 2 : 22000,
  );
  const logRatio = Math.log(fMax / fMin);

  const barBins: Array<[number, number, number]> = new Array(bars); // [start, end, centerHz]

  if (useLog) {
    for (let i = 0; i < bars; i++) {
      const fLo = fMin * Math.exp((logRatio * i) / bars);
      const fHi = fMin * Math.exp((logRatio * (i + 1)) / bars);
      const lo = Math.min(spectrum.length - 1, Math.floor(fLo / binHz));
      const hi = Math.min(
        spectrum.length,
        Math.max(lo + 1, Math.ceil(fHi / binHz)),
      );

      barBins[i] = [lo, hi, Math.sqrt(fLo * fHi)]; // 中心周波数は幾何平均
    }
  } else {
    const binsPerBar = Math.max(1, Math.floor(spectrum.length / bars));

    for (let i = 0; i < bars; i++) {
      const lo = i * binsPerBar;
      const hi = Math.min(spectrum.length, lo + binsPerBar);
      barBins[i] = [lo, hi, 0];
    }
  }

  // チルト（オクターブごとのゲイン補正）
  const tilt = safe(opt.tiltDbPerOctave ?? 0, 0);

  // ----- カラー設定 -----
  const solid = opt.color;
  const palette = (opt.palette?.length ?? 0) >= 2 ? opt.palette! : undefined;
  const paletteMode = opt.paletteMode ?? "perBar";
  const cycle = safe(opt.paletteCycleSpeed ?? 0.01, 0.01);

  // HSL モード用
  const hueBase = clamp(safe(opt.hueBase ?? 210, 210), 0, 360);
  const hueRotate = safe(opt.hueRotate ?? 0.6, 0.6);
  const hueStride = safe(opt.hueStride ?? 9, 9);
  const satBase = clamp(safe(opt.sat ?? 86, 86), 0, 100);
  const satBoost = clamp(safe(opt.satRiseBoost ?? 16, 16), 0, 100);
  const lightBase = clamp(safe(opt.light ?? 48, 48), 0, 100);
  const lightBoost = clamp(safe(opt.lightRiseBoost ?? 12, 12), 0, 100);
  const alphaBase = clamp(safe(opt.alphaBase ?? 0.95, 0.95), 0, 1);
  const alphaStep = clamp(safe(opt.alphaStep ?? 0.02, 0.02), 0, 1);

  // ----- 各バー描画 -----
  for (let i = 0; i < bars; i++) {
    const [start, end, centerHz] = barBins[i];
    let avg: number;
    //let sum = 0;

    //for (let k = start; k < end; k++) sum += spectrum[k];

    // 担当ビンが 1 個以下なら線形補間で連続値を取り出す
    if (useLog && centerHz > 0 && end - start <= 1 && binHz > 0) {
      const binF = centerHz / binHz;
      const i0 = Math.max(0, Math.min(spectrum.length - 2, Math.floor(binF)));
      const t = binF - i0;
      avg = spectrum[i0] * (1 - t) + spectrum[i0 + 1] * t;
    } else {
      // 通常の平均（複数ビン担当時）
      let sum = 0;
      for (let k = start; k < end; k++) sum += spectrum[k];
      avg = sum / Math.max(1, end - start);
    }

    // オプションで高音側にゲイン補正
    if (useLog && tilt !== 0 && centerHz > 0) {
      const oct = Math.log2(centerHz / 1000);
      const gain = Math.pow(10, (tilt * oct) / 20);
      avg = clamp(avg * gain, 0, 255);
    }

    const norm = Math.pow(avg / 255, 1.1); // 0..1
    const target = norm * height;
    const prev = prevLevels[i] || 0;
    const level = prev * smoothing + target * (1 - smoothing);
    prevLevels[i] = level;

    // 何段積むか（正方形セルなら “セル＋ギャップ” 単位に量子化）
    let blocks: number;
    if (square) {
      const cellPitch = blockH + cellGap; // 1段のピッチ
      blocks = Math.max(0, Math.floor(level / cellPitch));
    } else {
      blocks = Math.max(0, Math.floor(level / (blockH + 1)));
    }

    const rising = level > prev + 0.6;
    const x = Math.round(i * (barW + gap));

    // パレット位相
    const barPhase = i / Math.max(1, bars - 1) + frame * cycle;

    for (let b = 0; b < blocks; b++) {
      // y 座標（正方形セルは gap を使って等間隔）
      const y = square
        ? height - (b + 1) * (blockH + cellGap)
        : height - (b + 1) * (blockH + 1);

      // ★色の決定
      if (solid) {
        ctx.fillStyle = solid;
      } else if (palette) {
        const phase =
          paletteMode === "perBlock" ? barPhase + b * 0.03 : barPhase;
        const alpha = clamp(alphaBase + b * alphaStep, 0, 1);
        ctx.fillStyle = samplePalette(palette, phase, alpha);
      } else {
        const hue = (hueBase + frame * hueRotate + i * hueStride) % 360;
        const s = clamp(satBase + (rising ? satBoost : 0), 0, 100);
        const l = clamp(lightBase + (rising ? lightBoost : 0), 0, 100);
        const l2 = clamp(l + b * 0.6, 0, 100);
        const a = clamp(alphaBase + b * alphaStep, 0, 1);
        ctx.fillStyle = hslaSafe(hue, s, l2, a);
      }

      ctx.fillRect(x, y - blockH, barW, blockH);
    }
  }

  ctx.globalCompositeOperation = prevComp;
}
