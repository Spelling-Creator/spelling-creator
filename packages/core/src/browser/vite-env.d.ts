// Only Vite loads browser/, and a few modules here import an asset with its
// `?url` suffix (the speech rule engine's rule files, espeak-ng's wasm and
// data), which Vite turns into the URL the asset is served at.
declare module "*?url" {
  const url: string;
  export default url;
}
