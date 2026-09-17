// opencascade.js ships no type declarations, and its embind API shape is only fully knowable
// at runtime (see src/io/step.ts for why we treat it as `any` there).
declare module 'opencascade.js/dist/opencascade.wasm.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initOpenCascade: (opts?: { locateFile?: (path: string) => string }) => Promise<any>;
  export default initOpenCascade;
}

declare module 'opencascade.js/dist/opencascade.wasm.wasm?url' {
  const url: string;
  export default url;
}
