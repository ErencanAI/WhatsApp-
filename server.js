const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = Number(process.env.PORT) || 10000;
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");

if (!fs.existsSync(DATA)) {
    fs.mkdirSync(DATA, { recursive: true });
}

const FILES = {
    users: path.join(DATA, "users.json"),
    chats: path.join(DATA, "chats.json"),
    messages: path.join(DATA, "messages.json"),
    sessions: path.join(DATA, "sessions.json")
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

ensure(FILES.users, []);
ensure(FILES.chats, []);
ensure(FILES.messages, []);
ensure(FILES.sessions, {});

function read(file, fallback) {
    try {
        const text = fs.readFileSync(file, "utf8");

        if (!text.trim()) return fallback;

        const data = JSON.parse(text);
        return data;
    } catch {
        return fallback;
    }
}

function save(file, data) {
    const temp = file + ".tmp";

    fs.writeFileSync(
        temp,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(temp, file);
}

let users = read(FILES.users, []);
let chats = read(FILES.chats, []);
let messages = read(FILES.messages, []);
let sessions = read(FILES.sessions, {});

if (!Array.isArray(users)) users = [];
if (!Array.isArray(chats)) chats = [];
if (!Array.isArray(messages)) messages = [];
if (!sessions || typeof sessions !== "object") sessions = {};

function id(prefix) {
    return (
        prefix +
        Date.now().toString(36) +
        crypto.randomBytes(5).toString("hex")
    );
}

function text(value, max = 10000) {
    return String(value ?? "")
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, max);
}

function hash(value) {
    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex");
}

function token() {
    return crypto.randomBytes(32).toString("hex");
}

function normalizeUsername(value) {
    return text(value, 40)
        .toLowerCase()
        .replace(/\s+/g, "");
}

function normalizeCode(value) {
    return text(value, 30)
        .toUpperCase()
        .replace(/\s+/g, "");
}

function createCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        let value = "";

        for (let i = 0; i < 6; i++) {
            value += chars[
                crypto.randomInt(0, chars.length)
            ];
        }

        code = "TRK-" + value;
    } while (
        users.some(
            u =>
                normalizeCode(u.code) ===
                normalizeCode(code)
        )
    );

    return code;
}

/* =========================
   USERS
========================= */

function userById(value) {
    return users.find(
        u => String(u.id) === String(value)
    );
}

function userByUsername(value) {
    const q = normalizeUsername(value);

    return users.find(
        u =>
            normalizeUsername(u.username) === q
    );
}

function userByCode(value) {
    const q = normalizeCode(value);

    return users.find(
        u =>
            normalizeCode(u.code) === q
    );
}

function findUser(value) {
    if (!value) return null;

    return (
        userById(value) ||
        userByCode(value) ||
        userByUsername(value)
    );
}

function publicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        username: user.username,
        code: user.code,
        bio: user.bio || "",
        avatar: user.avatar || "",
        online: !!user.online,
        lastSeen: user.lastSeen || null
    };
}

/* Eski kayıtları düzelt */
for (const user of users) {
    user.id ||= id("usr_");
    user.name ||= "Kullanıcı";
    user.displayName ||= user.name;
    user.username ||= "user_" + crypto.randomBytes(3).toString("hex");
    user.code ||= createCode();
    user.bio ||= "";
    user.avatar ||= "";
    user.blockedUsers ||= [];
    user.online = false;
    user.lastSeen ||= Date.now();
}

save(FILES.users, users);

/* =========================
   SESSIONS
========================= */

function createSession(userId) {
    const t = token();

    sessions[t] = {
        userId,
        createdAt: Date.now()
    };

    save(FILES.sessions, sessions);

    return t;
}

function getUserFromToken(t) {
    if (!t) return null;

    const session = sessions[t];

    if (!session) return null;

    return userById(session.userId);
}

function deleteSession(t) {
    if (!t) return;

    delete sessions[t];
    save(FILES.sessions, sessions);
}

/* =========================
   CHAT
========================= */

