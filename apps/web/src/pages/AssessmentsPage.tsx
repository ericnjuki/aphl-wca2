import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontalIcon,
  Pencil,
  Plus,
  Trash2,
  Upload,
  FileUp,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { ContentLayout } from "@/components/admin-panel/content-layout";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { TableFillerRow } from "@/components/ui/table-filler";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssessmentDomain {
  id: number;
  code: string;
  name: string;
  version: number;
  purpose?: string | null;
  introduction?: string | null;
  created_at: string;
  updated_at: string;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

// ── Domain form dialog ────────────────────────────────────────────────────────

interface DomainFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: AssessmentDomain | null;
  onSaved: () => void;
}

function DomainFormDialog({
  open,
  onClose,
  initial,
  onSaved,
}: DomainFormDialogProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1");
  const [purpose, setPurpose] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(initial?.code ?? "");
      setName(initial?.name ?? "");
      setVersion(String(initial?.version ?? 1));
      setPurpose(initial?.purpose ?? "");
      setIntroduction(initial?.introduction ?? "");
    }
  }, [open, initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      version: Number(version),
      purpose: purpose.trim() || null,
      introduction: introduction.trim() || null,
    };
    const res = initial
      ? await api.put(`/assessments/domains/${initial.id}`, body)
      : await api.post("/assessments/domains", body);
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    toast.success(initial ? "Domain updated." : "Domain created.");
    onSaved();
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>{initial ? "Edit Domain" : "New Domain"}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 overflow-y-auto"
        >
          <div className="flex flex-col gap-6 px-6 py-6">
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-5">
              <Label htmlFor="d-code" className="text-right text-sm">
                Code
              </Label>
              <Input
                id="d-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. QMS"
                required
              />

              <Label htmlFor="d-name" className="text-right text-sm">
                Name
              </Label>
              <Input
                id="d-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Quality Management System"
                required
              />

              <Label htmlFor="d-version" className="text-right text-sm">
                Version
              </Label>
              <Input
                id="d-version"
                type="number"
                min={1}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />

              <Label htmlFor="d-purpose" className="text-right text-sm self-start mt-2">
                Purpose
              </Label>
              <Textarea
                id="d-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Purpose statement shown on the Start page"
                rows={3}
              />

              <Label htmlFor="d-intro" className="text-right text-sm self-start mt-2">
                Introduction
              </Label>
              <Textarea
                id="d-intro"
                value={introduction}
                onChange={(e) => setIntroduction(e.target.value)}
                placeholder="Longer introduction shown on the Start page"
                rows={6}
              />
            </div>
          </div>
          <SheetFooter className="mt-auto px-6 py-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Import domains CSV dialog ─────────────────────────────────────────────────

