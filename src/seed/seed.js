import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { Ticket } from '../models/Ticket.js';
import { Service } from '../models/Service.js';
import { Product } from '../models/Product.js';
import { Contact } from '../models/Contact.js';
import { Counter } from '../models/Counter.js';
import { services, products, demoUsers, demoTickets } from './data.js';

const daysAgoDate = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * Wipes and repopulates the database with Renderways demo content.
 *
 * @param {object} [options]
 * @param {boolean} [options.keepConnection] Leave the Mongo connection open and
 *   skip the process exit — used when the dev server seeds itself on boot.
 */
export async function seedDatabase({ keepConnection = false } = {}) {
  if (mongoose.connection.readyState !== 1) await connectDB();

  console.log('\n🧹  Clearing existing data...');
  await Promise.all([
    User.deleteMany({}),
    Ticket.deleteMany({}),
    Service.deleteMany({}),
    Product.deleteMany({}),
    Contact.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  console.log('🛠   Seeding services...');
  await Service.insertMany(services);

  console.log('📦  Seeding products...');
  await Product.insertMany(products);

  console.log('👥  Seeding users...');
  // create() (not insertMany) so the password-hashing pre-save hook runs.
  const users = await User.create(demoUsers);
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));

  console.log('🎫  Seeding tickets...');
  for (const seedTicket of demoTickets) {
    const {
      customerEmail,
      technicianEmail,
      daysAgo = 0,
      rating,
      ...fields
    } = seedTicket;

    const customer = byEmail[customerEmail];
    const technician = technicianEmail ? byEmail[technicianEmail] : null;
    const createdAt = daysAgoDate(daysAgo);

    const ticket = new Ticket({
      ...fields,
      customer: customer._id,
      assignedTo: technician?._id || null,
      createdAt,
      activity: [{ action: 'created', by: customer._id, to: 'open', at: createdAt }],
    });

    if (technician) {
      ticket.activity.push({
        action: 'assigned',
        by: byEmail['admin@renderways.in']._id,
        from: 'open',
        to: 'assigned',
        note: `Assigned to ${technician.name}`,
        at: new Date(createdAt.getTime() + 40 * 60 * 1000),
      });
      ticket.firstRespondedAt = new Date(createdAt.getTime() + 55 * 60 * 1000);

      ticket.comments.push({
        author: technician._id,
        message:
          'Thanks for raising this. I have reviewed the details and will be starting on it shortly — I will keep you posted here.',
        isInternal: false,
        createdAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
      });
    }

    if (['resolved', 'closed'].includes(ticket.status)) {
      ticket.resolvedAt = new Date(createdAt.getTime() + (daysAgo > 3 ? 2 : 1) * 24 * 60 * 60 * 1000);
      ticket.activity.push({
        action: 'status_changed',
        by: technician?._id,
        from: 'in_progress',
        to: 'resolved',
        at: ticket.resolvedAt,
      });
    }

    if (ticket.status === 'closed') {
      ticket.closedAt = new Date(ticket.resolvedAt.getTime() + 12 * 60 * 60 * 1000);
      if (rating) {
        ticket.rating = { ...rating, ratedAt: ticket.closedAt };
      }
    }

    ticket.updatedAt = ticket.closedAt || ticket.resolvedAt || createdAt;
    // Backdated demo data only works if Mongoose leaves our timestamps alone.
    await ticket.save({ timestamps: false });
  }

  console.log('🔄  Recalculating technician workloads...');
  const technicians = users.filter((u) => u.role === 'technician');
  for (const tech of technicians) {
    const count = await Ticket.countDocuments({
      assignedTo: tech._id,
      status: { $in: ['open', 'assigned', 'in_progress', 'awaiting_customer'] },
    });
    await User.findByIdAndUpdate(tech._id, { activeTicketCount: count });
  }

  console.log('✉️   Seeding a sample website enquiry...');
  await Contact.create({
    name: 'Vignesh Anand',
    email: 'vignesh.anand@example.com',
    phone: '9789456123',
    subject: 'Quote for 10 refurbished laptops',
    message:
      'We are setting up a small BPO in Guindy and need 10 refurbished laptops with warranty, plus a basic LAN setup. Please share a quotation and delivery timeline.',
    serviceInterest: 'Laptop & Accessories',
  });

  const counts = {
    services: await Service.countDocuments(),
    products: await Product.countDocuments(),
    users: await User.countDocuments(),
    tickets: await Ticket.countDocuments(),
  };

  console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅  SEED COMPLETE                                         ║
╠════════════════════════════════════════════════════════════╣
║  Services ${String(counts.services).padEnd(4)}  Products ${String(counts.products).padEnd(4)}  Users ${String(counts.users).padEnd(4)}  Tickets ${String(counts.tickets).padEnd(6)}║
╠════════════════════════════════════════════════════════════╣
║  LOGIN CREDENTIALS                                         ║
║                                                            ║
║  Admin       admin@renderways.in       admin123            ║
║  Technician  bala@renderways.in        tech123             ║
║  Technician  karthik@renderways.in     tech123             ║
║  Technician  priya@renderways.in       tech123             ║
║  Customer    sumaiya@example.com       demo123             ║
║  Customer    alex@example.com          demo123             ║
║  Customer    ramesh@example.com        demo123             ║
╚════════════════════════════════════════════════════════════╝
`);

  if (!keepConnection) {
    await disconnectDB();
    process.exit(0);
  }
}

// Only self-execute when run directly (`npm run seed`), not when imported.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/seed/seed.js');

if (invokedDirectly) {
  seedDatabase().catch(async (error) => {
    if (/ECONNREFUSED|ServerSelection/i.test(error.message)) {
      console.error(`\n❌  Cannot reach MongoDB at ${process.env.MONGO_URI}\n`);
      console.error('    No MongoDB installed? Just run the API instead — it seeds itself:\n');
      console.error('        npm run dev:local\n');
    } else {
      console.error('❌  Seed failed:', error);
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
