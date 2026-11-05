# Restoring OpenAI quota status in OpenCode v2

Researched 2026-09-06 against OpenCode source revision `5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da`. This note distinguishes source-supported behavior from the proposed MyStatus implementation. No credentials were read for this research.

## Finding

OpenCode v2 still exposes OAuth credentials to **server plugins**, through `ctx.integration.connection.active("openai")` followed by `ctx.integration.connection.resolve(connection)`. The Promise SDK types explicitly return `Credential.Value | undefined`. This is the same connection resolution path used by OpenCode's built-in OpenAI provider. A TUI plugin has a different context and does not have this server-only integration interface. [Server integration SDK](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/plugin/src/promise/integration.ts#L77), [built-in OpenAI provider](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/plugin/provider/openai.ts#L237), [TUI context](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/plugin/src/tui/context.ts#L478).

The legacy `auth.json` file is no longer the source of truth. A database migration imports its records into the `credential` table and maps legacy `accountId` to OAuth `metadata.accountID`. The current credential service reads and updates that table. The migration reads the old file but does not maintain it as a live mirror. Consequently, its continued presence does not establish that its access or refresh token is current. [Legacy import](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts), [credential service](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/credential.ts).

## Recommended implementation

1. Add a v2 server plugin entrypoint that resolves the active OpenAI credential through the host integration interface.
2. If that credential is OAuth, pass its access token and `metadata.accountID` to the existing OpenAI usage query inside the server process. If the host returns no connection or an API key, report the corresponding unavailable/unsupported status without using an old OAuth file as fallback.
3. Register a narrow quota RPC using `ctx.rpc.register`. Return the existing sanitized quota/result representation, never access tokens or refresh tokens. The TUI calls that RPC through its client and renders the response in the existing sidebar.
4. Preserve legacy behavior only for the legacy plugin runtime. Keep the v2 credential path independent of local database filenames and disk formats.

The server plugin context exposes both `integration` and `rpc`; its RPC domain supports portable definitions and asynchronous handlers. This supplies the intended bridge between privileged server work and client UI. [Server context](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/plugin/src/promise/plugin.ts), [RPC registration](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/plugin/src/promise/rpc.ts).

## Refresh and account selection

`connection.resolve` retrieves the current stored credential. For OAuth, it finds the registered authentication method and refreshes if expiry is within five minutes, then persists the result before returning it. If no refresh implementation exists, it returns the stored value. MyStatus should rely on this host operation instead of independently rotating refresh tokens or writing `auth.json`. There is no explicit refresh semaphore in this resolution method; coalescing simultaneous MyStatus quota requests is a reasonable precaution. [Resolution implementation](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/integration.ts#L663).

The active connection ordering uses stored credentials before environment connections; stored credential ordering reflects host activation. Call `active` for each new refresh cycle so an account switch takes effect, rather than caching a credential indefinitely. The OpenAI provider reads the account identifier from `metadata.accountID` for the `chatgpt-account-id` header. [Connection ordering](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/integration.ts#L345), [credential ordering](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/credential.ts#L96), [account header](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/core/src/plugin/provider/openai.ts#L263).

## Alternatives and limits

The public credential HTTP group provides label update, activation and removal; it has no endpoint to retrieve credential secrets. Direct SQLite access would couple MyStatus to internal schema and bypass refresh and connection selection. Neither is preferable to the server plugin interface. [Credential HTTP protocol](https://github.com/anomalyco/opencode/blob/5ff8a3f5fa8b6f0f1ddd696ecc6f61ca7aadb7da/packages/protocol/src/groups/credential.ts).

The inspected OpenCode provider does not expose a subscription-quota RPC. OpenAI's separate Codex app-server does document `account/rateLimits/read`, but adopting it would add a Codex process and a separate authentication/account-selection context; it is an alternative for a Codex integration, not a direct replacement for the active OpenCode account. The existing ChatGPT quota endpoint remains a separate compatibility surface from OpenCode's credential API. [Codex app-server rate-limit documentation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

The installed `opencode2.exe` contains the symbols `Integration.connection.active`, `Integration.connection.resolve`, `Rpc.register` and `/api/rpc`. This is supporting evidence that the installed build contains these facilities, not proof of a successful plugin registration. Validate with a real server RPC smoke test and a sidebar read after deployment.

## Validation needed

- Host OAuth credential reaches the usage fetch while returned RPC data contains no secrets.
- Expired credentials follow host resolution; MyStatus does not call a separate refresh endpoint or persist token files.
- Active-account changes are reflected and `metadata.accountID` is forwarded correctly.
- Missing credentials, API-key connections, host refresh errors and quota HTTP errors produce readable status instead of hiding the provider.
- A v2 server plugin registers the RPC successfully and the TUI can call it on the installed build.
