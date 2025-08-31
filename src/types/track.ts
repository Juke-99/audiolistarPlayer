import type { TrackMeta } from "../audio/audioRender/readMeta";

export type Track = {
  id: string;
  file: File;
  url: string; // Object URL
  meta?: TrackMeta;
  previewStartSec?: number;
  previewEndSec?: number;
};
