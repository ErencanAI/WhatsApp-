"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: true,
        methods: ["GET", "POST", "PATCH"]
    },
    maxHttpBufferSize: 10 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const DATA_DIR = path.join(__dirname, "data");

const FILES = {
    users: path.join(DATA_DIR, "users.json"),
    chats: path.join(DATA_DIR, "chats.json"),
    messages: path.join(DATA_DIR, "messages.json"),
    sessions: path.join(DATA_DIR, "sessions.json")
};

/* =========================================================
   DATA
========================================================= */

function ensureData() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    for (const file of Object.values(FILES)) {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, "[]", "utf8");
        }
    }
}

ensureData();

function readJSON(file) {
    try {
        const raw = fs.readFileSync(file, "utf8");
        return JSON.parse(raw || "[]");
    } catch (error) {
        console.error("JSON okuma hatası:", file, error.message);
        return [];
    }
}

function writeJSON(file, data) {
    const temp = file + ".tmp";

    fs.writeFileSync(
        temp,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(temp, file);
}

function loadUsers() {
    return readJSON(FILES.users);
}

function saveUsers(data) {
    writeJSON(FILES.users, data);
}

function loadChats() {
    return readJSON(FILES.chats);
}

function saveChats(data) {
    writeJSON(FILES.chats, data);
}

function loadMessages() {
    return readJSON(FILES.messages);
}

function saveMessages(data) {
    writeJSON(FILES.messages, data);
}

function loadSessions() {
    return readJSON(FILES.sessions);
}

function saveSessions(data) {
    writeJSON(FILES.sessions, data);
}

/* =========================================================
   HELPERS
========================================================= */

function id(prefix = "") {
    return prefix +
        crypto.randomBytes(10).toString("hex");
}

function now() {
    return new Date().toISOString();
}

function clean(value, max = 500) {
    return String(value ?? "")
        .trim()
        .slice(0, max);
}

function normalizeUsername(value) {
    return clean(value, 32)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, "");
}

function hashPin(pin) {
    const salt = crypto.randomBytes(16).toString("hex");

    const hash = crypto
        .scryptSync(String(pin), salt, 64)
        .toString("hex");

    return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
    try {
        const [salt, original] = String(stored).split(":");

        if (!salt || !original) return false;

        const hash = crypto
            .scryptSync(String(pin), salt, 64)
            .toString("hex");

        return crypto.timingSafeEqual(
            Buffer.from(hash, "hex"),
            Buffer.from(original, "hex")
        );
    } catch {
        return false;
    }
}

function generateUserCode(users) {
    let code;

    do {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        let part = "";

        for (let i = 0; i < 6; i++) {
            part += chars[
                crypto.randomInt(0, chars.length)
            ];
        }

        code = `TRK-${part}`;
    } while (
        users.some(
            user =>
                user.code.toUpperCase() ===
                code.toUpperCase()
        )
    );

    return code;
}

function publicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        username: user.username,
        code: user.code,
        bio: user.bio || "",
        avatar: user.avatar || "",
        createdAt: user.createdAt,
        online: Boolean(user.online)
    };
}

function getToken(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        return null;
    }

    return header.slice(7).trim();
}

function userFromToken(token) {
    if (!token) return null;

    const sessions = loadSessions();

    const session = sessions.find(
        item =>
            item.token === token &&
            item.expiresAt > Date.now()
    );

    if (!session) return null;

    const users = loadUsers();

    return users.find(
        user => user.id === session.userId
    ) || null;
}

function auth(req, res, next) {
    const user = userFromToken(getToken(req));

    if (!user) {
        return res.status(401).json({
            success: false,
            error: "Oturum geçersiz veya süresi dolmuş."
        });
    }

    req.user = user;
    next();
}

function createSession(userId) {
    const sessions = loadSessions();

    const token = crypto
        .randomBytes(48)
        .toString("hex");

    const session = {
        id: id("ses_"),
        userId,
        token,
        createdAt: now(),

        // 180 gün
        expiresAt:
            Date.now() +
            180 * 24 * 60 * 60 * 1000
    };

    sessions.push(session);

    saveSessions(sessions);

    return token;
}

