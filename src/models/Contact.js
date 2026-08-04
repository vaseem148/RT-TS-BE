import mongoose from 'mongoose';

/** Enquiries submitted from the public "Contact us" form. */
const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    subject: { type: String, trim: true, default: 'General enquiry', maxlength: 140 },
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    serviceInterest: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['new', 'contacted', 'converted', 'closed'],
      default: 'new',
      index: true,
    },
    /** Set when a staff member turns this enquiry into a ticket. */
    convertedTicket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    internalNote: { type: String, trim: true, default: '', maxlength: 2000 },
  },
  { timestamps: true }
);

export const Contact = mongoose.model('Contact', contactSchema);
