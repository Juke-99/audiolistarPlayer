import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine } from "../contexts/EngineContext";

const STORAGE_KEY = "audiolistar:volume";

export default function VolumeControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const engine = useEngine();

  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const n = saved != null ? parseFloat(saved) : 1;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  });
  const [muted, setMuted] = useState(false);

  const prevVolumeRef = useRef(1);

  // 起動時・変更時にエンジンへ反映
  useEffect(() => {
    engine.setVolume?.(muted ? 0 : volume);
  }, [engine, volume, muted]);

  // 永続化
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(volume));
  }, [volume]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (!m) {
        prevVolumeRef.current = volume || 1;
        return true;
      }
      if (volume === 0) setVolume(prevVolumeRef.current);
      return false;
    });
  }, [volume]);

  const effective = muted ? 0 : volume;
  const icon = effective === 0 ? "🔇" : effective < 0.5 ? "🔉" : "🔊";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: compact ? "0 8px" : "0 12px",
        borderRadius: 9999,
        border: "1px solid rgba(0,0,0,.15)",
        background: "white",
        boxShadow: "0 2px 6px rgba(0,0,0,.06)",
      }}
    >
      <button
        onClick={toggleMute}
        title={muted ? "ミュート解除" : "ミュート"}
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        {icon}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(e) => {
          const v = parseFloat(e.currentTarget.value);
          setVolume(v);
          if (muted && v > 0) setMuted(false);
        }}
        aria-label="音量"
        style={{
          width: compact ? 80 : 110,
          accentColor: "#111",
          cursor: "pointer",
        }}
      />

      {!compact && (
        <span
          style={{
            fontSize: 12,
            opacity: 0.7,
            width: 32,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            color: "#111",
          }}
        >
          {Math.round(effective * 100)}
        </span>
      )}
    </div>
  );
}
