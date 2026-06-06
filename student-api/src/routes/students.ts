import { Router } from 'express';
import StudentsController from '../controllers/studentsController';

const router = Router();
const studentsController = new StudentsController();

router.get('/students', studentsController.getAllStudents.bind(studentsController));

export default function setStudentRoutes(app) {
  app.use('/api', router);
}
