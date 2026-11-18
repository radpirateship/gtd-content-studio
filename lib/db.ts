import { neon } from "@neondatabase/serverless";

export function getSQL() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set. Configure it in Vercel -> Settings -> Environment Variables.");
  }
  return neon(connectionString);
}
