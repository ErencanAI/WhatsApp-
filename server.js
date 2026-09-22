"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

/* =========================
   DOSYA SİSTEMİ
========================= */

function ensureFile(file, fallback = []) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(fallback, null, 2),
            "utf8"
        );
    }
}

ensureFile(USERS_FILE, []);
ensureFile(CHATS_FILE, []);
ensureFile(MESSAGES_FILE, []);

function readJSON(file, fallback = []) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

let users = readJSON(USERS_FILE, []);
let chats = readJSON(CHATS_FILE, []);
let messages = readJSON(MESSAGES_FILE, []);

/* =========================
   YARDIMCILAR
========================= */

function id(prefix = "") {
    return (
        prefix +
        crypto.randomBytes(10).toString("hex") +
        Date.now().toString(36)
    );
}

function hash(value) {
    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex");
}

function generateCode() {
    let code;

    do {
        const a = crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

        const b = crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

        code = `TRK-${a}${b}`;
    } while (users.some(u => u.code === code));

    return code;
}

function cleanUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        username: user.username,
        code: user.code,
        bio: user.bio || "",
        avatar: user.avatar || "",
        blockedUsers: user.blockedUsers || [],
        createdAt: user.createdAt
    };
}

function normalizeUsername(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

function getUserById(userId) {
    return users.find(u => u.id === userId);
}

function getUserByCode(code) {
    const normalized = String(code || "")
        .trim()
        .toUpperCase();

    return users.find(u => u.code === normalized);
}

function getUserByIdentifier(identifier) {
    const value = String(identifier || "").trim();

    const codeUser = getUserByCode(value);
    if (codeUser) return codeUser;

    const username = normalizeUsername(value);

    return users.find(
        u => normalizeUsername(u.username) === username
    );
}

function saveUsers() {
    writeJSON(USERS_FILE, users);
}

function saveChats() {
    writeJSON(CHATS_FILE, chats);
}

function saveMessages() {
    writeJSON(MESSAGES_FILE, messages);
}

function getTokenFromRequest(req) {
    const header = req.headers.authorization || "";

    if (header.startsWith("Bearer ")) {
        return header.slice(7);
    }

    return req.headers["x-session-token"] || null;
}

/* =========================
   OTURUM
========================= */

const sessions = new Map();

function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
        userId,
        createdAt: Date.now()
    });

    return token;
}

function getUserFromToken(token) {
    if (!token) return null;

    const session = sessions.get(token);
    if (!session) return null;

    return getUserById(session.userId);
}

function requireAuth(req, res, next) {
    const token = getTokenFromRequest(req);
    const user = getUserFromToken(token);

    if (!user) {
        return res.status(401).json({
            success: false,
            error: "Oturum geçersiz."
        });
    }

    req.user = user;
    req.token = token;

    next();
}

