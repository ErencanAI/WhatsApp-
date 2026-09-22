"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   DATABASE
========================================================= */

function ensureFile(file, fallback) {
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
ensureFile(SESSIONS_FILE, []);

function readJSON(file, fallback) {
    try {
        const raw = fs.readFileSync(file, "utf8");

        if (!raw.trim()) {
            return fallback;
        }

        const data = JSON.parse(raw);

        return data;
    } catch (error) {
        console.error(
            "JSON okuma hatası:",
            file,
            error.message
        );

        return fallback;
    }
}

function writeJSON(file, data) {
    try {
        const temp =
            file + ".tmp";

        fs.writeFileSync(
            temp,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        fs.renameSync(
            temp,
            file
        );

        return true;
    } catch (error) {
        console.error(
            "JSON yazma hatası:",
            file,
            error.message
        );

        return false;
    }
}

/* =========================================================
   DATA
========================================================= */

let users = readJSON(
    USERS_FILE,
    []
);

let chats = readJSON(
    CHATS_FILE,
    []
);

let messages = readJSON(
    MESSAGES_FILE,
    []
);

let sessions = readJSON(
    SESSIONS_FILE,
    []
);

/* Eski dosyalarda obje kalmışsa düzelt */
if (!Array.isArray(users)) users = [];
if (!Array.isArray(chats)) chats = [];
if (!Array.isArray(messages)) messages = [];
if (!Array.isArray(sessions)) sessions = [];

/* =========================================================
   HELPERS
========================================================= */

function id(prefix = "") {
    return (
        prefix +
        crypto.randomBytes(12).toString("hex")
    );
}

function now() {
    return new Date().toISOString();
}

function cleanText(value, max = 5000) {
    return String(value ?? "")
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, max);
}

function normalizeUsername(value) {
    return cleanText(
        value,
        40
    )
        .toLowerCase()
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

function codeExists(code) {
    return users.some(
        user =>
            String(user.code || "")
                .toUpperCase() ===
            String(code)
                .toUpperCase()
    );
}

function createUserCode() {

    let code;

    do {
        const chars =
            "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        let random = "";

        for (let i = 0; i < 6; i++) {
            random +=
                chars[
                    Math.floor(
                        Math.random() *
                        chars.length
                    )
                ];
        }

        code = "TRK-" + random;

    } while (codeExists(code));

    return code;
}

function publicUser(user) {

    if (!user) {
        return null;
    }

    return {
        id: user.id,
        name:
            user.displayName ||
            user.name ||
            "",
        displayName:
            user.displayName ||
            user.name ||
            "",
        username:
            user.username ||
            "",
        code:
            user.code ||
            "",
        bio:
            user.bio ||
            "",
        avatar:
            user.avatar ||
            "",
        createdAt:
            user.createdAt ||
            null
    };
}

function getUserById(userId) {
    return users.find(
        user =>
            user.id === userId
    );
}

function getUserByUsername(username) {

    const value =
        normalizeUsername(username);

    return users.find(
        user =>
            normalizeUsername(
                user.username
            ) === value
    );
}

function getUserByCode(code) {

    const value =
        String(code || "")
            .trim()
            .toUpperCase();

    return users.find(
        user =>
            String(user.code || "")
                .toUpperCase() ===
            value
    );
}

function getUserByIdentifier(identifier) {

    const value =
        cleanText(identifier, 100);

    return (
        getUserByUsername(value) ||
        getUserByCode(value) ||
        users.find(
            user =>
                String(user.id) === value
        )
    );
}

function saveUsers() {
    return writeJSON(
        USERS_FILE,
        users
    );
}

function saveChats() {
    return writeJSON(
        CHATS_FILE,
        chats
    );
}

function saveMessages() {
    return writeJSON(
        MESSAGES_FILE,
        messages
    );
}

function saveSessions() {
    return writeJSON(
        SESSIONS_FILE,
        sessions
    );
}

/* =========================================================
   SESSION
========================================================= */

function createSession(userId) {

    const token =
        createToken();

    sessions.push({
        token,
        userId,
        createdAt: now()
    });

    saveSessions();

    return token;
}

function getUserFromToken(token) {

    if (!token) {
        return null;
    }

    const session =
        sessions.find(
            item =>
                item.token === token
        );

    if (!session) {
        return null;
    }

    return getUserById(
        session.userId
    );
}

function tokenFromRequest(req) {

    const header =
        req.headers.authorization ||
        "";

    if (
        header.toLowerCase()
            .startsWith("bearer ")
    ) {
        return header.slice(7).trim();
    }

    return (
        req.body?.token ||
        req.query?.token ||
        ""
    );
}

/* =========================================================
   CHAT HELPERS
========================================================= */

function isMember(chat, userId) {

    return Array.isArray(
        chat.members
    ) &&
        chat.members.includes(
            userId
        );
}

function isBlocked(userA, userB) {

    if (!userA || !userB) {
        return false;
    }

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

function chatDisplayName(chat, currentUserId) {

    if (chat.type === "group") {
        return chat.name || "Grup";
    }

    const otherId =
        chat.members.find(
            memberId =>
                memberId !==
                currentUserId
        );

    const other =
        getUserById(otherId);

    return (
        other?.displayName ||
        other?.name ||
        "Kullanıcı"
    );
}

function publicChat(chat, currentUserId) {

    const lastMessage =
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
            )[0];

    return {
        id: chat.id,
        type: chat.type,
        name:
            chatDisplayName(
                chat,
                currentUserId
            ),
        members:
            chat.members || [],
        createdAt:
            chat.createdAt,
        updatedAt:
            chat.updatedAt ||
            chat.createdAt,
        lastMessage:
            lastMessage
                ? {
                    id:
                        lastMessage.id,
                    text:
                        lastMessage.text,
                    senderId:
                        lastMessage.senderId,
                    sender:
                        publicUser(
                            getUserById(
                                lastMessage.senderId
                            )
                        ),
                    createdAt:
                        lastMessage.createdAt,
                    edited:
                        !!lastMessage.edited
                }
                : null
    };
}

function getUserChats(userId) {

    return chats
        .filter(
            chat =>
                isMember(
                    chat,
                    userId
                )
        )
        .sort(
            (a, b) =>
                new Date(
                    b.updatedAt ||
                    b.createdAt
                ) -
                new Date(
                    a.updatedAt ||
                    a.createdAt
                )
        )
        .map(
            chat =>
                publicChat(
                    chat,
                    userId
                )
        );
}

function findPrivateChat(userA, userB) {

    return chats.find(
        chat =>
            chat.type === "private" &&
            chat.members.length === 2 &&
            chat.members.includes(userA) &&
            chat.members.includes(userB)
    );
}

/* =========================================================
   ONLINE USERS
========================================================= */

const onlineUsers =
    new Map();

/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success: true,
            status: "ok",
            app: "MesajX",
            time: now()
        });
    }
);

