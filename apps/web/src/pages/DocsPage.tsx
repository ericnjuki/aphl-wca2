import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ContentLayout } from "@/components/admin-panel/content-layout";
import { Badge } from "@/components/ui/badge";
import { getDocsForVersion, type DocSection } from "@/docs";

// Markdown renderers — mirror the reference UI: sectioned headings, hover
// rows on tables, inline/block code pill styling, and blockquotes.
const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold mb-4 pb-2 border-b border-border">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold mt-8 mb-3 text-[color:var(--color-chart-2)]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed mb-3 text-muted-foreground">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-inside space-y-1 mb-3 text-sm text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside space-y-1 mb-3 text-sm text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  table: ({ children }) => (
    <div className="mb-4 rounded-md border border-border overflow-hidden">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b border-border">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 border-b border-border text-sm">{children}</td>
  ),
  tr: ({ children }) => (
    <tr className="transition-colors hover:bg-[rgba(70,130,180,0.08)]">
      {children}
    </tr>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="bg-muted/60 border border-border rounded-md p-3 mb-3 overflow-x-auto">
          <code className="text-xs font-mono text-[color:var(--color-chart-2)]">
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code className="bg-muted/50 px-1.5 py-0.5 rounded text-xs font-mono text-[color:var(--color-chart-2)]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-[color:var(--color-chart-2)] underline underline-offset-2 hover:brightness-125"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[rgba(70,130,180,0.3)] pl-4 my-3 text-sm text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-6" />,
};

const DOCS_VERSION = "1.0.0";

function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sections, setSections] = useState<DocSection[]>([]);
  const [docsVersion, setDocsVersion] = useState(DOCS_VERSION);
  const [activeSlug, setActiveSlug] = useState<string | null>(
    searchParams.get("section"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const docs = getDocsForVersion(DOCS_VERSION);
    setDocsVersion(docs.version);
    setSections(docs.sections);
    if (docs.sections.length > 0) {
      // If the URL asks for a specific section (e.g. from an in-app link),
      // honour it; otherwise start at Getting Started.
      const requested = searchParams.get("section");
      const valid =
        requested && docs.sections.some((s) => s.slug === requested)
          ? requested
          : docs.sections[0].slug;
      setActiveSlug(valid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSection = sections.find((s) => s.slug === activeSlug);

  function pickSection(slug: string) {
    setActiveSlug(slug);
    setSearchParams({ section: slug }, { replace: true });
  }

  return (
    <ContentLayout nav={<h1 className="font-bold text-sm">Docs</h1>}>
      <div className="flex w-full h-[calc(100vh-26px-56px)]">
        {/* ── Left: Table of Contents (collapsible) ────────────── */}
        <div
          className={`shrink-0 overflow-y-auto border-r border-border transition-[width] duration-200 ease-in-out ${
            sidebarCollapsed ? "w-10" : "w-64"
          }`}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-2 py-2">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2 pl-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Docs
                </span>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  v{docsVersion}
                </Badge>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[rgba(70,130,180,0.08)] hover:text-foreground"
              title={sidebarCollapsed ? "Expand" : "Collapse"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {!sidebarCollapsed && (
            <nav className="flex flex-col">
              {sections.map((section) => (
                <button
                  key={section.slug}
                  onClick={() => pickSection(section.slug)}
                  className={`border-b border-border px-3 py-2 text-left text-sm transition-colors ${
                    activeSlug === section.slug
                      ? "bg-[rgba(70,130,180,0.15)] text-[color:var(--color-chart-2)]"
                      : "hover:bg-[rgba(70,130,180,0.08)]"
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </nav>
          )}
        </div>

        {/* ── Right: Content ───────────────────────────────────── */}
        <div className="w-full flex-1 overflow-y-auto p-6">
          {activeSection ? (
            // `mx-auto` keeps the reading column at a comfortable width
            // but centers it in the available space — otherwise collapsing
            // the TOC sidebar just leaves a big empty gutter on the right.
            <div className="w-full">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {activeSection.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a topic from the sidebar.
            </div>
          )}
        </div>
      </div>
    </ContentLayout>
  );
}

export default DocsPage;
