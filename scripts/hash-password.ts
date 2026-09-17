import bcrypt from "bcryptjs";
import { emitKeypressEvents } from "node:readline";

async function hiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in an interactive terminal.");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error?: Error) {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
      value = "";
    }
    function onKey(text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) {
      if (key.ctrl && key.name === "c") return finish(new Error("Cancelled."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(text)) value += text;
    }
    process.stdin.on("keypress", onKey);
  });
}

async function main() {
  if (process.argv.length > 2) throw new Error("Do not pass passwords as arguments. Use the hidden prompt.");
  const password = await hiddenInput("Password (hidden): ");
  if (!password || Buffer.byteLength(password, "utf8") > 72) throw new Error("Password must contain 1–72 UTF-8 bytes.");
  const confirmation = await hiddenInput("Confirm password (hidden): ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  console.log(await bcrypt.hash(password, 12));
}

main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
