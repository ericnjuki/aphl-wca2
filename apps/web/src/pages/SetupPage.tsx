import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileUp, Search, Download } from "lucide-react";
import { toast } from "sonner";

import { ContentLayout } from "@/components/admin-panel/content-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, downloadFile } from "@/lib/api";
import { ImportWorkbookDialog } from "@/components/import/ImportWorkbookDialog";
import { listKey, listPath, isArchived } from "@/lib/setup/archived";
import { DistrictsTab } from "@/components/setup/DistrictsTab";
import { groupDistrictsByRegion, type District } from "@/lib/setup/districts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Department { id: number; code: string; name: string; }
interface OrgRole    { id: number; code: string; name: string; }
interface UserTitle  { id: number; code: string; name: string; }
interface Facility   { id: number; code: string; name: string; facility_type: string | null; region_id: number | null; region_name: string | null; district_id: number | null; district_name: string | null; department_ids: number[]; archived_at?: string | null; }
interface SimpleRow  { id: number; code: string; name: string; archived_at?: string | null; }

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

interface SimpleTableTabProps<T extends SimpleRow> {
  queryKey: string[];
  fetchFn: (includeArchived: boolean) => Promise<T[]>;
  createFn: (code: string, name: string) => Promise<void>;
  updateFn: (id: number, code: string, name: string) => Promise<void>;
  deleteFn: (id: number) => Promise<void>;
  sheetTitle: (editing: T | null) => string;
  columns?: { header: string; accessor: keyof T }[];
}

