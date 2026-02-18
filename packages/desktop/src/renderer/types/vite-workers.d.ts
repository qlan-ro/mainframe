// Vite ?worker import suffix — returns a Worker constructor
declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
