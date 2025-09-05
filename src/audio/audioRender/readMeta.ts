import {
  fetchArtworkByItunesIds,
  fetchArtworkByItunesSearch,
} from "../../utils/fetchItunesArtwork";

export type ReadMetaOptions = {
  /** true: 埋め込みアート最優先（既定）。false: 外部(Apple/iTunes)を優先 */
  preferEmbeddedArtwork?: boolean;
  /** "jp"(既定) / "us" など */
  country?: string;
};

export type ParsedTrackMeta = {
  title?: string;
  artist?: string;
  album?: string;
  albumartist?: string;
  artists?: string[];
  genre?: string[];
  year?: number;
  date?: string;

  track?: { no?: number; of?: number };
  disk?: { no?: number; of?: number };

  durationSec?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  lossless?: boolean;

  pictureUrl?: string;
  pictureSource?:
    | "embedded"
    | "itunes-collectionId"
    | "itunes-trackId"
    | "itunes-search"
    | null;

  itunes?: {
    collectionId?: number; // plID
    trackId?: number; // cnID
    artistId?: number; // atID
  };
};

// ---------- 小ユーティリティ ----------
const isBrowser = () =>
  typeof window !== "undefined" && typeof document !== "undefined";
const hasBlob = () => typeof Blob !== "undefined";
const isBlob = (v: unknown): v is Blob => hasBlob() && v instanceof Blob;

const safeCountry = (c?: string) => (c ?? "jp").toLowerCase();

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function extractItunesIds(mm: any) {
  const arr =
    (mm?.native?.iTunes as Array<{ id: string; value: unknown }>) ?? [];
  const pick = (tag: string) =>
    numOrUndef(arr.find((t) => t.id === tag)?.value);
  return {
    collectionId: pick("plID"),
    trackId: pick("cnID"),
    artistId: pick("atID"),
  };
}

function extractEmbeddedArtworkUrl(mm: any): string | undefined {
  const pic = mm?.common?.picture?.[0];
  if (!pic?.data) return;
  try {
    const mime = pic.format || "image/jpeg";
    const blob = new Blob([pic.data], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return;
  }
}

// ---------- メイン ----------
export async function readMeta(
  file: Blob | ArrayBuffer | Uint8Array,
  opts: ReadMetaOptions = {}
): Promise<ParsedTrackMeta> {
  const preferEmbedded = opts.preferEmbeddedArtwork ?? true;
  const country = safeCountry(opts.country);

  // 1) 解析（ブラウザ: parseBlob / Node: parseBuffer）
  let mm: any;
  if (isBrowser() && isBlob(file)) {
    const { parseBlob } = await import("music-metadata");
    mm = await parseBlob(file);
  } else {
    const { parseBuffer } = await import("music-metadata");
    // 入力を Buffer に寄せる
    let buf: Uint8Array;
    if (file instanceof Uint8Array) {
      buf = file;
    } else if (file instanceof ArrayBuffer) {
      buf = new Uint8Array(file);
    } else if (isBlob(file)) {
      buf = new Uint8Array(await file.arrayBuffer());
    } else {
      throw new Error("Unsupported input type for readMeta()");
    }
    // music-metadata の parseBuffer は第2引数に { mimeType, size } を渡す形が安全
    mm = await parseBuffer(Buffer.from(buf), {
      mimeType: undefined,
      size: buf.byteLength,
    });
  }

  // 2) 共通メタを整形
  const meta: ParsedTrackMeta = {
    title: mm?.common?.title ?? undefined,
    artist: mm?.common?.artist ?? undefined,
    album: mm?.common?.album ?? undefined,
    albumartist: mm?.common?.albumartist ?? undefined,
    artists: mm?.common?.artists ?? undefined,
    genre: mm?.common?.genre ?? undefined,
    year: mm?.common?.year ?? undefined,
    date: mm?.common?.date ?? undefined,

    track: mm?.common?.track ?? undefined,
    disk: mm?.common?.disk ?? undefined,

    durationSec: numOrUndef(mm?.format?.duration),
    bitrate: numOrUndef(mm?.format?.bitrate),
    sampleRate: numOrUndef(mm?.format?.sampleRate),
    channels: numOrUndef(mm?.format?.numberOfChannels),
    lossless: Boolean(mm?.format?.lossless),

    pictureUrl: undefined,
    pictureSource: null,

    itunes: extractItunesIds(mm),
  };

  // 3) 埋め込みアート（優先時のみ）
  if (preferEmbedded) {
    const emb = extractEmbeddedArtworkUrl(mm);
    if (emb) {
      meta.pictureUrl = emb;
      meta.pictureSource = "embedded";
      return meta;
    }
  }

  // 4) iTunes ID（plID/cnID）で lookup（国を合わせる）
  if (meta.itunes?.collectionId || meta.itunes?.trackId) {
    const byId = await fetchArtworkByItunesIds(
      {
        collectionId: meta.itunes?.collectionId,
        trackId: meta.itunes?.trackId,
      },
      country
    );
    if (byId?.url) {
      meta.pictureUrl = byId.url;
      meta.pictureSource = meta.itunes?.collectionId
        ? "itunes-collectionId"
        : "itunes-trackId";
      return meta;
    }
  }

  // 5) 検索フォールバック（アルバム/アーティストで厳しめ）
  const title = meta.title ?? "";
  const artist = meta.artist ?? meta.artists?.[0] ?? "";
  const album = meta.album ?? "";
  const bySearch = await fetchArtworkByItunesSearch(
    title,
    artist,
    album,
    country
  );
  if (bySearch?.url) {
    meta.pictureUrl = bySearch.url;
    meta.pictureSource = "itunes-search";
    return meta;
  }

  // 6) 外部で見つからず、外部優先だった場合は最後に埋め込みをもう一度
  if (!preferEmbedded) {
    const emb = extractEmbeddedArtworkUrl(mm);
    if (emb) {
      meta.pictureUrl = emb;
      meta.pictureSource = "embedded";
    }
  }

  return meta;
}
