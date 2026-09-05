/**
 * Credential resolution for the native ServiceNow engine (NATIVE_ENGINE_BRIEF
 * Phase 3). An `Instance` row carries an opaque `credentialRef` — never a
 * secret. This module turns that ref into concrete credentials, read from
 * environment variables for now. The `CredentialProvider` interface is shaped
 * so a Vault / Key Vault provider drops in later without touching callers.
 */

export type SnowCredential =
  | { mode: "basic"; username: string; password: string }
  | { mode: "oauth_cc"; clientId: string; clientSecret: string; tokenUrl?: string };

export interface CredentialProvider {
  /** Resolve a credentialRef to concrete credentials, or throw with the names
   *  of the env vars / secret keys it expected. */
  resolve(ref: string): SnowCredential;
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

/**
 * Resolves refs against `process.env`:
 *  - `env:USER_VAR,PASS_VAR`  → basic auth from those two vars
 *  - `<ref>` (bare)           → `SNOW_CRED_<REF>_CLIENT_ID` + `_CLIENT_SECRET`
 *                               (+ optional `_TOKEN_URL`) for oauth_cc, else
 *                               `SNOW_CRED_<REF>_USERNAME` + `_PASSWORD` for basic
 */
export class EnvCredentialProvider implements CredentialProvider {
  resolve(ref: string): SnowCredential {
    if (ref.startsWith("env:")) {
      const [userVar, passVar] = ref.slice(4).split(",").map((s) => s.trim());
      if (!userVar || !passVar) {
        throw new Error(`credentialRef "${ref}" — expected "env:USER_VAR,PASS_VAR"`);
      }
      return { mode: "basic", username: reqEnv(userVar), password: reqEnv(passVar) };
    }

    const R = ref.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    if (process.env[`SNOW_CRED_${R}_CLIENT_ID`]) {
      return {
        mode: "oauth_cc",
        clientId: reqEnv(`SNOW_CRED_${R}_CLIENT_ID`),
        clientSecret: reqEnv(`SNOW_CRED_${R}_CLIENT_SECRET`),
        tokenUrl: process.env[`SNOW_CRED_${R}_TOKEN_URL`] || undefined,
      };
    }
    if (process.env[`SNOW_CRED_${R}_USERNAME`]) {
      return {
        mode: "basic",
        username: reqEnv(`SNOW_CRED_${R}_USERNAME`),
        password: reqEnv(`SNOW_CRED_${R}_PASSWORD`),
      };
    }
    throw new Error(
      `credentialRef "${ref}" — no matching env vars ` +
        `(SNOW_CRED_${R}_CLIENT_ID/_CLIENT_SECRET, SNOW_CRED_${R}_USERNAME/_PASSWORD, or env:VAR,VAR)`,
    );
  }
}

export const credentials: CredentialProvider = new EnvCredentialProvider();
