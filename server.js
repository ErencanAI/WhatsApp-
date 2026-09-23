"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 15 * 1024 * 1024
});

const DATA_DIR = path.join(__dirname, "data");
const CHAT_DIR = path.join(DATA_DIR, "chats");
const MEDIA_DIR = path.join(DATA_DIR, "media");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(CHAT_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const FILES = {
    users: path.join(DATA_DIR, "users.json"),
    sessions: path.join(DATA_DIR, "sessions.json"),
    notifications: path.join(DATA_DIR, "notifications.json"),
    calls: path.join(DATA_DIR, "calls.json"),
    birthdays: path.join(DATA_DIR, "birthdays.json")
};

function ensureJson(file, defaultValue) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(defaultValue, null, 2),
            "utf8"
        );
    }
}

ensureJson(FILES.users, {});
ensureJson(FILES.sessions, {});
ensureJson(FILES.notifications, {});
ensureJson(FILES.calls, {});
ensureJson(FILES.birthdays, {});

function readJson(file, fallback) {
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

function writeJson(file, data) {
    try {
        const tempFile = file + ".tmp";

        fs.writeFileSync(
            tempFile,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        fs.renameSync(
            tempFile,
            file
        );

        return true;
    } catch (error) {
        console.error("JSON WRITE ERROR:", file, error.message);
        return false;
    }
}

function id(prefix) {
    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        crypto.randomBytes(6).toString("hex")
    );
}

function now() {
    return new Date().toISOString();
}

function safeText(value, max = 10000) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .trim()
        .slice(0, max);
}

function safeId(value) {
    return safeText(value, 200);
}

function makeChatId(userA, userB) {
    return [String(userA), String(userB)]
        .sort()
        .join("__");
}

function getChatFile(chatId) {
    const safeChatId = String(chatId)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 300);

    return path.join(
        CHAT_DIR,
        safeChatId + ".json"
    );
}

function getChat(chatId) {
    return readJson(
        getChatFile(chatId),
        {
            id: chatId,
            messages: [],
            createdAt: now(),
            updatedAt: now()
        }
    );
}

function saveChat(chatId, chat) {
    chat.updatedAt = now();

    return writeJson(
        getChatFile(chatId),
        chat
    );
}

function createMessage(data) {
    return {
        id: id("msg"),
        chatId: data.chatId,
        senderId: data.senderId,
        receiverId: data.receiverId || null,

        type:
            data.type ||
            "text",

        text:
            safeText(
                data.text,
                10000
            ),

        media:
            data.media ||
            null,

        replyTo:
            data.replyTo ||
            null,

        reactions: {},

        status: "sent",

        edited: false,
        deleted: false,

        createdAt: now(),
        deliveredAt: null,
        readAt: null,
        editedAt: null,
        deletedAt: null
    };
}

function addMessage(message) {
    const chat =
        getChat(message.chatId);

    chat.messages.push(message);

    if (chat.messages.length > 5000) {
        chat.messages =
            chat.messages.slice(-5000);
    }

    saveChat(
        message.chatId,
        chat
    );

    return message;
}

function updateMessage(
    chatId,
    messageId,
    callback
) {
    const chat =
        getChat(chatId);

    const message =
        chat.messages.find(
            item =>
                item.id === messageId
        );

    if (!message) {
        return null;
    }

    callback(message);

    saveChat(
        chatId,
        chat
    );

    return message;
}

function getMessage(
    chatId,
    messageId
) {
    const chat =
        getChat(chatId);

    return chat.messages.find(
        item =>
            item.id === messageId
    ) || null;
}

app.use(
    cors({
        origin: "*"
    })
);

app.use(
    express.json({
        limit: "15mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "15mb"
    })
);

app.use(
    express.static(__dirname)
);

const rateMap = new Map();

app.use(
    "/api",
    (req, res, next) => {

        const key =
            req.ip ||
            req.socket.remoteAddress ||
            "unknown";

        const timestamp =
            Date.now();

        let record =
            rateMap.get(key);

        if (
            !record ||
            timestamp - record.time >
                60000
        ) {
            record = {
                time: timestamp,
                count: 0
            };

            rateMap.set(
                key,
                record
            );
        }

        record.count++;

        if (record.count > 300) {
            return res.status(429).json({
                ok: false,
                error: "Çok fazla istek gönderildi."
            });
        }

        next();
    }
);

