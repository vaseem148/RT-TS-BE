import { z } from 'zod';
import mongoose from 'mongoose';
import {
  Ticket,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  SERVICE_MODES,
  SLA_HOURS,
} from '../models/Ticket.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { filesToAttachments } from '../middleware/upload.js';
import { notify } from '../utils/notify.js';

const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'awaiting_customer'];
const CLOSED_STATUSES = ['resolved', 'closed', 'cancelled'];

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

const addressSchema = z.object({
  line1: z.string().trim().max(200).optional().default(''),
  city: z.string().trim().max(80).optional().default('Chennai'),
  state: z.string().trim().max(80).optional().default('Tamil Nadu'),
  pincode: z.string().trim().max(10).optional().default(''),
  landmark: z.string().trim().max(120).optional().default(''),
});

export const createTicketSchema = z.object({
  subject: z.string().trim().min(5, 'Subject must be at least 5 characters').max(140),
  description: z.string().trim().min(10, 'Please describe the issue in at least 10 characters').max(5000),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
  serviceMode: z.enum(SERVICE_MODES).default('onsite'),
  device: z
    .object({
      type: z.string().trim().max(60).optional().default(''),
      brand: z.string().trim().max(60).optional().default(''),
      model: z.string().trim().max(80).optional().default(''),
      serialNumber: z.string().trim().max(80).optional().default(''),
      underWarranty: z.coerce.boolean().optional().default(false),
    })
    .optional()
    .default({}),
  location: addressSchema.optional().default({}),
  preferredSlot: z.coerce.date().optional(),
  /** Staff can raise a ticket on behalf of a customer. */
  customerId: z.string().optional(),
});

export const updateTicketSchema = z.object({
  subject: z.string().trim().min(5).max(140).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  serviceMode: z.enum(SERVICE_MODES).optional(),
  device: z
    .object({
      type: z.string().trim().max(60).optional(),
      brand: z.string().trim().max(60).optional(),
      model: z.string().trim().max(80).optional(),
      serialNumber: z.string().trim().max(80).optional(),
      underWarranty: z.coerce.boolean().optional(),
    })
    .optional(),
  location: addressSchema.partial().optional(),
  preferredSlot: z.coerce.date().optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
  finalCost: z.coerce.number().min(0).optional(),
  resolutionSummary: z.string().trim().max(3000).optional(),
});

export const statusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(1000).optional().default(''),
  resolutionSummary: z.string().trim().max(3000).optional(),
  finalCost: z.coerce.number().min(0).optional(),
});

export const assignSchema = z.object({
  technicianId: z.string().min(1, 'Choose a technician'),
  note: z.string().trim().max(500).optional().default(''),
});

export const commentSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(4000),
  isInternal: z.coerce.boolean().optional().default(false),
});

