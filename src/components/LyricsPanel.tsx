import { useEffect, useMemo, useRef, useState } from "react";
import { getLyrics, type StoredLyrics } from "../utils/db";
import { parseLrc, type ParsedLrc } from "../utils/lrc";

type Props = {
  trackId: string | null;
  currentTime: number;
  onSeek?: (sec: number) => void;
};

export default function LyricsPanel({ trackId, currentTime, onSeek }: Props) {
  const [stored, setStored] = useState<StoredLyrics | null>(null);
  const [loading, setLoading] = useState(false);

  // 曲が切り替わったら歌詞をロード
  useEffect(() => {
    if (!trackId) {
      setStored(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const result = await getLyrics(trackId);
        if (!cancelled) setStored(result ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // LRC テキスト → パース
  const parsed = useMemo<ParsedLrc | null>(() => {
    if (!stored || stored.format === "text-only") return null;
    try {
      return parseLrc(stored.content);
    } catch (e) {
      console.warn("LRC parse failed", e);
      return null;
    }
  }, [stored]);

  // 現在再生時刻に対応する行の index（二分探索）
  const activeIndex = useMemo(() => {
    if (!parsed || parsed.lines.length === 0) return -1;
    let lo = 0,
      hi = parsed.lines.length - 1,
      ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (parsed.lines[mid].start <= currentTime) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, [parsed, currentTime]);

  // 自動スクロール
  const listRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  if (loading) {
    return (
      <div style={container}>
        <div style={emptyMsg}>歌詞を読み込み中…</div>
      </div>
    );
  }

  // 歌詞なし
  if (!stored) {
    return (
      <div style={container}>
        <div style={emptyMsg}>
          歌詞がありません
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 8 }}>
            （AI 生成は Phase 2 で対応予定）
          </div>
        </div>
      </div>
    );
  }

  // 無同期（USLT などのテキストのみ）
  if (stored.format === "text-only" || !parsed || parsed.lines.length === 0) {
    return (
      <div style={container}>
        <div style={{ padding: "24px 32px", opacity: 0.5, fontSize: 12 }}>
          時刻情報なし（タップで同期する機能は編集モードで）
        </div>
        <div
          style={{
            padding: "0 32px 32px",
            whiteSpace: "pre-wrap",
            lineHeight: 1.8,
            fontSize: 18,
            color: "#111",
          }}
        >
          {stored.content}
        </div>
      </div>
    );
  }

  // 同期表示
  return (
    <div ref={listRef} style={container}>
      <div
        style={{ padding: "30vh 0" /* 上下に余白を作って中央に来るように */ }}
      >
        {parsed.lines.map((line, i) => {
          const active = i === activeIndex;
          return (
            <div
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              onClick={() => onSeek?.(line.start)}
              style={{
                padding: "10px 32px",
                cursor: onSeek ? "pointer" : "default",
                color: active ? "#111" : "rgba(0,0,0,0.35)",
                fontWeight: active ? 800 : 500,
                fontSize: active ? 24 : 18,
                transition:
                  "color .25s ease, font-size .25s ease, opacity .25s ease",
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              {line.text || "\u00A0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const container: React.CSSProperties = {
  height: "100%",
  overflowY: "auto",
  scrollBehavior: "smooth",
  background: "rgba(255,255,255,0.6)",
  backdropFilter: "blur(8px)",
  borderRadius: 16,
};

const emptyMsg: React.CSSProperties = {
  height: "100%",
  display: "grid",
  placeItems: "center",
  color: "#6b7280",
  fontSize: 16,
  textAlign: "center",
};
