import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { verifyDeepSeekOnline } from "../packages/core/src/deepseek";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("DEEPSEEK_API_KEY is required in .env");
}

const result = await verifyDeepSeekOnline({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 12000),
  maxRetries: 0,
  allowFallback: false
});

console.log("DeepSeek verification passed");
console.log(`model=${result.model}`);
console.log(`httpStatus=${result.httpStatus}`);
