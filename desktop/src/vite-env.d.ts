/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Publikt förval för backendens bas-URL. Ingen hemlighet. */
  readonly BERRYIT_PUBLIC_BACKEND_URL?: string;
  /** Publik anon-nyckel. Ingen hemlighet – RLS avgör åtkomst. */
  readonly BERRYIT_PUBLIC_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
