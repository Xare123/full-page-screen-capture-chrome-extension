import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function style(initial = {}) {
  const values = new Map(
    Object.entries(initial).map(([key, value]) => [key, [value, "important"]]),
  );
  return {
    get cssText() {
      return [...values]
        .map(
          ([name, [value, priority]]) =>
            `${name}:${value}${priority === "important" ? "!important" : ""}`,
        )
        .join(";");
    },
    set cssText(text) {
      values.clear();
      for (const declaration of text.split(";").filter(Boolean)) {
        const colon = declaration.indexOf(":");
        if (colon < 0) continue;
        const name = declaration.slice(0, colon).trim(),
          value = declaration.slice(colon + 1).trim();
        values.set(name, [
          value.replace(/!important\s*$/, "").trim(),
          /!important\s*$/.test(value) ? "important" : "",
        ]);
      }
    },
    [Symbol.iterator]: () => values.keys(),
    getPropertyValue: (key) => values.get(key)?.[0] || "",
    getPropertyPriority: (key) => values.get(key)?.[1] || "",
    setProperty: (key, value, priority) => values.set(key, [value, priority]),
    removeProperty: (key) => values.delete(key),
  };
}
async function harness() {
  const timers = new Map();
  let timerId = 0,
    listener;
  const attributes = new Map();
  const sticky = {
    style: style({ position: "sticky" }),
    hasAttribute(name) {
      return this.getAttribute(name) !== null;
    },
    getAttribute(name) {
      return name === "style"
        ? this.style.cssText || null
        : (attributes.get(name) ?? null);
    },
    removeAttribute(name) {
      if (name === "style") this.style.cssText = "";
      else attributes.delete(name);
    },
    setAttribute(name, value) {
      if (name === "style") this.style.cssText = value;
      else attributes.set(name, value);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 100,
      width: 800,
      height: 60,
    }),
  };
  const sandbox = {
    console,
    MutationObserver: class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
    setTimeout: (fn, ms) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    scrollX: 17,
    scrollY: 49,
    addEventListener() {},
    document: {
      body: { scrollWidth: 800, scrollHeight: 1200 },
      documentElement: {
        scrollWidth: 800,
        clientWidth: 800,
        scrollHeight: 1200,
        clientHeight: 600,
        append() {},
      },
      fonts: { ready: Promise.resolve() },
      createElement: () => ({ style: style(), remove() {} }),
      querySelectorAll: () => [sticky],
    },
    chrome: {
      runtime: {
        id: "studio",
        onMessage: {
          addListener: (fn) => {
            listener = fn;
          },
        },
      },
    },
    getComputedStyle: (node) => ({
      position: node.style.getPropertyValue("position") || "static",
      display: "block",
      getPropertyValue: () => "0px",
    }),
  };
  sandbox.window = sandbox;
  sandbox.scrollTo = ({ left, top }) => {
    sandbox.scrollX = left;
    sandbox.scrollY = top;
  };
  vm.runInNewContext(
    await readFile(new URL("../../src/content.js", import.meta.url), "utf8"),
    sandbox,
  );
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const send = (type) => {
    let response;
    listener(
      { type: `CS_PAGE_${type}`, mode: "full" },
      { id: "studio" },
      (value) => {
        response = value;
      },
    );
    return () => response;
  };
  const tick = async (ms) => {
    const entry = [...timers.entries()].find(([, value]) => value.ms === ms);
    assert.ok(entry, `Expected ${ms}ms timer`);
    timers.delete(entry[0]);
    entry[1].fn();
    await flush();
  };
  return { sandbox, sticky, send, tick, flush };
}

test("cancelling during the final lazy-load delay never scrolls after restoration", async () => {
  const { sandbox, send, tick, flush } = await harness();
  const result = send("PREPARE");
  await tick(120);
  await tick(70);
  assert.equal(sandbox.scrollY, 600);
  send("RESTORE");
  await flush();
  assert.equal(sandbox.scrollX, 17);
  assert.equal(sandbox.scrollY, 49);
  await tick(70);
  assert.equal(sandbox.scrollX, 17);
  assert.equal(sandbox.scrollY, 49);
  assert.equal(result().ok, false);
  assert.match(result().error, /cancelled/);
});
test("sticky elements retain normal-flow content and exact original inline positioning", async () => {
  const { sticky, send, flush, tick } = await harness();
  send("PREPARE");
  await tick(120);
  assert.equal(sticky.style.getPropertyValue("position"), "relative");
  send("RESTORE");
  await flush();
  assert.equal(sticky.style.getPropertyValue("position"), "sticky");
  assert.equal(sticky.style.getPropertyPriority("position"), "important");
});
