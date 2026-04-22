"use client";

import { NavLink, useLocation } from "react-router-dom";
import { Ellipsis, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { getMenuList } from "@/lib/menu-list";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CollapseMenuButton } from "@/components/admin-panel/collapse-menu-button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { DynamicIcon } from "@/components/dynamicIcon";
import { useCommonTranslation } from "@/i18n/hooks";
import { useAuthStore } from "@/store/auth";

interface MenuProps {
  isOpen: boolean | undefined;
}

export function Menu({ isOpen }: MenuProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const { t } = useCommonTranslation();
  const role = useAuthStore(
    (s) => (s.user?.role as "admin" | "staff" | undefined) ?? null,
  );

  const menuList = getMenuList(pathname, role);

  const isActive = (path: string) => {
    if (pathname === path) return true;
    return pathname.startsWith(path + "/");
  };

  // Helper to render icon
  const renderIcon = (icon: string | LucideIcon, className: string) => {
    if (typeof icon === "string") {
      // Remove < > / whitespace and convert to kebab-case friendly format
      const cleanedIcon = icon
        .replace(/<|>|\//g, "") // Remove JSX-like characters
        .trim() // Remove whitespace
        .toLowerCase(); // Convert to lowercase
      return <DynamicIcon iconName={cleanedIcon} className={className} />;
    }
    const Icon = icon;
    return <Icon className={className} />;
  };

  return (
    <ScrollArea className="h-full [&>div>div[style]]:block! ">
      <nav className="mt-2 h-full w-full">
        <ul className="flex flex-col min-h-[calc(100vh-26px-48px-36px-16px-32px)] lg:min-h-[calc(100vh-26px-32px-40px-32px)] items-start px-2">
          {menuList.map(({ groupLabel, menus }, index) => (
            <li className={cn("w-full", groupLabel ? "pt-3" : "")} key={index}>
              {(isOpen && groupLabel) || isOpen === undefined ? (
                <p className="text-xs font-medium text-muted-foreground px-4 pb-1 max-w-62 truncate">
                  {t(groupLabel as any)}
                </p>
              ) : !isOpen && isOpen !== undefined && groupLabel ? (
                <TooltipProvider>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger className="w-full">
                      <div className="w-full flex justify-center items-center">
                        <Ellipsis className="h-5 w-5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>{t(groupLabel as any)}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <p className="pb-1"></p>
              )}
              {menus.map(({ href, label, icon, active, submenus }, index) => {
                return !submenus || submenus.length === 0 ? (
                  <div className="w-full" key={`extension-${index}-${index}`}>
                    <TooltipProvider disableHoverableContent>
                      <Tooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                          <Button
                            variant={
                              (active === undefined && isActive(href)) || active
                                ? "secondary"
                                : "ghost"
                            }
                            className="w-full justify-start h-8"
                            asChild
                          >
                            <NavLink to={href}>
                              <span
                                className={cn(isOpen === false ? "" : "mr-4")}
                              >
                                {/* <Icon size={18} /> */}
                                {renderIcon(icon, "h-4 w-4")}
                              </span>
                              <p
                                className={cn(
                                  "max-w-50 truncate",
                                  isOpen === false
                                    ? "-translate-x-96 opacity-0"
                                    : "translate-x-0 opacity-100",
                                )}
                              >
                                {t(label as any)}
                              </p>
                            </NavLink>
                          </Button>
                        </TooltipTrigger>
                        {isOpen === false && (
                          <TooltipContent side="right">
                            {t(label as any)}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ) : (
                  <div className="w-full" key={index}>
                    <CollapseMenuButton
                      icon={icon}
                      label={label}
                      active={active === undefined ? isActive(href) : active}
                      submenus={submenus}
                      isOpen={isOpen}
                    />
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      </nav>
    </ScrollArea>
  );
}