function chatById(chatId) {
    return chats.find(
        c => String(c.id) === String(chatId)
    );
}

function isMember(chat, userId) {
    return !!(
        chat &&
        Array.isArray(chat.members) &&
        chat.members.includes(userId)
    );
}

function blocked(a, b) {
    if (!a || !b) return false;

    return (
        (a.blockedUsers || []).includes(b.id) ||
        (b.blockedUsers || []).includes(a.id)
    );
}

function privateChat(a, b) {
    return chats.find(c => {
        return (
            c.type === "private" &&
            c.members.length === 2 &&
            c.members.includes(a.id) &&
            c.members.includes(b.id)
        );
    });
}

function lastMessage(chatId) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (
            String(messages[i].chatId) ===
            String(chatId)
        ) {
            return messages[i];
        }
    }

    return null;
}

function chatForUser(chat, userId) {
    const members = chat.members
        .map(userById)
        .filter(Boolean)
        .map(publicUser);

    let name = chat.name;

    if (chat.type === "private") {
        const other = members.find(
            u => u.id !== userId
        );

        if (other) {
            name =
                other.displayName ||
                other.username;
        }
    }

    return {
        id: chat.id,
        type: chat.type,
        name: name || "Sohbet",
        members,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        lastMessage: lastMessage(chat.id)
    };
}

/* =========================
   EXPRESS
========================= */

app.disable("x-powered-by");

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "2mb"
    })
);

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "online",
        service: "MesajX",
        time: new Date().toISOString(),
        users: users.length,
        chats: chats.length,
        messages: messages.length
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", (req, res) => {
    try {
        const name = text(
            req.body.displayName ||
            req.body.name ||
            req.body.fullName,
            60
        );

        const username = normalizeUsername(
            req.body.username ||
            req.body.userName ||
            req.body.identifier
        );

        const pin = text(
            req.body.pin ||
            req.body.password ||
            req.body.passcode,
            100
        );

        if (!name) {
            return res.status(400).json({
                success: false,
                error: "Ad gerekli."
            });
        }

        if (!/^[a-z0-9_.-]{3,30}$/i.test(username)) {
            return res.status(400).json({
                success: false,
                error: "Geçerli bir kullanıcı adı gir."
            });
        }

        if (pin.length < 4) {
            return res.status(400).json({
                success: false,
                error: "PIN en az 4 karakter olmalı."
            });
        }

        if (userByUsername(username)) {
            return res.status(409).json({
                success: false,
                error: "Bu kullanıcı adı kullanılıyor."
            });
        }

        const user = {
            id: id("usr_"),
            name,
            displayName: name,
            username,
            code: createCode(),
            bio: "",
            avatar: "",
            pinHash: hash(pin),
            blockedUsers: [],
            online: false,
            lastSeen: Date.now(),
            createdAt: Date.now()
        };

        users.push(user);
        save(FILES.users, users);

        const session = createSession(user.id);

        user.online = true;
        save(FILES.users, users);

        res.status(201).json({
            success: true,
            token: session,
            sessionToken: session,
            user: publicUser(user),
            code: user.code
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "Kayıt sırasında hata oluştu."
        });
    }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", (req, res) => {
    try {
        const identifier = text(
            req.body.username ||
            req.body.identifier ||
            req.body.code ||
            req.body.userCode ||
            req.body.login
        );

        const pin = text(
            req.body.pin ||
            req.body.password ||
            req.body.passcode
        );

        const user = findUser(identifier);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: "Kullanıcı bulunamadı."
            });
        }

        if (user.pinHash !== hash(pin)) {
            return res.status(401).json({
                success: false,
                error: "PIN hatalı."
            });
        }

        const session = createSession(user.id);

        user.online = true;
        user.lastSeen = Date.now();

        save(FILES.users, users);

        res.json({
            success: true,
            token: session,
            sessionToken: session,
            user: publicUser(user),
            code: user.code
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "Giriş sırasında hata oluştu."
        });
    }
});

/* =========================
   ME
========================= */

