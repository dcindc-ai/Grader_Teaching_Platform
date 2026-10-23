// An in-memory database with the real schema, for tests.
//
// applySchema() creates the original tables; migrate() adds the columns that
// arrived later (score_cap, target_avg, grading_strictness, grading_guidance,
// canvas_assignment_id, ...). Both are required — the real database is the
// product of both, so a fixture running only the first would let tests pass
// against a schema production does not have.

const { DatabaseSync } = require('node:sqlite');
const { applySchema } = require('../../schema');
const { migrate } = require('../../migrate');

function makeTestDb() {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  migrate(db);
  return db;
}

module.exports = { makeTestDb };
