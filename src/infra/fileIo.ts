import { safeFileName } from '../domain/csvExport';
import { parseDocumentJson, type LoadError, type Result } from '../domain/migrations';
import type { FpDocument } from '../domain/types';
import { downloadText } from './download';

export const FILE_EXTENSION = '.fpdfd.json';

/** 手動保存（FR-SV-01）。プロジェクト全体を 1 つの JSON にしてダウンロードする */
export function saveToFile(doc: FpDocument): string {
  const filename = `${safeFileName(doc.project.name)}${FILE_EXTENSION}`;
  downloadText(filename, JSON.stringify(doc, null, 2), 'application/json');
  return filename;
}

export async function loadFromFile(file: File): Promise<Result<FpDocument, LoadError>> {
  const text = await file.text();
  return parseDocumentJson(text);
}
