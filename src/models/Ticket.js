import mongoose from 'mongoose';
import { nextSequence } from './Counter.js';

export const TICKET_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'awaiting_customer',
  'resolved',
  'closed',
  'cancelled',
];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const TICKET_CATEGORIES = [
  'computer-repair',
  'laptop-repair',
  'chip-level-service',
  'board-level-service',
  'cctv-installation',
  'cctv-service',
  'data-recovery',
  'spare-parts',
  'rental',
  'networking',
  'amc',
  'other',
];

export const SERVICE_MODES = ['onsite', 'carry-in', 'remote', 'pickup-drop'];

/** Hours until SLA breach, per priority. */
export const SLA_HOURS = { urgent: 4, high: 12, medium: 36, low: 72 };

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    filename: { type: String, default: '' },
    mimetype: { type: String, default: '' },
    size: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const commentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    /** Internal notes are hidden from the customer (staff-only). */
    isInternal: { type: Boolean, default: false },
    attachments: [attachmentSchema],
  },
  { timestamps: true }
);

const activitySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    subject: { type: String, required: [true, 'Subject is required'], trim: true, maxlength: 140 },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: 5000,
    },

    category: { type: String, enum: TICKET_CATEGORIES, required: true, index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'medium', index: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    serviceMode: { type: String, enum: SERVICE_MODES, default: 'onsite' },

    device: {
      type: { type: String, trim: true, default: '' },
      brand: { type: String, trim: true, default: '' },
      model: { type: String, trim: true, default: '' },
      serialNumber: { type: String, trim: true, default: '' },
      underWarranty: { type: Boolean, default: false },
    },

    location: {
      line1: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: 'Chennai' },
      state: { type: String, trim: true, default: 'Tamil Nadu' },
      pincode: { type: String, trim: true, default: '' },
      landmark: { type: String, trim: true, default: '' },
    },

    preferredSlot: { type: Date },

    attachments: [attachmentSchema],
    comments: [commentSchema],
    activity: [activitySchema],

    estimatedCost: { type: Number, default: 0, min: 0 },
    finalCost: { type: Number, default: 0, min: 0 },

    slaDueAt: { type: Date, index: true },
    firstRespondedAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },

    resolutionSummary: { type: String, trim: true, maxlength: 3000, default: '' },

    rating: {
      stars: { type: Number, min: 1, max: 5 },
      feedback: { type: String, trim: true, maxlength: 1000, default: '' },
      ratedAt: { type: Date },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ticketSchema.index({ subject: 'text', description: 'text', ticketNumber: 'text' });
ticketSchema.index({ status: 1, priority: 1, createdAt: -1 });

/** True when the ticket is still open and has blown past its SLA deadline. */
ticketSchema.virtual('isOverdue').get(function isOverdue() {
  if (!this.slaDueAt) return false;
  if (['resolved', 'closed', 'cancelled'].includes(this.status)) return false;
  return this.slaDueAt.getTime() < Date.now();
});

ticketSchema.virtual('isClosed').get(function isClosedVirtual() {
  return ['resolved', 'closed', 'cancelled'].includes(this.status);
});

ticketSchema.pre('validate', async function assignNumberAndSla(next) {
  if (this.isNew && !this.ticketNumber) {
    const year = new Date().getFullYear();
    const seq = await nextSequence(`ticket-${year}`);
    this.ticketNumber = `RW-${year}-${String(seq).padStart(4, '0')}`;
  }
  if (this.isNew && !this.slaDueAt) {
    const hours = SLA_HOURS[this.priority] ?? SLA_HOURS.medium;
    this.slaDueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  }
  next();
});

/** Push an entry onto the audit timeline. */
ticketSchema.methods.log = function log(action, by, extra = {}) {
  this.activity.push({ action, by, at: new Date(), ...extra });
  return this;
};

export const Ticket = mongoose.model('Ticket', ticketSchema);
