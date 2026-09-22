require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ======================================================
// MESAJX - REAL TIME MESSAGING SERVER
// Express + Socket.IO
// Render uyumlu
// ======================================================

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
    },
    transports: ["websocket", "polling"]
});

// ------------------------------------------------------
// AYARLAR
// ------------------------------------------------------

const PORT = Number(process.env.PORT) || 10000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

// ------------------------------------------------------
// DATA KLASÖRÜ
// ------------------------------------------------------

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ------------------------------------------------------
// JSON DOSYA YARDIMCILARI
// ------------------------------------------------------

function ensureFile(file, fallback) {
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
ensureFile(SESSIONS_FILE, {});

function readJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            ensureFile(file, fallback);
            return fallback;
        }

        const raw = fs.readFileSync(file, "utf8");

        if (!raw.trim()) {
            return fallback;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.error("JSON okuma hatası:", file, error.message);

        try {
            const backup = file + ".broken-" + Date.now();
            fs.copyFileSync(file, backup);
        } catch (_) {}

        return fallback;
    }
}

function writeJSON(file, data) {
    const tempFile = file + ".tmp";

    fs.writeFileSync(
        tempFile,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(tempFile, file);
}

let users = readJSON(USERS_FILE, []);
let chats = readJSON(CHATS_FILE, []);
let messages = readJSON(MESSAGES_FILE, []);
let sessions = readJSON(SESSIONS_FILE, {});

// ------------------------------------------------------
// VERİ NORMALİZASYONU
// ------------------------------------------------------

if (!Array.isArray(users)) users = [];
if (!Array.isArray(chats)) chats = [];
if (!Array.isArray(messages)) messages = [];
if (!sessions || typeof sessions !== "object") sessions = {};

for (const user of users) {
    if (!Array.isArray(user.blockedUsers)) {
        user.blockedUsers = [];
    }

    if (!user.displayName) {
        user.displayName =
            user.name ||
            user.username ||
            "Kullanıcı";
    }

    if (!user.name) {
        user.name = user.displayName;
    }

    if (!user.username) {
        user.username =
            "user_" +
            crypto.randomBytes(4).toString("hex");
    }

    if (!user.code) {
        user.code = createUniqueCode();
    }

    if (!user.createdAt) {
        user.createdAt = Date.now();
    }

    if (!user.updatedAt) {
        user.updatedAt = Date.now();
    }
}

writeJSON(USERS_FILE, users);

// ------------------------------------------------------
// GENEL YARDIMCILAR
// ------------------------------------------------------

function uid(prefix = "") {
    return (
        prefix +
        Date.now().toString(36) +
        crypto.randomBytes(5).toString("hex")
    );
}

function now() {
    return Date.now();
}

function cleanText(value, max = 10000) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, max);
}

function normalizeUsername(value) {
    return cleanText(value, 40)
        .toLowerCase()
        .replace(/\s+/g, "");
}

function normalizeCode(value) {
    return cleanText(value, 30)
        .toUpperCase()
        .replace(/\s+/g, "");
}

function hashPin(pin) {
    return crypto
        .createHash("sha256")
        .update(String(pin))
        .digest("hex");
}

function createToken() {
    return crypto.randomBytes(32).toString("hex");
}

function createUniqueCode() {
    let code;

    do {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        let random = "";

        for (let i = 0; i < 6; i++) {
            random += chars[
                crypto.randomInt(0, chars.length)
            ];
        }

        code = "TRK-" + random;

    } while (
        users.some(
            u =>
                normalizeCode(u.code) ===
                normalizeCode(code)
        )
    );

    return code;
}

// ------------------------------------------------------
// USER BULMA
// ------------------------------------------------------

function getUserById(id) {
    return users.find(
        u => String(u.id) === String(id)
    );
}

function getUserByUsername(username) {
    const normalized = normalizeUsername(username);

    return users.find(
        u =>
            normalizeUsername(u.username) ===
            normalized
    );
}

function getUserByCode(code) {
    const normalized = normalizeCode(code);

    return users.find(
        u =>
            normalizeCode(u.code) ===
            normalized
    );
}

function findUser(value) {
    if (!value) return null;

    const text = cleanText(value);

    return (
        getUserById(text) ||
        getUserByCode(text) ||
        getUserByUsername(text)
    );
}

