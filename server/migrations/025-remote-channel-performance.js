export const migration025RemoteChannelPerformance = {
  version: 25,
  up: ({ db, tableExists }) => {
    if (tableExists("chat_message_reads")) {
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_message_reads_user_message ON chat_message_reads(user_id, message_id)",
      );
    }

    if (tableExists("chat_messages")) {
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_hidden_id ON chat_messages(chat_id, hidden_everyone_at, id DESC)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created_id ON chat_messages(chat_id, created_at DESC, id DESC)",
      );
    }

    if (tableExists("remote_channel_queue")) {
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_remote_channel_queue_claim ON remote_channel_queue(provider, status, next_attempt_at, created_at, id)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_remote_channel_queue_processing_lock ON remote_channel_queue(status, locked_at)",
      );
    }
  },
};
