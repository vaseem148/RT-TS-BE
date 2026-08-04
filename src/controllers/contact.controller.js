import { z } from 'zod';
import { Contact } from '../models/Contact.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notify } from '../utils/notify.js';

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{8,18}$/, 'Enter a valid phone number'),
  subject: z.string().trim().max(140).optional().default('General enquiry'),
  message: z.string().trim().min(10, 'Tell us a bit more (10+ characters)').max(3000),
  serviceInterest: z.string().trim().max(80).optional().default(''),
});

export const updateContactSchema = z.object({
  status: z.enum(['new', 'contacted', 'converted', 'closed']).optional(),
  internalNote: z.string().trim().max(2000).optional(),
});

// POST /api/contact   (public)
export const submitEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await Contact.create(req.body);
  notify.contactEnquiry(enquiry);

  res.status(201).json({
    success: true,
    message: "Thanks! We've received your enquiry and will call you back shortly.",
    enquiry: { _id: enquiry._id, createdAt: enquiry.createdAt },
  });
});

// GET /api/contact   (admin)
export const listEnquiries = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = { $in: String(status).split(',') };
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { message: rx }];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20));

  const [enquiries, total, newCount] = await Promise.all([
    Contact.find(filter)
      .populate('handledBy', 'name')
      .sort('-createdAt')
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .lean(),
    Contact.countDocuments(filter),
    Contact.countDocuments({ status: 'new' }),
  ]);

  res.json({
    success: true,
    enquiries,
    newCount,
    pagination: { page: pageNum, limit: perPage, total, pages: Math.ceil(total / perPage) || 1 },
  });
});

// PATCH /api/contact/:id   (admin)
export const updateEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await Contact.findByIdAndUpdate(
    req.params.id,
    { ...req.body, handledBy: req.user._id },
    { new: true, runValidators: true }
  );
  if (!enquiry) throw ApiError.notFound('Enquiry not found');

  res.json({ success: true, enquiry });
});

// DELETE /api/contact/:id   (admin)
export const deleteEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await Contact.findByIdAndDelete(req.params.id);
  if (!enquiry) throw ApiError.notFound('Enquiry not found');
  res.json({ success: true, message: 'Enquiry deleted' });
});
