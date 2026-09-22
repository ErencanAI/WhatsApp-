const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 20 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;

/* =========================================================
   DOSYA SİSTEMİ / KALICI HAFIZA
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const FILES = {
    users: path.join(DATA_DIR, "users.json"),
    chats: path.join(DATA_DIR, "chats.json"),
    messages: path.join(DATA_DIR, "messages.json"),
    sessions: path.join(DATA_DIR, "sessions.json")
};

function createFile(file, defaultValue = []) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(defaultValue, null, 2),
            "utf8"
        );
    }
}

createFile(FILES.users);
createFile(FILES.chats);
createFile(FILES.messages);
createFile(FILES.sessions);

function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return [];
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
   AKTİF BAĞLANTILAR
========================================================= */

const sockets = new Map();

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "20mb"
}));

app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================================================
   DURUM
========================================================= */

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        service: "Messaging Server",
        version: "2.0.0",
        onlineUsers: sockets.size,
        users: users.length,
        chats: chats.length,
        messages: messages.length,
        serverTime: new Date().toISOString()
    });
});

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function id(prefix = "id") {
    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        crypto.randomBytes(5).toString("hex")
    );
}

function hash(value) {
    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex");
}

function cleanUsername(username) {
    return String(username || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 30);
}

function findUser(userId) {
    return users.find(u => u.id === userId);
}

function findUserByUsername(username) {
    return users.find(
        u => u.username.toLowerCase() === username.toLowerCase()
    );
}

function findChat(chatId) {
    return chats.find(c => c.id === chatId);
}

function saveAll() {
    writeJSON(FILES.users, users);
    writeJSON(FILES.chats, chats);
    writeJSON(FILES.messages, messages);
    writeJSON(FILES.sessions, sessions);
}

function isMember(chat, userId) {
    return chat.members.includes(userId);
}

function emitToUser(userId, event, data) {
    for (const [socketId, session] of sockets) {
        if (session.userId === userId) {
            io.to(socketId).emit(event, data);
        }
    }
}

function emitToChat(chat, event, data) {
    for (const memberId of chat.members) {
        emitToUser(memberId, event, data);
    }
}

/* =========================================================
   HESAP OLUŞTURMA
========================================================= */

app.post("/api/register", (req, res) => {

    const username = cleanUsername(req.body.username);
    const pin = String(req.body.pin || "");

    if (!username) {
        return res.status(400).json({
            ok: false,
            error: "Kullanıcı adı gerekli."
        });
    }

    if (pin.length < 4) {
        return res.status(400).json({
            ok: false,
            error: "PIN en az 4 karakter olmalı."
        });
    }

    if (findUserByUsername(username)) {
        return res.status(409).json({
            ok: false,
            error: "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    const user = {
        id: id("user"),
        username,
        pinHash: hash(pin),
        avatar: null,
        about: "",
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
    };

    users.push(user);

    writeJSON(FILES.users, users);

    res.json({
        ok: true,
        user: publicUser(user)
    });
});

/* =========================================================
   GİRİŞ
========================================================= */

app.post("/api/login", (req, res) => {

    const username = cleanUsername(req.body.username);
    const pin = String(req.body.pin || "");

    const user = findUserByUsername(username);

    if (!user || user.pinHash !== hash(pin)) {
        return res.status(401).json({
            ok: false,
            error: "Kullanıcı adı veya PIN hatalı."
        });
    }

    const token = id("session");

    sessions.push({
        token,
        userId: user.id,
        createdAt: new Date().toISOString()
    });

    user.lastSeen = new Date().toISOString();

    saveAll();

    res.json({
        ok: true,
        token,
        user: publicUser(user)
    });
});

/* =========================================================
   PUBLIC USER
========================================================= */

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        about: user.about,
        createdAt: user.createdAt,
        lastSeen: user.lastSeen,
        online: socketsHasUser(user.id)
    };
}

