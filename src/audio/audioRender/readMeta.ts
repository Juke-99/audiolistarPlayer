// src/audio/readMeta.ts
import { parseBlob, type IAudioMetadata } from "music-metadata";
import {
  pickFromCommon,
  pickFromNative,
  sniffMime,
  u8ToBlob,
} from "../../utils/picture";
import { fetchArtworkByItunesSearch } from "../../utils/fetchItunesArtwork";

export type TrackMeta = {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string[];
  durationSec?: number;
  pictureUrl?: string; // blob: or https:
  pictureMime?: string;
  hasEmbeddedArt?: boolean;
  source?: "embedded" | "itunes";
};

export async function readMeta(file: File): Promise<TrackMeta> {
  const meta: IAudioMetadata = await parseBlob(file, {
    duration: true,
    skipCovers: false,
  });

  let pictureUrl: string | undefined;
  let pictureMime: string | undefined;
  let hasEmbeddedArt = false;
  let source: "embedded" | "itunes" | undefined;

  // 1) 埋め込み画像（common → native）
  const pic = pickFromCommon(meta.common.picture);
  if (pic?.data) {
    const u8 = pic.data as unknown as Uint8Array;
    pictureMime = pic.format || sniffMime(u8);
    pictureUrl = URL.createObjectURL(u8ToBlob(u8, pictureMime));
    hasEmbeddedArt = true;
    source = "embedded";
  } else {
    const nat = pickFromNative(meta.native);
    if (nat) {
      pictureMime = nat.mime || sniffMime(nat.data);
      pictureUrl = URL.createObjectURL(u8ToBlob(nat.data, pictureMime));
      hasEmbeddedArt = true;
      source = "embedded";
    }
  }

  // 2) 埋め込みが無い場合は iTunes Search で補完
  if (!pictureUrl) {
    const title = meta.common.title ?? file.name.replace(/\.[^.]+$/, "");
    const artist = meta.common.artist ?? meta.common.artists?.[0];
    const album = meta.common.album;
    const hit = await fetchArtworkByItunesSearch(title, artist, album, "jp");
    if (hit) {
      pictureUrl = hit.url; // https: 外部URL（revoke不要）
      pictureMime = "image/jpeg";
      source = "itunes";
    }
  }

  return {
    title: meta.common.title ?? file.name.replace(/\.[^.]+$/, ""),
    artist: meta.common.artist ?? meta.common.artists?.[0],
    album: meta.common.album,
    year: meta.common.year,
    genre: meta.common.genre,
    durationSec: meta.format.duration
      ? Math.round(meta.format.duration)
      : undefined,
    pictureUrl,
    pictureMime,
    hasEmbeddedArt,
    source,
  };
}
