import { eq } from "drizzle-orm";
import bcryptjs from "bcryptjs";
import { db } from "@/lib/db";
import { companies, users } from "@/lib/db/schema";
import type { NotificationPhone } from "@/lib/notification-phones";
import { normalizeEmail } from "@/lib/utils";

export class EmailAlreadyExistsError extends Error {
  constructor(public readonly email: string) {
    super(`Email already exists: ${email}`);
    this.name = "EmailAlreadyExistsError";
  }
}

export interface OnboardCompanyInput {
  name: string;
  areaCode: string;
  notificationPhones: NotificationPhone[];
  leadSnapWebhook: string | null;
  userEmail: string;
  userPassword: string;
}

export interface OnboardCompanyResult {
  company: { id: string; name: string };
  user: { id: string; email: string };
}

export async function onboardCompany(
  input: OnboardCompanyInput
): Promise<OnboardCompanyResult> {
  const hashedPassword = await bcryptjs.hash(input.userPassword, 10);
  const userEmail = normalizeEmail(input.userEmail);

  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, userEmail))
      .limit(1);

    if (existing.length > 0) {
      throw new EmailAlreadyExistsError(userEmail);
    }

    const [company] = await tx
      .insert(companies)
      .values({
        name: input.name,
        areaCode: input.areaCode,
        notificationPhones: input.notificationPhones,
        leadSnapWebhook: input.leadSnapWebhook,
      })
      .returning({ id: companies.id, name: companies.name });

    const [user] = await tx
      .insert(users)
      .values({
        email: userEmail,
        password: hashedPassword,
        role: "staff_admin",
        companyId: company.id,
        isActive: true,
      })
      .returning({ id: users.id, email: users.email });

    return { company, user };
  });
}
