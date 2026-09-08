// Settings at /settings — the home for the preferences that had nowhere to
// live.
//
// Three of the four sections here are about *this browser*, not about an
// account: they work signed out, they're stored in localStorage, and they need
// no network. That is why the page is not gated on a session, and why it stays
// out of vite.config.js's WORKER_PATHS — the service worker serves it from the
// precached shell, so it works offline, which is right for a page whose
// contents are all local anyway.
//
// It also finishes two controls that were only half-exposed:
//
//   Theme. lib/colorScheme.jsx has always supported "system", but the only UI
//   was the sidebar's light/dark toggle — so once you touched it there was no
//   way back to following the OS. The three-way choice lives here; the sidebar
//   keeps its toggle, which is a one-click convenience rather than the whole
//   control.
//
//   Language. lib/languages.js has listed the UI's languages since i18n went
//   in and nothing rendered it. This is the switcher the internationalization
//   docs describe.
//
// The account section is deliberately thin: it shows what other people see and
// hands off to the same dialogs the rest of the app uses (DisplayNameDialog,
// BioDialog), rather than growing a second way to edit the same two fields. It
// reads the bio straight out of the session — the Worker stores it in
// user_metadata, and BioDialog refreshes the session on save — so nothing here
// fetches.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  ExternalLinkIcon,
  LibraryIcon,
  LogOutIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import PageBar from "../components/layout/PageBar.jsx";
import PageBody from "../components/layout/PageBody.jsx";
import { Button, buttonVariants } from "../components/ui/button.jsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "../components/ui/field.jsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.jsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../components/ui/toggle-group.jsx";
import { ListRowsSkeleton } from "../components/Skeletons.jsx";
import DisplayNameDialog from "../components/DisplayNameDialog.jsx";
import BioDialog from "../components/BioDialog.jsx";
import InstallAppButton from "../components/InstallAppButton.jsx";
import RichText from "../components/RichText.jsx";
import { useAuth } from "../lib/auth.jsx";
import { useColorScheme } from "../lib/colorScheme.jsx";
import { LANGUAGES, DEFAULT_LANGUAGE } from "../lib/languages.js";
import {
  SPEECH_RATES,
  useSpeechPrefs,
  useSpeechVoices,
} from "../lib/speechPrefs.js";
import { useInstallPrompt } from "../lib/useInstallPrompt.js";

