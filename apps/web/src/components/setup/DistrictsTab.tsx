import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileUp, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { TableFillerRow } from "@/components/ui/table-filler";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { District } from "@/lib/setup/districts";
import { ImportDialog } from "./ImportDialog";

interface Region { id: number; code: string; name: string; }

export function DistrictsTab() {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<District | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: districts = [] } = useQuery({
    queryKey: ["admin", "districts"],
    queryFn: async () => {
      const res = await api.get<{ districts: District[] }>("/admin/districts");
      if (res.error !== null) throw new Error(res.error);
      return res.data.districts;
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

  // Facilities show district/region names, so refresh them too.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "districts"] });
    qc.invalidateQueries({ queryKey: ["admin", "facilities"] });
  };

  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter((d) =>
      d.code.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      (d.region_name ?? "").toLowerCase().includes(q),
    );
  }, [districts, searchInput]);
  const paged = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page, pageSize]);
  useEffect(() => { setPage(0); }, [searchInput, districts.length]);

  function openSheet(d: District | null) {
    setEditing(d);
    setCode(d?.code ?? "");
    setName(d?.name ?? "");
    setRegionId(d ? String(d.region_id) : "");
    setSheetOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!regionId) { toast.error("Select a region."); return; }
    setLoading(true);
    const body = { code: code.trim().toUpperCase(), name: name.trim(), region_id: Number(regionId) };
    const res = editing
      ? await api.put(`/admin/districts/${editing.id}`, body)
      : await api.post("/admin/districts", body);
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    toast.success(editing ? "District updated." : "District created.");
    invalidate();
    setSheetOpen(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code, name, region…"
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
              <TableHead className="text-xs uppercase tracking-wide">Region</TableHead>
              <TableHead className="w-24 text-xs uppercase tracking-wide">Facilities</TableHead>
              <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {districts.length === 0 ? "No districts yet." : "No districts match your search."}
                </TableCell>
              </TableRow>
            ) : paged.map((d) => (
              <TableRow
                key={d.id}
                className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                onClick={() => openSheet(d)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                <TableCell className="text-sm">{d.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.region_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{d.facility_count}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openSheet(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            <TableFillerRow colSpan={5} show={paged.length > 0} />
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
            {filtered.length} district{filtered.length === 1 ? "" : "s"}
            {searchInput && ` · filtered from ${districts.length}`}
          </span>
        }
      />

      <Sheet open={sheetOpen} onOpenChange={(v) => !v && setSheetOpen(false)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle>{editing ? "Edit District" : "New District"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
            <div className="px-6 py-6">
              <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-5">
                <Label className="text-right text-sm">Code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. TMK" required />
                <Label className="text-right text-sm">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Temeke" required />
                <Label className="text-right text-sm">Region</Label>
                <Select value={regionId} onValueChange={setRegionId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Select region…" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {regions.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)} description={r.code}>{r.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
        endpoint="/admin/districts/import"
        hint="Required columns: district_code, district_name, region_code."
        onImported={invalidate}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this district?</AlertDialogTitle>
            <AlertDialogDescription>Districts that still have facilities can't be deleted — reassign the facilities first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const res = await api.delete(`/admin/districts/${deleteId}`);
                if (res.error !== null) { toast.error(res.error); return; }
                toast.success("District deleted.");
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
