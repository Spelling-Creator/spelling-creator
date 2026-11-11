// The app's chrome: one slim sticky header.
//
// What lives where:
//   - The three real destinations (Home, the hub, this device's lessons) are
//     inline links on md-and-up, and a sheet behind a menu button below that.
//   - "New lesson", the app's one accent-carrying action, is a button on the
//     right on every page.
//   - Settings is a gear beside the theme toggle: most of that page is
//     this-browser preferences, so it has to be reachable signed out, where
//     there is no account menu to put it in.
//   - Everything about the account (profile, display name, moderation for
//     moderators, sign out) is in the avatar menu.
//
// The bar is the app's `--card` chrome surface; PageBar (crumbs and page
// actions, on the pages that keep one) pins directly beneath it and shares
// the look, so the two read as one piece of chrome rather than two bars.

import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link, useMatch, useResolvedPath } from "react-router";
import {
  BookMarkedIcon,
  CircleUserIcon,
  HouseIcon,
  IdCardIcon,
  LibraryIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useColorScheme } from "@/lib/colorScheme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import DisplayNameDialog from "@/components/DisplayNameDialog";
import InstallAppButton from "@/components/InstallAppButton";
import { LogoMark } from "@/components/Logo";
import NotificationBell from "@/components/NotificationBell";

// Shared styling for the header's icon controls (install, theme, settings,
// notifications, the menu button, the avatar). bg-transparent and border-0
// are explicit so a <button> doesn't pick up the browser's default chrome.
const utilityTrigger = cn(
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md",
  "border-0 bg-transparent text-foreground no-underline transition-colors",
  "hover:bg-accent hover:text-accent-foreground",
  "[&>svg]:size-5",
);

/**
 * One of the inline destinations, highlighted when the route is on it.
 *
 * `end` is true so /hub stops being highlighted once you're inside /hub/:id:
 * the lesson has its own place in the breadcrumb, and two things claiming to
 * be "where you are" reads as a bug. The current one is underlined in the
 * text color rather than tinted: the chrome's tint is a neutral gray too
 * faint to mark a state by itself.
 */
function HeaderNavLink({ to, label }: { to: string; label: string }) {
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });

  return (
    <Link
      to={to}
      aria-current={match ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium no-underline transition-colors",
        match
          ? "text-foreground underline decoration-2 underline-offset-8 hover:bg-accent"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </Link>
  );
}

