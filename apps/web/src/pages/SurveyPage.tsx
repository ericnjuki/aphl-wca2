"use client";

import "survey-core/survey-core.css";
import {
  CompleteEvent,
  Model,
  UIStateChangedEvent,
  ValueChangedEvent,
} from "survey-core";
import { Survey } from "survey-react-ui";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ContentLayout } from "@/components/admin-panel/content-layout";
import { DefaultDark, DefaultLight } from "survey-core/themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCurrentTheme } from "@/lib/theme";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/loading-spinner";
import React from "react";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Info, ListRestart, PlayCircle, RotateCcw, Save } from "lucide-react";
import { useMultiNamespaceTranslation } from "@/i18n/hooks";
import { useSurveySession } from "@/hooks/misc/useSurveySession";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { buildSurveyJson, boldMarkdown } from "@/lib/survey/build";

interface AssessmentDomain {
  id: number;
  code: string;
  name: string;
  version: number;
  purpose?: string | null;
  introduction?: string | null;
}

interface AssessmentItem {
  id: number;
  domain_id: number;
  competency_value: string;
  competency_text: string;
  subcompetency_value: string;
  subcompetency_text: string;
  beginner: string;
  competent: string;
  proficient: string;
  expert: string;
  na: string;
  sort_order: number;
}

