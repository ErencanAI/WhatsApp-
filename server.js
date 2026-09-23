"use strict";

/*
╔══════════════════════════════════════════════════════════════╗
║                  WHATSAPP SERVER CORE                      ║
║                 REALTIME CHAT ENGINE                       ║
╠══════════════════════════════════════════════════════════════╣
║  • Express                                                  ║
║  • Socket.IO                                                ║
║  • Realtime Messages                                        ║
║  • Online / Offline                                         ║
║  • Typing Status                                            ║
║  • Read / Delivered                                         ║
║  • Reactions                                                ║
║  • Voice Message Metadata                                   ║
║  • Voice / Video Call Signaling                             ║
║  • Birthday System                                          ║
║  • Notification Events                                      ║
║  • Local JSON Database                                      ║
╚══════════════════════════════════════════════════════════════╝
*/

require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
});

/* ============================================================
   PATHS
============================================================ */

const ROOT = __dirname;

const DATA_DIR = path.join(ROOT, "data");
const USERS_DIR = path.join(DATA_DIR, "users");
const CHATS_DIR = path.join(DATA_DIR, "chats");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const CALLS_DIR = path.join(DATA_DIR, "calls");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const NOTIFICATIONS_DIR = path.join(DATA_DIR, "notifications");

const FILES = {
    users: path.join(DATA_DIR, "users.json"),
    sessions: path.join(DATA_DIR, "sessions.json"),
    settings: path.join(DATA_DIR, "settings.json"),
    birthdays: path.join(DATA_DIR, "birthdays.json"),
    contacts: path.join(DATA_DIR, "contacts.json"),
    notifications: path.join(DATA_DIR, "notifications.json"),
    calls: path.join(DATA_DIR, "calls.json")
};

/* ============================================================
   CREATE DIRECTORIES
============================================================ */

[
    DATA_DIR,
    USERS_DIR,
    CHATS_DIR,
    MESSAGES_DIR,
    CALLS_DIR,
    MEDIA_DIR,
    LOGS_DIR,
    NOTIFICATIONS_DIR
].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

/* ============================================================
   DEFAULT FILES
============================================================ */

function ensureJSON(file, defaultValue) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(defaultValue, null, 2),
            "utf8"
        );
    }
}

ensureJSON(FILES.users, {});
ensureJSON(FILES.sessions, {});
ensureJSON(FILES.settings, {});
ensureJSON(FILES.birthdays, {});
ensureJSON(FILES.contacts, {});
ensureJSON(FILES.notifications, {});
ensureJSON(FILES.calls, {});

/* ============================================================
   JSON DATABASE
============================================================ */

function readJSON(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const raw = fs.readFileSync(file, "utf8");

        if (!raw.trim()) {
            return fallback;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.error("JSON READ ERROR:", file, error.message);
        return fallback;
    }
}