/* =========================
   HEALTH
========================= */

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "ok",
        server: "MesajX",
        time: new Date().toISOString()
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        users: users.length,
        chats: chats.length,
        messages: messages.length,
        uptime: process.uptime()
    });
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", (req, res) => {
    try {
        const {
            name,
            username,
            pin
        } = req.body || {};

        if (!name || !username || !pin) {
            return res.status(400).json({
                success: false,
                error: "Ad, kullanıcı adı ve PIN gerekli."
            });
        }

        const cleanName = String(name).trim();
        const cleanUsername = normalizeUsername(username);
        const cleanPin = String(pin).trim();

        if (cleanName.length < 2) {
            return res.status(400).json({
                success: false,
                error: "Ad en az 2 karakter olmalı."
            });
        }

        if (!/^[a-z0-9_.-]{3,24}$/i.test(cleanUsername)) {
            return res.status(400).json({
                success: false,
                error:
                    "Kullanıcı adı 3-24 karakter olmalı ve sadece harf, sayı, _, . veya - içermeli."
            });
        }

        if (!/^\d{4,8}$/.test(cleanPin)) {
            return res.status(400).json({
                success: false,
                error: "PIN 4-8 rakam olmalı."
            });
        }

        if (
            users.some(
                u =>
                    normalizeUsername(u.username) ===
                    cleanUsername
            )
        ) {
            return res.status(409).json({
                success: false,
                error: "Bu kullanıcı adı zaten kullanılıyor."
            });
        }

        const user = {
            id: id("usr_"),
            name: cleanName,
            username: cleanUsername,
            code: generateCode(),
            pinHash: hash(cleanPin),
            bio: "",
            avatar: "",
            blockedUsers: [],
            createdAt: Date.now()
        };

        users.push(user);
        saveUsers();

        const token = createSession(user.id);

        res.json({
            success: true,
            token,
            sessionToken: token,
            user: cleanUser(user),
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

/* =========================
   LOGIN
========================= */

app.post("/api/login", (req, res) => {
    try {
        const {
            identifier,
            pin
        } = req.body || {};

        const user = getUserByIdentifier(identifier);

        if (!user || hash(String(pin || "")) !== user.pinHash) {
            return res.status(401).json({
                success: false,
                error: "Kullanıcı veya PIN yanlış."
            });
        }

        const token = createSession(user.id);

        res.json({
            success: true,
            token,
            sessionToken: token,
            user: cleanUser(user),
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

/* =========================
   ME
========================= */

app.get("/api/me", requireAuth, (req, res) => {
    res.json({
        success: true,
        user: cleanUser(req.user)
    });
});

/* =========================
   LOGOUT
========================= */

app.post("/api/logout", requireAuth, (req, res) => {
    sessions.delete(req.token);

    res.json({
        success: true
    });
});

/* =========================
   USER SEARCH
========================= */

app.get("/api/users/search", requireAuth, (req, res) => {
    const q = String(req.query.q || "")
        .trim()
        .toLowerCase();

    if (!q) {
        return res.json({
            success: true,
            users: []
        });
    }

    const found = users
        .filter(u => u.id !== req.user.id)
        .filter(u => {
            return (
                u.code.toLowerCase().includes(q) ||
                u.username.toLowerCase().includes(q) ||
                u.name.toLowerCase().includes(q)
            );
        })
        .slice(0, 20)
        .map(cleanUser);

    res.json({
        success: true,
        users: found
    });
});

/* =========================
   PROFILE
========================= */

app.patch("/api/profile", requireAuth, (req, res) => {
    const {
        name,
        bio,
        avatar
    } = req.body || {};

    if (typeof name === "string" && name.trim()) {
        req.user.name = name.trim().slice(0, 50);
    }

    if (typeof bio === "string") {
        req.user.bio = bio.trim().slice(0, 180);
    }

    if (typeof avatar === "string") {
        req.user.avatar = avatar.trim().slice(0, 500);
    }

    saveUsers();

    res.json({
        success: true,
        user: cleanUser(req.user)
    });
});

/* =========================
   SOCKET AUTH
========================= */

io.on("connection", socket => {
    console.log("Socket bağlandı:", socket.id);

    socket.userId = null;

    socket.on("authenticate", (data, callback) => {
        try {
            const token = data?.token;
            const user = getUserFromToken(token);

            if (!user) {
                return callback?.({
                    success: false,
                    error: "Oturum geçersiz."
                });
            }

            socket.userId = user.id;
            socket.token = token;

            socket.join(`user:${user.id}`);

            callback?.({
                success: true,
                user: cleanUser(user)
            });
        } catch {
            callback?.({
                success: false,
                error: "Kimlik doğrulama başarısız."
            });
        }
    });

    function currentUser() {
        return socket.userId
            ? getUserById(socket.userId)
            : null;
    }

    function authenticated(callback) {
        const user = currentUser();

        if (!user) {
            callback?.({
                success: false,
                error: "Önce giriş yapmalısın."
            });

            return null;
        }

        return user;
    }

    /* =========================
       CHAT LIST
    ========================= */

    socket.on("get_chats", callback => {
        const user = authenticated(callback);
        if (!user) return;

        const result = chats
            .filter(chat =>
                chat.memberIds.includes(user.id)
            )
            .map(chat => {
                const chatMessages = messages
                    .filter(m => m.chatId === chat.id)
                    .sort((a, b) => a.createdAt - b.createdAt);

                const last =
                    chatMessages[chatMessages.length - 1] ||
                    null;

                let title = chat.name || "Sohbet";
                let otherUser = null;

                if (chat.type === "private") {
                    const otherId =
                        chat.memberIds.find(
                            id => id !== user.id
                        );

                    otherUser = getUserById(otherId);

                    if (otherUser) {
                        title = otherUser.name;
                    }
                }

                return {
                    id: chat.id,
                    type: chat.type,
                    name: title,
                    otherUser: otherUser
                        ? cleanUser(otherUser)
                        : null,
                    memberIds: chat.memberIds,
                    lastMessage: last
                        ? {
                              id: last.id,
                              text: last.text,
                              senderId: last.senderId,
                              createdAt: last.createdAt
                          }
                        : null,
                    createdAt: chat.createdAt
                };
            })
            .sort((a, b) => {
                const at =
                    a.lastMessage?.createdAt ||
                    a.createdAt ||
                    0;

                const bt =
                    b.lastMessage?.createdAt ||
                    b.createdAt ||
                    0;

                return bt - at;
            });

        callback?.({
            success: true,
            chats: result
        });
    });

    /* =========================
       SEARCH USERS
    ========================= */

    socket.on("search_users", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const q = String(data?.q || "")
            .trim()
            .toLowerCase();

        const result = users
            .filter(u => u.id !== user.id)
            .filter(u => {
                return (
                    u.code.toLowerCase().includes(q) ||
                    u.username.toLowerCase().includes(q) ||
                    u.name.toLowerCase().includes(q)
                );
            })
            .slice(0, 20)
            .map(cleanUser);

        callback?.({
            success: true,
            users: result
        });
    });

    /* =========================
       CREATE CHAT
    ========================= */

    socket.on("create_chat", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const type = data?.type || "private";

        if (type === "private") {
            const target = getUserById(data?.userId);

            if (!target) {
                return callback?.({
                    success: false,
                    error: "Kullanıcı bulunamadı."
                });
            }

            if (target.id === user.id) {
                return callback?.({
                    success: false,
                    error: "Kendinle sohbet oluşturamazsın."
                });
            }

            if (
                (user.blockedUsers || []).includes(target.id) ||
                (target.blockedUsers || []).includes(user.id)
            ) {
                return callback?.({
                    success: false,
                    error: "Bu kullanıcıyla sohbet oluşturulamıyor."
                });
            }

            let chat = chats.find(c =>
                c.type === "private" &&
                c.memberIds.length === 2 &&
                c.memberIds.includes(user.id) &&
                c.memberIds.includes(target.id)
            );

            if (!chat) {
                chat = {
                    id: id("chat_"),
                    type: "private",
                    memberIds: [
                        user.id,
                        target.id
                    ],
                    name: "",
                    createdAt: Date.now()
                };

                chats.push(chat);
                saveChats();

                const payload = {
                    success: true,
                    chat: {
                        id: chat.id,
                        type: chat.type,
                        name: target.name,
                        otherUser: cleanUser(target),
                        memberIds: chat.memberIds
                    }
                };

                io.to(`user:${user.id}`)
                    .emit("chat_created", payload.chat);

                io.to(`user:${target.id}`)
                    .emit("chat_created", {
                        id: chat.id,
                        type: chat.type,
                        name: user.name,
                        otherUser: cleanUser(user),
                        memberIds: chat.memberIds
                    });
            }

            return callback?.({
                success: true,
                chat: {
                    id: chat.id,
                    type: chat.type,
                    name:
                        chat.name ||
                        target.name,
                    otherUser:
                        cleanUser(target),
                    memberIds:
                        chat.memberIds
                }
            });
        }

        if (type === "group") {
            const memberIds = Array.isArray(
                data?.memberIds
            )
                ? [...new Set(data.memberIds)]
                : [];

            if (!memberIds.includes(user.id)) {
                memberIds.push(user.id);
            }

            const validMembers = memberIds.filter(
                memberId => !!getUserById(memberId)
            );

            if (validMembers.length < 2) {
                return callback?.({
                    success: false,
                    error: "Grup için en az 2 kişi gerekli."
                });
            }

            const chat = {
                id: id("chat_"),
                type: "group",
                memberIds: validMembers,
                name:
                    String(data?.name || "Yeni Grup")
                        .trim()
                        .slice(0, 60) ||
                    "Yeni Grup",
                createdAt: Date.now()
            };

            chats.push(chat);
            saveChats();

            callback?.({
                success: true,
                chat
            });

            for (const memberId of validMembers) {
                io.to(`user:${memberId}`)
                    .emit("chat_created", chat);
            }
        }
    });

    /* =========================
       GET MESSAGES
    ========================= */

    socket.on("get_messages", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const chat = chats.find(
            c => c.id === data?.chatId
        );

        if (!chat) {
            return callback?.({
                success: false,
                error: "Sohbet bulunamadı."
            });
        }

        if (!chat.memberIds.includes(user.id)) {
            return callback?.({
                success: false,
                error: "Bu sohbete erişimin yok."
            });
        }

        const result = messages
            .filter(m => m.chatId === chat.id)
            .sort(
                (a, b) =>
                    a.createdAt - b.createdAt
            );

        callback?.({
            success: true,
            messages: result
        });
    });

    /* =========================
       SEND MESSAGE
    ========================= */

    socket.on("send_message", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const chat = chats.find(
            c => c.id === data?.chatId
        );

        if (!chat) {
            return callback?.({
                success: false,
                error: "Sohbet bulunamadı."
            });
        }

        if (!chat.memberIds.includes(user.id)) {
            return callback?.({
                success: false,
                error: "Bu sohbete erişimin yok."
            });
        }

        const text = String(data?.text || "")
            .trim()
            .slice(0, 5000);

        if (!text) {
            return callback?.({
                success: false,
                error: "Boş mesaj gönderilemez."
            });
        }

        if (chat.type === "private") {
            const otherId = chat.memberIds.find(
                x => x !== user.id
            );

            const other = getUserById(otherId);

            if (
                other &&
                (
                    (user.blockedUsers || [])
                        .includes(other.id) ||
                    (other.blockedUsers || [])
                        .includes(user.id)
                )
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu kullanıcıyla mesajlaşamazsın."
                });
            }
        }

        const message = {
            id: id("msg_"),
            chatId: chat.id,
            senderId: user.id,
            senderName: user.name,
            text,
            reactions: {},
            edited: false,
            deleted: false,
            createdAt: Date.now()
        };

        messages.push(message);
        saveMessages();

        for (const memberId of chat.memberIds) {
            io.to(`user:${memberId}`)
                .emit("new_message", message);
        }

        callback?.({
            success: true,
            message
        });
    });

    /* =========================
       EDIT
    ========================= */

    socket.on("edit_message", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const message = messages.find(
            m => m.id === data?.messageId
        );

        if (!message) {
            return callback?.({
                success: false,
                error: "Mesaj bulunamadı."
            });
        }

        if (message.senderId !== user.id) {
            return callback?.({
                success: false,
                error: "Bu mesajı düzenleyemezsin."
            });
        }

        const text = String(data?.text || "")
            .trim()
            .slice(0, 5000);

        if (!text) {
            return callback?.({
                success: false,
                error: "Mesaj boş olamaz."
            });
        }

        message.text = text;
        message.edited = true;
        message.editedAt = Date.now();

        saveMessages();

        const chat = chats.find(
            c => c.id === message.chatId
        );

        if (chat) {
            for (const memberId of chat.memberIds) {
                io.to(`user:${memberId}`)
                    .emit(
                        "message_edited",
                        message
                    );
            }
        }

        callback?.({
            success: true,
            message
        });
    });

    /* =========================
       DELETE
    ========================= */

    socket.on("delete_message", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const message = messages.find(
            m => m.id === data?.messageId
        );

        if (!message) {
            return callback?.({
                success: false,
                error: "Mesaj bulunamadı."
            });
        }

        if (message.senderId !== user.id) {
            return callback?.({
                success: false,
                error: "Bu mesajı silemezsin."
            });
        }

        message.deleted = true;
        message.text = "";
        message.deletedAt = Date.now();

        saveMessages();

        const chat = chats.find(
            c => c.id === message.chatId
        );

        if (chat) {
            for (const memberId of chat.memberIds) {
                io.to(`user:${memberId}`)
                    .emit(
                        "message_deleted",
                        message
                    );
            }
        }

        callback?.({
            success: true,
            message
        });
    });

    /* =========================
       REACTION
    ========================= */

    socket.on("react_message", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        const message = messages.find(
            m => m.id === data?.messageId
        );

        if (!message) {
            return callback?.({
                success: false,
                error: "Mesaj bulunamadı."
            });
        }

        const emoji = String(
            data?.emoji || "❤️"
        ).slice(0, 10);

        if (!message.reactions) {
            message.reactions = {};
        }

        if (!Array.isArray(message.reactions[emoji])) {
            message.reactions[emoji] = [];
        }

        const list = message.reactions[emoji];

        const index = list.indexOf(user.id);

        if (index >= 0) {
            list.splice(index, 1);
        } else {
            list.push(user.id);
        }

        saveMessages();

        const chat = chats.find(
            c => c.id === message.chatId
        );

        if (chat) {
            for (const memberId of chat.memberIds) {
                io.to(`user:${memberId}`)
                    .emit(
                        "message_reaction",
                        message
                    );
            }
        }

        callback?.({
            success: true,
            message
        });
    });

    /* =========================
       TYPING
    ========================= */

    socket.on("typing", data => {
        const user = currentUser();
        if (!user) return;

        const chat = chats.find(
            c => c.id === data?.chatId
        );

        if (!chat || !chat.memberIds.includes(user.id)) {
            return;
        }

        for (const memberId of chat.memberIds) {
            if (memberId === user.id) continue;

            io.to(`user:${memberId}`)
                .emit("typing", {
                    chatId: chat.id,
                    userId: user.id,
                    name: user.name,
                    typing: !!data?.typing
                });
        }
    });

    /* =========================
       BLOCK / UNBLOCK
    ========================= */

    socket.on("block_user", (data, callback) => {
        const user = authenticated(callback);
        if (!user) return;

        let target = null;

        if (data?.userId) {
            target = getUserById(data.userId);
        }

        if (!target && data?.code) {
            target = getUserByCode(data.code);
        }

        if (!target && data?.userCode) {
            target = getUserByCode(data.userCode);
        }

        if (!target && data?.username) {
            target = getUserByIdentifier(
                data.username
            );
        }

        if (!target) {
            return callback?.({
                success: false,
                error: "Kullanıcı bulunamadı."
            });
        }

        if (target.id === user.id) {
            return callback?.({
                success: false,
                error: "Kendini engelleyemezsin."
            });
        }

        if (!Array.isArray(user.blockedUsers)) {
            user.blockedUsers = [];
        }

        const blocked = data?.blocked !== false;

        if (blocked) {
            if (!user.blockedUsers.includes(target.id)) {
                user.blockedUsers.push(target.id);
            }
        } else {
            user.blockedUsers =
                user.blockedUsers.filter(
                    x => x !== target.id
                );
        }

        saveUsers();

        callback?.({
            success: true,
            blocked,
            user: cleanUser(target)
        });
    });

    socket.on("disconnect", () => {
        console.log("Socket ayrıldı:", socket.id);
    });
});

