import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect, isAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  submitEnquiry,
  listEnquiries,
  updateEnquiry,
  deleteEnquiry,
  contactSchema,
  updateContactSchema,
} from '../controllers/contact.controller.js';

const router = Router();

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: "You've sent several enquiries already. Please call us on +91 73581 89215.",
  },
});

router.post('/', enquiryLimiter, validate(contactSchema), submitEnquiry);

router.get('/', protect, isAdmin, listEnquiries);
router.patch('/:id', protect, isAdmin, validate(updateContactSchema), updateEnquiry);
router.delete('/:id', protect, isAdmin, deleteEnquiry);

export default router;