function SurveyPage() {
  const { t } = useMultiNamespaceTranslation(["common", "app"]);

  // Query-param driven entry:
  //   ?domain=<code>            → preselect that domain
  //   ?domain=<code>&resume=1   → preselect AND auto-trigger the Resume flow
  // My-assessments "Resume" button links here with resume=1 so the user
  // lands straight back in the questionnaire instead of the domain picker.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDomain = searchParams.get("domain") ?? undefined;
  const urlResume = searchParams.get("resume") === "1";

  const [domainCode, setDomainCode] = useState<string | undefined>(urlDomain);
  const [isSurveying, setIsSurveying] = useState<boolean>(false);
  const [canSave, setCanSave] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);

  // Set once we auto-resume from the URL so we don't re-trigger on re-renders.
  const autoResumedRef = React.useRef(false);

  // Flag set before calling survey.start() during a resume so onStarted
  // knows not to create a new session.
  const isResumingRef = React.useRef(false);

  const [theme, setTheme] = useState(getCurrentTheme);

  const {
    session,
    existingSession,
    isCheckingResume,
    checkExisting,
    startNew,
    resume,
    startOver,
    autoSave,
    save,
    complete,
    reset,
  } = useSurveySession();

  // Always-current session ref so memo'd survey handlers aren't stale.
  const sessionRef = React.useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const onThemeChange = () => setTheme(getCurrentTheme());
    window.addEventListener("themechange", onThemeChange);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onThemeChange);
    return () => {
      window.removeEventListener("themechange", onThemeChange);
      mq.removeEventListener("change", onThemeChange);
    };
  }, []);

  // Keep domainCode state in sync with the URL so that navigating here from
  // My Assessments with a different ?domain= picks up the new value even
  // when SurveyPage is already mounted (React Router doesn't remount on
  // query-param changes within the same route).
  useEffect(() => {
    if (urlDomain && urlDomain !== domainCode) {
      autoResumedRef.current = false; // allow a fresh auto-resume for the new domain
      setDomainCode(urlDomain);
    }
  }, [urlDomain, domainCode]);

  // When domain changes, check for an existing in-progress session.
  useEffect(() => {
    reset();
    setIsSurveying(false);
    setCanSave(false);
    if (domainCode) {
      checkExisting(domainCode);
    }
  }, [domainCode, checkExisting, reset]);

  const { data: domains } = useQuery({
    queryKey: ["assessments", "domains"],
    queryFn: async () => {
      const res = await api.get<{ domains: AssessmentDomain[] }>(
        "/assessments/domains",
      );
      if (res.error !== null) throw new Error(res.error);
      return res.data.domains; // already sorted by name from API
    },
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
  });

  const { data, isLoading, isRefetching } = useQuery({
    queryKey: ["assessments", domainCode, "assessment"],
    queryFn: async () => {
      if (!domainCode || !domains) return null;

      const domain = domains.find((d) => d.code === domainCode);
      if (!domain) return null;

      const itemsRes = await api.get<{ items: AssessmentItem[] }>(
        `/assessments/domains/${domain.id}/items`,
      );
      if (itemsRes.error !== null) throw new Error(itemsRes.error);

      // Footnotes are optional: a failure here must not block the survey.
      const fnRes = await api.get<{ footnotes: { symbol: string; definition: string; sort_order: number }[] }>(
        `/assessments/domains/${domain.id}/footnotes`,
      );
      const footnotes = fnRes.error === null ? fnRes.data.footnotes : [];

      return buildSurveyJson(
        { code: domain.code, name: domain.name, version: domain.version, purpose: domain.purpose, introduction: domain.introduction },
        itemsRes.data.items,
        footnotes,
      );
    },
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
  });

  const survey = React.useMemo(() => {
    const _survey = new Model(data ?? undefined);

    // Render the "**Level —**" prefix (and any other ** **) as bold. Only
    // touch strings that actually contain markers so plain titles/answers
    // pass through unchanged.
    _survey.onTextMarkdown.add((_sender: Model, options: { text: string; html: string }) => {
      if (options.text.includes("**")) options.html = boldMarkdown(options.text);
    });

    _survey.onStarted.add(async (_sender: Model) => {
      // Resume path: session already exists, skip creation.
      if (isResumingRef.current) {
        isResumingRef.current = false;
        return;
      }

      if (!domainCode || !domains) return;
      const domain = domains.find((d) => d.code === domainCode);
      if (!domain) return;

      const result = await startNew(domainCode, domain.name);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setIsSurveying(true);
    });

    _survey.onComplete.add(async (sender: Model, _options: CompleteEvent) => {
      if (!sessionRef.current) return;
      const result = await complete(sessionRef.current.id, sender.data);
      if (result.error) {
        toast.error(`Failed to save results: ${result.error}`);
      } else {
        toast.success("Assessment submitted successfully.");
      }

      setTimeout(() => {
        const btn = document.getElementById("startAgain");
        if (btn) {
          btn.onclick = () => {
            sender.clear(true, true);
            setIsSurveying(false);
            reset();
            if (domainCode) checkExisting(domainCode);
          };
        }
      }, 0);
    });

    _survey.onValueChanged.add(
      (_sender: Model, _options: ValueChangedEvent) => {
        const hasAnswers = Object.keys(_sender.data).length > 0;
        setCanSave(hasAnswers);
        console.log("onValueChanged", sessionRef.current, hasAnswers);
        if (sessionRef.current && hasAnswers) {
          autoSave(sessionRef.current.id, _sender.data, _sender.uiState ?? {});
        }
      },
    );

    _survey.onUIStateChanged.add(
      (_sender: Model, _options: UIStateChangedEvent) => {
        console.log(
          "onUIStateChanged",
          sessionRef.current,
          Object.keys(_sender.data).length > 0,
        );
        if (sessionRef.current && Object.keys(_sender.data).length > 0) {
          autoSave(sessionRef.current.id, _sender.data, _sender.uiState ?? {});
        }
      },
    );

    return _survey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading, isRefetching]);

  survey.applyTheme(theme === "dark" ? DefaultDark : DefaultLight);

  // Auto-resume: when arriving from My Assessments with ?domain=X&resume=1,
  // wait until the domain questionnaire and the existing session are both
  // loaded, then trigger the resume flow once.
  useEffect(() => {
    if (autoResumedRef.current) return;
    if (!urlResume) return;
    if (!existingSession) return;
    if (!data || isLoading || isRefetching) return; // survey model not ready

    autoResumedRef.current = true;
    // Strip the resume flag so a refresh doesn't re-trigger unexpectedly.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("resume");
      return next;
    }, { replace: true });

    void handleResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlResume, existingSession, data, isLoading, isRefetching]);

  useEffect(() => {
    if (survey.currentPageNo === 0 && isSurveying) {
      setIsSurveying(false);
    }
  }, [survey, isSurveying]);

  // ── Resume handlers ─────────────────────────────────────────────────────────

  async function handleResume() {
    if (!existingSession) return;
    isResumingRef.current = true;
    const restored = resume(existingSession); // returns { survey_data, ui_state } strings
    setIsSurveying(true);
    survey.start(); // advances past start page; onStarted sees isResumingRef and skips session creation

    // Restore answers and page position after start() advances the model.
    if (restored.survey_data) {
      try {
        survey.data = JSON.parse(restored.survey_data) as Record<
          string,
          unknown
        >;
        setCanSave(Object.keys(survey.data).length > 0);
      } catch {
        /* malformed — ignore */
      }
    }
    if (restored.ui_state) {
      try {
        survey.uiState = JSON.parse(restored.ui_state) as Record<
          string,
          unknown
        >;
      } catch {
        /* malformed — ignore */
      }
    }
  }

  async function handleStartOver() {
    if (!existingSession || !domainCode || !domains) return;
    const domain = domains.find((d) => d.code === domainCode);
    if (!domain) return;
    const result = await startOver(existingSession.id, domainCode, domain.name);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    survey.clear(true, true);
    setIsSurveying(false);
    setCanSave(false);
  }

  // ── Manual save ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!session) return;
    setIsSaving(true);
    const result = await save(session.id, survey.data, survey.uiState ?? {});
    setIsSaving(false);
    if (result.error) {
      toast.error(`Save failed: ${result.error}`);
    } else {
      toast.success("Progress saved.");
    }
  }

  // ── Nav bar ─────────────────────────────────────────────────────────────────

  const navComponents = () => (
    <div className="flex min-h-13 max-h-13 w-full items-center pr-2 py-2">
      <div className="flex flex-row items-center">
        <Select
          disabled={(domains || []).length === 0 || isSurveying}
          value={domainCode}
          onValueChange={setDomainCode}
        >
          <SelectTrigger className="focus:ring-0 w-50 h-8 justify-between">
            <SelectValue placeholder="Domains" />
          </SelectTrigger>
          <SelectContent
            className="flex bg-background"
            side="bottom"
            avoidCollisions={false}
            position="popper"
          >
            {(domains || []).map((value) => (
              <SelectItem
                key={value.id}
                value={value.code}
                description={value.code}
              >
                {value.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-row items-center text-xs">
        <Separator orientation="vertical" className="mx-2 min-h-6" />
        {session ? (
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>
              <div className="flex flex-col gap-0.5 text-xs">
                <span>Session: {session.id}</span>
                <span>
                  Started: {new Date(session.started_at).toLocaleString()}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Info className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <div className="flex flex-1" />

      <div className="flex h-full items-center">
        <Separator orientation="vertical" className="mx-2 min-h-6" />
        <div className="flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                disabled={
                  isRefetching || isLoading || !domainCode || !isSurveying
                }
                onClick={() => {
                  survey.clear(true, true);
                  setIsSurveying(false);
                  reset();
                  if (domainCode) checkExisting(domainCode);
                }}
                variant="ghost"
                size="icon"
              >
                <ListRestart className="h-4 w-4" />
                <span className="sr-only">{t("common:actions.clear")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="text-sm">{t("common:actions.clear")}</span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                disabled={
                  isRefetching ||
                  isLoading ||
                  !domainCode ||
                  !isSurveying ||
                  !canSave ||
                  isSaving
                }
                variant="ghost"
                size="icon"
                onClick={handleSave}
              >
                <Save className="h-4 w-4" />
                <span className="sr-only">{t("common:actions.save")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="text-sm">{t("common:actions.save")}</span>
            </TooltipContent>
          </Tooltip>
        </div>
        <Separator orientation="vertical" className="mx-2 min-h-6" />
      </div>
    </div>
  );

  // ── Resume banner ────────────────────────────────────────────────────────────

  const resumeBanner = existingSession && !isSurveying && (
    <div className="flex items-center justify-between gap-4 rounded-sm border border-yellow-400/40 bg-yellow-400/10 px-4 py-3 text-sm mx-4 mt-4">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">Unfinished assessment</span>
        <span className="text-muted-foreground text-xs">
          Last saved {new Date(existingSession.updated_at).toLocaleString()}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleStartOver}
          className="gap-1.5 h-7 text-xs rounded-xs"
        >
          <RotateCcw className="h-3 w-3" /> Start over
        </Button>
        <Button
          size="sm"
          onClick={handleResume}
          className="gap-1.5 h-7 text-xs rounded-xs"
        >
          <PlayCircle className="h-3 w-3" /> Resume
        </Button>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ContentLayout nav={navComponents()}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full h-full">
        <div className="flex flex-col w-full h-full bg-[#f3f3f3] dark:bg-[#242424] overflow-auto min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)]">
          {isLoading || isRefetching || isCheckingResume ? (
            <div className="w-full min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] flex items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : domainCode ? (
            <>
              {resumeBanner}
              <Survey model={survey} id="surveyContainer" />
            </>
          ) : (
            <div className="flex min-h-[calc(100vh-26px-58px)] max-h-[calc(100vh-26px-58px)] flex-col items-center justify-center h-full w-full relative">
              <div className="flex flex-1 h-full w-full relative">
                <svg
                  className="absolute inset-0 size-full z-0 stroke-foreground/10 m-0 p-0"
                  fill="none"
                >
                  <defs>
                    <pattern
                      id="pattern-5c1e4f0e-62d5-498b-8ff0-cf77bb448c8e"
                      x="0"
                      y="0"
                      width="10"
                      height="10"
                      patternUnits="userSpaceOnUse"
                    >
                      <path d="M-3 13 15-5M-5 5l18-18M-1 21 17 3"></path>
                    </pattern>
                  </defs>
                  <rect
                    stroke="none"
                    fill="url(#pattern-5c1e4f0e-62d5-498b-8ff0-cf77bb448c8e)"
                    width="100%"
                    height="100%"
                  />
                </svg>
              </div>
              <Card className="w-75 cursor-default p-0 m-0 gap-0 rounded-sm bg-background absolute">
                <CardHeader className="pb-0 py-2">
                  <CardTitle>Domains</CardTitle>
                </CardHeader>
                <CardContent className="text-sm border py-4">
                  Select a domain to start an assessment
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </ContentLayout>
  );
}

export default SurveyPage;
