import { Router } from 'express';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';

export const router = Router();

router.get(
  '/grades',
  asyncWrapper(async (_req, res) => {
    const result = await pool.query('SELECT id, name FROM grades ORDER BY id');
    res.status(200).json({ grades: result.rows });
  }),
);

// إضافة endpoint لعرض الصفوف الابتدائية فقط
router.get(
  '/primary-grades',
  asyncWrapper(async (_req, res) => {
    try {
      // جلب الصفوف الابتدائية مرتبة
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      res.status(200).json({
        message: 'الصفوف الابتدائية',
        primary_grades: primaryGrades.rows,
        total_count: primaryGrades.rows.length,
      });
    } catch (error) {
      console.error('خطأ في جلب الصفوف الابتدائية:', error);
      res.status(500).json({
        error: 'خطأ في جلب الصفوف الابتدائية',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint لعرض إحصائيات النظام
router.get(
  '/system-stats',
  asyncWrapper(async (_req, res) => {
    try {
      // جلب جميع الصفوف
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      // جلب الصفوف الابتدائية
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      // جلب الصفوف الإعدادية
      const preparatoryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%إعدادي%' 
        ORDER BY id
      `);

      // جلب الصفوف الثانوية
      const secondaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ثانوي%' 
        ORDER BY id
      `);

      // جلب الفرقة الجامعية
      const universityGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%فرقة%' 
        ORDER BY id
      `);

      res.status(200).json({
        message: 'إحصائيات نظام الصفوف الدراسية',
        total_grades: allGrades.rows.length,
        primary_grades: {
          count: primaryGrades.rows.length,
          grades: primaryGrades.rows,
        },
        preparatory_grades: {
          count: preparatoryGrades.rows.length,
          grades: preparatoryGrades.rows,
        },
        secondary_grades: {
          count: secondaryGrades.rows.length,
          grades: secondaryGrades.rows,
        },
        university_grades: {
          count: universityGrades.rows.length,
          grades: universityGrades.rows,
        },
        system_status: primaryGrades.rows.length === 6 ? 'complete' : 'partial',
      });
    } catch (error) {
      console.error('خطأ في جلب إحصائيات النظام:', error);
      res.status(500).json({
        error: 'خطأ في جلب إحصائيات النظام',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint لإضافة الصفوف الابتدائية
router.post(
  '/add-primary-grades',
  asyncWrapper(async (_req, res) => {
    try {
      // إضافة الصف الرابع والخامس الابتدائي
      const addGrades = await pool.query(`
        INSERT INTO grades (name) VALUES 
          ('الصف الرابع الابتدائي'),
          ('الصف الخامس الابتدائي')
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `);

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      res.status(200).json({
        message: 'تم إضافة الصفوف الابتدائية بنجاح',
        added_grades: addGrades.rows,
        all_grades: allGrades.rows,
      });
    } catch (error) {
      console.error('خطأ في إضافة الصفوف:', error);
      res.status(500).json({
        error: 'خطأ في إضافة الصفوف',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint لإضافة الصف السادس الابتدائي
router.post(
  '/add-sixth-grade',
  asyncWrapper(async (_req, res) => {
    try {
      // إضافة الصف السادس الابتدائي
      const addGrade = await pool.query(`
        INSERT INTO grades (name) VALUES ('الصف السادس الابتدائي')
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `);

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      if (addGrade.rows.length > 0) {
        res.status(200).json({
          message: 'تم إضافة الصف السادس الابتدائي بنجاح',
          added_grade: addGrade.rows[0],
          all_grades: allGrades.rows,
        });
      } else {
        res.status(200).json({
          message: 'الصف السادس الابتدائي موجود بالفعل',
          all_grades: allGrades.rows,
        });
      }
    } catch (error) {
      console.error('خطأ في إضافة الصف السادس:', error);
      res.status(500).json({
        error: 'خطأ في إضافة الصف السادس',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint شامل لإضافة جميع الصفوف الابتدائية
router.post(
  '/add-all-primary-grades',
  asyncWrapper(async (_req, res) => {
    try {
      // إضافة جميع الصفوف الابتدائية (الرابع والخامس والسادس)
      const addGrades = await pool.query(`
        INSERT INTO grades (name) VALUES 
          ('الصف الرابع الابتدائي'),
          ('الصف الخامس الابتدائي'),
          ('الصف السادس الابتدائي')
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `);

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      // جلب الصفوف الابتدائية مرتبة
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      res.status(200).json({
        message: 'تم إضافة جميع الصفوف الابتدائية بنجاح',
        added_grades: addGrades.rows,
        all_grades: allGrades.rows,
        primary_grades: primaryGrades.rows,
      });
    } catch (error) {
      console.error('خطأ في إضافة الصفوف الابتدائية:', error);
      res.status(500).json({
        error: 'خطأ في إضافة الصفوف الابتدائية',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint لإضافة الصفوف الابتدائية الثلاثة الأولى
router.post(
  '/add-first-three-primary-grades',
  asyncWrapper(async (_req, res) => {
    try {
      // إضافة الصفوف الابتدائية الثلاثة الأولى
      const addGrades = await pool.query(`
        INSERT INTO grades (name) VALUES 
          ('الصف الأول الابتدائي'),
          ('الصف الثاني الابتدائي'),
          ('الصف الثالث الابتدائي')
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `);

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      // جلب الصفوف الابتدائية مرتبة
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      res.status(200).json({
        message: 'تم إضافة الصفوف الابتدائية الثلاثة الأولى بنجاح',
        added_grades: addGrades.rows,
        all_grades: allGrades.rows,
        primary_grades: primaryGrades.rows,
      });
    } catch (error) {
      console.error('خطأ في إضافة الصفوف الابتدائية الثلاثة الأولى:', error);
      res.status(500).json({
        error: 'خطأ في إضافة الصفوف الابتدائية الثلاثة الأولى',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint شامل لإضافة جميع الصفوف الابتدائية الستة
router.post(
  '/add-complete-primary-grades',
  asyncWrapper(async (_req, res) => {
    try {
      // إضافة جميع الصفوف الابتدائية الستة
      const addGrades = await pool.query(`
        INSERT INTO grades (name) VALUES 
          ('الصف الأول الابتدائي'),
          ('الصف الثاني الابتدائي'),
          ('الصف الثالث الابتدائي'),
          ('الصف الرابع الابتدائي'),
          ('الصف الخامس الابتدائي'),
          ('الصف السادس الابتدائي')
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `);

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      // جلب الصفوف الابتدائية مرتبة
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      res.status(200).json({
        message: 'تم إضافة جميع الصفوف الابتدائية الستة بنجاح',
        added_grades: addGrades.rows,
        all_grades: allGrades.rows,
        primary_grades: primaryGrades.rows,
        total_primary_grades: primaryGrades.rows.length,
      });
    } catch (error) {
      console.error('خطأ في إضافة جميع الصفوف الابتدائية:', error);
      res.status(500).json({
        error: 'خطأ في إضافة جميع الصفوف الابتدائية',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint لإضافة الصفوف الابتدائية الثلاثة الأولى إذا لم تكن موجودة
router.post(
  '/ensure-first-three-primary-grades',
  asyncWrapper(async (_req, res) => {
    try {
      // التحقق من وجود الصفوف الابتدائية الثلاثة الأولى
      const existingGrades = await pool.query(`
        SELECT name FROM grades 
        WHERE name IN (
          'الصف الأول الابتدائي',
          'الصف الثاني الابتدائي',
          'الصف الثالث الابتدائي'
        )
      `);

      const existingNames = existingGrades.rows.map((row) => row.name);
      const missingGrades = [
        'الصف الأول الابتدائي',
        'الصف الثاني الابتدائي',
        'الصف الثالث الابتدائي',
      ].filter((name) => !existingNames.includes(name));

      let addGrades = [];
      if (missingGrades.length > 0) {
        // إضافة الصفوف المفقودة فقط
        const addResult = await pool.query(
          `
          INSERT INTO grades (name) VALUES 
            ${missingGrades.map((_, index) => `($${index + 1})`).join(', ')}
          ON CONFLICT (name) DO NOTHING
          RETURNING id, name
        `,
          missingGrades,
        );

        addGrades = addResult.rows;
      }

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      // جلب الصفوف الابتدائية مرتبة
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      res.status(200).json({
        message:
          missingGrades.length > 0
            ? `تم إضافة ${missingGrades.length} صفوف ابتدائية مفقودة`
            : 'جميع الصفوف الابتدائية الثلاثة الأولى موجودة بالفعل',
        added_grades: addGrades,
        missing_grades: missingGrades,
        all_grades: allGrades.rows,
        primary_grades: primaryGrades.rows,
        total_primary_grades: primaryGrades.rows.length,
      });
    } catch (error) {
      console.error('خطأ في التأكد من وجود الصفوف الابتدائية الثلاثة الأولى:', error);
      res.status(500).json({
        error: 'خطأ في التأكد من وجود الصفوف الابتدائية الثلاثة الأولى',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// إضافة endpoint شامل لإضافة جميع الصفوف الابتدائية الستة مرة واحدة
router.post(
  '/setup-complete-primary-system',
  asyncWrapper(async (_req, res) => {
    try {
      // إضافة جميع الصفوف الابتدائية الستة
      const addGrades = await pool.query(`
        INSERT INTO grades (name) VALUES 
          ('الصف الأول الابتدائي'),
          ('الصف الثاني الابتدائي'),
          ('الصف الثالث الابتدائي'),
          ('الصف الرابع الابتدائي'),
          ('الصف الخامس الابتدائي'),
          ('الصف السادس الابتدائي')
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `);

      // جلب جميع الصفوف بعد الإضافة
      const allGrades = await pool.query('SELECT id, name FROM grades ORDER BY id');

      // جلب الصفوف الابتدائية مرتبة
      const primaryGrades = await pool.query(`
        SELECT id, name FROM grades 
        WHERE name LIKE '%ابتدائي%' 
        ORDER BY 
          CASE 
            WHEN name LIKE '%أول%' THEN 1
            WHEN name LIKE '%ثاني%' THEN 2
            WHEN name LIKE '%ثالث%' THEN 3
            WHEN name LIKE '%رابع%' THEN 4
            WHEN name LIKE '%خامس%' THEN 5
            WHEN name LIKE '%سادس%' THEN 6
            ELSE 7
          END
      `);

      res.status(200).json({
        message: 'تم إعداد نظام الصفوف الابتدائية الكامل بنجاح',
        added_grades: addGrades.rows,
        all_grades: allGrades.rows,
        primary_grades: primaryGrades.rows,
        total_primary_grades: primaryGrades.rows.length,
        system_status: 'complete',
      });
    } catch (error) {
      console.error('خطأ في إعداد نظام الصفوف الابتدائية الكامل:', error);
      res.status(500).json({
        error: 'خطأ في إعداد نظام الصفوف الابتدائية الكامل',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

router.get('/health-check', async (req, res) => {
  res.send('Healthy!');
});
