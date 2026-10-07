// Aggregate reports over user_assessment_responses.
//
// All endpoints share query params:
//   domain_code?       filter to one competency domain (e.g. "LAB-SAFETY")
//   competency_value?  filter to one competency within that domain
//   approved_only?     default true — exclude rejected/pending submissions
//
// Response envelope:
//   { level, items, meta: { total_respondents, unassigned_respondents, avg_level, generated_at, filters } }
//
// LEFT JOIN pattern: the response-row filters (domain/competency/approved)
// live in the JOIN's ON clause so buckets with zero responses still appear
// in the output — otherwise empty regions/facilities/departments vanish.

import { Router, Request, Response, NextFunction } from 'express';
import { SqlValue } from 'sql.js';
import { query } from '../db/database';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { getScope, denyReason, Scope } from '../lib/report-scope';

const router = Router();
router.use(requireAuth, requirePasswordChanged);

interface CommonFilters {
  domainCode: string | null;
  competencyValue: string | null;
  approvedOnly: boolean;
}

function parseFilters(req: Request): CommonFilters {
  const domainCode = (req.query.domain_code as string | undefined) || null;
  const competencyValue = (req.query.competency_value as string | undefined) || null;
  const raw = req.query.approved_only;
  const approvedOnly = raw === undefined || raw === '1' || raw === 'true';
  return { domainCode, competencyValue, approvedOnly };
}

