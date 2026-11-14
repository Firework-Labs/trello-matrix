/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRELLO_APP_KEY?: string;
  readonly VITE_PROOF?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
