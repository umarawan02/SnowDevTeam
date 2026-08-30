import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** A readable temporary password for admin-created accounts. */
export function generateTempPassword(): string {
  const words = ["snow", "delta", "orbit", "ember", "quartz", "harbor", "lumen", "vector"];
  const w = () => words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w()}-${w()}-${n}`;
}
