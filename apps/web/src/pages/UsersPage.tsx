import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  RotateCcw,
  FileUp,
  Eye,
  EyeOff,
  Copy,
  Check,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { ContentLayout } from "@/components/admin-panel/content-layout";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Facility {
  id: number;
  code: string;
  name: string;
}
interface Department {
  id: number;
  code: string;
  name: string;
}
interface OrgRole {
  id: number;
  code: string;
  name: string;
}
interface UserTitle {
  id: number;
  code: string;
  name: string;
}

interface User {
  id: number;
  first_name: string;
  last_name: string;
  user_name: string;
  email: string;
  national_id: string;
  id_type: string;
  role: string;
  is_enabled: boolean;
  is_first_login: boolean;
  facility_id: number | null;
  facility_name: string | null;
  department_id: number | null;
  department_name: string | null;
  org_role_id: number | null;
  org_role_name: string | null;
  title_id: number | null;
  title_name: string | null;
  temp_password: string | null;
}

interface ImportCredential {
  user_name: string;
  temp_password: string;
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

// ── Temp password cell ────────────────────────────────────────────────────────

function TempPasswordCell({ value }: { value: string | null }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!value) return <span className="text-xs text-muted-foreground">—</span>;

  function copy() {
    navigator.clipboard.writeText(value!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-mono">{visible ? value : "••••••••"}</span>
      <Button
        size="icon"
        variant="ghost"
        className="h-5 w-5"
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={copy}>
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}

// ── User form sheet ───────────────────────────────────────────────────────────

interface UserFormSheetProps {
  open: boolean;
  onClose: () => void;
  initial: User | null;
  facilities: Facility[];
  departments: Department[];
  orgRoles: OrgRole[];
  titles: UserTitle[];
  onSaved: () => void;
}

function UserFormSheet({
  open,
  onClose,
  initial,
  facilities,
  departments,
  orgRoles,
  titles,
  onSaved,
}: UserFormSheetProps) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    national_id: "",
    id_type: "NRC",
    email: "",
    role: "staff",
    facility_id: "",
    department_id: "",
    org_role_id: "",
    title_id: "",
    is_enabled: true,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        first_name: initial?.first_name ?? "",
        last_name: initial?.last_name ?? "",
        national_id: initial?.national_id ?? "",
        id_type: initial?.id_type ?? "NRC",
        email: initial?.email ?? "",
        role: initial?.role ?? "staff",
        facility_id: initial?.facility_id ? String(initial.facility_id) : "",
        department_id: initial?.department_id
          ? String(initial.department_id)
          : "",
        org_role_id: initial?.org_role_id ? String(initial.org_role_id) : "",
        title_id: initial?.title_id ? String(initial.title_id) : "",
        is_enabled: initial?.is_enabled ?? true,
      });
    }
  }, [open, initial]);

  const set =
    (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const body = {
      ...form,
      facility_id: form.facility_id ? Number(form.facility_id) : null,
      department_id: form.department_id ? Number(form.department_id) : null,
      org_role_id: form.org_role_id ? Number(form.org_role_id) : null,
      title_id: form.title_id ? Number(form.title_id) : null,
    };
    const res = initial
      ? await api.put(`/admin/users/${initial.id}`, body)
      : await api.post("/admin/users", body);
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    toast.success(initial ? "User updated." : "User created.");
    onSaved();
    onClose();
  }

  const selProps = (field: keyof typeof form) => ({
    value: String(form[field]) || "__none__",
    onValueChange: (v: string) =>
      setForm((f) => ({ ...f, [field]: v === "__none__" ? "" : v })),
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>{initial ? "Edit User" : "New User"}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 overflow-y-auto"
        >
          <div className="px-6 py-6">
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-5">
              <Label className="text-right text-sm">First Name</Label>
              <Input
                value={form.first_name}
                onChange={set("first_name")}
                required
              />

              <Label className="text-right text-sm">Last Name</Label>
              <Input
                value={form.last_name}
                onChange={set("last_name")}
                required
              />

              <Label className="text-right text-sm">National ID</Label>
              <Input
                value={form.national_id}
                onChange={set("national_id")}
                required
                disabled={!!initial}
              />

              <Label className="text-right text-sm">ID Type</Label>
              <Select {...selProps("id_type")}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["NRC", "Passport", "Other"].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label className="text-right text-sm">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={set("email")}
                required
              />

              <Label className="text-right text-sm">System Role</Label>
              <Select {...selProps("role")}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Label className="text-right text-sm">Facility</Label>
              <Select {...selProps("facility_id")}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="— None —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {facilities.map((f) => (
                      <SelectItem
                        key={f.id}
                        value={String(f.id)}
                        description={f.code}
                      >
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Label className="text-right text-sm">Department</Label>
              <Select {...selProps("department_id")}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="— None —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {departments.map((d) => (
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

              <Label className="text-right text-sm">Org Role</Label>
              <Select {...selProps("org_role_id")}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="— None —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {orgRoles.map((r) => (
                      <SelectItem
                        key={r.id}
                        value={String(r.id)}
                        description={r.code}
                      >
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Label className="text-right text-sm">Job Title</Label>
              <Select {...selProps("title_id")}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="— None —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {titles.map((t) => (
                      <SelectItem
                        key={t.id}
                        value={String(t.id)}
                        description={t.code}
                      >
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              {initial && (
                <>
                  <Label className="text-right text-sm">Status</Label>
                  <Select
                    value={form.is_enabled ? "enabled" : "disabled"}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, is_enabled: v === "enabled" }))
                    }
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enabled">Enabled</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
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

