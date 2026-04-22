import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileUp, Search } from "lucide-react";
import { toast } from "sonner";

import { ContentLayout } from "@/components/admin-panel/content-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Region     { id: number; code: string; name: string; }
interface Department { id: number; code: string; name: string; }
interface OrgRole    { id: number; code: string; name: string; }
interface UserTitle  { id: number; code: string; name: string; }
interface Facility   { id: number; code: string; name: string; facility_type: string | null; region_id: number | null; region_name: string | null; department_ids: number[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

// ── Generic CSV import dialog ─────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  hint: string;
  onImported: () => void;
}

function ImportDialog({ open, onClose, endpoint, hint, onImported }: ImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Select a CSV file first."); return; }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<{ imported: number; skipped?: number }>(endpoint, { csv });
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    const msg = res.data.skipped !== undefined
      ? `Imported ${res.data.imported}, skipped ${res.data.skipped}.`
      : `Imported ${res.data.imported}.`;
    toast.success(msg);
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

// ── Generic code/name Sheet ───────────────────────────────────────────────────

interface CodeNameSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  initial: { id?: number; code?: string; name?: string } | null;
  onSubmit: (code: string, name: string) => Promise<void>;
}

function CodeNameSheet({ open, onClose, title, initial, onSubmit }: CodeNameSheetProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) { setCode(initial?.code ?? ""); setName(initial?.name ?? ""); }
  }, [open, initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await onSubmit(code.trim().toUpperCase(), name.trim());
    setLoading(false);
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-6 py-6">
            <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-5">
              <Label className="text-right text-sm">Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. CHEM" required />
              <Label className="text-right text-sm">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chemistry" required />
            </div>
          </div>
          <SheetFooter className="mt-auto px-6 py-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Generic table + toolbar for simple code/name tables ───────────────────────

interface SimpleTableTabProps<T extends { id: number; code: string; name: string }> {
  queryKey: string[];
  fetchFn: () => Promise<T[]>;
  createFn: (code: string, name: string) => Promise<void>;
  updateFn: (id: number, code: string, name: string) => Promise<void>;
  deleteFn: (id: number) => Promise<void>;
  importEndpoint: string;
  importHint: string;
  sheetTitle: (editing: T | null) => string;
  columns?: { header: string; accessor: keyof T }[];
}

function SimpleTableTab<T extends { id: number; code: string; name: string }>({
  queryKey, fetchFn, createFn, updateFn, deleteFn,
  importEndpoint, importHint, sheetTitle, columns,
}: SimpleTableTabProps<T>) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data: rows = [] } = useQuery({ queryKey, queryFn: fetchFn });
  const invalidate = () => qc.invalidateQueries({ queryKey });

  // Shared pagination + search state — these lists can grow on larger deployments.
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.code).toLowerCase().includes(q) ||
      String(r.name).toLowerCase().includes(q),
    );
  }, [rows, searchInput]);
  const paged = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );
  useEffect(() => { setPage(0); }, [searchInput, rows.length]);

  const cols = columns ?? [
    { header: "Code", accessor: "code" as keyof T },
    { header: "Name", accessor: "name" as keyof T },
  ];

  async function handleSubmit(code: string, name: string) {
    if (editing) {
      await updateFn(editing.id, code, name);
      toast.success("Updated.");
    } else {
      await createFn(code, name);
      toast.success("Created.");
    }
    invalidate();
  }

  async function handleDelete() {
    if (deleteId === null) return;
    const res = await deleteFn(deleteId);
    if ((res as unknown as { error: string | null })?.error) { toast.error((res as unknown as { error: string }).error); return; }
    toast.success("Deleted.");
    invalidate();
    setDeleteId(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code or name…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
          <FileUp className="h-3.5 w-3.5" /> Import CSV
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setEditing(null); setSheetOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {cols.map((c) => (
                <TableHead key={String(c.accessor)} className="text-xs uppercase tracking-wide">
                  {c.header}
                </TableHead>
              ))}
              <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols.length + 1} className="py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? "No records yet." : "No records match your search."}
                </TableCell>
              </TableRow>
            ) : paged.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                onClick={() => { setEditing(row); setSheetOpen(true); }}
              >
                {cols.map((c) => (
                  <TableCell
                    key={String(c.accessor)}
                    className={c.accessor === "code" ? "font-mono text-xs text-muted-foreground" : "text-sm"}
                  >
                    {String(row[c.accessor] ?? "")}
                  </TableCell>
                ))}
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setEditing(row); setSheetOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(row.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            <TableFillerRow colSpan={cols.length + 1} show={paged.length > 0} />
          </TableBody>
        </Table>
      </div>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={filtered.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        leftSlot={
          <span className="text-muted-foreground">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
            {searchInput && ` · filtered from ${rows.length}`}
          </span>
        }
      />

      <CodeNameSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetTitle(editing)}
        initial={editing}
        onSubmit={handleSubmit}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={importEndpoint}
        hint={importHint}
        onImported={invalidate}
      />
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Facilities tab (more complex — region + departments) ──────────────────────

function FacilitiesTab() {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Form state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [facilityType, setFacilityType] = useState("");
  const [regionId, setRegionId] = useState<string>("");
  const [selectedDepts, setSelectedDepts] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  const { data: facilities = [] } = useQuery({
    queryKey: ["admin", "facilities"],
    queryFn: async () => {
      const res = await api.get<{ facilities: Facility[] }>("/admin/facilities");
      if (res.error !== null) throw new Error(res.error);
      return res.data.facilities;
    },
  });

  const { data: regions = [] } = useQuery({
    queryKey: ["admin", "regions"],
    queryFn: async () => {
      const res = await api.get<{ regions: Region[] }>("/admin/regions");
      if (res.error !== null) throw new Error(res.error);
      return res.data.regions;
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: async () => {
      const res = await api.get<{ departments: Department[] }>("/admin/departments");
      if (res.error !== null) throw new Error(res.error);
      return res.data.departments;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "facilities"] });

  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const filteredFacilities = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return facilities;
    return facilities.filter((f) =>
      f.code.toLowerCase().includes(q) ||
      f.name.toLowerCase().includes(q) ||
      (f.facility_type ?? "").toLowerCase().includes(q) ||
      (f.region_name ?? "").toLowerCase().includes(q),
    );
  }, [facilities, searchInput]);
  const pagedFacilities = useMemo(
    () => filteredFacilities.slice(page * pageSize, (page + 1) * pageSize),
    [filteredFacilities, page, pageSize],
  );
  useEffect(() => { setPage(0); }, [searchInput, facilities.length]);

  function openSheet(facility: Facility | null) {
    setEditing(facility);
    setCode(facility?.code ?? "");
    setName(facility?.name ?? "");
    setFacilityType(facility?.facility_type ?? "");
    setRegionId(facility?.region_id ? String(facility.region_id) : "");
    setSelectedDepts(facility?.department_ids ?? []);
    setSheetOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      facility_type: facilityType.trim() || null,
      region_id: regionId ? Number(regionId) : null,
      department_ids: selectedDepts,
    };
    const res = editing
      ? await api.put(`/admin/facilities/${editing.id}`, body)
      : await api.post("/admin/facilities", body);
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    toast.success(editing ? "Facility updated." : "Facility created.");
    invalidate();
    setSheetOpen(false);
  }

  function toggleDept(id: number) {
    setSelectedDepts((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code, name, type, region…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
          <FileUp className="h-3.5 w-3.5" /> Import CSV
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openSheet(null)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-24 text-xs uppercase tracking-wide">Code</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Name</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Region</TableHead>
              <TableHead className="w-20 text-xs uppercase tracking-wide">Depts</TableHead>
              <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFacilities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {facilities.length === 0 ? "No facilities yet." : "No facilities match your search."}
                </TableCell>
              </TableRow>
            ) : pagedFacilities.map((f) => (
              <TableRow
                key={f.id}
                className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                onClick={() => openSheet(f)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{f.code}</TableCell>
                <TableCell className="text-sm">{f.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{f.facility_type ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{f.region_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{f.department_ids.length}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openSheet(f)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(f.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            <TableFillerRow colSpan={6} show={pagedFacilities.length > 0} />
          </TableBody>
        </Table>
      </div>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={filteredFacilities.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        leftSlot={
          <span className="text-muted-foreground">
            {filteredFacilities.length} facilit{filteredFacilities.length === 1 ? "y" : "ies"}
            {searchInput && ` · filtered from ${facilities.length}`}
          </span>
        }
      />


      {/* Facility sheet */}
      <Sheet open={sheetOpen} onOpenChange={(v) => !v && setSheetOpen(false)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle>{editing ? "Edit Facility" : "New Facility"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
            <div className="px-6 py-6 flex flex-col gap-6">
              <div className="grid grid-cols-[130px_1fr] items-center gap-x-4 gap-y-5">
                <Label className="text-right text-sm">Code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 3830" required />

                <Label className="text-right text-sm">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aga Khan Hospital" required />

                <Label className="text-right text-sm">Type</Label>
                <Input value={facilityType} onChange={(e) => setFacilityType(e.target.value)} placeholder="e.g. Hospital" />

                <Label className="text-right text-sm">Region</Label>
                <Select value={regionId || "__none__"} onValueChange={(v) => setRegionId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select region…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {regions.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)} description={r.code}>{r.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Departments</Label>
                <ScrollArea className="h-48 rounded-md border p-3">
                  <div className="flex flex-col gap-2">
                    {departments.map((d) => (
                      <div key={d.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`dept-${d.id}`}
                          checked={selectedDepts.includes(d.id)}
                          onCheckedChange={() => toggleDept(d.id)}
                        />
                        <label htmlFor={`dept-${d.id}`} className="text-sm cursor-pointer">
                          <span className="font-mono text-xs text-muted-foreground mr-2">{d.code}</span>
                          {d.name}
                        </label>
                      </div>
                    ))}
                    {departments.length === 0 && (
                      <p className="text-xs text-muted-foreground">No departments added yet. Add them in the Departments tab first.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <SheetFooter className="mt-auto px-6 py-4 border-t">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/admin/facilities/import"
        hint="Required columns: facility_code, facility_name. Optional: facility_type, region_code."
        onImported={invalidate}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this facility?</AlertDialogTitle>
            <AlertDialogDescription>This will also remove all department assignments for this facility.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const res = await api.delete(`/admin/facilities/${deleteId}`);
                if (res.error !== null) { toast.error(res.error); return; }
                toast.success("Facility deleted.");
                invalidate();
                setDeleteId(null);
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Helpers for simple tabs ───────────────────────────────────────────────────

function makeSimpleFns(path: string) {
  return {
    fetchFn: async () => {
      const res = await api.get<{ [key: string]: unknown[] }>(`/admin/${path}`);
      if (res.error !== null) throw new Error(res.error);
      const key = Object.keys(res.data)[0];
      return res.data[key] as { id: number; code: string; name: string }[];
    },
    createFn: async (code: string, name: string) => {
      const res = await api.post(`/admin/${path}`, { code, name });
      if (res.error !== null) throw new Error(res.error as string);
    },
    updateFn: async (id: number, code: string, name: string) => {
      const res = await api.put(`/admin/${path}/${id}`, { code, name });
      if (res.error !== null) throw new Error(res.error as string);
    },
    deleteFn: async (id: number) => {
      return api.delete(`/admin/${path}/${id}`);
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

const regionsFns    = makeSimpleFns("regions");
const deptsFns      = makeSimpleFns("departments");
const orgRolesFns   = makeSimpleFns("org-roles");
const titlesFns     = makeSimpleFns("user-titles");

export default function SetupPage() {
  return (
    <ContentLayout nav={<h1 className="font-bold text-sm">Setup</h1>}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full">
        <Tabs defaultValue="regions" className="flex flex-col flex-1 overflow-hidden">
          <div className="border-b px-4">
            <TabsList className="h-10 bg-transparent p-0 gap-2">
              {["regions", "facilities", "departments", "roles", "titles"].map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 h-10"
                >
                  {tab === "roles" ? "Org Roles" : tab === "titles" ? "Job Titles" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="regions" className="h-full mt-0">
              <SimpleTableTab
                queryKey={["admin", "regions"]}
                fetchFn={regionsFns.fetchFn}
                createFn={regionsFns.createFn}
                updateFn={regionsFns.updateFn}
                deleteFn={regionsFns.deleteFn}
                importEndpoint="/admin/regions/import"
                importHint="Required columns: region_code, region_name."
                sheetTitle={(e) => e ? "Edit Region" : "New Region"}
              />
            </TabsContent>

            <TabsContent value="facilities" className="h-full mt-0">
              <FacilitiesTab />
            </TabsContent>

            <TabsContent value="departments" className="h-full mt-0">
              <SimpleTableTab
                queryKey={["admin", "departments"]}
                fetchFn={deptsFns.fetchFn}
                createFn={deptsFns.createFn}
                updateFn={deptsFns.updateFn}
                deleteFn={deptsFns.deleteFn}
                importEndpoint="/admin/departments/import"
                importHint="Required columns: department_code, department_name."
                sheetTitle={(e) => e ? "Edit Department" : "New Department"}
              />
            </TabsContent>

            <TabsContent value="roles" className="h-full mt-0">
              <SimpleTableTab
                queryKey={["admin", "org-roles"]}
                fetchFn={orgRolesFns.fetchFn}
                createFn={orgRolesFns.createFn}
                updateFn={orgRolesFns.updateFn}
                deleteFn={orgRolesFns.deleteFn}
                importEndpoint="/admin/org-roles/import"
                importHint="Required columns: role_code, role_name."
                sheetTitle={(e) => e ? "Edit Role" : "New Role"}
              />
            </TabsContent>

            <TabsContent value="titles" className="h-full mt-0">
              <SimpleTableTab
                queryKey={["admin", "user-titles"]}
                fetchFn={titlesFns.fetchFn}
                createFn={titlesFns.createFn}
                updateFn={titlesFns.updateFn}
                deleteFn={titlesFns.deleteFn}
                importEndpoint="/admin/user-titles/import"
                importHint="Required columns: title_code, title_name."
                sheetTitle={(e) => e ? "Edit Title" : "New Title"}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </ContentLayout>
  );
}
