import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { AlertTriangle, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { postWorkbook, XLSX_MIME } from "@/lib/api";
import {
  KIND_LABEL, UNCERTAIN_APPLY_MESSAGE, allErrors, applySummary, confirmationSentence, credentialRows, formatValue, hasMajorityWarning, isUncertainApplyFailure,
  needsConfirmation, planSections, rowLabel, type ApplyResult, type ImportCredential, type ImportPlan, type Tone,
} from "@/lib/import/plan";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TONE_CLASS: Record<Tone, string> = {
  add: "border-transparent bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  update: "border-transparent bg-sky-600/15 text-sky-700 dark:text-sky-400",
  restore: "border-transparent bg-violet-600/15 text-violet-700 dark:text-violet-400",
  remove: "border-transparent bg-amber-600/15 text-amber-700 dark:text-amber-400",
};

function downloadCredentials(creds: ImportCredential[]) {
  const ws = XLSX.utils.json_to_sheet(credentialRows(creds));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Credentials");
  XLSX.writeFile(wb, "new-user-credentials.xlsx");
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface ImportWorkbookDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  hint: ReactNode;
  previewPath: string;
  applyPath: string;
  onApplied: () => void;
}

type Step = "upload" | "preview" | "done";

export function ImportWorkbookDialog({
  open, onClose, title, hint, previewPath, applyPath, onApplied,
}: ImportWorkbookDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  // Bumped by reset(): a response that lands after the dialog was closed or restarted is ignored.
  const requestId = useRef(0);

  function reset() {
    requestId.current += 1;
    setStep("upload");
    setFile(null);
    setPlan(null);
    setConfirmed(false);
    setResult(null);
    setLoading(false);
  }

  // The parent may close the dialog itself (open=false) without going through close().
  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    reset();
    onClose();
  }

  /** Returns true when a fresh plan is showing. */
  async function preview(f: File): Promise<boolean> {
    const id = ++requestId.current;
    setLoading(true);
    const res = await postWorkbook<{ plan: ImportPlan }>(previewPath, f);
    if (id !== requestId.current) return false;
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return false;
    }
    setPlan(res.data.plan);
    setConfirmed(false);
    setStep("preview");
    return true;
  }

  async function apply() {
    if (!file || !plan) return;
    const id = ++requestId.current;
    setLoading(true);
    const res = await postWorkbook<ApplyResult>(`${applyPath}?fingerprint=${encodeURIComponent(plan.fingerprint)}`, file);
    if (id !== requestId.current) return;
    setLoading(false);
    if (res.error !== null) {
      if (isUncertainApplyFailure(res.status)) {
        // The server may still have committed: re-run the preview so the admin can tell.
        toast.error(UNCERTAIN_APPLY_MESSAGE);
        setPlan(null);
        if (!(await preview(file))) setStep("upload");
        return;
      }
      toast.error(res.error);
      if (res.status === 409) {
        // Data moved on: drop the stale plan, show the fresh one, or start over if that fails.
        setPlan(null);
        if (!(await preview(file))) setStep("upload");
      }
      return;
    }
    setResult(res.data);
    setStep("done");
    onApplied();
  }

  const confirmNeeded = plan ? needsConfirmation(plan.confirmations) : false;
  const errors = plan ? allErrors(plan) : [];
  // Credentials are shown once: only the explicit Done button may dismiss that step.
  const lockDismiss = step === "done" && (result?.credentials.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        className="sm:max-w-3xl max-h-[85vh] flex flex-col"
        onInteractOutside={(e) => { if (lockDismiss) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (lockDismiss) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <form
            className="flex flex-col gap-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (file) void preview(file);
              else toast.error("Select an .xlsx workbook first.");
            }}
          >
            <div className="text-sm text-muted-foreground">{hint}</div>
            <Input
              type="file"
              accept={`.xlsx,${XLSX_MIME}`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={loading || !file}>{loading ? "Checking…" : "Preview changes"}</Button>
            </DialogFooter>
          </form>
        )}

        {step === "preview" && plan && (
          <>
            <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
              {hasMajorityWarning(plan) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Check this is the right file</AlertTitle>
                  <AlertDescription>
                    More than half of the existing rows on at least one tab would be removed. This usually means the wrong file.
                  </AlertDescription>
                </Alert>
              )}

              {errors.length > 0 && (
                <div className="rounded-md border border-destructive/40">
                  <p className="px-3 py-2 text-sm font-medium text-destructive">
                    {errors.length} error{errors.length === 1 ? "" : "s"} — fix the workbook and upload it again. Nothing has been changed.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Sheet</TableHead>
                        <TableHead className="text-xs">Row</TableHead>
                        <TableHead className="text-xs">Column</TableHead>
                        <TableHead className="text-xs">Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {errors.map((e, i) => (
                        <TableRow key={`${e.tab}-${e.row}-${i}`}>
                          <TableCell className="text-xs">{e.tab}</TableCell>
                          <TableCell className="text-xs font-mono">{rowLabel(e.row)}</TableCell>
                          <TableCell className="text-xs font-mono">{e.column ?? "—"}</TableCell>
                          <TableCell className="text-xs">{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {planSections(plan).map((s) => (
                <Collapsible key={s.tab} defaultOpen={s.defaultOpen} className="rounded-md border">
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
                    <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                    <span>{s.tab}</span>
                    {!s.present && <span className="text-xs font-normal text-muted-foreground">not in workbook — unchanged</span>}
                    {s.errors.length > 0 && (
                      <Badge variant="destructive">{s.errors.length} error{s.errors.length === 1 ? "" : "s"}</Badge>
                    )}
                    <span className="flex-1" />
                    {s.badges.map((b) => (
                      <Badge key={b.label} variant="outline" className={TONE_CLASS[b.tone]}>{b.count} {b.label}</Badge>
                    ))}
                    {s.present && s.unchanged > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">{s.unchanged} unchanged</span>
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-2 border-t px-3 py-2">
                    {s.warnings.map((w) => (
                      <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
                    ))}
                    {s.changes.length === 0 && s.errors.length === 0 && (
                      <p className="text-xs text-muted-foreground">{s.present ? "No changes." : "This tab is not in the workbook, so nothing changes."}</p>
                    )}
                    {s.changes.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {s.changes.map((c, i) => (
                          <li key={`${c.key}-${i}`} className="text-xs">
                            <span className="font-medium">{KIND_LABEL[c.kind]}</span>{" "}
                            <span className="font-mono">{c.key}</span>{" "}
                            <span className="text-muted-foreground">({rowLabel(c.row)})</span>
                            {c.fields && c.fields.length > 0 && (
                              <ul className="ml-4 mt-0.5 text-muted-foreground">
                                {c.fields.map((f) => (
                                  <li key={f.field}>
                                    <span className="font-mono">{f.field}</span>: {formatValue(f.from)} → {formatValue(f.to)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>

            {plan.canApply && confirmNeeded && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
                <span>{confirmationSentence(plan.confirmations)}</span>
              </label>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>Choose another file</Button>
              <Button
                type="button"
                disabled={!plan.canApply || errors.length > 0 || loading || (confirmNeeded && !confirmed)}
                onClick={() => void apply()}
              >
                {loading ? "Applying…" : "Apply changes"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && result && (
          <>
            <div className="flex-1 overflow-y-auto flex flex-col gap-3">
              <p className="text-sm">{applySummary(result.plan)}</p>
              {result.credentials.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {result.credentials.length} new user{result.credentials.length === 1 ? " was" : "s were"} created.
                    Download their temporary passwords now — this list closes when you leave this screen; the
                    temporary passwords also stay on the Users page until each user's first login. Each user must
                    change the password at first login.
                  </p>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Email</TableHead>
                          <TableHead className="text-xs">Username</TableHead>
                          <TableHead className="text-xs">Temporary password</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.credentials.map((c) => (
                          <TableRow key={c.email}>
                            <TableCell className="text-xs">{c.name}</TableCell>
                            <TableCell className="text-xs">{c.email}</TableCell>
                            <TableCell className="text-xs font-mono">{c.username}</TableCell>
                            <TableCell className="text-xs font-mono">{c.temp_password}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              {result.credentials.length > 0 && (
                <Button variant="outline" onClick={() => downloadCredentials(result.credentials)}>Download credentials</Button>
              )}
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