// Tacks the filter predicates onto a JOIN ON clause so LEFT JOINs preserve
// empty buckets. Returns `{ sql, params }` where `sql` is always safe to
// append after an existing ON condition (starts with " AND ").
function uarOnFilters(f: CommonFilters): { sql: string; params: SqlValue[] } {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  if (f.domainCode)      { parts.push('uar.domain_code = ?');      params.push(f.domainCode); }
  if (f.competencyValue) { parts.push('uar.competency_value = ?'); params.push(f.competencyValue); }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

function uaOnFilter(f: CommonFilters): string {
  return f.approvedOnly ? " AND ua.review_status = 'approved'" : '';
}

const COUNTS_SELECT = `
  COUNT(DISTINCT uar.user_id)                                            AS respondents,
  COUNT(uar.id)                                                          AS total_responses,
  AVG(CASE WHEN uar.response_level > 0 THEN uar.response_level END)       AS avg_level,
  SUM(CASE WHEN uar.response_level = 0 THEN 1 ELSE 0 END)                 AS count_na,
  SUM(CASE WHEN uar.response_level = 1 THEN 1 ELSE 0 END)                 AS count_beginner,
  SUM(CASE WHEN uar.response_level = 2 THEN 1 ELSE 0 END)                 AS count_competent,
  SUM(CASE WHEN uar.response_level = 3 THEN 1 ELSE 0 END)                 AS count_proficient,
  SUM(CASE WHEN uar.response_level = 4 THEN 1 ELSE 0 END)                 AS count_expert
`;

// Partner (monitor) users see aggregates only. A bucket built from fewer than
// MIN_GROUP_SIZE people would expose those people's results, so its counts
// are blanked and the row is flagged `suppressed: 'small'`. Empty buckets are
// left as-is.
//
// A single hidden row could still be recovered as `parent total - visible
// rows`, so when exactly one row is hidden the smallest other non-empty row is
// hidden too (`suppressed: 'complementary'`). Lists arrive ordered by name, so
// ties go to the first by name.
const MIN_GROUP_SIZE = 3;
const BLANK_COUNTS = {
  respondents: 0, total_responses: 0, avg_level: null,
  count_na: 0, count_beginner: 0, count_competent: 0, count_proficient: 0, count_expert: 0,
};

type Suppression = 'small' | 'complementary';  // 'parent' is set by blankItems

function suppressSmallGroups<T extends Record<string, unknown>>(scope: Scope, items: T[]): T[] {
  if (scope.role !== 'monitor') return items;
  const count = (item: T) => Number(item.respondents ?? 0);

  const hidden = new Map<number, Suppression>();
  items.forEach((item, i) => {
    const n = count(item);
    if (n > 0 && n < MIN_GROUP_SIZE) hidden.set(i, 'small');
  });

  if (hidden.size === 1) {
    let pick = -1;
    items.forEach((item, i) => {
      if (hidden.has(i) || count(item) === 0) return;
      if (pick === -1 || count(item) < count(items[pick])) pick = i;
    });
    if (pick !== -1) hidden.set(pick, 'complementary');
  }

  return items.map((item, i) => {
    const kind = hidden.get(i);
    return kind ? { ...item, ...BLANK_COUNTS, suppressed: kind } : item;
  });
}

// The view-wide average is hidden from partners when the view itself is a
// small group (1-2 people), for the same reason rows are.
// Respondents outside every row (unassigned) are in the average but in no row,
// so 1-2 of them would also let a partner back out the rows' figures. Partners
// get the average rounded to 2 decimals so response counts can't be recovered
// from it.
function viewAvg(scope: Scope, counts: { total: number; unassigned: number; avg: number | null }): number | null {
  if (scope.role !== 'monitor') return counts.avg;
  if (counts.total > 0 && counts.total < MIN_GROUP_SIZE) return null;
  if (counts.unassigned > 0 && counts.unassigned < MIN_GROUP_SIZE) return null;
  return counts.avg === null ? null : Math.round(counts.avg * 100) / 100;
}

// ── Archived children ─────────────────────────────────────────────────────────
// An archived region/district/facility/department stays in a list only while
// it has respondents in the current view, flagged `archived: true` so the UI
// can label it. `archived_at` itself is not sent.
function withArchived(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.flatMap((item) => {
    const { archived_at: archivedAt, ...rest } = item;
    if (archivedAt === null || archivedAt === undefined) return [rest];
    return Number(rest.respondents ?? 0) > 0 ? [{ ...rest, archived: true }] : [];
  });
}

function meta(f: CommonFilters, totalRespondents: number, unassigned: number, avgLevel: number | null = null) {
  return {
    total_respondents: totalRespondents,
    unassigned_respondents: unassigned,
    avg_level: avgLevel,
    generated_at: new Date().toISOString(),
    filters: {
      domain_code: f.domainCode,
      competency_value: f.competencyValue,
      approved_only: f.approvedOnly,
    },
  };
}

// Count distinct respondents matching a given scope/filter, and ALSO the
// subset whose `unassignedCol` is NULL — used to surface an "unassigned"
// warning on the UI when a user completed a survey but has no facility /
// department / region, so their data wouldn't show in any bucket.
// `unassigned` is either a column that must be NULL, or a custom predicate
// (SQL + its own params) — used at region level, where "unassigned" also
// covers a district that no longer belongs to this region (see below).
function respondentCounts(
  whereSql: string,
  whereParams: SqlValue[],
  f: CommonFilters,
  unassigned: 'region_id' | 'district_id' | 'facility_id' | 'department_id' | { sql: string; params: SqlValue[] },
): { total: number; unassigned: number; avg: number | null } {
  const unassignedSql = typeof unassigned === 'string' ? `uar.${unassigned} IS NULL` : unassigned.sql;
  const unassignedParams = typeof unassigned === 'string' ? [] : unassigned.params;
  const [row] = query<{ total: number; unassigned: number; avg_level: number | null }>(
    `SELECT
       COUNT(DISTINCT uar.user_id)                                       AS total,
       COUNT(DISTINCT CASE WHEN ${unassignedSql} THEN uar.user_id END)   AS unassigned,
       AVG(CASE WHEN uar.response_level > 0 THEN uar.response_level END) AS avg_level
     FROM user_assessment_responses uar
     LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
     ${whereSql}`,
    [...unassignedParams, ...whereParams],
  );
  return { total: row?.total ?? 0, unassigned: row?.unassigned ?? 0, avg: row?.avg_level ?? null };
}

// ── Current placement ─────────────────────────────────────────────────────────
// One rule for partners: a response counts toward an entity (its row in the
// parent list AND its own report) only when its snapshot matches the entity's
// CURRENT placement. Snapshots drift when districts or facilities move; without
// this a report could count more than its list row and be subtracted out.
//   district   uar.district_id = D.id AND uar.region_id IS D.region_id
//   facility   uar.facility_id = F.id AND uar.district_id IS F.district_id
//              AND uar.region_id IS F.region_id   (undistricted: district IS NULL)
// Admins and staff keep the plain id match. `ref` is a table alias (list
// queries) or a loaded row (single-entity reports), so both use these helpers.
interface DistrictRef { id: number; region_id: number | null }
interface FacilityRef { id: number; region_id: number | null; district_id: number | null }
type Placement = { sql: string; params: SqlValue[] };

function refValue<T extends object>(ref: string | T, field: keyof T & string): Placement {
  return typeof ref === 'string'
    ? { sql: `${ref}.${field}`, params: [] }
    : { sql: '?', params: [(ref as Record<string, SqlValue>)[field]] };
}

function placement(parts: [string, Placement][]): Placement {
  return {
    sql: parts.map(([lhs, rhs]) => `${lhs} ${rhs.sql}`).join(' AND '),
    params: parts.flatMap(([, rhs]) => rhs.params),
  };
}

// `matchRegion` forces the region match for non-partners too (the region list
// has always counted district rows that way).
function districtPlacement(scope: Scope, ref: string | DistrictRef, matchRegion = false): Placement {
  const parts: [string, Placement][] = [['uar.district_id =', refValue(ref, 'id')]];
  if (matchRegion || scope.role === 'monitor') parts.push(['uar.region_id IS', refValue(ref, 'region_id')]);
  return placement(parts);
}

function facilityPlacement(scope: Scope, ref: string | FacilityRef): Placement {
  const parts: [string, Placement][] = [['uar.facility_id =', refValue(ref, 'id')]];
  if (scope.role === 'monitor') {
    parts.push(['uar.district_id IS', refValue(ref, 'district_id')]);
    parts.push(['uar.region_id IS', refValue(ref, 'region_id')]);
  }
  return placement(parts);
}

// ── Parent lists ──────────────────────────────────────────────────────────────
// The list a report's own row appears in one level up. Built here once, with
// archived children resolved and partner suppression applied, so the list
// endpoints and the privacy-hidden check below see exactly the same rows.
//
// Region level, partners: respondents outside every district row would let a
// lone hidden district be recovered as `region total - their report`. So each
// undistricted facility is its own pseudo-row (counted by the placement rule),
// plus one remainder pseudo-row for any other region respondent (no facility, or
// a snapshot matching no current placement). Pseudo-rows take part in
// small/complementary decisions but are never added to items; the remainder is
// never openable.
function regionDistrictList(
  scope: Scope, f: CommonFilters, regionId: number,
): { items: Record<string, unknown>[]; hiddenUndistricted: Set<number>; anyPseudoHidden: boolean } {
  const on = uarOnFilters(f);
  const dp = districtPlacement(scope, 'd', true);
  const rows = withArchived(query(
    `SELECT d.id AS district_id, d.name AS district_name, d.archived_at, ${COUNTS_SELECT}
     FROM districts d
     LEFT JOIN user_assessment_responses uar
            ON ${dp.sql}${on.sql}
     LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
     WHERE d.region_id = ?
     GROUP BY d.id, d.name, d.archived_at
     ORDER BY d.name`,
    [...dp.params, ...on.params, regionId],
  ));
  if (scope.role !== 'monitor') return { items: rows, hiddenUndistricted: new Set(), anyPseudoHidden: false };

  const fp = facilityPlacement(scope, 'fa');
  const undistricted = query<{ facility_id: number; respondents: number }>(
    `SELECT fa.id AS facility_id, COUNT(DISTINCT uar.user_id) AS respondents
     FROM facilities fa
     LEFT JOIN user_assessment_responses uar ON ${fp.sql}${on.sql}
     LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
     WHERE fa.region_id = ? AND fa.district_id IS NULL
     GROUP BY fa.id
     ORDER BY fa.name`,
    [...fp.params, ...on.params, regionId],
  );

  // Region respondents covered by no district row and no undistricted facility.
  const whereParts: string[] = [
    'uar.region_id = ?',
    `NOT (COALESCE(uar.district_id IN (SELECT id FROM districts WHERE region_id = ?), 0)
          OR COALESCE(uar.district_id IS NULL AND uar.facility_id IN
                (SELECT id FROM facilities WHERE region_id = ? AND district_id IS NULL), 0))`,
  ];
  const whereParams: SqlValue[] = [regionId, regionId, regionId];
  if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
  if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
  const remainder = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'region_id').total;

  const pseudo: Record<string, unknown>[] = [...undistricted.map((u) => ({ respondents: u.respondents })), { respondents: remainder }];
  const all = suppressSmallGroups(scope, [...rows, ...pseudo]);
  const hiddenPseudo = all.slice(rows.length);
  const hiddenUndistricted = new Set(
    undistricted.filter((_, i) => hiddenPseudo[i].suppressed !== undefined).map((u) => u.facility_id),
  );
  return {
    items: all.slice(0, rows.length),
    hiddenUndistricted,
    anyPseudoHidden: hiddenPseudo.some((i) => i.suppressed !== undefined),
  };
}

