import { Router } from 'express';
import { protect, isAdmin, isStaff } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listUsers,
  listTechnicians,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  createUserSchema,
  updateUserSchema,
} from '../controllers/user.controller.js';

const router = Router();

router.use(protect);

router.get('/technicians', isStaff, listTechnicians);

router.route('/').get(isAdmin, listUsers).post(isAdmin, validate(createUserSchema), createUser);

router
  .route('/:id')
  .get(isAdmin, getUser)
  .patch(isAdmin, validate(updateUserSchema), updateUser)
  .delete(isAdmin, deactivateUser);

export default router;