app.get(
    "/api/status",
    (req, res) => {

        res.json({
            success: true,
            users: users.length,
            chats: chats.length,
            messages: messages.length,
            online:
                onlineUsers.size,
            uptime:
                process.uptime()
        });
    }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
    "/api/register",
    (req, res) => {

        try {

            const name =
                cleanText(
                    req.body.name ||
                    req.body.displayName ||
                    req.body.fullName,
                    80
                );

            const username =
                normalizeUsername(
                    req.body.username ||
                    req.body.userName ||
                    req.body.identifier
                );

            const pin =
                String(
                    req.body.pin ||
                    req.body.password ||
                    req.body.passcode ||
                    ""
                );

            if (!name) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Ad alanı gerekli."
                });
            }

            if (
                username.length < 3
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Kullanıcı adı en az 3 karakter olmalı."
                });
            }

            if (
                pin.length < 4
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "PIN en az 4 karakter olmalı."
                });
            }

            if (
                getUserByUsername(
                    username
                )
            ) {

                return res.status(409).json({
                    success: false,
                    error:
                        "Bu kullanıcı adı zaten kullanılıyor."
                });
            }

            const user = {
                id:
                    id("usr_"),
                name,
                displayName:
                    name,
                username,
                code:
                    createUserCode(),
                bio:
                    "",
                avatar:
                    "",
                pinHash:
                    hashPin(pin),
                blockedUsers:
                    [],
                createdAt:
                    now()
            };

            users.push(user);

            if (!saveUsers()) {

                return res.status(500).json({
                    success: false,
                    error:
                        "Kullanıcı kaydedilemedi."
                });
            }

            const token =
                createSession(
                    user.id
                );

            return res.status(201).json({
                success: true,
                token,
                sessionToken:
                    token,
                user:
                    publicUser(user),
                code:
                    user.code
            });

        } catch (error) {

            console.error(
                "REGISTER:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Sunucu hatası."
            });
        }
    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/api/login",
    (req, res) => {

        try {

            const identifier =
                cleanText(
                    req.body.identifier ||
                    req.body.username ||
                    req.body.userName ||
                    req.body.code ||
                    req.body.userCode ||
                    req.body.login,
                    100
                );

            const pin =
                String(
                    req.body.pin ||
                    req.body.password ||
                    req.body.passcode ||
                    ""
                );

            const user =
                getUserByIdentifier(
                    identifier
                );

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
                createSession(
                    user.id
                );

            return res.json({
                success: true,
                token,
                sessionToken:
                    token,
                user:
                    publicUser(user),
                code:
                    user.code
            });

        } catch (error) {

            console.error(
                "LOGIN:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Sunucu hatası."
            });
        }
    }
);