app.get("/api/me", (req, res) => {
    const auth =
        req.headers.authorization || "";

    const tokenValue =
        auth.replace(/^Bearer\s+/i, "") ||
        req.headers["x-session-token"];

    const user = getUserFromToken(tokenValue);

    if (!user) {
        return res.status(401).json({
            success: false,
            error: "Oturum geçersiz."
        });
    }

    res.json({
        success: true,
        user: publicUser(user)
    });
});

/* =========================
   LOGOUT
========================= */

app.post("/api/logout", (req, res) => {
    const auth =
        req.headers.authorization || "";

    const t =
        auth.replace(/^Bearer\s+/i, "") ||
        req.headers["x-session-token"];

    const user = getUserFromToken(t);

    if (user) {
        user.online = false;
        user.lastSeen = Date.now();
        save(FILES.users, users);
    }

    deleteSession(t);

    res.json({
        success: true
    });
});

/* =========================
   HTTP SEARCH
========================= */

app.get("/api/users/search", (req, res) => {
    const q = text(
        req.query.q ||
        req.query.query ||
        req.query.code,
        80
    ).toLowerCase();

    const result = users
        .filter(u => {
            return (
                u.username.toLowerCase().includes(q) ||
                u.displayName.toLowerCase().includes(q) ||
                u.code.toLowerCase().includes(q)
            );
        })
        .slice(0, 30)
        .map(publicUser);

    res.json({
        success: true,
        users: result
    });
});

/* =========================
   SOCKET
========================= */

const socketsByUser = new Map();

function addSocket(userId, socketId) {
    if (!socketsByUser.has(userId)) {
        socketsByUser.set(
            userId,
            new Set()
        );
    }

    socketsByUser
        .get(userId)
        .add(socketId);
}

function removeSocket(userId, socketId) {
    const set = socketsByUser.get(userId);

    if (!set) return;

    set.delete(socketId);

    if (set.size === 0) {
        socketsByUser.delete(userId);
    }
}

function emitUser(userId, event, data) {
    const set = socketsByUser.get(userId);

    if (!set) return;

    for (const socketId of set) {
        io.to(socketId).emit(event, data);
    }
}

function emitChat(chat, event, data) {
    if (!chat) return;

    for (const member of chat.members) {
        emitUser(member, event, data);
    }
}

