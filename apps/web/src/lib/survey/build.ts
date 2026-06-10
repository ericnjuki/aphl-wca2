// Pure builders for the assessment SurveyJS model. Kept free of React/SurveyJS
// runtime imports so they can be unit-tested in a plain node environment.

export interface DomainMeta {
  code: string;
  name: string;
  version: number;
  purpose?: string | null;
  introduction?: string | null;
}

export interface SurveyItem {
  competency_value: string;
  competency_text: string;
  subcompetency_value: string;
  subcompetency_text: string;
  beginner: string;
  competent: string;
  proficient: string;
  expert: string;
  na: string;
}

export interface Footnote {
  symbol: string;
  definition: string;
  sort_order: number;
}

/** Convert **bold** markers to <b> tags. Leaves all other text untouched. */
export function boldMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/**
 * All raw, human-authored text on a competency page (titles + answers), used
 * for footnote symbol detection. Excludes the injected "**Level —**" prefixes
 * so the bold markers never trigger the generic "*" footnote.
 */
export function rawPageText(items: SurveyItem[]): string {
  return items
    .map((it) =>
      [it.competency_text, it.subcompetency_text, it.beginner, it.competent, it.proficient, it.expert, it.na].join(" "),
    )
    .join(" ");
}

/** Footnotes whose symbol appears in the page text, ordered by sort_order. */
export function matchFootnotes(pageText: string, footnotes: Footnote[]): Footnote[] {
  return footnotes
    .filter((f) => f.symbol && pageText.includes(f.symbol))
    .sort((a, b) => a.sort_order - b.sort_order);
}

// NOTE: purpose/introduction/symbol/definition are admin-authored, trusted
// content interpolated directly into HTML (no escaping), consistent with the
// team's accepted trusted-content model for SurveyJS html questions.

/** HTML for the per-page footnote block, or "" when there are no footnotes. */
export function footnoteHtml(footnotes: Footnote[]): string {
  if (footnotes.length === 0) return "";
  const rows = footnotes
    .map(
      (f) =>
        `<div class="flex gap-2 py-0.5"><span class="font-bold flex-none w-4">${f.symbol}</span><span>${f.definition}</span></div>`,
    )
    .join("");
  return `<div class="mt-3 border-t pt-2 text-xs text-muted-foreground leading-relaxed">${rows}</div>`;
}

/**
 * HTML for the domain Start page: name + code, then Purpose / Introduction
 * sections (each omitted when empty). Layout B — left-aligned, labeled.
 */
export function introHtml(domain: DomainMeta): string {
  const sections: string[] = [];
  if (domain.purpose && domain.purpose.trim()) {
    sections.push(
      `<div class="mt-4"><div class="text-xs font-bold uppercase tracking-wide text-primary">Purpose</div>` +
        `<div class="mt-1 text-sm leading-relaxed">${domain.purpose}</div></div>`,
    );
  }
  if (domain.introduction && domain.introduction.trim()) {
    sections.push(
      `<div class="mt-4"><div class="text-xs font-bold uppercase tracking-wide text-primary">Introduction</div>` +
        `<div class="mt-1 text-sm leading-relaxed text-muted-foreground">${domain.introduction}</div></div>`,
    );
  }
  return (
    `<div class="w-full max-w-2xl mx-auto px-2 py-4">` +
    `<div class="text-lg font-bold uppercase">${domain.name}</div>` +
    `<div class="text-xs text-muted-foreground">${domain.code} · v${domain.version}</div>` +
    sections.join("") +
    `</div>`
  );
}

/** Build the full SurveyJS model JSON from domain + items + footnotes. */
export function buildSurveyJson(domain: DomainMeta, items: SurveyItem[], footnotes: Footnote[]) {
  // Group items by competency_text, preserving first-seen order.
  const groups = new Map<string, SurveyItem[]>();
  for (const it of items) {
    const arr = groups.get(it.competency_text) ?? [];
    arr.push(it);
    groups.set(it.competency_text, arr);
  }

  const competencyPages = [...groups.entries()].map(([competencyText, groupItems]) => {
    const elements: Record<string, unknown>[] = groupItems.map((item) => ({
      type: "radiogroup",
      name: `${domain.code}-${domain.version}-${item.competency_value}-${item.subcompetency_value}`,
      title: `${item.subcompetency_value} - ${item.subcompetency_text}`,
      isRequired: true,
      choices: [
        { value: "beginner", text: `**Beginner —** ${item.beginner}` },
        { value: "competent", text: `**Competent —** ${item.competent}` },
        { value: "proficient", text: `**Proficient —** ${item.proficient}` },
        { value: "expert", text: `**Expert —** ${item.expert}` },
        { value: "na", text: item.na },
      ],
    }));

    const fnHtml = footnoteHtml(matchFootnotes(rawPageText(groupItems), footnotes));
    if (fnHtml) {
      elements.push({
        type: "html",
        name: `${domain.code}-fn-${groupItems[0].competency_value}`,
        html: fnHtml,
      });
    }

    return {
      name: `${domain.code}-${groupItems[0].competency_value}`,
      title: competencyText,
      elements,
    };
  });

  return {
    pages: [
      { elements: [{ type: "html", name: "intro", html: introHtml(domain) }] },
      ...competencyPages,
    ],
    pageNextText: "Next",
    completeText: "Submit",
    showPrevButton: false,
    firstPageIsStartPage: true,
    startSurveyText: "Start",
    completedHtml: `Thank you for completing the assessment!
          <div class="w-full flex items-center justify-center mt-4">
            <button id="startAgain" class="flex">New assessment</button>
          </div>`,
    showQuestionNumbers: true,
    requiredMark: "(*)",
  };
}