/* =========================================================
   ME
========================================================= */

app.get(
    "/api/me",
    (req, res) => {

        const token =
            tokenFromRequest(req);

        const user =
            getUserFromToken(
                token
            );

        if (!user) {

            return res.status(401).json({
                success: false,
                error:
                    "Oturum geçersiz."
            });
        }

        return res.json({
            success: true,
            user:
                publicUser(user)
        });
    }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
    "/api/logout",
    (req, res) => {

        const token =
            tokenFromRequest(req);

        sessions =
            sessions.filter(
                item =>
                    item.token !==
                    token
            );

        saveSessions();

        res.json({
            success: true
        });
    }
);

/* =========================================================
   USER SEARCH HTTP
========================================================= */

app.get(
    "/api/users/search",
    (req, res) => {

        const q =
            cleanText(
                req.query.q,
                100
            ).toLowerCase();

        if (!q) {

            return res.json({
                success: true,
                users: []
            });
        }

        const result =
            users
                .filter(
                    user => {

                        const name =
                            String(
                                user.displayName ||
                                user.name ||
                                ""
                            ).toLowerCase();

                        const username =
                            String(
                                user.username ||
                                ""
                            ).toLowerCase();

                        const code =
                            String(
                                user.code ||
                                ""
                            ).toLowerCase();

                        return (
                            name.includes(q) ||
                            username.includes(q) ||
                            code.includes(q)
                        );
                    }
                )
                .slice(0, 20)
                .map(publicUser);

        res.json({
            success: true,
            users: result
        });
    }
);

/* =========================================================
   SOCKET AUTH
========================================================= */