app.get(
    "/",
    (req, res) => {
        const indexFile =
            path.join(
                __dirname,
                "index.html"
            );

        if (fs.existsSync(indexFile)) {
            return res.sendFile(
                indexFile
            );
        }

        res.json({
            ok: true,
            name: "WhatsApp Realtime Server"
        });
    }
);

app.get(
    "/api",
    (req, res) => {
        res.json({
            ok: true,
            server: "online",
            version: "5.0.0",
            socketIO: true,
            time: now()
        });
    }
);

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            status: "online",
            uptime: process.uptime(),
            time: now()
        });
    }
);

app.get(
    "/api/info",
    (req, res) => {
        res.json({
            ok: true,
            name: "Realtime WhatsApp Server",
            version: "5.0.0",
            node:
                process.version,
            socketIO: true,
            port: PORT
        });
    }
);

app.post(
    "/api/users",
    (req, res) => {

        const username =
            safeText(
                req.body.username,
                50
            );

        const displayName =
            safeText(
                req.body.displayName ||
                    req.body.name,
                100
            );

        if (!username) {
            return res.status(400).json({
                ok: false,
                error: "username gerekli"
            });
        }

        const database =
            readJson(
                FILES.users,
                {}
            );

        if (database[username]) {
            return res.status(409).json({
                ok: false,
                error: "Bu kullanıcı zaten var.",
                user: database[username]
            });
        }

        const user = {
            id: username,
            username,
            displayName:
                displayName ||
                username,

            avatar:
                safeText(
                    req.body.avatar,
                    500000
                ) || null,

            birthday:
                safeText(
                    req.body.birthday,
                    50
                ) || null,

            status:
                safeText(
                    req.body.status,
                    300
                ) || "",

            online: false,
            lastSeen: now(),

            createdAt: now(),
            updatedAt: now()
        };

        database[username] =
            user;

        writeJson(
            FILES.users,
            database
        );

        res.json({
            ok: true,
            user
        });
    }
);

app.get(
    "/api/users",
    (req, res) => {

        const database =
            readJson(
                FILES.users,
                {}
            );

        const users =
            Object.values(
                database
            );

        res.json({
            ok: true,
            users
        });
    }
);

app.get(
    "/api/users/:id",
    (req, res) => {

        const database =
            readJson(
                FILES.users,
                {}
            );

        const user =
            database[
                req.params.id
            ];

        if (!user) {
            return res.status(404).json({
                ok: false,
                error: "Kullanıcı bulunamadı."
            });
        }

        res.json({
            ok: true,
            user
        });
    }
);

app.patch(
    "/api/users/:id",
    (req, res) => {

        const database =
            readJson(
                FILES.users,
                {}
            );

        const user =
            database[
                req.params.id
            ];

        if (!user) {
            return res.status(404).json({
                ok: false,
                error: "Kullanıcı bulunamadı."
            });
        }

        if (
            req.body.displayName !==
            undefined
        ) {
            user.displayName =
                safeText(
                    req.body.displayName,
                    100
                );
        }

        if (
            req.body.avatar !==
            undefined
        ) {
            user.avatar =
                safeText(
                    req.body.avatar,
                    500000
                );
        }

        if (
            req.body.status !==
            undefined
        ) {
            user.status =
                safeText(
                    req.body.status,
                    300
                );
        }

        if (
            req.body.birthday !==
            undefined
        ) {
            user.birthday =
                safeText(
                    req.body.birthday,
                    50
                );
        }

        user.updatedAt =
            now();

        writeJson(
            FILES.users,
            database
        );

        res.json({
            ok: true,
            user
        });
    }
);

app.post(
    "/api/session",
    (req, res) => {

        const username =
            safeText(
                req.body.username,
                100
            );

        const database =
            readJson(
                FILES.users,
                {}
            );

        const user =
            database[username];

        if (!user) {
            return res.status(404).json({
                ok: false,
                error: "Kullanıcı bulunamadı."
            });
        }

        const sessions =
            readJson(
                FILES.sessions,
                {}
            );

        const token =
            crypto
                .randomBytes(32)
                .toString("hex");

        sessions[token] = {
            token,
            userId: user.id,
            createdAt: Date.now(),
            expiresAt:
                Date.now() +
                1000 * 60 * 60 * 24 * 30
        };

        writeJson(
            FILES.sessions,
            sessions
        );

        res.json({
            ok: true,
            token,
            user
        });
    }
);

