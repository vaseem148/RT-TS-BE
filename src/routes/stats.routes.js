import { Router } from 'express';
import { protect, isAdmin, authorize } from '../middleware/auth.js';
import {
  adminDashboard,
  technicianDashboard,
  publicStats,
  publicTestimonials,
} from '../controllers/stats.controller.js';

const router = Router();

router.get('/public', publicStats);
router.get('/testimonials', publicTestimonials);

router.get('/dashboard', protect, isAdmin, adminDashboard);
router.get('/me', protect, authorize('technician', 'admin'), technicianDashboard);

export default router;