// ------------------------------------------------------
// PUBLIC USER
// ------------------------------------------------------

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
        online: Boolean(user.online),
        lastSeen: user.lastSeen || null,
        createdAt: user.createdAt
    };
}

// ------------------------------------------------------
// BLOCK
// ------------------------------------------------------

function isBlocked(userA, userB) {
    if (!userA || !userB) return false;

    const a =
        Array.isArray(userA.blockedUsers)
            ? userA.blockedUsers
            : [];

    const b =
        Array.isArray(userB.blockedUsers)
            ? userB.blockedUsers
            : [];

    return (
        a.includes(userB.id) ||
        b.includes(userA.id)
    );
}

// ------------------------------------------------------
// CHAT
// ------------------------------------------------------

function getChatById(chatId) {
    return chats.find(
        chat =>
            String(chat.id) ===
            String(chatId)
    );
}

function isMember(chat, userId) {
    return Boolean(
        chat &&
        Array.isArray(chat.members) &&
        chat.members.includes(userId)
    );
}

function getPrivateChat(userA, userB) {
    return chats.find(chat => {
        if (chat.type !== "private") {
            return false;
        }

        if (
            !Array.isArray(chat.members) ||
            chat.members.length !== 2
        ) {
            return false;
        }

        return (
            chat.members.includes(userA.id) &&
            chat.members.includes(userB.id)
        );
    });
}

function getLastMessage(chatId) {
    const list = messages
        .filter(
            message =>
                String(message.chatId) ===
                String(chatId)
        )
        .sort(
            (a, b) =>
                Number(b.createdAt) -
                Number(a.createdAt)
        );

    return list[0] || null;
}

function serializeChat(chat, currentUserId) {
    const lastMessage =
        getLastMessage(chat.id);

    const members = chat.members
        .map(id => getUserById(id))
        .filter(Boolean)
        .map(publicUser);

    let title = chat.name || "Sohbet";

    if (chat.type === "private") {
        const other = members.find(
            user =>
                String(user.id) !==
                String(currentUserId)
        );

        if (other) {
            title =
                other.displayName ||
                other.username;
        }
    }

    return {
        id: chat.id,
        type: chat.type,
        name: title,
        members,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        lastMessage
    };
}

// ------------------------------------------------------
// SESSION
// ------------------------------------------------------

function createSession(userId) {
    const token = createToken();

    sessions[token] = {
        userId,
        createdAt: now(),
        lastUsed: now()
    };

    writeJSON(SESSIONS_FILE, sessions);

    return token;
}

function getUserFromToken(token) {
    if (!token) return null;

    const session = sessions[token];

    if (!session) return null;

    const user = getUserById(session.userId);

    if (!user) return null;

    session.lastUsed = now();

    return user;
}

function deleteSession(token) {
    if (!token) return;

    delete sessions[token];

    writeJSON(SESSIONS_FILE, sessions);
}

// ------------------------------------------------------
// RATE LIMIT
// ------------------------------------------------------

const rateMap = new Map();

function rateLimit(key, limit = 120, windowMs = 60000) {
    const current = now();

    const item = rateMap.get(key);

    if (!item || current - item.start > windowMs) {
        rateMap.set(key, {
            start: current,
            count: 1
        });

        return true;
    }

    item.count++;

    return item.count <= limit;
}

setInterval(() => {
    const cutoff = now() - 120000;

    for (const [key, value] of rateMap.entries()) {
        if (value.start < cutoff) {
            rateMap.delete(key);
        }
    }
}, 60000);

// ------------------------------------------------------
// EXPRESS
// ------------------------------------------------------

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

// ------------------------------------------------------
// HEALTH
// ------------------------------------------------------

function healthData() {
    return {
        success: true,
        status: "online",
        service: "MesajX",
        serverTime: new Date().toISOString(),
        users: users.length,
        chats: chats.length,
        messages: messages.length,
        node: process.version
    };
}

app.get("/api/status", (req, res) => {
    res.json(healthData());
});

app.get("/api/health", (req, res) => {
    res.json(healthData());
});