app.delete(
    "/api/session/:token",
    (req, res) => {

        const sessions =
            readJson(
                FILES.sessions,
                {}
            );

        delete sessions[
            req.params.token
        ];

        writeJson(
            FILES.sessions,
            sessions
        );

        res.json({
            ok: true
        });
    }
);

app.get(
    "/api/chats/:chatId/messages",
    (req, res) => {

        const chat =
            getChat(
                req.params.chatId
            );

        let limit =
            Number(
                req.query.limit
            );

        if (
            !Number.isFinite(limit) ||
            limit < 1
        ) {
            limit = 100;
        }

        limit =
            Math.min(
                limit,
                500
            );

        res.json({
            ok: true,
            chatId: chat.id,
            messages:
                chat.messages.slice(
                    -limit
                )
        });
    }
);

app.get(
    "/api/chats/:chatId",
    (req, res) => {

        const chat =
            getChat(
                req.params.chatId
            );

        res.json({
            ok: true,
            chat
        });
    }
);

function notifyUser(
    userId,
    event,
    data
) {
    io.to(
        "user:" + userId
    ).emit(
        event,
        data
    );
}

function createNotification(
    userId,
    type,
    title,
    body,
    data
) {
    const database =
        readJson(
            FILES.notifications,
            {}
        );

    if (!database[userId]) {
        database[userId] = [];
    }

    const notification = {
        id: id("notification"),
        userId,
        type,
        title,
        body,
        data: data || {},
        read: false,
        createdAt: now()
    };

    database[userId].push(
        notification
    );

    if (
        database[userId].length >
        200
    ) {
        database[userId] =
            database[userId].slice(-200);
    }

    writeJson(
        FILES.notifications,
        database
    );

    notifyUser(
        userId,
        "notification:new",
        notification
    );

    return notification;
}

app.get(
    "/api/notifications/:userId",
    (req, res) => {

        const database =
            readJson(
                FILES.notifications,
                {}
            );

        const list =
            database[
                req.params.userId
            ] || [];

        res.json({
            ok: true,
            notifications:
                list
                    .slice()
                    .reverse()
        });
    }
);

app.post(
    "/api/notifications/read",
    (req, res) => {

        const userId =
            safeId(
                req.body.userId
            );

        const notificationId =
            safeId(
                req.body.notificationId
            );

        const database =
            readJson(
                FILES.notifications,
                {}
            );

        const list =
            database[userId] ||
            [];

        const item =
            list.find(
                notification =>
                    notification.id ===
                    notificationId
            );

        if (item) {
            item.read = true;
            item.readAt = now();
        }

        writeJson(
            FILES.notifications,
            database
        );

        res.json({
            ok: true
        });
    }
);

app.post(
    "/api/birthdays",
    (req, res) => {

        const userId =
            safeId(
                req.body.userId
            );

        const date =
            safeText(
                req.body.date,
                50
            );

        if (!userId || !date) {
            return res.status(400).json({
                ok: false,
                error:
                    "userId ve date gerekli"
            });
        }

        const database =
            readJson(
                FILES.birthdays,
                {}
            );

        database[userId] = {
            userId,
            date,
            note:
                safeText(
                    req.body.note,
                    500
                ),
            updatedAt: now()
        };

        writeJson(
            FILES.birthdays,
            database
        );

        res.json({
            ok: true,
            birthday:
                database[userId]
        });
    }
);

app.get(
    "/api/birthdays",
    (req, res) => {

        const database =
            readJson(
                FILES.birthdays,
                {}
            );

        res.json({
            ok: true,
            birthdays:
                Object.values(
                    database
                )
        });
    }
);

const connectedUsers =
    new Map();

function setUserOnline(
    userId,
    socket
) {
    const database =
        readJson(
            FILES.users,
            {}
        );

    if (!database[userId]) {
        return null;
    }

    database[userId].online =
        true;

    database[userId].lastSeen =
        null;

    database[userId].updatedAt =
        now();

    writeJson(
        FILES.users,
        database
    );

    connectedUsers.set(
        userId,
        socket.id
    );

    socket.data.userId =
        userId;

    socket.join(
        "user:" + userId
    );

    io.emit(
        "presence",
        {
            userId,
            online: true,
            lastSeen: null
        }
    );

    return database[userId];
}

