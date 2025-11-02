import { Database } from 'bun:sqlite';
import { config } from './config.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

const dbPath = config.database.path;
const dbDir = dirname(dbPath);

export async function initDatabase() {
  await mkdir(dbDir, { recursive: true });
  const db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS jokes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      elo_rating REAL NOT NULL DEFAULT 1500,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_elo_rating ON jokes(elo_rating DESC);
    CREATE INDEX IF NOT EXISTS idx_created_at ON jokes(created_at DESC);
  `);
  
  return db;
}

export type Joke = {
  id: number;
  content: string;
  elo_rating: number;
  created_at: string;
};

export class JokeRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  create(content: string): Joke {
    const stmt = this.db.prepare('INSERT INTO jokes (content, elo_rating) VALUES (?, ?)');
    const result = stmt.run(content, config.elo.initialRating);
    const id = result.lastInsertRowid;
    return this.findById(id as number)!;
  }

  findById(id: number): Joke | null {
    const stmt = this.db.prepare('SELECT * FROM jokes WHERE id = ?');
    return stmt.get(id) as Joke | null;
  }

  updateEloRating(id: number, newRating: number): void {
    const stmt = this.db.prepare('UPDATE jokes SET elo_rating = ? WHERE id = ?');
    stmt.run(newRating, id);
  }

  getTopJokes(limit: number = 10): Joke[] {
    const stmt = this.db.prepare('SELECT * FROM jokes ORDER BY elo_rating DESC LIMIT ?');
    return stmt.all(limit) as Joke[];
  }

  getAll(): Joke[] {
    const stmt = this.db.prepare('SELECT * FROM jokes ORDER BY elo_rating DESC');
    return stmt.all() as Joke[];
  }

  getBestJoke(): Joke | null {
    const stmt = this.db.prepare('SELECT * FROM jokes ORDER BY elo_rating DESC LIMIT 1');
    return stmt.get() as Joke | null;
  }

  getSampleForComparison(sampleSize: number): Joke[] {
    const stmt = this.db.prepare('SELECT * FROM jokes ORDER BY elo_rating DESC LIMIT ?');
    return stmt.all(sampleSize) as Joke[];
  }
}