io.on(
    "connection",
    socket => {

        let currentUser = null;

        socket.on(
            "authenticate",
            (
                data,
                callback
            ) => {

                const token =
                    data?.token ||
                    data?.sessionToken ||
                    data?.authToken;

                const user =
                    getUserFromToken(
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

                currentUser =
                    user;

                onlineUsers.set(
                    user.id,
                    socket.id
                );

                const result = {
                    success: true,
                    user:
                        publicUser(user)
                };

                if (
                    typeof callback ===
                    "function"
                ) {
                    callback(result);
                }

                socket.emit(
                    "auth_ok",
                    result
                );

                socket.emit(
                    "authenticated",
                    result
                );

                console.log(
                    "ONLINE:",
                    user.username
                );
            }
        );

        /* ============================================
           GET CHATS
        ============================================ */

        socket.on(
            "get_chats",
            callback => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                callback?.({
                    success: true,
                    chats:
                        getUserChats(
                            currentUser.id
                        )
                });
            }
        );

        /* ============================================
           SEARCH USERS
        ============================================ */

        socket.on(
            "search_users",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const q =
                    cleanText(
                        data?.q,
                        100
                    ).toLowerCase();

                if (!q) {

                    return callback?.({
                        success: true,
                        users: []
                    });
                }

                const found =
                    users
                        .filter(
                            user =>
                                user.id !==
                                currentUser.id
                        )
                        .filter(
                            user => {

                                const name =
                                    String(
                                        user.displayName ||
                                        user.name ||
                                        ""
                                    ).toLowerCase();

                                const username =
                                    String(
                                        user.username ||
                                        ""
                                    ).toLowerCase();

                                const code =
                                    String(
                                        user.code ||
                                        ""
                                    ).toLowerCase();

                                return (
                                    name.includes(q) ||
                                    username.includes(q) ||
                                    code.includes(q)
                                );
                            }
                        )
                        .slice(0, 20)
                        .map(publicUser);

                callback?.({
                    success: true,
                    users: found
                });
            }
        );

        /* ============================================
           CREATE CHAT
        ============================================ */

        socket.on(
            "create_chat",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const type =
                    data?.type === "group"
                        ? "group"
                        : "private";

                if (
                    type ===
                    "private"
                ) {

                    const target =
                        getUserById(
                            data?.userId
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
                        currentUser.id
                    ) {

                        return callback?.({
                            success: false,
                            error:
                                "Kendinle sohbet oluşturamazsın."
                        });
                    }

                    if (
                        isBlocked(
                            currentUser,
                            target
                        )
                    ) {

                        return callback?.({
                            success: false,
                            error:
                                "Bu kullanıcıyla sohbet oluşturulamıyor."
                        });
                    }

                    let chat =
                        findPrivateChat(
                            currentUser.id,
                            target.id
                        );

                    if (!chat) {

                        chat = {
                            id:
                                id("chat_"),
                            type:
                                "private",
                            name:
                                "",
                            members: [
                                currentUser.id,
                                target.id
                            ],
                            createdAt:
                                now(),
                            updatedAt:
                                now()
                        };

                        chats.push(chat);

                        saveChats();

                        const publicVersion =
                            publicChat(
                                chat,
                                currentUser.id
                            );

                        callback?.({
                            success: true,
                            chat:
                                publicVersion
                        });

                        emitToUser(
                            target.id,
                            "chat_created",
                            {
                                chat:
                                    publicChat(
                                        chat,
                                        target.id
                                    )
                            }
                        );

                        emitToUser(
                            target.id,
                            "new_chat",
                            {
                                chat:
                                    publicChat(
                                        chat,
                                        target.id
                                    )
                            }
                        );

                        return;
                    }

                    callback?.({
                        success: true,
                        chat:
                            publicChat(
                                chat,
                                currentUser.id
                            )
                    });

                    return;
                }

                /* GROUP */

                let memberIds =
                    Array.isArray(
                        data?.memberIds
                    )
                        ? data.memberIds
                        : [];

                memberIds =
                    [
                        currentUser.id,
                        ...memberIds
                    ];

                memberIds =
                    [...new Set(
                        memberIds
                    )]
                    .filter(
                        memberId =>
                            !!getUserById(
                                memberId
                            )
                    );

                if (
                    memberIds.length < 2
                ) {

                    return callback?.({
                        success: false,
                        error:
                            "Grup için en az iki kişi gerekli."
                    });
                }

                const groupName =
                    cleanText(
                        data?.name ||
                        "Yeni Grup",
                        80
                    );

                const chat = {
                    id:
                        id("chat_"),
                    type:
                        "group",
                    name:
                        groupName,
                    members:
                        memberIds,
                    createdAt:
                        now(),
                    updatedAt:
                        now()
                };

                chats.push(chat);
                saveChats();

                callback?.({
                    success: true,
                    chat:
                        publicChat(
                            chat,
                            currentUser.id
                        )
                });

                for (
                    const memberId
                    of memberIds
                ) {

                    if (
                        memberId ===
                        currentUser.id
                    ) {
                        continue;
                    }

                    emitToUser(
                        memberId,
                        "chat_created",
                        {
                            chat:
                                publicChat(
                                    chat,
                                    memberId
                                )
                        }
                    );

                    emitToUser(
                        memberId,
                        "new_chat",
                        {
                            chat:
                                publicChat(
                                    chat,
                                    memberId
                                )
                        }
                    );
                }
            }
        );

        /* ============================================
           GET MESSAGES
        ============================================ */

        socket.on(
            "get_messages",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const chat =
                    chats.find(
                        item =>
                            item.id ===
                            data?.chatId
                    );

                if (
                    !chat ||
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success: false,
                        error:
                            "Bu sohbete erişimin yok."
                    });
                }

                const list =
                    messages
                        .filter(
                            message =>
                                message.chatId ===
                                chat.id
                        )
                        .sort(
                            (a, b) =>
                                new Date(a.createdAt) -
                                new Date(b.createdAt)
                        )
                        .slice(-500)
                        .map(
                            message => ({
                                ...message,
                                sender:
                                    publicUser(
                                        getUserById(
                                            message.senderId
                                        )
                                    )
                            })
                        );

                callback?.({
                    success: true,
                    messages:
                        list
                });
            }
        );

        /* ============================================
           SEND MESSAGE
        ============================================ */

        socket.on(
            "send_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const chat =
                    chats.find(
                        item =>
                            item.id ===
                            data?.chatId
                    );

                if (
                    !chat ||
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success: false,
                        error:
                            "Bu sohbete erişimin yok."
                    });
                }

                const text =
                    cleanText(
                        data?.text,
                        5000
                    );

                if (!text) {

                    return callback?.({
                        success: false,
                        error:
                            "Boş mesaj gönderilemez."
                    });
                }

                for (
                    const memberId
                    of chat.members
                ) {

                    if (
                        memberId ===
                        currentUser.id
                    ) {
                        continue;
                    }

                    const target =
                        getUserById(
                            memberId
                        );

                    if (
                        isBlocked(
                            currentUser,
                            target
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
                    id:
                        id("msg_"),
                    chatId:
                        chat.id,
                    senderId:
                        currentUser.id,
                    text,
                    createdAt:
                        now(),
                    edited:
                        false
                };

                messages.push(
                    message
                );

                chat.updatedAt =
                    message.createdAt;

                saveMessages();
                saveChats();

                const outgoing = {
                    ...message,
                    sender:
                        publicUser(
                            currentUser
                        )
                };

                callback?.({
                    success: true,
                    message:
                        outgoing
                });

                emitToChat(
                    chat,
                    "new_message",
                    {
                        message:
                            outgoing
                    }
                );

                emitToChat(
                    chat,
                    "message",
                    {
                        message:
                            outgoing
                    }
                );
            }
        );

        /* ============================================
           EDIT MESSAGE
        ============================================ */

        socket.on(
            "edit_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const message =
                    messages.find(
                        item =>
                            item.id ===
                            data?.messageId
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
                    currentUser.id
                ) {

                    return callback?.({
                        success: false,
                        error:
                            "Bu mesajı düzenleyemezsin."
                    });
                }

                const text =
                    cleanText(
                        data?.text,
                        5000
                    );

                if (!text) {

                    return callback?.({
                        success: false,
                        error:
                            "Mesaj boş olamaz."
                    });
                }

                message.text =
                    text;

                message.edited =
                    true;

                message.editedAt =
                    now();

                saveMessages();

                const chat =
                    chats.find(
                        item =>
                            item.id ===
                            message.chatId
                    );

                callback?.({
                    success: true,
                    message
                });

                if (chat) {

                    emitToChat(
                        chat,
                        "message_edited",
                        {
                            message: {
                                ...message,
                                sender:
                                    publicUser(
                                        currentUser
                                    )
                            }
                        }
                    );

                    emitToChat(
                        chat,
                        "message_updated",
                        {
                            message: {
                                ...message,
                                sender:
                                    publicUser(
                                        currentUser
                                    )
                            }
                        }
                    );
                }
            }
        );

        /* ============================================
           DELETE MESSAGE
        ============================================ */

        socket.on(
            "delete_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const index =
                    messages.findIndex(
                        item =>
                            item.id ===
                            data?.messageId
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
                    currentUser.id
                ) {

                    return callback?.({
                        success: false,
                        error:
                            "Bu mesajı silemezsin."
                    });
                }

                const chatId =
                    message.chatId;

                messages.splice(
                    index,
                    1
                );

                saveMessages();

                callback?.({
                    success: true
                });

                const chat =
                    chats.find(
                        item =>
                            item.id ===
                            chatId
                    );

                if (chat) {

                    emitToChat(
                        chat,
                        "message_deleted",
                        {
                            messageId:
                                message.id,
                            chatId
                        }
                    );

                    emitToChat(
                        chat,
                        "message_removed",
                        {
                            messageId:
                                message.id,
                            chatId
                        }
                    );
                }
            }
        );

        /* ============================================
           REACTION
        ============================================ */

        socket.on(
            "react_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const message =
                    messages.find(
                        item =>
                            item.id ===
                            data?.messageId
                    );

                if (!message) {

                    return callback?.({
                        success: false,
                        error:
                            "Mesaj bulunamadı."
                    });
                }

                const emoji =
                    cleanText(
                        data?.emoji,
                        8
                    );

                if (!emoji) {

                    return callback?.({
                        success: false,
                        error:
                            "Tepki gerekli."
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
                        message.reactions[
                            emoji
                        ]
                    )
                ) {
                    message.reactions[
                        emoji
                    ] = [];
                }

                const list =
                    message.reactions[
                        emoji
                    ];

                const existing =
                    list.indexOf(
                        currentUser.id
                    );

                if (
                    existing >= 0
                ) {

                    list.splice(
                        existing,
                        1
                    );

                } else {

                    list.push(
                        currentUser.id
                    );
                }

                saveMessages();

                const chat =
                    chats.find(
                        item =>
                            item.id ===
                            message.chatId
                    );

                callback?.({
                    success: true,
                    reactions:
                        message.reactions
                });

                if (chat) {

                    emitToChat(
                        chat,
                        "message_reaction",
                        {
                            messageId:
                                message.id,
                            reactions:
                                message.reactions
                        }
                    );

                    emitToChat(
                        chat,
                        "message_reacted",
                        {
                            messageId:
                                message.id,
                            reactions:
                                message.reactions
                        }
                    );
                }
            }
        );

        /* ============================================
           TYPING
        ============================================ */

        socket.on(
            "typing",
            data => {

                if (!currentUser) {
                    return;
                }

                const chat =
                    chats.find(
                        item =>
                            item.id ===
                            data?.chatId
                    );

                if (
                    !chat ||
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {
                    return;
                }

                for (
                    const memberId
                    of chat.members
                ) {

                    if (
                        memberId ===
                        currentUser.id
                    ) {
                        continue;
                    }

                    emitToUser(
                        memberId,
                        "typing",
                        {
                            chatId:
                                chat.id,
                            userId:
                                currentUser.id,
                            user:
                                publicUser(
                                    currentUser
                                ),
                            typing:
                                !!data?.typing
                        }
                    );
                }
            }
        );

        /* ============================================
           BLOCK USER
        ============================================ */

        socket.on(
            "block_user",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                let target =
                    null;

                if (data?.userId) {

                    target =
                        getUserById(
                            data.userId
                        );

                } else if (
                    data?.code ||
                    data?.userCode
                ) {

                    target =
                        getUserByCode(
                            data.code ||
                            data.userCode
                        );

                } else if (
                    data?.username
                ) {

                    target =
                        getUserByUsername(
                            data.username
                        );
                }

                if (!target) {

                    return callback?.({
                        success: false,
                        error:
                            "Kullanıcı bulunamadı."
                    });
                }

                if (
                    target.id ===
                    currentUser.id
                ) {

                    return callback?.({
                        success: false,
                        error:
                            "Kendini engelleyemezsin."
                    });
                }

                if (
                    !Array.isArray(
                        currentUser.blockedUsers
                    )
                ) {
                    currentUser.blockedUsers =
                        [];
                }

                const blocked =
                    data?.blocked !== false;

                if (blocked) {

                    if (
                        !currentUser.blockedUsers.includes(
                            target.id
                        )
                    ) {

                        currentUser.blockedUsers.push(
                            target.id
                        );
                    }

                } else {

                    currentUser.blockedUsers =
                        currentUser.blockedUsers.filter(
                            id =>
                                id !==
                                target.id
                        );
                }

                saveUsers();

                callback?.({
                    success: true,
                    blocked
                });
            }
        );

        /* ============================================
           UPDATE PROFILE
        ============================================ */

        socket.on(
            "update_profile",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({
                        success: false,
                        error:
                            "Yetkilendirme gerekli."
                    });
                }

                const displayName =
                    cleanText(
                        data?.displayName ||
                        data?.name,
                        80
                    );

                const bio =
                    cleanText(
                        data?.bio,
                        300
                    );

                const avatar =
                    cleanText(
                        data?.avatar,
                        500
                    );

                if (displayName) {

                    currentUser.displayName =
                        displayName;

                    currentUser.name =
                        displayName;
                }

                currentUser.bio =
                    bio;

                currentUser.avatar =
                    avatar;

                saveUsers();

                callback?.({
                    success: true,
                    user:
                        publicUser(
                            currentUser
                        )
                });
            }
        );

        /* ============================================
           DISCONNECT
        ============================================ */

        socket.on(
            "disconnect",
            () => {

                if (
                    currentUser &&
                    onlineUsers.get(
                        currentUser.id
                    ) === socket.id
                ) {

                    onlineUsers.delete(
                        currentUser.id
                    );
                }

                console.log(
                    "OFFLINE:",
                    currentUser?.username ||
                    "unknown"
                );
            }
        );
    }
);

