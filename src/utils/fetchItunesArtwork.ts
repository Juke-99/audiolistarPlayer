export type ArtworkResult = {
  url: string;
  width: number;
  height: number;
} | null;

type ItunesLookupItem = {
  wrapperType?: "track" | "collection";
  collectionId?: number;
  artworkUrl60?: string;
  artworkUrl100?: string;
  collectionName?: string;
  artistName?: string;
};

type ItunesLookupResponse = {
  resultCount: number;
  results: ItunesLookupItem[];
};

type ItunesSearchItem = {
  collectionId?: number;
  artworkUrl100?: string;
  collectionName?: string;
  artistName?: string;
};

type ItunesSearchResponse = {
  resultCount: number;
  results: ItunesSearchItem[];
};

/** iTunesのアートワークURLを高解像度に差し替え */
export function upgradeItunesArtworkUrl(u: string, size = 1200): string {
  const s = String(u);
  // 例: .../100x100bb.jpg → .../1200x1200bb.jpg
  //     .../100x100.jpg   → .../1200x1200.jpg
  return s
    .replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`)
    .replace(/\/(\d+)x(\d+)(\.[a-z]+)$/i, `/${size}x${size}$3`);
}

function safeCountry(country?: string): string {
  return (country ?? "jp").toLowerCase();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** collectionId でピンポイント lookup（最優先） */
export async function fetchArtworkByCollectionId(
  collectionId: number,
  country = "jp"
): Promise<ArtworkResult> {
  const c = safeCountry(country);
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(
    String(collectionId)
  )}&entity=album&country=${c}`;
  const json = await fetchJson<ItunesLookupResponse>(url);
  if (!json?.results?.length) return null;

  const album =
    json.results.find((r) => r.wrapperType === "collection") || json.results[0];
  const base = album?.artworkUrl100;
  if (!base) return null;

  return {
    url: upgradeItunesArtworkUrl(base, 1200),
    width: 1200,
    height: 1200,
  };
}

/** trackId から collectionId を辿って lookup（最悪は曲のアート） */
export async function fetchArtworkByTrackId(
  trackId: number,
  country = "jp"
): Promise<ArtworkResult> {
  const c = safeCountry(country);
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(
    String(trackId)
  )}&country=${c}`;
  const json = await fetchJson<ItunesLookupResponse>(url);
  if (!json?.results?.length) return null;

  const track = json.results[0];
  if (track?.collectionId) {
    const byCol = await fetchArtworkByCollectionId(track.collectionId, c);
    if (byCol) return byCol;
  }
  const base = track?.artworkUrl100;
  return base
    ? { url: upgradeItunesArtworkUrl(base, 1200), width: 1200, height: 1200 }
    : null;
}

/** まず ID（collectionId / trackId）で引き、無ければ null */
export async function fetchArtworkByItunesIds(
  ids: { collectionId?: number; trackId?: number },
  country = "jp"
): Promise<ArtworkResult> {
  if (ids.collectionId) {
    const hit = await fetchArtworkByCollectionId(ids.collectionId, country);
    if (hit) return hit;
  }
  if (ids.trackId) {
    const hit = await fetchArtworkByTrackId(ids.trackId, country);
    if (hit) return hit;
  }
  return null;
}

/** iTunes Search API（保険。厳しめに1枚選ぶ） */
export async function fetchArtworkByItunesSearch(
  title: string,
  artist?: string,
  album?: string,
  country = "jp"
): Promise<ArtworkResult> {
  const c = safeCountry(country);
  const term = [album || title || "", artist || ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!term) return null;

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("attribute", "albumTerm");
  url.searchParams.set("limit", "10");
  url.searchParams.set("country", c);
  url.searchParams.set("term", term);

  const json = await fetchJson<ItunesSearchResponse>(String(url));
  const results = json?.results ?? [];
  if (!results.length) return null;

  const norm = (s?: string) =>
    (s || "")
      .toLowerCase()
      .replace(/[\u3000\s]+/g, " ")
      .replace(/\((deluxe|remaster|expanded|anniversary).*?\)/gi, "")
      .trim();

  const nt = norm(album || title);
  const na = norm(artist);

  // 完全一致に寄せるスコアリング
  results.sort((a, b) => {
    const sa =
      (a.collectionName && norm(a.collectionName) === nt ? 2 : 0) +
      (a.artistName && norm(a.artistName) === na ? 2 : 0);
    const sb =
      (b.collectionName && norm(b.collectionName) === nt ? 2 : 0) +
      (b.artistName && norm(b.artistName) === na ? 2 : 0);
    return sb - sa;
  });

  const best = results[0];
  const base = best?.artworkUrl100;
  return base
    ? { url: upgradeItunesArtworkUrl(base, 1200), width: 1200, height: 1200 }
    : null;
}
