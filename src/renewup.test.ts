import assert from "node:assert";
import { test } from "node:test";
import { due, newer, outcome } from "./renewup.ts";

test("outcome", () => {
	assert.match(outcome("Updated 2 packages:\n  npm:pi-lens")!, /\/reload/);
	assert.match(outcome("Updated 1 package:\nUpdated pi from 1.5.2 to 1.5.3")!, /Restart/);
	assert.equal(outcome("Packages are already up to date\npi is already up to date (v1.5.2)"), undefined);
});

test("newer", () => {
	assert.equal(newer("1.5.10", "1.5.9"), true);
	assert.equal(newer("1.5.2", "1.5.2"), false);
	assert.equal(newer("1.5.2", "1.6.0"), false);
});

test("due", () => {
	assert.equal(due(0, Date.now()), true);
	assert.equal(due(Date.now() - 60_000, Date.now()), false);
});
