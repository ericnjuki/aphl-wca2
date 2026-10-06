// Aggregate reports over user_assessment_responses.
//
// All endpoints share query params:
//   domain_code?       filter to one competency domain (e.g. "LAB-SAFETY")
//   competency_value?  filter to one competency within that domain
//   approved_only?     default true — exclude rejected/pending submissions
//
// Response envelope:
//   { level, items, meta: { total_respondents, generated_at, filters } }
//
// LEFT JOIN pattern: the response-row filters (domain/competency/approved)
// live in the JOIN's ON clause so buckets with zero responses still appear
// in the output — otherwise empty regions/facilities/departments vanish.

import { Router, Request, Response, NextFunction } from 'express';
import { SqlValue } from 'sql.js';
import { query } from '../db/database';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { getScope, denyReason } from '../lib/report-scope';

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

function meta(f: CommonFilters, totalRespondents: number, unassigned: number) {
  return {
    total_respondents: totalRespondents,
    unassigned_respondents: unassigned,
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
): { total: number; unassigned: number } {
  const unassignedSql = typeof unassigned === 'string' ? `uar.${unassigned} IS NULL` : unassigned.sql;
  const unassignedParams = typeof unassigned === 'string' ? [] : unassigned.params;
  const [row] = query<{ total: number; unassigned: number }>(
    `SELECT
       COUNT(DISTINCT uar.user_id)                                       AS total,
       COUNT(DISTINCT CASE WHEN ${unassignedSql} THEN uar.user_id END)   AS unassigned
     FROM user_assessment_responses uar
     LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
     ${whereSql}`,
    [...unassignedParams, ...whereParams],
  );
  return { total: row?.total ?? 0, unassigned: row?.unassigned ?? 0 };
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
      `SELECT r.id AS region_id, r.name AS region_name, ${COUNTS_SELECT}
       FROM regions r
       LEFT JOIN user_assessment_responses uar ON uar.region_id = r.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       GROUP BY r.id, r.name
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

    res.json({ level: 'national', items, meta: meta(f, counts.total, counts.unassigned) });
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
    const on = uarOnFilters(f);

    const items = query(
      `SELECT d.id AS district_id, d.name AS district_name, ${COUNTS_SELECT}
       FROM districts d
       LEFT JOIN user_assessment_responses uar
              ON uar.district_id = d.id AND uar.region_id = d.region_id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE d.region_id = ?
       GROUP BY d.id, d.name
       ORDER BY d.name`,
      [...on.params, regionId],
    );

    // Facilities not yet placed in a district — surfaced so they stay reachable.
    const undistricted_facilities = query<{ id: number; name: string }>(
      'SELECT id, name FROM facilities WHERE region_id = ? AND district_id IS NULL ORDER BY name',
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
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, {
      sql: 'uar.district_id IS NULL OR uar.district_id NOT IN (SELECT id FROM districts WHERE region_id = ?)',
      params: [regionId],
    });

    res.json({ level: 'region', region, items, undistricted_facilities, meta: meta(f, counts.total, counts.unassigned) });
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
    const on = uarOnFilters(f);

    const items = query(
      `SELECT fa.id AS facility_id, fa.name AS facility_name, ${COUNTS_SELECT}
       FROM facilities fa
       LEFT JOIN user_assessment_responses uar
              ON uar.facility_id = fa.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE fa.district_id = ?
       GROUP BY fa.id, fa.name
       ORDER BY fa.name`,
      [...on.params, districtId],
    );

    const whereParts: string[] = ['uar.district_id = ?'];
    const whereParams: SqlValue[] = [districtId];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At district level, unassigned = respondents in this district with no facility_id.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'facility_id');

    res.json({ level: 'district', district, items, meta: meta(f, counts.total, counts.unassigned) });
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

    // INNER JOIN facility_departments ensures we list every dept owned by the
    // facility (even empty ones); LEFT JOIN responses so zero-response depts stay.
    const items = query(
      `SELECT d.id AS department_id, d.name AS department_name, ${COUNTS_SELECT}
       FROM departments d
       INNER JOIN facility_departments fd ON fd.department_id = d.id AND fd.facility_id = ?
       LEFT JOIN user_assessment_responses uar
              ON uar.department_id = d.id AND uar.facility_id = ?${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       GROUP BY d.id, d.name
       ORDER BY d.name`,
      [facilityId, facilityId, ...on.params],
    );

    const whereParts: string[] = ['uar.facility_id = ?'];
    const whereParams: SqlValue[] = [facilityId];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At facility level, unassigned = respondents in this facility with no department_id.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'department_id');

    res.json({ level: 'facility', facility, items, meta: meta(f, counts.total, counts.unassigned) });
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

    res.json({ level: 'department', department, facility, items, meta: meta(f, counts.total, 0) });
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
      meta: meta(f, 1, 0),
    });
  } catch (err) { next(err); }
});

export default router;
