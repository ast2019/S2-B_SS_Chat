import { Server } from "socket.io";
import {
  isMember,
  getSession,
  touchSession,
  markMessageRead,
  updateLastSeen,
  listChatMembers,
} from "../db.js";

let io = null;
const onlineUsers = new Map(); // userId → Set of socketIds

function parseCookieString(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc, cookie) => {
    const [name, ...rest] = cookie.trim().split("=");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || true,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Authenticate using existing cookie-based session
  io.use((socket, next) => {
    const cookies = parseCookieString(socket.handshake.headers.cookie);
    const token = cookies.sid;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    const session = getSession(token);
    if (!session) {
      return next(new Error("Invalid session"));
    }

    touchSession(token);
    socket.userId = Number(session.id);
    socket.username = String(session.username || "").toLowerCase();
    socket.sessionToken = token;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    const username = socket.username;

    // Track presence
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.broadcast.emit("user_online", { userId, username });

    // Rate limiter: max 30 events per 10 seconds per socket
    let rateCount = 0;
    let rateReset = Date.now() + 10000;
    function checkRate() {
      if (Date.now() > rateReset) {
        rateCount = 0;
        rateReset = Date.now() + 10000;
      }
      rateCount++;
      if (rateCount > 30) {
        socket.emit("error", { code: "RATE_LIMITED", retryAfter: 10 });
        return false;
      }
      return true;
    }

    // Join a chat room (validate membership server-side)
    socket.on("join_chat", (chatId) => {
      if (isMember(Number(chatId), userId)) {
        socket.join(`chat:${chatId}`);
      }
    });

    socket.on("leave_chat", (chatId) => {
      socket.leave(`chat:${chatId}`);
    });

    // Typing indicators
    socket.on("typing_start", ({ chatId }) => {
      if (!checkRate()) return;
      if (!isMember(Number(chatId), userId)) return;
      socket.to(`chat:${chatId}`).emit("typing_start", { userId, username, chatId });
    });

    socket.on("typing_stop", ({ chatId }) => {
      if (!isMember(Number(chatId), userId)) return;
      socket.to(`chat:${chatId}`).emit("typing_stop", { userId, chatId });
    });

    // Read receipts
    socket.on("message_read", ({ chatId, messageId }) => {
      if (!checkRate()) return;
      if (!isMember(Number(chatId), userId)) return;
      markMessageRead(Number(messageId), userId);
      socket.to(`chat:${chatId}`).emit("message_read", {
        messageId: Number(messageId),
        readerId: userId,
        chatId,
      });
    });

    // Cleanup on disconnect
    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          io.emit("user_offline", { userId, username });
          updateLastSeen(userId);
        }
      }
    });
  });

  return io;
}

/**
 * Emit an event to all sockets in a chat room.
 * Called from message API after saving to DB.
 */
export function emitToChat(chatId, event, data) {
  io?.to(`chat:${chatId}`).emit(event, data);
}

/**
 * Emit an event to a specific user (all their connected sockets).
 */
export function emitToUser(username, event, data) {
  if (!io) return;
  const key = String(username || "").toLowerCase();
  if (!key) return;

  // Find sockets belonging to this user
  for (const [, socket] of io.sockets.sockets) {
    if (socket.username === key) {
      socket.emit(event, data);
    }
  }
}

/**
 * Get list of currently online user IDs.
 */
export function getOnlineUserIds() {
  return Array.from(onlineUsers.keys());
}

/**
 * Get the Socket.IO server instance.
 */
export function getIO() {
  return io;
}
