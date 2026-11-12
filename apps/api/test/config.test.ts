import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { initTestDb, testApp } from './helpers';
import { pluralise } from '../src/config/env';

const app = testApp();

describe('GET /config', () => {
  beforeAll(initTestDb);

  it('is public and returns the default Region/District labels', async () => {
    const res = await request(app).get('/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      labels: {
        level1: { singular: 'Region', plural: 'Regions' },
        level2: { singular: 'District', plural: 'Districts' },
      },
    });
  });
});

describe('org labels', () => {
  const keys = ['ORG_LEVEL1_LABEL', 'ORG_LEVEL2_LABEL', 'ORG_LEVEL2_LABEL_PLURAL'];
  afterEach(() => {
    for (const k of keys) process.env[k] = '';
    vi.resetModules();
  });

  it('pluralises y → ies after a consonant, else adds s', () => {
    expect(pluralise('County')).toBe('Counties');
    expect(pluralise('Sub-county')).toBe('Sub-counties');
    expect(pluralise('District')).toBe('Districts');
    expect(pluralise('Way')).toBe('Ways');
  });

  it('reads the labels and plural overrides from the environment', async () => {
    process.env.ORG_LEVEL1_LABEL = 'County';
    process.env.ORG_LEVEL2_LABEL = ' Sub-county ';
    process.env.ORG_LEVEL2_LABEL_PLURAL = 'Sub-counties (all)';
    vi.resetModules();
    const { REGION, DISTRICT, COORDINATOR } = await import('../src/lib/org-labels');
    expect(REGION).toEqual({ one: 'County', many: 'Counties', lower: 'county', lowerMany: 'counties' });
    expect(DISTRICT.one).toBe('Sub-county');
    expect(DISTRICT.many).toBe('Sub-counties (all)');
    expect(COORDINATOR).toEqual({ county: 'County coordinator', subcounty: 'Sub-county coordinator' });
  });
});
