import { createContext, useContext, useState } from "react";
import type { Track } from "../types/track";

type Value = {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
};

const TracksCtx = createContext<Value | null>(null);

export function useTracks() {
  const ctx = useContext(TracksCtx);
  if (!ctx) throw new Error("useTracks must be used inside <TracksProvider>");
  return ctx;
}

export const TracksProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [tracks, setTracks] = useState<Track[]>([]);
  return (
    <TracksCtx.Provider value={{ tracks, setTracks }}>
      {children}
    </TracksCtx.Provider>
  );
};
