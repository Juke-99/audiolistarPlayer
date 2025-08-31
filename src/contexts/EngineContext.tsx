import { createContext, useContext } from "react";
import { usePreviewEngine } from "../hooks/audio/usePreviewEngine";

type Engine = ReturnType<typeof usePreviewEngine>;

const EngineCtx = createContext<{ engine: Engine } | null>(null);

export function useEngine() {
  const ctx = useContext(EngineCtx);
  if (!ctx) throw new Error("useEngine must be used inside <EngineProvider>");
  return ctx.engine;
}

export const EngineProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // ★ 全画面で共有する1個だけのエンジン
  const engine = usePreviewEngine({ fadeInMs: 120, fadeOutMs: 140 });
  return <EngineCtx.Provider value={{ engine }}>{children}</EngineCtx.Provider>;
};
