import { io } from "socket.io-client";

let socket = null;

/**
 * Connect to the Socket.IO server.
 * Reuses existing connection if already connected.
 */
export function connectSocket() {
  if (socket?.connected) return socket;

  socket = io(import.meta.env.VITE_SERVER_URL || "", {
    withCredentials: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
  });

  socket.on("connect", () => console.log("[socket] connected"));
  socket.on("disconnect", (reason) => console.warn("[socket] disconnected:", reason));
  socket.on("connect_error", (err) => console.warn("[socket] error:", err.message));
  socket.on("error", ({ code }) => {
    if (code === "RATE_LIMITED") console.warn("[socket] rate limited");
  });

  return socket;
}

/**
 * Disconnect from the Socket.IO server and clean up.
 */
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/**
 * Get the current socket instance (may be null if not connected).
 */
export function getSocket() {
  return socket;
}

// Chat room management
export const joinChat = (chatId) => socket?.emit("join_chat", chatId);
export const leaveChat = (chatId) => socket?.emit("leave_chat", chatId);

// Typing indicators
export const emitTypingStart = (chatId) => socket?.emit("typing_start", { chatId });
export const emitTypingStop = (chatId) => socket?.emit("typing_stop", { chatId });

// Read receipts
export const emitMessageRead = (chatId, messageId) =>
  socket?.emit("message_read", { chatId, messageId });
