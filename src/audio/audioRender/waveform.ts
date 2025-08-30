export function drawTimeDomainWaveform(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  const mid = height / 2;
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width;
    const v = (data[i] - 128) / 128; // -1..1
    const y = mid + v * (mid - 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
