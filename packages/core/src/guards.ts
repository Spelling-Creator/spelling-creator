// Type guards for reading untrusted values: a parsed file, a model's reply, a
// stored block from an older version. Internal to core, so each module asks the
// same question the same way rather than writing its own.

// What an object check narrows a value to: fields to read off a value whose
// type says nothing more (`unknown`, a bare `object`), or else the object
// members of the type it has (so a `string | OslfTextRun` stays an
// OslfTextRun, not a bag of unknowns).
type ObjectPart<T> = unknown extends T
  ? Record<string, unknown>
  : object extends Extract<T, object>
    ? Record<string, unknown>
    : Extract<T, object>;

/** An object to read fields off: not null, and not an array. */
export function isRecord<T>(value: T): value is ObjectPart<T> & T {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Anything `typeof` calls an object, arrays included. The check the
 * normalizers have always made before reading fields, so an array gets past it
 * and is then turned away for the fields it lacks. Prefer isRecord in new code.
 */
export function isObjectLike<T>(value: T): value is ObjectPart<T> & T {
  return Boolean(value) && typeof value === "object";
}

/**
 * `map[key]`, for one of the map's own keys only. A plain lookup with a key
 * from a file, a stored lesson or a model's reply also finds what every object
 * inherits ("constructor", "toString"), and hands back a function where the
 * caller expected one of its entries.
 */
export function ownValue<V>(
  map: Readonly<Partial<Record<string, V>>>,
  key: unknown,
): V | undefined {
  return typeof key === "string" && Object.hasOwn(map, key)
    ? map[key]
    : undefined;
}

/** An error's `name` ("AbortError" and the like), if it has one. */
export function errorName(err: unknown): unknown {
  return isObjectLike(err) ? err.name : undefined;
}
