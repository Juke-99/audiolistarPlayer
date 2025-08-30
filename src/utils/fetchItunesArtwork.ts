export type ArtworkResult = {
  url: string;
  width: number;
  height: number;
} | null;

/** iTunes Search API でアートワークURLを取得（国は必要なら変更） */
export async function fetchArtworkByItunesSearch(
  title: string,
  artist?: string,
  album?: string,
  country = "jp"
): Promise<ArtworkResult> {
  const term = [title, artist, album].filter(Boolean).join(" ");
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("country", country);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const json = await res.json();
  const results: any[] = json.results ?? [];
  if (!results.length) return null;

  // 簡単なスコアでベスト候補
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const nt = norm(title);
  const na = norm(artist ?? "");
  results.sort((a, b) => {
    const sa =
      (a.trackName && norm(a.trackName) === nt ? 2 : 0) +
      (a.artistName && norm(a.artistName) === na ? 2 : 0);
    const sb =
      (b.trackName && norm(b.trackName) === nt ? 2 : 0) +
      (b.artistName && norm(b.artistName) === na ? 2 : 0);
    return sb - sa;
  });

  const best = results[0];
  const base = best?.artworkUrl100;
  if (!base) return null;
  // 高解像度に差し替え（100→1000）
  const hi = String(base).replace(/\/[0-9]+x[0-9]+bb\./, "/1000x1000bb.");
  return { url: hi, width: 1000, height: 1000 };
}
