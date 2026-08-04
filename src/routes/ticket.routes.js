import { Router } from 'express';
import { protect, isAdmin, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import {
  createTicket,
  listTickets,
  getTicket,
  updateTicket,
  changeStatus,
  assignTicket,
  addComment,
  addAttachments,
  rateTicket,
  deleteTicket,
  getTicketOptions,
  trackTicket,
  createTicketSchema,
  updateTicketSchema,
  statusSchema,
  assignSchema,
  commentSchema,
  rateSchema,
} from '../controllers/ticket.controller.js';

const router = Router();

/**
 * Multipart bodies arrive as strings, so nested JSON fields (device, location)
 * are sent as JSON strings and parsed back before validation.
 */
function parseJsonFields(...fields) {
  return (req, _res, next) => {
    for (const field of fields) {
      if (typeof req.body?.[field] === 'string') {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch {
          /* leave as-is; zod will report it */
        }
      }
    }
    next();
  };
}

// Public
router.get('/track/:ticketNumber', trackTicket);
router.get('/meta/options', getTicketOptions);

router.use(protect);

router
  .route('/')
  .get(listTickets)
  .post(
    upload.array('attachments', 5),
    parseJsonFields('device', 'location'),
    validate(createTicketSchema),
    createTicket
  );

router
  .route('/:id')
  .get(getTicket)
  .patch(parseJsonFields('device', 'location'), validate(updateTicketSchema), updateTicket)
  .delete(isAdmin, deleteTicket);

router.patch('/:id/status', validate(statusSchema), changeStatus);
router.patch('/:id/assign', isAdmin, validate(assignSchema), assignTicket);

router.post('/:id/comments', upload.array('attachments', 5), validate(commentSchema), addComment);
router.post('/:id/attachments', upload.array('attachments', 5), addAttachments);

router.post('/:id/rate', authorize('customer'), validate(rateSchema), rateTicket);

export default router;
