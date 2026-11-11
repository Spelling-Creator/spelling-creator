// A dialog that lists a user's followers and the users they follow, in two
// tabs. Opened from the follower and following counts on a profile page.
// Each row links to that user's profile. Lists are public
// (core/users.fetchFollowList) and loaded lazily per tab on first view; the
// caches are cleared when the dialog closes so a reopen reflects any follows
// made since.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { initial } from "@/lib/format";
import { fetchFollowList, type PublicUser } from "@spelling-creator/core/users";
import { richTextToLine } from "@spelling-creator/core/richText";

type Tab = "followers" | "following";

interface TabState {
  loading: boolean;
  error: string;
  users: PublicUser[];
}

// A few placeholder rows (avatar and name line) while a tab's list loads.
function RowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton
            className="h-4"
            style={{ width: `${60 - i * 6}%` } as CSSProperties}
          />
        </div>
      ))}
    </div>
  );
}

export default function FollowListDialog({
  open,
  userId,
  displayName,
  initialTab = "followers",
  onClose,
}: {
  open: boolean;
  /** The profile whose connections to list. */
  userId: string;
  /** That user's name, for the empty-state copy. */
  displayName?: string;
  initialTab?: Tab;
  onClose?: () => void;
}) {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const name = displayName || t("followList.defaultUserLabel");
  const [tab, setTab] = useState<Tab>(initialTab);
  // Per-tab load state; null means "not requested yet".
  const [state, setState] = useState<Record<Tab, TabState | null>>({
    followers: null,
    following: null,
  });
  // Which tabs have been kicked off, so switching back and forth doesn't
  // refetch.
  const requested = useRef<Partial<Record<Tab, boolean>>>({});

  // Open on the requested tab; clear caches on close so a reopen is fresh.
  useEffect(() => {
    if (open) {
      setTab(initialTab);
    } else {
      requested.current = {};
      setState({ followers: null, following: null });
    }
  }, [open, initialTab]);

  // Load the active tab's list on first view.
  useEffect(() => {
    if (!open || !userId || requested.current[tab]) return;
    requested.current[tab] = true;
    let active = true;
    setState((s) => ({ ...s, [tab]: { loading: true, error: "", users: [] } }));
    fetchFollowList(userId, tab)
      .then((users) => {
        if (active)
          setState((s) => ({
            ...s,
            [tab]: { loading: false, error: "", users },
          }));
      })
      .catch((err) => {
        if (active)
          setState((s) => ({
            ...s,
            [tab]: {
              loading: false,
              error:
                err instanceof Error && err.message
                  ? err.message
                  : t("followList.loadError"),
              users: [],
            },
          }));
      });
    return () => {
      active = false;
    };
  }, [open, userId, tab, t]);

  const openProfile = (id: string) => {
    onClose?.();
    navigate(`/users/${id}`);
  };

  const current = state[tab];
  const emptyText =
    tab === "followers"
      ? t("followList.noFollowers", { name })
      : t("followList.noFollowing", { name });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="sm:max-w-sm" bodyClassName="p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>{t("followList.title")}</DialogTitle>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as Tab)}
          className="gap-0"
        >
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
            <TabsTrigger value="followers">
              {t("followList.followersTab")}
            </TabsTrigger>
            <TabsTrigger value="following">
              {t("followList.followingTab")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="min-h-[240px] border-t border-border py-2">
          {!current || current.loading ? (
            <RowsSkeleton />
          ) : current.error ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertDescription>{current.error}</AlertDescription>
              </Alert>
            </div>
          ) : current.users.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            <div className="flex flex-col">
              {current.users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => openProfile(u.id)}
                  className="flex cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-2 text-left transition-colors hover:bg-accent"
                >
                  <Avatar>
                    <AvatarFallback>{initial(u.displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {u.displayName || t("followList.anonymousName")}
                    </p>
                    {/* Bios are rich-text HTML; this is a one-line subtitle,
                        so show the words and drop the markup. */}
                    {richTextToLine(u.bio, 80) && (
                      <p className="truncate text-sm text-muted-foreground">
                        {richTextToLine(u.bio, 80)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
