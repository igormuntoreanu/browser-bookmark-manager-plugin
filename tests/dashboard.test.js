"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { analyze } = require("../analyzer.js");

class Element {
  constructor() {
    this.children = [];
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.open = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this[name] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function setup(tree, getTree, remove = async () => {}, extras = {}) {
  const ids = ["scan", "status", "results", "bookmark-count", "duplicate-count",
    "similar-count", "folder-count", "title-count", "duplicates", "similar", "folders", "titles",
    "search", "search-status", "search-results", "action-status", "confirmation",
    "confirmation-form", "dialog-title", "dialog-details", "dialog-fields", "dialog-error",
    "dialog-cancel", "dialog-confirm"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const context = {
    document: {
      getElementById: (id) => nodes[id],
      createElement: () => new Element()
    },
    chrome: {
      bookmarks: { getTree: getTree || (async () => tree), remove, ...extras.bookmarks },
      permissions: extras.permissions
    },
    BookmarkAnalysis: { analyze },
    console: { error() {} },
    URL, AbortController, setTimeout, clearTimeout,
    fetch: extras.fetch
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "dashboard.js"), "utf8"), context);
  return nodes;
}

test("renders a scan, reports errors, and retries successfully", async () => {
  let shouldFail = false;
  const tree = [{ children: [
    { title: "<img src=x>", url: "https://example.com" },
    { title: " Example  title ", url: "https://example.com" }
  ] }];
  const nodes = setup(tree, async () => {
    if (shouldFail) throw new Error("Permission denied");
    return tree;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes["bookmark-count"].textContent, 2);
  assert.equal(nodes["duplicate-count"].textContent, 1);
  assert.equal(nodes["folder-count"].textContent, 1);
  assert.equal(nodes["title-count"].textContent, 1);
  assert.equal(nodes.results.hidden, false);
  const firstTitle = nodes.duplicates.children[0].children[1].children[0].children[0];
  assert.equal(firstTitle.textContent, "<img src=x>");

  shouldFail = true;
  await nodes.scan.click();
  assert.match(nodes.status.textContent, /Permission denied/);
  assert.equal(nodes.results.hidden, true);
  assert.equal(nodes.scan.disabled, false);

  shouldFail = false;
  await nodes.scan.click();
  assert.match(nodes.status.textContent, /Scan complete/);
  assert.equal(nodes.results.hidden, false);
});

test("link checks require confirmation and permission, and omit credentials", async () => {
  const tree = [{ children: [
    { id: "1", title: "One", url: "https://example.com" },
    { id: "2", title: "Two", url: "https://example.com" }
  ] }];
  let allowed = false;
  const permissions = [];
  const requests = [];
  const nodes = setup(tree, undefined, undefined, {
    permissions: { request: async (value) => { permissions.push(value); return allowed; } },
    fetch: async (url, options) => { requests.push({ url, options }); return { status: 204, type: "basic" }; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  const checkButton = nodes.duplicates.children[0].children[1].children[0].children[3].children[3];
  checkButton.click();
  assert.equal(permissions.length, 0);
  assert.equal(requests.length, 0);
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.match(nodes["dialog-error"].textContent, /not granted/);
  assert.equal(requests.length, 0);

  allowed = true;
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.deepEqual(Array.from(permissions[1].origins), ["https://example.com/*"]);
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.redirect, "manual");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  assert.match(nodes["action-status"].textContent, /HTTP 204/);
});

test("link checks report redirects and network errors without treating them as broken", async () => {
  const tree = [{ children: [
    { id: "1", title: "One", url: "https://example.com" },
    { id: "2", title: "Two", url: "https://example.com" }
  ] }];
  let fails = false;
  const nodes = setup(tree, undefined, undefined, {
    permissions: { request: async () => true },
    fetch: async () => {
      if (fails) throw new Error("Network unavailable");
      return { status: 0, type: "opaqueredirect" };
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  const checkButton = () => nodes.duplicates.children[0].children[1].children[0].children[3].children[3];
  checkButton().click();
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.match(nodes["action-status"].textContent, /redirect.*not followed/);
  fails = true;
  checkButton().click();
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.match(nodes["dialog-error"].textContent, /Network unavailable/);
});

test("deletion requires confirmation and refuses stale bookmark data", async () => {
  const first = { id: "1", parentId: "folder", title: "One", url: "https://example.com" };
  const second = { id: "2", parentId: "folder", title: "Two", url: "https://example.com" };
  const tree = [{ id: "root", children: [{ id: "folder", parentId: "root", title: "Folder", children: [first, second] }] }];
  const deleted = [];
  const nodes = setup(tree, undefined, async (id) => { deleted.push(id); });
  await new Promise((resolve) => setImmediate(resolve));
  const deleteButton = nodes.duplicates.children[0].children[1].children[0].children[3].children[0];
  deleteButton.click();
  assert.equal(nodes.confirmation.open, true);
  assert.deepEqual(deleted, []);
  nodes["dialog-cancel"].click();
  assert.deepEqual(deleted, []);

  deleteButton.click();
  first.title = "Changed elsewhere";
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.match(nodes["dialog-error"].textContent, /changed/);
  assert.deepEqual(deleted, []);
  first.title = "One";
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.deepEqual(deleted, ["1"]);
  assert.equal(nodes.confirmation.open, false);
});

test("rename, move, and folder creation each wait for confirmation", async () => {
  const first = { id: "1", parentId: "a", title: "One", url: "https://example.com" };
  const second = { id: "2", parentId: "a", title: "Two", url: "https://example.com" };
  const folderA = { id: "a", parentId: "root", title: "A", children: [first, second] };
  const folderB = { id: "b", parentId: "root", title: "B", children: [] };
  const tree = [{ id: "root", children: [folderA, folderB] }];
  const calls = [];
  const nodes = setup(tree, undefined, undefined, { bookmarks: {
    update: async (id, changes) => { calls.push(["update", id, changes.title]); first.title = changes.title; },
    move: async (id, changes) => {
      calls.push(["move", id, changes.parentId]);
      folderA.children = folderA.children.filter((item) => item.id !== id);
      first.parentId = changes.parentId;
      folderB.children.push(first);
    },
    create: async (changes) => { calls.push(["create", changes.parentId, changes.title]); }
  } });
  await new Promise((resolve) => setImmediate(resolve));
  const duplicateRow = () => nodes.duplicates.children[0].children[1].children[0];
  duplicateRow().children[3].children[1].click();
  nodes["dialog-fields"].children[0].children[0].value = "New name";
  assert.deepEqual(calls, []);
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.deepEqual(calls, [["update", "1", "New name"]]);

  duplicateRow().children[3].children[2].click();
  nodes["dialog-fields"].children[0].children[0].value = "b";
  assert.equal(calls.length, 1);
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.deepEqual(calls[1], ["move", "1", "b"]);

  nodes.folders.children[0].children[1].children[0].click();
  nodes["dialog-fields"].children[0].children[0].value = "Example";
  nodes["dialog-fields"].children[1].children[0].value = "a";
  assert.equal(calls.length, 2);
  await nodes["confirmation-form"].submit({ preventDefault() {} });
  assert.deepEqual(calls[2], ["create", "a", "Example"]);
});