interface ImportDomainsDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function ImportDomainsDialog({
  open,
  onClose,
  onImported,
}: ImportDomainsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Select a CSV file first.");
      return;
    }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<{ imported: number; updated: number; skipped: number }>(
      "/assessments/domains/import",
      { csv },
    );
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Imported ${res.data.imported}, updated ${res.data.updated}, skipped ${res.data.skipped}.`,
    );
    onImported();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Domains from CSV</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Required columns: assessment_code, assessment_name. Optional: purpose, introduction. Existing domains are updated.
          </p>
          <Input ref={fileRef} type="file" accept=".csv" required />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Item form dialog ──────────────────────────────────────────────────────────

const EMPTY_ITEM: Partial<AssessmentItem> = {
  competency_value: "",
  competency_text: "",
  subcompetency_value: "",
  subcompetency_text: "",
  beginner: "",
  competent: "",
  proficient: "",
  expert: "",
  na: "N/A",
  sort_order: 0,
};

interface ItemFormDialogProps {
  open: boolean;
  onClose: () => void;
  domainId: number;
  initial?: AssessmentItem | null;
  onSaved: () => void;
}

function ItemFormDialog({
  open,
  onClose,
  domainId,
  initial,
  onSaved,
}: ItemFormDialogProps) {
  const [form, setForm] = useState<Partial<AssessmentItem>>(EMPTY_ITEM);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ?? EMPTY_ITEM);
  }, [open, initial]);

  const set =
    (field: keyof AssessmentItem) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = initial
      ? await api.put(`/assessments/items/${initial.id}`, form)
      : await api.post(`/assessments/domains/${domainId}/items`, form);
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    toast.success(initial ? "Item updated." : "Item added.");
    onSaved();
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>{initial ? "Edit Item" : "New Item"}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 overflow-y-auto"
        >
          <div className="flex flex-col gap-6 px-6 py-6">
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-5">
              <Label className="text-right text-sm">Competency #</Label>
              <Input
                value={form.competency_value ?? ""}
                onChange={set("competency_value")}
                placeholder="1"
                required
              />

              <Label className="text-right text-sm">Subcompetency #</Label>
              <Input
                value={form.subcompetency_value ?? ""}
                onChange={set("subcompetency_value")}
                placeholder="1.01"
                required
              />

              <Label className="text-right text-sm">Competency Text</Label>
              <Textarea
                value={form.competency_text ?? ""}
                onChange={set("competency_text")}
                rows={2}
                required
              />

              <Label className="text-right text-sm">Subcompetency Text</Label>
              <Textarea
                value={form.subcompetency_text ?? ""}
                onChange={set("subcompetency_text")}
                rows={2}
                required
              />
            </div>

            <Separator />

            <div className="grid grid-cols-[140px_1fr] items-start gap-x-4 gap-y-5">
              {(
                ["beginner", "competent", "proficient", "expert", "na"] as const
              ).map((level) => (
                <>
                  <Label key={`${level}-label`} className="text-right text-sm pt-2 capitalize">
                    {level === "na" ? "N/A" : level}
                  </Label>
                  <Textarea
                    key={level}
                    value={(form[level] as string) ?? ""}
                    onChange={set(level)}
                    rows={2}
                  />
                </>
              ))}

              <Label className="text-right text-sm">Sort Order</Label>
              <Input
                type="number"
                value={form.sort_order ?? 0}
                onChange={set("sort_order")}
              />
            </div>
          </div>

          <SheetFooter className="mt-auto px-6 py-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Import items CSV dialog ───────────────────────────────────────────────────

interface ImportItemsDialogProps {
  open: boolean;
  onClose: () => void;
  domainId: number;
  onImported: () => void;
}

function ImportItemsDialog({
  open,
  onClose,
  domainId,
  onImported,
}: ImportItemsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Select a CSV file first.");
      return;
    }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<{ imported: number }>(
      `/assessments/domains/${domainId}/items/import`,
      { csv },
    );
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    toast.success(`Imported ${res.data.imported} item(s).`);
    onImported();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Items from CSV</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Required columns: <code>competency_value</code>,{" "}
            <code>competency_text</code>, <code>subcompetency_value</code>,{" "}
            <code>subcompetency_text</code>. Optional: <code>beginner</code>,{" "}
            <code>competent</code>, <code>proficient</code>, <code>expert</code>
            , <code>na</code>.
          </p>
          <Input ref={fileRef} type="file" accept=".csv" required />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Import footnotes CSV dialog ───────────────────────────────────────────────

function ImportFootnotesDialog({
  open, onClose, domainId, onImported,
}: { open: boolean; onClose: () => void; domainId: number; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Select a CSV file first."); return; }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<{ imported: number; skipped: number }>(
      `/assessments/domains/${domainId}/footnotes/import`, { csv },
    );
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    toast.success(`Imported ${res.data.imported} footnote(s), skipped ${res.data.skipped}.`);
    onImported();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Import footnotes</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Replaces this domain's footnotes. Columns: symbol, definition. Optional: sort_order.
          </p>
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

// ── Main page ─────────────────────────────────────────────────────────────────

function AssessmentsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Dialog state
  const [domainFormOpen, setDomainFormOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState<AssessmentDomain | null>(
    null,
  );
  const [importDomainsOpen, setImportDomainsOpen] = useState(false);
  const [deleteDomainOpen, setDeleteDomainOpen] = useState(false);

  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AssessmentItem | null>(null);
  const [importItemsOpen, setImportItemsOpen] = useState(false);
  const [importFootnotesOpen, setImportFootnotesOpen] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<number | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: domains = [] } = useQuery({
    queryKey: ["assessments", "domains"],
    queryFn: async () => {
      const res = await api.get<{ domains: AssessmentDomain[] }>(
        "/assessments/domains",
      );
      if (res.error !== null) throw new Error(res.error);
      return res.data.domains;
    },
  });

  const selectedDomain = domains.find((d) => d.id === selectedId) ?? null;

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["assessments", selectedId, "items"],
    queryFn: async () => {
      if (!selectedId) return [];
      const res = await api.get<{ items: AssessmentItem[] }>(
        `/assessments/domains/${selectedId}/items`,
      );
      if (res.error !== null) throw new Error(res.error);
      return res.data.items;
    },
    enabled: selectedId !== null,
  });

  // Filter + paginate items client-side.
  const filteredItems = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      it.competency_text.toLowerCase().includes(q) ||
      it.subcompetency_text.toLowerCase().includes(q) ||
      it.competency_value.toLowerCase().includes(q) ||
      it.subcompetency_value.toLowerCase().includes(q),
    );
  }, [items, searchInput]);
  const pagedItems = useMemo(
    () => filteredItems.slice(page * pageSize, (page + 1) * pageSize),
    [filteredItems, page, pageSize],
  );
  useEffect(() => { setPage(0); }, [searchInput, selectedId, items.length]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deleteDomain = useMutation({
    mutationFn: () => api.delete(`/assessments/domains/${selectedId}`),
    onSuccess: () => {
      toast.success("Domain deleted.");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["assessments", "domains"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteItem = useMutation({
    mutationFn: (id: number) => api.delete(`/assessments/items/${id}`),
    onSuccess: () => {
      toast.success("Item deleted.");
      qc.invalidateQueries({ queryKey: ["assessments", selectedId, "items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Nav ────────────────────────────────────────────────────────────────────

  const navComponents = () => (
    <div className="flex min-h-13 max-h-13 w-full items-center pr-2 py-2">
      <div className="flex">
        <ButtonGroup className="focus-visible:outline-none">
          <Select
            disabled={domains.length === 0}
            value={selectedId ? String(selectedId) : undefined}
            onValueChange={(v) => setSelectedId(Number(v))}
          >
            <SelectTrigger className="flex min-w-56 max-w-56 rounded-sm text-sm focus-visible:outline-none">
              <SelectValue placeholder="Assessment Domains" />
            </SelectTrigger>
            <SelectContent
              className="rounded-xs"
              side="bottom"
              avoidCollisions={false}
              position="popper"
            >
              <SelectGroup>
                {domains.map((d) => (
                  <SelectItem
                    key={d.id}
                    value={String(d.id)}
                    description={d.code}
                  >
                    {d.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {isAdmin && (
            <>
              <div className="flex justify-center items-center min-h-9 max-h-9 w-[0.5px]">
                <div className="flex bg-border min-h-7 max-h-7 w-[0.5px]" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="rounded-sm"
                    variant="outline"
                    size="icon"
                    aria-label="Domain options"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingDomain(null);
                        setDomainFormOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" /> New Domain
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!selectedDomain}
                      onClick={() => {
                        setEditingDomain(selectedDomain);
                        setDomainFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" /> Edit Domain
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setImportDomainsOpen(true)}
                    >
                      <Upload className="h-4 w-4" /> Import Domains CSV
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!selectedDomain}
                      onClick={() => setDeleteDomainOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete Domain
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </ButtonGroup>
      </div>

      {selectedDomain && (
        <div className="relative ml-3 w-64">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search competency or subcompetency…"
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}

      <div className="flex flex-1" />

      {isAdmin && selectedDomain && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setImportItemsOpen(true)}
          >
            <FileUp className="h-3.5 w-3.5" /> Import CSV
          </Button>
          {selectedId !== null && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
              onClick={() => setImportFootnotesOpen(true)}>
              <FileUp className="h-3.5 w-3.5" /> Import Footnotes
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setEditingItem(null);
              setItemFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add Item
          </Button>
        </div>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ContentLayout nav={navComponents()}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full h-full">
        {!selectedDomain ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a domain to view its competency items.
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-16 text-xs uppercase tracking-wide">Comp #</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">Competency</TableHead>
                    <TableHead className="w-20 text-xs uppercase tracking-wide">Sub #</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">Subcompetency</TableHead>
                    {isAdmin && (
                      <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemsLoading ? (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 5 : 4} className="py-8 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 5 : 4} className="py-8 text-center text-muted-foreground">
                        {items.length === 0
                          ? `No items yet.${isAdmin ? ' Use "Add Item" or "Import CSV" to add competencies.' : ''}`
                          : "No items match your search."}
                      </TableCell>
                    </TableRow>
                  ) : pagedItems.map((item) => (
                    <TableRow
                      key={item.id}
                      className={`transition-colors hover:bg-[rgba(70,130,180,0.08)]${
                        isAdmin ? ' cursor-pointer' : ''
                      }`}
                      onClick={isAdmin ? () => { setEditingItem(item); setItemFormOpen(true); } : undefined}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.competency_value}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={item.competency_text}>
                        {item.competency_text}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.subcompetency_value}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={item.subcompetency_text}>
                        {item.subcompetency_text}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => { setEditingItem(item); setItemFormOpen(true); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteItemId(item.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  <TableFillerRow colSpan={isAdmin ? 5 : 4} show={pagedItems.length > 0} />
                </TableBody>
              </Table>
            </div>
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={filteredItems.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              leftSlot={
                <span className="text-muted-foreground">
                  {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}
                  {searchInput && ` · filtered from ${items.length}`}
                </span>
              }
            />
          </>
        )}
      </div>

      {/* Domain dialogs */}
      <DomainFormDialog
        open={domainFormOpen}
        onClose={() => setDomainFormOpen(false)}
        initial={editingDomain}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ["assessments", "domains"] })
        }
      />
      <ImportDomainsDialog
        open={importDomainsOpen}
        onClose={() => setImportDomainsOpen(false)}
        onImported={() =>
          qc.invalidateQueries({ queryKey: ["assessments", "domains"] })
        }
      />
      <AlertDialog open={deleteDomainOpen} onOpenChange={setDeleteDomainOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete domain "{selectedDomain?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the domain and all its competency
              items. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDomain.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Item dialogs */}
      {selectedDomain && (
        <>
          <ItemFormDialog
            open={itemFormOpen}
            onClose={() => setItemFormOpen(false)}
            domainId={selectedDomain.id}
            initial={editingItem}
            onSaved={() =>
              qc.invalidateQueries({
                queryKey: ["assessments", selectedId, "items"],
              })
            }
          />
          <ImportItemsDialog
            open={importItemsOpen}
            onClose={() => setImportItemsOpen(false)}
            domainId={selectedDomain.id}
            onImported={() =>
              qc.invalidateQueries({
                queryKey: ["assessments", selectedId, "items"],
              })
            }
          />
          {selectedId !== null && (
            <ImportFootnotesDialog
              open={importFootnotesOpen}
              onClose={() => setImportFootnotesOpen(false)}
              domainId={selectedId}
              onImported={() => qc.invalidateQueries({ queryKey: ["assessments", selectedId, "items"] })}
            />
          )}
        </>
      )}
      <AlertDialog
        open={deleteItemId !== null}
        onOpenChange={(v) => !v && setDeleteItemId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This competency item will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteItemId !== null) deleteItem.mutate(deleteItemId);
                setDeleteItemId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContentLayout>
  );
}

export default AssessmentsPage;