io.on("connection", socket => {
    console.log("Socket:", socket.id);

    /* ---------- AUTH ---------- */

    socket.on("authenticate", (payload, callback) => {
        const session =
            typeof payload === "string"
                ? payload
                : payload?.token ||
                  payload?.sessionToken ||
                  payload?.authToken;

        const user =
            getUserFromToken(session);

        if (!user) {
            const result = {
                success: false,
                error: "Oturum geçersiz."
            };

            socket.emit("auth_error", result);
            callback?.(result);

            return;
        }

        socket.user = user;
        socket.userId = user.id;
        socket.authenticated = true;

        addSocket(user.id, socket.id);

        user.online = true;
        user.lastSeen = Date.now();

        save(FILES.users, users);

        const result = {
            success: true,
            user: publicUser(user)
        };

        socket.emit("auth_ok", result);
        socket.emit("authenticated", result);
        socket.emit("auth_success", result);

        callback?.(result);
    });

    function requireAuth(callback) {
        if (socket.authenticated) {
            return true;
        }

        callback?.({
            success: false,
            error: "Giriş yapmalısın."
        });

        return false;
    }

    /* ---------- CHATS ---------- */

    socket.on("get_chats", callback => {
        if (!requireAuth(callback)) return;

        const result = chats
            .filter(c =>
                isMember(c, socket.userId)
            )
            .sort(
                (a, b) =>
                    b.updatedAt - a.updatedAt
            )
            .map(c =>
                chatForUser(
                    c,
                    socket.userId
                )
            );

        callback?.({
            success: true,
            chats: result
        });
    });

    /* ---------- SEARCH ---------- */

    socket.on(
        "search_users",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const q = text(
                typeof payload === "string"
                    ? payload
                    : payload?.q ||
                      payload?.query ||
                      payload?.code ||
                      payload?.username,
                80
            ).toLowerCase();

            const result = users
                .filter(u => {
                    if (u.id === socket.userId) {
                        return false;
                    }

                    return (
                        u.username
                            .toLowerCase()
                            .includes(q) ||
                        u.displayName
                            .toLowerCase()
                            .includes(q) ||
                        u.code
                            .toLowerCase()
                            .includes(q)
                    );
                })
                .slice(0, 30)
                .map(publicUser);

            callback?.({
                success: true,
                users: result
            });
        }
    );

    /* ---------- CREATE CHAT ---------- */

    socket.on(
        "create_chat",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            payload ||= {};

            const type =
                payload.type === "group"
                    ? "group"
                    : "private";

            let members = [];

            if (Array.isArray(payload.memberIds)) {
                members.push(
                    ...payload.memberIds
                );
            }

            if (Array.isArray(payload.memberCodes)) {
                for (const code of payload.memberCodes) {
                    const u = userByCode(code);

                    if (u) members.push(u.id);
                }
            }

            if (Array.isArray(payload.members)) {
                for (const item of payload.members) {
                    const u = findUser(
                        item?.id ||
                        item?.code ||
                        item?.username ||
                        item
                    );

                    if (u) members.push(u.id);
                }
            }

            members.push(socket.userId);

            members = [
                ...new Set(
                    members.map(String)
                )
            ];

            if (type === "private") {
                if (members.length !== 2) {
                    return callback?.({
                        success: false,
                        error:
                            "Özel sohbet için bir kişi seç."
                    });
                }

                const other = userById(
                    members.find(
                        x =>
                            x !==
                            socket.userId
                    )
                );

                if (!other) {
                    return callback?.({
                        success: false,
                        error:
                            "Kullanıcı bulunamadı."
                    });
                }

                if (
                    blocked(
                        socket.user,
                        other
                    )
                ) {
                    return callback?.({
                        success: false,
                        error:
                            "Bu kullanıcı engellenmiş."
                    });
                }

                const existing =
                    privateChat(
                        socket.user,
                        other
                    );

                if (existing) {
                    return callback?.({
                        success: true,
                        chat:
                            chatForUser(
                                existing,
                                socket.userId
                            )
                    });
                }
            }

            if (
                type === "group" &&
                members.length < 2
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Grup için en az iki kişi gerekli."
                });
            }

            const chat = {
                id: id("chat_"),
                type,
                name:
                    text(
                        payload.name ||
                        payload.title
                    ) ||
                    (
                        type === "group"
                            ? "Yeni Grup"
                            : "Sohbet"
                    ),
                members,
                createdBy: socket.userId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            chats.push(chat);
            save(FILES.chats, chats);

            const result = {
                success: true,
                chat: chatForUser(
                    chat,
                    socket.userId
                )
            };

            emitChat(
                chat,
                "chat_created",
                result
            );

            emitChat(
                chat,
                "new_chat",
                result
            );

            callback?.(result);
        }
    );

    /* ---------- MESSAGES ---------- */

    socket.on(
        "get_messages",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const chatId =
                typeof payload === "string"
                    ? payload
                    : payload?.chatId ||
                      payload?.conversationId ||
                      payload?.conversation;

            const chat = chatById(chatId);

            if (
                !chat ||
                !isMember(
                    chat,
                    socket.userId
                )
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Sohbete erişilemiyor."
                });
            }

            const list = messages
                .filter(
                    m =>
                        String(m.chatId) ===
                        String(chat.id)
                )
                .slice(-300);

            callback?.({
                success: true,
                messages: list
            });
        }
    );

    /* ---------- SEND ---------- */

    socket.on(
        "send_message",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            payload ||= {};

            const chatId =
                payload.chatId ||
                payload.conversationId ||
                payload.conversation;

            const chat = chatById(chatId);

            if (
                !chat ||
                !isMember(
                    chat,
                    socket.userId
                )
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu sohbete mesaj gönderemezsin."
                });
            }

            const messageText = text(
                payload.text ??
                payload.message ??
                payload.content,
                10000
            );

            if (
                !messageText &&
                !payload.attachment
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj boş olamaz."
                });
            }

            if (chat.type === "private") {
                const otherId =
                    chat.members.find(
                        id =>
                            id !==
                            socket.userId
                    );

                const other =
                    userById(otherId);

                if (
                    other &&
                    blocked(
                        socket.user,
                        other
                    )
                ) {
                    return callback?.({
                        success: false,
                        error:
                            "Bu kullanıcıyla iletişim kurulamıyor."
                    });
                }
            }

            const message = {
                id: id("msg_"),
                chatId: chat.id,
                senderId: socket.userId,
                sender: publicUser(socket.user),
                text: messageText,
                content: messageText,
                attachment:
                    payload.attachment ||
                    null,
                replyTo:
                    payload.replyTo ||
                    null,
                createdAt: Date.now(),
                edited: false,
                reactions: {}
            };

            messages.push(message);

            chat.updatedAt =
                message.createdAt;

            save(FILES.messages, messages);
            save(FILES.chats, chats);

            const result = {
                success: true,
                message
            };

            emitChat(
                chat,
                "new_message",
                result
            );

            /* Eski frontend uyumluluğu */
            emitChat(
                chat,
                "message",
                result
            );

            callback?.(result);
        }
    );

    /* ---------- EDIT ---------- */

    socket.on(
        "edit_message",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const message =
                messages.find(
                    m =>
                        m.id ===
                        payload?.messageId
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
                socket.userId
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu mesaj sana ait değil."
                });
            }

            const newText = text(
                payload.text ??
                payload.message ??
                payload.content
            );

            if (!newText) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj boş olamaz."
                });
            }

            message.text = newText;
            message.content = newText;
            message.edited = true;
            message.updatedAt = Date.now();

            save(FILES.messages, messages);

            const chat =
                chatById(message.chatId);

            const result = {
                success: true,
                message
            };

            emitChat(
                chat,
                "message_edited",
                result
            );

            emitChat(
                chat,
                "message_updated",
                result
            );

            callback?.(result);
        }
    );

    /* ---------- DELETE ---------- */

    socket.on(
        "delete_message",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const index =
                messages.findIndex(
                    m =>
                        m.id ===
                        payload?.messageId
                );

            if (index === -1) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj bulunamadı."
                });
            }

            const message =
                messages[index];

            if (
                message.senderId !==
                socket.userId
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Bu mesaj sana ait değil."
                });
            }

            messages.splice(index, 1);
            save(FILES.messages, messages);

            const chat =
                chatById(message.chatId);

            const result = {
                success: true,
                messageId: message.id,
                chatId: message.chatId
            };

            emitChat(
                chat,
                "message_deleted",
                result
            );

            emitChat(
                chat,
                "message_removed",
                result
            );

            callback?.(result);
        }
    );

    /* ---------- REACTION ---------- */

    socket.on(
        "react_message",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const message =
                messages.find(
                    m =>
                        m.id ===
                        payload?.messageId
                );

            if (!message) {
                return callback?.({
                    success: false,
                    error:
                        "Mesaj bulunamadı."
                });
            }

            const chat =
                chatById(message.chatId);

            if (
                !chat ||
                !isMember(
                    chat,
                    socket.userId
                )
            ) {
                return callback?.({
                    success: false,
                    error: "Yetkin yok."
                });
            }

            const emoji = text(
                payload.emoji,
                20
            );

            if (!message.reactions) {
                message.reactions = {};
            }

            message.reactions[emoji] ||= [];

            const list =
                message.reactions[emoji];

            const index =
                list.indexOf(
                    socket.userId
                );

            if (index === -1) {
                list.push(
                    socket.userId
                );
            } else {
                list.splice(index, 1);
            }

            save(FILES.messages, messages);

            const result = {
                success: true,
                message
            };

            emitChat(
                chat,
                "message_reaction",
                result
            );

            emitChat(
                chat,
                "message_reacted",
                result
            );

            callback?.(result);
        }
    );

    /* ---------- TYPING ---------- */

    socket.on("typing", payload => {
        if (!socket.authenticated) return;

        const chat =
            chatById(payload?.chatId);

        if (
            !chat ||
            !isMember(
                chat,
                socket.userId
            )
        ) {
            return;
        }

        for (const member of chat.members) {
            if (member === socket.userId) {
                continue;
            }

            emitUser(
                member,
                "typing",
                {
                    chatId: chat.id,
                    userId: socket.userId,
                    user: publicUser(
                        socket.user
                    ),
                    typing:
                        !!payload?.typing
                }
            );
        }
    });

    /* ---------- BLOCK ---------- */

    socket.on(
        "block_user",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const target = findUser(
                payload?.userId ||
                payload?.code ||
                payload?.userCode ||
                payload?.username
            );

            if (!target) {
                return callback?.({
                    success: false,
                    error:
                        "Kullanıcı bulunamadı."
                });
            }

            if (
                target.id ===
                socket.userId
            ) {
                return callback?.({
                    success: false,
                    error:
                        "Kendini engelleyemezsin."
                });
            }

            socket.user.blockedUsers ||=
                [];

            const shouldBlock =
                payload?.blocked !== false;

            const index =
                socket.user.blockedUsers.indexOf(
                    target.id
                );

            if (shouldBlock && index === -1) {
                socket.user.blockedUsers.push(
                    target.id
                );
            }

            if (!shouldBlock && index !== -1) {
                socket.user.blockedUsers.splice(
                    index,
                    1
                );
            }

            save(FILES.users, users);

            callback?.({
                success: true,
                blocked: shouldBlock,
                user: publicUser(target)
            });
        }
    );

    /* ---------- PROFILE ---------- */

    socket.on(
        "update_profile",
        (payload, callback) => {
            if (!requireAuth(callback)) return;

            const name = text(
                payload?.displayName ||
                payload?.name,
                60
            );

            const bio = text(
                payload?.bio,
                160
            );

            if (name) {
                socket.user.name = name;
                socket.user.displayName = name;
            }

            socket.user.bio = bio;

            if (
                payload?.avatar !==
                undefined
            ) {
                socket.user.avatar =
                    text(
                        payload.avatar,
                        1000
                    );
            }

            save(FILES.users, users);

            callback?.({
                success: true,
                user:
                    publicUser(
                        socket.user
                    )
            });
        }
    );

    /* ---------- DISCONNECT ---------- */

    socket.on("disconnect", () => {
        if (!socket.userId) return;

        removeSocket(
            socket.userId,
            socket.id
        );

        if (
            !socketsByUser.has(
                socket.userId
            )
        ) {
            const user =
                userById(
                    socket.userId
                );

            if (user) {
                user.online = false;
                user.lastSeen = Date.now();

                save(FILES.users, users);
            }
        }

        console.log(
            "Socket ayrıldı:",
            socket.id
        );
    });
});

/* =========================
   STATIC FRONTEND
========================= */

app.use(
    express.static(ROOT)
);

/* API 404 */
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        error: "API bulunamadı."
    });
});

/* SPA fallback */
app.use((req, res) => {
    const index = path.join(
        ROOT,
        "index.html"
    );

    if (fs.existsSync(index)) {
        return res.sendFile(index);
    }

    res.status(404).send(
        "index.html bulunamadı."
    );
});

/* =========================
   ERROR
========================= */

app.use(
    (error, req, res, next) => {
        console.error(
            "SERVER ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            success: false,
            error: "Sunucu hatası."
        });
    }
);

/* =========================
   START
========================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log(
            "================================"
        );
        console.log(
            "        MESAJX ONLINE"
        );
        console.log(
            "================================"
        );
        console.log(
            "Port:",
            PORT
        );
        console.log(
            "Node:",
            process.version
        );
        console.log(
            "Users:",
            users.length
        );
        console.log(
            "Chats:",
            chats.length
        );
        console.log(
            "Messages:",
            messages.length
        );
        console.log(
            "================================"
        );
        console.log("");
    }
);