function findUser(identifier) {
    const users = loadUsers();

    const value = clean(identifier, 100)
        .toLowerCase();

    return users.find(user =>
        user.username.toLowerCase() === value ||
        user.code.toLowerCase() === value ||
        user.id.toLowerCase() === value
    );
}

function areBlocked(a, b) {
    const users = loadUsers();

    const userA = users.find(x => x.id === a);
    const userB = users.find(x => x.id === b);

    if (!userA || !userB) return true;

    return (
        Array.isArray(userA.blocked) &&
        userA.blocked.includes(b)
    ) || (
        Array.isArray(userB.blocked) &&
        userB.blocked.includes(a)
    );
}

function getPrivateChat(a, b) {
    const chats = loadChats();

    return chats.find(chat =>
        chat.type === "private" &&
        Array.isArray(chat.members) &&
        chat.members.length === 2 &&
        chat.members.includes(a) &&
        chat.members.includes(b)
    );
}

function getChat(chatId) {
    const chats = loadChats();

    return chats.find(
        chat => chat.id === chatId
    );
}

function userInChat(chat, userId) {
    return Boolean(
        chat &&
        Array.isArray(chat.members) &&
        chat.members.includes(userId)
    );
}

function emitToUser(userId, event, data) {
    const sockets = onlineSockets.get(userId);

    if (!sockets) return;

    for (const socketId of sockets) {
        io.to(socketId).emit(event, data);
    }
}

/* =========================================================
   ONLINE SOCKETS
========================================================= */

const onlineSockets = new Map();

function addSocket(userId, socketId) {
    if (!onlineSockets.has(userId)) {
        onlineSockets.set(userId, new Set());
    }

    onlineSockets.get(userId).add(socketId);
}

function removeSocket(userId, socketId) {
    const set = onlineSockets.get(userId);

    if (!set) return;

    set.delete(socketId);

    if (set.size === 0) {
        onlineSockets.delete(userId);

        const users = loadUsers();

        const user = users.find(
            x => x.id === userId
        );

        if (user) {
            user.online = false;
            user.lastSeen = now();
            saveUsers(users);
        }
    }
}

function setOnline(userId, online) {
    const users = loadUsers();

    const user = users.find(
        x => x.id === userId
    );

    if (!user) return;

    user.online = online;

    if (!online) {
        user.lastSeen = now();
    }

    saveUsers(users);
}

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json({
    limit: "12mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "12mb"
}));

app.use(express.static(__dirname));

/* =========================================================
   BASIC
========================================================= */

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        service: "MesajX",
        status: "online",
        time: now()
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        onlineUsers: onlineSockets.size,
        users: loadUsers().length,
        chats: loadChats().length,
        messages: loadMessages().length
    });
});

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", (req, res) => {
    try {
        const name = clean(req.body.name, 60);
        const username = normalizeUsername(
            req.body.username
        );
        const pin = String(req.body.pin || "");

        if (name.length < 2) {
            return res.status(400).json({
                success: false,
                error: "Ad en az 2 karakter olmalı."
            });
        }

        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                error: "Kullanıcı adı en az 3 karakter olmalı."
            });
        }

        if (!/^\d{4,8}$/.test(pin)) {
            return res.status(400).json({
                success: false,
                error: "PIN 4-8 rakam olmalı."
            });
        }

        const users = loadUsers();

        if (
            users.some(
                user =>
                    user.username.toLowerCase() ===
                    username.toLowerCase()
            )
        ) {
            return res.status(409).json({
                success: false,
                error: "Bu kullanıcı adı zaten alınmış."
            });
        }

        const user = {
            id: id("usr_"),
            name,
            username,
            code: generateUserCode(users),
            pinHash: hashPin(pin),
            bio: "",
            avatar: "",
            blocked: [],
            online: false,
            lastSeen: null,
            createdAt: now()
        };

        users.push(user);
        saveUsers(users);

        const token = createSession(user.id);

        user.online = true;
        saveUsers(users);

        return res.json({
            success: true,
            token,
            sessionToken: token,
            user: publicUser(user),
            code: user.code
        });

    } catch (error) {
        console.error("REGISTER ERROR:", error);

        res.status(500).json({
            success: false,
            error: "Hesap oluşturulamadı."
        });
    }
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", (req, res) => {
    try {
        const identifier = clean(
            req.body.identifier,
            100
        );

        const pin = String(
            req.body.pin || ""
        );

        const user = findUser(identifier);

        if (!user || !verifyPin(pin, user.pinHash)) {
            return res.status(401).json({
                success: false,
                error: "Kullanıcı adı/kod veya PIN yanlış."
            });
        }

        const token = createSession(user.id);

        user.online = true;

        const users = loadUsers();

        const index = users.findIndex(
            x => x.id === user.id
        );

        if (index !== -1) {
            users[index] = user;
            saveUsers(users);
        }

        res.json({
            success: true,
            token,
            sessionToken: token,
            user: publicUser(user),
            code: user.code
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        res.status(500).json({
            success: false,
            error: "Giriş yapılamadı."
        });
    }
});