app.get("/", (req, res) => {
    res.sendFile(
        path.join(ROOT, "index.html"),
        error => {
            if (error) {
                res.status(200).json({
                    success: true,
                    message:
                        "MesajX server çalışıyor.",
                    ...healthData()
                });
            }
        }
    );
});

// ------------------------------------------------------
// REGISTER
// ------------------------------------------------------

app.post("/api/register", (req, res) => {
    try {
        const body = req.body || {};

        const displayName = cleanText(
            body.displayName ||
            body.name ||
            body.fullName,
            60
        );

        const username = normalizeUsername(
            body.username ||
            body.userName ||
            body.identifier
        );

        const pin = cleanText(
            body.pin ||
            body.password ||
            body.passcode,
            100
        );

        if (!displayName) {
            return res.status(400).json({
                success: false,
                error: "Ad soyad gerekli."
            });
        }

        if (!username) {
            return res.status(400).json({
                success: false,
                error: "Kullanıcı adı gerekli."
            });
        }

        if (!/^[a-z0-9_.-]{3,30}$/i.test(username)) {
            return res.status(400).json({
                success: false,
                error:
                    "Kullanıcı adı 3-30 karakter olmalı."
            });
        }

        if (pin.length < 4) {
            return res.status(400).json({
                success: false,
                error:
                    "PIN en az 4 karakter olmalı."
            });
        }

        if (getUserByUsername(username)) {
            return res.status(409).json({
                success: false,
                error:
                    "Bu kullanıcı adı zaten kullanılıyor."
            });
        }

        const user = {
            id: uid("usr_"),
            name: displayName,
            displayName,
            username,
            code: createUniqueCode(),
            bio: "",
            avatar: "",
            pinHash: hashPin(pin),
            blockedUsers: [],
            online: false,
            lastSeen: now(),
            createdAt: now(),
            updatedAt: now()
        };

        users.push(user);

        writeJSON(USERS_FILE, users);

        const token = createSession(user.id);

        user.online = true;

        writeJSON(USERS_FILE, users);

        return res.status(201).json({
            success: true,
            token,
            sessionToken: token,
            user: publicUser(user),
            code: user.code
        });

    } catch (error) {
        console.error("REGISTER ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Kayıt sırasında sunucu hatası."
        });
    }
});

// ------------------------------------------------------
// LOGIN
// ------------------------------------------------------

app.post("/api/login", (req, res) => {
    try {
        const body = req.body || {};

        const identifier = cleanText(
            body.username ||
            body.identifier ||
            body.code ||
            body.userCode ||
            body.login
        );

        const pin = cleanText(
            body.pin ||
            body.password ||
            body.passcode
        );

        if (!identifier || !pin) {
            return res.status(400).json({
                success: false,
                error:
                    "Kullanıcı adı/kod ve PIN gerekli."
            });
        }

        const user = findUser(identifier);

        if (!user) {
            return res.status(401).json({
                success: false,
                error:
                    "Kullanıcı bulunamadı."
            });
        }

        if (
            user.pinHash !==
            hashPin(pin)
        ) {
            return res.status(401).json({
                success: false,
                error:
                    "PIN hatalı."
            });
        }

        const token =
            createSession(user.id);

        user.online = true;
        user.lastSeen = now();

        writeJSON(USERS_FILE, users);

        return res.json({
            success: true,
            token,
            sessionToken: token,
            user: publicUser(user),
            code: user.code
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Giriş sırasında sunucu hatası."
        });
    }
});

// ------------------------------------------------------
// ME
// ------------------------------------------------------

app.get("/api/me", (req, res) => {
    const token =
        req.headers.authorization?.replace(
            /^Bearer\s+/i,
            ""
        ) ||
        req.headers["x-session-token"];

    const user =
        getUserFromToken(token);

    if (!user) {
        return res.status(401).json({
            success: false,
            error: "Oturum geçersiz."
        });
    }

    res.json({
        success: true,
        user: publicUser(user),
        code: user.code
    });
});

// ------------------------------------------------------
// LOGOUT
// ------------------------------------------------------

app.post("/api/logout", (req, res) => {
    const token =
        req.headers.authorization?.replace(
            /^Bearer\s+/i,
            ""
        ) ||
        req.headers["x-session-token"];

    const user =
        getUserFromToken(token);

    if (user) {
        user.online = false;
        user.lastSeen = now();

        writeJSON(USERS_FILE, users);
    }

    deleteSession(token);

    res.json({
        success: true
    });
});

