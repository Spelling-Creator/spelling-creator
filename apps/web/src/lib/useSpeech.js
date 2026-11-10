// Text-to-speech for interactive mode, as React sees it.
//
// The speaking itself (the browser's voice over the Web Speech API, the
// natural voice through Web Audio, the download and the fallbacks between
// them) is createSpeechPlayer in @spelling-creator/core/browser/speechPlayer,
// which knows nothing about React and remembers no preference. What is left
// here is the wiring: the preferences and the voice lists (lib/speechPrefs.js,
// shared with the settings page), one player per walkthrough configured from
// them, its snapshot read as state, and the player disposed of with the
// component. See apps/docs/docs/developers/web-app/interactive-mode.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSpeechPlayer } from "@spelling-creator/core/browser/speechPlayer";
import { useStore } from "./useStore.js";
import {
  naturalVoiceId,
  useNaturalVoices,
  useSpeechPrefs,
  useSpeechVoices,
} from "./speechPrefs.js";

/**
 * @typedef {import("@spelling-creator/core/speech").SpeechScript} Script
 */

/**
 * Speech for the current browser, with the user's remembered preferences.
 *
 * `voiceLoad` describes the natural voice when one is chosen (see VoiceLoad in
 * core/browser/speechPlayer), and `voiceProgress` is the download's progress
 * as a store for useSyncExternalStore, so that ticking doesn't re-render
 * whatever holds this object.
 *
 * What `speak` and `prepare` take is what speechLines in core/speech.ts does:
 * a string, one idea per line, or a list of lines that are each a string or
 * spoken runs.
 *
 * @returns {{
 *   supported: boolean,
 *   enabled: boolean, setEnabled: (on: boolean) => void,
 *   speaking: boolean,
 *   speak: (script: Script) => void,
 *   prepare: (script: Script) => void,
 *   stop: () => void,
 *   voices: SpeechSynthesisVoice[],
 *   naturalVoices: { voiceURI: string, name: string, lang: string }[],
 *   voiceURI: string, setVoiceURI: (uri: string) => void,
 *   rate: number, setRate: (rate: number) => void,
 *   voiceLoad: import("@spelling-creator/core/browser/speechPlayer").VoiceLoad | null,
 *   voiceProgress: { get: () => number, subscribe: (listener: () => void) => () => void },
 * }}
 */
export function useSpeech() {
  // Both probed/adopted in effects rather than at render: the server has no
  // `window`, and a hydrating client has to render the same markup the server
  // sent. See lib/speechPrefs.js.
  const { supported, voices } = useSpeechVoices();
  const naturalVoices = useNaturalVoices();
  const {
    enabled,
    setEnabled: persistEnabled,
    voiceURI,
    setVoiceURI,
    rate,
    setRate,
  } = useSpeechPrefs();

  // The natural voice is used only once the device check has passed: a stored
  // choice from before a connection turned metered stays stored, but the
  // browser's voice reads until the check passes again.
  const naturalId = naturalVoices.length > 0 ? naturalVoiceId(voiceURI) : null;

  const [player] = useState(() => createSpeechPlayer());
  useEffect(() => {
    player.configure({ voiceURI, naturalId, rate, enabled });
  }, [player, voiceURI, naturalId, rate, enabled]);

  // Leaving the page mid-sentence should not leave a voice talking over
  // whatever the user does next.
  useEffect(() => () => player.dispose(), [player]);

  // Turning speech off has to silence what is already in the queue, not just
  // stop the next step from speaking. That is the one thing the bare
  // preference setter can't do, and the reason it's wrapped here.
  const setEnabled = useCallback(
    (next) => {
      persistEnabled(next);
      if (!next) player.stop();
    },
    [persistEnabled, player],
  );

  const { speaking, load } = useStore(player);
  const voiceLoad = naturalId ? load : null;
  const voiceProgress = useMemo(
    () => ({
      get: player.progress.getSnapshot,
      subscribe: player.progress.subscribe,
    }),
    [player],
  );

  return useMemo(
    () => ({
      supported,
      enabled,
      setEnabled,
      speaking,
      speak: player.speak,
      prepare: player.prepare,
      stop: player.stop,
      voices,
      naturalVoices,
      voiceURI,
      setVoiceURI,
      rate,
      setRate,
      voiceLoad,
      voiceProgress,
    }),
    [
      supported,
      enabled,
      setEnabled,
      speaking,
      player,
      voices,
      naturalVoices,
      voiceURI,
      setVoiceURI,
      rate,
      setRate,
      voiceLoad,
      voiceProgress,
    ],
  );
}
