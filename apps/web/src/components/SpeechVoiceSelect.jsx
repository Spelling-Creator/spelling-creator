// The read-aloud voice picker, shared by the voice popover in practice mode and
// the Reading aloud section of the settings page, which set the same
// preference (lib/speechPrefs.js).
//
// Natural voices (Kokoro) are listed first when the device can run them, as
// they are the better voices; the browser's own follow. Picking a natural one
// says what it costs, because the first use downloads the model.

import { useTranslation } from "react-i18next";
import { DOWNLOAD_MB } from "@spelling-creator/core/browser/readAloud";
import { FieldDescription } from "./ui/field.jsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select.jsx";
import { naturalVoiceId } from "../lib/speechPrefs.js";

/**
 * @param {object} props
 * @param {string} props.id  For the field's label.
 * @param {string} props.voiceURI  The stored choice; "" is the browser default.
 * @param {(uri: string) => void} props.onVoiceURIChange
 * @param {SpeechSynthesisVoice[]} props.voices  The browser's voices.
 * @param {{ voiceURI: string, name: string, lang: string }[]} props.naturalVoices
 * @param {string} [props.className]  For the trigger.
 */
export function SpeechVoiceSelect({
  id,
  voiceURI,
  onVoiceURIChange,
  voices,
  naturalVoices,
  className,
}) {
  const { t } = useTranslation("common");
  const natural = naturalVoices.length > 0 && naturalVoiceId(voiceURI) !== null;
  // A stored voice that isn't on offer here shows as the browser default,
  // since that's what reads: a natural voice before the device check answers
  // or after it fails (a metered connection, say), or a browser voice this
  // browser doesn't have. Left as is, it would match no item and the trigger
  // would show nothing at all. The stored choice is kept either way.
  const offered =
    naturalVoices.some((voice) => voice.voiceURI === voiceURI) ||
    voices.some((voice) => voice.voiceURI === voiceURI);

  return (
    <>
      <Select
        value={voiceURI && offered ? voiceURI : "default"}
        onValueChange={(next) =>
          onVoiceURIChange(next === "default" ? "" : next)
        }
      >
        <SelectTrigger id={id} className={className}>
          <SelectValue placeholder={t("speechVoice.defaultVoice")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            {t("speechVoice.defaultVoice")}
          </SelectItem>
          {naturalVoices.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t("speechVoice.naturalVoices")}</SelectLabel>
              {naturalVoices.map((voice) => (
                <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {voices.length > 0 && (
            <SelectGroup>
              {naturalVoices.length > 0 && (
                <SelectLabel>{t("speechVoice.browserVoices")}</SelectLabel>
              )}
              {voices.map((voice) => (
                <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {natural && (
        <FieldDescription>
          {t("speechVoice.naturalNote", { mb: DOWNLOAD_MB })}
        </FieldDescription>
      )}
    </>
  );
}
