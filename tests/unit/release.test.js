import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("release permissions remain user initiated, offline, and explicitly exclude incognito", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.incognito, "not_allowed");
  assert.equal(manifest.minimum_chrome_version, "147");
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "scripting",
    "storage",
    "unlimitedStorage",
    "clipboardWrite",
  ]);
  assert.ok(
    manifest.content_security_policy.extension_pages.includes(
      "connect-src 'self'",
    ),
  );
  assert.ok(!/https?:/.test(manifest.content_security_policy.extension_pages));
});
