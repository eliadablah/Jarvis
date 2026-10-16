import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConnectorArgs, connectorScope, CODEX_CONNECTORS } from "../src/brain/connectorConfig.ts";

function overrides(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-c") continue;
    const entry = args[++i]!;
    const separator = entry.indexOf("=");
    values.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  return values;
}

test("account tools are off until the server explicitly enables connectors", () => {
  assert.deepEqual(buildConnectorArgs(), ["--disable", "apps"]);
  assert.deepEqual(buildConnectorArgs(false), ["--disable", "apps"]);
  assert.deepEqual(buildConnectorArgs("false" as unknown as boolean), ["--disable", "apps"]);
  assert.deepEqual(buildConnectorArgs(true, "none"), ["--disable", "apps"]);
  assert.deepEqual(buildConnectorArgs(true, "unknown" as "none"), ["--disable", "apps"]);
});

test("current requests select only relevant account tools", () => {
  for (const message of ["Hello", "What is a subnet?", "Explain the JavaScript event loop", "Complete my study task"])
    assert.equal(connectorScope(message), "none", message);
  for (const message of ["Read my unread inbox", "What bills are due?", "Find the recruiter email", "Open my messages"])
    assert.equal(connectorScope(message), "gmail", message);
  for (const message of ["Show my calendar", "What meetings are scheduled?", "Find upcoming events", "When is my interview?"])
    assert.equal(connectorScope(message), "calendar", message);
  for (const message of ["Brief me", "Morning briefing", "Read my email and upcoming meetings"])
    assert.equal(connectorScope(message), "both", message);
});

test("single-connector scopes cannot enable the other connector", () => {
  const gmail = overrides(buildConnectorArgs(true, "gmail"));
  const calendar = overrides(buildConnectorArgs(true, "calendar"));
  assert.equal(gmail.get(`apps.${CODEX_CONNECTORS.gmail.id}.enabled`), "true");
  assert.notEqual(gmail.get(`apps.${CODEX_CONNECTORS.calendar.id}.enabled`), "true");
  assert.equal(calendar.get(`apps.${CODEX_CONNECTORS.calendar.id}.enabled`), "true");
  assert.notEqual(calendar.get(`apps.${CODEX_CONNECTORS.gmail.id}.enabled`), "true");
  for (const config of [gmail, calendar]) assert.equal(config.get("apps._default.enabled"), "false");
});

test("read-only connectors deny all unknown apps, future tools, and account writes", () => {
  const args = buildConnectorArgs(true);
  const config = overrides(args);
  assert.equal(config.get("apps._default.enabled"), "false");
  assert.equal(config.get("apps._default.destructive_enabled"), "false");
  assert.equal(config.get("apps._default.open_world_enabled"), "false");
  for (const connector of Object.values(CODEX_CONNECTORS)) {
    const prefix = `apps.${connector.id}`;
    assert.equal(config.get(`${prefix}.enabled`), "true");
    assert.equal(config.get(`${prefix}.default_tools_enabled`), "false");
    assert.equal(config.get(`${prefix}.destructive_enabled`), "false");
    for (const tool of ["send_email", "send_draft", "create_draft", "archive_emails", "delete_emails",
      "create_event", "update_event", "delete_event", "respond_event", "new_future_tool"]) {
      assert.notEqual(config.get(`${prefix}.tools.${tool}.enabled`), "true");
    }
  }
  assert.ok([...config.entries()].filter(([key, value]) => key.includes(".tools.") && value === "true")
    .every(([key]) => /\.(?:get_|list_|search_|read_|batch_read_)/.test(key)));
  assert.ok(!args.some(arg => /approval_mode|bypass|sandbox|shell|exec|browser/.test(arg)));
});
