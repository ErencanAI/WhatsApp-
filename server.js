"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 15 * 1024 * 1024
});

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CHAT_DIR = path.join(DATA_DIR, "chats");
const MEDIA_DIR = path.join(DATA_DIR, "media");

for (const dir of [
    DATA_DIR,
    CHAT_DIR,
    MEDIA_DIR
]) {
    fs.mkdirSync(dir, { recursive: true });
}

const FILE = {
    users: path.join(DATA_DIR, "users.json"),
    sessions: path.join(DATA_DIR, "sessions.json"),
    notifications: path.join(DATA_DIR, "notifications.json"),
    calls: path.join(DATA_DIR, "calls.json"),
    birthdays: path.join(DATA_DIR, "birthdays.json")
};

function ensureFile(file, value) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(value, null, 2),
            "utf8"
        );
    }
}

ensureFile(FILE.users, {});
ensureFile(FILE.sessions, {});
ensureFile(FILE.notifications, {});
ensureFile(FILE.calls, {});
ensureFile(FILE.birthdays, {});

function read(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const value = fs.readFileSync(
            file,
            "utf8"
        );

        if (!value.trim()) {
            return fallback;
        }

        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function write(file, data) {
    const temporary =
        file + ".tmp";

    fs.writeFileSync(
        temporary,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(
        temporary,
        file
    );
}

function id(prefix = "id") {
    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        crypto.randomBytes(8).toString("hex")
    );
}

function time() {
    return new Date().toISOString();
}

function text(value, max = 10000) {
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    return String(value)
        .trim()
        .slice(0, max);
}

function chatId(a, b) {
    return [String(a), String(b)]
        .sort()
        .join("__");
}

function chatFile(id) {
    return path.join(
        CHAT_DIR,
        id + ".json"
    );
}

function getChat(id) {
    return read(
        chatFile(id),
        {
            id,
            messages: [],
            createdAt: time(),
            updatedAt: time()
        }
    );
}

function saveChat(id, chat) {
    write(
        chatFile(id),
        chat
    );
}

function createMessage(data) {
    return {
        id: id("msg"),
        chatId: data.chatId,
        senderId: data.senderId,
        receiverId: data.receiverId || null,
        type: data.type || "text",
        text: text(data.text),
        media: data.media || null,
        replyTo: data.replyTo || null,
        reactions: {},
        status: "sent",
        edited: false,
        deleted: false,
        createdAt: time(),
        deliveredAt: null,
        readAt: null,
        editedAt: null,
        deletedAt: null
    };
}

function addMessage(message) {
    const chat = getChat(
        message.chatId
    );

    chat.messages.push(message);

    if (chat.messages.length > 5000) {
        chat.messages =
            chat.messages.slice(-5000);
    }

    chat.updatedAt = time();

    saveChat(
        message.chatId,
        chat
    );

    return message;
}

function getMessage(chat, messageId) {
    const data = getChat(chat);

    return data.messages.find(
        message =>
            message.id === messageId
    );
}

function updateMessage(
    chat,
    messageId,
    callback
) {
    const data = getChat(chat);

    const message =
        data.messages.find(
            item =>
                item.id === messageId
        );

    if (!message) {
        return null;
    }

    callback(message);

    data.updatedAt = time();

    saveChat(
        chat,
        data
    );

    return message;
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
    express.static(ROOT)
);

const requestCounter =
    new Map();

app.use(
    "/api",
    (req, res, next) => {

        const address =
            req.ip ||
            req.socket.remoteAddress ||
            "unknown";

        const current =
            Date.now();

        const old =
            requestCounter.get(address);

        if (
            !old ||
            current - old.time > 60000
        ) {
            requestCounter.set(
                address,
                {
                    time: current,
                    count: 1
                }
            );
        } else {
            old.count++;

            if (old.count > 240) {
                return res.status(429).json({
                    ok: false,
                    error: "Too many requests"
                });
            }
        }

        next();
    }
);

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            online: true,
            time: time()
        });
    }
);

