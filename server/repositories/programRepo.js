const db = require('../db/sqlite');

// helpers to ensure tables exist (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS programs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    gates      INTEGER NOT NULL DEFAULT 8,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TRIGGER IF NOT EXISTS trg_programs_updated_at
  AFTER UPDATE ON programs
  FOR EACH ROW BEGIN
    UPDATE programs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
  END;

  CREATE TABLE IF NOT EXISTS recipes (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL UNIQUE,
    piece_min_weight_g    REAL NOT NULL,
    piece_max_weight_g    REAL NOT NULL,
    batch_min_weight_g    REAL,
    batch_max_weight_g    REAL,
    min_pieces_per_batch  INTEGER,
    max_pieces_per_batch  INTEGER,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TRIGGER IF NOT EXISTS trg_recipes_updated_at
  AFTER UPDATE ON recipes
  FOR EACH ROW BEGIN
    UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
  END;

  CREATE TABLE IF NOT EXISTS program_gate_recipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id  INTEGER NOT NULL,
    gate_number INTEGER NOT NULL,  -- 0 = reject stream
    recipe_id   INTEGER NOT NULL,
    UNIQUE (program_id, gate_number),
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id)  REFERENCES recipes(id)  ON DELETE RESTRICT
  );
`);

const q = {
  allRecipes: db.prepare(`SELECT * FROM recipes ORDER BY name`),

  allPrograms: db.prepare(`
    SELECT p.id, p.name, p.gates, p.created_at, p.updated_at,
           COUNT(pgr.id) AS mapped
    FROM programs p
    LEFT JOIN program_gate_recipes pgr ON pgr.program_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.id DESC
  `),

  programById: db.prepare(`SELECT * FROM programs WHERE id = ?`),

  mappingByProgram: db.prepare(`
    SELECT pgr.gate_number AS gate, pgr.recipe_id, r.name AS recipe_name
    FROM program_gate_recipes pgr
    JOIN recipes r ON r.id = pgr.recipe_id
    WHERE pgr.program_id = ?
    ORDER BY pgr.gate_number ASC
  `),

  insertProgram: db.prepare(`INSERT INTO programs (name, gates) VALUES (?, ?)`),
  upsertMapping: db.prepare(`
    INSERT INTO program_gate_recipes (program_id, gate_number, recipe_id)
    VALUES (@program_id, @gate, @recipe_id)
    ON CONFLICT(program_id, gate_number)
    DO UPDATE SET recipe_id = excluded.recipe_id
  `),
  clearMapping: db.prepare(`DELETE FROM program_gate_recipes WHERE program_id = ?`),
  renameProgram: db.prepare(`UPDATE programs SET name = ? WHERE id = ?`),
  updateGates: db.prepare(`UPDATE programs SET gates = ? WHERE id = ?`),
  deleteProgram: db.prepare(`DELETE FROM programs WHERE id = ?`)
};

function listRecipes() {
  return q.allRecipes.all();
}

function listPrograms() {
  return q.allPrograms.all();
}

function getProgram(id) {
  const p = q.programById.get(id);
  if (!p) return null;
  const mapping = q.mappingByProgram.all(id);
  return { ...p, mapping };
}

function createProgram({ name, gates = 8, mapping = [] }) {
  const info = q.insertProgram.run(name, gates);
  const programId = info.lastInsertRowid;
  if (Array.isArray(mapping) && mapping.length) {
    const tx = db.transaction((rows) => {
      rows.forEach((m) => q.upsertMapping.run({
        program_id: programId,
        gate: m.gate,
        recipe_id: m.recipe_id
      }));
    });
    tx(mapping);
  }
  return getProgram(programId);
}

function updateProgram(id, { name, gates, mapping }) {
  if (name) q.renameProgram.run(name, id);
  if (Number.isInteger(gates)) q.updateGates.run(gates, id);
  if (Array.isArray(mapping)) {
    const tx = db.transaction((rows) => {
      q.clearMapping.run(id);
      rows.forEach((m) => q.upsertMapping.run({
        program_id: id,
        gate: m.gate,
        recipe_id: m.recipe_id
      }));
    });
    tx(mapping);
  }
  return getProgram(id);
}

function removeProgram(id) {
  q.deleteProgram.run(id);
  return true;
}

module.exports = {
  listRecipes,
  listPrograms,
  getProgram,
  createProgram,
  updateProgram,
  removeProgram
};