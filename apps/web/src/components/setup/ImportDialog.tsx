import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatImportResult, type ImportResult } from "@/lib/setup/districts";

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  hint: string;
  onImported: () => void;
}

export function ImportDialog({ open, onClose, endpoint, hint, onImported }: ImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Select a CSV file first."); return; }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<ImportResult>(endpoint, { csv });
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    const { summary, details } = formatImportResult(res.data);
    if (details.length) toast.warning(summary, { description: details.join("\n"), duration: 15000 });
    else toast.success(summary);
    onImported();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Import from CSV</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">{hint}</p>
          <Input ref={fileRef} type="file" accept=".csv" required />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Importing…" : "Import"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