app.get(
    "/api/info",
    (req, res) => {
        res.json({
            ok: true,
            name: "Realtime Chat Server",
            version: "3.0.0",
            socket: true,
            messages: true,
            calls: true,
            notifications: true,
            voice: true,
            video: true
        });
    }
);

app.post(
    "/api/users",
    (req, res) => {

        const username =
            text(
                req.body.username,
                40
            );

        const displayName =
            text(
                req.body.displayName,
                80
            );

        if (
            !username ||
            !displayName
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "username ve displayName gerekli"
            });
        }

        const database =
            read(FILE.users, {});

        if (database[username]) {
            return res.status(409).json({
                ok: false,
                error:
                    "Kullanıcı zaten mevcut"
            });
        }

        database[username] = {
            id: username,
            username,
            displayName,
            avatar:
                text(
                    req.body.avatar,
                    500000
                ) || null,
            birthday:
                text(
                    req.body.birthday,
                    30
                ) || null,
            online: false,
            lastSeen: time(),
            createdAt: time(),
            updatedAt: time()
        };

        write(
            FILE.users,
            database
        );

        res.json({
            ok: true,
            user: database[username]
        });
    }
);

app.get(
    "/api/users/:id",
    (req, res) => {

        const database =
            read(FILE.users, {});

        const user =
            database[req.params.id];

        if (!user) {
            return res.status(404).json({
                ok: false,
                error:
                    "Kullanıcı bulunamadı"
            });
        }

        res.json({
            ok: true,
            user
        });
    }
);

app.get(
    "/api/chats/:chatId/messages",
    (req, res) => {

        const chat =
            getChat(req.params.chatId);

        let limit =
            Number(req.query.limit);

        if (
            !Number.isFinite(limit) ||
            limit <= 0
        ) {
            limit = 100;
        }

        limit =
            Math.min(limit, 500);

        res.json({
            ok: true,
            chatId: chat.id,
            messages:
                chat.messages.slice(-limit)
        });
    }
);

app.post(
    "/api/session",
    (req, res) => {

        const username =
            text(
                req.body.username,
                40
            );

        const database =
            read(FILE.users, {});

        const user =
            database[username];

        if (!user) {
            return res.status(404).json({
                ok: false,
                error:
                    "Kullanıcı bulunamadı"
            });
        }

        const sessions =
            read(FILE.sessions, {});

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

        write(
            FILE.sessions,
            sessions
        );

        res.json({
            ok: true,
            token,
            user
        });
    }
);

function getSessionUser(token) {

    if (!token) {
        return null;
    }

    const sessions =
        read(FILE.sessions, {});

    const session =
        sessions[token];

    if (!session) {
        return null;
    }

    if (
        Date.now() >
        session.expiresAt
    ) {
        delete sessions[token];

        write(
            FILE.sessions,
            sessions
        );

        return null;
    }

    const database =
        read(FILE.users, {});

    return database[
        session.userId
    ] || null;
}

app.get(
    "/api/session",
    (req, res) => {

        const header =
            req.headers.authorization ||
            "";

        const token =
            header.startsWith("Bearer ")
                ? header.slice(7)
                : "";

        const user =
            getSessionUser(token);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error:
                    "Geçersiz oturum"
            });
        }

        res.json({
            ok: true,
            user
        });
    }
);

