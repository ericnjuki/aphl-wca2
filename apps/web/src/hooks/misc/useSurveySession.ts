import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SurveySession {
  id: number;
  user_id: number;
  domain_code: string;
  domain_name: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  survey_data: string | null;
  ui_state: string | null;
  score: number | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ── localStorage helpers ──────────────────────────────────────────────────────

const lsKey = (sessionId: number) => `wca:session:${sessionId}`;

function lsSave(sessionId: number, surveyData: object, uiState: object) {
  try {
    localStorage.setItem(
      lsKey(sessionId),
      JSON.stringify({ survey_data: surveyData, ui_state: uiState, saved_at: new Date().toISOString() }),
    );
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

function lsLoad(sessionId: number): { survey_data: object; ui_state: object } | null {
  try {
    const raw = localStorage.getItem(lsKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as { survey_data: object; ui_state: object };
  } catch {
    return null;
  }
}

function lsClear(sessionId: number) {
  try {
    localStorage.removeItem(lsKey(sessionId));
  } catch {
    // ignore
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSurveySession() {
  const qc = useQueryClient();
  const [session, setSession] = useState<SurveySession | null>(null);
  const [existingSession, setExistingSession] = useState<SurveySession | null>(null);
  const [isCheckingResume, setIsCheckingResume] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if an in_progress session exists for a given domain.
  const checkExisting = useCallback(async (domainCode: string) => {
    setIsCheckingResume(true);
    const res = await api.get<{ sessions: SurveySession[] }>(
      `/survey/sessions?domain_code=${encodeURIComponent(domainCode)}`,
    );
    setIsCheckingResume(false);
    if (res.error === null && res.data.sessions.length > 0) {
      setExistingSession(res.data.sessions[0]);
    } else {
      setExistingSession(null);
    }
  }, []);

  // Start a brand-new session.
  const startNew = useCallback(async (domainCode: string, domainName: string) => {
    const res = await api.post<{ session: SurveySession }>('/survey/sessions', {
      domain_code: domainCode,
      domain_name: domainName,
    });
    if (res.error !== null) return { error: res.error };
    setSession(res.data.session);
    setExistingSession(null);
    // New in_progress row should appear immediately on My Assessments.
    qc.invalidateQueries({ queryKey: ['my-assessments'] });
    return { error: null };
  }, [qc]);

  // Resume an existing in_progress session.
  // Returns the survey_data and ui_state strings that should be restored
  // (local draft takes priority over server data).
  const resume = useCallback((existing: SurveySession): { survey_data: string | null; ui_state: string | null } => {
    const local = lsLoad(existing.id);
    if (local) {
      const survey_data = JSON.stringify(local.survey_data);
      const ui_state   = JSON.stringify(local.ui_state);
      setSession({ ...existing, survey_data, ui_state });
      setExistingSession(null);
      return { survey_data, ui_state };
    }
    setSession(existing);
    setExistingSession(null);
    return { survey_data: existing.survey_data, ui_state: existing.ui_state };
  }, []);

  // Abandon the existing session then start a new one.
  const startOver = useCallback(async (existingId: number, domainCode: string, domainName: string) => {
    lsClear(existingId);
    await api.delete(`/survey/sessions/${existingId}`);
    return startNew(domainCode, domainName);
  }, [startNew]);

  // Auto-save to localStorage (debounced 2 s) — called on every answer change.
  const autoSave = useCallback((sessionId: number, surveyData: object, uiState: object) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      lsSave(sessionId, surveyData, uiState);
    }, 2000);
  }, []);

  // Manual save — persists to API.
  const save = useCallback(async (sessionId: number, surveyData: object, uiState: object) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    lsSave(sessionId, surveyData, uiState); // immediate local write
    const res = await api.put(`/survey/sessions/${sessionId}`, {
      survey_data: JSON.stringify(surveyData),
      ui_state: JSON.stringify(uiState),
    });
    return res.error === null ? { error: null } : { error: res.error };
  }, []);

  // Complete the session — saves final data, clears local draft.
  const complete = useCallback(async (sessionId: number, surveyData: object) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const res = await api.post<{ session: SurveySession }>(`/survey/sessions/${sessionId}/complete`, {
      survey_data: JSON.stringify(surveyData),
    });
    if (res.error === null) {
      lsClear(sessionId);
      setSession(res.data.session);
      // Completion changes: (a) My Assessments card status + avg, (b) the
      // admin Reviews queue (new pending row), (c) Reports aggregations
      // (once approved). Invalidate all three so navigating anywhere after
      // submit shows fresh data without a 60 s staleTime wait.
      qc.invalidateQueries({ queryKey: ['my-assessments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    }
    return res.error === null ? { error: null } : { error: res.error };
  }, [qc]);

  // Clear local state when domain changes.
  const reset = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSession(null);
    setExistingSession(null);
  }, []);

  // Clean up timer on unmount.
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, []);

  return {
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
  };
}