// A destination row in the mobile sheet: roomier than the inline links, with
// an icon, because the sheet is a tap target list rather than a text nav.
function SheetNavLink({
  to,
  icon: Icon,
  label,
  onNavigate,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onNavigate: () => void;
}) {
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });

  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={match ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium no-underline transition-colors",
        match
          ? "selected-bar bg-accent font-semibold text-accent-foreground"
          : "text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

export default function AppHeader() {
  const { t } = useTranslation("common");
  const { enabled, user, displayName, signOut, isModerator } = useAuth();
  const { resolved, setScheme } = useColorScheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);

  const dark = resolved === "dark";

  // The sheet is an overlay, so following a link out of it has to close it
  // or you land on the new page with the sheet still covering it.
  const closeMenu = () => setMenuOpen(false);

  const themeToggle = (
    <button
      type="button"
      aria-label={dark ? t("nav.switchToLightMode") : t("nav.switchToDarkMode")}
      onClick={() => setScheme(dark ? "light" : "dark")}
      className={utilityTrigger}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );

  return (
    // pt-safe keeps the contents clear of the iOS status bar when the app
    // runs installed, where the bar reaches the very top of the screen, and
    // the px-safe-* padding keeps the end buttons out from under the notch in
    // landscape. All of it resolves to 0 where nothing is in the way.
    <header className="sticky top-0 z-40 border-b border-border bg-card pt-safe">
      <div className="flex h-(--header-row-h) items-center gap-1 px-safe-3 sm:px-safe-4">
        {/* The destinations move behind a menu button where the row can't
            hold them. The sheet carries Settings too, since the gear it
            normally shares a cluster with is also hidden at this width. */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t("nav.openMenu")}
              className={cn(utilityTrigger, "md:hidden")}
            >
              <MenuIcon />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0">
            <SheetHeader className="border-b border-border">
              <SheetTitle className="flex items-center gap-2 text-base">
                <LogoMark className="size-7" />
                <span className="font-serif">{t("nav.appName")}</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-3">
              <SheetNavLink
                to="/"
                icon={HouseIcon}
                label={t("nav.home")}
                onNavigate={closeMenu}
              />
              <SheetNavLink
                to="/hub"
                icon={BookMarkedIcon}
                label={t("nav.lessonHub")}
                onNavigate={closeMenu}
              />
              <SheetNavLink
                to="/library"
                icon={LibraryIcon}
                label={t("nav.onThisDevice")}
                onNavigate={closeMenu}
              />
              <SheetNavLink
                to="/settings"
                icon={SettingsIcon}
                label={t("nav.settings")}
                onNavigate={closeMenu}
              />
            </nav>
          </SheetContent>
        </Sheet>

        {/* aria-label because below `sm` the wordmark is hidden and the mark
            is decorative, which would leave the link nameless. */}
        <Link
          to="/"
          aria-label={t("nav.appName")}
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-md px-1 text-foreground no-underline"
        >
          <LogoMark className="size-8" />
          {/* The wordmark yields before anything functional does. */}
          <span className="hidden truncate font-serif font-semibold sm:block">
            {t("nav.appName")}
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-0.5 md:flex">
          <HeaderNavLink to="/" label={t("nav.home")} />
          <HeaderNavLink to="/hub" label={t("nav.lessonHub")} />
          {/* The list of what this browser is holding. A link rather than
              the titles inline: the editor rewrites a lesson's title as it
              is typed, and a copy of it in chrome would spend the whole
              session one keystroke behind. */}
          <HeaderNavLink to="/library" label={t("nav.onThisDevice")} />
        </nav>

        <div className="flex-1" />

        {/* The one action rather than a destination, so it carries the app's
            accent. `?new=1` rather than plain /editor: the editor holds a
            library of lessons, so opening it resumes whichever you last had
            open, and this asks for another one. aria-label because below
            `sm` the visible label is hidden and the icon is aria-hidden. */}
        <Button size="sm" asChild className="shrink-0">
          <Link
            to="/editor?new=1"
            aria-label={t("nav.newLesson")}
            className="no-underline"
          >
            <PlusIcon data-icon="inline-start" />
            <span className="hidden sm:inline">{t("nav.newLesson")}</span>
          </Link>
        </Button>

        {/* The utility cluster. Hidden below sm, where the sheet carries
            Settings and the theme lives on the settings page; the bell
            stays, because an unread notification is worth a slot at any
            width. */}
        <div className="ml-1 hidden items-center gap-1 sm:flex">
          <InstallAppButton className={utilityTrigger} />
          {themeToggle}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                aria-label={t("nav.settings")}
                className={utilityTrigger}
              >
                <SettingsIcon />
              </Link>
            </TooltipTrigger>
            <TooltipContent>{t("nav.settings")}</TooltipContent>
          </Tooltip>
        </div>
        {enabled && user && <NotificationBell className={utilityTrigger} />}

        {!enabled ? null : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("nav.accountMenuAriaLabel")}
                className={utilityTrigger}
              >
                <CircleUserIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col">
                <span>{displayName || t("nav.signedIn")}</span>
                <span className="break-all text-xs font-normal text-muted-foreground">
                  {user.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* Destinations render as real links (asChild), not onClick
                  navigations, so middle-click and "open in new tab" work.
                  "Edit display name" stays an action: it opens a dialog. */}
              <DropdownMenuItem asChild>
                <Link to={`/users/${user.id}`} className="no-underline">
                  <UserIcon />
                  {t("nav.myProfile")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNameDialogOpen(true)}>
                <IdCardIcon />
                {t("nav.editDisplayName")}
              </DropdownMenuItem>
              {isModerator && (
                <DropdownMenuItem asChild>
                  <Link to="/moderation" className="no-underline">
                    <ShieldIcon />
                    {t("nav.moderation")}
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOutIcon />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link to="/login" className="no-underline">
              <CircleUserIcon data-icon="inline-start" />
              {t("nav.signIn")}
            </Link>
          </Button>
        )}
      </div>

      {user && (
        <DisplayNameDialog
          open={nameDialogOpen}
          onClose={() => setNameDialogOpen(false)}
        />
      )}
    </header>
  );
}