function createNotification(
    userId,
    type,
    title,
    body,
    data = {}
) {

    const database =
        read(
            FILE.notifications,
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
        data,
        read: false,
        createdAt: time()
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

    write(
        FILE.notifications,
        database
    );

    return notification;
}

function notify(
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

app.get(
    "/api/notifications/:userId",
    (req, res) => {

        const database =
            read(
                FILE.notifications,
                {}
            );

        res.json({
            ok: true,
            notifications:
                (
                    database[
                        req.params.userId
                    ] || []
                ).slice().reverse()
        });
    }
);

app.post(
    "/api/notifications/read",
    (req, res) => {

        const userId =
            text(
                req.body.userId,
                200
            );

        const notificationId =
            text(
                req.body.notificationId,
                200
            );

        const database =
            read(
                FILE.notifications,
                {}
            );

        const list =
            database[userId] || [];

        const item =
            list.find(
                notification =>
                    notification.id ===
                    notificationId
            );

        if (item) {
            item.read = true;
            item.readAt = time();
        }

        write(
            FILE.notifications,
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
            text(
                req.body.userId,
                200
            );

        const date =
            text(
                req.body.date,
                30
            );

        if (!userId || !date) {
            return res.status(400).json({
                ok: false
            });
        }

        const database =
            read(
                FILE.birthdays,
                {}
            );

        database[userId] = {
            userId,
            date,
            note:
                text(
                    req.body.note,
                    500
                ),
            updatedAt: time()
        };

        write(
            FILE.birthdays,
            database
        );

        res.json({
            ok: true,
            birthday:
                database[userId]
        });
    }
);

function checkBirthdays() {

    const birthdays =
        read(
            FILE.birthdays,
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

    const key =
        `${month}-${day}`;

    for (
        const birthday
        of Object.values(birthdays)
    ) {

        const parts =
            String(
                birthday.date
            ).split("-");

        if (
            parts.length !== 3
        ) {
            continue;
        }

        if (
            `${parts[1]}-${parts[2]}` !==
            key
        ) {
            continue;
        }

        const notification =
            createNotification(
                birthday.userId,
                "birthday",
                "Doğum günün kutlu olsun!",
                birthday.note ||
                    "Bugün senin özel günün.",
                {
                    birthday: true
                }
            );

        notify(
            birthday.userId,
            "notification:new",
            notification
        );
    }
}

setInterval(
    checkBirthdays,
    10 * 60 * 1000
);

const connectedUsers =
    new Map();

function setUserOnline(
    userId,
    socket
) {

    const database =
        read(FILE.users, {});

    if (!database[userId]) {
        return null;
    }

    database[userId].online =
        true;

    database[userId].lastSeen =
        null;

    database[userId].updatedAt =
        time();

    write(
        FILE.users,
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
        read(FILE.users, {});

    if (
        database[userId]
    ) {

        database[userId].online =
            false;

        database[userId].lastSeen =
            time();

        database[userId].updatedAt =
            time();

        write(
            FILE.users,
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

io.on(
    "connection",
    socket => {

        socket.on(
            "user:online",
            payload => {

                if (!payload) {
                    return;
                }

                const userId =
                    text(
                        payload.userId,
                        200
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
                            error:
                                "Kullanıcı bulunamadı"
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

                const id =
                    text(
                        payload?.chatId,
                        300
                    );

                if (!id) {
                    return;
                }

                socket.join(
                    "chat:" + id
                );

                socket.emit(
                    "chat:joined",
                    {
                        chatId: id
                    }
                );
            }
        );

        socket.on(
            "chat:leave",
            payload => {

                const id =
                    text(
                        payload?.chatId,
                        300
                    );

                if (!id) {
                    return;
                }

                socket.leave(
                    "chat:" + id
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
                    text(
                        payload.senderId ||
                            socket.data.userId,
                        200
                    );

                const receiverId =
                    text(
                        payload.receiverId,
                        200
                    );

                if (!senderId) {
                    return;
                }

                const currentChat =
                    text(
                        payload.chatId,
                        300
                    ) ||
                    (
                        receiverId
                            ? chatId(
                                senderId,
                                receiverId
                            )
                            : ""
                    );

                if (!currentChat) {
                    return;
                }

                const message =
                    createMessage({
                        chatId:
                            currentChat,

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

                io.to(
                    "chat:" +
                    currentChat
                ).emit(
                    "message:new",
                    message
                );

                if (
                    receiverId
                ) {

                    notify(
                        receiverId,
                        "message:new",
                        message
                    );

                    const notification =
                        createNotification(
                            receiverId,
                            "message",
                            payload.senderName ||
                                "Yeni mesaj",
                            message.type ===
                                "voice"
                                ? "🎙️ Sesli mesaj"
                                : message.text ||
                                  "Yeni mesaj",
                            {
                                chatId:
                                    currentChat,

                                messageId:
                                    message.id,

                                senderId
                            }
                        );

                    notify(
                        receiverId,
                        "notification:new",
                        notification
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

                const id =
                    text(
                        payload?.chatId,
                        300
                    );

                const userId =
                    text(
                        payload?.userId ||
                            socket.data.userId,
                        200
                    );

                if (!id || !userId) {
                    return;
                }

                socket.to(
                    "chat:" + id
                ).emit(
                    "typing:start",
                    {
                        chatId: id,
                        userId
                    }
                );
            }
        );

        socket.on(
            "typing:stop",
            payload => {

                const id =
                    text(
                        payload?.chatId,
                        300
                    );

                const userId =
                    text(
                        payload?.userId ||
                            socket.data.userId,
                        200
                    );

                if (!id || !userId) {
                    return;
                }

                socket.to(
                    "chat:" + id
                ).emit(
                    "typing:stop",
                    {
                        chatId: id,
                        userId
                    }
                );
            }
        );

        socket.on(
            "message:delivered",
            payload => {

                const chat =
                    text(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    text(
                        payload?.messageId,
                        300
                    );

                if (
                    !chat ||
                    !messageId
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chat,
                        messageId,
                        item => {
                            item.status =
                                "delivered";

                            item.deliveredAt =
                                time();
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chat
                ).emit(
                    "message:status",
                    {
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

                const chat =
                    text(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    text(
                        payload?.messageId,
                        300
                    );

                if (
                    !chat ||
                    !messageId
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chat,
                        messageId,
                        item => {
                            item.status =
                                "read";

                            item.readAt =
                                time();
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chat
                ).emit(
                    "message:status",
                    {
                        messageId,
                        status: "read",
                        readAt:
                            message.readAt
                    }
                );
            }
        );

        socket.on(
            "message:edit",
            payload => {

                const chat =
                    text(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    text(
                        payload?.messageId,
                        300
                    );

                const newText =
                    text(
                        payload?.text
                    );

                if (
                    !chat ||
                    !messageId ||
                    !newText
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chat,
                        messageId,
                        item => {
                            item.text =
                                newText;

                            item.edited =
                                true;

                            item.editedAt =
                                time();
                        }
                    );

                if (!message) {
                    return;
                }

                io.to(
                    "chat:" + chat
                ).emit(
                    "message:edited",
                    message
                );
            }
        );

        socket.on(
            "message:delete",
            payload => {

                const chat =
                    text(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    text(
                        payload?.messageId,
                        300
                    );

                if (
                    !chat ||
                    !messageId
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chat,
                        messageId,
                        item => {
                            item.deleted =
                                true;

                            item.deletedAt =
                                time();

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
                    "chat:" + chat
                ).emit(
                    "message:deleted",
                    {
                        chatId: chat,
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

                const chat =
                    text(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    text(
                        payload?.messageId,
                        300
                    );

                const userId =
                    text(
                        payload?.userId ||
                            socket.data.userId,
                        200
                    );

                const emoji =
                    text(
                        payload?.emoji,
                        20
                    );

                if (
                    !chat ||
                    !messageId ||
                    !userId ||
                    !emoji
                ) {
                    return;
                }

                const message =
                    updateMessage(
                        chat,
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
                    "chat:" + chat
                ).emit(
                    "message:reaction",
                    {
                        chatId: chat,
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
                    text(
                        payload?.senderId ||
                            socket.data.userId,
                        200
                    );

                const receiverId =
                    text(
                        payload?.receiverId,
                        200
                    );

                const chat =
                    text(
                        payload?.chatId,
                        300
                    ) ||
                    (
                        receiverId
                            ? chatId(
                                senderId,
                                receiverId
                            )
                            : ""
                    );

                if (
                    !senderId ||
                    !chat
                ) {
                    return;
                }

                const message =
                    createMessage({
                        chatId: chat,
                        senderId,
                        receiverId,
                        type: "voice",
                        media: {
                            url:
                                payload.audioUrl ||
                                null,

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

                io.to(
                    "chat:" + chat
                ).emit(
                    "message:new",
                    message
                );

                if (receiverId) {
                    notify(
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

                const chat =
                    text(
                        payload?.chatId,
                        300
                    );

                if (!chat) {
                    return;
                }

                io.to(
                    "chat:" + chat
                ).emit(
                    "effect:play",
                    {
                        effect:
                            text(
                                payload.effect,
                                50
                            ),

                        userId:
                            text(
                                payload.userId ||
                                    socket.data.userId,
                                200
                            ),

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
                    text(
                        payload?.callerId ||
                            socket.data.userId,
                        200
                    );

                const receiverId =
                    text(
                        payload?.receiverId,
                        200
                    );

                if (
                    !callerId ||
                    !receiverId
                ) {
                    return;
                }

                const type =
                    payload.callType ===
                        "video"
                        ? "video"
                        : "voice";

                const call = {

                    id:
                        id("call"),

                    callerId,

                    receiverId,

                    type,

                    status:
                        "ringing",

                    createdAt:
                        time(),

                    answeredAt:
                        null,

                    endedAt:
                        null
                };

                const database =
                    read(
                        FILE.calls,
                        {}
                    );

                database[call.id] =
                    call;

                write(
                    FILE.calls,
                    database
                );

                notify(
                    receiverId,
                    "call:incoming",
                    call
                );

                notify(
                    receiverId,
                    "phone:ring",
                    {
                        callId:
                            call.id,

                        type,

                        vibration:
                            true,

                        sound:
                            true
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

                const database =
                    read(
                        FILE.calls,
                        {}
                    );

                const call =
                    database[
                        payload?.callId
                    ];

                if (!call) {
                    return;
                }

                call.status =
                    "connected";

                call.answeredAt =
                    time();

                write(
                    FILE.calls,
                    database
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

                const database =
                    read(
                        FILE.calls,
                        {}
                    );

                const call =
                    database[
                        payload?.callId
                    ];

                if (!call) {
                    return;
                }

                call.status =
                    "rejected";

                call.endedAt =
                    time();

                write(
                    FILE.calls,
                    database
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

                const database =
                    read(
                        FILE.calls,
                        {}
                    );

                const call =
                    database[
                        payload?.callId
                    ];

                if (!call) {
                    return;
                }

                call.status =
                    "ended";

                call.endedAt =
                    time();

                write(
                    FILE.calls,
                    database
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
                    text(
                        payload?.receiverId,
                        200
                    );

                if (!receiverId) {
                    return;
                }

                io.to(
                    "user:" +
                    receiverId
                ).emit(
                    "call:signal",
                    {
                        ...payload,
                        receivedAt:
                            time()
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
                        time:
                            time()
                    }
                );
            }
        );

        socket.on(
            "disconnect",
            () => {

                if (
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

app.use(
    (error, req, res, next) => {

        console.error(
            "[SERVER ERROR]",
            error
        );

        if (
            res.headersSent
        ) {
            return next(error);
        }

        res.status(500).json({
            ok: false,
            error:
                "Sunucu tarafında bir hata oluştu."
        });
    }
);

const shutdown =
    signal => {

        console.log(
            signal +
            " received"
        );

        io.close(
            () => {

                server.close(
                    () => {

                        process.exit(
                            0
                        );
                    }
                );
            }
        );

        setTimeout(
            () => {
                process.exit(1);
            },
            5000
        );
    };

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

server.listen(
    PORT,
    HOST,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );
    }
);
