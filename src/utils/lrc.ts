export type LyricsWord = {
  start: number; // 秒
  text: string;
};

export type LyricsLine = {
  start: number; // 行頭時刻（秒）
  end?: number; // 次の行までの時刻（ハイライト終了判定用）
  text: string; // プレーンテキスト（words があれば結合された結果）
  words?: LyricsWord[]; // Enhanced LRC：単語ごとの時刻
};

export type ParsedLrc = {
  format: "lrc" | "enhanced-lrc";
  lines: LyricsLine[];
  meta?: {
    title?: string;
    artist?: string;
    album?: string;
    offset?: number;
  };
};

const TIME_RE = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
const META_RE = /^\[(ti|ar|al|by|offset|length|au|re|ve|la):\s*(.*?)\]\s*$/i;
const ENHANCED_RE = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/g;

function parseTime(m1: string, m2: string, m3?: string): number {
  const min = parseInt(m1, 10);
  const sec = parseInt(m2, 10);
  const ms = m3 ? parseInt(m3.padEnd(3, "0").slice(0, 3), 10) : 0;
  return min * 60 + sec + ms / 1000;
}

function formatTime(sec: number): string {
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function parseLrc(text: string): ParsedLrc {
  const lines: LyricsLine[] = [];
  const meta: NonNullable<ParsedLrc["meta"]> = {};
  let isEnhanced = false;

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const metaMatch = META_RE.exec(trimmed);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      const value = metaMatch[2];
      if (key === "ti") meta.title = value;
      else if (key === "ar") meta.artist = value;
      else if (key === "al") meta.album = value;
      else if (key === "offset") meta.offset = parseInt(value, 10) / 1000;
      continue;
    }

    // 行頭の時刻タグ群を集める
    const timeStamps: number[] = [];
    TIME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_RE.exec(trimmed)))
      timeStamps.push(parseTime(m[1], m[2], m[3]));
    if (timeStamps.length === 0) continue;

    let textPart = trimmed.replace(TIME_RE, "").trim();

    // Enhanced LRC：単語ごとの <mm:ss.xx>
    let words: LyricsWord[] | undefined;
    if (ENHANCED_RE.test(textPart)) {
      isEnhanced = true;
      ENHANCED_RE.lastIndex = 0;
      words = [];
      let cursor = 0;
      let wm: RegExpExecArray | null;
      while ((wm = ENHANCED_RE.exec(textPart))) {
        const t = parseTime(wm[1], wm[2], wm[3]);
        const before = textPart.slice(cursor, wm.index);
        if (before && words.length > 0) words[words.length - 1].text += before;
        words.push({ start: t, text: "" });
        cursor = ENHANCED_RE.lastIndex;
      }
      const tail = textPart.slice(cursor);
      if (tail && words.length > 0) words[words.length - 1].text += tail;
      textPart = words.map((w) => w.text).join("");
    }

    for (const t of timeStamps) {
      lines.push({
        start: t,
        text: textPart,
        words: words ? words.map((w) => ({ ...w })) : undefined,
      });
    }
  }

  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    lines[i].end = i + 1 < lines.length ? lines[i + 1].start : undefined;
  }

  return {
    format: isEnhanced ? "enhanced-lrc" : "lrc",
    lines,
    meta: Object.keys(meta).length ? meta : undefined,
  };
}

export function serializeLrc(parsed: ParsedLrc): string {
  const out: string[] = [];
  if (parsed.meta) {
    if (parsed.meta.title) out.push(`[ti:${parsed.meta.title}]`);
    if (parsed.meta.artist) out.push(`[ar:${parsed.meta.artist}]`);
    if (parsed.meta.album) out.push(`[al:${parsed.meta.album}]`);
    if (parsed.meta.offset) {
      out.push(`[offset:${Math.round(parsed.meta.offset * 1000)}]`);
    }
  }
  for (const line of parsed.lines) {
    const tag = `[${formatTime(line.start)}]`;
    if (line.words && line.words.length > 0) {
      let body = "";
      for (const w of line.words) body += `<${formatTime(w.start)}>${w.text}`;
      out.push(tag + body);
    } else {
      out.push(tag + line.text);
    }
  }
  return out.join("\n");
}

/** 行ごとの時刻を持たないテキストを LRC 化（一旦 0 秒に詰めて、後で編集 UI で時刻を打つ） */
export function plainTextToLrc(text: string): ParsedLrc {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    format: "lrc",
    lines: lines.map((t) => ({ start: 0, text: t })),
  };
}