// District level, partners: respondents counted in the district (district
// placement) but in no facility row (facility placement) - no facility, or old
// snapshots of a facility that moved away - form ONE remainder pseudo-row. It
// is never openable, but with all facility rows visible `district row - facility
// rows` would expose a 1-2 person remainder, so it takes part in
// small/complementary decisions (not added to items).
function districtFacilityList(
  scope: Scope, f: CommonFilters, district: DistrictRef,
): { items: Record<string, unknown>[]; remainderHidden: boolean } {
  const on = uarOnFilters(f);
  const fp = facilityPlacement(scope, 'fa');
  const items = query(
    `SELECT fa.id AS facility_id, fa.name AS facility_name, fa.archived_at, ${COUNTS_SELECT}
     FROM facilities fa
     LEFT JOIN user_assessment_responses uar
            ON ${fp.sql}${on.sql}
     LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
     WHERE fa.district_id = ?
     GROUP BY fa.id, fa.name, fa.archived_at
     ORDER BY fa.name`,
    [...fp.params, ...on.params, district.id],
  );
  const rows = withArchived(items);
  if (scope.role !== 'monitor') return { items: rows, remainderHidden: false };

  const dp = districtPlacement(scope, district);
  const covered = facilityPlacement(scope, 'fa');
  const whereParts: string[] = [
    dp.sql,
    `NOT EXISTS (SELECT 1 FROM facilities fa WHERE fa.district_id = ? AND ${covered.sql})`,
  ];
  const whereParams: SqlValue[] = [...dp.params, district.id, ...covered.params];
  if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
  if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
  const remainder = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'facility_id').total;

  const all = suppressSmallGroups(scope, [...rows, { respondents: remainder } as Record<string, unknown>]);
  return { items: all.slice(0, -1), remainderHidden: all[all.length - 1].suppressed !== undefined };
}

