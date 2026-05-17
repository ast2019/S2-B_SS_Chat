/**
 * End-to-End Encryption (E2E) for Songbird Messenger
 * Uses ECDH P-256 + AES-256-GCM via Web Crypto API
 */

const STORAGE_KEY = "sb_e2e_v1";

function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getStoredKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeKeys(publicKeyB64, privateKeyB64) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ publicKey: publicKeyB64, privateKey: privateKeyB64 }),
  );
}

/**
 * Initialize E2E: generate keypair if not present, POST public key to server.
 */
export async function initE2E() {
  let stored = getStoredKeys();

  if (!stored) {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"],
    );

    const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

    const publicKeyB64 = base64urlEncode(publicKeyRaw);
    const privateKeyB64 = base64urlEncode(privateKeyPkcs8);

    storeKeys(publicKeyB64, privateKeyB64);
    stored = { publicKey: publicKeyB64, privateKey: privateKeyB64 };
  }

  // POST public key to server
  try {
    await fetch("/api/user/public-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ publicKey: stored.publicKey }),
    });
  } catch {
    // Silently fail — key will be posted on next login
  }

  return stored.publicKey;
}

/**
 * Get my public key from localStorage.
 */
export function getMyPublicKey() {
  const stored = getStoredKeys();
  return stored?.publicKey || null;
}

/**
 * Derive a shared AES-256-GCM key from own private key and recipient's public key.
 */
async function deriveSharedKey(privateKeyB64, recipientPubKeyB64) {
  const privateKeyBuffer = base64urlDecode(privateKeyB64);
  const recipientPubBuffer = base64urlDecode(recipientPubKeyB64);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );

  const recipientPublicKey = await crypto.subtle.importKey(
    "raw",
    recipientPubBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  return crypto.subtle.deriveKey(
    { name: "ECDH", public: recipientPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string for a recipient using their public key.
 * Returns "e2e:<ivB64>.<ciphertextB64>"
 */
export async function encryptForUser(text, recipientPubKeyB64) {
  const stored = getStoredKeys();
  if (!stored?.privateKey) {
    throw new Error("E2E keys not initialized");
  }

  const sharedKey = await deriveSharedKey(stored.privateKey, recipientPubKeyB64);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    encoded,
  );

  const ivB64 = base64urlEncode(iv);
  const ciphertextB64 = base64urlEncode(ciphertext);

  return `e2e:${ivB64}.${ciphertextB64}`;
}

/**
 * Decrypt an E2E message using the sender's public key.
 * Returns plaintext string, or original string on error (graceful fallback).
 */
export async function decryptFromUser(cipher, senderPubKeyB64) {
  try {
    const stored = getStoredKeys();
    if (!stored?.privateKey) return cipher;

    if (!isE2EMessage(cipher)) return cipher;

    const payload = cipher.slice(4); // remove "e2e:" prefix
    const dotIndex = payload.indexOf(".");
    if (dotIndex === -1) return cipher;

    const ivB64 = payload.slice(0, dotIndex);
    const ciphertextB64 = payload.slice(dotIndex + 1);

    const iv = new Uint8Array(base64urlDecode(ivB64));
    const ciphertext = base64urlDecode(ciphertextB64);

    const sharedKey = await deriveSharedKey(stored.privateKey, senderPubKeyB64);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Graceful fallback: return original string unchanged
    return cipher;
  }
}

/**
 * Check if a message body is an E2E encrypted message.
 */
export function isE2EMessage(text) {
  return typeof text === "string" && text.startsWith("e2e:");
}

/**
 * Clear E2E keys from localStorage (call on logout).
 */
export function clearE2EKeys() {
  localStorage.removeItem(STORAGE_KEY);
}