/* =========================================================
   ME
========================================================= */

app.get("/api/me", auth, (req, res) => {
    res.json({
        success: true,
        user: publicUser(req.user)
    });
});

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/logout", auth, (req, res) => {
    const token = getToken(req);

    const sessions = loadSessions()
        .filter(session =>
            session.token !== token
        );

    saveSessions(sessions);

    setOnline(req.user.id, false);

    res.json({
        success: true
    });
});

/* =========================================================
   USER SEARCH
========================================================= */

app.get("/api/users/search", auth, (req, res) => {
    const q = clean(
        req.query.q,
        80
    ).toLowerCase();

    if (!q) {
        return res.json({
            success: true,
            users: []
        });
    }

    const users = loadUsers();

    const results = users
        .filter(user => user.id !== req.user.id)
        .filter(user => {
            const name =
                user.name.toLowerCase();

            const username =
                user.username.toLowerCase();

            const code =
                user.code.toLowerCase();

            return (
                name.includes(q) ||
                username.includes(q) ||
                code.includes(q)
            );
        })
        .slice(0, 30)
        .map(publicUser);

    res.json({
        success: true,
        users: results
    });
});

/* =========================================================
   PROFILE
========================================================= */

app.patch("/api/profile", auth, (req, res) => {
    const users = loadUsers();

    const user = users.find(
        x => x.id === req.user.id
    );

    if (!user) {
        return res.status(404).json({
            success: false,
            error: "Kullanıcı bulunamadı."
        });
    }

    if (req.body.name !== undefined) {
        user.name = clean(
            req.body.name,
            60
        );
    }

    if (req.body.bio !== undefined) {
        user.bio = clean(
            req.body.bio,
            180
        );
    }

    if (req.body.avatar !== undefined) {
        user.avatar = clean(
            req.body.avatar,
            1000000
        );
    }

    saveUsers(users);

    res.json({
        success: true,
        user: publicUser(user)
    });
});

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", socket => {

    let currentUserId = null;

    /* -----------------------------------------------
       AUTHENTICATE
    ------------------------------------------------ */

    socket.on("authenticate", (data, callback) => {
        try {
            const token =
                data &&
                typeof data.token === "string"
                    ? data.token
                    : null;

            const user =
                userFromToken(token);

            if (!user) {
                if (typeof callback === "function") {
                    callback({
                        success: false,
                        error: "Oturum geçersiz."
                    });
                }

                return;
            }

            currentUserId = user.id;

            socket.userId = user.id;

            addSocket(
                user.id,
                socket.id
            );

            setOnline(user.id, true);

            if (typeof callback === "function") {
                callback({
                    success: true,
                    user: publicUser(user)
                });
            }

            socket.emit(
                "authenticated",
                {
                    success: true,
                    user: publicUser(user)
                }
            );

        } catch (error) {
            console.error(
                "SOCKET AUTH ERROR:",
                error
            );

            if (typeof callback === "function") {
                callback({
                    success: false,
                    error: "Kimlik doğrulama hatası."
                });
            }
        }
    });

    /* -----------------------------------------------
       GET CHATS
    ------------------------------------------------ */

    socket.on("get_chats", callback => {
        if (!currentUserId) return;

        const chats = loadChats();
        const messages = loadMessages();
        const users = loadUsers();

        const result = chats
            .filter(chat =>
                userInChat(
                    chat,
                    currentUserId
                )
            )
            .map(chat => {

                const lastMessages =
                    messages
                        .filter(
                            message =>
                                message.chatId ===
                                chat.id
                        )
                        .sort(
                            (a, b) =>
                                new Date(b.createdAt) -
                                new Date(a.createdAt)
                        );

                const last =
                    lastMessages[0] || null;

                const otherId =
                    chat.type === "private"
                        ? chat.members.find(
                            id =>
                                id !==
                                currentUserId
                        )
                        : null;

                const other =
                    otherId
                        ? users.find(
                            u =>
                                u.id === otherId
                        )
                        : null;

                return {
                    ...chat,
                    otherUser:
                        publicUser(other),
                    lastMessage: last
                        ? {
                            id: last.id,
                            text: last.text,
                            senderId:
                                last.senderId,
                            createdAt:
                                last.createdAt,
                            status:
                                last.status,
                            readBy:
                                last.readBy || []
                        }
                        : null
                };
            })
            .sort((a, b) => {
                const ad =
                    a.lastMessage?.createdAt || 0;

                const bd =
                    b.lastMessage?.createdAt || 0;

                return (
                    new Date(bd) -
                    new Date(ad)
                );
            });

        if (typeof callback === "function") {
            callback({
                success: true,
                chats: result
            });
        }
    });

    /* -----------------------------------------------
       SEARCH USERS SOCKET
    ------------------------------------------------ */

    socket.on("search_users", (data, callback) => {
        if (!currentUserId) return;

        const q = clean(
            data?.q,
            80
        ).toLowerCase();

        const users = loadUsers();

        const results = users
            .filter(
                user =>
                    user.id !==
                    currentUserId
            )
            .filter(user => {

                const text = [
                    user.name,
                    user.username,
                    user.code
                ]
                    .join(" ")
                    .toLowerCase();

                return text.includes(q);
            })
            .slice(0, 30)
            .map(publicUser);

        if (typeof callback === "function") {
            callback({
                success: true,
                users: results
            });
        }
    });

    /* -----------------------------------------------
       CREATE PRIVATE CHAT
    ------------------------------------------------ */

    socket.on(
        "create_chat",
        (data, callback) => {

            if (!currentUserId) return;

            try {
                const type =
                    data?.type || "private";

                const members =
                    Array.isArray(data?.members)
                        ? data.members
                        : [];

                if (type === "private") {

                    const targetId =
                        members.find(
                            x =>
                                x !==
                                currentUserId
                        );

                    if (!targetId) {
                        return callback?.({
                            success: false,
                            error:
                                "Kullanıcı seçilmedi."
                        });
                    }

                    if (
                        areBlocked(
                            currentUserId,
                            targetId
                        )
                    ) {
                        return callback?.({
                            success: false,
                            error:
                                "Bu kullanıcıyla sohbet başlatılamıyor."
                        });
                    }

                    const target =
                        loadUsers().find(
                            x =>
                                x.id ===
                                targetId
                        );

                    if (!target) {
                        return callback?.({
                            success: false,
                            error:
                                "Kullanıcı bulunamadı."
                        });
                    }

                    const existing =
                        getPrivateChat(
                            currentUserId,
                            targetId
                        );

                    if (existing) {
                        callback?.({
                            success: true,
                            chat: existing
                        });

                        return;
                    }

                    const chats = loadChats();

                    const chat = {
                        id: id("chat_"),
                        type: "private",
                        members: [
                            currentUserId,
                            targetId
                        ],
                        createdBy:
                            currentUserId,
                        createdAt: now()
                    };

                    chats.push(chat);

                    saveChats(chats);

                    emitToUser(
                        targetId,
                        "chat_created",
                        {
                            chat
                        }
                    );

                    callback?.({
                        success: true,
                        chat
                    });

                    return;
                }

                /* GROUP */

                const uniqueMembers =
                    [...new Set([
                        currentUserId,
                        ...members
                    ])];

                if (uniqueMembers.length < 2) {
                    return callback?.({
                        success: false,
                        error:
                            "Grupta en az 2 kişi olmalı."
                    });
                }

                const chats = loadChats();

                const group = {
                    id: id("chat_"),
                    type: "group",
                    name:
                        clean(
                            data?.name ||
                            "Yeni Grup",
                            80
                        ),
                    members:
                        uniqueMembers,
                    createdBy:
                        currentUserId,
                    createdAt: now()
                };

                chats.push(group);

                saveChats(chats);

                for (const memberId of uniqueMembers) {
                    emitToUser(
                        memberId,
                        "chat_created",
                        {
                            chat: group
                        }
                    );
                }

                callback?.({
                    success: true,
                    chat: group
                });

            } catch (error) {
                console.error(
                    "CREATE CHAT ERROR:",
                    error
                );

                callback?.({
                    success: false,
                    error:
                        "Sohbet oluşturulamadı."
                });
            }
        }
    );

    /* -----------------------------------------------
       GET MESSAGES
    ------------------------------------------------ */

    socket.on(
        "get_messages",
        (data, callback) => {

            if (!currentUserId) return;

            const chatId =
                clean(data?.chatId, 100);

            const chat =
                getChat(chatId);

            if (
                !chat ||
                !userInChat(
                    chat,
                    currentUserId
                )
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu sohbete erişimin yok."
                });
            }

            const messages =
                loadMessages()
                    .filter(
                        message =>
                            message.chatId ===
                            chatId
                    )
                    .sort(
                        (a, b) =>
                            new Date(a.createdAt) -
                            new Date(b.createdAt)
                    );

            callback?.({
                success: true,
                messages
            });
        }
    );

    /* -----------------------------------------------
       SEND MESSAGE
    ------------------------------------------------ */

    socket.on(
        "send_message",
        (data, callback) => {

            if (!currentUserId) return;

            const chatId =
                clean(data?.chatId, 100);

            const text =
                clean(data?.text, 10000);

            const chat =
                getChat(chatId);

            if (
                !chat ||
                !userInChat(
                    chat,
                    currentUserId
                )
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Sohbete erişilemiyor."
                });
            }

            if (!text) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj boş olamaz."
                });
            }

            for (const memberId of chat.members) {
                if (
                    memberId !== currentUserId &&
                    areBlocked(
                        currentUserId,
                        memberId
                    )
                ) {
                    return callback?.({
                        success: false,
                        error:
                            "Mesaj gönderilemiyor."
                    });
                }
            }

            const messages =
                loadMessages();

            const message = {
                id: id("msg_"),
                chatId,
                senderId:
                    currentUserId,
                text,
                type:
                    data?.type || "text",
                createdAt: now(),

                // İlk durumda gönderildi.
                status: "sent",

                // Mesajı kimin gördüğü.
                readBy: [],

                reactions: {},

                edited: false,
                deleted: false
            };

            messages.push(message);

            saveMessages(messages);

            callback?.({
                success: true,
                message
            });

            for (const memberId of chat.members) {

                emitToUser(
                    memberId,
                    "new_message",
                    {
                        message
                    }
                );
            }

            /* Alıcı online ise teslim edildi. */

            for (const memberId of chat.members) {

                if (
                    memberId ===
                    currentUserId
                ) {
                    continue;
                }

                const online =
                    onlineSockets.has(
                        memberId
                    );

                if (online) {

                    message.status =
                        "delivered";

                    const all =
                        loadMessages();

                    const index =
                        all.findIndex(
                            x =>
                                x.id ===
                                message.id
                        );

                    if (index !== -1) {
                        all[index] =
                            message;

                        saveMessages(all);
                    }

                    emitToUser(
                        currentUserId,
                        "message_delivered",
                        {
                            messageId:
                                message.id,
                            chatId
                        }
                    );
                }
            }
        }
    );

    /* -----------------------------------------------
       READ RECEIPT / GÖRÜLDÜ
    ------------------------------------------------ */

    socket.on(
        "read_receipt",
        data => {

            if (!currentUserId) return;

            const chatId =
                clean(data?.chatId, 100);

            const chat =
                getChat(chatId);

            if (
                !chat ||
                !userInChat(
                    chat,
                    currentUserId
                )
            ) {
                return;
            }

            const messages =
                loadMessages();

            const readMessageIds = [];

            for (const message of messages) {

                if (
                    message.chatId !==
                    chatId
                ) {
                    continue;
                }

                if (
                    message.senderId ===
                    currentUserId
                ) {
                    continue;
                }

                if (!Array.isArray(message.readBy)) {
                    message.readBy = [];
                }

                if (
                    !message.readBy.includes(
                        currentUserId
                    )
                ) {
                    message.readBy.push(
                        currentUserId
                    );

                    readMessageIds.push(
                        message.id
                    );
                }

                if (
                    message.readBy.length > 0
                ) {
                    message.status =
                        "read";
                }
            }

            saveMessages(messages);

            if (
                readMessageIds.length === 0
            ) {
                return;
            }

            for (
                const memberId of
                chat.members
            ) {

                if (
                    memberId ===
                    currentUserId
                ) {
                    continue;
                }

                emitToUser(
                    memberId,
                    "read_receipt",
                    {
                        chatId,
                        userId:
                            currentUserId,
                        messageIds:
                            readMessageIds,
                        at: now()
                    }
                );
            }
        }
    );

    /* -----------------------------------------------
       EDIT MESSAGE
    ------------------------------------------------ */

    socket.on(
        "edit_message",
        (data, callback) => {

            if (!currentUserId) return;

            const messageId =
                clean(data?.messageId, 100);

            const text =
                clean(data?.text, 10000);

            const messages =
                loadMessages();

            const message =
                messages.find(
                    x =>
                        x.id ===
                        messageId
                );

            if (!message) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj bulunamadı."
                });
            }

            if (
                message.senderId !==
                currentUserId
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu mesajı düzenleyemezsin."
                });
            }

            if (!text) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj boş olamaz."
                });
            }

            message.text = text;
            message.edited = true;
            message.editedAt = now();

            saveMessages(messages);

            const chat =
                getChat(message.chatId);

            if (chat) {
                for (
                    const memberId of
                    chat.members
                ) {
                    emitToUser(
                        memberId,
                        "message_edited",
                        {
                            message
                        }
                    );
                }
            }

            callback?.({
                success: true,
                message
            });
        }
    );

    /* -----------------------------------------------
       DELETE MESSAGE
    ------------------------------------------------ */

    socket.on(
        "delete_message",
        (data, callback) => {

            if (!currentUserId) return;

            const messageId =
                clean(data?.messageId, 100);

            const messages =
                loadMessages();

            const message =
                messages.find(
                    x =>
                        x.id ===
                        messageId
                );

            if (!message) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj bulunamadı."
                });
            }

            if (
                message.senderId !==
                currentUserId
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu mesajı silemezsin."
                });
            }

            message.deleted = true;
            message.text =
                "Bu mesaj silindi.";

            message.deletedAt = now();

            saveMessages(messages);

            const chat =
                getChat(message.chatId);

            if (chat) {
                for (
                    const memberId of
                    chat.members
                ) {
                    emitToUser(
                        memberId,
                        "message_deleted",
                        {
                            messageId,
                            chatId:
                                chat.id
                        }
                    );
                }
            }

            callback?.({
                success: true
            });
        }
    );

    /* -----------------------------------------------
       REACTION
    ------------------------------------------------ */

    socket.on(
        "react_message",
        (data, callback) => {

            if (!currentUserId) return;

            const messageId =
                clean(data?.messageId, 100);

            const emoji =
                clean(data?.emoji, 20);

            if (!emoji) {
                return callback?.({
                    success: false,
                    error:
                        "Emoji bulunamadı."
                });
            }

            const messages =
                loadMessages();

            const message =
                messages.find(
                    x =>
                        x.id ===
                        messageId
                );

            if (!message) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj bulunamadı."
                });
            }

            const chat =
                getChat(message.chatId);

            if (
                !chat ||
                !userInChat(
                    chat,
                    currentUserId
                )
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Erişim yok."
                });
            }

            if (!message.reactions) {
                message.reactions = {};
            }

            if (
                !Array.isArray(
                    message.reactions[emoji]
                )
            ) {
                message.reactions[emoji] = [];
            }

            const users =
                message.reactions[emoji];

            const existing =
                users.indexOf(
                    currentUserId
                );

            if (existing >= 0) {
                users.splice(existing, 1);
            } else {
                users.push(
                    currentUserId
                );
            }

            if (
                users.length === 0
            ) {
                delete message.reactions[
                    emoji
                ];
            }

            saveMessages(messages);

            for (
                const memberId of
                chat.members
            ) {
                emitToUser(
                    memberId,
                    "message_reaction",
                    {
                        message
                    }
                );
            }

            callback?.({
                success: true,
                message
            });
        }
    );

    /* -----------------------------------------------
       TYPING
    ------------------------------------------------ */

    socket.on(
        "typing",
        data => {

            if (!currentUserId) return;

            const chatId =
                clean(data?.chatId, 100);

            const chat =
                getChat(chatId);

            if (
                !chat ||
                !userInChat(
                    chat,
                    currentUserId
                )
            ) {
                return;
            }

            for (
                const memberId of
                chat.members
            ) {

                if (
                    memberId ===
                    currentUserId
                ) {
                    continue;
                }

                emitToUser(
                    memberId,
                    "typing",
                    {
                        chatId,
                        userId:
                            currentUserId,
                        typing:
                            Boolean(
                                data?.typing
                            )
                    }
                );
            }
        }
    );

    /* -----------------------------------------------
       BLOCK USER
    ------------------------------------------------ */

    socket.on(
        "block_user",
        (data, callback) => {

            if (!currentUserId) return;

            const targetId =
                clean(data?.userId, 100);

            if (
                !targetId ||
                targetId ===
                currentUserId
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Geçersiz kullanıcı."
                });
            }

            const users =
                loadUsers();

            const user =
                users.find(
                    x =>
                        x.id ===
                        currentUserId
                );

            const target =
                users.find(
                    x =>
                        x.id ===
                        targetId
                );

            if (!user || !target) {
                return callback?.({
                    success: false,
                    error:
                        "Kullanıcı bulunamadı."
                });
            }

            if (!Array.isArray(user.blocked)) {
                user.blocked = [];
            }

            const index =
                user.blocked.indexOf(
                    targetId
                );

            let blocked;

            if (index >= 0) {
                user.blocked.splice(
                    index,
                    1
                );

                blocked = false;
            } else {
                user.blocked.push(
                    targetId
                );

                blocked = true;
            }

            saveUsers(users);

            emitToUser(
                targetId,
                "user_block_changed",
                {
                    userId:
                        currentUserId,
                    blocked
                }
            );

            callback?.({
                success: true,
                blocked
            });
        }
    );

    /* =====================================================
       WEBRTC CALL SIGNALING
       Gerçek sesli/görüntülü arama için.
    ===================================================== */

    socket.on(
        "call_user",
        data => {

            if (!currentUserId) return;

            const targetId =
                clean(data?.targetId, 100);

            if (!targetId) return;

            if (
                areBlocked(
                    currentUserId,
                    targetId
                )
            ) {
                return;
            }

            emitToUser(
                targetId,
                "incoming_call",
                {
                    from:
                        currentUserId,
                    callType:
                        data?.callType ===
                        "video"
                            ? "video"
                            : "audio",
                    offer:
                        data?.offer || null
                }
            );
        }
    );

    socket.on(
        "call_accept",
        data => {

            if (!currentUserId) return;

            const targetId =
                clean(data?.targetId, 100);

            if (!targetId) return;

            emitToUser(
                targetId,
                "call_accepted",
                {
                    from:
                        currentUserId,
                    answer:
                        data?.answer || null
                }
            );
        }
    );

    socket.on(
        "call_reject",
        data => {

            if (!currentUserId) return;

            const targetId =
                clean(data?.targetId, 100);

            if (!targetId) return;

            emitToUser(
                targetId,
                "call_rejected",
                {
                    from:
                        currentUserId
                }
            );
        }
    );

    socket.on(
        "call_ice_candidate",
        data => {

            if (!currentUserId) return;

            const targetId =
                clean(data?.targetId, 100);

            if (!targetId) return;

            emitToUser(
                targetId,
                "call_ice_candidate",
                {
                    from:
                        currentUserId,
                    candidate:
                        data?.candidate || null
                }
            );
        }
    );

    socket.on(
        "call_end",
        data => {

            if (!currentUserId) return;

            const targetId =
                clean(data?.targetId, 100);

            if (!targetId) return;

            emitToUser(
                targetId,
                "call_ended",
                {
                    from:
                        currentUserId
                }
            );
        }
    );

    /* -----------------------------------------------
       DISCONNECT
    ------------------------------------------------ */

    socket.on("disconnect", () => {

        if (!currentUserId) return;

        removeSocket(
            currentUserId,
            socket.id
        );
    });
});

