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
};

type Group = {
  groupLabel: string;
  menus: Menu[];
};

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";

export type Role = "admin" | "staff" | null;

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
          adminOnly: true,
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
          adminOnly: true,
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

  // Filter admin-only items for non-admin callers, and drop groups that
  // become empty afterwards.
  return groups
    .map((g) => ({
      ...g,
      menus: g.menus.filter((m) => !m.adminOnly || role === "admin"),
    }))
    .filter((g) => g.menus.length > 0);
}
