import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(cliDir, "../../..");

export const loadRootEnv = () => {
  dotenv.config({ path: path.join(repoRoot, ".env") });
};
