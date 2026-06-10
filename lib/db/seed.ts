import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { users, businessConfig } from "./schema";
import { normalizeEmail } from "../utils";
import bcryptjs from "bcryptjs";

const ROOT_EMAIL = "root@eva.com";
const ROOT_PASSWORD = "admin123";

async function seed() {
  const db = drizzle(process.env.DATABASE_URL!);

  const hashedPassword = await bcryptjs.hash(ROOT_PASSWORD, 10);

  await db
    .insert(users)
    .values({
      email: normalizeEmail(ROOT_EMAIL),
      password: hashedPassword,
      role: "root",
      companyId: null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { password: hashedPassword, role: "root", isActive: true },
    });

  const [existingConfig] = await db.select().from(businessConfig).limit(1);
  if (!existingConfig) {
    await db.insert(businessConfig).values({
      pricePerCallCents: 100,
      billingThresholdCalls: 25,
    });
  }

  console.log(
    `Seed completed: root user (${ROOT_EMAIL}) + business config ensured`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
