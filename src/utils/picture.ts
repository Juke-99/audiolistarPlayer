// src/utils/picture.ts
import type { IPicture, IAudioMetadata } from "music-metadata";

/** Uint8Array<ArrayBufferLike> → 通常 ArrayBuffer にコピーして Blob 化（SAB回避） */
export function u8ToBlob(u8: Uint8Array, mime = "image/jpeg"): Blob {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return new Blob([ab], { type: mime });
}

/** 簡易MIME推定（MP4 covr でformatが空のケース用） */
export function sniffMime(u8: Uint8Array): string {
  if (u8[0] === 0xff && u8[1] === 0xd8) return "image/jpeg";
  if (u8[0] === 0x89 && u8[1] === 0x50) return "image/png";
  if (u8[0] === 0x47 && u8[1] === 0x49) return "image/gif";
  return "image/jpeg";
}

/** common.picture から1枚選ぶ（front/cover優先） */
export function pickFromCommon(pictures?: IPicture[]): IPicture | undefined {
  if (!pictures?.length) return;
  const lc = (s?: string) => s?.toLowerCase() ?? "";
  return (
    pictures.find(
      (p) =>
        lc((p as any).type).includes("front") ||
        lc((p as any).description).includes("front")
    ) ??
    pictures.find(
      (p) =>
        lc((p as any).type).includes("cover") ||
        lc((p as any).description).includes("cover")
    ) ??
    pictures[0]
  );
}

/** native タグから画像を拾う（MP4: covr を最優先） */
export function pickFromNative(
  native: IAudioMetadata["native"]
): { data: Uint8Array; mime?: string } | undefined {
  // 1) covr（M4A/MP4）を最優先
  for (const [, tags] of Object.entries(native)) {
    for (const t of (tags as any[]) ?? []) {
      if (t.id !== "covr") continue;
      const v: any = t.value;
      const asU8 = (x: any): Uint8Array | undefined =>
        x instanceof Uint8Array
          ? x
          : x?.data instanceof Uint8Array
          ? x.data
          : x?.data?.data instanceof Uint8Array
          ? x.data.data
          : undefined;
      if (Array.isArray(v) && v.length) {
        const first = asU8(v[0]);
        if (first) return { data: first, mime: sniffMime(first) };
      }
      const u8 = asU8(v);
      if (u8) return { data: u8, mime: sniffMime(u8) };
    }
  }
  // 2) 代表的な他フォーマット
  const wanted = new Set(["APIC", "PIC", "METADATA_BLOCK_PICTURE", "PICTURE"]);
  for (const [, tags] of Object.entries(native)) {
    for (const t of (tags as any[]) ?? []) {
      if (!wanted.has(t.id)) continue;
      const v: any = t.value;
      if (v?.data instanceof Uint8Array)
        return { data: v.data, mime: v.format || sniffMime(v.data) };
      if (v?.format && v?.data?.data instanceof Uint8Array)
        return { data: v.data.data, mime: v.format };
    }
  }
  return undefined;
}
