import {
  BookOpen,
  ClipboardList,
  FileText,
  type LucideIcon,
  Form,
  Users,
  Library,
  ListChecks,
  Settings2,
} from "lucide-react";
import {
  FACILITY_ROLES,
  REVIEWER_ROLES,
  USER_MANAGER_ROLES,
  type Role as UserRole,
} from "@/lib/roles";

type Submenu = {
  href: string;
  label: string;
  active?: boolean;
};

type Menu = {
  href: string;
  label: string;
  active?: boolean;
  icon: LucideIcon;
  submenus?: Submenu[];
  adminOnly?: boolean;
  /** If set, only these roles see the item. */
  roles?: readonly UserRole[];
};

type Group = {
  groupLabel: string;
  menus: Menu[];
};

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";

export type Role = UserRole | null;

export function getMenuList(_pathname: string, role: Role = null): Group[] {
  const groups: Group[] = [
    {
      groupLabel: "",
      menus: [
        {
          href: baseUrl,
          label: "navigation.survey",
          icon: Form,
          submenus: [],
          roles: FACILITY_ROLES,
        },
      ],
    },
    {
      groupLabel: "navigation.contents",
      menus: [
        {
          href: `${baseUrl}my-assessments`,
          label: "navigation.my_assessments",
          icon: ClipboardList,
          roles: FACILITY_ROLES,
        },
        {
          href: `${baseUrl}reports`,
          label: "navigation.reports",
          icon: FileText,
        },
        {
          href: `${baseUrl}reviews`,
          label: "navigation.reviews",
          icon: ListChecks,
          roles: REVIEWER_ROLES,
        },
      ],
    },
    {
      groupLabel: "navigation.settings",
      menus: [
        {
          href: `${baseUrl}assessments`,
          label: "navigation.assessments",
          icon: Library,
          submenus: [],
          adminOnly: true,
        },
        {
          href: `${baseUrl}users`,
          label: "navigation.users",
          icon: Users,
          roles: USER_MANAGER_ROLES,
        },
        {
          href: `${baseUrl}setup`,
          label: "navigation.setup",
          icon: Settings2,
          adminOnly: true,
        },
      ],
    },
    {
      groupLabel: "navigation.help",
      menus: [
        {
          href: `${baseUrl}docs`,
          label: "navigation.docs",
          icon: BookOpen,
        },
      ],
    },
  ];

  // Filter admin-only and role-restricted items, and drop groups that become
  // empty afterwards.
  return groups
    .map((g) => ({
      ...g,
      menus: g.menus.filter(
        (m) =>
          (!m.adminOnly || role === "admin") &&
          // Unknown role (still loading) keeps the default staff menu.
          (!m.roles || m.roles.includes(role ?? "staff")),
      ),
    }))
    .filter((g) => g.menus.length > 0);
}
