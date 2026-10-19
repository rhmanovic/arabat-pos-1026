// The asm.js build of sql.js (pure JavaScript, no .wasm file to locate): same API as the default.
declare module 'sql.js/dist/sql-asm.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