// ── Privacy-hidden reports ────────────────────────────────────────────────────
// A partner could open a district/facility that is hidden in the list one level
// up and subtract it from the visible rows. So for partners a report is
// "privacy hidden" when its own row is suppressed in its parent list (same
// filters, same pipeline). A districted facility is also hidden when its
// district is (recursive); an undistricted facility is hidden exactly when its
// own pseudo-row in the region list is. Admins and staff are never affected.
function isDistrictPrivacyHidden(scope: Scope, f: CommonFilters, district: DistrictRef): boolean {
  if (scope.role !== 'monitor' || district.region_id === null) return false;
  const row = regionDistrictList(scope, f, district.region_id).items.find((i) => i.district_id === district.id);
  return row?.suppressed !== undefined;
}

function isFacilityPrivacyHidden(scope: Scope, f: CommonFilters, facility: FacilityRef): boolean {
  if (scope.role !== 'monitor') return false;
  if (facility.district_id === null) {
    return facility.region_id !== null && regionDistrictList(scope, f, facility.region_id).hiddenUndistricted.has(facility.id);
  }
  const [district] = query<{ id: number; region_id: number | null }>('SELECT id, region_id FROM districts WHERE id = ?', [facility.district_id]);
  if (!district) return false;
  const row = districtFacilityList(scope, f, district).items.find((i) => i.facility_id === facility.id);
  return row?.suppressed !== undefined || isDistrictPrivacyHidden(scope, f, district);
}

