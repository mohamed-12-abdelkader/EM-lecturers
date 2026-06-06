"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pool_1 = __importDefault(require("../db/pool"));
async function createExamTables() {
    console.log('Creating exam tables...');
    try {
        // 1. package_subject_exams
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_exams (
          id SERIAL PRIMARY KEY,
          subject_id INTEGER REFERENCES package_subject_items(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          duration INTEGER NOT NULL DEFAULT 60, 
          total_marks INTEGER NOT NULL,
          question_count INTEGER NOT NULL,
          is_visible BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Verified/Created package_subject_exams');
        // 2. package_subject_exam_submissions
        await pool_1.default.query(`
      CREATE TABLE IF NOT EXISTS package_subject_exam_submissions (
          id SERIAL PRIMARY KEY,
          exam_id INTEGER REFERENCES package_subject_exams(id) ON DELETE CASCADE,
          student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          score INTEGER NOT NULL,
          submitted_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(exam_id, student_id)
      );
    `);
        console.log('Verified/Created package_subject_exam_submissions');
        console.log('Exam tables created successfully!');
    }
    catch (error) {
        console.error('Error creating exam tables:', error);
    }
    finally {
        process.exit();
    }
}
createExamTables();