function writeJSON(file, data) {
    const temp = `${file}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(temp, file);
}

/* ============================================================
   DATABASE HELPERS
============================================================ */

function getUsers() {
    return readJSON(FILES.users, {});
}

function saveUsers(users) {
    writeJSON(FILES.users, users);
}

function getSessions() {
    return readJSON(FILES.sessions, {});
}

function saveSessions(sessions) {
    writeJSON(FILES.sessions, sessions);
}

function getBirthdays() {
    return readJSON(FILES.birthdays, {});
}

function saveBirthdays(data) {
    writeJSON(FILES.birthdays, data);
}

function getNotifications() {
    return readJSON(FILES.notifications, {});
}

function saveNotifications(data) {
    writeJSON(FILES.notifications, data);
}

function getCalls() {
    return readJSON(FILES.calls, {});
}

function saveCalls(data) {
    writeJSON(FILES.calls, data);
}

/* ============================================================
   ID GENERATOR
============================================================ */

function id(prefix = "id") {
    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        crypto.randomBytes(5).toString("hex")
    );
}

/* ============================================================
   TIME
============================================================ */

function now() {
    return new Date().toISOString();
}

/* ============================================================
   EXPRESS
============================================================ */

app.use(cors());

app.use(express.json({
    limit: "25mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "25mb"
}));

app.use(express.static(ROOT));

/* ============================================================
   RATE LIMIT
============================================================ */

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false
});

app.use("/api/", apiLimiter);

/* ============================================================
   HEALTH
============================================================ */

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        server: "WhatsApp Realtime Server",
        version: "1.0.0",
        time: now(),
        socketio: true,
        features: {
            chat: true,
            typing: true,
            calls: true,
            voiceMessages: true,
            notifications: true,
            birthdays: true,
            reactions: true
        }
    });
});

/* ============================================================
   SERVER INFO
============================================================ */

app.get("/api/info", (req, res) => {
    res.json({
        name: "WhatsApp Realtime",
        version: "1.0.0",
        realtime: true,
        socket: true,
        calls: {
            voice: true,
            video: true,
            signaling: true
        },
        messaging: {
            text: true,
            emoji: true,
            reactions: true,
            voice: true
        },
        notifications: true,
        birthdays: true
    });
});

/* ============================================================
   USER CREATE
============================================================ */

app.post("/api/users", (req, res) => {
    const {
        username,
        displayName,
        avatar,
        birthday
    } = req.body;

    if (!username || !displayName) {
        return res.status(400).json({
            ok: false,
            error: "username ve displayName gerekli"
        });
    }

    const users = getUsers();

    if (users[username]) {
        return res.status(409).json({
            ok: false,
            error: "Bu kullanıcı zaten var"
        });
    }

    const user = {
        id: id("user"),
        username,
        displayName,
        avatar: avatar || null,
        birthday: birthday || null,

        online: false,
        lastSeen: now(),

        createdAt: now(),
        updatedAt: now()
    };

    users[username] = user;

    saveUsers(users);

    res.json({
        ok: true,
        user
    });
});

/* ============================================================
   USER GET
============================================================ */

app.get("/api/users/:username", (req, res) => {
    const users = getUsers();

    const user = users[req.params.username];

    if (!user) {
        return res.status(404).json({
            ok: false,
            error: "Kullanıcı bulunamadı"
        });
    }

    res.json({
        ok: true,
        user
    });
});

/* ============================================================
   USER ONLINE STATUS
============================================================ */

app.get("/api/users/:username/status", (req, res) => {
    const users = getUsers();

    const user = users[req.params.username];

    if (!user) {
        return res.status(404).json({
            ok: false
        });
    }

    res.json({
        ok: true,
        online: Boolean(user.online),
        lastSeen: user.lastSeen || null
    });
});

/* ============================================================
   CHAT ID
============================================================ */

function makeChatId(a, b) {
    return [String(a), String(b)]
        .sort()
        .join("__");
}

/* ============================================================
   CHAT MESSAGE FILE
============================================================ */

function chatFile(chatId) {
    return path.join(
        MESSAGES_DIR,
        `${chatId}.json`
    );
}

function getMessages(chatId) {
    return readJSON(chatFile(chatId), []);
}

function saveMessages(chatId, messages) {
    writeJSON(chatFile(chatId), messages);
}

/* ============================================================
   MESSAGE CREATE
============================================================ */

function createMessage({
    chatId,
    senderId,
    receiverId,
    type = "text",
    text = "",
    media = null,
    replyTo = null
}) {
    return {
        id: id("msg"),

        chatId,

        senderId,
        receiverId,

        type,

        text: String(text || ""),

        media,

        replyTo,

        reactions: {},

        status: "sent",

        createdAt: now(),
        deliveredAt: null,
        readAt: null
    };
}

/* ============================================================
   MESSAGE SAVE
============================================================ */

function saveMessage(message) {
    const messages = getMessages(message.chatId);

    messages.push(message);

    saveMessages(
        message.chatId,
        messages
    );

    return message;
}

/* ============================================================
   MESSAGE API
============================================================ */

app.get("/api/messages/:chatId", (req, res) => {
    const messages = getMessages(
        req.params.chatId
    );

    res.json({
        ok: true,
        chatId: req.params.chatId,
        messages
    });
});

/* ============================================================
   NOTIFICATIONS
============================================================ */

function createNotification({
    userId,
    type,
    title,
    body,
    data = {}
}) {
    const notifications = getNotifications();

    if (!notifications[userId]) {
        notifications[userId] = [];
    }

    const notification = {
        id: id("notification"),
        userId,
        type,
        title,
        body,
        data,
        read: false,
        createdAt: now()
    };

    notifications[userId].push(notification);

    saveNotifications(notifications);

    return notification;
}

/* ============================================================
   SEND NOTIFICATION
============================================================ */

function sendNotification(userId, notification) {
    io.to(`user:${userId}`).emit(
        "notification",
        notification
    );

    io.to(`user:${userId}`).emit(
        "phone:notification",
        {
            ...notification,
            vibration: true,
            sound: true
        }
    );
}

/* ============================================================
   BIRTHDAY
============================================================ */

app.post("/api/birthdays", (req, res) => {
    const {
        userId,
        date,
        note
    } = req.body;

    if (!userId || !date) {
        return res.status(400).json({
            ok: false,
            error: "userId ve date gerekli"
        });
    }

    const birthdays = getBirthdays();

    birthdays[userId] = {
        userId,
        date,
        note: note || "",
        updatedAt: now()
    };

    saveBirthdays(birthdays);

    res.json({
        ok: true,
        birthday: birthdays[userId]
    });
});

/* ============================================================
   CHECK BIRTHDAYS
============================================================ */

function checkBirthdays() {
    const birthdays = getBirthdays();

    const today = new Date();

    const month =
        String(today.getMonth() + 1)
            .padStart(2, "0");

    const day =
        String(today.getDate())
            .padStart(2, "0");

    const todayKey = `${month}-${day}`;

    Object.values(birthdays).forEach(birthday => {
        if (!birthday.date) {
            return;
        }

        const dateString =
            String(birthday.date);

        const parts =
            dateString.split("-");

        if (parts.length !== 3) {
            return;
        }

        const birthdayKey =
            `${parts[1]}-${parts[2]}`;

        if (birthdayKey !== todayKey) {
            return;
        }

        const notification =
            createNotification({
                userId: birthday.userId,
                type: "birthday",
                title: "🎂 Doğum günün kutlu olsun!",
                body:
                    birthday.note ||
                    "Bugün senin özel günün!",
                data: {
                    birthday: true
                }
            });

        sendNotification(
            birthday.userId,
            notification
        );
    });
}

/* ============================================================
   CALL STORAGE
============================================================ */

function saveCall(call) {
    const calls = getCalls();

    calls[call.id] = call;

    saveCalls(calls);

    return call;
}

/* ============================================================
   SOCKET AUTH-LIKE USER SETUP
============================================================ */

const onlineSockets = new Map();

function getSocketUser(socket) {
    return socket.data.user || null;
}

/* ============================================================
   SOCKET.IO
============================================================ */

io.on("connection", socket => {

    console.log(
        "SOCKET CONNECT:",
        socket.id
    );

    /* --------------------------------------------------------
       USER LOGIN
    -------------------------------------------------------- */

    socket.on("user:online", payload => {

        if (!payload) {
            return;
        }

        const userId =
            String(
                payload.userId ||
                payload.username ||
                ""
            );

        if (!userId) {
            return;
        }

        socket.data.user = {
            id: userId,
            username:
                payload.username ||
                userId,
            displayName:
                payload.displayName ||
                payload.username ||
                userId
        };

        socket.join(`user:${userId}`);

        onlineSockets.set(
            userId,
            socket.id
        );

        const users = getUsers();

        if (users[userId]) {
            users[userId].online = true;
            users[userId].lastSeen = now();
            users[userId].updatedAt = now();

            saveUsers(users);
        }

        socket.emit(
            "user:online:success",
            {
                ok: true,
                userId,
                socketId: socket.id
            }
        );

        socket.broadcast.emit(
            "presence",
            {
                userId,
                online: true,
                lastSeen: null
            }
        );
    });

    /* --------------------------------------------------------
       JOIN CHAT
    -------------------------------------------------------- */

    socket.on("chat:join", payload => {

        if (!payload) {
            return;
        }

        const chatId =
            String(payload.chatId || "");

        if (!chatId) {
            return;
        }

        socket.join(`chat:${chatId}`);

        socket.emit(
            "chat:joined",
            {
                chatId
            }
        );
    });

    /* --------------------------------------------------------
       LEAVE CHAT
    -------------------------------------------------------- */

    socket.on("chat:leave", payload => {

        if (!payload) {
            return;
        }

        const chatId =
            String(payload.chatId || "");

        if (!chatId) {
            return;
        }

        socket.leave(`chat:${chatId}`);
    });

    /* --------------------------------------------------------
       SEND MESSAGE
    -------------------------------------------------------- */

    socket.on("message:send", payload => {

        try {

            if (!payload) {
                return;
            }

            const senderId =
                String(
                    payload.senderId ||
                    getSocketUser(socket)?.id ||
                    ""
                );

            const receiverId =
                String(
                    payload.receiverId ||
                    ""
                );

            const chatId =
                String(
                    payload.chatId ||
                    (
                        senderId &&
                        receiverId
                            ? makeChatId(
                                senderId,
                                receiverId
                            )
                            : ""
                    )
                );

            if (!senderId || !chatId) {
                socket.emit(
                    "message:error",
                    {
                        error:
                            "senderId ve chatId gerekli"
                    }
                );

                return;
            }

            const message =
                createMessage({
                    chatId,
                    senderId,
                    receiverId,
                    type:
                        payload.type ||
                        "text",
                    text:
                        payload.text ||
                        "",
                    media:
                        payload.media ||
                        null,
                    replyTo:
                        payload.replyTo ||
                        null
                });

            saveMessage(message);

            io.to(`chat:${chatId}`).emit(
                "message:new",
                message
            );

            if (receiverId) {

                io.to(`user:${receiverId}`).emit(
                    "message:new",
                    message
                );

                const notification =
                    createNotification({
                        userId: receiverId,
                        type: "message",
                        title:
                            payload.senderName ||
                            "Yeni mesaj",
                        body:
                            message.type === "voice"
                                ? "🎙️ Sesli mesaj"
                                : message.text ||
                                  "Yeni mesaj",
                        data: {
                            chatId,
                            messageId:
                                message.id,
                            senderId
                        }
                    });

                sendNotification(
                    receiverId,
                    notification
                );
            }

            socket.emit(
                "message:sent",
                message
            );

        } catch (error) {

            console.error(
                "MESSAGE ERROR:",
                error
            );

            socket.emit(
                "message:error",
                {
                    error:
                        "Mesaj gönderilemedi"
                }
            );
        }
    });

    /* --------------------------------------------------------
       TYPING
    -------------------------------------------------------- */

    socket.on("typing:start", payload => {

        if (!payload) {
            return;
        }

        const chatId =
            String(payload.chatId || "");

        const userId =
            String(
                payload.userId ||
                getSocketUser(socket)?.id ||
                ""
            );

        if (!chatId || !userId) {
            return;
        }

        socket.to(`chat:${chatId}`).emit(
            "typing:start",
            {
                chatId,
                userId
            }
        );
    });

    socket.on("typing:stop", payload => {

        if (!payload) {
            return;
        }

        const chatId =
            String(payload.chatId || "");

        const userId =
            String(
                payload.userId ||
                getSocketUser(socket)?.id ||
                ""
            );

        if (!chatId || !userId) {
            return;
        }

        socket.to(`chat:${chatId}`).emit(
            "typing:stop",
            {
                chatId,
                userId
            }
        );
    });

    /* --------------------------------------------------------
       MESSAGE DELIVERED
    -------------------------------------------------------- */

    socket.on("message:delivered", payload => {

        if (!payload) {
            return;
        }

        const {
            chatId,
            messageId
        } = payload;

        if (!chatId || !messageId) {
            return;
        }

        const messages =
            getMessages(chatId);

        const message =
            messages.find(
                item =>
                    item.id === messageId
            );

        if (!message) {
            return;
        }

        message.status = "delivered";
        message.deliveredAt = now();

        saveMessages(
            chatId,
            messages
        );

        io.to(`chat:${chatId}`).emit(
            "message:status",
            {
                messageId,
                status: "delivered",
                deliveredAt:
                    message.deliveredAt
            }
        );
    });

    /* --------------------------------------------------------
       MESSAGE READ
    -------------------------------------------------------- */

    socket.on("message:read", payload => {

        if (!payload) {
            return;
        }

        const {
            chatId,
            messageId
        } = payload;

        if (!chatId || !messageId) {
            return;
        }

        const messages =
            getMessages(chatId);

        const message =
            messages.find(
                item =>
                    item.id === messageId
            );

        if (!message) {
            return;
        }

        message.status = "read";
        message.readAt = now();

        saveMessages(
            chatId,
            messages
        );

        io.to(`chat:${chatId}`).emit(
            "message:status",
            {
                messageId,
                status: "read",
                readAt:
                    message.readAt
            }
        );
    });

    /* --------------------------------------------------------
       MESSAGE REACTION
    -------------------------------------------------------- */

    socket.on("message:reaction", payload => {

        if (!payload) {
            return;
        }

        const {
            chatId,
            messageId,
            userId,
            emoji
        } = payload;

        if (
            !chatId ||
            !messageId ||
            !userId ||
            !emoji
        ) {
            return;
        }

        const messages =
            getMessages(chatId);

        const message =
            messages.find(
                item =>
                    item.id === messageId
            );

        if (!message) {
            return;
        }

        if (!message.reactions) {
            message.reactions = {};
        }

        if (!message.reactions[emoji]) {
            message.reactions[emoji] = [];
        }

        const users =
            message.reactions[emoji];

        const index =
            users.indexOf(userId);

        if (index >= 0) {
            users.splice(index, 1);
        } else {
            users.push(userId);
        }

        saveMessages(
            chatId,
            messages
        );

        io.to(`chat:${chatId}`).emit(
            "message:reaction",
            {
                chatId,
                messageId,
                userId,
                emoji,
                reactions:
                    message.reactions
            }
        );
    });

    /* --------------------------------------------------------
       VOICE MESSAGE
    -------------------------------------------------------- */

    socket.on("voice:message", payload => {

        if (!payload) {
            return;
        }

        const {
            chatId,
            senderId,
            receiverId,
            audioUrl,
            duration,
            waveform
        } = payload;

        if (
            !chatId ||
            !senderId ||
            !audioUrl
        ) {
            return;
        }

        const message =
            createMessage({
                chatId,
                senderId,
                receiverId,
                type: "voice",
                text: "",
                media: {
                    audioUrl,
                    duration:
                        Number(duration) || 0,
                    waveform:
                        Array.isArray(waveform)
                            ? waveform
                            : []
                }
            });

        saveMessage(message);

        io.to(`chat:${chatId}`).emit(
            "message:new",
            message
        );

        if (receiverId) {
            io.to(`user:${receiverId}`).emit(
                "voice:incoming",
                message
            );
        }
    });

    /* --------------------------------------------------------
       CALL START
    -------------------------------------------------------- */

    socket.on("call:start", payload => {

        if (!payload) {
            return;
        }

        const callerId =
            String(
                payload.callerId ||
                getSocketUser(socket)?.id ||
                ""
            );

        const receiverId =
            String(
                payload.receiverId ||
                ""
            );

        const callType =
            payload.callType === "video"
                ? "video"
                : "voice";

        if (!callerId || !receiverId) {
            return;
        }

        const call = {
            id: id("call"),

            callerId,
            receiverId,

            type: callType,

            status: "ringing",

            createdAt: now(),
            answeredAt: null,
            endedAt: null
        };

        saveCall(call);

        io.to(`user:${receiverId}`).emit(
            "call:incoming",
            call
        );

        io.to(`user:${receiverId}`).emit(
            "phone:ring",
            {
                callId: call.id,
                type: callType,
                sound: true,
                vibration: true
            }
        );

        socket.emit(
            "call:started",
            call
        );
    });

    /* --------------------------------------------------------
       CALL ACCEPT
    -------------------------------------------------------- */

    socket.on("call:accept", payload => {

        if (!payload?.callId) {
            return;
        }

        const calls =
            getCalls();

        const call =
            calls[payload.callId];

        if (!call) {
            return;
        }

        call.status = "connected";
        call.answeredAt = now();

        saveCalls(calls);

        io.to(`user:${call.callerId}`).emit(
            "call:accepted",
            call
        );

        io.to(`user:${call.receiverId}`).emit(
            "call:accepted",
            call
        );
    });

    /* --------------------------------------------------------
       CALL REJECT
    -------------------------------------------------------- */

    socket.on("call:reject", payload => {

        if (!payload?.callId) {
            return;
        }

        const calls =
            getCalls();

        const call =
            calls[payload.callId];

        if (!call) {
            return;
        }

        call.status = "rejected";
        call.endedAt = now();

        saveCalls(calls);

        io.to(`user:${call.callerId}`).emit(
            "call:rejected",
            call
        );
    });

    /* --------------------------------------------------------
       CALL END
    -------------------------------------------------------- */

    socket.on("call:end", payload => {

        if (!payload?.callId) {
            return;
        }

        const calls =
            getCalls();

        const call =
            calls[payload.callId];

        if (!call) {
            return;
        }

        call.status = "ended";
        call.endedAt = now();

        saveCalls(calls);

        io.to(`user:${call.callerId}`).emit(
            "call:ended",
            call
        );

        io.to(`user:${call.receiverId}`).emit(
            "call:ended",
            call
        );
    });

    /* --------------------------------------------------------
       WEBRTC SIGNAL
    -------------------------------------------------------- */

    socket.on("call:signal", payload => {

        if (!payload) {
            return;
        }

        const receiverId =
            String(
                payload.receiverId || ""
            );

        if (!receiverId) {
            return;
        }

        io.to(`user:${receiverId}`).emit(
            "call:signal",
            {
                ...payload,
                receivedAt: now()
            }
        );
    });

    /* --------------------------------------------------------
       EMOJI / LIGHTNING EVENT
    -------------------------------------------------------- */

    socket.on("effect:send", payload => {

        if (!payload) {
            return;
        }

        const {
            chatId,
            userId,
            effect
        } = payload;

        if (!chatId || !effect) {
            return;
        }

        io.to(`chat:${chatId}`).emit(
            "effect:play",
            {
                chatId,
                userId,
                effect,
                timestamp: Date.now()
            }
        );
    });

    /* --------------------------------------------------------
       HEARTBEAT
    -------------------------------------------------------- */

    socket.on("heartbeat", () => {

        socket.emit(
            "heartbeat:ok",
            {
                time: now()
            }
        );
    });

    /* --------------------------------------------------------
       DISCONNECT
    -------------------------------------------------------- */

    socket.on("disconnect", reason => {

        const user =
            getSocketUser(socket);

        if (user) {

            if (
                onlineSockets.get(user.id) ===
                socket.id
            ) {
                onlineSockets.delete(
                    user.id
                );
            }

            const users = getUsers();

            if (users[user.id]) {

                users[user.id].online = false;
                users[user.id].lastSeen = now();
                users[user.id].updatedAt = now();

                saveUsers(users);
            }

            socket.broadcast.emit(
                "presence",
                {
                    userId: user.id,
                    online: false,
                    lastSeen: now()
                }
            );
        }

        console.log(
            "SOCKET DISCONNECT:",
            socket.id,
            reason
        );
    });
});

/* ============================================================
   BIRTHDAY CHECK — EVERY 10 MINUTES
============================================================ */

setInterval(
    checkBirthdays,
    10 * 60 * 1000
);

/* İlk açılışta da kontrol */
setTimeout(
    checkBirthdays,
    3000
);

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use((err, req, res, next) => {

    console.error(
        "SERVER ERROR:",
        err
    );

    res.status(500).json({
        ok: false,
        error: "Sunucu hatası"
    });
});

/* ============================================================
   START SERVER
============================================================ */

httpServer.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "=========================================="
        );

        console.log(
            "      WHATSAPP REALTIME SERVER"
        );

        console.log(
            "=========================================="
        );

        console.log(
            `PORT: ${PORT}`
        );

        console.log(
            `URL: http://localhost:${PORT}`
        );

        console.log(
            "Socket.IO: ACTIVE"
        );

        console.log(
            "Messages: ACTIVE"
        );

        console.log(
            "Typing: ACTIVE"
        );

        console.log(
            "Voice messages: ACTIVE"
        );

        console.log(
            "Voice/Video signaling: ACTIVE"
        );

        console.log(
            "Notifications: ACTIVE"
        );

        console.log(
            "Birthdays: ACTIVE"
        );

        console.log(
            "Reactions: ACTIVE"
        );

        console.log(
            "=========================================="
        );

        console.log("");
    }
);
