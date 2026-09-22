require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

/* =========================================================
   CONFIG
========================================================= */

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "20mb"
}));

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/* =========================================================
   DATABASE
========================================================= */

const FILES = {
    users: path.join(DATA_DIR, "users.json"),
    chats: path.join(DATA_DIR, "chats.json"),
    messages: path.join(DATA_DIR, "messages.json"),
    sessions: path.join(DATA_DIR, "sessions.json")
};

function ensureFile(file, fallback = []) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(fallback, null, 2),
            "utf8"
        );
    }
}

ensureFile(FILES.users);
ensureFile(FILES.chats);
ensureFile(FILES.messages);
ensureFile(FILES.sessions);

function readJSON(file, fallback = []) {
    try {
        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
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

let users = readJSON(FILES.users);
let chats = readJSON(FILES.chats);
let messages = readJSON(FILES.messages);
let sessions = readJSON(FILES.sessions);

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

function normalizeUsername(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function cleanText(value, max = 10000) {
    return String(value || "")
        .trim()
        .slice(0, max);
}

function hashPIN(pin) {
    return crypto
        .createHash("sha256")
        .update(String(pin))
        .digest("hex");
}

function generateCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {

        let part = "";

        for (let i = 0; i < 6; i++) {
            part += chars[
                crypto.randomInt(0, chars.length)
            ];
        }

        code = "TRK-" + part;

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
        username: user.username,
        name: user.name,
        displayName:
            user.displayName ||
            user.name ||
            user.username,
        code: user.code,
        bio: user.bio || "",
        createdAt: user.createdAt
    };
}

function getUserById(userId) {
    return users.find(
        user =>
            String(user.id) ===
            String(userId)
    );
}

function getUserByUsername(username) {

    const normalized =
        normalizeUsername(username);

    return users.find(
        user =>
            normalizeUsername(
                user.username
            ) === normalized
    );
}

function getUserByCode(code) {

    const normalized =
        String(code || "")
            .trim()
            .toUpperCase();

    return users.find(
        user =>
            String(user.code || "")
                .toUpperCase() === normalized
    );
}

function getTokenFromRequest(req) {

    const header =
        req.headers.authorization || "";

    if (
        header.startsWith("Bearer ")
    ) {
        return header.slice(7).trim();
    }

    return (
        req.query.token ||
        req.body?.token ||
        ""
    );
}

function getUserFromToken(token) {

    if (!token) return null;

    const session =
        sessions.find(
            s => s.token === token
        );

    if (!session) return null;

    return getUserById(
        session.userId
    );
}

function createSession(userId) {

    const token =
        crypto.randomBytes(32).toString("hex");

    sessions.push({
        token,
        userId,
        createdAt: now()
    });

    writeJSON(
        FILES.sessions,
        sessions
    );

    return token;
}

function removeSession(token) {

    sessions =
        sessions.filter(
            s => s.token !== token
        );

    writeJSON(
        FILES.sessions,
        sessions
    );
}

function areBlocked(userA, userB) {

    if (!userA || !userB) {
        return false;
    }

    const a =
        userA.blockedUsers || [];

    const b =
        userB.blockedUsers || [];

    return (
        a.includes(userB.id) ||
        b.includes(userA.id)
    );
}

/* =========================================================
   CHAT HELPERS
========================================================= */

function getChatById(chatId) {

    return chats.find(
        chat =>
            String(chat.id) ===
            String(chatId)
    );
}

function isMember(chat, userId) {

    if (!chat) return false;

    return (
        chat.members || []
    ).some(
        memberId =>
            String(memberId) ===
            String(userId)
    );
}

function getPrivateChat(userA, userB) {

    return chats.find(chat => {

        if (chat.type !== "private") {
            return false;
        }

        if (
            chat.members?.length !== 2
        ) {
            return false;
        }

        return (
            chat.members.includes(userA.id) &&
            chat.members.includes(userB.id)
        );

    });
}

function createPrivateChat(userA, userB) {

    const existing =
        getPrivateChat(
            userA,
            userB
        );

    if (existing) {
        return existing;
    }

    const chat = {
        id: id("chat_"),
        type: "private",
        members: [
            userA.id,
            userB.id
        ],
        createdBy: userA.id,
        createdAt: now(),
        updatedAt: now()
    };

    chats.push(chat);

    writeJSON(
        FILES.chats,
        chats
    );

    return chat;
}

function createGroupChat(
    creator,
    name,
    memberIds
) {

    const uniqueMembers = [
        ...new Set([
            creator.id,
            ...memberIds
        ])
    ];

    const chat = {
        id: id("chat_"),
        type: "group",
        name:
            cleanText(name, 80) ||
            "Yeni Grup",
        members: uniqueMembers,
        createdBy: creator.id,
        createdAt: now(),
        updatedAt: now()
    };

    chats.push(chat);

    writeJSON(
        FILES.chats,
        chats
    );

    return chat;
}

function lastMessage(chatId) {

    const list =
        messages.filter(
            message =>
                message.chatId === chatId
        );

    if (!list.length) {
        return null;
    }

    return list[list.length - 1];
}

function chatForUser(chat, userId) {

    if (!chat) return null;

    const result = {
        id: chat.id,
        type: chat.type,
        name: chat.name || null,
        members: chat.members || [],
        createdBy: chat.createdBy,
        createdAt: chat.createdAt,
        updatedAt:
            chat.updatedAt ||
            chat.createdAt,
        lastMessage:
            lastMessage(chat.id)
    };

    if (chat.type === "private") {

        const otherId =
            chat.members.find(
                id =>
                    String(id) !==
                    String(userId)
            );

        const otherUser =
            getUserById(otherId);

        result.otherUser =
            publicUser(otherUser);

    }

    return result;
}

function chatsForUser(userId) {

    return chats
        .filter(
            chat =>
                isMember(
                    chat,
                    userId
                )
        )
        .map(
            chat =>
                chatForUser(
                    chat,
                    userId
                )
        )
        .sort(
            (a, b) =>
                new Date(b.updatedAt) -
                new Date(a.updatedAt)
        );
}

/* =========================================================
   SOCKET USERS
========================================================= */

const onlineUsers = new Map();

function addOnline(userId, socketId) {

    if (!onlineUsers.has(userId)) {
        onlineUsers.set(
            userId,
            new Set()
        );
    }

    onlineUsers
        .get(userId)
        .add(socketId);
}

function removeOnline(userId, socketId) {

    const sockets =
        onlineUsers.get(userId);

    if (!sockets) return;

    sockets.delete(socketId);

    if (!sockets.size) {
        onlineUsers.delete(userId);
    }
}

function isOnline(userId) {

    return onlineUsers.has(userId);
}

function sendToChatMembers(
    chat,
    event,
    payload
) {

    if (!chat) return;

    for (const memberId of chat.members) {

        const sockets =
            onlineUsers.get(
                memberId
            );

        if (!sockets) continue;

        for (const socketId of sockets) {

            io.to(socketId).emit(
                event,
                payload
            );

        }

    }

}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireAuth(req, res, next) {

    const token =
        getTokenFromRequest(req);

    const user =
        getUserFromToken(token);

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

/* =========================================================
   BASIC ROUTES
========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({
            success: true,
            app: "MesajX",
            status: "online",
            users: users.length,
            chats: chats.length,
            messages: messages.length,
            time: now()
        });

    }
);

app.get(
    "/api/me",
    requireAuth,
    (req, res) => {

        res.json({
            success: true,
            user: publicUser(req.user)
        });

    }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
    "/api/register",
    (req, res) => {

        const name =
            cleanText(
                req.body.name ||
                req.body.displayName,
                80
            );

        const username =
            cleanText(
                req.body.username,
                40
            );

        const pin =
            String(
                req.body.pin || ""
            ).trim();

        if (!name) {

            return res.status(400).json({
                success: false,
                error: "Ad gerekli."
            });

        }

        if (!username) {

            return res.status(400).json({
                success: false,
                error: "Kullanıcı adı gerekli."
            });

        }

        if (!pin) {

            return res.status(400).json({
                success: false,
                error: "PIN gerekli."
            });

        }

        if (pin.length < 4) {

            return res.status(400).json({
                success: false,
                error:
                    "PIN en az 4 karakter olmalı."
            });

        }

        if (
            !/^[a-zA-Z0-9_.-]+$/.test(
                username
            )
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "Kullanıcı adında yalnızca harf, rakam, _, . ve - kullanılabilir."
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
                    "Bu kullanıcı adı zaten alınmış."
            });

        }

        const user = {

            id: id("user_"),

            username,

            name,

            displayName: name,

            code: generateCode(),

            bio: "",

            pinHash:
                hashPIN(pin),

            blockedUsers: [],

            createdAt: now()

        };

        users.push(user);

        writeJSON(
            FILES.users,
            users
        );

        const token =
            createSession(user.id);

        res.json({

            success: true,

            token,

            user:
                publicUser(user)

        });

    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/api/login",
    (req, res) => {

        const username =
            cleanText(
                req.body.username,
                40
            );

        const pin =
            String(
                req.body.pin || ""
            ).trim();

        if (!username) {

            return res.status(400).json({
                success: false,
                error:
                    "Kullanıcı adı gerekli."
            });

        }

        if (!pin) {

            return res.status(400).json({
                success: false,
                error:
                    "PIN gerekli."
            });

        }

        const user =
            getUserByUsername(
                username
            );

        if (!user) {

            return res.status(401).json({
                success: false,
                error:
                    "Kullanıcı adı veya PIN hatalı."
            });

        }

        if (
            user.pinHash !==
            hashPIN(pin)
        ) {

            return res.status(401).json({
                success: false,
                error:
                    "Kullanıcı adı veya PIN hatalı."
            });

        }

        const token =
            createSession(user.id);

        res.json({

            success: true,

            token,

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
    requireAuth,
    (req, res) => {

        removeSession(
            req.token
        );

        res.json({
            success: true
        });

    }
);

/* =========================================================
   SEARCH USERS
========================================================= */

app.get(
    "/api/users/search",
    requireAuth,
    (req, res) => {

        const query =
            cleanText(
                req.query.q,
                80
            ).toLowerCase();

        if (!query) {

            return res.json({
                success: true,
                users: []
            });

        }

        const result =
            users
                .filter(
                    user =>
                        user.id !==
                        req.user.id
                )
                .filter(user => {

                    const username =
                        String(
                            user.username ||
                            ""
                        ).toLowerCase();

                    const name =
                        String(
                            user.displayName ||
                            user.name ||
                            ""
                        ).toLowerCase();

                    const code =
                        String(
                            user.code ||
                            ""
                        ).toLowerCase();

                    return (
                        username.includes(query) ||
                        name.includes(query) ||
                        code.includes(query)
                    );

                })
                .slice(0, 20)
                .map(publicUser);

        res.json({
            success: true,
            users: result
        });

    }
);

/* =========================================================
   SOCKET
========================================================= */

io.on(
    "connection",
    socket => {

        let currentUser = null;

        /* ---------------------------------------------
           AUTHENTICATE
        --------------------------------------------- */

        socket.on(
            "authenticate",
            data => {

                const token =
                    data?.token;

                const user =
                    getUserFromToken(
                        token
                    );

                if (!user) {

                    socket.emit(
                        "auth_error",
                        {
                            error:
                                "Oturum geçersiz."
                        }
                    );

                    return;
                }

                currentUser = user;

                socket.userId =
                    user.id;

                addOnline(
                    user.id,
                    socket.id
                );

                socket.emit(
                    "auth_ok",
                    {
                        user:
                            publicUser(user)
                    }
                );

                /* Presence */

                for (
                    const [userId, sockets]
                    of onlineUsers
                ) {

                    if (
                        String(userId) ===
                        String(user.id)
                    ) {
                        continue;
                    }

                    for (
                        const socketId
                        of sockets
                    ) {

                        io.to(socketId).emit(
                            "presence",
                            {
                                userId:
                                    user.id,
                                online:true
                            }
                        );

                    }

                }

            }
        );

        /* ---------------------------------------------
           GET CHATS
        --------------------------------------------- */

        socket.on(
            "get_chats",
            (_, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false,
                        error:
                            "Oturum gerekli."
                    });

                }

                callback?.({
                    success:true,
                    chats:
                        chatsForUser(
                            currentUser.id
                        )
                });

            }
        );

        /* ---------------------------------------------
           SEARCH USERS
        --------------------------------------------- */

        socket.on(
            "search_users",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false,
                        error:
                            "Oturum gerekli."
                    });

                }

                const query =
                    cleanText(
                        data?.query,
                        80
                    ).toLowerCase();

                const result =
                    users
                        .filter(
                            user =>
                                user.id !==
                                currentUser.id
                        )
                        .filter(user => {

                            const code =
                                String(
                                    user.code ||
                                    ""
                                ).toLowerCase();

                            const username =
                                String(
                                    user.username ||
                                    ""
                                ).toLowerCase();

                            const name =
                                String(
                                    user.displayName ||
                                    user.name ||
                                    ""
                                ).toLowerCase();

                            return (
                                code === query ||
                                code.includes(query) ||
                                username.includes(query) ||
                                name.includes(query)
                            );

                        })
                        .slice(0, 20)
                        .map(publicUser);

                callback?.({
                    success:true,
                    users:result
                });

            }
        );

        /* ---------------------------------------------
           CREATE CHAT
        --------------------------------------------- */

        socket.on(
            "create_chat",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false,
                        error:
                            "Oturum gerekli."
                    });

                }

                const type =
                    data?.type;

                /* PRIVATE */

                if (type === "private") {

                    const targetId =
                        data?.userId;

                    const target =
                        getUserById(
                            targetId
                        );

                    if (!target) {

                        return callback?.({
                            success:false,
                            error:
                                "Kullanıcı bulunamadı."
                        });

                    }

                    if (
                        target.id ===
                        currentUser.id
                    ) {

                        return callback?.({
                            success:false,
                            error:
                                "Kendinle sohbet oluşturamazsın."
                        });

                    }

                    if (
                        areBlocked(
                            currentUser,
                            target
                        )
                    ) {

                        return callback?.({
                            success:false,
                            error:
                                "Bu kullanıcıyla iletişim kurulamaz."
                        });

                    }

                    const chat =
                        createPrivateChat(
                            currentUser,
                            target
                        );

                    callback?.({
                        success:true,
                        chat:
                            chatForUser(
                                chat,
                                currentUser.id
                            )
                    });

                    return;
                }

                /* GROUP */

                if (type === "group") {

                    const name =
                        cleanText(
                            data?.name,
                            80
                        );

                    if (!name) {

                        return callback?.({
                            success:false,
                            error:
                                "Grup adı gerekli."
                        });

                    }

                    let memberIds = [];

                    const codes =
                        Array.isArray(
                            data?.memberCodes
                        )
                            ? data.memberCodes
                            : [];

                    for (
                        const code
                        of codes
                    ) {

                        const user =
                            getUserByCode(code);

                        if (
                            user &&
                            user.id !==
                            currentUser.id
                        ) {

                            if (
                                !areBlocked(
                                    currentUser,
                                    user
                                )
                            ) {

                                memberIds.push(
                                    user.id
                                );

                            }

                        }

                    }

                    if (!memberIds.length) {

                        return callback?.({
                            success:false,
                            error:
                                "En az bir geçerli üye kodu gerekli."
                        });

                    }

                    const chat =
                        createGroupChat(
                            currentUser,
                            name,
                            memberIds
                        );

                    callback?.({
                        success:true,
                        chat:
                            chatForUser(
                                chat,
                                currentUser.id
                            )
                    });

                    sendToChatMembers(
                        chat,
                        "chat_created",
                        {
                            chat:
                                chatForUser(
                                    chat,
                                    currentUser.id
                                )
                        }
                    );

                    return;
                }

                callback?.({
                    success:false,
                    error:
                        "Geçersiz sohbet türü."
                });

            }
        );

        /* ---------------------------------------------
           GET MESSAGES
        --------------------------------------------- */

        socket.on(
            "get_messages",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false,
                        error:
                            "Oturum gerekli."
                    });

                }

                const chat =
                    getChatById(
                        data?.chatId
                    );

                if (!chat) {

                    return callback?.({
                        success:false,
                        error:
                            "Sohbet bulunamadı."
                    });

                }

                if (
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Bu sohbete erişimin yok."
                    });

                }

                const result =
                    messages.filter(
                        message =>
                            message.chatId ===
                            chat.id
                    );

                callback?.({
                    success:true,
                    messages:result
                });

            }
        );

        /* ---------------------------------------------
           SEND MESSAGE
        --------------------------------------------- */

        socket.on(
            "send_message",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false,
                        error:
                            "Oturum gerekli."
                    });

                }

                const chat =
                    getChatById(
                        data?.chatId
                    );

                if (!chat) {

                    return callback?.({
                        success:false,
                        error:
                            "Sohbet bulunamadı."
                    });

                }

                /*
                   EN ÖNEMLİ KONTROL:

                   Kullanıcı bu sohbetin üyesi değilse
                   mesaj gönderemez.
                */

                if (
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Bu sohbete mesaj gönderme yetkin yok."
                    });

                }

                if (
                    chat.type === "private"
                ) {

                    const otherId =
                        chat.members.find(
                            memberId =>
                                String(memberId) !==
                                String(currentUser.id)
                        );

                    const other =
                        getUserById(
                            otherId
                        );

                    if (
                        areBlocked(
                            currentUser,
                            other
                        )
                    ) {

                        return callback?.({
                            success:false,
                            error:
                                "Bu kullanıcıyla iletişim engellenmiş."
                        });

                    }

                }

                const text =
                    cleanText(
                        data?.text,
                        10000
                    );

                const attachments =
                    Array.isArray(
                        data?.attachments
                    )
                        ? data.attachments
                        : [];

                if (
                    !text &&
                    !attachments.length
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Mesaj boş olamaz."
                    });

                }

                const message = {

                    id:
                        id("msg_"),

                    chatId:
                        chat.id,

                    senderId:
                        currentUser.id,

                    sender:
                        publicUser(
                            currentUser
                        ),

                    text,

                    attachments,

                    createdAt:
                        now(),

                    edited:false,

                    reactions:{}

                };

                messages.push(
                    message
                );

                chat.updatedAt =
                    message.createdAt;

                writeJSON(
                    FILES.messages,
                    messages
                );

                writeJSON(
                    FILES.chats,
                    chats
                );

                /*
                   SADECE O SOHBETİN ÜYELERİNE
                   gönderilir.
                */

                sendToChatMembers(
                    chat,
                    "new_message",
                    message
                );

                callback?.({
                    success:true,
                    message
                });

            }
        );

        /* ---------------------------------------------
           EDIT MESSAGE
        --------------------------------------------- */

        socket.on(
            "edit_message",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false
                    });

                }

                const message =
                    messages.find(
                        m =>
                            m.id ===
                            data?.messageId
                    );

                if (!message) {

                    return callback?.({
                        success:false,
                        error:
                            "Mesaj bulunamadı."
                    });

                }

                if (
                    message.senderId !==
                    currentUser.id
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Bu mesajı düzenleyemezsin."
                    });

                }

                const chat =
                    getChatById(
                        message.chatId
                    );

                if (
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false
                    });

                }

                message.text =
                    cleanText(
                        data?.text,
                        10000
                    );

                message.edited = true;

                writeJSON(
                    FILES.messages,
                    messages
                );

                sendToChatMembers(
                    chat,
                    "message_edited",
                    message
                );

                callback?.({
                    success:true,
                    message
                });

            }
        );

        /* ---------------------------------------------
           DELETE MESSAGE
        --------------------------------------------- */

        socket.on(
            "delete_message",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false
                    });

                }

                const index =
                    messages.findIndex(
                        m =>
                            m.id ===
                            data?.messageId
                    );

                if (index === -1) {

                    return callback?.({
                        success:false,
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
                        success:false,
                        error:
                            "Bu mesajı silemezsin."
                    });

                }

                const chat =
                    getChatById(
                        message.chatId
                    );

                if (
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false
                    });

                }

                messages.splice(
                    index,
                    1
                );

                writeJSON(
                    FILES.messages,
                    messages
                );

                sendToChatMembers(
                    chat,
                    "message_deleted",
                    {
                        messageId:
                            message.id,
                        chatId:
                            chat.id
                    }
                );

                callback?.({
                    success:true
                });

            }
        );

        /* ---------------------------------------------
           REACTION
        --------------------------------------------- */

        socket.on(
            "react_message",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false
                    });

                }

                const message =
                    messages.find(
                        m =>
                            m.id ===
                            data?.messageId
                    );

                if (!message) {

                    return callback?.({
                        success:false,
                        error:
                            "Mesaj bulunamadı."
                    });

                }

                const chat =
                    getChatById(
                        message.chatId
                    );

                if (
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Bu mesaja erişimin yok."
                    });

                }

                const reaction =
                    cleanText(
                        data?.reaction,
                        10
                    );

                if (!reaction) {

                    return callback?.({
                        success:false
                    });

                }

                if (!message.reactions) {
                    message.reactions = {};
                }

                if (
                    !Array.isArray(
                        message.reactions[
                            reaction
                        ]
                    )
                ) {

                    message.reactions[
                        reaction
                    ] = [];

                }

                const list =
                    message.reactions[
                        reaction
                    ];

                const existing =
                    list.indexOf(
                        currentUser.id
                    );

                if (existing >= 0) {

                    list.splice(
                        existing,
                        1
                    );

                } else {

                    list.push(
                        currentUser.id
                    );

                }

                writeJSON(
                    FILES.messages,
                    messages
                );

                sendToChatMembers(
                    chat,
                    "message_reaction",
                    message
                );

                callback?.({
                    success:true,
                    message
                });

            }
        );

        /* ---------------------------------------------
           TYPING
        --------------------------------------------- */

        socket.on(
            "typing",
            data => {

                if (!currentUser) return;

                const chat =
                    getChatById(
                        data?.chatId
                    );

                if (!chat) return;

                if (
                    !isMember(
                        chat,
                        currentUser.id
                    )
                ) {
                    return;
                }

                sendToChatMembers(
                    chat,
                    "typing",
                    {
                        chatId:
                            chat.id,
                        userId:
                            currentUser.id,
                        typing:
                            Boolean(
                                data?.typing
                            )
                    }
                );

            }
        );

        /* ---------------------------------------------
           BLOCK / UNBLOCK
        --------------------------------------------- */

        socket.on(
            "block_user",
            (data, callback) => {

                if (!currentUser) {

                    return callback?.({
                        success:false
                    });

                }

                const target =
                    getUserById(
                        data?.userId
                    );

                if (!target) {

                    return callback?.({
                        success:false,
                        error:
                            "Kullanıcı bulunamadı."
                    });

                }

                if (!Array.isArray(
                    currentUser.blockedUsers
                )) {

                    currentUser.blockedUsers =
                        [];

                }

                const shouldBlock =
                    data?.blocked !== false;

                const exists =
                    currentUser.blockedUsers
                        .includes(
                            target.id
                        );

                if (
                    shouldBlock &&
                    !exists
                ) {

                    currentUser.blockedUsers
                        .push(
                            target.id
                        );

                }

                if (
                    !shouldBlock &&
                    exists
                ) {

                    currentUser.blockedUsers =
                        currentUser
                            .blockedUsers
                            .filter(
                                x =>
                                    x !==
                                    target.id
                            );

                }

                writeJSON(
                    FILES.users,
                    users
                );

                callback?.({
                    success:true,
                    blocked:
                        shouldBlock
                });

            }
        );

        /* ---------------------------------------------
           DISCONNECT
        --------------------------------------------- */

        socket.on(
            "disconnect",
            () => {

                if (!currentUser) {
                    return;
                }

                removeOnline(
                    currentUser.id,
                    socket.id
                );

                const stillOnline =
                    isOnline(
                        currentUser.id
                    );

                if (!stillOnline) {

                    for (
                        const [userId, sockets]
                        of onlineUsers
                    ) {

                        for (
                            const socketId
                            of sockets
                        ) {

                            io.to(socketId).emit(
                                "presence",
                                {
                                    userId:
                                        currentUser.id,
                                    online:false
                                }
                            );

                        }

                    }

                }

            }
        );

    }
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
    express.static(
        __dirname
    )
);

app.get(
    "*",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (err, req, res, next) => {

        console.error(
            "SERVER ERROR:",
            err
        );

        res.status(500).json({
            success:false,
            error:
                "Sunucu hatası."
        });

    }
);

/* =========================================================
   START
========================================================= */

httpServer.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "===================================="
        );
        console.log(
            "       MESAJX SERVER ONLINE"
        );
        console.log(
            "===================================="
        );
        console.log(
            `PORT: ${PORT}`
        );
        console.log(
            `USERS: ${users.length}`
        );
        console.log(
            `CHATS: ${chats.length}`
        );
        console.log(
            `MESSAGES: ${messages.length}`
        );
        console.log(
            "===================================="
        );
        console.log("");

    }
);
