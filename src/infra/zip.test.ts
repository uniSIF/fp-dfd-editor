import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from './zip';

describe('ZIP（FR-SVG-07）', () => {
  it('CRC-32 は標準の値になる', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('日本語のフォルダ・ファイル名を含む ZIP を展開できる（Python の zipfile で検証）', () => {
    const zip = buildZip([
      { path: '顧客管理/顧客情報/顧客登録.svg', text: '<svg>登録</svg>' },
      { path: '商品管理/商品情報/商品登録.svg', text: '<svg/>' },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'a.zip');
    writeFileSync(file, zip);
    const py = 'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); print(json.dumps({"bad": z.testzip(), "names": z.namelist(), "body": z.read(z.namelist()[0]).decode()}))';
    expect(JSON.parse(execFileSync('python3', ['-I', '-c', py, file], { encoding: 'utf-8' }))).toEqual({
      bad: null,
      names: ['顧客管理/顧客情報/顧客登録.svg', '商品管理/商品情報/商品登録.svg'],
      body: '<svg>登録</svg>',
    });
  });
});

describe('Excel のマクロ（tools/excel）', () => {
  it('取り込み用の .bas は、.vb を Shift_JIS・CRLF にしたものと一致する（npm run build:macro で作る）', () => {
    const vb = readFileSync('tools/excel/DfdSvgToExcel.vb', 'utf-8');
    const bas = new TextDecoder('shift_jis').decode(readFileSync('tools/excel/DfdSvgToExcel.bas'));
    expect(bas).toBe(vb.replace(/\n/g, '\r\n'));
  });
});
