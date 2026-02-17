import dotenv from "dotenv";
const parsed = dotenv.config().parsed ?? {};
// Merge parsed .env into process.env (dotenv v17 doesn't always do this)
Object.assign(process.env, parsed);
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z
    .string()
    .url()
    .default("https://jlkognkltdkzerzpcqpu.supabase.co"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
  PORT: z.coerce.number().default(3001),
  APP_URL: z.string().url().default("http://localhost:3001"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export const env = envSchema.parse(process.env);