function socketsHasUser(userId) {
    for (const session of sockets.values()) {
        if (session.userId === userId) {
            return true;
        }
    }

    return false;
}

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", socket => {

    console.log("Socket bağlandı:", socket.id);

    /* -----------------------------------------------------
       OTURUM
    ----------------------------------------------------- */

    socket.on("authenticate", token => {

        const session = sessions.find(
            s => s.token === token
        );

        if (!session) {
            socket.emit("auth_error", {
                error: "Geçersiz oturum."
            });
            return;
        }

        const user = findUser(session.userId);

        if (!user) {
            socket.emit("auth_error", {
                error: "Kullanıcı bulunamadı."
            });
            return;
        }

        sockets.set(socket.id, {
            userId: user.id,
            connectedAt: Date.now()
        });

        socket.userId = user.id;

        user.lastSeen = new Date().toISOString();

        writeJSON(FILES.users, users);

        socket.emit("authenticated", {
            ok: true,
            user: publicUser(user)
        });

        broadcastPresence(user.id);

        console.log(user.username, "online");
    });

    /* -----------------------------------------------------
       MESAJ GÖNDER
    ----------------------------------------------------- */

    socket.on("send_message", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const chat = findChat(data.chatId);

        if (!chat) {
            socket.emit("message_error", {
                error: "Sohbet bulunamadı."
            });
            return;
        }

        if (!isMember(chat, session.userId)) {
            socket.emit("message_error", {
                error: "Bu sohbete erişimin yok."
            });
            return;
        }

        const text = String(data.text || "")
            .trim()
            .slice(0, 10000);

        if (!text && !data.attachment) return;

        const message = {
            id: id("msg"),
            chatId: chat.id,
            senderId: session.userId,
            text,
            attachment: data.attachment || null,
            replyTo: data.replyTo || null,
            reactions: {},
            edited: false,
            deleted: false,
            status: "sent",
            createdAt: new Date().toISOString()
        };

        messages.push(message);

        chat.updatedAt = message.createdAt;
        chat.lastMessageId = message.id;

        saveAll();

        emitToChat(chat, "new_message", message);
    });

    /* -----------------------------------------------------
       MESAJ GEÇMİŞİ
    ----------------------------------------------------- */

    socket.on("get_messages", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const chat = findChat(data.chatId);

        if (!chat) return;

        if (!isMember(chat, session.userId)) return;

        const result = messages
            .filter(m => m.chatId === chat.id)
            .slice(-200);

        socket.emit("message_history", {
            chatId: chat.id,
            messages: result
        });
    });

    /* -----------------------------------------------------
       MESAJ DÜZENLE
    ----------------------------------------------------- */

    socket.on("edit_message", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const message = messages.find(
            m => m.id === data.messageId
        );

        if (!message) return;

        if (message.senderId !== session.userId) return;

        if (message.deleted) return;

        message.text = String(data.text || "")
            .trim()
            .slice(0, 10000);

        message.edited = true;
        message.editedAt = new Date().toISOString();

        saveAll();

        const chat = findChat(message.chatId);

        if (chat) {
            emitToChat(chat, "message_edited", message);
        }
    });

    /* -----------------------------------------------------
       MESAJ SİL
    ----------------------------------------------------- */

    socket.on("delete_message", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const message = messages.find(
            m => m.id === data.messageId
        );

        if (!message) return;

        if (message.senderId !== session.userId) return;

        message.deleted = true;
        message.text = "";
        message.attachment = null;
        message.deletedAt = new Date().toISOString();

        saveAll();

        const chat = findChat(message.chatId);

        if (chat) {
            emitToChat(chat, "message_deleted", {
                messageId: message.id
            });
        }
    });

    /* -----------------------------------------------------
       TEPKİ
    ----------------------------------------------------- */

    socket.on("react_message", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const message = messages.find(
            m => m.id === data.messageId
        );

        if (!message) return;

        const reaction = String(data.reaction || "")
            .slice(0, 10);

        if (!reaction) return;

        if (!message.reactions[reaction]) {
            message.reactions[reaction] = [];
        }

        const list = message.reactions[reaction];

        if (list.includes(session.userId)) {
            message.reactions[reaction] =
                list.filter(id => id !== session.userId);
        } else {
            list.push(session.userId);
        }

        saveAll();

        const chat = findChat(message.chatId);

        if (chat) {
            emitToChat(chat, "message_reaction", {
                messageId: message.id,
                reactions: message.reactions
            });
        }
    });

    /* -----------------------------------------------------
       OKUNDU
    ----------------------------------------------------- */

    socket.on("read_message", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const message = messages.find(
            m => m.id === data.messageId
        );

        if (!message) return;

        if (!message.readBy) {
            message.readBy = [];
        }

        if (!message.readBy.includes(session.userId)) {
            message.readBy.push(session.userId);
        }

        message.status = "read";

        saveAll();

        const chat = findChat(message.chatId);

        if (chat) {
            emitToChat(chat, "message_read", {
                messageId: message.id,
                userId: session.userId
            });
        }
    });

    /* -----------------------------------------------------
       YAZIYOR
    ----------------------------------------------------- */

    socket.on("typing", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const chat = findChat(data.chatId);

        if (!chat) return;

        for (const memberId of chat.members) {
            if (memberId !== session.userId) {
                emitToUser(memberId, "typing", {
                    chatId: chat.id,
                    userId: session.userId
                });
            }
        }
    });

    socket.on("stop_typing", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const chat = findChat(data.chatId);

        if (!chat) return;

        for (const memberId of chat.members) {
            if (memberId !== session.userId) {
                emitToUser(memberId, "stop_typing", {
                    chatId: chat.id,
                    userId: session.userId
                });
            }
        }
    });

    /* -----------------------------------------------------
       SOHBET OLUŞTUR
    ----------------------------------------------------- */

    socket.on("create_chat", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        let memberIds = Array.isArray(data.members)
            ? data.members
            : [];

        memberIds = [
            session.userId,
            ...memberIds
        ];

        memberIds = [...new Set(memberIds)];

        const validMembers = memberIds.filter(
            id => findUser(id)
        );

        const chat = {
            id: id("chat"),
            type: data.type === "group"
                ? "group"
                : "private",

            name: String(data.name || "")
                .trim()
                .slice(0, 80),

            avatar: null,

            ownerId: session.userId,

            members: validMembers,

            admins: [session.userId],

            createdAt: new Date().toISOString(),

            updatedAt: new Date().toISOString(),

            lastMessageId: null,

            settings: {
                disappearingMessages: false,
                notifications: true
            }
        };

        chats.push(chat);

        saveAll();

        emitToChat(chat, "chat_created", chat);
    });

    /* -----------------------------------------------------
       GRUP ÜYESİ EKLE
    ----------------------------------------------------- */

    socket.on("add_group_member", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const chat = findChat(data.chatId);

        if (!chat) return;

        if (chat.type !== "group") return;

        if (!chat.admins.includes(session.userId)) return;

        const user = findUser(data.userId);

        if (!user) return;

        if (!chat.members.includes(user.id)) {
            chat.members.push(user.id);
        }

        saveAll();

        emitToChat(chat, "chat_updated", chat);
    });

    /* -----------------------------------------------------
       GRUP ÜYESİ ÇIKAR
    ----------------------------------------------------- */

    socket.on("remove_group_member", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const chat = findChat(data.chatId);

        if (!chat) return;

        if (!chat.admins.includes(session.userId)) return;

        chat.members = chat.members.filter(
            id => id !== data.userId
        );

        chat.admins = chat.admins.filter(
            id => id !== data.userId
        );

        saveAll();

        emitToChat(chat, "chat_updated", chat);
    });

    /* -----------------------------------------------------
       SOHBETLERİ GETİR
    ----------------------------------------------------- */

    socket.on("get_chats", () => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const result = chats
            .filter(chat =>
                chat.members.includes(session.userId)
            )
            .sort(
                (a, b) =>
                    new Date(b.updatedAt) -
                    new Date(a.updatedAt)
            );

        socket.emit("chat_list", result);
    });

    /* -----------------------------------------------------
       KULLANICI ARAMA
    ----------------------------------------------------- */

    socket.on("search_users", data => {

        const session = sockets.get(socket.id);

        if (!session) return;

        const query = String(data.query || "")
            .toLowerCase()
            .trim();

        const result = users
            .filter(user =>
                user.username
                    .toLowerCase()
                    .includes(query)
            )
            .filter(user =>
                user.id !== session.userId
            )
            .slice(0, 30)
            .map(publicUser);

        socket.emit("user_search_results", result);
    });

    /* -----------------------------------------------------
       PING
    ----------------------------------------------------- */

    socket.on("ping_server", () => {
        socket.emit("pong_server", {
            time: Date.now()
        });
    });

    /* -----------------------------------------------------
       ÇIKIŞ
    ----------------------------------------------------- */

    socket.on("disconnect", () => {

        const session = sockets.get(socket.id);

        if (session) {

            const user = findUser(session.userId);

            if (user) {
                user.lastSeen = new Date().toISOString();
            }

            sockets.delete(socket.id);

            writeJSON(FILES.users, users);

            broadcastPresence(session.userId);
        }

        console.log("Socket kapandı:", socket.id);
    });
});

/* =========================================================
   PRESENCE
========================================================= */

function broadcastPresence(userId) {

    const user = findUser(userId);

    if (!user) return;

    for (const chat of chats) {

        if (chat.members.includes(userId)) {

            emitToChat(chat, "presence", {
                userId,
                online: socketsHasUser(userId),
                lastSeen: user.lastSeen
            });

        }
    }
}

/* =========================================================
   OTOMATİK YEDEKLEME
========================================================= */

setInterval(() => {
    try {
        saveAll();
    } catch (error) {
        console.error(
            "Veri kaydetme hatası:",
            error.message
        );
    }
}, 10000);

/* =========================================================
   SUNUCU
========================================================= */

server.listen(PORT, "0.0.0.0", () => {

    console.log("");
    console.log("==========================================");
    console.log("       MESAJLAŞMA SERVER v2.0");
    console.log("==========================================");
    console.log("Port:", PORT);
    console.log("Kullanıcı:", users.length);
    console.log("Sohbet:", chats.length);
    console.log("Mesaj:", messages.length);
    console.log("Kalıcı hafıza: AKTİF");
    console.log("WebSocket: AKTİF");
    console.log("Gruplar: AKTİF");
    console.log("==========================================");
    console.log("");
});