export const rateSchema = z.object({
  stars: z.coerce.number().int().min(1, 'Pick between 1 and 5 stars').max(5),
  feedback: z.string().trim().max(1000).optional().default(''),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Restricts a query to what the requesting user is allowed to see. */
function scopeFor(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'technician') return { assignedTo: user._id };
  return { customer: user._id };
}

function canView(ticket, user) {
  if (user.role === 'admin') return true;
  if (user.role === 'technician') return String(ticket.assignedTo?._id || ticket.assignedTo) === String(user._id);
  return String(ticket.customer?._id || ticket.customer) === String(user._id);
}

/**
 * `lean()` documents skip Mongoose virtuals, so the derived flags the UI
 * relies on are re-applied by hand here.
 */
function withDerived(ticket) {
  const isClosed = CLOSED_STATUSES.includes(ticket.status);
  return {
    ...ticket,
    isClosed,
    isOverdue: !isClosed && !!ticket.slaDueAt && new Date(ticket.slaDueAt).getTime() < Date.now(),
  };
}

const POPULATE = [
  { path: 'customer', select: 'name email phone company avatar address' },
  { path: 'assignedTo', select: 'name email phone avatar skills' },
  { path: 'comments.author', select: 'name role avatar' },
  { path: 'activity.by', select: 'name role' },
];

/** Customers must never see staff-only internal notes. */
function stripInternal(ticket, user) {
  const json = ticket.toJSON ? ticket.toJSON() : ticket;
  if (user.role === 'customer') {
    json.comments = (json.comments || []).filter((c) => !c.isInternal);
  }
  return json;
}

async function refreshTechnicianLoad(technicianId) {
  if (!technicianId) return;
  const count = await Ticket.countDocuments({
    assignedTo: technicianId,
    status: { $in: OPEN_STATUSES },
  });
  await User.findByIdAndUpdate(technicianId, { activeTicketCount: count });
}

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

// POST /api/tickets
export const createTicket = asyncHandler(async (req, res) => {
  const { customerId, ...data } = req.body;

  let customer = req.user;
  if (customerId && req.user.role === 'admin') {
    customer = await User.findById(customerId);
    if (!customer) throw ApiError.notFound('Customer not found');
  }

  // Fall back to the customer's saved address when none was supplied.
  const location = { ...data.location };
  if (!location.line1 && customer.address?.line1) {
    location.line1 = customer.address.line1;
    location.city = location.city || customer.address.city;
    location.state = location.state || customer.address.state;
    location.pincode = location.pincode || customer.address.pincode;
  }

  const ticket = await Ticket.create({
    ...data,
    location,
    customer: customer._id,
    attachments: filesToAttachments(req.files, req.user._id),
    activity: [{ action: 'created', by: req.user._id, to: 'open', at: new Date() }],
  });

  notify.ticketCreated(ticket, customer);

  await ticket.populate(POPULATE);
  res.status(201).json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// GET /api/tickets
export const listTickets = asyncHandler(async (req, res) => {
  const {
    status,
    priority,
    category,
    assignedTo,
    customer,
    search,
    overdue,
    unassigned,
    from,
    to,
    sort = '-createdAt',
    page = 1,
    limit = 20,
  } = req.query;

  const filter = { ...scopeFor(req.user) };

  if (status) {
    const values = String(status).split(',').filter(Boolean);
    if (values.includes('active')) filter.status = { $in: OPEN_STATUSES };
    else if (values.includes('archived')) filter.status = { $in: CLOSED_STATUSES };
    else filter.status = { $in: values };
  }
  if (priority) filter.priority = { $in: String(priority).split(',') };
  if (category) filter.category = { $in: String(category).split(',') };

  // Only admins may pivot the view onto another user's tickets.
  if (req.user.role === 'admin') {
    if (assignedTo && mongoose.isValidObjectId(assignedTo)) filter.assignedTo = assignedTo;
    if (customer && mongoose.isValidObjectId(customer)) filter.customer = customer;
    if (unassigned === 'true') filter.assignedTo = null;
  }

  if (overdue === 'true') {
    filter.slaDueAt = { $lt: new Date() };
    filter.status = { $in: OPEN_STATUSES };
  }

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ticketNumber: rx }, { subject: rx }, { description: rx }];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20));

  const [tickets, total] = await Promise.all([
    Ticket.find(filter)
      .populate('customer', 'name email phone company')
      .populate('assignedTo', 'name email phone')
      .sort(sort)
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .lean(),
    Ticket.countDocuments(filter),
  ]);

  res.json({
    success: true,
    tickets: tickets.map(withDerived),
    pagination: {
      page: pageNum,
      limit: perPage,
      total,
      pages: Math.ceil(total / perPage) || 1,
    },
  });
});

// GET /api/tickets/:id
export const getTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id).populate(POPULATE);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!canView(ticket, req.user)) throw ApiError.forbidden('You cannot view this ticket');

  res.json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// PATCH /api/tickets/:id
