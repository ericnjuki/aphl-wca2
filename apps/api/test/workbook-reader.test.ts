import { describe, expect, it } from 'vitest';
import { cellText, loadWorkbook } from '../src/lib/workbook/xlsx';
import { readTab, splitList, req, opt, TabSpec } from '../src/lib/workbook/reader';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { buildWorkbook, USERS_HEADER } from './helpers';

const REGIONS: TabSpec = { name: 'Regions', columns: [req('region_code'), req('region_name'), opt('note')] };

async function sheet(rows: (string | number | null)[][]) {
  const wb = await loadWorkbook(await buildWorkbook({ Regions: rows }));
  return wb.worksheets[0];
}

describe('cellText', () => {
  it('turns every kind of cell value into trimmed text', () => {
    expect(cellText('  DSM ')).toBe('DSM');
    expect(cellText(3830)).toBe('3830');
    expect(cellText(1.01)).toBe('1.01');
    expect(cellText(true)).toBe('true');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText({ richText: [{ text: 'Dar ' }, { text: 'es Salaam ' }] } as never)).toBe('Dar es Salaam');
    expect(cellText({ text: ' mail ', hyperlink: 'mailto:a@b.c' } as never)).toBe('mail');
    expect(cellText({ formula: 'A1', result: 'X' } as never)).toBe('X');
    expect(cellText(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-06');
  });
});

describe('loadWorkbook', () => {
  it('rejects a file that is not an .xlsx workbook with 400', async () => {
    await expect(loadWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('readTab', () => {
  it('reads rows by header name, case-insensitively, with spreadsheet row numbers', async () => {
    const t = readTab(await sheet([
      ['Region_Code', ' REGION_NAME '],
      ['DSM', 'Dar es Salaam'],
      [null, null],
      ['mwz', ' Mwanza '],
    ]), REGIONS);
    expect(t.headerOk).toBe(true);
    expect(t.errors).toEqual([]);
    expect(t.rows).toEqual([
      { row: 2, values: { region_code: 'DSM', region_name: 'Dar es Salaam', note: '' } },
      { row: 4, values: { region_code: 'mwz', region_name: 'Mwanza', note: '' } },
    ]);
  });

  it('reports missing required columns and reads no rows', async () => {
    const t = readTab(await sheet([['region_code'], ['DSM']]), REGIONS);
    expect(t.headerOk).toBe(false);
    expect(t.rows).toEqual([]);
    expect(t.errors).toEqual([{ row: 1, column: 'region_name', message: 'Missing required column "region_name"' }]);
  });

  it('treats an empty sheet as missing every required column', async () => {
    const t = readTab(await sheet([]), REGIONS);
    expect(t.headerOk).toBe(false);
    expect(t.errors.map((e) => e.column)).toEqual(['region_code', 'region_name']);
  });

  it('flags empty required cells and marks the row bad', async () => {
    const t = readTab(await sheet([['region_code', 'region_name'], ['DSM', ''], ['MWZ', 'Mwanza']]), REGIONS);
    expect(t.errors).toEqual([{ row: 2, column: 'region_name', message: 'region_name is required' }]);
    expect([...t.badRows]).toEqual([2]);
    expect(t.rows).toHaveLength(2);
  });

  it('ignores columns that are not in the spec', async () => {
    const t = readTab(await sheet([['region_code', 'region_name', 'username'], ['DSM', 'Dar', 'someone']]), REGIONS);
    expect(t.rows[0].values).toEqual({ region_code: 'DSM', region_name: 'Dar', note: '' });
  });
});

describe('readSetupWorkbook', () => {
  it('finds tabs case-insensitively, ignores Read me and returns null for absent tabs', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook({
      'Read me': [['anything']],
      regions: [['region_code', 'region_name'], ['DSM', 'Dar es Salaam']],
    }));
    expect(parsed.Regions?.rows).toHaveLength(1);
    expect(parsed.Districts).toBeNull();
    expect(parsed.Users).toBeNull();
  });

  it('does not read the username column of the Users tab', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook({
      Users: [[...USERS_HEADER, 'username'], ['a@b.test', 'A', 'B', '1', 'NRC', '', '', '', '', '', '', '', 'a.b']],
    }));
    expect(parsed.Users?.rows[0].values).not.toHaveProperty('username');
    expect(parsed.Users?.rows[0].values.email).toBe('a@b.test');
  });
});

describe('splitList', () => {
  it('splits on ";", trims and drops empty entries', () => {
    expect(splitList(' LAB; PHARM ;;MED; ')).toEqual(['LAB', 'PHARM', 'MED']);
    expect(splitList('')).toEqual([]);
  });
});