function setUserOffline(
    userId,
    socketId
) {
    if (
        connectedUsers.get(
            userId
        ) !== socketId
    ) {
        return;
    }

    connectedUsers.delete(
        userId
    );

    const database =
        readJson(
            FILES.users,
            {}
        );

    if (!database[userId]) {
        return;
    }

    database[userId].online =
        false;

    database[userId].lastSeen =
        now();

    database[userId].updatedAt =
        now();

    writeJson(
        FILES.users,
        database
    );

    io.emit(
        "presence",
        {
            userId,
            online: false,
            lastSeen:
                database[userId].lastSeen
        }
    );
}

function getCall(callId) {
    const database =
        readJson(
            FILES.calls,
            {}
        );

    return database[callId] ||
        null;
}

function saveCall(call) {
    const database =
        readJson(
            FILES.calls,
            {}
        );

    database[call.id] =
        call;

    writeJson(
        FILES.calls,
        database
    );

    return call;
}

function emitCall(
    call,
    event
) {
    io.to(
        "user:" + call.callerId
    ).emit(
        event,
        call
    );

    io.to(
        "user:" + call.receiverId
    ).emit(
        event,
        call
    );
}

function checkBirthdays() {
    try {
        const birthdays =
            readJson(
                FILES.birthdays,
                {}
            );

        const users =
            readJson(
                FILES.users,
                {}
            );

        const today =
            new Date();

        const month =
            String(
                today.getMonth() + 1
            ).padStart(2, "0");

        const day =
            String(
                today.getDate()
            ).padStart(2, "0");

        for (
            const userId of
            Object.keys(birthdays)
        ) {
            const birthday =
                birthdays[userId];

            if (
                !birthday ||
                !birthday.date
            ) {
                continue;
            }

            const raw =
                String(
                    birthday.date
                );

            let birthdayMonth = "";
            let birthdayDay = "";

            let match =
                raw.match(
                    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/
                );

            if (match) {
                birthdayMonth =
                    String(
                        Number(match[2])
                    ).padStart(2, "0");

                birthdayDay =
                    String(
                        Number(match[3])
                    ).padStart(2, "0");
            } else {
                match =
                    raw.match(
                        /^(\d{1,2})[-/](\d{1,2})/
                    );

                if (match) {
                    birthdayMonth =
                        String(
                            Number(match[1])
                        ).padStart(2, "0");

                    birthdayDay =
                        String(
                            Number(match[2])
                        ).padStart(2, "0");
                }
            }

            if (
                birthdayMonth !==
                    month ||
                birthdayDay !==
                    day
            ) {
                continue;
            }

            const user =
                users[userId];

            if (!user) {
                continue;
            }

            const marker =
                `${today.getFullYear()}-${birthdayMonth}-${birthdayDay}`;

            if (
                birthday.lastNotified ===
                marker
            ) {
                continue;
            }

            birthday.lastNotified =
                marker;

            createNotification(
                userId,
                "birthday",
                "Doğum günün kutlu olsun!",
                "Bugün senin özel günün.",
                {
                    userId,
                    date:
                        birthday.date
                }
            );

            notifyUser(
                userId,
                "birthday:today",
                {
                    userId,
                    date:
                        birthday.date,
                    message:
                        "Doğum günün kutlu olsun!"
                }
            );
        }

        writeJson(
            FILES.birthdays,
            birthdays
        );
    } catch (error) {
        console.error(
            "BIRTHDAY CHECK ERROR:",
            error.message
        );
    }
}

