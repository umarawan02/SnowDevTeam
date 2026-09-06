/**
 * SDTNativeEngine — Script Include (GLOBAL scope) backing the SnowDevTeam
 * Native Engine Scripted REST resource (NATIVE_ENGINE_BRIEF Phase 5).
 *
 * Installed by `scripts/setup-native-engine.mts` as a `sys_script_include`.
 * The two `sys_ws_operation` scripts are one-liners that delegate here:
 *   GET  /api/global/sdt_native/session  → new SDTNativeEngine().session()
 *   POST /api/global/sdt_native/apply    → new SDTNativeEngine().apply(request, response)
 *
 * Why this exists: a headless REST session cannot make an update set current
 * (docs/servicenow-smoke-findings.md open items #1/#2) — a `sys_update_set`
 * preference write is stored but not honoured, so Table API writes leak to the
 * scope's Default set. This runs the write server-side with
 * `new GlideUpdateSet().set()` first, so the ticket's update set captures it.
 *
 * This file is the source of truth; the setup script pushes it verbatim into
 * the script include's `script` field. Keep it lint-clean under
 * src/lib/nativeengine/lint.ts.
 */

/* eslint-disable */
var SDTNativeEngine = Class.create();

SDTNativeEngine.prototype = {
  initialize: function () {},

  /** Current update set sys_id for this session, or "". */
  _currentUpdateSetId: function () {
    return "" + (gs.getPreference("sys_update_set") || "");
  },

  /** GET /session — what scope + update set is current for the caller. */
  session: function () {
    return {
      currentUpdateSet: this._currentUpdateSetId(),
      currentScope: gs.getCurrentApplicationId(),
      user: gs.getUserName(),
    };
  },

  /**
   * POST /apply — body { scopeSysId, updateSetSysId, change }, one change at a
   * time. `change` = { table, op:"insert"|"update", coalesceQuery?, sysId?,
   * fields } with every field value already resolved to a primitive by
   * apply.ts (no $ref / $lookup here).
   */
  apply: function (request, response) {
    var body = request.body && request.body.data ? request.body.data : {};
    var updateSetSysId = body.updateSetSysId;
    var scopeSysId = body.scopeSysId;
    var change = body.change;

    if (!updateSetSysId || !change || !change.table || !change.op) {
      response.setStatus(400);
      return { ok: false, error: "updateSetSysId and a well-formed change are required" };
    }
    if (change.op !== "insert" && change.op !== "update") {
      response.setStatus(400);
      return { ok: false, error: 'change.op must be "insert" or "update"' };
    }

    // 1. Make the ticket's update set current for this server session — the
    //    whole reason the resource exists.
    new GlideUpdateSet().set(updateSetSysId);

    // 2. Verify — set() fails silently on a bad sys_id or scope mismatch.
    var curSet = this._currentUpdateSetId();
    if (curSet !== updateSetSysId) {
      response.setStatus(409);
      return {
        ok: false,
        error: "update set is not current after set() — bad sys_id or scope mismatch",
        wanted: updateSetSysId,
        got: curSet,
      };
    }
    var curScope = gs.getCurrentApplicationId();
    if (scopeSysId && scopeSysId !== "global" && curScope !== scopeSysId) {
      // Phase 5 supports Global targets only; a scoped target needs a resource
      // running in that scope. Surface it, don't write to the wrong place.
      response.setStatus(409);
      return { ok: false, error: "resource runs in Global; scoped-app apply is not supported yet", wanted: scopeSysId, got: curScope };
    }

    // 3. Locate or initialize the record.
    var gr = new GlideRecord(change.table);
    var found = false;
    if (change.sysId) {
      found = gr.get(change.sysId);
      if (!found) {
        response.setStatus(404);
        return { ok: false, error: "no " + change.table + " with sys_id " + change.sysId };
      }
    } else if (change.coalesceQuery) {
      gr.addEncodedQuery(change.coalesceQuery);
      gr.setLimit(1);
      gr.query();
      found = gr.next();
    }
    if (change.op === "update" && !found) {
      response.setStatus(404);
      return { ok: false, error: "no existing " + change.table + " matched for update (" + (change.coalesceQuery || "") + ")" };
    }
    if (!found) {
      gr.initialize();
    }

    // 4. Apply fields and write. setWorkflow(true) — business rules and
    //    update-set capture must run.
    var fields = change.fields || {};
    for (var f in fields) {
      if (fields.hasOwnProperty(f)) {
        gr.setValue(f, fields[f]);
      }
    }
    gr.setWorkflow(true);

    var sysId;
    var operation;
    if (found) {
      gr.update();
      sysId = gr.getUniqueValue();
      operation = "updated";
    } else {
      sysId = gr.insert();
      operation = "inserted";
    }
    if (!sysId) {
      response.setStatus(422);
      return { ok: false, error: "write to " + change.table + " returned no sys_id — check ACLs / mandatory fields" };
    }

    return {
      ok: true,
      sysId: "" + sysId,
      table: change.table,
      operation: operation,
      currentUpdateSet: curSet,
      currentScope: curScope,
    };
  },

  type: "SDTNativeEngine",
};
