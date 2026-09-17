declare module 'occt-import-js/dist/occt-import-js.js' {
  const initOcctImportJs: (opts?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default initOcctImportJs;
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
