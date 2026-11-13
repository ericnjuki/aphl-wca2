import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import {
  buildUserBody,
  filterFacilities,
  missingPlacement,
  placementKind,
  type UserForm,
} from "@/lib/users/placement";
import { api } from "@/lib/api";
import { assignableRoles, USER_MANAGER_ROLES, type Role } from "@/lib/roles";
import { useRoleLabel } from "@/hooks/useRoleLabel";
import { useAuthStore } from "@/store/auth";
import { NoAccessNotice } from "@/components/NoAccessNotice";
import { useOrgLabels } from "@/store/config";

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Facility {
  id: number;
  code: string;
  name: string;
  region_id: number | null;
  district_id: number | null;
}
interface Region {
  id: number;
  code: string;
  name: string;
}
interface District {
  id: number;
  code: string;
  name: string;
  region_id: number;
  region_name: string | null;
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
  regions: { id: number; name: string }[];
  region_ids: number[];
  districts: { id: number; name: string }[];
  district_ids: number[];
  temp_password: string | null;
}

const EMPTY_FORM: UserForm = {
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
  region_ids: [],
  district_ids: [],
  is_enabled: true,
};

/** Where a user sits: their county, sub-county or facility. */
function placementName(u: User): string {
  const kind = placementKind(u.role);
  if (kind === "region") return u.regions.map((r) => r.name).join(", ") || "—";
  if (kind === "district") return u.districts.map((d) => d.name).join(", ") || "—";
  if (kind === "none") return "—";
  return u.facility_name ?? "—";
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
  regions: Region[];
  districts: District[];
  onSaved: () => void;
}

const NONE = "__none__";

