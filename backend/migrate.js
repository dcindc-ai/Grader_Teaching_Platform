// migrate.js — runs on every startup, safe to run repeatedly
// Adds missing columns without touching existing data

function migrate(db) {
  const migrations = [
    // Courses
    "ALTER TABLE courses ADD COLUMN grading_model TEXT DEFAULT 'rubric'",
    "ALTER TABLE courses ADD COLUMN response_defaults TEXT DEFAULT '{}'",

    // Assignments
    "ALTER TABLE assignments ADD COLUMN rubric_criteria TEXT",

    // Grades
    "ALTER TABLE grades ADD COLUMN instructor_paragraph TEXT",
    "ALTER TABLE grades ADD COLUMN student_id TEXT",
    "ALTER TABLE grades ADD COLUMN resources TEXT DEFAULT '[]'",
    "ALTER TABLE grades ADD COLUMN original_file_path TEXT",
    "ALTER TABLE grades ADD COLUMN annotated_file_path TEXT",
    "ALTER TABLE grades ADD COLUMN summary TEXT",
    "ALTER TABLE grades ADD COLUMN key_strength TEXT",
    "ALTER TABLE grades ADD COLUMN key_improvement TEXT",

    "ALTER TABLE assignments ADD COLUMN target_avg REAL DEFAULT 4.5",
    "ALTER TABLE assignments ADD COLUMN grading_strictness TEXT DEFAULT 'standard'",
    "ALTER TABLE assignments ADD COLUMN grading_guidance TEXT DEFAULT ''",

    // Materials
    "ALTER TABLE materials ADD COLUMN material_type TEXT DEFAULT 'lecture'",

    // Student record expansion
    "ALTER TABLE students ADD COLUMN first_name TEXT",
    "ALTER TABLE students ADD COLUMN last_name TEXT",
    "ALTER TABLE students ADD COLUMN preferred_name TEXT",
    "ALTER TABLE students ADD COLUMN nickname TEXT",
    "ALTER TABLE students ADD COLUMN notes TEXT",
    "ALTER TABLE students ADD COLUMN photo_url TEXT",

    // Always-On
    "ALTER TABLE always_on ADD COLUMN review_notes TEXT",
  ];

  for (const sql of migrations) {
    try {
      db.prepare(sql).run();
      const col = sql.match(/ADD COLUMN (\w+)/)?.[1];
      if (col) console.log(`  ✓ migration: added column ${col}`);
    } catch (e) {
      // Column already exists — skip silently
      if (!e.message.includes('duplicate column')) {
        console.error(`  Migration warning: ${e.message}`);
      }
    }
  }
}

module.exports = { migrate };
