import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended 96-bit IV for GCM

function getKey() {
  const hexKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!hexKey || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error("MASTER_ENCRYPTION_KEY must be a 64-character hex string.");
  }
  return Buffer.from(hexKey, "hex");
}

export function encryptSecrets(payloadObj) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(payloadObj);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecrets(token) {
  const parts = String(token || "").split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secrets payload.");
  }

  const key = getKey();
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}