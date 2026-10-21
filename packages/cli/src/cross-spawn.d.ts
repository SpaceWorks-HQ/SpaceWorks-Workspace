declare module "cross-spawn" {
  import { spawn } from "node:child_process";
  const spawnCommand: typeof spawn;
  export default spawnCommand;
}