/* =========================================================
   CLEAN EXPIRED SESSIONS
========================================================= */

setInterval(() => {

    try {

        const sessions =
            loadSessions();

        const valid =
            sessions.filter(
                session =>
                    session.expiresAt >
                    Date.now()
            );

        if (
            valid.length !==
            sessions.length
        ) {
            saveSessions(valid);
        }

    } catch (error) {
        console.error(
            "Session cleanup error:",
            error.message
        );
    }

}, 60 * 60 * 1000);

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.use((req, res, next) => {

    if (
        req.method === "GET" &&
        !req.path.startsWith("/api/")
    ) {

        const indexPath =
            path.join(
                __dirname,
                "index.html"
            );

        if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
        }
    }

    next();
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {

    console.error(
        "SERVER ERROR:",
        error
    );

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        error:
            "Sunucu tarafında beklenmeyen bir hata oluştu."
    });
});

/* =========================================================
   START
========================================================= */

httpServer.listen(
    PORT,
    HOST,
    () => {

        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            "        MESAJX SERVER AKTİF"
        );
        console.log(
            "=========================================="
        );
        console.log(
            `Local:  http://localhost:${PORT}`
        );
        console.log(
            `Host:   ${HOST}:${PORT}`
        );
        console.log(
            "Socket.IO: AKTİF"
        );
        console.log(
            "Görüldü: AKTİF"
        );
        console.log(
            "Mesaj reaksiyonları: AKTİF"
        );
        console.log(
            "Kullanıcı arama: AKTİF"
        );
        console.log(
            "WebRTC sinyalleşme: AKTİF"
        );
        console.log(
            "Kalıcı oturum: AKTİF"
        );
        console.log(
            "=========================================="
        );
        console.log("");
    }
);

process.on("uncaughtException", error => {
    console.error(
        "UNCaught Exception:",
        error
    );
});

process.on("unhandledRejection", error => {
    console.error(
        "Unhandled Rejection:",
        error
    );
});
