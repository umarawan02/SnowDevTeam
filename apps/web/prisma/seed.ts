import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.AUTH_ADMIN_PASSWORD;
  const name = process.env.AUTH_ADMIN_NAME?.trim() || "Admin";

  if (!email || !password) {
    console.error("AUTH_ADMIN_EMAIL and AUTH_ADMIN_PASSWORD must be set in apps/web/.env");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", active: true, name },
    create: { email, name, role: "ADMIN", passwordHash },
  });

  console.log(`✔ admin ready: ${user.email} (role ${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
