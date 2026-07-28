#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

function writeOut(value = '') {
  process.stdout.write(`${value}\n`);
}

function writeErr(value = '') {
  process.stderr.write(`${value}\n`);
}

function parsePositiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    expiresIn: '7d',
    envFile: '.env.development',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--') continue;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--course-id') args.courseId = parsePositiveInt(argv[++i], '--course-id');
    else if (arg === '--teacher-id') args.teacherId = parsePositiveInt(argv[++i], '--teacher-id');
    else if (arg === '--teacher-email') args.teacherEmail = argv[++i];
    else if (arg === '--student-id') args.studentId = parsePositiveInt(argv[++i], '--student-id');
    else if (arg === '--student-email') args.studentEmail = argv[++i];
    else if (arg === '--expires' || arg === '--expires-in') args.expiresIn = argv[++i];
    else if (arg === '--env-file') args.envFile = argv[++i];
    else {
      throw new Error(`Unknown argument: ${arg}${next ? ` ${next}` : ''}`);
    }
  }

  return args;
}

function printHelp() {
  writeOut(`Generate a teacher token, enrolled student token, and course id for scientific chatbot testing.

Usage:
  pnpm scientific-chatbot:tokens
  pnpm scientific-chatbot:tokens -- --teacher-email teacher@example.com
  pnpm scientific-chatbot:tokens -- --course-id 12

Options:
  --course-id <id>          Restrict to a specific course.
  --teacher-id <id>         Restrict to a specific teacher.
  --teacher-email <email>   Restrict to a specific teacher email.
  --student-id <id>         Restrict to a specific enrolled student.
  --student-email <email>   Restrict to a specific enrolled student email.
  --expires <duration>      JWT expiry duration (default: 7d).
  --env-file <path>         Env file to load (default: .env.development).
`);
}

function loadEnv(envFile) {
  const files = [envFile, '.env.ngrok.local'];
  for (const file of files) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: true });
    }
  }
}

function createPoolConfig(databaseUrl) {
  const databaseSsl = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
  const urlWantsSsl = /[?&]sslmode=(require|prefer|verify-ca|verify-full)/i.test(databaseUrl);
  const allowSelfSigned = String(process.env.DEV_TOKEN_REJECT_UNAUTHORIZED || 'false') !== 'true';
  let connectionString = databaseUrl;

  if (urlWantsSsl) {
    const url = new URL(databaseUrl);
    url.searchParams.delete('sslmode');
    connectionString = url.toString();
  }

  return {
    connectionString,
    ssl:
      databaseSsl || urlWantsSsl
        ? {
            rejectUnauthorized: !allowSelfSigned,
          }
        : false,
  };
}

async function findTeacherCourseStudent(pool, args) {
  const clauses = ['teacher.role = $1', 'student.role = $2'];
  const params = ['teacher', 'student'];

  function addFilter(sql, value) {
    params.push(value);
    clauses.push(`${sql} $${params.length}`);
  }

  if (args.courseId) addFilter('course.id =', args.courseId);
  if (args.teacherId) addFilter('teacher.id =', args.teacherId);
  if (args.studentId) addFilter('student.id =', args.studentId);
  if (args.teacherEmail) {
    params.push(args.teacherEmail);
    clauses.push(`LOWER(teacher.email) = LOWER($${params.length})`);
  }
  if (args.studentEmail) {
    params.push(args.studentEmail);
    clauses.push(`LOWER(student.email) = LOWER($${params.length})`);
  }

  const query = `
    SELECT
      course.id AS course_id,
      course.title AS course_title,
      teacher.id AS teacher_id,
      teacher.email AS teacher_email,
      teacher.role AS teacher_role,
      student.id AS student_id,
      student.email AS student_email,
      student.role AS student_role,
      enrollment.enrolled_at
    FROM courses course
    JOIN users teacher ON teacher.id = course.teacher_id
    JOIN enrollments enrollment ON enrollment.course_id = course.id
    JOIN users student ON student.id = enrollment.user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY course.id ASC, enrollment.enrolled_at ASC NULLS LAST, student.id ASC
    LIMIT 1
  `;

  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

function createToken(user, secret, expiresIn) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      jti: crypto.randomUUID(),
    },
    secret,
    { expiresIn },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  loadEnv(args.envFile);

  const secret = process.env.SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!secret) throw new Error('SECRET_KEY is required in env');
  if (!databaseUrl) throw new Error('DATABASE_URL is required in env');

  const pool = new Pool(createPoolConfig(databaseUrl));

  try {
    const pair = await findTeacherCourseStudent(pool, args);
    if (!pair) {
      throw new Error('No teacher course with an enrolled student matched the filters');
    }

    const teacher = {
      id: pair.teacher_id,
      email: pair.teacher_email,
      role: pair.teacher_role,
    };
    const student = {
      id: pair.student_id,
      email: pair.student_email,
      role: pair.student_role,
    };
    const teacherToken = createToken(teacher, secret, args.expiresIn);
    const studentToken = createToken(student, secret, args.expiresIn);

    writeOut(
      JSON.stringify(
        {
          env_file: args.envFile,
          expires_in: args.expiresIn,
          course: {
            id: pair.course_id,
            title: pair.course_title,
          },
          teacher: {
            id: teacher.id,
            email: teacher.email,
            token: teacherToken,
            authorization: `Bearer ${teacherToken}`,
          },
          student: {
            id: student.id,
            email: student.email,
            token: studentToken,
            authorization: `Bearer ${studentToken}`,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  writeErr(`[scientific-chatbot-tokens] ${error.message}`);
  process.exit(1);
});
