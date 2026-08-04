import { env } from '../config/env.js';
import { sendEmail } from './email.js';
import { sendWhatsApp } from './whatsapp.js';

const portalUrl = (ticketId) => `${env.clientUrl}/portal/tickets/${ticketId}`;
const staffUrl = (ticketId) => `${env.clientUrl}/admin/tickets/${ticketId}`;

const STATUS_LABEL = {
  open: 'Open',
  assigned: 'Assigned to a technician',
  in_progress: 'Work in progress',
  awaiting_customer: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * Fans a notification out to email + WhatsApp, respecting the recipient's
 * preferences. Runs detached: callers do not await delivery.
 */
async function dispatch(user, { subject, whatsappText, ...emailContent }) {
  if (!user) return;
  const jobs = [];

  if (user.notificationPrefs?.email !== false && user.email) {
    jobs.push(sendEmail({ to: user.email, subject, ...emailContent }));
  }
  if (user.notificationPrefs?.whatsapp !== false && user.phone && whatsappText) {
    jobs.push(sendWhatsApp({ to: user.phone, message: whatsappText }));
  }

  await Promise.allSettled(jobs);
}

/** Fire-and-forget wrapper so notification latency never blocks a response. */
function detach(promiseFactory) {
  Promise.resolve()
    .then(promiseFactory)
    .catch((err) => console.error('🔔 Notification failed:', err.message));
}

export const notify = {
  ticketCreated(ticket, customer) {
    detach(() =>
      dispatch(customer, {
        subject: `Ticket ${ticket.ticketNumber} received — Renderways`,
        title: `We've got your request, ${customer.name.split(' ')[0]} 👋`,
        intro: `Your service ticket <b>${ticket.ticketNumber}</b> has been created. Our team is reviewing it and a technician will be assigned shortly.`,
        rows: [
          { label: 'Ticket', value: ticket.ticketNumber },
          { label: 'Subject', value: ticket.subject },
          { label: 'Priority', value: ticket.priority.toUpperCase() },
          {
            label: 'Response by',
            value: ticket.slaDueAt ? new Date(ticket.slaDueAt).toLocaleString('en-IN') : '',
          },
        ],
        ctaText: 'Track your ticket',
        ctaUrl: portalUrl(ticket._id),
        outro: `Need us urgently? Call ${env.company.phone} — we run a 24/7 call service.`,
        whatsappText: `*Renderways Technology*\n\nHi ${customer.name}, we've received your service request.\n\n🎫 Ticket: *${ticket.ticketNumber}*\n📝 ${ticket.subject}\n⚡ Priority: ${ticket.priority.toUpperCase()}\n\nTrack it here: ${portalUrl(ticket._id)}\n\nUrgent? Call ${env.company.phone}`,
      })
    );
  },

  ticketAssigned(ticket, customer, technician) {
    detach(async () => {
      await dispatch(customer, {
        subject: `${ticket.ticketNumber} assigned to ${technician.name} — Renderways`,
        title: 'A technician is on the case 🔧',
        intro: `<b>${technician.name}</b> has been assigned to ticket <b>${ticket.ticketNumber}</b> and will reach out shortly.`,
        rows: [
          { label: 'Ticket', value: ticket.ticketNumber },
          { label: 'Technician', value: technician.name },
          { label: 'Contact', value: technician.phone },
        ],
        ctaText: 'View ticket',
        ctaUrl: portalUrl(ticket._id),
        whatsappText: `*Renderways Technology*\n\n🔧 Ticket *${ticket.ticketNumber}* has been assigned to *${technician.name}* (${technician.phone}).\n\nThey'll contact you shortly.\n\n${portalUrl(ticket._id)}`,
      });

      await dispatch(technician, {
        subject: `New assignment: ${ticket.ticketNumber} (${ticket.priority})`,
        title: 'New ticket assigned to you',
        intro: `You've been assigned <b>${ticket.ticketNumber}</b>.`,
        rows: [
          { label: 'Subject', value: ticket.subject },
          { label: 'Customer', value: customer?.name },
          { label: 'Phone', value: customer?.phone },
          { label: 'Priority', value: ticket.priority.toUpperCase() },
          {
            label: 'Location',
            value: [ticket.location?.line1, ticket.location?.city].filter(Boolean).join(', '),
          },
        ],
        ctaText: 'Open ticket',
        ctaUrl: `${env.clientUrl}/tech/tickets/${ticket._id}`,
        whatsappText: `*Renderways — New assignment*\n\n🎫 ${ticket.ticketNumber} (${ticket.priority.toUpperCase()})\n📝 ${ticket.subject}\n👤 ${customer?.name} — ${customer?.phone}\n📍 ${[ticket.location?.line1, ticket.location?.city].filter(Boolean).join(', ')}\n\n${env.clientUrl}/tech/tickets/${ticket._id}`,
      });
    });
  },

  statusChanged(ticket, customer, from, to) {
    detach(() =>
      dispatch(customer, {
        subject: `${ticket.ticketNumber} is now ${STATUS_LABEL[to] || to}`,
        title: `Status update: ${STATUS_LABEL[to] || to}`,
        intro: `Ticket <b>${ticket.ticketNumber}</b> moved from <b>${STATUS_LABEL[from] || from}</b> to <b>${STATUS_LABEL[to] || to}</b>.`,
        rows: [
          { label: 'Ticket', value: ticket.ticketNumber },
          { label: 'Subject', value: ticket.subject },
          { label: 'New status', value: STATUS_LABEL[to] || to },
          { label: 'Resolution', value: to === 'resolved' ? ticket.resolutionSummary : '' },
        ],
        ctaText: to === 'resolved' ? 'Rate our service' : 'View ticket',
        ctaUrl: portalUrl(ticket._id),
        outro:
          to === 'resolved'
            ? 'Your feedback helps us improve — it only takes a few seconds to rate this service.'
            : undefined,
        whatsappText: `*Renderways Technology*\n\n🎫 Ticket *${ticket.ticketNumber}*\nStatus: ${STATUS_LABEL[from] || from} → *${STATUS_LABEL[to] || to}*\n\n${portalUrl(ticket._id)}`,
      })
    );
  },

  newComment(ticket, recipient, author, message) {
    const preview = message.length > 160 ? `${message.slice(0, 157)}...` : message;
    const isStaffRecipient = recipient.role !== 'customer';
    detach(() =>
      dispatch(recipient, {
        subject: `New reply on ${ticket.ticketNumber}`,
        title: `${author.name} replied to your ticket`,
        intro: `There's a new message on ticket <b>${ticket.ticketNumber}</b>.`,
        rows: [
          { label: 'From', value: `${author.name} (${author.role})` },
          { label: 'Message', value: preview },
        ],
        ctaText: 'Read and reply',
        ctaUrl: isStaffRecipient ? staffUrl(ticket._id) : portalUrl(ticket._id),
        whatsappText: `*Renderways — New reply*\n\n🎫 ${ticket.ticketNumber}\n💬 ${author.name}: "${preview}"\n\n${isStaffRecipient ? staffUrl(ticket._id) : portalUrl(ticket._id)}`,
      })
    );
  },

  welcome(user) {
    detach(() =>
      dispatch(user, {
        subject: 'Welcome to Renderways Technology',
        title: `Welcome aboard, ${user.name.split(' ')[0]}! 🎉`,
        intro:
          'Your Renderways account is ready. You can now raise service tickets, track technicians in real time, and keep every repair in one place.',
        rows: [
          { label: 'Email', value: user.email },
          { label: 'Phone', value: user.phone },
        ],
        ctaText: 'Go to your portal',
        ctaUrl: `${env.clientUrl}/portal`,
        outro: `Computers, laptops, chip-level repairs, CCTV, data recovery and rentals — all under one roof. Call us any time on ${env.company.phone}.`,
        whatsappText: `*Welcome to Renderways Technology* 🎉\n\nHi ${user.name}, your account is ready.\n\nRaise and track service tickets here: ${env.clientUrl}/portal\n\n24/7 support: ${env.company.phone}`,
      })
    );
  },

  contactEnquiry(enquiry) {
    detach(() =>
      dispatch(
        { email: env.company.email, phone: env.company.phone, notificationPrefs: {} },
        {
          subject: `New website enquiry from ${enquiry.name}`,
          title: 'New enquiry from the website',
          intro: enquiry.message,
          rows: [
            { label: 'Name', value: enquiry.name },
            { label: 'Email', value: enquiry.email },
            { label: 'Phone', value: enquiry.phone },
            { label: 'Interested in', value: enquiry.serviceInterest },
          ],
          ctaText: 'Open admin panel',
          ctaUrl: `${env.clientUrl}/admin/enquiries`,
          whatsappText: `*New website enquiry*\n\n👤 ${enquiry.name}\n📞 ${enquiry.phone}\n✉️ ${enquiry.email}\n🔧 ${enquiry.serviceInterest || 'General'}\n\n"${enquiry.message.slice(0, 200)}"`,
        }
      )
    );
  },
};
