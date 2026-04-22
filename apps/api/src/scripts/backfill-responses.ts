// One-time backfill: populate user_assessment_responses from existing
// completed user_assessments rows. Idempotent — only runs when the
// responses table is empty.
//
// Called from server startup after migrations. Uses the user's *current*
// org context (facility/department/region) for historical rows — document
// this caveat; new completions snapshot correctly.

import { query, execute, transaction } from '../db/database';
import { extractResponses, AssessmentItem, DomainRef } from '../lib/survey-responses';

interface CompletedAssessmentRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  domain_code: string;
  survey_data: string | null;
}

export function backfillResponses(): void {
  const [{ c: respCount }] = query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM user_assessment_responses',
  );
  if (respCount > 0) return; // already backfilled

  const completed = query<CompletedAssessmentRow>(
    `SELECT id, user_id, domain_code, survey_data
     FROM user_assessments
     WHERE status = 'completed' AND survey_data IS NOT NULL`,
  );
  if (completed.length === 0) {
    console.log('[backfill] no completed assessments to backfill');
    return;
  }

  let totalRows = 0;
  let skipped = 0;

  transaction(() => {
    for (const ua of completed) {
      if (!ua.survey_data) { skipped++; continue; }

      const [domain] = query<DomainRef & Record<string, unknown>>(
        'SELECT id, code, version FROM assessment_domains WHERE code = ? COLLATE NOCASE',
        [ua.domain_code],
      );
      if (!domain) { skipped++; continue; }

      const items = query<AssessmentItem & Record<string, unknown>>(
        `SELECT id, domain_id, competency_value, subcompetency_value,
                beginner, competent, proficient, expert, na
         FROM assessment_items WHERE domain_id = ?`,
        [domain.id],
      );

      const [orgCtx] = query<{
        facility_id: number | null;
        department_id: number | null;
        region_id: number | null;
      }>(
        `SELECT u.facility_id, u.department_id, f.region_id
         FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
         WHERE u.id = ?`,
        [ua.user_id],
      );

      const responses = extractResponses(ua.survey_data, domain, items);
      for (const r of responses) {
        execute(
          `INSERT INTO user_assessment_responses
             (user_assessment_id, user_id, domain_id, domain_code,
              competency_value, subcompetency_value,
              response_level, response_text,
              facility_id, department_id, region_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            ua.id, ua.user_id, r.domain_id, ua.domain_code,
            r.competency_value, r.subcompetency_value,
            r.response_level, r.response_text,
            orgCtx?.facility_id ?? null,
            orgCtx?.department_id ?? null,
            orgCtx?.region_id ?? null,
          ],
        );
        totalRows++;
      }
    }
  });

  console.log(
    `[backfill] responses: ${totalRows} rows from ${completed.length - skipped}/${completed.length} sessions`,
  );
}