export const updateTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!canView(ticket, req.user)) throw ApiError.forbidden('You cannot edit this ticket');

  const isStaff = req.user.role !== 'customer';

  // Customers may only refine their own request while it is still open,
  // and never touch pricing or the resolution write-up.
  if (!isStaff) {
    if (!OPEN_STATUSES.includes(ticket.status)) {
      throw ApiError.badRequest('This ticket is closed and can no longer be edited');
    }
    for (const field of ['estimatedCost', 'finalCost', 'resolutionSummary', 'priority']) {
      delete req.body[field];
    }
  }

  const changes = [];
  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    if (key === 'device' || key === 'location') {
      ticket[key] = { ...ticket[key].toObject(), ...value };
      continue;
    }
    if (String(ticket[key]) !== String(value)) {
      changes.push({ field: key, from: String(ticket[key] ?? ''), to: String(value) });
    }
    ticket[key] = value;
  }

  // Re-baseline the SLA clock whenever priority changes.
  if (req.body.priority && OPEN_STATUSES.includes(ticket.status)) {
    const hours = SLA_HOURS[ticket.priority] ?? SLA_HOURS.medium;
    ticket.slaDueAt = new Date(ticket.createdAt.getTime() + hours * 60 * 60 * 1000);
  }

  if (changes.length) {
    ticket.log('updated', req.user._id, {
      note: changes.map((c) => `${c.field}: ${c.from || '—'} → ${c.to}`).join(', ').slice(0, 500),
    });
  }

  await ticket.save();
  await ticket.populate(POPULATE);

  res.json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// PATCH /api/tickets/:id/status
