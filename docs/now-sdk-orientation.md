# now-sdk Orientation (cached grounding)

> Generated from `@servicenow/sdk` **v4.11.2** on 2026-08-29T00:28:11Z.
> Regenerate only when the installed SDK version changes:
> `bash servicenow/delivery-app/scripts/generate-orientation.sh`

This document is the required orientation for the now-sdk skill. Phase 1's
Architect and Developer agent prompts reference it so Fluent code is grounded
in the actually-installed SDK version rather than training-data memory.

---

## Topic index
- [developing-apps-guide](#topic-developing-apps-guide)
- [fluent-overview](#topic-fluent-overview)
- [keys-file](#topic-keys-file)
- [now-config-reference](#topic-now-config-reference)
- [now-id-guide](#topic-now-id-guide)
- [module-guide](#topic-module-guide)
- [data-helpers-guide](#topic-data-helpers-guide)
- [now-ref-guide](#topic-now-ref-guide)
- [now-include-guide](#topic-now-include-guide)
- [now-attach-guide](#topic-now-attach-guide)
- [now-del-guide](#topic-now-del-guide)
- [override-guide](#topic-override-guide)

---

<a id="topic-developing-apps-guide"></a>

## explain: developing-apps-guide

```text

# Developing ServiceNow Apps with the Now SDK

Guide for ServiceNow app development using the Now SDK: project setup, fluent authoring, build/deploy workflow, and CLI reference. Start here when working on a new ServiceNow application or with the Now SDK before consulting artifact-specific guides.

## When to Use

- Setting up a new ServiceNow application project from scratch
- Working with the ServiceNow SDK (`@servicenow/sdk`) CLI commands
- Scaffolding project structure, modules, or fluent definitions
- Building, deploying, or iterating on a ServiceNow app locally
- Authenticating the SDK against a ServiceNow instance
- Answering questions about SDK capabilities, fluent language, or project configuration

## Prerequisites

- **Node.js 20 or later** (LTS recommended)
- **npm** (bundled with Node.js)
- Access to a ServiceNow instance (PDI or enterprise) with admin or developer credentials

## Installation

### Non-Interactive Scaffolding (Recommended for Agents)

Create a new application:

```bash
npx @servicenow/sdk init \
  --appName "My App" \
  --packageName "my-app" \
  --scopeName "x_my_app" \
  --template "base"
```

> **Important:** The scope name must be formatted as `x_<company_code>_<app_name>` (if you do not have maint access). Choose one of these options:

> - Provide the company code found under the sys_property `glide.appcreator.company.code`.
> - Use the generated name at your own risk. 

Convert an existing application from an instance:

```bash
npx @servicenow/sdk init \
  --from <sys_id_of_sys_app_record>
```

> `init` creates files in the current working directory. It does not create a subdirectory.

After scaffolding:

```bash
npm install
```

### Interactive Scaffolding

```bash
npx @servicenow/sdk init
```

Prompts for app scope, name, and target instance. Run `npm install` after completion.

## CLI Commands Reference

| Command | Purpose |
|---------|---------|
| `init` | Scaffold a new project. Flags: `--appName`, `--packageName`, `--scopeName`, `--template`. |
| `auth` | Authenticate. `--add <url> --type basic\|oauth` to add, `--list` to check, `--use <alias>` to set default. |
| `build` | Compile fluent source files. Validates syntax and reports errors. |
| `install` | Push built artifacts to the instance. Requires prior `auth`. |
| `transform` | Convert existing instance artifacts into fluent source files. |
| `download` | Download specific records or update sets from an instance. |
| `query` | Query instance data via Table API. Use `-o json` for structured output. See [query-guide.md](query-guide.md). |
| `dependencies` | Fetch TypeScript type definitions for platform APIs. |
| `clean` | Remove build output and cached artifacts. |
| `pack` | Package the app into a ZIP with update set XML and `package_inventory.csv` (SHA-256 manifest). |

## Project Structure

```
src/
  fluent/
    index.now.ts           # Main fluent entry point
    example.now.ts         # Example fluent definition
    tsconfig.json          # Fluent TypeScript config
  server/
    script.ts              # Example server-side script
    tsconfig.json          # Server TypeScript config
now.config.json            # App metadata: scope, scopeId, name
package.json
```

Organize artifacts by type using kebab-case naming:

```
src/fluent/
  business-rules/
    my-rule.now.ts
  client-scripts/
    my-script.now.ts
```

### now.config.json

```json
{
  "scope": "x_my_app",
  "scopeId": "26571502d0a642339adf60a7edf6fab9",
  "name": "My App",
  "tsconfigPath": "./src/server/tsconfig.json"
}
```

Does not contain instance connection info -- that is managed via `auth`.

## Development Workflow

1. **`init`** -- Scaffold the project (one-time).
2. **`npm install`** -- Install SDK and dependencies (one-time).
3. **`auth`** -- Authenticate against your instance (or verify existing auth with `--list`).
4. **Write fluent** -- Create `.now.ts` files under `src/fluent/`. Write server scripts in `src/server/`.
5. **`build`** -- Compile and validate fluent definitions.
6. **`install`** -- Install compiled artifacts on the instance.
7. **Iterate** -- Repeat steps 4-6.

For brownfield projects, use `transform` to pull instance artifacts into fluent source first (see below).

### Build & Install Cycle

After writing or editing fluent definitions, run the build then the deploy command. This is the core inner-loop you repeat on every change.

Prefer the `package.json` npm scripts over the underlying `now-sdk build` / `now-sdk install` commands — a complete application may have additional build steps wired into those scripts.

```bash
# 1. Compile and validate fluent source into deployable artifacts
npm run build

# 2. Push the built artifacts to the authenticated instance
npm run deploy
```

- **`npm run build`** (runs `now-sdk build`) transpiles the SDK project and writes the output artifacts. Build errors (invalid references, type mismatches, malformed definitions) are reported here -- fix them before deploying.
- **`npm run deploy`** (runs `now-sdk install`) deploys the most recent build output to the instance selected via `auth`. It requires a prior successful `build` and valid credentials to be configured already.
- MUST: Ensure build has passed before deploying! A failed build leaves the previous artifacts in place, so deploying without rebuilding pushes stale output.

## Converting Existing Applications

### From an Instance

Convert a scoped application already installed on an instance:

```bash
npx @servicenow/sdk init --from <sys_id_of_application>
```

Use `--auth <alias>` to specify which instance credentials to use. Without it, the default alias is used. Run `npm install` after.

### From an Existing Repository

If the app already has a git repo with XML metadata:

```bash
npx @servicenow/sdk init --from <path_to_repo>
```

Existing metadata XML and supporting files are placed inside the `metadata` folder, and fluent configuration files are added alongside them.

### Converting XML to Fluent DSL

After initializing from an instance or repo, application metadata will be in the `metadata` folder in its original XML form. Use `transform` to convert XML files into Fluent code:

```bash
# Transform a single file
npx @servicenow/sdk transform --from metadata/update/sys_script_<sys_id>.xml

# Transform the whole app at once
npx @servicenow/sdk transform --from .

# Transform a specific directory
npx @servicenow/sdk transform --from metadata/update
```

Transformed files are scaffolded into the generated directory (configurable in `now.config.json`) and removed from `metadata` upon successful conversion.

> **Note:** Records that exist as both a fluent entity (`.now.ts` file) and an XML file in `metadata` will use the XML version on `build`. Remove converted XML files to avoid conflicts.

Run `npx @servicenow/sdk transform --help` for the full list of options.

## Authentication

### Checking Existing Credentials

```bash
npx now-sdk auth --list
```

### Adding Credentials (Interactive)

```bash
npx now-sdk auth --add <instance-url> --type <basic|oauth>
```

- **`basic`**: Username and password. Suitable for local development and PDIs.
- **`oauth`**: OAuth-based. Suitable for enterprise instances.

Prompts for alias, username, and password. Credentials stored in `.now-sdk/` (gitignored).

### Setting a Default

```bash
npx now-sdk auth --use <alias>
```

### Adding Credentials (Non-Interactive)

Pass `--username` to skip the username prompt and `--password-stdin` to pipe the password through stdin instead of being prompted. Useful for agent-driven setup (Claude Code, scripts) where typing into the prompt isn't possible. Same pattern as `docker login --password-stdin`:

```bash
echo "$SN_PASSWORD" | npx now-sdk auth --add <instance-url> \
    --type basic --alias <alias> --username <user> --password-stdin
```

Credentials are stored exactly the same way as the interactive flow — subsequent `now-sdk deploy --auth <alias>` calls work as expected. The password never appears in `ps`, shell history, or log files.

`--password-stdin` only applies to basic auth; with `--type oauth` it is ignored (OAuth uses a browser-based code grant). Empty stdin or running with `--password-stdin` outside a pipe produces a clear error rather than hanging.

### Non-Interactive (CI/CD)

See CI Integration 'ci-integration' topic for more information

## Key Concepts

### Fluent Language (SDK 4.x Object-Based API)

TypeScript-based DSL for defining ServiceNow artifacts:

```typescript fluent
import { BusinessRule } from '@servicenow/sdk/core'
import { myScriptFunction } from '../server/script'

BusinessRule({
  $id: Now.ID['my-rule'],
  name: 'Uppercase Short Description',
  table: 'incident',
  when: 'after',
  action: ['insert', 'update'],
  order: 100,
  script: myScriptFunction,
})
```

- The `Now` global (e.g. `Now.ID[...]`) is available with no import — the SDK registers it automatically during build and through the language server.
- Import artifact types from `@servicenow/sdk/core`.
- Server-side logic is written as functions in `src/server/` and passed via the `script` property.  See `module` topic for more information

### TypeScript Types

Run `npx now-sdk dependencies` to fetch type definitions for platform APIs and tables on the connected ServiceNow instance, enabling IDE autocompletion.

```

---

<a id="topic-fluent-overview"></a>

## explain: fluent-overview

```text
# ServiceNow Fluent Overview

ServiceNow Fluent is a domain-specific language (DSL) based on TypeScript for defining the metadata files [sys_metadata] that make up applications. It includes APIs for tables, roles, ACLs, business rules, Automated Test Framework tests, and more.

## Cross-Cutting Language Constructs

Some Fluent features apply across every API rather than belonging to a specific record type — `Now.include`, `Now.attach`, `Now.ref`, the data helpers (`Duration`, `TemplateValue`, etc.), and the `$override` escape hatch. These live in the `fluent/` folder of the SDK docs and all share the `fluent-language` tag. Use that tag to discover them as a group: `now-sdk explain fluent-language` returns every cross-cutting topic. Read these first when working in any `.now.ts` file — they apply regardless of which API you're calling.

Developers define metadata in a few lines of code instead of through a form or builder tool user interface. Applications created or converted with ServiceNow platform tools or the ServiceNow SDK support developing in ServiceNow Fluent.

ServiceNow Fluent supports two-way synchronization, which allows changes to metadata to be synced from other Now Platform user interfaces into source code and changes to source code to be synced back to metadata across the instance.

## File Structure

Fluent metadata is defined in `.now.ts` files. A typical project structure:

```
src/
    fluent/
        business-rules/
            log-state-change.now.ts
        tables/
            to-do.now.ts
    server/
        show-state-update.js
now.config.json
package.json
```

## Usage

In `.now.ts` files, import APIs from `@servicenow/sdk/core` and define metadata:

```typescript fluent
import { Table, StringColumn, DateColumn, BooleanColumn, IntegerColumn } from '@servicenow/sdk/core'

export const x_snc_example_to_do = Table({
    name: 'x_snc_example_to_do',
    schema: {
        deadline: DateColumn({ label: 'deadline' }),
        task: StringColumn({ label: 'Task', maxLength: 120, mandatory: true }),
        active: BooleanColumn({ label: 'Active' }),
        state: StringColumn({
            label: 'State',
            choices: {
                ready: 'Ready',
                in_progress: 'In Progress',
                completed: 'Completed',
            },
        }),
        priority: IntegerColumn({ label: 'Priority' }),
    },
})
```

For sample/demo data, use the Record API, and be sure to set `installMethod: 'demo'` via the `$meta` property:

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['example_id0'],
    $meta: { installMethod: 'demo' },
    table: 'x_snc_example_to_do',
    data: {
        state: 'ready',
        task: 'Create a ServiceNow Fluent application',
        active: true,
        priority: 1,
    },
})
```

## Server-Side Scripts and Modules

For server-side scripts, use JavaScript modules with `import`/`export`. This is the preferred approach — modules provide typed Glide API access, code reuse, and full IDE support. Place module files under `src/server/` and import them from `.now.ts` files:

```typescript fluent
import { BusinessRule } from '@servicenow/sdk/core'
import { showStateUpdate } from '../server/show-state-update'

BusinessRule({
    $id: Now.ID['br0'],
    table: 'x_snc_example_to_do',
    script: showStateUpdate,
    name: 'LogStateChange',
    when: 'after',
    action: ['update'],
})
```

For detailed guidance on module imports, exports, Glide APIs, and Script Include patterns, see the `module-guide` topic.

## Controlling the ECMAScript Version of Server-Side Scripts

Any API that has a server-side script field (`BusinessRule`, `Acl`, `ScriptInclude`, `ScriptAction`, `ScheduledScript`, `UiPage`, `AliasTemplate`, `InboundEmailAction`, `CatalogItem`, `CatalogItemRecordProducer`, `RestApi` routes, `StateModel` transition conditions, the instance scan check APIs, `SPWidget`, and `SPMenu`, among others) accepts an optional `$meta.useEsLatest` flag:

```typescript fluent
import { ScriptInclude } from '@servicenow/sdk/core'

ScriptInclude({
    $id: Now.ID['my-script-include'],
    name: 'MyScriptInclude',
    $meta: { useEsLatest: true },
    script: Now.include('../../server/ScriptInclude/MyScriptInclude.server.js'),
})
```

Set `useEsLatest: true` to run that record's server-side script field(s) with the latest ECMAScript version the platform supports, instead of whatever the application's `sys_app`/`now.config` default is. Omit `useEsLatest` entirely to leave the app-level default in place — most records don't need to set this. When a record has more than one script field (e.g. `RestApi` routes with `headers`/`parameters`, or an ACL with both `script` and role conditions), `useEsLatest` applies to all script fields defined for that entity, not just one.

## Deleting Fluent Code

Every record defined in Fluent has its identity tracked in `keys.ts`, which maps each `$id` to the record it produced (exception is coalesce tables that dont require `$id` on APIs). Removing the Fluent code that defines a record (e.g. a `Table()`, `BusinessRule()`, or `Record()` call) does not simply make that record disappear from the build. Because the `keys.ts` entry still exists with no matching Fluent code, the build treats this as an intentional deletion: it marks the entry deleted in `keys.ts` and generates a delete record for it. That delete record ships as part of the app package and removes the record from the instance the app is installed on, including through future app upgrades.

This tracked-deletion behavior is what makes app upgrades reliable — it's how Fluent knows to clean up a record on customer instances after you remove it from source. But it also means deleting Fluent code has a real, persistent effect beyond the current file, so it should be done deliberately:

- **If the record was already installed to an instance and the deletion should propagate through upgrades:** deleting the Fluent code and leaving the `keys.ts` entry in place is correct — that's what generates and applies the delete record.
- **If the record was never installed anywhere, or the deletion has already fully propagated to production and no longer needs tracking:** delete the Fluent code and remove its matching entry from `keys.ts` in the same change. If the `keys.ts` entry is left behind, a delete record is still generated even though that isn't the intent.

### Warning for AI Agents/LLMs

Never delete a `Table()`, `BusinessRule()`, `Record()`, or other API call from a `.now.ts` file as a quick way to "remove" something, and never do so without telling the user first. Because the two cases above look identical in the code — the difference is install history, which the code alone can't reveal — an agent cannot safely infer which one applies. Before deleting Fluent code, confirm with the user whether the record has been installed anywhere and whether the deletion should propagate through upgrades, and update `keys.ts` accordingly.

## Core Difference between UI Pages and UI Formatters

- **UI Formatter** -- Used inside forms to add non-field content
- **UI Page** -- Used outside forms as standalone pages

If the request mentions "on the form" or similar keywords (activities, process flow, stages, timeline, attached knowledge, checklist, breadcrumb, CI relationships, contextual search, variable editor, formatters), use UI Formatters. If it's a standalone page/application, use UI Pages.

## AI Integration with LLM

For AI-powered capabilities (sentiment analysis, text generation, summarization), use ServiceNow's `sn_generative_ai.LLMClient` API in server-side scripts:

```javascript
var llmClient = new sn_generative_ai.LLMClient()
var prompt = 'Your specific AI task prompt here'

try {
    var result = llmClient.call({ prompt: prompt })
    if (result.status === 'Success') {
        var response = result.response.trim()
    } else {
        gs.error(result.response)
    }
} catch (e) {
    gs.error(e.message)
}
```

The recommended pattern is to create a Script Include for LLM operations, then call it from Business Rules, Scripted REST APIs, or via GlideAjax from client scripts.

```

---

<a id="topic-keys-file"></a>

## explain: keys-file

```text

# The keys.ts File

Every Fluent project has an auto-generated `keys.ts` file that maps human-readable identifiers to ServiceNow sys_ids. It's the registry that makes `Now.ID['my-record']` work.

> **For AI agents and developers:** This document covers the `keys.ts` file structure. For how to use `Now.ID` in your Fluent code — including key naming conventions, identity vs. referencing, and common mistakes — see the **Now.ID** topic.

## Location

```
src/fluent/generated/keys.ts
```

This file is **auto-generated by the build system** — you should not normally need to edit it by hand.

## Purpose

ServiceNow identifies every record by a 32-character sys_id (e.g., `4103297d12554b488d489c0bf1ceff19`). Working with raw sys_ids in source code is error-prone and unreadable. The keys file solves this by mapping meaningful names to sys_ids:

```typescript fluent
$id: Now.ID['validate-on-insert']  // readable
// resolves to sys_id: '4103297d12554b488d489c0bf1ceff19'
```

## Structure

```typescript fluent
import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    'validate-on-insert': {
                        table: 'sys_script'
                        id: '4103297d12554b488d489c0bf1ceff19'
                    }
                    'my-acl': {
                        table: 'sys_security_acl'
                        id: 'a3a4966e8c38446d8e1c25620e4e73f4'
                    }
                }
                composite: [
                    {
                        table: 'sys_documentation'
                        id: '00e80b3ed0124620a32c6f9ac0472cf4'
                        key: {
                            name: 'x_myapp_table'
                            element: 'name'
                            language: 'en'
                        }
                    }
                ]
                deleted: {}
            }
        }
    }
}
```

## Key types

### Explicit keys

Direct mappings from a developer-chosen name to a table and sys_id. These are created when you use `$id: Now.ID['some-name']` in your Fluent code.

```typescript
explicit: {
    'my-business-rule': {
        table: 'sys_script'
        id: '4103297d12554b488d489c0bf1ceff19'
    }
}
```

- **You choose the key name** — any string is valid; kebab-case (e.g. `'validate-on-insert'`) is conventional
- **The sys_id is auto-generated** on first build and stable thereafter — renaming a key creates a new record and orphans the old one
- IDE autocomplete suggests existing keys when you type `Now.ID['`
- For full naming guidance see the **Now.ID** topic

### Composite keys

For records identified by a combination of field values (coalesce keys) rather than a single developer-chosen name. These are auto-generated for child and descendant records like table columns, documentation entries, and choice values.

```typescript
composite: [
    {
        table: 'sys_choice'
        id: 'ae25f03b01c14366942460e8cfeec032'
        key: {
            name: 'x_myapp_task'
            element: 'state'
            value: 'todo'
        }
    }
]
```

You don't interact with composite keys directly — they're managed by the build system.

### Deleted keys

Tracks records that have been removed from the project. This prevents sys_id reuse and enables clean uninstall.

## How Now.ID works

For a detailed explanation of `Now.ID` — including build mechanics, key naming conventions, identity vs. referencing records, and common mistakes — see the **Now.ID** topic.

## Best practices

- **Don't edit keys.ts manually** unless you need to fix a specific mapping
- **Do commit keys.ts to version control** — it's the source of truth for record identity
- **Use `--frozenKeys` in CI** — prevents a build from silently regenerating keys.ts when the committed file is out of date; see the **CI Integration** topic for setup
- **Use meaningful key names** — `'validate-priority-on-insert'` is better than `'1'`
- **Don't worry about composite keys** — they're fully automatic

```

---

<a id="topic-now-config-reference"></a>

## explain: now-config-reference

```text
# now.config.json

The `now.config.json` file is the project configuration for a Fluent SDK application. It lives at the project root and defines the application scope, build settings, source directories, dependencies, and runtime policies. Every Fluent project requires this file.

## Required Properties

### `scope`

Scope of the application (example: 'x_myapp' or 'sn_myapp')

- **Type:** `string`
- **Pattern:** `^((x|sn)_[a-z0-9_]+|global)$`
- **Min length:** 4
- **Max length:** 18

### `scopeId`

Scope ID of the application (example: 'fc1b5713c3db3110d6489a038a40dd85')

- **Type:** `string`
- **Pattern:** `^([0-9a-f]{32}|global$)`
- **Max length:** 32

## Properties

### `active`

Is the application active

- **Type:** `boolean`

### `appOutputDir`

Location to output built application for packaging during fluent build command

- **Type:** `string`
- **Default:** `"dist/app"`

### `applicationRuntimePolicy`

Application Runtime Policy mode. Set to 'tracking' or 'enforcing' to enable policy records. Defaults to 'none' if not specified.

- **Type:** `"none"` | `"tracking"` | `"enforcing"`

### `clientDir`

Directory containing client files of the application, such as HTML and TypeScript files. Set to empty to disable the client build.

- **Type:** `string`
- **Default:** `"src/client"`

### `description`

Description of the application

- **Type:** `string`

### `excludeFilePatterns`

Glob patterns matched against incoming file basenames (not full paths) during transform. Files that match are discarded and not written to the metadata directory.

- **Type:** `string[]`

### `fluentDir`

Directory containing .now.ts fluent files of the application

- **Type:** `string`
- **Default:** `"src/fluent"`
- **Min length:** 1

### `generatedDir`

Directory relative to 'fluentDir' where Fluent will generate files, such as keys.ts

- **Type:** `string`
- **Default:** `"generated"`
- **Min length:** 1

### `guidedSetupGuid`

SysID of the Guided Setup to start when the application is upgraded

- **Type:** `string`
- **Pattern:** `^[0-9a-f]{32}$`

### `ignoreTransformTableList`

List of tables to ignore when transforming entities to ServiceNow tables

- **Type:** `string[]`

### `installedAsDependency`

App was installed as a dependency

- **Type:** `boolean`
- **Default:** `false`

### `jsLevel`

JavaScript level for the application

- **Type:** `"es_latest"` | `"helsinki_es5"` | `"traditional"`
- **Default:** `"es_latest"`

### `logo`

SysID of the app logo

- **Type:** `string`
- **Pattern:** `^[0-9a-f]{32}$`

### `menu`

SysID of the application's primary menu for default table modules

- **Type:** `string`
- **Pattern:** `^[0-9a-f]{32}$`

### `metadataDir`

Directory containing metadata xml for the app

- **Type:** `string`
- **Default:** `"metadata"`

### `name`

Name of the application (example: 'MyApp')

- **Type:** `string`
- **Min length:** 3
- **Max length:** 100

### `networkPolicies`

Network access policies for the application (sys_arp_network_policy)

- **Type:** `object[]`

### `npmUpdateCheck`

- **Type:** `number` | `boolean`
- **Default:** `10`

### `packOutputDir`

Location to output the zip file during build process, to be later installed on the instance during install command

- **Type:** `string`
- **Default:** `"target"`

### `packageResolverVersion`

Rhino module resolver version. Must be 2.0.0+ for Global apps

- **Type:** `"1.0.0"` | `"2.0.0"`
- **Default:** `"1.0.0"`

### `serverModulesDir`

Directory containing modular files to be built into sys_modules

- **Type:** `string`
- **Default:** `"src/server"`

### `serverModulesExcludePatterns`

Patterns to exclude when building server modules

- **Type:** `string[]`
- **Default:** `["**/*.test.ts","**/*.test.js","**/*.d.ts"]`

### `serverModulesIncludePatterns`

Patterns to include when building server modules

- **Type:** `string[]`
- **Default:** `["**/*.ts","**/*.tsx","**/*.js","**/*.jsx","**/*.cts","**/*.cjs","**/*.mts","**/*.mjs","**/*.json"]`

### `staticContentDir`

> **Deprecated.** Use [`staticContent.buildDir`](#staticcontent) instead. This property is still accepted and will automatically migrate to `staticContent.buildDir`, but will produce a deprecation warning.

- **Type:** `string`
- **Min length:** 1

### `defaultLanguage`

BCP 47 language tag for table/column documentation defaults. Used to resolve labels from multi-language documentation arrays (e.g., 'en', 'es', 'fr', 'en-US', 'zh-Hans').

- **Type:** `string`
- **Default:** `"en"`
- **Pattern:** `^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$`
- **Min length:** 2

### `tableDefaultLanguage`

> **Deprecated.** Use [`defaultLanguage`](#defaultlanguage) instead. This property is still accepted and will automatically migrate to `defaultLanguage`, but will produce a deprecation warning.

### `tableOutputFormat`

Artifact type built for table definitions. Traditional bootstrap or separate component records.

- **Type:** `"bootstrap"` | `"component"`
- **Default:** `"bootstrap"`

### `trustedModules`

List of npm module patterns to mark as trusted. Trusted modules will have external_source set to false. Valid patterns: fully qualified package names (e.g., `lodash`, `@servicenow/sdk`) or organization prefixes with wildcard (e.g., `@servicenow/*`). Blanket wildcards like '*' are not allowed.

- **Type:** `string[]`
- **Default:** `[]`

### `tsconfigPath`

Path to tsconfig file to be used for transpilation of server module typescript. ServiceNow SDK will emit build errors following the referenced tsconfig. (example: './src/server/tsconfig.json')

- **Type:** `string`

### `type`

Whether this project represents a scoped/global app package or a set of record changes

- **Type:** `"package"`
- **Default:** `"package"`

## `accessControls`

Manage scoping restrictions and access to the application

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `canEditInStudio` | `boolean` | `true` | Can the application be opened in developer studio |
| `hideOnUI` | `boolean` | `false` | Application hidden in UI |
| `private` | `boolean` | `false` | Mark the application as private |
| `restrictTableAccess` | `boolean` | `false` | Restrict design time access to tables from outside the application |
| `runtimeAccessTracking` | `"none"` \| `"permissive"` \| `"enforcing"` | `"permissive"` | Runtime access tracking for the application |
| `scopedAdministration` | `boolean` | `false` | If true, System Admins will be prevented from accessing the application |
| `trackable` | `boolean` | `true` | Mark the application as trackable |
| `uninstallBlocked` | `boolean` | `false` | Uninstall blocked for the application |
| `userRole` | `string` |  | Role required for end users to access the application and its tables |

## `dependencies`

Reference dependencies on other ServiceNow application tables and entities, organized by scope

Keys match the pattern `^((x|sn)_[a-z0-9_]+|global)$`. Each entry can include:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `roles` | `"*"` \| `string[]` |  | Role definitions from sys_user_role (list of role names or '*' for all) |
| `tables` | `"*"` \| `string[]` |  | Table definitions from sys_db_object (list of table names or '*' for all) |

Additional keys are also accepted.

> **Deprecated sub-property:** `dependencies.applications` — DEPRECATED: Use flat scope structure instead. Move scopes directly under 'dependencies'.

## `licensing`

 If this application is licensable, set the subscription requirement and model.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enforceLicense` | `"none"` \| `"log"` \| `"enforce"` | `"log"` | Subscription requirement for the application |
| `licensable` | `boolean` | `true` | Mark package as licensable |
| `licenseCategory` | `"none"` \| `"general"` \| `"beta"` | `"none"` | License category for the application |
| `licenseModel` | `"none"` \| `"fulfiller"` \| `"producer"` \| `"capacity"` \| `"mixed"` \| `"app_use"` | `"none"` | License model for the application |
| `subscriptionEntitlement` | `string` |  | SysID of the subscription entitlement for the application |

## `linter`

Enable/Disable internal Fluent linting behavior.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `module.enabled` | `boolean` | `true` | Whether the module linter is enabled |

## `modulePaths`

Mapping between file glob patterns to resolve imported file paths to valid runtime paths. This is needed if your Fluent files are importing modules from a different location than the runtime modules. For example, if you have a custom TypeScript setup that transpiles modules from a 'src' directory to a 'dist' directory, you would need to specify that mapping here.

Keys match the pattern `.*`. Values are `string`.

## `performancePolicy`

Performance (resource limit) configuration (sys_app_resource_limit_template). Only one per scope.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `$id` | `string` |  | Unique sys_id for the record |
| `apiTransactionLimit` | `integer` | `30` | API Transaction Quota percentage (1-100) |
| `eventHandlerLimit` | `integer` | `20` | Event Handler Quota percentage (1-100) |
| `interactiveTransactionLimit` | `integer` | `30` | Interactive Transaction Quota percentage (1-100) |
| `mode` | `"disabled"` \| `"logOnly"` \| `"enforced"` |  | Enforcement mode for quota thresholds. Auto-derived from applicationRuntimePolicy if not explicitly set: 'none'→disabled, 'tracking'→logOnly, 'enforcing'→enforced |
| `name` | `string` |  | Configuration name |
| `scheduledJobLimit` | `integer` | `20` | Scheduled Job Quota percentage (1-100) |

## `scripts`

Define scripts that are executed with the SDK task runner. The task functions are async and are passed APIs for cross-environment compatibility. Use prebuild to run a script before the build process for custom build tasks.

Keys match the pattern `.*`. Values are `string`.

## `staticContent`

Static asset build configuration. Groups the build output directory, source-to-output path mappings, and additional asset glob entries into a single object.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `buildDir` | `string` | `"dist/static"` | Directory where the client build emits static assets that the SDK scans and packages |
| `paths` | `object` | `{ "src/client/*.html": "dist/static/*.html" }` | Mapping of source files to static output paths. Keys and values are glob-style strings |
| `assets` | `object` | `{}` | Mapping of glob patterns to static content configuration. Each key is a glob pattern relative to the project root and each value specifies how matched files are published |

### `staticContent.buildDir`

Directory where the client build emits static assets that the SDK scans and packages. The SDK automatically registers a default `assets` entry for `<buildDir>/**` using the application scope as the public path prefix.

- **Type:** `string`
- **Default:** `"dist/static"`
- **Min length:** 1

### `staticContent.paths`

Mapping of source file patterns to their static output paths. Used to alias client source locations to their compiled counterparts in the build output directory.

Keys match the pattern `.*`. Values are `string`.

- **Default:** `{ "src/client/*.html": "dist/static/*.html" }`

### `staticContent.assets`

Additional glob-pattern entries for static content directories beyond the default `buildDir`. Each key is a glob pattern relative to the project root, and each value is an object with a `publicPath` string that determines the URL path prefix for matched files. Supports `[$config.<property>]` tokens in `publicPath` values.

Keys match the pattern `.*`. Each value has:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `publicPath` | `string` | yes | The public URL path prefix for matched static content files |

**Example:**

```json
{
    "staticContent": {
        "buildDir": "dist/static",
        "assets": {
            "./public/**": { "publicPath": "[$config.scope]/public" }
        }
    }
}
```

## `staticContentPaths`

> **Deprecated.** Use [`staticContent.paths`](#staticcontent) instead. This property is still accepted and will automatically migrate to `staticContent.paths`, but will produce a deprecation warning.

Keys match the pattern `.*`. Values are `string`.

## `taxonomy`

Configuration for taxonomy-based file organization

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `fallbackFolderName` | `string` |  | Folder name to use when a table doesn't have a mapping (lowercase, no spaces or special chars) |
| `mapping` | `object` |  | Maps table names to their folder path for organization. Resulting files will be placed in '{generatedDir}/{path}' |

## `wildcardPolicy`

Wildcard/exemption policy for the application (sys_arp_segment_policy). Only one per scope.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `$id` | `string` |  | Unique sys_id for the record |
| `active` | `boolean` | `false` | Whether the policy is active |
| `arl` | `object` |  | ARL (Application Resource Limit) pillar configuration |
| `network` | `object` |  | Network pillar configuration |
| `record` | `boolean` | `false` | Enable Record pillar access |
| `scripting` | `object` |  | Scripting pillar configuration |
| `shortDescription` | `string` |  | Human-readable description of the policy |

```

---

<a id="topic-now-id-guide"></a>

## explain: now-id-guide

```text

# Now.ID

`Now.ID['key-name']` gives a Fluent record a stable, human-readable identity. Use it to assign the `$id` property on any API that accepts one — the build system maps the key to a real sys_id and keeps it stable across builds.

> **Critical:** Never invent or generate a sys_id value. **Always** use `Now.ID['descriptive-key']` to create new record identities. The build system is the only safe source of new sys_id values — it generates them guaranteeing no collisions and stores them in `keys.ts`. Fabricated sys_ids (especially those produced by an LLM) will collide across projects and bypass the key-tracking system entirely. The only acceptable raw sys_id strings are those returned by a query or transform against a real instance.

> **Note:** `Now` is a **global** available in every `.now.ts` file — it does **not** need to be imported. Do not add `Now` to any `import { ... } from '@servicenow/sdk/core'` line; use `Now.ID[...]` directly.

## Basic usage

```typescript
import { BusinessRule } from '@servicenow/sdk/core'

BusinessRule({
    $id: Now.ID['validate-priority-on-insert'],
    name: 'Validate priority on insert',
    table: 'incident',
    when: 'before',
    action: 'insert',
    script: Now.include('./validate-priority.js'),
})
```

The first time you build, the key `'validate-priority-on-insert'` is added to your project's `keys.ts` file with a newly generated sys_id. Every build after that uses the **same sys_id** — so the record is updated in place, not duplicated.

## How the build system handles keys

### First build — key is new

```typescript
BusinessRule({
    $id: Now.ID['my-new-rule'],  // key doesn't exist yet in keys.ts
    // ...
})
```

The build system:
1. Sees `'my-new-rule'` is not in `keys.ts`
2. Generates a new sys_id
3. Adds the entry to `keys.ts`
4. Uses that sys_id in the XML output

### Subsequent builds — key exists

```typescript
BusinessRule({
    $id: Now.ID['my-new-rule'],  // key now exists in keys.ts
    // ...
})
```

The build system:
1. Looks up `'my-new-rule'` in `keys.ts`
2. Finds the existing sys_id
3. Uses the **same** sys_id — the record is updated, not duplicated

## When to use $id

### APIs where $id is the right choice

Use `$id: Now.ID['...']` on any top-level record you want to identify by name:

```typescript
import { Acl, BusinessRule, ScriptInclude } from '@servicenow/sdk/core'

Acl({
    $id: Now.ID['incident-read-acl'],
    // ...
})

BusinessRule({
    $id: Now.ID['business-rule-example'],
    // ...
})

ScriptInclude({
    $id: Now.ID['script-include-example'],
    // ...
})
```

### When $id is optional

`$id` is technically optional on some APIs. However, omitting it means the record is identified only by its coalesce keys (typically `name`). If you ever rename the record, a new record is created and the old one is orphaned. **Always provide `$id`** on APIs that support it.

### Nested records

Some APIs have child records that also accept `$id`. Assign one whenever you want a stable reference to a nested item:

```typescript fluent
import { SPMenu } from '@servicenow/sdk/core'

SPMenu({
    $id: Now.ID['main-nav-menu'],
    title: 'Main Navigation',
    items: [
        {
            $id: Now.ID['main-nav-home'],
            type: 'page',
            label: 'Home',
            page: 'homepage',
        },
        {
            $id: Now.ID['main-nav-tickets'],
            type: 'page',
            label: 'My Tickets',
            page: 'ticket_list',
        },
    ],
})
```

## Choosing key names

Key names are strings — choose something that is:

- **Descriptive** — `'validate-priority-on-insert'` is better than `'1'` or `'vp'`
- **Scoped to the record** — include the table or feature area when helpful: `'incident-read-acl'`, `'main-nav-menu'`
- **Stable** — renaming a key creates a new record; the old one is orphaned unless cleaned up manually

Any string is valid. Kebab-case is conventional but not required.

## IDE autocomplete

Once a key exists in your project's `keys.ts`, your IDE autocompletes it when you type `Now.ID['`. Keys that do not exist yet are also accepted — the build creates them on the next run.

## Referencing records across files

`Now.ID` is only for assigning identity — it is not a reference mechanism. To reference a Fluent record from another file, use the exported variable directly, or its `.$id` property when only the identifier is needed.

### Pass the variable directly

Export the API call result and import it where needed. This is the standard pattern:

```typescript fluent
// example.now.ts
import { Record } from '@servicenow/sdk/core'

export const recordExample = Record({
    $id: Now.ID['record-example-1'],
    table: 'x_myapp_table',
    data: {
        name: 'Example Record'
    }
})
```

```typescript fluent
// example-two.now.ts
import { Record } from '@servicenow/sdk/core'
import { recordExample } from './example.now'

Record({
    $id: Now.ID['record-example-2'],
    table: 'x_myapp_othertable',
    data: {
        reference_field: recordExample
    }
})
```

### Use variable.$id when only the identifier is needed

If an API only accepts a string for an identifier rather than the full record object, pass `variable.$id`:

```typescript fluent
import { Acl } from '@servicenow/sdk/core'
import { AdminRole } from './roles.now'

Acl({
    $id: Now.ID['my-acl'],
    type: 'record',
    table: 'x_myapp_table',
    operation: 'read',
    roles: [AdminRole.$id],
})
```

## What not to do

### Don't use Now.ID outside of key creation for a record

`Now.ID['key']` is only for generating IDs, never for referencing them elsewhere in fluent

```typescript fluent
import { Record } from '@servicenow/sdk/core'

// ✅ CORRECT — $id resolves to a sys_id
export const vendorAcme = Record({
    $id: Now.ID['vendor-acme'],
    table: 'x_myapp_vendor',
    data: { name: 'Acme Corp' },
})

// ✅ CORRECT — pass the exported variable to reference a same-app record
Record({
    $id: Now.ID['contract-1'],
    table: 'x_myapp_contract',
    data: {
        vendor: vendorAcme,               // resolves correctly
    },
})

// ❌ WRONG — Now.ID in a data field writes the literal string, not a sys_id
Record({
    $id: Now.ID['contract-1'],
    table: 'x_myapp_contract',
    data: {
        vendor: Now.ID['vendor-acme'],    // writes "vendor-acme" to the DB
    },
})
```

### Don't generate or invent sys_ids

Never invent or fabricate a sys_id string. LLMs in particular must **never** generate a sys_id — they must use `Now.ID['descriptive-key']` instead. LLM-fabricated sys_ids are not tracked by the build system and **will** collide across projects. For example, the value `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6` has entered LLM training data and has been reproduced by models in multiple unrelated projects, causing real collisions. **`Now.ID` is the only correct way to create a new sys_id.**

```typescript
// ❌ WRONG — LLM-generated sys_id; this specific value has caused collisions
BusinessRule({
    $id: Now.ID['a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'],  // not a key name, just a hallucinated ID
    name: 'My Rule',
    // ...
})

// ❌ WRONG — invented sys_id passed directly, not tracked in keys.ts
BusinessRule({
    $id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    name: 'My Rule',
    // ...
})

// ✅ CORRECT — let the build system generate and track the sys_id
BusinessRule({
    $id: Now.ID['my-rule'],
    name: 'My Rule',
    // ...
})
```

### Don't use raw sys_ids for same-app records

Hardcoded sys_ids only work in one environment. If a record is defined in your project, reference it with the exported variable rather than copying the sys_id from an instance.

```typescript
// ❌ WRONG — hardcoded sys_id breaks in other environments
data: {
    flow: 'a1b2c3d4e5f67890abcdef1234567890',
}

// ✅ CORRECT — cross-environment reference
data: {
    flow: myFlow,   // exported variable from your project
}
```

## Decision table

| Scenario | Pattern |
|----------|---------|
| Give a record a stable identity | `$id: Now.ID['descriptive-name']` |
| Reference a record from the same file | Pass the exported variable directly |
| Reference a record from another `.now.ts` file | `import { MyRecord } from './other.now'`, then pass `MyRecord` or `MyRecord.$id` |
| Reference a platform record by coalesce keys | `Now.ref('table', { field: 'value' })` |
| Reference a platform record by sys_id | raw sys_id string |

## Further reading

- [The keys.ts file](../configuration/keys-file.md) — how keys are stored and managed by the build system
- [Now.ref guide](./now-ref-guide.md) — referencing records in other tables

```

---

<a id="topic-module-guide"></a>

## explain: module-guide

```text
# JavaScript Modules

JavaScript modules are the **modern, preferred approach** for all server-side code in Fluent projects. Modules support `import`/`export`, provide access to typed Glide APIs via `@servicenow/glide`, enable code reuse across your application, and integrate with third-party npm libraries.

## When to Use

Use modules for server-side scripts in APIs that accept function types. Not all APIs support modules — some `script` properties only accept strings. If the compiler or build rejects a module import (for example, a type error such as `Type '() => void' is not assignable to type 'string'`, or a similar diagnostic), the API does not support modules and you should use `Now.include()` instead (see the `now-include-guide` topic). The exact error will vary depending on the structure of your module export and the API you're targeting.

**APIs that support modules (accept functions):**
- BusinessRule, ScriptAction, UiAction — `script` property
- RestApi route handlers — `script` property
- CatalogItemRecordProducer — `script` and `postInsertScript` properties
- ScheduledScript — `script` property

**APIs that require Now.include() or inline strings:**
- ScriptInclude, ClientScript — `script` is string-only
- CatalogClientScript, CatalogUiPolicy, UiPolicy — script fields are string-only
- SPWidget — all script fields are string-only
- Record API — data values are strings

### Additional use cases

- Organizing reusable server-side code into importable files
- Importing Glide APIs (`gs`, `GlideRecord`, etc.) for use in module files
- Adding third-party npm libraries to an application

## Instructions

1. **Module file location in src** Module files must be placed in the `serverModules` directory defined in `now.config.json`, which defaults to `src/server`
2. **Import Glide APIs explicitly:** In module files, `gs`, `GlideRecord`, and other Glide APIs are NOT automatically available. You must import them from `@servicenow/glide`. Analyze your script for ALL ServiceNow APIs used and import each one.
3. **Exception -- Script Include classes:** When writing Script Include class files (`Class.create` pattern), do NOT import Glide APIs. They are automatically available in Script Include execution context. Only import other Script Include classes from `@servicenow/glide/<scopeName>`.
4. **Use `export`/`import` in modules, `require` in scripts:** Modules use ES module syntax (`export`/`import`). Business rules, script includes, and other server scripts use `require` to consume module exports.
5. **Declare dependencies in package.json:** Third-party npm libraries must be declared in `dependencies`. Never modify versions of existing dependencies unless explicitly requested.
6. **Verify Glide API methods exist:** Only use methods explicitly defined in `@servicenow/glide` type definitions. Do not assume methods exist based on naming conventions.
7. **Use `GlideDateTime` instead of `gs.nowDateTime()`** -- `gs.nowDateTime()` is not allowed in scoped applications.
8. **Use Typescript** for creating module code unless instructed to use Javascript explicitly

## Key Concepts

### Import Patterns

- **Glide APIs in modules:** `import { gs, GlideRecord } from '@servicenow/glide'`
- **Namespaced APIs:** `import { RESTAPIRequest } from '@servicenow/glide/sn_ws_int'`
- **Script Include classes:** `import { MyClass } from '@servicenow/glide/x_my_scope'`
- **Module code in scripts:** `const { myFunction } = require('path/to/module')`

### Script Include Module Rules

This is the most common source of errors:

- **Module files with normal functions** -- MUST import Glide APIs from `@servicenow/glide`
- **Module files with Script Include classes (`Class.create`)** -- must NOT import Glide APIs (they are auto-available)
- **Consuming Script Include classes from other modules** -- import from `@servicenow/glide/<scopeName>`

### Exposing Modules Through Script Includes

Many platform features still require script includes — GlideAjax, cross-scope APIs, and extension points that call script includes by name. When your logic lives in a module but needs to be accessible through these mechanisms, create a script include that acts as a thin bridge using `require()`. See the "Bridging Modules Through Script Includes" section in the `script-include-guide` topic for the full pattern and examples.

### Subpath Imports

Use subpaths in `package.json` to create shorthand imports:

```json
{
    "imports": {
        "#calc": "calculus",
        "#derivative": "calculus/derivative"
    },
    "dependencies": {
        "calculus": "1.0.0"
    }
}
```

Then use the shorthand:

```typescript fluent
import { derivative } from '#derivative'
import * as calculus from '#calc'
```

### Limitations

- Modules work only within the application scope -- no cross-scope module sharing
- Node.js APIs are not supported
- Third-party libraries cannot access ServiceNow APIs such as GlideRecord and other imports from `@servicenow/glide`
- CommonJS modules from third-party libs are supported when bundled through Rollup with the CommonJS plugin (the SDK handles this automatically); see the `npm-libraries-guide` topic for compatible packages
- Modern ECMAScript syntax is largely supported, with some features disallowed for security or platform reasons — see the `javascript-compatibility-guide` topic for details and caveats

## Avoidance

- **Never use Glide APIs without importing them in module files** -- they are NOT globally available in module context
- **Never import Glide APIs in Script Include class files** -- they ARE globally available in that context
- **Never reference Script Include classes via global scope prefix in modules** -- `new x_myapp.MyUtils()` only works in non-module server scripts. In modules, it throws a runtime error (`x_myapp is not defined`). Always use `import { MyUtils } from '@servicenow/glide/x_myapp'` instead.
- **Never use methods not in `@servicenow/glide` type definitions** -- ServiceNow's Glide objects have specific, limited APIs
- **Never modify existing dependency versions in package.json** -- only add new dependencies
- **Never use `gs.nowDateTime()` in scoped apps** -- use `new GlideDateTime().getDisplayValue()` instead

## Examples

### Full Pattern: Business Rule with Module

This is the recommended pattern for server-side scripts. Write the logic in a module file and import it in the `.now.ts` definition:

**Fluent definition** (`src/fluent/business-rules/validate-request.now.ts`):

```typescript fluent
import '@servicenow/sdk/global'
import { BusinessRule } from '@servicenow/sdk/core'
import { validateRequest } from '../../server/business-rules/validate-request'

BusinessRule({
    $id: Now.ID['validate-request'],
    name: 'Validate Request',
    table: 'x_myapp_request',
    when: 'before',
    action: ['insert', 'update'],
    script: validateRequest,
})
```

**Module file** (`src/server/business-rules/validate-request.ts`):

```typescript fluent
import { gs, GlideRecord } from '@servicenow/glide'

export function validateRequest(current: GlideRecord<'x_myapp_request'>, previous: GlideRecord<'x_myapp_request'>) {
    const title = current.getValue('short_description')
    if (!title) {
        gs.addErrorMessage('Short description is required')
        current.setAbortAction(true)
    }
}
```

### Exporting from a Module

```typescript fluent
function myFunction() {}
const myVariable = 'value'

// Named exports for multiple features
export { myFunction, myVariable }
```

### Importing in Another Module

```typescript fluent
import { feature } from 'path/to/module'
```

### Importing in a Server Script (Business Rule, etc.)

```typescript fluent
const { feature } = require('path/to/module')
```

### Importing Glide APIs in a Module

```typescript fluent
import { gs } from '@servicenow/glide'
import { GlideRecord } from '@servicenow/glide'

// Namespaced APIs
import { RESTAPIRequest, RESTAPIResponse } from '@servicenow/glide/sn_ws_int'
```

### Using Script Include Classes from Modules

```typescript fluent
import { RecordUtils } from '@servicenow/glide/x_my_scope'

export function onRecordInsert(current, previous) {
    var recordUtils = new RecordUtils()
}
```

### Adding Dependencies in package.json

```json
{
    "name": "test",
    "version": "1.0.0",
    "dependencies": {
        "math": "1.0.0"
    }
}
```

When adding new dependencies, NEVER modify the versions of existing dependencies. Only add the new entry.

```

---

<a id="topic-data-helpers-guide"></a>

## explain: data-helpers-guide

```text

# Data Helpers

Fluent provides global helper functions for creating typed values in `Record()` data fields.

**IMPORTANT** All helper functions listed here are **global** functions injected into the Fluent runtime. They are **always available in any `.now.ts` file with no `import` statement** — do **not** add them to an `import { ... } from '@servicenow/sdk/core'` line, and do not import them from any module. Importing them is incorrect and will fail.

This is the same mechanism used by the `Now` global (e.g. `Now.ID[...]`), which also requires no import.

Note the contrast in the examples below: constructors like `Record`, `Table`, and column types **are** imported from `@servicenow/sdk/core`, but the data helpers used inside them are **not** — they are simply called directly.

## Duration()

Creates a duration value in ServiceNow format. Used with `DurationColumn` fields.

```typescript fluent
Duration({ days: 1, hours: 6, minutes: 30, seconds: 15 })
// Serialized to: '1970-01-02 06:30:15'
```

### Parameters

| Property | Type | Description |
|----------|------|-------------|
| `days` | `number` | Optional. Number of days |
| `hours` | `number` | Optional. Number of hours |
| `minutes` | `number` | Optional. Number of minutes |
| `seconds` | `number` | Optional. Number of seconds |

### Example

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['my-sla-record'],
    table: 'contract_sla',
    data: {
        name: 'Priority 1 SLA',
        duration: Duration({ days: 0, hours: 4 }),
    },
})
```

## Time()

Creates a time-of-day value in ServiceNow format (UTC). Used with `TimeColumn` fields.

The time is converted from the specified timezone to UTC. If no timezone is provided, the system timezone is used.

```typescript fluent
// System timezone (default)
Time({ hours: 14, minutes: 30, seconds: 0 })

// Explicit timezone — 14:30 EST converts to 19:30 UTC
Time({ hours: 14, minutes: 30, seconds: 0 }, 'America/New_York')

// UTC (no conversion)
Time({ hours: 9, minutes: 0, seconds: 0 }, 'UTC')
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `value.hours` | `number` | Optional. Hour (0-23) |
| `value.minutes` | `number` | Optional. Minutes (0-59) |
| `value.seconds` | `number` | Optional. Seconds (0-59) |
| `timeZone` | `string` | Optional. IANA timezone (e.g., `'America/New_York'`, `'UTC'`). Defaults to system timezone |

### Example

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['daily-job'],
    table: 'sysauto_script',
    data: {
        name: 'Daily Data Processing',
        run_time: Time({ hours: 9, minutes: 0, seconds: 0 }, 'UTC'),
    },
})
```

## TemplateValue()

Creates a template value serialized as a ServiceNow encoded query string. Used with `TemplateValueColumn` fields.

Supports a generic table parameter for type-safe field IntelliSense.

```typescript fluent
// Generic — accepts any key/value pairs
TemplateValue({ cost: 100, description: 'Item', active: true })
// Serialized to: 'cost=100^description=Item^active=true^EQ'

// Table-specific — provides IntelliSense for sc_cat_item fields
TemplateValue<'sc_cat_item'>({ cost: 100, description: 'Item', category: 'Hardware' })
```

### Example

```typescript fluent
import { Table, TableNameColumn, TemplateValueColumn } from '@servicenow/sdk/core'

// TemplateValue() supplies the default for a TemplateValueColumn; the column's
// `dependent` names a TableNameColumn that provides the table context.
export default Table({
    name: 'x_myapp_request',
    label: 'Request',
    schema: {
        referenced_table: TableNameColumn({ label: 'Referenced Table' }),
        field_values: TemplateValueColumn({
            label: 'Field Values',
            dependent: 'referenced_table',
            default: TemplateValue<'sc_req_item'>({
                short_description: 'Laptop setup',
                priority: 2,
            }),
        }),
    },
})
```

## FieldList()

Creates a comma-separated list of field names. Used with `FieldListColumn` and `SlushBucketColumn` fields.

Supports a generic table parameter for type-safe field IntelliSense, including dot-walk paths.

```typescript fluent
// Generic — accepts any strings
FieldList(['name', 'description', 'cost'])
// Serialized to: 'name,description,cost'

// Table-specific — provides IntelliSense and dot-walk support
FieldList<'sc_cat_item'>(['name', 'description', 'cost', 'category', 'assigned_to.name'])
```

### Example

```typescript fluent
import { Table, FieldListColumn, TableNameColumn, Record } from '@servicenow/sdk/core'

Table({
    name: 'x_myapp_config',
    label: 'Config',
    schema: {
        target_table: TableNameColumn({ label: 'Target Table' }),
        display_fields: FieldListColumn({ label: 'Display Fields', dependent: 'target_table' }),
    },
})

Record({
    $id: Now.ID['config-record'],
    table: 'x_myapp_config',
    data: {
        target_table: 'sc_cat_item',
        display_fields: FieldList<'sc_cat_item'>(['name', 'description', 'cost', 'availability']),
    },
})
```

```

---

<a id="topic-now-ref-guide"></a>

## explain: now-ref-guide

```text

# Now.ref

`Now.ref()` creates a reference to a record in another table. Use it when a field needs to point to a record that isn't defined in the current file — for example, referencing a role, a flow, or any record identified by its sys_id or coalesce keys.

> **Note:** `Now` is a **global** available in every `.now.ts` file — it does **not** need to be imported. Do not add `Now` to any `import { ... } from '@servicenow/sdk/core'` line; call `Now.ref()` directly.

## Syntax

```typescript
// By coalesce keys — identifies the record by unique field values
Now.ref(table: string, keys: { [key: string]: string }): any

// By sys_id or Now.ID key — identifies the record by GUID
Now.ref(table: string, guid: string, keys?: { [key: string]: string }): any
```

## Examples

### Reference by coalesce keys

When you know the unique field values that identify a record:

```typescript fluent
import { Acl } from '@servicenow/sdk/core'

Acl({
    $id: Now.ID['incident-read-acl'],
    type: 'record',
    operation: 'read',
    table: 'incident',
    roles: [
        Now.ref('sys_user_role', { name: 'admin' }),
        Now.ref('sys_user_role', { name: 'itil' }),
    ],
})
```

### Reference by sys_id

When you have the record's sys_id:

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['my-catalog-item'],
    table: 'sc_cat_item',
    data: {
        name: 'Request Laptop',
        flow_designer_flow: Now.ref('sys_hub_flow', 'a1b2c3d4e5f67890abcdef1234567890'),
    },
})
```

### Reference by Now.ID key

If the target record is also defined in your Fluent project, you can use its `Now.ID` key as the guid:

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['my-catalog-item'],
    table: 'sc_cat_item',
    data: {
        name: 'Request Laptop',
        flow_designer_flow: Now.ref('sys_hub_flow', 'test_flow_for_service_catalog'),
    },
})
```

### Reference with fallback coalesce keys

Provide both a GUID and coalesce keys — the keys act as a fallback identifier:

```typescript fluent
Now.ref('sys_hub_flow', 'a1b2c3d4...', { name: 'My Flow' })
```

## When to use Now.ref vs direct references

| Scenario | Use |
|----------|-----|
| Record defined in same project | Return value of the API function (e.g., `const role = Role({...})`) |
| Record on the instance, known sys_id | raw sys_id value or `Now.ref('table', 'sys_id')` |
| Record on the instance, known unique fields | `Now.ref('table', { field: 'value' })` |
| Record in same project, different file | Export from other file, and import as variable to use directly |

```

---

<a id="topic-now-include-guide"></a>

## explain: now-include-guide

```text

# Now.include

`Now.include()` populates a record field with the contents of a file at build time. It reads the file and inlines its text into the XML output, keeping source files separate for IDE support (syntax highlighting, IntelliSense, linting).

> **Note:** `Now` is a **global** available in every `.now.ts` file — it does **not** need to be imported. Do not add `Now` to any `import { ... } from '@servicenow/sdk/core'` line; call `Now.include()` directly.

**Where an API supports it, use JavaScript modules instead for server-side scripts.** Modules support `import`/`export`, provide access to typed Glide APIs, and enable code reuse — see the `module-guide` topic. `Now.include()` is always the right choice for **client-side scripts**, **HTML**, and **CSS**, and is also required for server-side APIs whose `script` property only accepts strings.

## When to use Now.include() vs modules

Not all APIs accept module imports. Some `script` properties are typed as `string` only — attempting to pass a module import will produce a compiler or build error. For example, you might see something like `Type '() => void' is not assignable to type 'string'`, though the exact error will vary depending on your module's export shape and the API. When that happens, use `Now.include()`.

**Combining both:** You can write business logic in a module and expose it through a string-only API by creating a thin wrapper script that uses `require()` to load the module. This is common for script includes that need to bridge module code to legacy callers (GlideAjax, cross-scope APIs). See the "Bridging Modules Through Script Includes" section in the `script-include-guide` topic.

| Content type | Recommended approach |
|---|---|
| Business rules, scripted REST routes, script actions, UI actions, scheduled scripts | **Modules** — these APIs accept function types |
| Record producer scripts (`script`, `postInsertScript`) | **Modules** — these APIs accept function types |
| Script includes | **Now.include()** — these APIs only accept strings |
| Client-side scripts (client scripts, catalog client scripts, UI policy scripts) | **Now.include()** — modules are not available in the browser |
| HTML templates (UI Pages, widgets) | **Now.include()** |
| CSS / SCSS (widgets, UI Pages) | **Now.include()** |
| Record API data fields | **Now.include()** — Record data values are strings |
| Any API where a module import causes a compiler/build error | **Now.include()** — fall back when the API doesn't support functions |

## Syntax

```typescript
Now.include(filePath: string): string
```

The file path is **relative to the `.now.ts` file** that contains the call.

## How it works

1. **At build time**: The SDK reads the file and inlines its contents into the XML output field
2. **At transform time** (XML → Fluent): The SDK extracts field content into separate files and generates `Now.include()` calls in the `.now.ts` output

This enables a round-trip workflow where scripts are always maintained as standalone files.

## Supported file types

| Type | Common extensions | Use case |
|------|------------------|----------|
| JavaScript | `.js`, `.client.js` | Client scripts, UI policy scripts, catalog client scripts |
| HTML | `.html` | UI Page HTML, widget templates |
| CSS/SCSS | `.css`, `.scss` | Widget styles, UI Page styles |

## Examples

### Client Script with external file

Client scripts run in the browser where modules are not available, so `Now.include()` is the correct approach:

```typescript fluent
import { ClientScript } from '@servicenow/sdk/core'

ClientScript({
    $id: Now.ID['validate-form'],
    name: 'Validate Form',
    table: 'incident',
    type: 'onSubmit',
    script: Now.include('../../client/validate-form.client.js'),
})
```

```javascript
// client/validate-form.client.js
function onSubmit() {
    var desc = g_form.getValue('short_description');
    if (!desc) {
        g_form.addErrorMessage('Short description is required');
        return false;
    }
    return true;
}
```

### UI Page with HTML, client script, and processing script

```typescript fluent
import { UiPage } from '@servicenow/sdk/core'

UiPage({
    $id: Now.ID['my-ui-page'],
    endpoint: 'my_custom_page.do',
    html: Now.include('../../server/UiPage/my-page.html'),
    clientScript: Now.include('../../server/UiPage/my-page.client-script.client.js'),
    processingScript: Now.include('../../server/UiPage/my-page.processing-script.server.js'),
})
```

### Service Portal Widget

Widgets use `Now.include()` for client scripts, HTML, and CSS. Server scripts in widgets also use `Now.include()` because the widget server script runtime does not support modules.

```typescript fluent
import { SPWidget } from '@servicenow/sdk/core'

SPWidget({
    $id: Now.ID['my-widget'],
    name: 'My Custom Widget',
    clientScript: Now.include('../../server/SPWidget/my-widget.client.js'),
    serverScript: Now.include('../../server/SPWidget/my-widget.server.js'),
    htmlTemplate: Now.include('../../server/SPWidget/my-widget.html'),
    customCss: Now.include('../../server/SPWidget/my-widget.scss'),
})
```

### Record with HTML content

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['my-record'],
    table: 'x_my_table',
    data: {
        name: 'My Record',
        description_html: Now.include('./html/description.html'),
    },
})
```

## Inline scripts (alternative)

For very short client scripts, you can use inline strings instead of `Now.include()`:

```typescript fluent
import { ClientScript } from '@servicenow/sdk/core'

ClientScript({
    $id: Now.ID['simple-onload'],
    name: 'Welcome Message',
    table: 'incident',
    type: 'onLoad',
    script: `function onLoad() {
        g_form.addInfoMessage('Welcome!');
    }`,
})
```

## When to use Now.include()

- **Client-side scripts** — modules are not available in the browser
- **HTML and CSS content** — templates, stylesheets, and markup
- **APIs with string-only script properties** — scheduled scripts, script includes, and others where the TypeScript type is `string` (not `string | function`)
- **Record API data fields** — all Record data values are strings
- **Widget scripts** — the SP widget runtime does not support modules
- **Fallback for any API that rejects a module import** — if the compiler or build reports a type mismatch when you pass a module import to a `script` property, the API is string-only; use `Now.include()`

For server-side scripts in APIs that accept functions (business rules, script actions, scripted REST routes, record producer scripts), prefer JavaScript modules — see the `module-guide` topic.

```

---

<a id="topic-now-attach-guide"></a>

## explain: now-attach-guide

```text

# Now.attach

`Now.attach()` attaches an image file to a record at build time. It reads the file, compresses it, and creates the corresponding `sys_attachment` and `sys_attachment_doc` records in the XML output.

> **Note:** `Now` is a **global** available in every `.now.ts` file — it does **not** need to be imported. Do not add `Now` to any `import { ... } from '@servicenow/sdk/core'` line; call `Now.attach()` directly.

## Syntax

```typescript
Now.attach(path: ImagePath): Image
```

The file path is **relative to the `.now.ts` file** that contains the call.

## Supported image formats

| Extension | Format |
|-----------|--------|
| `.jpg`, `.jpeg` | JPEG |
| `.png` | PNG |
| `.gif` | GIF |
| `.bmp` | Bitmap |
| `.ico` | Icon |
| `.svg` | SVG |

Both lowercase and uppercase extensions are accepted (e.g., `.PNG`, `.JPG`).

## How it works

1. The SDK reads the image file from disk
2. Compresses the file data using gzip
3. Splits the compressed data into base64-encoded chunks
4. Generates a SHA-256 hash for deduplication
5. Creates `sys_attachment` and `sys_attachment_doc` records linked to the parent record

During transform (XML → Fluent), the SDK extracts the attachment data back into an image file and generates a `Now.attach()` call.

## Examples

### Portal with a logo

```typescript fluent
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['my-portal'],
    table: 'sp_portal',
    data: {
        title: 'My Portal',
        url_suffix: 'my-portal',
        icon: Now.attach('../../assets/portal-icon.png'),
    },
})
```

### Reusing the same image across multiple fields

Store the attachment in a variable to avoid reading and compressing the file multiple times:

```typescript fluent
import { Record } from '@servicenow/sdk/core'

const logo = Now.attach('../../assets/company-logo.jpg')

Record({
    $id: Now.ID['portal-a'],
    table: 'sp_portal',
    data: {
        title: 'Portal A',
        url_suffix: 'portal-a',
        icon: logo,
        logo: logo,
    },
})
```

### Sharing an image across multiple records

```typescript fluent
import { Record } from '@servicenow/sdk/core'

const icon = Now.attach('../../assets/app-icon.png')

Record({
    $id: Now.ID['portal-one'],
    table: 'sp_portal',
    data: {
        title: 'Portal One',
        url_suffix: 'portal-one',
        icon: icon,
    },
})

Record({
    $id: Now.ID['portal-two'],
    table: 'sp_portal',
    data: {
        title: 'Portal Two',
        url_suffix: 'portal-two',
        icon: icon,
    },
})
```

## File organization

A common pattern is to keep image assets in an `assets/` directory at the project root:

```
src/
├── fluent/
│   ├── portal.now.ts        ← Now.attach('../../assets/logo.png')
│   └── generated/
│       └── keys.ts
├── assets/
│   ├── logo.png
│   ├── favicon.ico
│   └── banner.jpg
└── now.config.json
```

```

---

<a id="topic-now-del-guide"></a>

## explain: now-del-guide

```text
# Now.del

Marks a record for deletion. When the application is deployed, records marked with `Now.del()` will be removed from the target instance.

## Signatures

```typescript
// Delete by coalesce keys
Now.del(table, keys)

// Delete by sys_id
Now.del(table, sysId)
```

## Parameters

### table

`string` (required)

The target table name (e.g., `'sys_user_role'`, `'sys_hub_flow'`).

### keys

`{ [key: string]: string }` (for coalesce keys signature)

An object of coalesce key-value pairs used to uniquely identify the record to delete.

### sysId

`string` (for sys_id signature)

A 32-character sys_id identifying the record to delete.

## Examples

### Delete by coalesce keys

Use this when you know the identifying fields of the record:

```typescript fluent
// Delete a role by its name
Now.del('sys_user_role', { name: 'x_myapp.obsolete_role' })

// Delete a property by its name
Now.del('sys_properties', { name: 'x_myapp.old_setting' })
```

### Delete by sys_id

Use this to delete OOB (out-of-box) records when you know the sys_id:

```typescript fluent
Now.del('sys_hub_flow', 'a1b2c3d4e5f6789012345678901234ab')
```

> **Note:** For records created in Fluent, prefer removing the code instead of using `Now.del()`. Deletes are tracked automatically when you remove a record definition.

## Notes

- `Now.del()` is a top-level statement only; it cannot be used inline within other record definitions
- Deleted records are written to the `author_elective_update` directory with `action="DELETE"`

```

---

<a id="topic-override-guide"></a>

## explain: override-guide

```text

# `$override` — Setting Properties Not Modeled by the API

`$override` is an escape hatch on Fluent API constructors. Use it to set fields that the typed API does not expose — typically customer-added columns (`x_`/`u_` prefixed), fields added by another application, or out-of-the-box columns that simply aren't in the API surface yet.

## When to Use

- A customer or scoped-application column on the underlying table (e.g. `x_acme_priority`, `u_team`) that the Fluent API doesn't know about.
- A field added by a separate application or plugin on the same table.
- An out-of-the-box column that exists on the platform but isn't surfaced by the API yet.

If the field **is** modeled by the API, set it directly — `$override` skips validation and IntelliSense, so it should be a last resort, not the default.

## Usage

`$override` accepts a flat object of column name → value. Values may be `string`, `boolean`, or `number`.

```typescript
import { BusinessRule, Now } from '@servicenow/sdk/core'

BusinessRule({
    $id: Now.ID['set-priority-on-incident'],
    name: 'Set priority on incident',
    collection: 'incident',
    when: 'before',
    actionInsert: true,
    script: `(function() { current.priority = 1; })()`,
    $override: {
        x_acme_priority: 'high',
        u_audit_enabled: true,
        u_retry_count: 3,
        sys_domain: '4392d3d9b1914057aa60e98b44470255', // sample sys_id of the domain
    },
})
```

The keys in `$override` are the **database column names** (snake_case), not Fluent property names. They are written to the record verbatim during build.

## `sys_*` Fields

Most `sys_*` columns (e.g. `sys_created_by`, `sys_updated_by`, `sys_domain`) can be set through `$override` on **any** table — they aren't limited to specific APIs. A handful of `sys_*` fields are always managed by the build pipeline itself and cannot be overridden: `sys_id`, `sys_scope`, `sys_update_name`, and `sys_domainpath`. Setting one of these is a build **error**, not a silent no-op — remove it or use the corresponding typed API property (e.g. `$id` for `sys_id`) instead.


## `sys_domain` Field

`sys_domain` also gets special treatment on transform: if an existing record's domain isn't the default `"global"`, it's automatically added to the generated `.now.ts`'s `$override` the first time that record is transformed — you don't need to have already written `$override: { sys_domain: ... }` for it to round-trip. Every other allowed field (custom `x_`/`u_` columns aside) only reappears in `$override` on transform once you've explicitly put it there yourself; before that, changes to that column on the instance aren't reflected in generated Fluent code.

`sys_domain` is a reference field — its value must be the **sys_id of the domain record** (table `domain`), not the domain's name.

To find the sys_id of a domain to use with `sys_domain`, query the `domain` table on the instance, filtering by `name` and retrieving the `sys_id` field (see the `query` topic).

## Notes & Gotchas

- **No type checking.** The API doesn't know these columns exist, so typos in column names or wrong value types won't be caught until the record is applied to an instance.
- **Column must exist on the target table.** If the column isn't present on the instance (in the app's own scope or a dependency), install will silently ignore it.
- **Prefer the typed API when available.** If the field is in the API surface, set it through the typed property — you keep IntelliSense, type checking, and refactor safety. Fields already set by the plugin (the same key you already passed as a typed property) are ignored from `$override` with a warning.
- **Reference fields:** pass the target record's sys_id as a string.

## When Not to Use

- Setting fields that *are* modeled by the API — use the defined API property.
- Setting the build-managed fields `sys_id`, `sys_scope`, `sys_update_name`, or `sys_domainpath` — these always error. Use `$id` instead of `sys_id`.

```

---

## CLI reference (real `--help` output)

### now-sdk <top-level> --help

```text

_____   ______ _       __  _____ ____  __  __
___/ | / / __  /|     / / / ___// __ / / /_/
__/  |/ / / / / | /| / / \__ // / / / <
_/ /|  / /_/ /| |/ |/ / ___/ / /_/ / /| |
/_/ |_/_____/ |__/|__/ /____/_____/_/ |_|

Source-driven applications by writing actual code, and using modern,
industry-standard development paradigms.


Commands:
  now-sdk auth                     Configure authentication to instance
  now-sdk init                     Initialize a new ServiceNow custom
                                   application, apply a template to an existing
                                   application, or convert a legacy ServiceNow
                                   application from an instance or directory
                                   within the current directory structure.
                                                               [aliases: create]
  now-sdk download <directory>     Download application metadata from instance.
  now-sdk build [source]           Compile sources into app files and generate
                                   installable package
  now-sdk install                  Install or update application on instance
                                                               [aliases: deploy]
  now-sdk dependencies [sysIds..]  Download configured dependencies in
                                   now.config.json and typescript type
                                   definitions for use in the application
  now-sdk transform                Download and convert XML records from
                                   instance or from a local path into Fluent
                                   source code
  now-sdk clean [source]           Clean output directory
  now-sdk pack [source]            Zip built app into installable artifact
  now-sdk explain [topic]          Display documentation for a Fluent SDK topic
  now-sdk query <table>            Query records from a ServiceNow table on the
                                   instance
  now-sdk cicd <command>           Run sn_cicd operations against an instance
                                   (test suites, app repo install/publish)

Options:
  -d, --debug    Print debug output                   [boolean] [default: false]
  -h, --help     Show help                                             [boolean]
  -v, --version  Show version number                                   [boolean]


Use $now-sdk <command> --help for usage information.

For more information, please visit:
https://docs.servicenow.com/csh?topicname=servicenow-sdk-landing.html
```

### now-sdk auth --help

```text
now-sdk auth

Configure authentication to instance

Add:
      --add    Instance name or url to store authentication credentials for
                                                                        [string]
      --type   Type of authentication to use for new authentication credential
                                            [string] [choices: "basic", "oauth"]
      --alias  The alias to use for new authentication credential       [string]

Delete:
      --delete  Alias of authentication credential to delete            [string]

List:
      --list  List all available authentication credentials            [boolean]

Use:
      --use  Alias of authentication credential to use by default       [string]

Options:
  -d, --debug    Print debug output                   [boolean] [default: false]
  -h, --help     Show help                                             [boolean]
  -v, --version  Show version number                                   [boolean]

Examples:
  now-sdk auth --add                        Adds basic credentials for instance
  https://<instancename>.service-now.com    <instancename>
  --type basic
  now-sdk auth --delete bar                 Deletes saved credentials with alias
                                            bar
  now-sdk auth --use bar                    Sets credentials with alias bar as
                                            default
  now-sdk auth --list                       Lists all saved credentials
  echo "$SN_PASSWORD" | now-sdk auth --add  Stores credentials fully
  https://h --type basic --alias x          non-interactively (pipe password
  --username admin --password-stdin         into stdin)
```

### now-sdk init --help

```text
now-sdk init

Initialize a new ServiceNow custom application, apply a template to an existing
application, or convert a legacy ServiceNow application from an instance or
directory within the current directory structure.

Options:
  -d, --debug        Print debug output               [boolean] [default: false]
      --from         SYS_ID of a legacy application from instance or file path
                     to a directory containing legacy Scoped App to convert into
                     a fluent App                                       [string]
      --appName      Name of ServiceNow App project                     [string]
      --packageName  Package Name for the project, must follow npm naming
                     conventions                                        [string]
      --scopeName    Scope name (Must start with vendor prefix if applicable and
                     cannot be greater than 18 characters)              [string]
  -a, --auth         Credential alias to use for authentication with instance
                                                                        [string]
      --template     Template to use for the project
      [string] [choices: "base", "javascript.aiux", "javascript.aiux-extension",
                     "javascript.basic", "javascript.react", "typescript.basic",
                                           "typescript.react", "typescript.vue"]
  -h, --help         Show help                                         [boolean]
  -v, --version      Show version number                               [boolean]
```

### now-sdk build --help

```text
now-sdk build [source]

Compile sources into app files and generate installable package

Parameters:
  source  Path to the directory that contains package.json configuration
         [string] [default: "C:\Users\umar\SnowDevTeam\servicenow\delivery-app"]

Options:
  -d, --debug            Print debug output           [boolean] [default: false]
      --frozenKeys       Validate that Keys/SysIds are up to date for CI build
                                                      [boolean] [default: false]
      --errorOnConflict  Treat sys_id conflicts between Fluent and XML as errors
                         instead of warnings (Fluent-to-Fluent conflicts are
                         always errors)               [boolean] [default: false]
      --skipClean        Skip cleaning build output directories before building
                                                      [boolean] [default: false]
      --legacyChoices    Generate choice set XML with sys_choice_set wrapper (v3
                         destructive behavior) instead of sys_choice_v2 (v4
                         additive merge)                               [boolean]
  -h, --help             Show help                                     [boolean]
  -v, --version          Show version number                           [boolean]
```

### now-sdk install --help

```text
now-sdk install

Install or update application on instance

Options:
  -d, --debug                 Print debug output      [boolean] [default: false]
      --source                Path to the directory that contains package.json
                              configuration
         [string] [default: "C:\Users\umar\SnowDevTeam\servicenow\delivery-app"]
  -r, --reinstall             Uninstall and reinstall the application on the
                              instance to ensure metadata on instance matches
                              installation package.
                              Warning: Metadata created on-instance that is not
                              present locally will be lost
                                                      [boolean] [default: false]
  -a, --auth                  Credential alias to use for authentication with
                              instance                                  [string]
  -b, --open-browser          Open sys_app page in the default browser on
                              successful install      [boolean] [default: false]
  -i, --info                  Get information from instance for most recent
                              install of this app     [boolean] [default: false]
      --demoData              Install demo data        [boolean] [default: true]
      --skip-flow-activation  Skip activating (publishing) flows after install
                                                      [boolean] [default: false]
  -h, --help                  Show help                                [boolean]
  -v, --version               Show version number                      [boolean]
```

### now-sdk query --help

```text
now-sdk query <table>

Query records from a ServiceNow table on the instance

Parameters:
  table  ServiceNow table name (e.g. incident, sys_user)     [string] [required]

Options:
  -d, --debug                   Print debug output    [boolean] [default: false]
  -q, --query                   Encoded query string (sysparm_query), e.g.
                                "active=true^priority<=2"    [string] [required]
      --limit                   Maximum records per page (sysparm_limit)
                                                         [number] [default: 100]
      --offset                  Starting offset (sysparm_offset)
                                                           [number] [default: 0]
  -f, --fields                  Comma-separated list of fields to return
                                (sysparm_fields)                        [string]
      --display-value           Return display values (sysparm_display_value):
                                "true", "false", or "all" for both
                            [choices: "true", "false", "all"] [default: "false"]
      --exclude-reference-link  Exclude reference link metadata
                                (sysparm_exclude_reference_link)
                                                       [boolean] [default: true]
      --no-count                Skip total count calculation for better
                                performance (sysparm_no_count)
                                                      [boolean] [default: false]
      --timeout                 Per-request timeout in milliseconds. Each page
                                fetch is bounded by this value.
                                                       [number] [default: 30000]
      --view                    UI view to determine which fields to return
                                (sysparm_view)                          [string]
      --query-category          Query category for extended queries
                                (sysparm_query_category)                [string]
      --query-no-domain         Ignore domain separation when querying
                                (sysparm_query_no_domain)
                                                      [boolean] [default: false]
  -a, --auth                    Credential alias to use for authentication with
                                instance                                [string]
  -o, --output                  Output format: json for a machine-readable
                                envelope, raw to unquote the --select result
                                               [string] [choices: "json", "raw"]
  -s, --select                  Dot/bracket path to extract from the output
                                (e.g. "records[0].sys_id"). Implies
                                machine-readable output; pair with --output raw
                                for direct use in shell command substitution.
                                                                        [string]
  -h, --help                    Show help                              [boolean]
  -v, --version                 Show version number                    [boolean]
```