// ------------------------------------------------------
// USER SEARCH HTTP
// ------------------------------------------------------

function searchUsers(query, currentUser) {
    const q = cleanText(query, 80)
        .toLowerCase();

    if (!q) return [];

    return users
        .filter(user => {
            if (
                currentUser &&
                user.id === currentUser.id
            ) {
                return false;
            }

            return (
                user.username
                    .toLowerCase()
                    .includes(q) ||
                user.displayName
                    .toLowerCase()
                    .includes(q) ||
                user.code
                    .toLowerCase()
                    .includes(q)
            );
        })
        .slice(0, 30)
        .map(publicUser);
}

function requireHTTPUser(req) {
    const token =
        req.headers.authorization?.replace(
            /^Bearer\s+/i,
            ""
        ) ||
        req.headers["x-session-token"];

    return getUserFromToken(token);
}

app.get("/api/users/search", (req, res) => {
    const user = requireHTTPUser(req);

    const results = searchUsers(
        req.query.q ||
        req.query.query ||
        req.query.code ||
        "",
        user
    );

    res.json({
        success: true,
        users: results
    });
});

app.get("/api/search_users", (req, res) => {
    const user = requireHTTPUser(req);

    const results = searchUsers(
        req.query.q ||
        req.query.query ||
        req.query.code ||
        "",
        user
    );

    res.json({
        success: true,
        users: results
    });
});

// ------------------------------------------------------
// SOCKET AUTH
// ------------------------------------------------------

const onlineSockets = new Map();

function getSocketUser(socket) {
    return socket.user || null;
}

function authenticateSocket(socket, token) {
    const user =
        getUserFromToken(token);

    if (!user) {
        return null;
    }

    socket.user = user;
    socket.userId = user.id;
    socket.authenticated = true;

    if (!onlineSockets.has(user.id)) {
        onlineSockets.set(
            user.id,
            new Set()
        );
    }

    onlineSockets
        .get(user.id)
        .add(socket.id);

    user.online = true;
    user.lastSeen = now();

    writeJSON(USERS_FILE, users);

    return user;
}

function sendToUser(userId, event, data) {
    const socketIds =
        onlineSockets.get(userId);

    if (!socketIds) return;

    for (const socketId of socketIds) {
        io.to(socketId).emit(
            event,
            data
        );
    }
}

function sendToChat(chat, event, data) {
    if (!chat) return;

    for (const memberId of chat.members) {
        sendToUser(
            memberId,
            event,
            data
        );
    }
}

// ------------------------------------------------------
// SOCKET.IO
// ------------------------------------------------------

