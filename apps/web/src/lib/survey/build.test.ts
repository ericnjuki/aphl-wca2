import { describe, it, expect } from "vitest";
import {
  boldMarkdown,
  rawPageText,
  matchFootnotes,
  footnoteHtml,
  introHtml,
  buildSurveyJson,
  type SurveyItem,
  type Footnote,
} from "./build";

const item = (over: Partial<SurveyItem> = {}): SurveyItem => ({
  competency_value: "1",
  competency_text: "Competency one",
  subcompetency_value: "1.01",
  subcompetency_text: "Sub one",
  beginner: "Describes things",
  competent: "Verifies things",
  proficient: "Evaluates things",
  expert: "Designs things",
  na: "N/A",
  ...over,
});

describe("boldMarkdown", () => {
  it("converts **x** to <b>x</b>", () => {
    expect(boldMarkdown("**Beginner —** Describes")).toBe("<b>Beginner —</b> Describes");
  });
  it("leaves text without markers untouched", () => {
    expect(boldMarkdown("plain text")).toBe("plain text");
  });
  it("leaves a single stray asterisk untouched", () => {
    expect(boldMarkdown("protocols* and modules")).toBe("protocols* and modules");
  });
});

describe("matchFootnotes", () => {
  const fns: Footnote[] = [
    { symbol: "‡", definition: "Protocol def", sort_order: 2 },
    { symbol: "*", definition: "See Appendix B", sort_order: 1 },
    { symbol: "§", definition: "Unused", sort_order: 3 },
  ];
  it("returns only footnotes whose symbol appears, ordered by sort_order", () => {
    const out = matchFootnotes("uses protocols‡ and terms*", fns);
    expect(out.map((f) => f.symbol)).toEqual(["*", "‡"]);
  });
  it("returns empty when no symbols are present", () => {
    expect(matchFootnotes("no markers here", fns)).toEqual([]);
  });
});

describe("rawPageText", () => {
  it("includes answer text but not injected bold prefixes", () => {
    const text = rawPageText([item({ beginner: "marked*" })]);
    expect(text).toContain("marked*");
    expect(text).not.toContain("**");
  });
});

describe("footnoteHtml", () => {
  it("returns empty string for no footnotes", () => {
    expect(footnoteHtml([])).toBe("");
  });
  it("renders one row per footnote with symbol and definition", () => {
    const html = footnoteHtml([{ symbol: "*", definition: "See Appendix B", sort_order: 1 }]);
    expect(html).toContain("See Appendix B");
    expect(html).toContain("*");
  });
});

describe("introHtml", () => {
  it("includes name, code, and both sections when present", () => {
    const html = introHtml({ code: "INF", name: "Informatics", version: 1, purpose: "P text", introduction: "I text" });
    expect(html).toContain("Informatics");
    expect(html).toContain("INF");
    expect(html).toContain("Purpose");
    expect(html).toContain("P text");
    expect(html).toContain("Introduction");
    expect(html).toContain("I text");
  });
  it("omits sections that are empty/missing", () => {
    const html = introHtml({ code: "INF", name: "Informatics", version: 1 });
    expect(html).not.toContain("Purpose");
    expect(html).not.toContain("Introduction");
  });
});

describe("buildSurveyJson", () => {
  const domain = { code: "INF", name: "Informatics", version: 1, purpose: "P", introduction: "I" };
  it("puts the intro on the first (start) page", () => {
    const json = buildSurveyJson(domain, [item()], []);
    expect(json.firstPageIsStartPage).toBe(true);
    const startHtml = (json.pages[0].elements[0] as { html: string }).html;
    expect(startHtml).toContain("Informatics");
    expect(startHtml).toContain("Purpose");
  });
  it("prefixes each level choice in bold-markdown", () => {
    const json = buildSurveyJson(domain, [item()], []);
    const q = json.pages[1].elements[0] as { choices: { value: string; text: string }[] };
    expect(q.choices[0].text).toBe("**Beginner —** Describes things");
    expect(q.choices[4].text).toBe("N/A");
  });
  it("appends a footnote html element only when a symbol matches the page", () => {
    const fns: Footnote[] = [{ symbol: "*", definition: "See Appendix B", sort_order: 1 }];
    const withMark = buildSurveyJson(domain, [item({ beginner: "describes modules*" })], fns);
    const withoutMark = buildSurveyJson(domain, [item()], fns);
    const types = (p: { elements: { type: string }[] }) => p.elements.map((e) => e.type);
    expect(types(withMark.pages[1])).toContain("html");
    expect(types(withoutMark.pages[1])).not.toContain("html");
  });

  it("groups items by competency_text onto separate pages", () => {
    const a = item({ competency_text: "Comp A", competency_value: "1", subcompetency_value: "1.01" });
    const b = item({ competency_text: "Comp B", competency_value: "2", subcompetency_value: "2.01" });
    const json = buildSurveyJson(domain, [a, b], []);
    expect(json.pages).toHaveLength(3); // start page + 2 competency pages
    expect(json.pages[1].title).toBe("Comp A");
    expect(json.pages[2].title).toBe("Comp B");
  });

  it("produces unique question names across all competency pages", () => {
    const a = item({ competency_text: "Comp A", competency_value: "1", subcompetency_value: "1.01" });
    const b = item({ competency_text: "Comp A", competency_value: "1", subcompetency_value: "1.02" });
    const c = item({ competency_text: "Comp B", competency_value: "2", subcompetency_value: "2.01" });
    const json = buildSurveyJson(domain, [a, b, c], []);
    const names = json.pages
      .slice(1)
      .flatMap((p) => p.elements.map((e) => (e as { name?: string }).name))
      .filter((n): n is string => typeof n === "string" && !n.includes("-fn-"));
    expect(new Set(names).size).toBe(names.length);
    // Comp A page holds both subcompetencies.
    expect(json.pages[1].elements.filter((e) => (e as { type: string }).type === "radiogroup")).toHaveLength(2);
  });
});
