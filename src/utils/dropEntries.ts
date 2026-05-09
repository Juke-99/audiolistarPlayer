import { ACCEPT_RE } from "../constants/const";

// FileSystemEntry を再帰的に展開して File[] を返す
async function walkEntry(entry: any): Promise<File[]> {
  if (!entry) return [];

  if (entry.isFile) {
    return new Promise<File[]>((resolve) => {
      entry.file(
        (f: File) => resolve(ACCEPT_RE.test(f.name) ? [f] : []),
        () => resolve([]),
      );
    });
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const collected: File[] = [];

    return new Promise<File[]>((resolve) => {
      const readBatch = () => {
        reader.readEntries(
          async (entries: any[]) => {
            if (!entries || entries.length === 0) {
              resolve(collected);
              return;
            }

            for (const e of entries) {
              const found = await walkEntry(e);
              collected.push(...found);
            }

            // readEntries はバッチ返却なので、空になるまで繰り返す
            readBatch();
          },
          () => resolve(collected),
        );
      };

      readBatch();
    });
  }

  return [];
}

// DataTransferItemList から File[] を抽出（複数フォルダ＋ファイル混在 OK）
export async function collectDroppedFiles(
  items: DataTransferItemList,
): Promise<File[]> {
  const entries: any[] = [];
  const fallbackFiles: File[] = [];
  const all: File[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;

    // @ts-ignore
    const entry = item.webkitGetAsEntry?.();

    if (entry) {
      entries.push(entry);
    } else {
      // フォールバック：単一ファイル
      const f = item.getAsFile();
      if (f && ACCEPT_RE.test(f.name)) fallbackFiles.push(f);
    }
  }

  for (const entry of entries) {
    const found = await walkEntry(entry);
    all.push(...found);
  }

  return all;
}
