import type { ParsedTrackMeta } from "../audio/audioRender/readMeta";

export type Track = {
  id: string;
  file: File;
  url: string; // Object URL
  meta?: ParsedTrackMeta;
  previewStartSec?: number;
  previewEndSec?: number;
};
