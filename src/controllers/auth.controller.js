import { z } from 'zod';
import { User } from '../models/User.js';
import { Ticket } from '../models/Ticket.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../utils/jwt.js';
import { notify } from '../utils/notify.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{8,18}$/, 'Enter a valid phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72),
  company: z.string().trim().max(120).optional().default(''),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{8,18}$/, 'Enter a valid phone number')
    .optional(),
  company: z.string().trim().max(120).optional(),
  address: z
    .object({
      line1: z.string().trim().max(200).optional(),
      city: z.string().trim().max(80).optional(),
      state: z.string().trim().max(80).optional(),
      pincode: z.string().trim().max(10).optional(),
    })
    .optional(),
  notificationPrefs: z
    .object({
      email: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
    })
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters').max(72),
});

function authResponse(res, user, statusCode = 200) {
  const token = signToken(user);
  res
    .cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .status(statusCode)
    .json({ success: true, token, user: user.toJSON() });
}

// POST /api/auth/register
export const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, company } = req.body;

  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists. Try signing in.');
  }

  // Role is deliberately not taken from the request body — public signups are
  // always customers. Staff accounts are created from the admin panel.
  const user = await User.create({ name, email, phone, password, company, role: 'customer' });

  notify.welcome(user);
  authResponse(res, user, 201);
});

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Incorrect email or password');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated. Contact support.');
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  authResponse(res, user);
});

// POST /api/auth/logout
export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie('token').json({ success: true, message: 'Signed out' });
});

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  const stats = {};

  if (req.user.role === 'customer') {
    const [open, total] = await Promise.all([
      Ticket.countDocuments({
        customer: req.user._id,
        status: { $nin: ['closed', 'cancelled'] },
      }),
      Ticket.countDocuments({ customer: req.user._id }),
    ]);
    Object.assign(stats, { openTickets: open, totalTickets: total });
  }

  if (req.user.role === 'technician') {
    const [active, resolved] = await Promise.all([
      Ticket.countDocuments({
        assignedTo: req.user._id,
        status: { $nin: ['resolved', 'closed', 'cancelled'] },
      }),
      Ticket.countDocuments({ assignedTo: req.user._id, status: { $in: ['resolved', 'closed'] } }),
    ]);
    Object.assign(stats, { activeTickets: active, resolvedTickets: resolved });
  }

  res.json({ success: true, user: req.user.toJSON(), stats });
});

// PATCH /api/auth/me
export const updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, company, address, notificationPrefs } = req.body;

  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  if (company !== undefined) req.user.company = company;
  if (address) req.user.address = { ...req.user.address.toObject(), ...address };
  if (notificationPrefs) {
    req.user.notificationPrefs = {
      ...req.user.notificationPrefs.toObject(),
      ...notificationPrefs,
    };
  }

  await req.user.save();
  res.json({ success: true, user: req.user.toJSON() });
});

// POST /api/auth/change-password
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.badRequest('Your current password is incorrect');
  }

  user.password = newPassword;
  await user.save();

  res.json({ success: true, message: 'Password updated' });
});