// "No district" at region level: no district_id, or a district outside the region.
function regionUnassigned(regionId: number): { sql: string; params: SqlValue[] } {
  return {
    sql: 'uar.district_id IS NULL OR uar.district_id NOT IN (SELECT id FROM districts WHERE region_id = ?)',
    params: [regionId],
  };
}

// Names and ids stay (the structure is not secret); every figure goes.
function blankItems(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map(({ archived: _archived, ...item }) => ({ ...item, ...BLANK_COUNTS, suppressed: 'parent' }));
}

function hiddenMeta(f: CommonFilters) {
  return { ...meta(f, 0, 0, null), privacy_hidden: true };
}

// ── GET /reports/national ──────────────────────────────────────────────────
router.get('/national', (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'national' });
    if (reason) return next(createError(reason, 403));

    const f = parseFilters(req);
    const on = uarOnFilters(f);

    const items = query(
      `SELECT r.id AS region_id, r.name AS region_name, r.archived_at, ${COUNTS_SELECT}
       FROM regions r
       LEFT JOIN user_assessment_responses uar ON uar.region_id = r.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       GROUP BY r.id, r.name, r.archived_at
       ORDER BY r.name`,
      on.params,
    );

    const whereParts: string[] = [];
    const whereParams: SqlValue[] = [];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    const whereSql = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
    // At national level, "unassigned" = no region_id → not in any regional bucket.
    const counts = respondentCounts(whereSql, whereParams, f, 'region_id');

    res.json({ level: 'national', items: withArchived(items), meta: meta(f, counts.total, counts.unassigned, viewAvg(scope, counts)) });
  } catch (err) { next(err); }
});

// ── GET /reports/regions/:regionId ─────────────────────────────────────────
router.get('/regions/:regionId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const regionId = Number(req.params.regionId);
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'region', regionId });
    if (reason) return next(createError(reason, 403));

    const [region] = query<{ id: number; name: string }>(
      'SELECT id, name FROM regions WHERE id = ?', [regionId],
    );
    if (!region) return next(createError('Region not found', 404));

    const f = parseFilters(req);

    const { items, anyPseudoHidden } = regionDistrictList(scope, f, regionId);

    // Facilities not yet placed in a district — surfaced so they stay reachable.
    const undistricted_facilities = query<{ id: number; name: string }>(
      'SELECT id, name FROM facilities WHERE region_id = ? AND district_id IS NULL AND archived_at IS NULL ORDER BY name',
      [regionId],
    );

    const whereParts: string[] = ['uar.region_id = ?'];
    const whereParams: SqlValue[] = [regionId];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At region level, unassigned = respondents in this region with no district_id,
    // OR whose district_id points at a district that isn't (or no longer is) in this
    // region — a snapshot left behind by a re-districted facility or a moved district.
    // Without this, such a respondent would vanish from both the bars and the total.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, regionUnassigned(regionId));

    res.json({ level: 'region', region, items, undistricted_facilities, meta: meta(f, counts.total, anyPseudoHidden ? 0 : counts.unassigned, viewAvg(scope, counts)) });
  } catch (err) { next(err); }
});

