import Dexie, { type Table } from "dexie";
import type { Track } from "../types/track";
import type { ParsedTrackMeta } from "../audio/audioRender/readMeta";

/** 永続化用：埋め込みアートを Blob で保持 */
type StoredMeta = Omit<ParsedTrackMeta, "pictureUrl"> & {
  /** リモート URL（iTunes 等）はそのまま文字列で保存 */
  pictureUrl?: string;
  /** 埋め込みアートは Blob で保存（Object URL は揮発するため） */
  pictureBlob?: Blob;
  pictureMime?: string;
};

export type StoredTrack = {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;
  fileBlob: Blob;
  meta?: StoredMeta;
  previewStartSec?: number;
  previewEndSec?: number;
  addedAt: number;
};

class AudiolistarDB extends Dexie {
  tracks!: Table<StoredTrack, string>;

  constructor() {
    super("audiolistar");
    this.version(1).stores({
      // 主キー id、よく検索しそうなものをインデックス化
      tracks: "id, fileName, addedAt",
    });
  }
}

export const db = new AudiolistarDB();

/** Track → StoredTrack（保存用） */
export async function trackToStored(t: Track): Promise<StoredTrack> {
  let pictureBlob: Blob | undefined;
  let pictureMime: string | undefined;
  let pictureUrlForStore: string | undefined;

  const u = t.meta?.pictureUrl;
  if (u) {
    if (u.startsWith("blob:")) {
      // 埋め込みアート → Blob を取り戻して保存
      try {
        const r = await fetch(u);
        if (r.ok) {
          pictureBlob = await r.blob();
          pictureMime = pictureBlob.type || undefined;
        }
      } catch {
        // 失敗時は無視（アートだけの問題なので継続）
      }
    } else {
      // iTunes 等のリモート URL → 文字列のまま
      pictureUrlForStore = u;
    }
  }

  const meta: StoredMeta | undefined = t.meta && {
    ...t.meta,
    pictureUrl: pictureUrlForStore,
    pictureBlob,
    pictureMime,
  };

  return {
    id: t.id,
    fileName: t.file.name,
    fileSize: t.file.size,
    fileType: t.file.type,
    fileLastModified: t.file.lastModified,
    fileBlob: t.file,
    meta,
    previewStartSec: t.previewStartSec,
    previewEndSec: t.previewEndSec,
    addedAt: Date.now(),
  };
}

/** StoredTrack → Track（読み込み時、Object URL を再生成） */
export function storedToTrack(s: StoredTrack): Track {
  const file = new File([s.fileBlob], s.fileName, {
    type: s.fileType,
    lastModified: s.fileLastModified,
  });
  const url = URL.createObjectURL(s.fileBlob);

  let pictureUrl: string | undefined;
  if (s.meta?.pictureBlob) {
    pictureUrl = URL.createObjectURL(s.meta.pictureBlob);
  } else if (s.meta?.pictureUrl) {
    pictureUrl = s.meta.pictureUrl;
  }

  // 実行時の meta は ParsedTrackMeta（pictureBlob は持たない）に戻す
  const meta: ParsedTrackMeta | undefined =
    s.meta &&
    ({
      ...s.meta,
      pictureUrl,
      pictureBlob: undefined,
      pictureMime: undefined,
    } as ParsedTrackMeta);

  return {
    id: s.id,
    file,
    url,
    meta,
    previewStartSec: s.previewStartSec,
    previewEndSec: s.previewEndSec,
  };
}
