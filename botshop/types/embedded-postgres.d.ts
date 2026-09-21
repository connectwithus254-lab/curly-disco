/**
 * Minimal type declaration for the `embedded-postgres` package (no bundled types).
 * We only use the tiny surface below.
 */
declare module 'embedded-postgres' {
  export interface EmbeddedPostgresOptions {
    databaseDir: string;
    user?: string;
    password?: string;
    port?: number;
    persistent?: boolean;
    initdbFlags?: string[];
    createPostgresUser?: boolean;
  }
  export default class EmbeddedPostgres {
    constructor(options: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
  }
}
