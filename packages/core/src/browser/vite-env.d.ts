// Only Vite loads browser/, and a few modules here lean on what it adds to
// JavaScript. Core doesn't depend on Vite (only the app that bundles it does),
// so vite/client isn't here to reference, and these are the pieces in use.

// An asset imported with its `?url` suffix (the speech rule engine's rule
// files, espeak-ng's wasm and data) is the URL Vite serves it at.
declare module "*?url" {
  const url: string;
  export default url;
}

interface ImportMeta {
  /** Vite's glob import: each matching module's path, and a loader for it. */
  glob<M = unknown>(
    pattern: string | string[],
  ): Record<string, () => Promise<M>>;
}
