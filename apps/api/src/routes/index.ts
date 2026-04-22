import { Router } from 'express';
import healthRouter from './health';
import authRouter from './auth';
import surveyRouter from './survey';
import assessmentsRouter from './assessments';
import adminRouter from './admin';
import reportsRouter from './reports';
import myAssessmentsRouter from './my-assessments';

const router = Router();

router.use('/health',         healthRouter);
router.use('/auth',           authRouter);
router.use('/survey',         surveyRouter);
router.use('/assessments',    assessmentsRouter);
router.use('/admin',          adminRouter);
router.use('/reports',        reportsRouter);
router.use('/my-assessments', myAssessmentsRouter);

export default router;
