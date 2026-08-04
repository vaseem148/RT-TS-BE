import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['customer', 'technician', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[0-9+\-\s()]{8,18}$/, 'Please provide a valid phone number'],
    },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ROLES, default: 'customer', index: true },

    avatar: { type: String, default: '' },
    company: { type: String, trim: true, default: '' },
    address: {
      line1: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: 'Chennai' },
      state: { type: String, trim: true, default: 'Tamil Nadu' },
      pincode: { type: String, trim: true, default: '' },
    },

    // Technician-only fields
    skills: [{ type: String, trim: true }],
    isAvailable: { type: Boolean, default: true },
    activeTicketCount: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },

    notificationPrefs: {
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.index({ name: 'text', email: 'text', phone: 'text' });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model('User', userSchema);
