// Display names for regions and districts, for human-facing text only
// (error messages, workbook "Read me"). Identifiers (tables, workbook tab names,
// column keys like region_code, role codes like `county`) never change.
// Configured by ORG_LEVEL1_LABEL / ORG_LEVEL2_LABEL (config/env.ts).

import env from '../config/env';

function forms(l: { singular: string; plural: string }) {
  return {
    one: l.singular,                 // "County"
    many: l.plural,                  // "Counties"
    lower: l.singular.toLowerCase(), // "county"
    lowerMany: l.plural.toLowerCase(),
  };
}

export const REGION = forms(env.orgLabels.level1);
export const DISTRICT = forms(env.orgLabels.level2);

/** UI names of the coordinator roles that follow the level labels. */
export const COORDINATOR = {
  county: `${REGION.one} coordinator`,
  subcounty: `${DISTRICT.one} coordinator`,
};

/** Body of the public GET /api/v1/config. */
export function publicConfig() {
  return { labels: { level1: env.orgLabels.level1, level2: env.orgLabels.level2 } };
}
