// @ts-expect-error — Vite ?raw imports return strings
import gettingStarted from './1.0.0/getting-started.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import survey from './1.0.0/survey.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import myAssessments from './1.0.0/my-assessments.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import reports from './1.0.0/reports.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import reviews from './1.0.0/reviews.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import users from './1.0.0/users.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import assessments from './1.0.0/assessments.md?raw';
// @ts-expect-error — Vite ?raw imports return strings
import setup from './1.0.0/setup.md?raw';

export interface DocSection {
  slug: string;
  title: string;
  content: string;
}

export const DOCS_REGISTRY: Record<string, DocSection[]> = {
  '1.0.0': [
    { slug: 'getting-started', title: 'Getting Started',   content: gettingStarted as string },
    { slug: 'survey',          title: 'Survey',            content: survey         as string },
    { slug: 'my-assessments',  title: 'My Assessments',    content: myAssessments  as string },
    { slug: 'reports',         title: 'Reports',           content: reports        as string },
    { slug: 'reviews',         title: 'Reviews',           content: reviews        as string },
    { slug: 'users',           title: 'Users',             content: users          as string },
    { slug: 'assessments',     title: 'Assessments',       content: assessments    as string },
    { slug: 'setup',           title: 'Setup',             content: setup          as string },
  ],
};

/** Get docs for a specific version, falling back to the latest. */
export function getDocsForVersion(version: string): { version: string; sections: DocSection[] } {
  if (DOCS_REGISTRY[version]) {
    return { version, sections: DOCS_REGISTRY[version] };
  }
  const versions = Object.keys(DOCS_REGISTRY).sort();
  const latest = versions[versions.length - 1];
  return { version: latest, sections: DOCS_REGISTRY[latest] };
}
