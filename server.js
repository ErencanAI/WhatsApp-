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

const DATA = path.join(__dirname, "data");
const CHAT_DATA = path.join(DATA, "chats");

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CHAT_DATA, { recursive: true });

const FILES = {
    users: path.join(DATA, "users.json"),
    sessions: path.join(DATA, "sessions.json"),
    notifications: path.join(DATA, "notifications.json"),
    calls: path.join(DATA, "calls.json"),
    birthdays: path.join(DATA, "birthdays.json")
};

function ensure(file, value) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(value, null, 2),
            "utf8"
        );
    }
}

ensure(FILES.users, {});
ensure(FILES.sessions, {});
ensure(FILES.notifications, {});
ensure(FILES.calls, {});
ensure(FILES.birthdays, {});

function read(file, fallback) {
    try {
        const value = fs.readFileSync(file, "utf8");

        if (!value.trim()) {
            return fallback;
        }

        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function write(file, value) {
    const temp = file + ".tmp";

    fs.writeFileSync(
        temp,
        JSON.stringify(value, null, 2),
        "utf8"
    );

    fs.renameSync(temp, file);
}

function makeId(prefix) {
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

function clean(value, max = 10000) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .trim()
        .slice(0, max);
}

function makeChatId(a, b) {
    return [String(a), String(b)]
        .sort()
        .join("__");
}

function chatFile(chatId) {
    return path.join(
        CHAT_DATA,
        chatId + ".json"
    );
}

function getChat(chatId) {
    return read(
        chatFile(chatId),
        {
            id: chatId,
            messages: [],
            createdAt: now(),
            updatedAt: now()
        }
    );
}

function saveChat(chatId, chat) {
    write(
        chatFile(chatId),
        chat
    );
}

function createMessage(data) {
    return {
        id: makeId("msg"),
        chatId: data.chatId,
        senderId: data.senderId,
        receiverId: data.receiverId || null,
        type: data.type || "text",
        text: clean(data.text),
        media: data.media || null,
        replyTo: data.replyTo || null,
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
    const chat = getChat(message.chatId);

    chat.messages.push(message);

    if (chat.messages.length > 5000) {
        chat.messages = chat.messages.slice(-5000);
    }

    chat.updatedAt = now();

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
    const chat = getChat(chatId);

    const message = chat.messages.find(
        item => item.id === messageId
    );

    if (!message) {
        return null;
    }

    callback(message);

    chat.updatedAt = now();

    saveChat(
        chatId,
        chat
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
    express.static(__dirname)
);

const requestMap = new Map();

app.use(
    "/api",
    (req, res, next) => {

        const key =
            req.ip ||
            req.socket.remoteAddress ||
            "unknown";

        const current = Date.now();

        let record = requestMap.get(key);

        if (
            !record ||
            current - record.time > 60000
        ) {
            record = {
                time: current,
                count: 0
            };

            requestMap.set(key, record);
        }

        record.count++;

        if (record.count > 250) {
            return res.status(429).json({
                ok: false,
                error: "Too many requests"
            });
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
            time: now()
        });
    }
);

app.get(
    "/api/info",
    (req, res) => {
        res.json({
            ok: true,
            name: "Realtime Chat Server",
            version: "4.0.0",
            socket: true
        });
    }
);

app.post(
    "/api/users",
    (req, res) => {

        const username = clean(
            req.body.username,
            40
        );

        const displayName = clean(
            req.body.displayName,
            80
        );

        if (!username || !displayName) {
            return res.status(400).json({
                ok: false,
                error: "username ve displayName gerekli"
            });
        }

        const database =
            read(FILES.users, {});

        if (database[username]) {
            return res.status(409).json({
                ok: false,
                error: "Kullanıcı zaten var"
            });
        }

        database[username] = {
            id: username,
            username,
            displayName,
            avatar:
                clean(req.body.avatar, 500000) ||
                null,
            birthday:
                clean(req.body.birthday, 30) ||
                null,
            online: false,
            lastSeen: now(),
            createdAt: now(),
            updatedAt: now()
        };

        write(
            FILES.users,
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
            read(FILES.users, {});

        const user =
            database[req.params.id];

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
            limit < 1
        ) {
            limit = 100;
        }

        limit = Math.min(
            limit,
            500
        );

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
            clean(
                req.body.username,
                40
            );

        const database =
            read(FILES.users, {});

        const user =
            database[username];

        if (!user) {
            return res.status(404).json({
                ok: false,
                error: "Kullanıcı bulunamadı"
            });
        }

        const sessions =
            read(FILES.sessions, {});

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
        read(
            FILES.notifications,
            {}
        );

    if (!database[userId]) {
        database[userId] = [];
    }

    const notification = {
        id: makeId("notification"),
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
        database[userId].length > 200
    ) {
        database[userId] =
            database[userId].slice(-200);
    }

    write(
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
            read(
                FILES.notifications,
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
            clean(
                req.body.userId,
                200
            );

        const notificationId =
            clean(
                req.body.notificationId,
                200
            );

        const database =
            read(
                FILES.notifications,
                {}
            );

        const list =
            database[userId] || [];

        const item =
            list.find(
                x =>
                    x.id ===
                    notificationId
            );

        if (item) {
            item.read = true;
            item.readAt = now();
        }

        write(
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
            clean(
                req.body.userId,
                200
            );

        const date =
            clean(
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
                FILES.birthdays,
                {}
            );

        database[userId] = {
            userId,
            date,
            note:
                clean(
                    req.body.note,
                    500
                ),
            updatedAt: now()
        };

        write(
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

const connectedUsers =
    new Map();

function setOnline(
    userId,
    socket
) {

    const database =
        read(FILES.users, {});

    if (!database[userId]) {
        return null;
    }

    database[userId].online = true;
    database[userId].lastSeen = null;
    database[userId].updatedAt = now();

    write(
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

function setOffline(
    userId,
    socketId
) {

    if (
        connectedUsers.get(userId) !==
        socketId
    ) {
        return;
    }

    connectedUsers.delete(
        userId
    );

    const database =
        read(FILES.users, {});

    if (!database[userId]) {
        return;
    }

    database[userId].online = false;
    database[userId].lastSeen = now();
    database[userId].updatedAt = now();

    write(
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

function getCall(
    callId
) {
    const database =
        read(FILES.calls, {});

    return database[callId] || null;
}

function saveCall(
    call
) {
    const database =
        read(FILES.calls, {});

    database[call.id] =
        call;

    write(
        FILES.calls,
        database
    );

    return call;
}

function sendCallEvent(
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

                const userId =
                    clean(
                        payload?.userId,
                        200
                    );

                if (!userId) {
                    return;
                }

                const user =
                    setOnline(
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
                    clean(
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
                    clean(
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
                    clean(
                        payload.senderId ||
                            socket.data.userId,
                        200
                    );

                const receiverId =
                    clean(
                        payload.receiverId,
                        200
                    );

                if (!senderId) {
                    return;
                }

                const currentChat =
                    clean(
                        payload.chatId,
                        300
                    ) ||
                    (
                        receiverId
                            ? makeChatId(
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

                if (receiverId) {

                    notifyUser(
                        receiverId,
                        "message:new",
                        message
                    );

                    createNotification(
                        receiverId,
                        "message",
                        payload.senderName ||
                            "Yeni mesaj",
                        message.type === "voice"
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
                    clean(
                        payload?.chatId,
                        300
                    );

                const userId =
                    clean(
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
                    clean(
                        payload?.chatId,
                        300
                    );

                const userId =
                    clean(
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
                    clean(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    clean(
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
                                now();
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
                    clean(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    clean(
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
                                now();
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

                const chat =
                    clean(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    clean(
                        payload?.messageId,
                        300
                    );

                const newText =
                    clean(
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
                                now();
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
                    clean(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    clean(
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
                    clean(
                        payload?.chatId,
                        300
                    );

                const messageId =
                    clean(
                        payload?.messageId,
                        300
                    );

                const userId =
                    clean(
                        payload?.userId ||
                            socket.data.userId,
                        200
                    );

                const emoji =
                    clean(
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
                    clean(
                        payload?.senderId ||
                            socket.data.userId,
                        200
                    );

                const receiverId =
                    clean(
                        payload?.receiverId,
                        200
                    );

                const chat =
                    clean(
                        payload?.chatId,
                        300
                    ) ||
                    (
                        receiverId
                            ? makeChatId(
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

                const chat =
                    clean(
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
                            clean(
                                payload.effect,
                                50
                            ),
                        userId:
                            clean(
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
                    clean(
                        payload?.callerId ||
                            socket.data.userId,
                        200
                    );

                const receiverId =
                    clean(
                        payload?.receiverId,
                        200
                    );

                if (
                    !callerId ||
                    !receiverId
                ) {
                    return;
                }

                const call = {
                    id: makeId("call"),
                    callerId,
                    receiverId,
                    type:
                        payload.callType === "video"
                            ? "video"
                            : "voice",
                    status: "ringing",
                    createdAt: now(),
                    answeredAt: null,
                    endedAt: null
                };

                saveCall(call);

                notifyUser(
                    receiverId,
                    "call:incoming",
                    call
                );

                notifyUser(
                    receiverId,
                    "phone:ring",
                    {
                        callId: call.id,
                        type: call.type,
                        sound: true,
                        vibration: true
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
                        payload?.callId
                    );

                if (!call) {
                    return;
                }

                call.status =
                    "connected";

                call.answeredAt =
                    now();

                saveCall(call);

                sendCallEvent(
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
                        payload?.callId
                    );

                if (!call) {
                    return;
                }

                call.status =
                    "rejected";

                call.endedAt =
                    now();

                saveCall(call);

                sendCallEvent(
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
                        payload?.callId
                    );

                if (!call) {
                    return;
                }

                call.status =
                    "ended";

                call.endedAt =
                    now();

                saveCall(call);

                sendCallEvent(
                    call,
                    "call:ended"
                );
            }
        );

        socket.on(
            "call:signal",
            payload => {

                const receiverId =
                    clean(
                        payload?.receiverId,
                        200
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
            () => {

                if (
                    socket.data.userId
                ) {
                    setOffline(
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
                "Internal server error"
        });
    }
);

setInterval(
    checkBirthdays,
    10 * 60 * 1000
);

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Server: http://localhost:${PORT}`
        );
    }
);

process.on(
    "SIGINT",
    () => {
        io.close();
        server.close(
            () => process.exit(0)
        );
    }
);

process.on(
    "SIGTERM",
    () => {
        io.close();
        server.close(
            () => process.exit(0)
        );
    }
);
