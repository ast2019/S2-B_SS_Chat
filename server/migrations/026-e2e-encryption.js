export const migration026E2eEncryption = {
  version: 26,
  up({ db, hasColumn }) {
    if (!hasColumn("users", "public_key")) {
      db.exec(`ALTER TABLE users ADD COLUMN public_key TEXT DEFAULT NULL`);
    }
    if (!hasColumn("chat_messages", "e2e_encrypted")) {
      db.exec(`ALTER TABLE chat_messages ADD COLUMN e2e_encrypted INTEGER NOT NULL DEFAULT 0`);
    }
  },
};