io.on(
    "connection",
    socket => {

        console.log(
            "Socket connected:",
            socket.id
        );

        socket.emit(
            "server:ready",
            {
                ok: true,
                time: now()
            }
        );

        socket.on(
            "user:online",
            payload => {

                const userId =
                    safeId(
                        payload &&
                        payload.userId
                    );

                if (!userId) {
                    return;
                }

                const user =
                    setUserOnline(
                        userId,
                        socket
                    );

                if (!user) {
                    socket.emit(
                        "auth:error",
                        {
                            ok: false,
                            error:
                                "Kullanıcı bulunamadı."
                        }
                    );

                    return;
                }

                socket.emit(
                    "user:online:success",
                    {
                        ok: true,
                        user
                    }
                );
            }
        );

        socket.on(
            "chat:join",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                if (!chatId) {
                    return;
                }

                socket.join(
                    "chat:" + chatId
                );

                socket.emit(
                    "chat:joined",
                    {
                        ok: true,
                        chatId
                    }
                );
            }
        );

        socket.on(
            "chat:leave",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                if (!chatId) {
                    return;
                }

                socket.leave(
                    "chat:" + chatId
                );

                socket.emit(
                    "chat:left",
                    {
                        ok: true,
                        chatId
                    }
                );
            }
        );

        socket.on(
            "message:send",
            payload => {

                if (!payload) {
                    return;
                }

                const senderId =
                    safeId(
                        payload.senderId ||
                            socket.data.userId
                    );

                const receiverId =
                    safeId(
                        payload.receiverId
                    );

                let chatId =
                    safeId(
                        payload.chatId
                    );

                if (
                    !chatId &&
                    receiverId &&
                    senderId
                ) {
                    chatId =
                        makeChatId(
                            senderId,
                            receiverId
                        );
                }

                if (!senderId) {
                    socket.emit(
                        "message:error",
                        {
                            error:
                                "senderId gerekli"
                        }
                    );

                    return;
                }

                if (!chatId) {
                    socket.emit(
                        "message:error",
                        {
                            error:
                                "chatId gerekli"
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
                            payload.text,
                        media:
                            payload.media,
                        replyTo:
                            payload.replyTo
                    });

                addMessage(
                    message
                );

                socket.join(
                    "chat:" + chatId
                );

                io.to(
                    "chat:" + chatId
                ).emit(
                    "message:new",
                    message
                );

                if (receiverId) {

                    notifyUser(
                        receiverId,
                        "message:new",
                        message
                    );

                    createNotification(
                        receiverId,
                        "message",
                        safeText(
                            payload.senderName ||
                                "Yeni mesaj",
                            100
                        ),
                        message.type ===
                            "voice"
                            ? "Sesli mesaj"
                            : message.text ||
                              "Yeni mesaj",
                        {
                            chatId,
                            messageId:
                                message.id,
                            senderId
                        }
                    );
                }

                socket.emit(
                    "message:sent",
                    message
                );
            }
        );

        socket.on(
            "typing:start",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const userId =
                    safeId(
                        payload &&
                        (
                            payload.userId ||
                            socket.data.userId
                        )
                    );

                if (
                    !chatId ||
                    !userId
                ) {
                    return;
                }

                socket.to(
                    "chat:" + chatId
                ).emit(
                    "typing:start",
                    {
                        chatId,
                        userId
                    }
                );
            }
        );

        socket.on(
            "typing:stop",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const userId =
                    safeId(
                        payload &&
                        (
                            payload.userId ||
                            socket.data.userId
                        )
                    );

                if (
                    !chatId ||
                    !userId
                ) {
                    return;
                }

                socket.to(
                    "chat:" + chatId
                ).emit(
                    "typing:stop",
                    {
                        chatId,
                        userId
                    }
                );
            }
        );

        socket.on(
            "message:delivered",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const messageId =
                    safeId(
                        payload &&
                        payload.messageId
                    );

                if (
                    !chatId ||
                    !messageId
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chatId,
                        messageId,
                        item => {
                            item.status =
                                "delivered";

                            item.deliveredAt =
                                now();
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chatId
                ).emit(
                    "message:status",
                    {
                        chatId,
                        messageId,
                        status:
                            "delivered",
                        deliveredAt:
                            message.deliveredAt
                    }
                );
            }
        );

        socket.on(
            "message:read",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const messageId =
                    safeId(
                        payload &&
                        payload.messageId
                    );

                if (
                    !chatId ||
                    !messageId
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chatId,
                        messageId,
                        item => {
                            item.status =
                                "read";

                            item.readAt =
                                now();
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chatId
                ).emit(
                    "message:status",
                    {
                        chatId,
                        messageId,
                        status:
                            "read",
                        readAt:
                            message.readAt
                    }
                );
            }
        );

        socket.on(
            "message:edit",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const messageId =
                    safeId(
                        payload &&
                        payload.messageId
                    );

                const text =
                    safeText(
                        payload &&
                        payload.text,
                        10000
                    );

                if (
                    !chatId ||
                    !messageId ||
                    !text
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chatId,
                        messageId,
                        item => {
                            item.text =
                                text;

                            item.edited =
                                true;

                            item.editedAt =
                                now();
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chatId
                ).emit(
                    "message:edited",
                    message
                );
            }
        );

        socket.on(
            "message:delete",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const messageId =
                    safeId(
                        payload &&
                        payload.messageId
                    );

                if (
                    !chatId ||
                    !messageId
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chatId,
                        messageId,
                        item => {
                            item.deleted =
                                true;

                            item.deletedAt =
                                now();

                            item.text =
                                "";

                            item.media =
                                null;
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chatId
                ).emit(
                    "message:deleted",
                    {
                        chatId,
                        messageId,
                        deletedAt:
                            message.deletedAt
                    }
                );
            }
        );

        socket.on(
            "message:reaction",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const messageId =
                    safeId(
                        payload &&
                        payload.messageId
                    );

                const userId =
                    safeId(
                        payload &&
                        (
                            payload.userId ||
                            socket.data.userId
                        )
                    );

                const emoji =
                    safeText(
                        payload &&
                        payload.emoji,
                        20
                    );

                if (
                    !chatId ||
                    !messageId ||
                    !userId ||
                    !emoji
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chatId,
                        messageId,
                        item => {

                            if (
                                !item.reactions
                            ) {
                                item.reactions =
                                    {};
                            }

                            if (
                                !item.reactions[
                                    emoji
                                ]
                            ) {
                                item.reactions[
                                    emoji
                                ] = [];
                            }

                            const list =
                                item.reactions[
                                    emoji
                                ];

                            const index =
                                list.indexOf(
                                    userId
                                );

                            if (
                                index === -1
                            ) {
                                list.push(
                                    userId
                                );
                            } else {
                                list.splice(
                                    index,
                                    1
                                );
                            }
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chatId
                ).emit(
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
            }
        );

        socket.on(
            "voice:message",
            payload => {

                const senderId =
                    safeId(
                        payload.senderId ||
                            socket.data.userId
                    );

                const receiverId =
                    safeId(
                        payload.receiverId
                    );

                let chatId =
                    safeId(
                        payload.chatId
                    );

                if (
                    !chatId &&
                    receiverId
                ) {
                    chatId =
                        makeChatId(
                            senderId,
                            receiverId
                        );
                }

                if (
                    !senderId ||
                    !chatId
                ) {
                    return;
                }

                const message =
                    createMessage({
                        chatId,
                        senderId,
                        receiverId,
                        type: "voice",
                        media: {
                            url:
                                safeText(
                                    payload.audioUrl,
                                    1000000
                                ) || null,

                            duration:
                                Number(
                                    payload.duration
                                ) || 0,

                            waveform:
                                Array.isArray(
                                    payload.waveform
                                )
                                    ? payload.waveform
                                    : []
                        }
                    });

                addMessage(
                    message
                );

                socket.join(
                    "chat:" + chatId
                );

                io.to(
                    "chat:" + chatId
                ).emit(
                    "message:new",
                    message
                );

                if (receiverId) {
                    notifyUser(
                        receiverId,
                        "voice:incoming",
                        message
                    );
                }
            }
        );

        socket.on(
            "effect:send",
            payload => {

                const chatId =
                    safeId(
                        payload &&
                        payload.chatId
                    );

                const effect =
                    safeText(
                        payload &&
                        payload.effect,
                        100
                    );

                const userId =
                    safeId(
                        payload &&
                        (
                            payload.userId ||
                            socket.data.userId
                        )
                    );

                if (!chatId) {
                    return;
                }

                io.to(
                    "chat:" + chatId
                ).emit(
                    "effect:play",
                    {
                        chatId,
                        effect,
                        userId,
                        timestamp:
                            Date.now()
                    }
                );
            }
        );

        socket.on(
            "call:start",
            payload => {

                const callerId =
                    safeId(
                        payload.callerId ||
                            socket.data.userId
                    );

                const receiverId =
                    safeId(
                        payload.receiverId
                    );

                if (
                    !callerId ||
                    !receiverId
                ) {
                    socket.emit(
                        "call:error",
                        {
                            error:
                                "callerId ve receiverId gerekli"
                        }
                    );

                    return;
                }

                const call = {
                    id: id("call"),

                    callerId,
                    receiverId,

                    type:
                        payload.callType ===
                            "video"
                            ? "video"
                            : "voice",

                    status: "ringing",

                    createdAt: now(),
                    answeredAt: null,
                    endedAt: null
                };

                saveCall(
                    call
                );

                notifyUser(
                    receiverId,
                    "call:incoming",
                    call
                );

                notifyUser(
                    receiverId,
                    "phone:ring",
                    {
                        callId:
                            call.id,

                        type:
                            call.type,

                        sound: true,
                        vibration: true,

                        callerId,
                        receiverId
                    }
                );

                createNotification(
                    receiverId,
                    "call",
                    call.type ===
                        "video"
                        ? "Görüntülü arama"
                        : "Sesli arama",
                    "Gelen arama",
                    {
                        callId:
                            call.id,
                        callerId
                    }
                );

                socket.emit(
                    "call:started",
                    call
                );
            }
        );

        socket.on(
            "call:accept",
            payload => {

                const call =
                    getCall(
                        payload &&
                        payload.callId
                    );

                if (!call) {
                    return;
                }

                call.status =
                    "connected";

                call.answeredAt =
                    now();

                saveCall(
                    call
                );

                emitCall(
                    call,
                    "call:accepted"
                );
            }
        );

        socket.on(
            "call:reject",
            payload => {

                const call =
                    getCall(
                        payload &&
                        payload.callId
                    );

                if (!call) {
                    return;
                }

                call.status =
                    "rejected";

                call.endedAt =
                    now();

                saveCall(
                    call
                );

                emitCall(
                    call,
                    "call:rejected"
                );
            }
        );

        socket.on(
            "call:end",
            payload => {

                const call =
                    getCall(
                        payload &&
                        payload.callId
                    );

                if (!call) {
                    return;
                }

                call.status =
                    "ended";

                call.endedAt =
                    now();

                saveCall(
                    call
                );

                emitCall(
                    call,
                    "call:ended"
                );
            }
        );

        socket.on(
            "call:signal",
            payload => {

                const receiverId =
                    safeId(
                        payload &&
                        payload.receiverId
                    );

                if (!receiverId) {
                    return;
                }

                notifyUser(
                    receiverId,
                    "call:signal",
                    {
                        ...payload,
                        receivedAt:
                            now()
                    }
                );
            }
        );

        socket.on(
            "heartbeat",
            () => {
                socket.emit(
                    "heartbeat:ok",
                    {
                        time: now()
                    }
                );
            }
        );

        socket.on(
            "disconnect",
            reason => {

                console.log(
                    "Socket disconnected:",
                    socket.id,
                    reason
                );

                if (
                    socket.data &&
                    socket.data.userId
                ) {
                    setUserOffline(
                        socket.data.userId,
                        socket.id
                    );
                }
            }
        );
    }
);