// ── GET /reports/districts/:districtId ─────────────────────────────────────
router.get('/districts/:districtId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const districtId = Number(req.params.districtId);
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'district', districtId });
    if (reason) return next(createError(reason, 403));

    const [district] = query<{ id: number; name: string; region_id: number; region_name: string | null }>(
      `SELECT d.id, d.name, d.region_id, r.name AS region_name
       FROM districts d LEFT JOIN regions r ON r.id = d.region_id
       WHERE d.id = ?`,
      [districtId],
    );
    if (!district) return next(createError('District not found', 404));

    const f = parseFilters(req);

    const { items, remainderHidden } = districtFacilityList(scope, f, district);

    const dp = districtPlacement(scope, district);
    const whereParts: string[] = [dp.sql];
    const whereParams: SqlValue[] = [...dp.params];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At district level, unassigned = respondents in this district with no facility_id.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'facility_id');

    if (isDistrictPrivacyHidden(scope, f, district)) {
      return res.json({ level: 'district', district, items: blankItems(items), meta: hiddenMeta(f) });
    }

    res.json({ level: 'district', district, items, meta: meta(f, counts.total, remainderHidden ? 0 : counts.unassigned, viewAvg(scope, counts)) });
  } catch (err) { next(err); }
});

// ── GET /reports/facilities/:facilityId ───────────────────────────────────
router.get('/facilities/:facilityId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const facilityId = Number(req.params.facilityId);
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'facility', facilityId });
    if (reason) return next(createError(reason, 403));

    const [facility] = query<{
      id: number; name: string; region_id: number | null; region_name: string | null;
      district_id: number | null; district_name: string | null;
    }>(
      `SELECT fa.id, fa.name, fa.region_id, r.name AS region_name, fa.district_id, d.name AS district_name
       FROM facilities fa
       LEFT JOIN regions r   ON r.id = fa.region_id
       LEFT JOIN districts d ON d.id = fa.district_id
       WHERE fa.id = ?`,
      [facilityId],
    );
    if (!facility) return next(createError('Facility not found', 404));

    const f = parseFilters(req);
    const on = uarOnFilters(f);

    const fp = facilityPlacement(scope, facility);

    // Every department linked to the facility (even empty ones), plus archived
    // departments — linked or not — that still have responses here (withArchived
    // drops the empty archived ones). LEFT JOIN responses keeps zero-response rows.
    const items = query(
      `SELECT d.id AS department_id, d.name AS department_name, d.archived_at, ${COUNTS_SELECT}
       FROM departments d
       LEFT JOIN facility_departments fd ON fd.department_id = d.id AND fd.facility_id = ?
       LEFT JOIN user_assessment_responses uar
              ON uar.department_id = d.id AND ${fp.sql}${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE fd.facility_id IS NOT NULL OR d.archived_at IS NOT NULL
       GROUP BY d.id, d.name, d.archived_at
       ORDER BY d.name`,
      [facilityId, ...fp.params, ...on.params],
    );

    const whereParts: string[] = [fp.sql];
    const whereParams: SqlValue[] = [...fp.params];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At facility level, unassigned = respondents in this facility with no department_id.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'department_id');

    const suppressed = suppressSmallGroups(scope, withArchived(items));
    if (isFacilityPrivacyHidden(scope, f, facility)) {
      return res.json({ level: 'facility', facility, items: blankItems(suppressed), meta: hiddenMeta(f) });
    }

    res.json({ level: 'facility', facility, items: suppressed, meta: meta(f, counts.total, counts.unassigned, viewAvg(scope, counts)) });
  } catch (err) { next(err); }
});