/* =========================
   STATIC DOSYALAR
========================= */

app.use(
    express.static(ROOT, {
        index: false,
        dotfiles: "ignore"
    })
);

/*
   data klasörünü kesinlikle dışarı açma.
*/
app.use("/data", (req, res) => {
    res.status(403).json({
        success: false,
        error: "Forbidden"
    });
});

/*
   Express 5 uyumlu SPA fallback.
   app.get("*") KULLANMIYORUZ.
*/
app.use((req, res, next) => {
    if (
        req.method !== "GET" ||
        req.path.startsWith("/api/")
    ) {
        return next();
    }

    const indexPath = path.join(ROOT, "index.html");

    if (!fs.existsSync(indexPath)) {
        return res.status(404).send(
            "index.html bulunamadı."
        );
    }

    res.sendFile(indexPath);
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
    console.error("SERVER ERROR:", err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        success: false,
        error: "Sunucu hatası."
    });
});

/* =========================
   START
========================= */

server.listen(PORT, HOST, () => {
    console.log("");
    console.log("====================================");
    console.log("        MESAJX SERVER AKTİF");
    console.log("====================================");
    console.log(`Port: ${PORT}`);
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
    console.log(`Users: ${users.length}`);
    console.log(`Chats: ${chats.length}`);
    console.log(`Messages: ${messages.length}`);
    console.log("====================================");
    console.log("");
});