// A titled card, one per group of settings. Same shape as ModerationPage's — the
// two pages are the app's only dashboards, and they should look like each other.
function Section({ title, children }) {
  return (
    <section className="rounded-panel border border-border bg-card p-5 text-card-foreground">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// Theme. The value here is the *choice* ("system" included), not the resolved
// light/dark — picking "System" and picking whichever one the OS happens to be
// on are different answers, and only one of them keeps tracking.
function AppearanceSection() {
  const { t } = useTranslation("settings");
  const { scheme, setScheme } = useColorScheme();

  return (
    <Section title={t("appearance.title")}>
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle id="theme-label">
              {t("appearance.themeLabel")}
            </FieldTitle>
            <FieldDescription>
              {t("appearance.themeDescription")}
            </FieldDescription>
          </FieldContent>
          <ToggleGroup
            aria-labelledby="theme-label"
            type="single"
            variant="outline"
            value={scheme}
            // A toggle group hands back "" when you press the item that's
            // already on, which would mean "no theme". Ignore it: this is a
            // choice between three, not three independent switches.
            onValueChange={(next) => next && setScheme(next)}
          >
            <ToggleGroupItem value="light">
              {t("appearance.light")}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              {t("appearance.dark")}
            </ToggleGroupItem>
            <ToggleGroupItem value="system">
              {t("appearance.system")}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </FieldGroup>
    </Section>
  );
}

// The UI language, from the registry in lib/languages.js. Today that registry
// holds one entry, so the select is disabled and says so rather than pretending
// to be a choice — adding a locale (see docs/web-app/internationalization.md)
// turns it into one with no change here.
function LanguageSection() {
  const { t, i18n } = useTranslation("settings");
  const onlyOne = LANGUAGES.length < 2;

  return (
    <Section title={t("language.title")}>
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor="language">{t("language.label")}</FieldLabel>
            <FieldDescription>
              {onlyOne ? t("language.onlyOne") : t("language.description")}
            </FieldDescription>
          </FieldContent>
          <Select
            value={i18n.resolvedLanguage || DEFAULT_LANGUAGE}
            disabled={onlyOne}
            // i18next's LanguageDetector is configured to cache into
            // localStorage (lib/i18n.js), so the choice persists itself.
            onValueChange={(next) => i18n.changeLanguage(next)}
          >
            <SelectTrigger id="language" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.code} value={language.code}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </Section>
  );
}

// Read-aloud, the same three preferences the popover in practice mode sets — see
// lib/speechPrefs.js, which both share. The section is absent entirely on a
// browser with no speech synthesis, for the reason SpeechControls gives: a
// reader who can't have the feature is better off never learning it exists than
// finding a dead control.
//
// `supported` is false until the probe runs after mount, so this appears a beat
// into the page rather than being there on the first frame. That's the same
// hydration-safety trade every persisted preference in the app makes.
function SpeechSection() {
  const { t } = useTranslation("settings");
  const { supported, voices } = useSpeechVoices();
  const { enabled, setEnabled, voiceURI, setVoiceURI, rate, setRate } =
    useSpeechPrefs();

  if (!supported) return null;

  return (
    <Section title={t("speech.title")}>
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle id="tts-enabled-label">
              {t("speech.enabledLabel")}
            </FieldTitle>
            <FieldDescription>{t("speech.description")}</FieldDescription>
          </FieldContent>
          <ToggleGroup
            aria-labelledby="tts-enabled-label"
            type="single"
            variant="outline"
            value={enabled ? "on" : "off"}
            onValueChange={(next) => next && setEnabled(next === "on")}
          >
            <ToggleGroupItem value="on">
              <Volume2Icon />
              {t("speech.on")}
            </ToggleGroupItem>
            <ToggleGroupItem value="off">
              <VolumeXIcon />
              {t("speech.off")}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        {/* Voice and pace only matter once something is going to be spoken. */}
        {enabled && (
          <>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="tts-voice">{t("speech.voice")}</FieldLabel>
              </FieldContent>
              <Select
                value={voiceURI || "default"}
                onValueChange={(next) =>
                  setVoiceURI(next === "default" ? "" : next)
                }
              >
                <SelectTrigger id="tts-voice" className="w-full sm:w-72">
                  <SelectValue placeholder={t("speech.defaultVoice")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    {t("speech.defaultVoice")}
                  </SelectItem>
                  {voices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle id="tts-pace-label">{t("speech.pace")}</FieldTitle>
              </FieldContent>
              <ToggleGroup
                aria-labelledby="tts-pace-label"
                type="single"
                variant="outline"
                value={String(rate)}
                onValueChange={(next) => next && setRate(Number(next))}
              >
                {SPEECH_RATES.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={String(option)}
                    // `count` picks the plural form, so 1× reads "Normal speed"
                    // rather than "1 times normal speed".
                    aria-label={t("speech.paceOption", {
                      count: option,
                      rate: option,
                    })}
                  >
                    {option}×
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          </>
        )}
      </FieldGroup>
    </Section>
  );
}

// What this browser holds, and what it could hold. The install row is absent
// unless the app is actually installable — InstallAppButton returns null
// otherwise — so the section can end up as just the lessons row.
function DeviceSection() {
  const { t } = useTranslation("settings");
  const { canInstall } = useInstallPrompt();

  return (
    <Section title={t("device.title")}>
      <FieldGroup>
        {canInstall && (
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>{t("device.installLabel")}</FieldTitle>
              <FieldDescription>
                {t("device.installDescription")}
              </FieldDescription>
            </FieldContent>
            <InstallAppButton
              className={buttonVariants({ variant: "outline" })}
              label={t("device.install")}
            />
          </Field>
        )}

        {/* A link to the editor's library panel rather than a copy of it: the
            editor rewrites a lesson's title as it's typed, and a second list of
            the same titles here would spend its life one keystroke behind. */}
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{t("device.lessonsLabel")}</FieldTitle>
            <FieldDescription>
              {t("device.lessonsDescription")}
            </FieldDescription>
          </FieldContent>
          <Button asChild variant="outline">
            <RouterLink to="/editor/lessons" className="no-underline">
              <LibraryIcon />
              {t("device.manageLessons")}
            </RouterLink>
          </Button>
        </Field>
      </FieldGroup>
    </Section>
  );
}

// Identity, for the people who have one. Every field here is edited through the
// dialog that already owns it, so validation, profanity checks and the session
// refresh after a save all stay in one place.
function AccountSection() {
  const { t } = useTranslation("settings");
  const { loading, user, displayName, signOut } = useAuth();
  const [nameOpen, setNameOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);

  // Straight from the session: the Worker writes the bio into user_metadata
  // (apps/api/src/routes/profile.js) and BioDialog refreshes the session after
  // saving, so this updates without a refetch.
  const bio = (user?.user_metadata?.bio || "").trim();

  if (loading) {
    // A skeleton, not a spinner — the section's real shape, held until the
    // session is restored.
    return (
      <Section title={t("account.title")}>
        <ListRowsSkeleton count={3} />
      </Section>
    );
  }

  if (!user) {
    return (
      <Section title={t("account.title")}>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>{t("account.signedOutTitle")}</FieldTitle>
              <FieldDescription>
                {t("account.signedOutDescription")}
              </FieldDescription>
            </FieldContent>
            <Button asChild>
              <RouterLink to="/login" className="no-underline">
                {t("account.signIn")}
              </RouterLink>
            </Button>
          </Field>
        </FieldGroup>
      </Section>
    );
  }

  return (
    <Section title={t("account.title")}>
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{t("account.displayName")}</FieldTitle>
            <FieldDescription>
              {displayName || t("account.displayNameNotSet")}
            </FieldDescription>
          </FieldContent>
          <Button variant="outline" onClick={() => setNameOpen(true)}>
            {t("account.change")}
          </Button>
        </Field>

        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{t("account.bio")}</FieldTitle>
            {/* Rich text, so it renders through RichText — never as raw HTML. */}
            {bio ? (
              <RichText value={bio} className="text-muted-foreground" />
            ) : (
              <FieldDescription>{t("account.bioEmpty")}</FieldDescription>
            )}
          </FieldContent>
          <Button variant="outline" onClick={() => setBioOpen(true)}>
            {t("account.edit")}
          </Button>
        </Field>

        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{t("account.email")}</FieldTitle>
            <FieldDescription className="break-all">
              {user.email}
            </FieldDescription>
          </FieldContent>
          <Button asChild variant="outline">
            <RouterLink to={`/users/${user.id}`} className="no-underline">
              <ExternalLinkIcon />
              {t("account.viewProfile")}
            </RouterLink>
          </Button>
        </Field>
      </FieldGroup>

      {/* Outside the field group: signing out is an action on the account, not
          a setting with a value, and a Field with nothing on its label side is
          an empty group to a screen reader. */}
      <div className="mt-7 flex justify-end border-t border-border pt-5">
        <Button variant="outline" onClick={signOut}>
          <LogOutIcon />
          {t("account.signOut")}
        </Button>
      </div>

      <DisplayNameDialog open={nameOpen} onClose={() => setNameOpen(false)} />
      <BioDialog
        open={bioOpen}
        initial={bio}
        onClose={() => setBioOpen(false)}
      />
    </Section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  // `enabled` is "is auth configured at all" — a build with no Supabase has no
  // account to show, and the section is absent rather than empty.
  const { enabled } = useAuth();

  return (
    <>
      <PageBar crumbs={[{ label: t("title") }]} />
      {/* "reading", not the default "wide": this is a stack of one label and one
          control each, and at 64rem a row leaves its label stranded a long way
          from the thing it names. */}
      <PageBody width="reading">
        <p className="mb-6 text-sm text-muted-foreground">{t("subtitle")}</p>
        <div className="flex flex-col gap-6">
          <AppearanceSection />
          <LanguageSection />
          <SpeechSection />
          <DeviceSection />
          {enabled && <AccountSection />}
        </div>
      </PageBody>
    </>
  );
}
