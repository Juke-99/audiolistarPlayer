import { createContext, useContext, useEffect, useState } from "react";
import type { Track } from "../types/track";
import { db, storedToTrack } from "../utils/db";

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

  // 初期ロード：IndexedDB から復元
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await db.tracks.orderBy("addedAt").toArray();
        if (cancelled) return;

        setTracks(stored.map(storedToTrack));
      } catch (e) {
        console.warn("Failed to load tracks from IndexedDB", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TracksCtx.Provider value={{ tracks, setTracks }}>
      {children}
    </TracksCtx.Provider>
  );
};
