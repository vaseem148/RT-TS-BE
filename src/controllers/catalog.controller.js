import { z } from 'zod';
import { Service } from '../models/Service.js';
import { Product, PRODUCT_CATEGORIES } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { TICKET_CATEGORIES } from '../models/Ticket.js';

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/* ----------------------------- Services ----------------------------- */

export const serviceSchema = z.object({
  title: z.string().trim().min(3).max(100),
  slug: z.string().trim().max(120).optional(),
  shortDescription: z.string().trim().min(10).max(220),
  description: z.string().trim().max(4000).optional().default(''),
  icon: z.string().trim().max(40).optional().default('Wrench'),
  features: z.array(z.string().trim().max(120)).optional().default([]),
  startingPrice: z.coerce.number().min(0).optional().default(0),
  priceNote: z.string().trim().max(80).optional().default(''),
  ticketCategory: z.enum(TICKET_CATEGORIES).optional().default('other'),
  turnaround: z.string().trim().max(60).optional().default(''),
  isFeatured: z.coerce.boolean().optional().default(false),
  isActive: z.coerce.boolean().optional().default(true),
  order: z.coerce.number().optional().default(0),
});

// GET /api/services   (public)
export const listServices = asyncHandler(async (req, res) => {
  const filter = req.user?.role === 'admin' && req.query.all === 'true' ? {} : { isActive: true };
  if (req.query.featured === 'true') filter.isFeatured = true;

  const services = await Service.find(filter).sort({ order: 1, title: 1 }).lean();
  res.json({ success: true, services });
});

// GET /api/services/:slug   (public)
export const getService = asyncHandler(async (req, res) => {
  const service = await Service.findOne({ slug: req.params.slug }).lean();
  if (!service) throw ApiError.notFound('Service not found');
  res.json({ success: true, service });
});

// POST /api/services   (admin)
export const createService = asyncHandler(async (req, res) => {
  const slug = req.body.slug || slugify(req.body.title);
  if (await Service.exists({ slug })) throw ApiError.conflict('A service with that name already exists');

  const service = await Service.create({ ...req.body, slug });
  res.status(201).json({ success: true, service });
});

// PATCH /api/services/:id   (admin)
export const updateService = asyncHandler(async (req, res) => {
  const service = await Service.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!service) throw ApiError.notFound('Service not found');
  res.json({ success: true, service });
});

// DELETE /api/services/:id   (admin)
export const deleteService = asyncHandler(async (req, res) => {
  const service = await Service.findByIdAndDelete(req.params.id);
  if (!service) throw ApiError.notFound('Service not found');
  res.json({ success: true, message: `${service.title} removed` });
});

/* ----------------------------- Products ----------------------------- */

export const productSchema = z.object({
  name: z.string().trim().min(2).max(140),
  slug: z.string().trim().max(160).optional(),
  category: z.enum(PRODUCT_CATEGORIES),
  brand: z.string().trim().max(60).optional().default(''),
  shortDescription: z.string().trim().max(240).optional().default(''),
  description: z.string().trim().max(4000).optional().default(''),
  specs: z
    .array(z.object({ label: z.string().trim().max(60), value: z.string().trim().max(120) }))
    .optional()
    .default([]),
  price: z.coerce.number().min(0).optional().default(0),
  mrp: z.coerce.number().min(0).optional().default(0),
  rentalPricePerDay: z.coerce.number().min(0).optional().default(0),
  condition: z.enum(['new', 'refurbished', 'used']).optional().default('new'),
  warrantyMonths: z.coerce.number().min(0).optional().default(0),
  images: z.array(z.string().trim()).optional().default([]),
  inStock: z.coerce.boolean().optional().default(true),
  stockCount: z.coerce.number().min(0).optional().default(0),
  isFeatured: z.coerce.boolean().optional().default(false),
  isActive: z.coerce.boolean().optional().default(true),
});

// GET /api/products   (public)
export const listProducts = asyncHandler(async (req, res) => {
  const { category, brand, search, featured, minPrice, maxPrice, sort = '-createdAt', page = 1, limit = 24 } =
    req.query;

  const filter = { isActive: true };
  if (category) filter.category = { $in: String(category).split(',') };
  if (brand) filter.brand = { $in: String(brand).split(',') };
  if (featured === 'true') filter.isFeatured = true;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { brand: rx }, { shortDescription: rx }];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(60, Math.max(1, Number(limit) || 24));

  const [products, total, brands] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .lean(),
    Product.countDocuments(filter),
    Product.distinct('brand', { isActive: true }),
  ]);

  res.json({
    success: true,
    products,
    facets: { brands: brands.filter(Boolean).sort(), categories: PRODUCT_CATEGORIES },
    pagination: { page: pageNum, limit: perPage, total, pages: Math.ceil(total / perPage) || 1 },
  });
});

// GET /api/products/:slug   (public)
export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug }).lean();
  if (!product) throw ApiError.notFound('Product not found');

  const related = await Product.find({
    _id: { $ne: product._id },
    category: product.category,
    isActive: true,
  })
    .limit(4)
    .lean();

  res.json({ success: true, product, related });
});

// POST /api/products   (admin)
export const createProduct = asyncHandler(async (req, res) => {
  const slug = req.body.slug || slugify(req.body.name);
  if (await Product.exists({ slug })) throw ApiError.conflict('A product with that name already exists');

  const product = await Product.create({ ...req.body, slug });
  res.status(201).json({ success: true, product });
});

// PATCH /api/products/:id   (admin)
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ success: true, product });
});

// DELETE /api/products/:id   (admin)
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ success: true, message: `${product.name} removed` });
});
