// Shown when a role opens a page or report it may not see (e.g. a typed URL).
export function NoAccessNotice({ what }: { what: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
      You don't have access to {what}.
    </div>
  );
}
