"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze } = require("../analyzer.js");

test("finds exact duplicates across folders and keeps their locations", () => {
  const result = analyze([{
    title: "",
    children: [
      { title: "Bar", children: [{ id: "1", title: "One", url: "https://example.com/a" }] },
      { title: "Other", children: [
        { id: "2", title: "Two", url: "https://example.com/a" },
        { id: "3", title: "Different", url: "https://example.com/a/" }
      ] }
    ]
  }]);
  assert.equal(result.bookmarkCount, 3);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(result.duplicates[0].items.map((item) => item.folder), ["Bar", "Other"]);
  assert.equal(result.folders[0].host, "example.com");
  assert.equal(result.folders[0].items.length, 3);
});

test("suggests only nonempty titles that need whitespace cleanup", () => {
  const result = analyze([{ children: [
    { id: "1", title: "  Learn \t JavaScript  ", url: "https://example.com" },
    { id: "2", title: "Already clean", url: "https://example.org" },
    { id: "3", title: "  ", url: "https://example.net" }
  ] }]);
  assert.equal(result.titles.length, 1);
  assert.equal(result.titles[0].suggestedTitle, "Learn JavaScript");
  assert.equal(result.titles[0].bookmark.folder, "Bookmarks");
});

test("does not group invalid or non-web URLs by website but still detects duplicates", () => {
  const result = analyze([{ children: [
    { title: "One", url: "not a url" },
    { title: "Two", url: "not a url" },
    { title: "Three", url: "file:///test" },
    { title: "Four", url: "file:///other" }
  ] }]);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.folders.length, 0);
});

test("handles an empty tree", () => {
  assert.deepEqual(analyze([]), {
    bookmarkCount: 0, bookmarks: [], destinations: [], duplicates: [], similar: [], folders: [], titles: []
  });
});

test("suggests similar web links without treating them as exact duplicates", () => {
  const result = analyze([{ children: [
    { title: "One", url: "https://example.com/a?utm_source=news&id=1" },
    { title: "Two", url: "https://example.com/a?id=1" },
    { title: "Different page", url: "https://example.com/a?id=2" },
    { title: "Different fragment", url: "https://example.com/a?id=1#part" }
  ] }]);
  assert.equal(result.duplicates.length, 0);
  assert.equal(result.similar.length, 1);
  assert.deepEqual(result.similar[0].items.map((item) => item.title), ["One", "Two"]);
});

test("excludes managed folders and bookmarks from editing destinations", () => {
  const result = analyze([{ id: "0", children: [
    { id: "1", parentId: "0", title: "Managed", unmodifiable: "managed", children: [
      { id: "2", parentId: "1", title: "Nested", children: [
        { id: "3", parentId: "2", title: "Link", url: "https://example.com" }
      ] }
    ] },
    { id: "4", parentId: "0", title: "Editable", children: [] }
  ] }]);
  assert.deepEqual(result.destinations.map((item) => item.id), ["4"]);
  assert.equal(result.bookmarks[0].unmodifiable, true);
});