function SimpleTableTab<T extends SimpleRow>({
  queryKey, fetchFn, createFn, updateFn, deleteFn, sheetTitle, columns,
}: SimpleTableTabProps<T>) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: listKey(queryKey, showArchived),
    queryFn: () => fetchFn(showArchived),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey });
  const archivedId = `show-archived-${queryKey.join("-")}`;

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
        <div className="flex items-center gap-2">
          <Switch id={archivedId} checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor={archivedId} className="text-xs text-muted-foreground">Show archived</Label>
        </div>
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
                className={`cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]${isArchived(row) ? " opacity-60" : ""}`}
                onClick={() => { setEditing(row); setSheetOpen(true); }}
              >
                {cols.map((c) => (
                  <TableCell
                    key={String(c.accessor)}
                    className={c.accessor === "code" ? "font-mono text-xs text-muted-foreground" : "text-sm"}
                  >
                    {String(row[c.accessor] ?? "")}
                    {c.accessor === "name" && isArchived(row) && (
                      <Badge variant="outline" className="ml-2 text-[10px]">Archived</Badge>
                    )}
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
  const [showArchived, setShowArchived] = useState(false);

  // Form state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [facilityType, setFacilityType] = useState("");
  const [districtId, setDistrictId] = useState<string>("");
  const [selectedDepts, setSelectedDepts] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  const { data: facilities = [] } = useQuery({
    queryKey: listKey(["admin", "facilities"], showArchived),
    queryFn: async () => {
      const res = await api.get<{ facilities: Facility[] }>(listPath("/admin/facilities", showArchived));
      if (res.error !== null) throw new Error(res.error);
      return res.data.facilities;
    },
  });

  const { data: districts = [] } = useQuery({
    queryKey: ["admin", "districts"],
    queryFn: async () => {
      const res = await api.get<{ districts: District[] }>("/admin/districts");
      if (res.error !== null) throw new Error(res.error);
      return res.data.districts;
    },
  });
  const districtGroups = useMemo(() => groupDistrictsByRegion(districts), [districts]);

  const { data: departments = [] } = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: async () => {
      const res = await api.get<{ departments: Department[] }>("/admin/departments");
      if (res.error !== null) throw new Error(res.error);
      return res.data.departments;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "facilities"] });
    qc.invalidateQueries({ queryKey: ["admin", "districts"] });
  };

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
      (f.district_name ?? "").toLowerCase().includes(q) ||
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
    setDistrictId(facility?.district_id ? String(facility.district_id) : "");
    setSelectedDepts(facility?.department_ids ?? []);
    setSheetOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!districtId) { toast.error("Select a district."); return; }
    setLoading(true);
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      facility_type: facilityType.trim() || null,
      district_id: Number(districtId),
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
            placeholder="Search code, name, type, district, region…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Switch id="show-archived-facilities" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived-facilities" className="text-xs text-muted-foreground">Show archived</Label>
        </div>
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
              <TableHead className="text-xs uppercase tracking-wide">District</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Region</TableHead>
              <TableHead className="w-20 text-xs uppercase tracking-wide">Depts</TableHead>
              <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFacilities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {facilities.length === 0 ? "No facilities yet." : "No facilities match your search."}
                </TableCell>
              </TableRow>
            ) : pagedFacilities.map((f) => (
              <TableRow
                key={f.id}
                className={`cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]${isArchived(f) ? " opacity-60" : ""}`}
                onClick={() => openSheet(f)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{f.code}</TableCell>
                <TableCell className="text-sm">
                  {f.name}
                  {isArchived(f) && <Badge variant="outline" className="ml-2 text-[10px]">Archived</Badge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{f.facility_type ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{f.district_name ?? "—"}</TableCell>
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
            <TableFillerRow colSpan={7} show={pagedFacilities.length > 0} />
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

                <Label className="text-right text-sm">District</Label>
                <Select value={districtId} onValueChange={setDistrictId}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select district…" />
                  </SelectTrigger>
                  <SelectContent>
                    {districtGroups.map((g) => (
                      <SelectGroup key={g.region}>
                        <SelectLabel>{g.region}</SelectLabel>
                        {g.districts.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)} description={d.code}>{d.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                <Label className="text-right text-sm text-muted-foreground">Region</Label>
                <span className="text-sm text-muted-foreground">
                  {districts.find((d) => String(d.id) === districtId)?.region_name ?? "Set by district"}
                </span>
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
    fetchFn: async (includeArchived: boolean) => {
      const res = await api.get<{ [key: string]: unknown[] }>(listPath(`/admin/${path}`, includeArchived));
      if (res.error !== null) throw new Error(res.error);
      const key = Object.keys(res.data)[0];
      return res.data[key] as SimpleRow[];
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

// ── Get started (no regions yet) ──────────────────────────────────────────────

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";

function GetStartedCard({ onExport, onImport, onManual }: { onExport: () => void; onImport: () => void; onManual: () => void }) {
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            Load your regions, districts, facilities, departments, roles, titles and users from one Excel workbook.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm">
          <ol className="flex list-decimal flex-col gap-5 pl-5">
            <li>
              <p className="font-medium">Export the template</p>
              <p className="text-muted-foreground">An empty workbook with every tab and column, plus a Read me tab.</p>
              <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={onExport}>
                <Download className="h-3.5 w-3.5" /> Export template
              </Button>
            </li>
            <li>
              <p className="font-medium">Fill it in</p>
              <p className="text-muted-foreground">
                One row per item. Keep your own admin account on the Users tab. See the{" "}
                <a className="underline" href={`${baseUrl}data/sample-country-setup.xlsx`} download>sample workbook</a>{" "}
                for an example.
              </p>
            </li>
            <li>
              <p className="font-medium">Import the workbook</p>
              <p className="text-muted-foreground">You will see every change before anything is saved.</p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={onImport}>
                <FileUp className="h-3.5 w-3.5" /> Import workbook
              </Button>
            </li>
          </ol>
          <button type="button" className="self-start text-xs text-muted-foreground underline" onClick={onManual}>
            Or add records by hand
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const regionsFns    = makeSimpleFns("regions");
const deptsFns      = makeSimpleFns("departments");
const orgRolesFns   = makeSimpleFns("org-roles");
const titlesFns     = makeSimpleFns("user-titles");

const SETUP_IMPORT_HINT = (
  <>
    Upload a country setup workbook (.xlsx, up to 10 MB). Each tab you include is the complete list: rows missing
    from a tab are archived (or deleted when they have no history) and users missing from Users are disabled.
    Leave a tab out to keep that data unchanged. Nothing is saved until you review the changes and apply them.
  </>
);

export default function SetupPage() {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [manual, setManual] = useState(false);

  const { data: regions, isLoading } = useQuery({
    queryKey: ["admin", "regions"],
    queryFn: () => regionsFns.fetchFn(false),
  });
  const showGetStarted = !manual && !isLoading && (regions ?? []).length === 0;

  async function exportSetup() {
    const error = await downloadFile("/admin/setup/export", "country-setup.xlsx");
    if (error) toast.error(error);
  }

  const nav = (
    <div className="flex w-full items-center gap-2 pr-2">
      <h1 className="font-bold text-sm">Setup</h1>
      <div className="flex-1" />
      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void exportSetup()}>
        <Download className="h-3.5 w-3.5" /> Export setup
      </Button>
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
        <FileUp className="h-3.5 w-3.5" /> Import workbook
      </Button>
    </div>
  );

  return (
    <ContentLayout nav={nav}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full">
        {showGetStarted ? (
          <GetStartedCard
            onExport={() => void exportSetup()}
            onImport={() => setImportOpen(true)}
            onManual={() => setManual(true)}
          />
        ) : (
          <Tabs defaultValue="regions" className="flex flex-col flex-1 overflow-hidden">
            <div className="border-b px-4">
              <TabsList className="h-10 bg-transparent p-0 gap-2">
                {["regions", "districts", "facilities", "departments", "roles", "titles"].map((tab) => (
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
                  sheetTitle={(e) => e ? "Edit Region" : "New Region"}
                />
              </TabsContent>

              <TabsContent value="districts" className="h-full mt-0">
                <DistrictsTab />
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
                  sheetTitle={(e) => e ? "Edit Title" : "New Title"}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>

      <ImportWorkbookDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import country setup"
        hint={SETUP_IMPORT_HINT}
        previewPath="/admin/setup/import/preview"
        applyPath="/admin/setup/import/apply"
        onApplied={() => qc.invalidateQueries({ queryKey: ["admin"] })}
      />
    </ContentLayout>
  );
}
