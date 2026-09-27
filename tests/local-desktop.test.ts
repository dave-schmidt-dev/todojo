import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const record = readFileSync(resolve("evals/results.md"), "utf8");
const allowed = new Set(["pass", "fail", "untested"]);

test("A-M record distinguishes automated, Codex, and ChatGPT observations", () => {
  const rows = record
    .split("\n")
    .filter((line) => /^\| [A-M] \|/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  assert.deepEqual(
    rows.map((row) => row[0]),
    "ABCDEFGHIJKLM".split(""),
  );
  for (const row of rows) {
    assert.equal(row.length, 6, `${row[0]} must have six columns`);
    for (const cell of row.slice(2, 5))
      assert.ok(allowed.has(cell), `${row[0]} has invalid status ${cell}`);
    if (row.slice(2, 5).includes("untested"))
      assert.ok(row[5].length >= 20, `${row[0]} needs an exact limit`);
  }
  const allLivePassed = rows.every(
    (row) => row[3] === "pass" && row[4] === "pass",
  );
  if (!allLivePassed) assert.match(record, /Status is \*\*incomplete\*\*/);
});

test("activation record keeps every category and trial count explicit", () => {
  const categories = [
    "Explicit plan",
    "Multi-file implementation",
    "Debug investigation",
    "Research and delivery",
    "Resume existing plan",
    "Negative activation",
  ];
  const rows = record
    .split("\n")
    .filter((line) =>
      categories.some((category) => line.startsWith(`| ${category} |`)),
    )
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  assert.deepEqual(
    rows.map((row) => row[0]),
    categories,
  );
  for (const row of rows) {
    assert.equal(row.length, 6);
    for (const count of [row[1], row[3]]) {
      assert.match(count, /^[0-5]\/5$/);
    }
    for (const status of [row[2], row[4]])
      assert.ok(allowed.has(status), `${row[0]} has invalid status ${status}`);
    if (row[2] === "pass")
      assert.ok(
        Number(row[1][0]) >= (row[0] === "Negative activation" ? 5 : 4),
      );
    if (row[4] === "pass")
      assert.ok(
        Number(row[3][0]) >= (row[0] === "Negative activation" ? 5 : 4),
      );
    if (row[2] === "untested" || row[4] === "untested")
      assert.ok(row[5].length >= 20);
  }
});
