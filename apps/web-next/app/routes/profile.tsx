// A user's public profile (/users/:id): their chosen display name, bio,
// follower and following counts, and the lessons they've published. The
// owner can edit their bio in place, and any other signed-in user can follow
// or unfollow them. Profiles are keyed by the Supabase user id (the same
// `authorId` on every lesson), so a link survives a display-name change.
//
// The loader fetches the public profile, which is the whole page for a
// signed-out reader. A signed-in one re-fetches quietly after hydration:
// only an authenticated fetch reports whether they follow this person.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import {
  FileTextIcon,
  HistoryIcon,
  PencilIcon,
  RssIcon,
  UserCheckIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { hasApi } from "@spelling-creator/core/config";
import {
  fetchUserActivity,
  type FeedEntry,
} from "@spelling-creator/core/browser/feeds";
import type { LessonSummary } from "@spelling-creator/core/lessons";
import { richTextToLine } from "@spelling-creator/core/richText";
import {
  fetchUserProfile,
  setFollowing,
  userFeedUrl,
  type UserProfile,
} from "@spelling-creator/core/users";
import type { Route } from "./+types/profile";
import PageBody from "@/components/layout/PageBody";
import BioDialog from "@/components/BioDialog";
import FollowListDialog from "@/components/FollowListDialog";
import RichText from "@/components/RichText";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import { LessonListSkeleton } from "@/components/Skeletons";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";
import { errorMessage, errorStatus } from "@/lib/errors";
import { formatDate, initial } from "@/lib/format";
import { i18n } from "@/lib/i18n";
import { buildProfileSchema, jsonLd, pageMeta } from "@/lib/seo";
import { siteOriginOf } from "@/lib/site";

interface Profile {
  user: UserProfile;
  lessons: LessonSummary[];
}

// A profile the API doesn't have is a 404, status and page both. Any other
// failure (the API down) is the page's to show, in the usual chrome.
export async function loader({ params }: Route.LoaderArgs) {
  if (!hasApi()) return { profile: null, error: "" };
  try {
    const profile: Profile = await fetchUserProfile(params.id);
    return { profile, error: "" };
  } catch (err) {
    if (errorStatus(err) === 404) throw data(null, { status: 404 });
    return {
      profile: null,
      error: errorMessage(err, i18n.t("profile:profilePage.profileLoadError")),
    };
  }
}

// ProfilePage markup: its Person is the @id the author on this person's
// lesson pages points at. The bio is rich-text HTML, but a meta description
// is plain text, so it is flattened to one truncated line.
export const meta: Route.MetaFunction = ({
  loaderData,
  location,
  matches,
  params,
}) => {
  const origin = siteOriginOf(matches);
  const profile = loaderData?.profile;
  const displayName =
    profile?.user.displayName || i18n.t("profile:profilePage.anonymousName");
  const bio = richTextToLine(profile?.user.bio ?? "");
  return [
    ...pageMeta({
      origin,
      pathname: location.pathname,
      title: profile
        ? displayName
        : i18n.t("profile:profilePage.documentTitle"),
      description: profile
        ? bio ||
          i18n.t("profile:profilePage.metaDescriptionFallback", {
            name: displayName,
          })
        : undefined,
    }),
    ...jsonLd(
      profile
        ? buildProfileSchema({
            id: params.id,
            name: displayName,
            description: bio,
            followerCount: profile.user.followerCount,
            followingCount: profile.user.followingCount,
            lessonCount: profile.lessons.length,
            origin,
          })
        : null,
    ),
  ];
};

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteErrorBoundary error={error} />;
}

// Keyed on the id, so moving from one profile to another (a follower's row
// in the dialog) starts the page over rather than showing the old person's
// state under the new one's name.
export default function ProfileRoute(props: Route.ComponentProps) {
  return <ProfilePage key={props.params.id} {...props} />;
}