// ── GET /reports/departments/:departmentId ────────────────────────────────
// Departments are shared across facilities, so the grid is narrowed to one
// facility via ?facility_id=. Staff are always pinned to their own facility;
// admins without facility_id get the cross-facility view.
router.get('/departments/:departmentId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const departmentId = Number(req.params.departmentId);
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'department', departmentId });
    if (reason) return next(createError(reason, 403));

    const requestedFacilityId = req.query.facility_id !== undefined ? Number(req.query.facility_id) : null;
    if (requestedFacilityId !== null) {
      const facilityReason = denyReason(scope, { level: 'facility', facilityId: requestedFacilityId });
      if (facilityReason) return next(createError(facilityReason, 403));
    }
    const facilityId = scope.role === 'admin' ? requestedFacilityId : scope.facilityId;

    const [department] = query<{ id: number; name: string }>(
      'SELECT id, name FROM departments WHERE id = ?', [departmentId],
    );
    if (!department) return next(createError('Department not found', 404));

    let facility: { id: number; name: string } | null = null;
    if (facilityId !== null) {
      [facility] = query<{ id: number; name: string }>(
        'SELECT id, name FROM facilities WHERE id = ?', [facilityId],
      );
      if (!facility) return next(createError('Facility not found', 404));
    }

    const f = parseFilters(req);
    const on = uarOnFilters(f);
    const facilitySql = facility ? ' AND uar.facility_id = ?' : '';
    const facilityParams: SqlValue[] = facility ? [facility.id] : [];

    // Per-user grid within the department. We show only users who actually
    // have responses; users with none have nothing to render.
    const items = query(
      `SELECT u.id AS user_id,
              (u.first_name || ' ' || u.last_name) AS full_name,
              u.user_name, t.name AS title_name, ${COUNTS_SELECT}
       FROM user_assessment_responses uar
       INNER JOIN users u ON u.id = uar.user_id
       LEFT JOIN user_titles t ON t.id = u.title_id
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE uar.department_id = ?${facilitySql}${on.sql}
       GROUP BY u.id, u.first_name, u.last_name, u.user_name, t.name
       ORDER BY u.last_name, u.first_name`,
      [departmentId, ...facilityParams, ...on.params],
    );

    const whereParts: string[] = ['uar.department_id = ?'];
    const whereParams: SqlValue[] = [departmentId];
    if (facility) { whereParts.push('uar.facility_id = ?'); whereParams.push(facility.id); }
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At department level every respondent is in the bucket already — no
    // separate "unassigned" concept. Zero out to keep the meta shape stable.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'department_id');

    res.json({ level: 'department', department, facility, items, meta: meta(f, counts.total, 0, viewAvg(scope, counts)) });
  } catch (err) { next(err); }
});

// ── GET /reports/users/:userId ─────────────────────────────────────────────
// Individual breakdown — per-competency summary + per-subcompetency detail.
router.get('/users/:userId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = Number(req.params.userId);
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'user', targetUserId });
    if (reason) return next(createError(reason, 403));

    const [user] = query<{
      id: number; first_name: string; last_name: string;
      user_name: string; email: string;
      facility_name: string | null; department_name: string | null; title_name: string | null;
    }>(
      `SELECT u.id, u.first_name, u.last_name, u.user_name, u.email,
              f.name AS facility_name, d.name AS department_name, t.name AS title_name
       FROM users u
       LEFT JOIN facilities  f ON f.id = u.facility_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN user_titles t ON t.id = u.title_id
       WHERE u.id = ?`,
      [targetUserId],
    );
    if (!user) return next(createError('User not found', 404));

    const f = parseFilters(req);
    const on = uarOnFilters(f);

    const items = query(
      `SELECT uar.competency_value,
              MAX(ai.competency_text) AS competency_text, ${COUNTS_SELECT}
       FROM user_assessment_responses uar
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       LEFT JOIN assessment_items ai
              ON ai.domain_id = uar.domain_id
             AND ai.competency_value = uar.competency_value
             AND ai.subcompetency_value = uar.subcompetency_value
       WHERE uar.user_id = ?${on.sql}
       GROUP BY uar.competency_value
       ORDER BY competency_text`,
      [targetUserId, ...on.params],
    );

    const subcompetencies = query(
      `SELECT uar.domain_code, uar.competency_value, uar.subcompetency_value,
              uar.response_level, uar.response_text,
              ai.subcompetency_text, ai.competency_text, uar.created_at
       FROM user_assessment_responses uar
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       LEFT JOIN assessment_items ai
              ON ai.domain_id = uar.domain_id
             AND ai.competency_value = uar.competency_value
             AND ai.subcompetency_value = uar.subcompetency_value
       WHERE uar.user_id = ?${on.sql}
       ORDER BY ai.competency_text, ai.subcompetency_value`,
      [targetUserId, ...on.params],
    );

    res.json({
      level: 'individual',
      user,
      items,
      subcompetencies,
      meta: meta(f, 1, 0, null),
    });
  } catch (err) { next(err); }
});

export default router;
