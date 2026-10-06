import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db/database';
import { initTestDb } from './helpers';

const columns = (table: string) =>
  query<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

describe('migration 9 — districts', () => {
  beforeAll(initTestDb);

  it('creates the districts table', () => {
    expect(columns('districts')).toEqual(
      expect.arrayContaining(['id', 'code', 'name', 'region_id', 'created_at', 'updated_at']),
    );
  });

  it('adds district_id to facilities and user_assessment_responses', () => {
    expect(columns('facilities')).toContain('district_id');
    expect(columns('user_assessment_responses')).toContain('district_id');
  });

  it('indexes responses by district', () => {
    const idx = query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_uar_district'",
    );
    expect(idx).toHaveLength(1);
  });
});

describe('migration 10 — user_regions', () => {
  beforeAll(initTestDb);

  it('creates the user_regions link table', () => {
    expect(columns('user_regions')).toEqual(['user_id', 'region_id']);
  });

  it('indexes user_regions by region', () => {
    const idx = query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_regions_region'",
    );
    expect(idx).toHaveLength(1);
  });
});