function ProfilePage({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("profile");
  const id = params.id;
  const { user: me, accessToken, enabled } = useAuth();
  const isOwner = Boolean(me && me.id === id);

  const [profile, setProfile] = useState<UserProfile | null>(
    loaderData.profile?.user ?? null,
  );
  const [lessons, setLessons] = useState<LessonSummary[]>(
    loaderData.profile?.lessons ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(loaderData.error);
  const [bioOpen, setBioOpen] = useState(false);

  // Follow state. `followBusy` disables the button (and shows a spinner)
  // while a request is in flight; `followError` surfaces a failure. The
  // follow flag and counts live on `profile`, so a successful toggle patches
  // it (the server returns the fresh follower count).
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState("");
  // Which connections list the dialog is showing, or null when closed.
  const [followListTab, setFollowListTab] = useState<
    "followers" | "following" | null
  >(null);

  // Activity popover: lazily parsed from the user's Atom feed on first open.
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<FeedEntry[]>([]);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");

  const openActivity = () => {
    setActivityOpen(true);
    if (activityLoaded) return;
    setActivityLoaded(true);
    setActivityLoading(true);
    setActivityError("");
    fetchUserActivity(id)
      .then(setActivity)
      .catch((err) =>
        setActivityError(errorMessage(err, t("profilePage.activityLoadError"))),
      )
      .finally(() => setActivityLoading(false));
  };

  // `quiet` re-fetches underneath whatever is already on screen, instead of
  // clearing back to a skeleton: used to upgrade the server's anonymous
  // render to the signed-in view.
  const load = useCallback(
    (quiet = false) => {
      if (!id) return;
      if (!quiet) {
        setLoading(true);
        setError("");
      }
      // The token lets the server say whether *we* follow this profile.
      return fetchUserProfile(id, accessToken ?? undefined)
        .then(({ user, lessons }) => {
          setProfile(user);
          setLessons(lessons);
        })
        .catch((err) => {
          // A failed quiet re-fetch leaves the server-rendered profile alone
          // rather than replacing correct public content with an error.
          if (quiet) console.error("Profile re-fetch failed", err);
          else setError(errorMessage(err, t("profilePage.profileLoadError")));
        })
        .finally(() => setLoading(false));
    },
    [id, accessToken, t],
  );

  // The server renders anonymously, which is the complete public profile; a
  // signed-out visitor needs nothing more. A signed-in one re-fetches
  // quietly for the follow state. A page whose loader failed re-fetches
  // either way, so a retry has something to do.
  useEffect(() => {
    if (!hasApi()) return;
    if (loaderData.error) load(false);
    else if (accessToken) load(true);
  }, [load, accessToken, loaderData.error]);

  // Follow or unfollow this profile, then patch the local follow flag and
  // count from the server's response so the button and header update.
  const toggleFollow = async () => {
    if (!profile || followBusy || !accessToken) return;
    const next = !profile.isFollowing;
    setFollowBusy(true);
    setFollowError("");
    try {
      const { following, followerCount } = await setFollowing(
        id,
        next,
        accessToken,
      );
      setProfile((p) =>
        p ? { ...p, isFollowing: following, followerCount } : p,
      );
    } catch (err) {
      setFollowError(errorMessage(err, t("profilePage.followUpdateError")));
    } finally {
      setFollowBusy(false);
    }
  };

  // The Follow control shows only to a signed-in user viewing someone else.
  const canFollow = Boolean(enabled && me && !isOwner);

  const displayName = profile?.displayName || t("profilePage.anonymousName");
  const bio = profile?.bio || "";
  const followerCount = profile?.followerCount ?? 0;
  const followingCount = profile?.followingCount ?? 0;

  const feedUrl = userFeedUrl(id);

  return (
    <>
      {/* No PageBar: the body's own header (avatar, name, counts) is the
          page title. */}
      <PageBody>
        {loading ? (
          <>
            {/* Header placeholder: avatar plus name and bio lines, then the
                lessons list. */}
            <div className="mb-8 flex items-center gap-4">
              <Skeleton className="size-14 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-6 w-[40%]" />
                <Skeleton className="mt-2 h-4 w-[60%]" />
              </div>
            </div>
            <LessonListSkeleton count={3} />
          </>
        ) : error || !profile ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              {error || t("profilePage.profileLoadError")}
              <Button variant="ghost" size="sm" onClick={() => load(false)}>
                {t("profilePage.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Profile header: avatar, display name, follower and following
                counts, the Follow button, and the Activity and RSS buttons. */}
            <div className="mb-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Avatar className="size-14 shrink-0">
                <AvatarFallback className="text-xl">
                  {initial(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-semibold">
                  {displayName}
                </h1>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-sm text-muted-foreground">
                    {t("profilePage.publishedLessonCount", {
                      count: lessons.length,
                    })}
                  </p>
                  {/* Counts open the connections dialog on the matching tab. */}
                  <button
                    type="button"
                    onClick={() => setFollowListTab("followers")}
                    className="cursor-pointer border-0 bg-transparent p-0 text-sm text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {t("profilePage.followerCount", { count: followerCount })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFollowListTab("following")}
                    className="cursor-pointer border-0 bg-transparent p-0 text-sm text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {t("profilePage.followingCount", {
                      count: followingCount,
                    })}
                  </button>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canFollow && (
                  <Button
                    variant={profile.isFollowing ? "outline" : "default"}
                    size="sm"
                    onClick={toggleFollow}
                    disabled={followBusy}
                  >
                    {followBusy ? (
                      <Spinner data-icon="inline-start" />
                    ) : profile.isFollowing ? (
                      <UserCheckIcon data-icon="inline-start" />
                    ) : (
                      <UserPlusIcon data-icon="inline-start" />
                    )}
                    {profile.isFollowing
                      ? t("profilePage.followingButton")
                      : t("profilePage.followButton")}
                  </Button>
                )}
                {feedUrl && (
                  <>
                    <Popover open={activityOpen} onOpenChange={setActivityOpen}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={openActivity}
                            >
                              <HistoryIcon data-icon="inline-start" />
                              {t("profilePage.activityButton")}
                            </Button>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("profilePage.activityTooltip")}
                        </TooltipContent>
                      </Tooltip>
                      <PopoverContent
                        align="end"
                        className="max-h-[360px] w-[340px] max-w-[90vw] overflow-y-auto p-2"
                      >
                        {activityLoading ? (
                          <div className="flex flex-col gap-3 px-2 py-1">
                            {Array.from({ length: 4 }, (_, i) => (
                              <div key={i}>
                                <Skeleton className="h-4 w-[70%]" />
                                <Skeleton className="mt-2 h-4 w-[40%]" />
                              </div>
                            ))}
                          </div>
                        ) : activityError ? (
                          <p className="px-2 py-1.5 text-sm text-destructive">
                            {activityError}
                          </p>
                        ) : activity.length === 0 ? (
                          <p className="px-2 py-1.5 text-sm text-muted-foreground">
                            {t("profilePage.noRecentActivity")}
                          </p>
                        ) : (
                          <div className="flex flex-col">
                            {activity.map((item) => (
                              <a
                                key={item.id}
                                href={item.link}
                                onClick={() => setActivityOpen(false)}
                                className="rounded-sm border-0 bg-transparent px-2 py-1.5 text-left no-underline transition-colors hover:bg-accent"
                              >
                                <p className="truncate text-sm font-medium text-foreground">
                                  {item.title}
                                </p>
                                {(item.summary || item.updated) && (
                                  <p className="line-clamp-2 text-xs text-muted-foreground">
                                    {[item.summary, formatDate(item.updated)]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                              </a>
                            ))}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={feedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="no-underline"
                          >
                            <RssIcon data-icon="inline-start" />
                            {t("profilePage.rssButton")}
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("profilePage.rssTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
            {followError && (
              <Alert variant="destructive" className="relative mb-2 pr-9">
                <AlertDescription>{followError}</AlertDescription>
                <button
                  type="button"
                  onClick={() => setFollowError("")}
                  aria-label={t("profilePage.dismiss")}
                  className="absolute top-3 right-3 cursor-pointer rounded-sm border-0 bg-transparent p-0.5 text-current opacity-70 transition-opacity hover:opacity-100"
                >
                  <XIcon className="size-3.5" />
                </button>
              </Alert>
            )}

            {/* Bio. The owner can edit it (or add one when empty). */}
            <div className="mb-8">
              {bio ? (
                <div className="flex items-start gap-1">
                  <RichText value={bio} variant="body1" className="flex-1" />
                  {isOwner && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("profilePage.editBioAriaLabel")}
                          onClick={() => setBioOpen(true)}
                        >
                          <PencilIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("profilePage.editBioTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ) : isOwner ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBioOpen(true)}
                >
                  <PencilIcon data-icon="inline-start" />
                  {t("profilePage.addBioButton")}
                </Button>
              ) : null}
            </div>

            {lessons.length === 0 ? (
              <>
                <h2 className="mb-3 text-lg font-semibold">
                  {t("profilePage.publishedLessonsHeading")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("profilePage.noLessonsYet", { name: displayName })}
                </p>
              </>
            ) : (
              // The same bordered box the hub draws its listings in, heading
              // and count on the strip: a profile's lessons and the hub's
              // are the same thing seen from two places.
              <div className="overflow-hidden rounded-panel border border-border bg-card">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-muted px-4 py-2.5">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    {t("profilePage.publishedLessonsHeading")}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {t("profilePage.lessonCount", { count: lessons.length })}
                  </span>
                </div>
                <div className="flex flex-col divide-y divide-border">
                  {lessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                    >
                      <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/hub/${lesson.id}`}
                          className="truncate text-sm font-semibold text-foreground no-underline hover:underline"
                        >
                          {lesson.title || t("profilePage.untitledLesson")}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {typeof lesson.sectionCount === "number"
                            ? t("profilePage.sectionCount", {
                                count: lesson.sectionCount,
                              })
                            : ""}
                          {lesson.createdAt
                            ? ` · ${formatDate(lesson.createdAt)}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </PageBody>

      {isOwner && (
        <BioDialog
          open={bioOpen}
          initial={bio}
          onClose={() => setBioOpen(false)}
          onSaved={(saved) => setProfile((p) => (p ? { ...p, bio: saved } : p))}
        />
      )}

      <FollowListDialog
        open={Boolean(followListTab)}
        userId={id}
        displayName={displayName}
        initialTab={followListTab || "followers"}
        onClose={() => setFollowListTab(null)}
      />
    </>
  );
}