/* =========================================================
   SOCKET HELPERS
========================================================= */

function emitToUser(
    userId,
    event,
    payload
) {

    const socketId =
        onlineUsers.get(
            userId
        );

    if (!socketId) {
        return;
    }

    io.to(socketId).emit(
        event,
        payload
    );
}

function emitToChat(
    chat,
    event,
    payload
) {

    if (!chat) {
        return;
    }

    for (
        const memberId
        of chat.members || []
    ) {

        emitToUser(
            memberId,
            event,
            payload
        );
    }
}

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
    express.static(
        ROOT,
        {
            index:
                "index.html"
        }
    )
);

app.get(
    "*",
    (req, res, next) => {

        if (
            req.path.startsWith(
                "/api/"
            )
        ) {
            return next();
        }

        res.sendFile(
            path.join(
                ROOT,
                "index.html"
            )
        );
    }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

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
                "Sunucu tarafında bir hata oluştu."
        });
    }
);

/* =========================================================
   START
========================================================= */

server.listen(
    PORT,
    HOST,
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "       MESAJX SERVER AKTIF"
        );
        console.log(
            "========================================"
        );
        console.log(
            "PORT:",
            PORT
        );
        console.log(
            "HOST:",
            HOST
        );
        console.log(
            "USERS:",
            users.length
        );
        console.log(
            "CHATS:",
            chats.length
        );
        console.log(
            "MESSAGES:",
            messages.length
        );
        console.log(
            "========================================"
        );
        console.log("");
    }
);
