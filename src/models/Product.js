import mongoose from 'mongoose';

export const PRODUCT_CATEGORIES = [
  'desktop',
  'laptop',
  'cctv',
  'accessories',
  'spare-parts',
  'networking',
  'storage',
  'rental',
];

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: { type: String, enum: PRODUCT_CATEGORIES, required: true, index: true },
    brand: { type: String, trim: true, default: '' },
    shortDescription: { type: String, trim: true, default: '', maxlength: 240 },
    description: { type: String, trim: true, default: '', maxlength: 4000 },
    specs: [{ label: { type: String, trim: true }, value: { type: String, trim: true } }],
    price: { type: Number, default: 0, min: 0 },
    mrp: { type: Number, default: 0, min: 0 },
    /** For rental items: price per day */
    rentalPricePerDay: { type: Number, default: 0, min: 0 },
    condition: { type: String, enum: ['new', 'refurbished', 'used'], default: 'new' },
    warrantyMonths: { type: Number, default: 0, min: 0 },
    images: [{ type: String }],
    inStock: { type: Boolean, default: true },
    stockCount: { type: Number, default: 0, min: 0 },
    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', brand: 'text', shortDescription: 'text' });

export const Product = mongoose.model('Product', productSchema);