io.on("connection", socket => {
    console.log(
        "Socket bağlandı:",
        socket.id
    );

    // ==================================================
    // AUTHENTICATE
    // ==================================================

    socket.on(
        "authenticate",
        (payload, callback) => {
            try {
                let token = "";

                if (
                    typeof payload ===
                    "string"
                ) {
                    token = payload;
                } else {
                    token =
                        payload?.token ||
                        payload?.sessionToken ||
                        payload?.authToken ||
                        "";
                }

                const user =
                    authenticateSocket(
                        socket,
                        token
                    );

                if (!user) {
                    const result = {
                        success: false,
                        error:
                            "Oturum geçersiz."
                    };

                    if (
                        typeof callback ===
                        "function"
                    ) {
                        callback(result);
                    }

                    socket.emit(
                        "auth_error",
                        result
                    );

                    return;
                }

                const result = {
                    success: true,
                    user: publicUser(user),
                    token
                };

                socket.emit(
                    "auth_ok",
                    result
                );

                socket.emit(
                    "authenticated",
                    result
                );

                socket.emit(
                    "auth_success",
                    result
                );

                if (
                    typeof callback ===
                    "function"
                ) {
                    callback(result);
                }

            } catch (error) {
                console.error(
                    "AUTH ERROR:",
                    error
                );
            }
        }
    );

    // ==================================================
    // GET CHATS
    // ==================================================

    socket.on(
        "get_chats",
        callback => {
            if (!socket.authenticated) {
                return callback?.({
                    success: false,
                    error:
                        "Önce giriş yapmalısın."
                });
            }

            const userId =
                socket.userId;

            const result = chats
                .filter(chat =>
                    isMember(
                        chat,
                        userId
                    )
                )
                .sort(
                    (a, b) =>
                        Number(
                            b.updatedAt
                        ) -
                        Number(
                            a.updatedAt
                        )
                )
                .map(chat =>
                    serializeChat(
                        chat,
                        userId
                    )
                );

            callback?.({
                success: true,
                chats: result
            });
        }
    );

    // ==================================================
    // SEARCH USERS
    // ==================================================

    socket.on(
        "search_users",
        (payload, callback) => {
            if (!socket.authenticated) {
                return callback?.({
                    success: false,
                    error:
                        "Önce giriş yapmalısın."
                });
            }

            const query =
                typeof payload ===
                "string"
                    ? payload
                    : payload?.q ||
                      payload?.query ||
                      payload?.code ||
                      payload?.username ||
                      "";

            const result =
                searchUsers(
                    query,
                    socket.user
                );

            callback?.({
                success: true,
                users: result
            });
        }
    );

    // ==================================================
    // CREATE CHAT
    // ==================================================

    socket.on(
        "create_chat",
        (payload, callback) => {
            try {
                if (
                    !socket.authenticated
                ) {
                    return callback?.({
                        success: false,
                        error:
                            "Önce giriş yapmalısın."
                    });
                }

                payload =
                    payload || {};

                const type =
                    payload.type ===
                    "group"
                        ? "group"
                        : "private";

                let memberIds = [];

                if (
                    Array.isArray(
                        payload.memberIds
                    )
                ) {
                    memberIds.push(
                        ...payload.memberIds
                    );
                }

                if (
                    Array.isArray(
                        payload.memberCodes
                    )
                ) {
                    for (const code of payload.memberCodes) {
                        const user =
                            getUserByCode(
                                code
                            );

                        if (user) {
                            memberIds.push(
                                user.id
                            );
                        }
                    }
                }

                if (
                    Array.isArray(
                        payload.members
                    )
                ) {
                    for (const item of payload.members) {
                        const user =
                            findUser(
                                item?.id ||
                                item?.code ||
                                item?.username ||
                                item
                            );

                        if (user) {
                            memberIds.push(
                                user.id
                            );
                        }
                    }
                }

                memberIds.push(
                    socket.userId
                );

                memberIds = [
                    ...new Set(
                        memberIds
                            .filter(Boolean)
                            .map(String)
                    )
                ];

                if (type === "private") {
                    if (
                        memberIds.length !==
                        2
                    ) {
                        return callback?.({
                            success: false,
                            error:
                                "Özel sohbet için bir kişi seçmelisin."
                        });
                    }

                    const other =
                        getUserById(
                            memberIds.find(
                                id =>
                                    id !==
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
                        isBlocked(
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

                    const existing =
                        getPrivateChat(
                            socket.user,
                            other
                        );

                    if (existing) {
                        return callback?.({
                            success: true,
                            chat:
                                serializeChat(
                                    existing,
                                    socket.userId
                                ),
                            existing: true
                        });
                    }
                }

                if (
                    type === "group" &&
                    memberIds.length < 2
                ) {
                    return callback?.({
                        success: false,
                        error:
                            "Grup için en az 2 kişi gerekli."
                    });
                }

                const chat = {
                    id: uid("chat_"),
                    type,
                    name:
                        cleanText(
                            payload.name ||
                            payload.title ||
                            "",
                            100
                        ) ||
                        (
                            type === "group"
                                ? "Yeni Grup"
                                : "Sohbet"
                        ),
                    members: memberIds,
                    createdBy:
                        socket.userId,
                    createdAt: now(),
                    updatedAt: now()
                };

                chats.push(chat);

                writeJSON(
                    CHATS_FILE,
                    chats
                );

                const serialized =
                    serializeChat(
                        chat,
                        socket.userId
                    );

                sendToChat(
                    chat,
                    "chat_created",
                    {
                        success: true,
                        chat: serialized
                    }
                );

                sendToChat(
                    chat,
                    "new_chat",
                    {
                        success: true,
                        chat: serialized
                    }
                );

                callback?.({
                    success: true,
                    chat: serialized
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

    // ==================================================
    // GET MESSAGES
    // ==================================================

    socket.on(
        "get_messages",
        (payload, callback) => {
            if (!socket.authenticated) {
                return callback?.({
                    success: false,
                    error:
                        "Önce giriş yapmalısın."
                });
            }

            const chatId =
                typeof payload ===
                "string"
                    ? payload
                    : payload?.chatId ||
                      payload?.conversationId ||
                      payload?.conversation;

            const chat =
                getChatById(chatId);

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

            const limit = Math.min(
                Number(
                    payload?.limit ||
                    200
                ),
                500
            );

            const result = messages
                .filter(
                    message =>
                        String(
                            message.chatId
                        ) ===
                        String(chat.id)
                )
                .sort(
                    (a, b) =>
                        Number(
                            a.createdAt
                        ) -
                        Number(
                            b.createdAt
                        )
                )
                .slice(-limit);

            callback?.({
                success: true,
                messages: result
            });
        }
    );

    // ==================================================
    // SEND MESSAGE
    // ==================================================

    socket.on(
        "send_message",
        (payload, callback) => {
            try {
                if (!socket.authenticated) {
                    return callback?.({
                        success: false,
                        error:
                            "Önce giriş yapmalısın."
                    });
                }

                if (
                    !rateLimit(
                        socket.userId,
                        120,
                        60000
                    )
                ) {
                    return callback?.({
                        success: false,
                        error:
                            "Çok fazla mesaj gönderdin."
                    });
                }

                payload =
                    payload || {};

                const chatId =
                    payload.chatId ||
                    payload.conversationId ||
                    payload.conversation;

                const text =
                    cleanText(
                        payload.text ??
                        payload.message ??
                        payload.content ??
                        "",
                        10000
                    );

                const chat =
                    getChatById(chatId);

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

                if (!text &&
                    !payload.attachment) {
                    return callback?.({
                        success: false,
                        error:
                            "Mesaj boş olamaz."
                    });
                }

                // Özel sohbette block kontrolü
                if (
                    chat.type ===
                    "private"
                ) {
                    const otherId =
                        chat.members.find(
                            id =>
                                id !==
                                socket.userId
                        );

                    const other =
                        getUserById(
                            otherId
                        );

                    if (
                        other &&
                        isBlocked(
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
                    id: uid("msg_"),
                    chatId: chat.id,
                    senderId:
                        socket.userId,
                    sender:
                        publicUser(
                            socket.user
                        ),
                    text,
                    content: text,
                    attachment:
                        payload.attachment ||
                        null,
                    attachments:
                        Array.isArray(
                            payload.attachments
                        )
                            ? payload.attachments
                            : [],
                    replyTo:
                        payload.replyTo ||
                        null,
                    createdAt: now(),
                    updatedAt: now(),
                    edited: false,
                    reactions: {}
                };

                messages.push(message);

                chat.updatedAt =
                    message.createdAt;

                writeJSON(
                    MESSAGES_FILE,
                    messages
                );

                writeJSON(
                    CHATS_FILE,
                    chats
                );

                const packet = {
                    success: true,
                    message
                };

                sendToChat(
                    chat,
                    "new_message",
                    packet
                );

                // Eski frontend uyumluluğu
                sendToChat(
                    chat,
                    "message",
                    packet
                );

                callback?.(packet);

            } catch (error) {
                console.error(
                    "SEND MESSAGE ERROR:",
                    error
                );

                callback?.({
                    success: false,
                    error:
                        "Mesaj gönderilemedi."
                });
            }
        }
    );

    // ==================================================
    // EDIT MESSAGE
    // ==================================================

    socket.on(
        "edit_message",
        (payload, callback) => {
            const message =
                messages.find(
                    item =>
                        item.id ===
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
                        "Bu mesajı düzenleyemezsin."
                });
            }

            const newText =
                cleanText(
                    payload.text ??
                    payload.message ??
                    payload.content,
                    10000
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
            message.updatedAt = now();

            writeJSON(
                MESSAGES_FILE,
                messages
            );

            const chat =
                getChatById(
                    message.chatId
                );

            const packet = {
                success: true,
                message
            };

            sendToChat(
                chat,
                "message_edited",
                packet
            );

            sendToChat(
                chat,
                "message_updated",
                packet
            );

            callback?.(packet);
        }
    );

    // ==================================================
    // DELETE MESSAGE
    // ==================================================

    socket.on(
        "delete_message",
        (payload, callback) => {
            const index =
                messages.findIndex(
                    item =>
                        item.id ===
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
                        "Bu mesajı silemezsin."
                });
            }

            messages.splice(
                index,
                1
            );

            writeJSON(
                MESSAGES_FILE,
                messages
            );

            const chat =
                getChatById(
                    message.chatId
                );

            const packet = {
                success: true,
                messageId:
                    message.id,
                chatId:
                    message.chatId
            };

            sendToChat(
                chat,
                "message_deleted",
                packet
            );

            sendToChat(
                chat,
                "message_removed",
                packet
            );

            callback?.(packet);
        }
    );

    // ==================================================
    // REACTION
    // ==================================================

    socket.on(
        "react_message",
        (payload, callback) => {
            const message =
                messages.find(
                    item =>
                        item.id ===
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
                getChatById(
                    message.chatId
                );

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
                        "Yetkin yok."
                });
            }

            const emoji =
                cleanText(
                    payload.emoji,
                    20
                );

            if (!emoji) {
                return callback?.({
                    success: false,
                    error:
                        "Emoji gerekli."
                });
            }

            if (
                !message.reactions ||
                typeof message.reactions !==
                    "object"
            ) {
                message.reactions = {};
            }

            if (
                !Array.isArray(
                    message.reactions[emoji]
                )
            ) {
                message.reactions[emoji] =
                    [];
            }

            const list =
                message.reactions[
                    emoji
                ];

            const index =
                list.indexOf(
                    socket.userId
                );

            if (index === -1) {
                list.push(
                    socket.userId
                );
            } else {
                list.splice(
                    index,
                    1
                );
            }

            writeJSON(
                MESSAGES_FILE,
                messages
            );

            const packet = {
                success: true,
                message
            };

            sendToChat(
                chat,
                "message_reaction",
                packet
            );

            // Eski frontend uyumluluğu
            sendToChat(
                chat,
                "message_reacted",
                packet
            );

            callback?.(packet);
        }
    );

    // ==================================================
    // TYPING
    // ==================================================

    socket.on(
        "typing",
        payload => {
            if (!socket.authenticated) {
                return;
            }

            const chat =
                getChatById(
                    payload?.chatId
                );

            if (
                !chat ||
                !isMember(
                    chat,
                    socket.userId
                )
            ) {
                return;
            }

            for (const memberId of chat.members) {
                if (
                    memberId ===
                    socket.userId
                ) {
                    continue;
                }

                sendToUser(
                    memberId,
                    "typing",
                    {
                        chatId:
                            chat.id,
                        userId:
                            socket.userId,
                        user:
                            publicUser(
                                socket.user
                            ),
                        typing:
                            Boolean(
                                payload?.typing
                            )
                    }
                );
            }
        }
    );

    // ==================================================
    // BLOCK / UNBLOCK
    // ==================================================

    socket.on(
        "block_user",
        (payload, callback) => {
            if (!socket.authenticated) {
                return callback?.({
                    success: false,
                    error:
                        "Önce giriş yapmalısın."
                });
            }

            const target =
                findUser(
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

            if (
                !Array.isArray(
                    socket.user.blockedUsers
                )
            ) {
                socket.user.blockedUsers =
                    [];
            }

            const shouldBlock =
                payload?.blocked !==
                false;

            const index =
                socket.user.blockedUsers
                    .indexOf(
                        target.id
                    );

            if (shouldBlock) {
                if (index === -1) {
                    socket.user.blockedUsers.push(
                        target.id
                    );
                }
            } else {
                if (index !== -1) {
                    socket.user.blockedUsers.splice(
                        index,
                        1
                    );
                }
            }

            writeJSON(
                USERS_FILE,
                users
            );

            callback?.({
                success: true,
                blocked:
                    shouldBlock,
                user:
                    publicUser(target)
            });
        }
    );

    // Ayrı unblock desteği
    socket.on(
        "unblock_user",
        (payload, callback) => {
            const target =
                findUser(
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
                !Array.isArray(
                    socket.user.blockedUsers
                )
            ) {
                socket.user.blockedUsers =
                    [];
            }

            socket.user.blockedUsers =
                socket.user.blockedUsers.filter(
                    id =>
                        id !==
                        target.id
                );

            writeJSON(
                USERS_FILE,
                users
            );

            callback?.({
                success: true,
                blocked: false
            });
        }
    );

    // ==================================================
    // UPDATE PROFILE
    // ==================================================

    socket.on(
        "update_profile",
        (payload, callback) => {
            if (!socket.authenticated) {
                return callback?.({
                    success: false,
                    error:
                        "Önce giriş yapmalısın."
                });
            }

            const displayName =
                cleanText(
                    payload?.displayName ||
                    payload?.name,
                    60
                );

            const bio =
                cleanText(
                    payload?.bio,
                    160
                );

            if (displayName) {
                socket.user.displayName =
                    displayName;

                socket.user.name =
                    displayName;
            }

            socket.user.bio = bio;

            if (
                payload?.avatar !==
                undefined
            ) {
                socket.user.avatar =
                    cleanText(
                        payload.avatar,
                        1000
                    );
            }

            socket.user.updatedAt =
                now();

            writeJSON(
                USERS_FILE,
                users
            );

            callback?.({
                success: true,
                user:
                    publicUser(
                        socket.user
                    )
            });
        }
    );

    // ==================================================
    // DISCONNECT
    // ==================================================

    socket.on(
        "disconnect",
        reason => {
            console.log(
                "Socket ayrıldı:",
                socket.id,
                reason
            );

            if (
                socket.userId &&
                onlineSockets.has(
                    socket.userId
                )
            ) {
                const set =
                    onlineSockets.get(
                        socket.userId
                    );

                set.delete(
                    socket.id
                );

                if (set.size === 0) {
                    onlineSockets.delete(
                        socket.userId
                    );

                    const user =
                        getUserById(
                            socket.userId
                        );

                    if (user) {
                        user.online =
                            false;

                        user.lastSeen =
                            now();

                        writeJSON(
                            USERS_FILE,
                            users
                        );
                    }
                }
            }
        }
    );
});

// ------------------------------------------------------
// STATIC DOSYALAR
// ------------------------------------------------------

app.use(
    express.static(ROOT, {
        extensions: ["html"]
    })
);

// ------------------------------------------------------
// 404
// ------------------------------------------------------

app.use(
    (req, res) => {
        if (
            req.path.startsWith(
                "/api/"
            )
        ) {
            return res.status(404).json({
                success: false,
                error:
                    "API endpoint bulunamadı."
            });
        }

        const indexFile =
            path.join(
                ROOT,
                "index.html"
            );

        if (
            fs.existsSync(indexFile)
        ) {
            return res.sendFile(
                indexFile
            );
        }

        return res.status(404).send(
            "MesajX çalışıyor fakat index.html bulunamadı."
        );
    }
);

// ------------------------------------------------------
// ERROR HANDLER
// ------------------------------------------------------

app.use(
    (
        error,
        req,
        res,
        next
    ) => {
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
                "Sunucu hatası."
        });
    }
);

// ------------------------------------------------------
// PROCESS HATALARI
// ------------------------------------------------------

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

// ------------------------------------------------------
// GRACEFUL SHUTDOWN
// ------------------------------------------------------

function shutdown(signal) {
    console.log(
        `${signal} alındı. Sunucu kapatılıyor...`
    );

    try {
        writeJSON(
            USERS_FILE,
            users
        );

        writeJSON(
            CHATS_FILE,
            chats
        );

        writeJSON(
            MESSAGES_FILE,
            messages
        );

        writeJSON(
            SESSIONS_FILE,
            sessions
        );
    } catch (error) {
        console.error(
            "Kapanış kayıt hatası:",
            error
        );
    }

    server.close(() => {
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(0);
    }, 5000);
}

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

// ------------------------------------------------------
// SERVER START
// ------------------------------------------------------

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "========================================"
        );

        console.log(
            "      MESAJX SERVER ONLINE"
        );

        console.log(
            "========================================"
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
            "========================================"
        );
    }
);
