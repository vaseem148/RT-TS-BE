import { Router } from 'express';
import { protect, isAdmin, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  serviceSchema,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  productSchema,
} from '../controllers/catalog.controller.js';

export const serviceRouter = Router();

serviceRouter.get('/', optionalAuth, listServices);
serviceRouter.get('/:slug', getService);
serviceRouter.post('/', protect, isAdmin, validate(serviceSchema), createService);
serviceRouter.patch('/:id', protect, isAdmin, validate(serviceSchema.partial()), updateService);
serviceRouter.delete('/:id', protect, isAdmin, deleteService);

export const productRouter = Router();

productRouter.get('/', listProducts);
productRouter.get('/:slug', getProduct);
productRouter.post('/', protect, isAdmin, validate(productSchema), createProduct);
productRouter.patch('/:id', protect, isAdmin, validate(productSchema.partial()), updateProduct);
productRouter.delete('/:id', protect, isAdmin, deleteProduct);
