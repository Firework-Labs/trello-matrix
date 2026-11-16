/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRELLO_CLIENT_ID?: string;
  readonly VITE_PROOF?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
