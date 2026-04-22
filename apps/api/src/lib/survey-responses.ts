// Extract per-subcompetency responses from a SurveyJS result blob so the
// reports API can aggregate without re-parsing JSON at query time.
//
// The survey page builds each radiogroup with:
//   name  = `${domain.code}-${domain.version}-${competency_value}-${subcompetency_value}`
//   value = 'beginner' | 'competent' | 'proficient' | 'expert' | 'na'
// see: web/src/pages/SurveyPage.tsx

export interface AssessmentItem {
  id: number;
  domain_id: number;
  competency_value: string;
  subcompetency_value: string;
  beginner: string;
  competent: string;
  proficient: string;
  expert: string;
  na: string;
}

export interface DomainRef {
  id: number;
  code: string;
  version: number;
}

export interface ExtractedResponse {
  domain_id: number;
  competency_value: string;
  subcompetency_value: string;
  response_level: 0 | 1 | 2 | 3 | 4;
  response_text: string | null;
}

const LEVEL_BY_VALUE: Record<string, 0 | 1 | 2 | 3 | 4> = {
  na: 0,
  beginner: 1,
  competent: 2,
  proficient: 3,
  expert: 4,
};

function parseSurveyData(surveyData: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(surveyData);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the canonical { question_name → response } rows for a completed session.
 * Missing / malformed answers yield no row (not an N/A row) — reports should
 * only count actual answers.
 */
export function extractResponses(
  surveyData: string,
  domain: DomainRef,
  items: AssessmentItem[],
): ExtractedResponse[] {
  const data = parseSurveyData(surveyData);
  if (!data) {
    console.warn(`[extract] malformed survey_data for domain ${domain.code}`);
    return [];
  }

  const out: ExtractedResponse[] = [];
  for (const item of items) {
    const key = `${domain.code}-${domain.version}-${item.competency_value}-${item.subcompetency_value}`;
    const raw = data[key];
    if (raw == null || raw === '') continue;

    const valueStr = String(raw).trim().toLowerCase();
    const level = LEVEL_BY_VALUE[valueStr];
    if (level === undefined) continue;

    // Resolve the human-readable description we showed the user at that level.
    const responseText =
      level === 0 ? item.na
      : level === 1 ? item.beginner
      : level === 2 ? item.competent
      : level === 3 ? item.proficient
      : item.expert;

    out.push({
      domain_id: domain.id,
      competency_value: item.competency_value,
      subcompetency_value: item.subcompetency_value,
      response_level: level,
      response_text: responseText || null,
    });
  }

  return out;
}
