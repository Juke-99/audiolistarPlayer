import type { ParsedLrc, LyricsLine } from "./lrc";

type MMNativeTag = { id: string; value: any };
type MMResult = {
  common?: { lyrics?: string[] };
  native?: Record<string, MMNativeTag[]>;
};

export type EmbeddedLyrics =
  | { source: "sylt"; parsed: ParsedLrc }
  | { source: "uslt"; text: string };

/** SYLT (synchronised lyrics) の syncText を ParsedLrc に変換 */
function syltToLrc(syltValue: any): ParsedLrc | null {
  const syncText = syltValue?.syncText;
  if (!Array.isArray(syncText) || syncText.length === 0) return null;

  const tsFmt = syltValue.timeStampFormat ?? 2; // 1=MPEG frames, 2=ms
  if (tsFmt !== 2) return null; // ms 形式以外は非対応

  const lines: LyricsLine[] = [];
  let curText = "";
  let curStart = 0;

  for (const entry of syncText) {
    const t = Number(entry?.timestamp ?? 0) / 1000;
    const text = String(entry?.text ?? "");

    if (text.includes("\n")) {
      const parts = text.split("\n");
      if (curText === "" && parts[0]) curStart = t;
      curText += parts[0];
      if (curText.trim()) lines.push({ start: curStart, text: curText.trim() });
      for (let i = 1; i < parts.length - 1; i++) {
        if (parts[i].trim()) lines.push({ start: t, text: parts[i].trim() });
      }
      curText = parts[parts.length - 1] ?? "";
      curStart = t;
    } else {
      if (curText === "") curStart = t;
      curText += text;
    }
  }
  if (curText.trim()) lines.push({ start: curStart, text: curText.trim() });

  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    lines[i].end = i + 1 < lines.length ? lines[i + 1].start : undefined;
  }

  return { format: "lrc", lines };
}

export function extractEmbeddedLyrics(mm: MMResult): EmbeddedLyrics | null {
  // 1) SYLT を全 native タグから探す（ID3v2.3 / 2.4 両対応）
  const native = mm.native ?? {};
  for (const group of Object.values(native)) {
    if (!Array.isArray(group)) continue;
    for (const tag of group) {
      if (tag.id === "SYLT") {
        const parsed = syltToLrc(tag.value);
        if (parsed && parsed.lines.length > 0) {
          return { source: "sylt", parsed };
        }
      }
    }
  }

  // 2) USLT は music-metadata が common.lyrics にまとめてくれる
  const unsynced = mm.common?.lyrics;
  if (Array.isArray(unsynced) && unsynced.length > 0) {
    const text = unsynced.join("\n\n").trim();
    if (text) return { source: "uslt", text };
  }

  return null;
}
