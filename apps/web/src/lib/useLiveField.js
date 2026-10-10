import { useEffect, useRef, useState } from "react";

// Shared debounce/commit logic behind LiveInput/LiveTextarea (LiveField.jsx).
// Typing updates local state immediately (so the field never feels laggy)
// and commits upstream ~200ms after the user pauses, rather than on every
// keystroke — collaborative editing broadcasts the committed value to other
// participants, and committing per-keystroke would flood that channel. While
// focused, incoming `value` updates (e.g. a remote edit arriving mid-type)
// are held off so they can't clobber what's being typed; they apply once the
// field blurs. Blurring only commits if something was typed, so focusing a
// field and leaving it never writes a stale value over a remote edit that
// arrived in between; it catches up with that edit instead. Returns the value the input should display plus change/focus/
// blur handlers; callers wire those onto whatever input element they're using.
//
// `waitForBlur(next)`, when given, picks out values that are only committed
// once the field is left, never on a pause in typing. The image credit uses it
// for an empty value: clearing the field to retype it isn't a deletion, and
// the deletion it asks to confirm shouldn't interrupt someone mid-edit.
export function useLiveField(
  value,
  onCommit,
  commitDelay = 200,
  { waitForBlur } = {},
) {
  const [local, setLocal] = useState(value ?? "");
  const focusedRef = useRef(false);
  // Typed since the last commit. Only typing sets it.
  const dirtyRef = useRef(false);
  // A new value arrived while focused and was held off.
  const heldRef = useRef(false);
  const valueRef = useRef(value);
  const timerRef = useRef(null);

  useEffect(() => {
    valueRef.current = value;
    if (!focusedRef.current) setLocal(value ?? "");
    else heldRef.current = true;
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const commit = (next) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    if (next !== (value ?? "")) onCommit(next);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setLocal(next);
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (waitForBlur?.(next)) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      if (next !== (value ?? "")) onCommit(next);
    }, commitDelay);
  };

  const handleFocus = () => {
    focusedRef.current = true;
  };

  const handleBlur = () => {
    focusedRef.current = false;
    if (dirtyRef.current) commit(local);
    else if (heldRef.current) setLocal(valueRef.current ?? "");
    heldRef.current = false;
  };

  return { local, handleChange, handleFocus, handleBlur };
}
