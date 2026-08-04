import { z } from 'zod';
import { User, ROLES } from '../models/User.js';
import { Ticket } from '../models/Ticket.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{8,18}$/, 'Enter a valid phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72),
  role: z.enum(ROLES).default('customer'),
  company: z.string().trim().max(120).optional().default(''),
  skills: z.array(z.string().trim().max(40)).optional().default([]),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{8,18}$/, 'Enter a valid phone number')
    .optional(),
  role: z.enum(ROLES).optional(),
  company: z.string().trim().max(120).optional(),
  skills: z.array(z.string().trim().max(40)).optional(),
  isActive: z.coerce.boolean().optional(),
  isAvailable: z.coerce.boolean().optional(),
  password: z.string().min(6).max(72).optional(),
});

// GET /api/users   (admin)
export const listUsers = asyncHandler(async (req, res) => {
  const { role, search, isActive, page = 1, limit = 20, sort = '-createdAt' } = req.query;

  const filter = {};
  if (role) filter.role = { $in: String(role).split(',') };
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { company: rx }];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20));

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    users,
    pagination: { page: pageNum, limit: perPage, total, pages: Math.ceil(total / perPage) || 1 },
  });
});

// GET /api/users/technicians   (staff) — assignment picker, sorted by lightest load
export const listTechnicians = asyncHandler(async (_req, res) => {
  const technicians = await User.find({ role: 'technician', isActive: true })
    .select('name email phone skills isAvailable activeTicketCount avatar')
    .sort({ isAvailable: -1, activeTicketCount: 1, name: 1 })
    .lean();

  res.json({ success: true, technicians });
});

// GET /api/users/:id   (admin)
export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  const ticketFilter = user.role === 'technician' ? { assignedTo: user._id } : { customer: user._id };
  const [total, open, recent] = await Promise.all([
    Ticket.countDocuments(ticketFilter),
    Ticket.countDocuments({
      ...ticketFilter,
      status: { $in: ['open', 'assigned', 'in_progress', 'awaiting_customer'] },
    }),
    Ticket.find(ticketFilter)
      .select('ticketNumber subject status priority createdAt')
      .sort('-createdAt')
      .limit(5)
      .lean(),
  ]);

  res.json({
    success: true,
    user: user.toJSON(),
    stats: { totalTickets: total, openTickets: open },
    recentTickets: recent,
  });
});

// POST /api/users   (admin) — used to create technician and admin accounts
export const createUser = asyncHandler(async (req, res) => {
  if (await User.exists({ email: req.body.email })) {
    throw ApiError.conflict('An account with this email already exists');
  }
  const user = await User.create(req.body);
  res.status(201).json({ success: true, user: user.toJSON() });
});

// PATCH /api/users/:id   (admin)
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  if (String(user._id) === String(req.user._id)) {
    if (req.body.role && req.body.role !== user.role) {
      throw ApiError.badRequest('You cannot change your own role');
    }
    if (req.body.isActive === false) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }
  }

  Object.assign(user, req.body);
  await user.save();

  res.json({ success: true, user: user.toJSON() });
});

// DELETE /api/users/:id   (admin) — deactivates rather than destroys, so
// historical tickets keep a valid owner.
export const deactivateUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!user) throw ApiError.notFound('User not found');

  res.json({ success: true, message: `${user.name} has been deactivated`, user: user.toJSON() });
});
