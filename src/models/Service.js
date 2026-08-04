import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    shortDescription: { type: String, required: true, trim: true, maxlength: 220 },
    description: { type: String, default: '', trim: true, maxlength: 4000 },
    /** lucide-react icon name rendered by the frontend */
    icon: { type: String, default: 'Wrench' },
    features: [{ type: String, trim: true }],
    startingPrice: { type: Number, default: 0, min: 0 },
    priceNote: { type: String, default: '', trim: true },
    /** Maps to a Ticket category so "Book this service" pre-fills the form */
    ticketCategory: { type: String, default: 'other' },
    turnaround: { type: String, default: '', trim: true },
    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

serviceSchema.index({ title: 'text', shortDescription: 'text' });

export const Service = mongoose.model('Service', serviceSchema);
