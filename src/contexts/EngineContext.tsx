import { createContext, useContext } from "react";
import { usePreviewEngine } from "../hooks/audio/usePreviewEngine";

// usePreviewEngine の返り値型をそのまま使う
type Engine = ReturnType<typeof usePreviewEngine>;

const EngineContext = createContext<Engine | null>(null);

export const EngineProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // ★ ここで追加した onTick/getState/toggle/seek/pause/resume も含む“全部入り”を取得
  const engine = usePreviewEngine({ fadeInMs: 120, fadeOutMs: 140 });

  // そのままコンテキストへ渡す（部分的に pick しない）
  return (
    <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
  );
};

// 取り出し用フック
export function useEngine(): Engine {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error("useEngine must be used within EngineProvider");
  return ctx;
}
