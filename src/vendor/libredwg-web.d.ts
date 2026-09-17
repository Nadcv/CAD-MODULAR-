// Type declaration for the vendored libredwg-web.js (see that file's header comment). No types
// are shipped upstream, and the wasm module's shape is only knowable at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function createModule(opts?: { locateFile?: (path: string) => string }): Promise<any>;
export default createModule;