function UserFormSheet({
  open,
  onClose,
  initial,
  facilities,
  departments,
  orgRoles,
  titles,
  regions,
  districts,
  onSaved,
}: UserFormSheetProps) {
  const { user: me } = useAuthStore();
  const roleLabel = useRoleLabel();
  const { region, district } = useOrgLabels();
  const isFacilityAdmin = me?.role === "facility_admin";
  const roleOptions = assignableRoles(me?.role);
  // The API refuses these for facility admins; don't offer them.
  const lockRole = isFacilityAdmin && initial?.id === me?.id;

  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  // Cascade filters for the facility list (never saved).
  const [filterRegion, setFilterRegion] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
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
        facility_id: initial
          ? initial.facility_id ? String(initial.facility_id) : ""
          : isFacilityAdmin && me?.facility_id ? String(me.facility_id) : "",
        department_id: initial?.department_id
          ? String(initial.department_id)
          : "",
        org_role_id: initial?.org_role_id ? String(initial.org_role_id) : "",
        title_id: initial?.title_id ? String(initial.title_id) : "",
        region_ids: initial?.region_ids ?? [],
        district_ids: initial?.district_ids ?? [],
        is_enabled: initial?.is_enabled ?? true,
      });
      setFilterRegion("");
      setFilterDistrict("");
    }
  }, [open, initial, isFacilityAdmin, me?.facility_id]);

  const set =
    (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  const kind = placementKind(form.role);

  const districtOptions = useMemo(
    () => (filterRegion ? districts.filter((d) => d.region_id === Number(filterRegion)) : districts),
    [districts, filterRegion],
  );
  const facilityOptions = useMemo(
    () =>
      filterFacilities(
        facilities,
        filterRegion ? Number(filterRegion) : null,
        filterDistrict ? Number(filterDistrict) : null,
      ),
    [facilities, filterRegion, filterDistrict],
  );
  // Picking a filter drops a facility that no longer matches. Only when a filter
  // is set: with none, an empty list just means the facilities are still loading.
  useEffect(() => {
    if (!filterRegion && !filterDistrict) return;
    if (form.facility_id && !facilityOptions.some((f) => String(f.id) === form.facility_id))
      setForm((f) => ({ ...f, facility_id: "" }));
  }, [facilityOptions, form.facility_id, filterRegion, filterDistrict]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing = missingPlacement(form);
    if (missing) {
      const what = missing === "region" ? region.lower : missing === "district" ? district.lower : "facility";
      toast.error(`Select a ${what} for a ${roleLabel(form.role).toLowerCase()}.`);
      return;
    }
    setLoading(true);
    const body = buildUserBody(form);
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
    value: String(form[field]) || NONE,
    onValueChange: (v: string) =>
      setForm((f) => ({ ...f, [field]: v === NONE ? "" : v })),
  });

  const idSelect = (
    items: { id: number; code?: string; name: string }[],
    value: string,
    onChange: (v: string) => void,
    noneLabel: string,
    disabled = false,
  ) => (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger className="text-sm">
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {items.map((it) => (
            <SelectItem key={it.id} value={String(it.id)} description={it.code}>
              {it.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

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
              <Select {...selProps("role")} disabled={lockRole}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {kind === "region" && (
                <>
                  <Label className="text-right text-sm">{region.one}</Label>
                  {idSelect(
                    regions,
                    form.region_ids[0] ? String(form.region_ids[0]) : "",
                    (v) => setForm((f) => ({ ...f, region_ids: v ? [Number(v)] : [] })),
                    `— Select ${region.lower} —`,
                  )}
                </>
              )}

              {kind === "district" && (
                <>
                  <Label className="text-right text-sm">{district.one}</Label>
                  <Select
                    value={form.district_ids[0] ? String(form.district_ids[0]) : NONE}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, district_ids: v === NONE ? [] : [Number(v)] }))
                    }
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder={`— Select ${district.lower} —`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={NONE}>{`— Select ${district.lower} —`}</SelectItem>
                        {districts.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)} description={d.region_name ?? undefined}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </>
              )}

              {kind === "facility" && (
                <>
                  {!isFacilityAdmin && (
                    <>
                      <Label className="text-right text-sm">{region.one}</Label>
                      {idSelect(regions, filterRegion, (v) => {
                        setFilterRegion(v);
                        setFilterDistrict("");
                      }, `— Any ${region.lower} —`)}

                      <Label className="text-right text-sm">{district.one}</Label>
                      {idSelect(districtOptions, filterDistrict, setFilterDistrict, `— Any ${district.lower} —`)}
                    </>
                  )}

                  <Label className="text-right text-sm">Facility</Label>
                  {idSelect(
                    facilityOptions,
                    form.facility_id,
                    (v) => setForm((f) => ({ ...f, facility_id: v })),
                    "— None —",
                    isFacilityAdmin,
                  )}

                  <Label className="text-right text-sm">Department</Label>
                  {idSelect(departments, form.department_id, (v) => setForm((f) => ({ ...f, department_id: v })), "— None —")}

                  <Label className="text-right text-sm">Org Role</Label>
                  {idSelect(orgRoles, form.org_role_id, (v) => setForm((f) => ({ ...f, org_role_id: v })), "— None —")}

                  <Label className="text-right text-sm">Job Title</Label>
                  {idSelect(titles, form.title_id, (v) => setForm((f) => ({ ...f, title_id: v })), "— None —")}
                </>
              )}

              {initial && !isFacilityAdmin && (
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
  const canManage =
    currentUser != null && (USER_MANAGER_ROLES as readonly Role[]).includes(currentUser.role);
  const roleLabel = useRoleLabel();
  const { region, district } = useOrgLabels();
  const qc = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
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

  const { data: regions = [] } = useQuery({
    queryKey: ["admin", "regions"],
    queryFn: async () => {
      const r = await api.get<{ regions: Region[] }>("/admin/regions");
      if (r.error !== null) throw new Error(r.error);
      return r.data.regions;
    },
  });
  const { data: districts = [] } = useQuery({
    queryKey: ["admin", "districts"],
    queryFn: async () => {
      const r = await api.get<{ districts: District[] }>("/admin/districts");
      if (r.error !== null) throw new Error(r.error);
      return r.data.districts;
    },
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await api.get<{ users: User[] }>("/admin/users");
      if (res.error !== null) throw new Error(res.error);
      return res.data.users;
    },
    enabled: canManage,
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
        u.regions.some((r) => r.name.toLowerCase().includes(q)) ||
        u.districts.some((d) => d.name.toLowerCase().includes(q)) ||
        roleLabel(u.role).toLowerCase().includes(q) ||
        (u.department_name ?? "").toLowerCase().includes(q),
    );
  }, [users, searchInput, roleLabel]);
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
          disabled={!canManage}
        />
      </div>
      <div className="flex flex-1" />
      {canManage && (
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <Link to={`${baseUrl}setup`} title="Bulk-import users with the country setup workbook">
                <FileUp className="h-3.5 w-3.5" /> Bulk import on Setup
              </Link>
            </Button>
          )}
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
        {!canManage ? (
          <NoAccessNotice what="user management" />
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
                      Facility / {region.one} / {district.one}
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
                          ? isAdmin
                            ? "No users yet. Add one, or bulk-import users with the workbook on the Setup page."
                            : "No users in your facility yet."
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
                          {placementName(u)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.department_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {u.role !== "staff" && (
                              <Badge variant="outline" className="whitespace-nowrap text-[10px] uppercase">
                                {roleLabel(u.role)}
                              </Badge>
                            )}
                            {u.org_role_name ?? u.title_name ?? (u.role === "staff" ? "—" : null)}
                          </div>
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
        regions={regions}
        districts={districts}
        onSaved={invalidate}
      />

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onReset={handleReset}
      />
    </ContentLayout>
  );
}
