"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pool_1 = __importDefault(require("../db/pool"));
async function updateVisibilityColumns() {
    console.log('Adding visibility columns...');
    try {
        await pool_1.default.query(`
      ALTER TABLE package_subject_lessons 
      ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
    `);
        await pool_1.default.query(`
      ALTER TABLE package_subject_assignments 
      ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
    `);
        console.log('Columns added successfully');
    }
    catch (error) {
        console.error('Error adding columns:', error);
    }
    finally {
        process.exit();
    }
}
updateVisibilityColumns();