setInterval(
    checkBirthdays,
    10 * 60 * 1000
);

checkBirthdays();

setInterval(
    () => {

        const current =
            Date.now();

        for (
            const [
                key,
                record
            ] of rateMap.entries()
        ) {
            if (
                current -
                    record.time >
                120000
            ) {
                rateMap.delete(
                    key
                );
            }
        }
    },
    120000
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "UNCAUGHT EXCEPTION:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "UNHANDLED REJECTION:",
            error
        );
    }
);

process.on(
    "SIGINT",
    () => {

        console.log(
            "Server shutting down..."
        );

        io.close();

        server.close(
            () => {
                process.exit(0);
            }
        );
    }
);

process.on(
    "SIGTERM",
    () => {

        console.log(
            "Server shutting down..."
        );

        io.close();

        server.close(
            () => {
                process.exit(0);
            }
        );
    }
);

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "======================================"
        );
        console.log(
            " WhatsApp Realtime Server"
        );
        console.log(
            "======================================"
        );
        console.log(
            "PORT:",
            PORT
        );
        console.log(
            "NODE:",
            process.version
        );
        console.log(
            "SOCKET.IO: ACTIVE"
        );
        console.log(
            "API: ACTIVE"
        );
        console.log(
            "MESSAGING: ACTIVE"
        );
        console.log(
            "CALL SIGNALING: ACTIVE"
        );
        console.log(
            "NOTIFICATIONS: ACTIVE"
        );
        console.log(
            "BIRTHDAYS: ACTIVE"
        );
        console.log(
            "======================================"
        );
        console.log("");
    }
);
