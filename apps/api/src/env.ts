import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiDir, "../../..");

export const loadRootEnv = () => {
  dotenv.config({ path: path.join(repoRoot, ".env") });
};
