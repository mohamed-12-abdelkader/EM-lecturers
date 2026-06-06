import express from 'express';
import { setStudentRoutes } from './routes/students';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

setStudentRoutes(app);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