export const changeStatus = asyncHandler(async (req, res) => {
  const { status, note, resolutionSummary, finalCost } = req.body;

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!canView(ticket, req.user)) throw ApiError.forbidden('You cannot update this ticket');

  // Customers get exactly two transitions: cancel a live ticket, or sign off
  // on one the technician has already resolved.
  if (req.user.role === 'customer') {
    const allowed =
      (status === 'cancelled' && ['open', 'assigned'].includes(ticket.status)) ||
      (status === 'closed' && ticket.status === 'resolved') ||
      (status === 'in_progress' && ticket.status === 'awaiting_customer');
    if (!allowed) {
      throw ApiError.forbidden('You cannot move the ticket to that status');
    }
  }

  if (ticket.status === status) {
    throw ApiError.badRequest(`Ticket is already ${status.replace('_', ' ')}`);
  }

  const from = ticket.status;
  ticket.status = status;

  if (resolutionSummary !== undefined) ticket.resolutionSummary = resolutionSummary;
  if (finalCost !== undefined) ticket.finalCost = finalCost;

  if (status === 'resolved' && !ticket.resolvedAt) ticket.resolvedAt = new Date();
  if (status === 'closed' && !ticket.closedAt) ticket.closedAt = new Date();
  if (status === 'in_progress' && !ticket.firstRespondedAt) ticket.firstRespondedAt = new Date();

  ticket.log('status_changed', req.user._id, { from, to: status, note });
  await ticket.save();

  await refreshTechnicianLoad(ticket.assignedTo);

  const customer = await User.findById(ticket.customer);
  if (customer && String(customer._id) !== String(req.user._id)) {
    notify.statusChanged(ticket, customer, from, status);
  }

  await ticket.populate(POPULATE);
  res.json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// PATCH /api/tickets/:id/assign   (admin only)
export const assignTicket = asyncHandler(async (req, res) => {
  const { technicianId, note } = req.body;

  const [ticket, technician] = await Promise.all([
    Ticket.findById(req.params.id),
    User.findOne({ _id: technicianId, role: 'technician' }),
  ]);

  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!technician) throw ApiError.notFound('Technician not found');
  if (!technician.isActive) throw ApiError.badRequest('That technician account is deactivated');

  const previousTechnician = ticket.assignedTo;
  const from = ticket.status;

  ticket.assignedTo = technician._id;
  if (ticket.status === 'open') ticket.status = 'assigned';

  ticket.log('assigned', req.user._id, {
    from: from,
    to: ticket.status,
    note: note || `Assigned to ${technician.name}`,
  });

  await ticket.save();
  await Promise.all([
    refreshTechnicianLoad(technician._id),
    refreshTechnicianLoad(previousTechnician),
  ]);

  const customer = await User.findById(ticket.customer);
  notify.ticketAssigned(ticket, customer, technician);

  await ticket.populate(POPULATE);
  res.json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// POST /api/tickets/:id/comments
export const addComment = asyncHandler(async (req, res) => {
  const { message } = req.body;
  // Only staff can leave internal notes.
  const isInternal = req.user.role !== 'customer' && req.body.isInternal === true;

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!canView(ticket, req.user)) throw ApiError.forbidden('You cannot comment on this ticket');

  ticket.comments.push({
    author: req.user._id,
    message,
    isInternal,
    attachments: filesToAttachments(req.files, req.user._id),
  });

  if (!ticket.firstRespondedAt && req.user.role !== 'customer') {
    ticket.firstRespondedAt = new Date();
  }

  ticket.log('commented', req.user._id, { note: isInternal ? 'Internal note' : 'Replied' });
  await ticket.save();

  if (!isInternal) {
    const recipientId =
      req.user.role === 'customer' ? ticket.assignedTo : ticket.customer;
    if (recipientId) {
      const recipient = await User.findById(recipientId);
      if (recipient) notify.newComment(ticket, recipient, req.user, message);
    }
  }

  await ticket.populate(POPULATE);
  res.status(201).json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// POST /api/tickets/:id/attachments
export const addAttachments = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!canView(ticket, req.user)) throw ApiError.forbidden('You cannot edit this ticket');

  const attachments = filesToAttachments(req.files, req.user._id);
  if (!attachments.length) throw ApiError.badRequest('No files were uploaded');

  ticket.attachments.push(...attachments);
  ticket.log('attachment_added', req.user._id, { note: `${attachments.length} file(s)` });
  await ticket.save();

  await ticket.populate(POPULATE);
  res.status(201).json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// POST /api/tickets/:id/rate   (customer only)
export const rateTicket = asyncHandler(async (req, res) => {
  const { stars, feedback } = req.body;

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (String(ticket.customer) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the ticket owner can rate this service');
  }
  if (!['resolved', 'closed'].includes(ticket.status)) {
    throw ApiError.badRequest('You can rate the service once the ticket is resolved');
  }
  if (ticket.rating?.stars) {
    throw ApiError.badRequest('You have already rated this ticket');
  }

  ticket.rating = { stars, feedback, ratedAt: new Date() };
  ticket.log('rated', req.user._id, { note: `${stars}★` });
  await ticket.save();

  await ticket.populate(POPULATE);
  res.json({ success: true, ticket: stripInternal(ticket, req.user) });
});

// DELETE /api/tickets/:id   (admin only)
export const deleteTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByIdAndDelete(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  await refreshTechnicianLoad(ticket.assignedTo);
  res.json({ success: true, message: `Ticket ${ticket.ticketNumber} deleted` });
});

// GET /api/tickets/meta/options — enums for building forms/filters
export const getTicketOptions = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    options: {
      statuses: TICKET_STATUSES,
      priorities: TICKET_PRIORITIES,
      categories: TICKET_CATEGORIES,
      serviceModes: SERVICE_MODES,
      slaHours: SLA_HOURS,
    },
  });
});

// GET /api/tickets/track/:ticketNumber — public, lightweight status lookup
export const trackTicket = asyncHandler(async (req, res) => {
  const ticketNumber = String(req.params.ticketNumber || '').trim().toUpperCase();

  const ticket = await Ticket.findOne({ ticketNumber })
    .populate('assignedTo', 'name')
    .select('ticketNumber subject status priority category createdAt slaDueAt resolvedAt assignedTo')
    .lean();

  if (!ticket) throw ApiError.notFound('No ticket found with that number');

  res.json({ success: true, ticket: withDerived(ticket) });
});