// ── Import dialog ─────────────────────────────────────────────────────────────

interface ImportResult {
  imported: number;
  skipped?: number;
  credentials: ImportCredential[];
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
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
    const res = await api.post<ImportResult>("/admin/users/import", { csv });
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    onImported(res.data);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Users from CSV</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Required columns: <code>first_name</code>, <code>last_name</code>,{" "}
            <code>national_id</code>, <code>id_type</code>, <code>email</code>.
            <br />
            Optional: <code>facility_code</code>, <code>department_code</code>,{" "}
            <code>role_code</code>, <code>title_code</code>.
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

// ── Credentials dialog (shown after import) ───────────────────────────────────

function CredentialsDialog({
  result,
  onClose,
}: {
  result: ImportResult | null;
  onClose: () => void;
}) {
  if (!result) return null;

  function downloadCsv() {
    const header = "username,temp_password";
    const rows = result!.credentials.map(
      (c) => `${c.user_name},${c.temp_password}`,
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "credentials.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Import complete — {result.imported} created
            {result.skipped ? `, ${result.skipped} skipped` : ""}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          These are the temporary passwords. Users will be prompted to change
          them on first login. Download or copy them now — they are also visible
          per-user in the table.
        </p>
        <div className="max-h-64 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Temp Password</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.credentials.map((c) => (
                <TableRow key={c.user_name}>
                  <TableCell className="text-xs font-mono">
                    {c.user_name}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {c.temp_password}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={downloadCsv}>
            Download CSV
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reset password confirmation ───────────────────────────────────────────────

function ResetPasswordDialog({
  user,
  onClose,
  onReset,
}: {
  user: User | null;
  onClose: () => void;
  onReset: (userId: number) => void;
}) {
  return (
    <AlertDialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Reset password for {user?.first_name} {user?.last_name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            A new temporary password will be generated. The user will be
            required to change it on next login. The new password will be
            visible in the table.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => user && onReset(user.id)}>
            Reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === "admin";
  const qc = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  // Search + pagination (client-side — user list is small).
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Reference data for selects
  const { data: facilities = [] } = useQuery({
    queryKey: ["admin", "facilities"],
    queryFn: async () => {
      const r = await api.get<{ facilities: Facility[] }>("/admin/facilities");
      if (r.error !== null) throw new Error(r.error);
      return r.data.facilities;
    },
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: async () => {
      const r = await api.get<{ departments: Department[] }>(
        "/admin/departments",
      );
      if (r.error !== null) throw new Error(r.error);
      return r.data.departments;
    },
  });
  const { data: orgRoles = [] } = useQuery({
    queryKey: ["admin", "org-roles"],
    queryFn: async () => {
      const r = await api.get<{ org_roles: OrgRole[] }>("/admin/org-roles");
      if (r.error !== null) throw new Error(r.error);
      return r.data.org_roles;
    },
  });
  const { data: titles = [] } = useQuery({
    queryKey: ["admin", "user-titles"],
    queryFn: async () => {
      const r = await api.get<{ user_titles: UserTitle[] }>(
        "/admin/user-titles",
      );
      if (r.error !== null) throw new Error(r.error);
      return r.data.user_titles;
    },
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await api.get<{ users: User[] }>("/admin/users");
      if (res.error !== null) throw new Error(res.error);
      return res.data.users;
    },
    enabled: isAdmin,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["admin", "users"] });

  // Filter + paginate client-side.
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.first_name + " " + u.last_name).toLowerCase().includes(q) ||
        u.user_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.facility_name ?? "").toLowerCase().includes(q) ||
        (u.department_name ?? "").toLowerCase().includes(q),
    );
  }, [users, searchInput]);
  const paged = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );
  useEffect(() => {
    setPage(0);
  }, [searchInput, users.length]);

  async function handleReset(userId: number) {
    const res = await api.post<{ temp_password: string }>(
      `/admin/users/${userId}/reset-password`,
      {},
    );
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    toast.success("Password reset. New temp password is visible in the table.");
    invalidate();
    setResetTarget(null);
  }

  const navComponents = () => (
    <div className="flex min-h-13 max-h-13 w-full items-center gap-2 pr-2 py-2">
      <h1 className="font-bold text-sm">Users</h1>
      <div className="relative ml-3 w-64">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, email, facility…"
          className="h-8 pl-7 text-sm"
          disabled={!isAdmin}
        />
      </div>
      <div className="flex flex-1" />
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setImportOpen(true)}
          >
            <FileUp className="h-3.5 w-3.5" /> Import CSV
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add User
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <ContentLayout nav={navComponents()}>
      <div className="flex  flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full h-full">
        {!isAdmin ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Admin access required.
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <Table className="min-h-[calc(100vh-26px-56px-57px)] max-h-[calc(100vh-26px-56px-57px)]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wide">
                      Name
                    </TableHead>
                    <TableHead className="w-36 text-xs uppercase tracking-wide">
                      Username
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">
                      Email
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">
                      Facility
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">
                      Department
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">
                      Role / Title
                    </TableHead>
                    <TableHead className="w-24 text-xs uppercase tracking-wide">
                      Status
                    </TableHead>
                    <TableHead className="w-40 text-xs uppercase tracking-wide">
                      Temp Password
                    </TableHead>
                    <TableHead className="w-24 text-right text-xs uppercase tracking-wide">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {users.length === 0
                          ? "No users yet. Add one or import a CSV."
                          : "No users match your search."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paged.map((u) => (
                      <TableRow
                        key={u.id}
                        className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                        onClick={() => {
                          setEditing(u);
                          setSheetOpen(true);
                        }}
                      >
                        <TableCell className="text-sm font-medium">
                          {u.first_name} {u.last_name}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {u.user_name}
                        </TableCell>
                        <TableCell className="text-xs">{u.email}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.facility_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.department_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.org_role_name ?? u.title_name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`whitespace-nowrap text-[10px] uppercase ${
                              u.is_enabled
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                : "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
                            }`}
                          >
                            {u.is_enabled ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <TempPasswordCell value={u.temp_password} />
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditing(u);
                                setSheetOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Reset password"
                              onClick={() => setResetTarget(u)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  <TableFillerRow
                    colSpan={9}
                    show={!isLoading && filtered.length > 0}
                  />
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
                  {filtered.length} user{filtered.length === 1 ? "" : "s"}
                  {searchInput && ` · filtered from ${users.length}`}
                </span>
              }
            />
          </>
        )}
      </div>

      <UserFormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        initial={editing}
        facilities={facilities}
        departments={departments}
        orgRoles={orgRoles}
        titles={titles}
        onSaved={invalidate}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(result) => {
          setImportResult(result);
          invalidate();
        }}
      />

      <CredentialsDialog
        result={importResult}
        onClose={() => setImportResult(null)}
      />

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onReset={handleReset}
      />
    </ContentLayout>
  );
}
