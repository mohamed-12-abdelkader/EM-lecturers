"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pool_1 = __importDefault(require("../db/pool"));
async function createTables() {
    console.log('Starting migration...');
    try {
        // 1. Ensure package_subject_items exists (from previous request context)
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_items (
        id SERIAL PRIMARY KEY,
        package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        image TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Verified/Created package_subject_items');
        // 2. package_subject_permissions
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_permissions (
          id SERIAL PRIMARY KEY,
          subject_id INTEGER REFERENCES package_subject_items(id) ON DELETE CASCADE,
          teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          granted_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(subject_id, teacher_id)
      );
    `);
        console.log('Verified/Created package_subject_permissions');
        // 3. package_subject_lessons
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_lessons (
          id SERIAL PRIMARY KEY,
          subject_id INTEGER REFERENCES package_subject_items(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          order_index INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Verified/Created package_subject_lessons');
        // 4. package_subject_videos
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_videos (
          id SERIAL PRIMARY KEY,
          lesson_id INTEGER REFERENCES package_subject_lessons(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          link TEXT NOT NULL,
          platform TEXT DEFAULT 'other',
          created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Verified/Created package_subject_videos');
        // 5. package_subject_assignments
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_assignments (
          id SERIAL PRIMARY KEY,
          lesson_id INTEGER REFERENCES package_subject_lessons(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          question_count INTEGER DEFAULT 0,
          total_marks INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Verified/Created package_subject_assignments');
        console.log('All tables created successfully!');
    }
    catch (error) {
        console.error('Error creating tables:', error);
    }
    finally {
        process.exit();
    }
}
createTables();
