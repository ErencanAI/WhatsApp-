const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const FILES = {
    users: path.join(DATA_DIR, "users.json"),
    chats: path.join(DATA_DIR, "chats.json"),
    messages: path.join(DATA_DIR, "messages.json"),
    sessions: path.join(DATA_DIR, "sessions.json"),
    blocks: path.join(DATA_DIR, "blocks.json")
};

function ensureFile(file, fallback = []) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(fallback, null, 2)
        );
    }
}

Object.values(FILES).forEach(file => ensureFile(file));

function read(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return [];
    }
}

function write(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2)
    );
}

let users = read(FILES.users);
let chats = read(FILES.chats);
let messages = read(FILES.messages);
let sessions = read(FILES.sessions);
let blocks = read(FILES.blocks);

function id() {
    return crypto.randomUUID();
}

function hash(value) {
    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex");
}

function generateUserCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {

        code = "TRK-";

        for (let i = 0; i < 6; i++) {
            code += chars[
                Math.floor(
                    Math.random() * chars.length
                )
            ];
        }

    } while (
        users.some(user => user.code === code)
    );

    return code;
}

function saveAll() {

    write(FILES.users, users);
    write(FILES.chats, chats);
    write(FILES.messages, messages);
    write(FILES.sessions, sessions);
    write(FILES.blocks, blocks);
}

function publicUser(user) {

    if (!user) return null;

    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        code: user.code,
        bio: user.bio || "",
        online: !!user.online,
        lastSeen: user.lastSeen || null
    };
}

function getUserById(userId) {
    return users.find(
        user => String(user.id) === String(userId)
    );
}

function getUserByCode(code) {

    return users.find(
        user =>
            String(user.code).toUpperCase() ===
            String(code).toUpperCase()
    );
}

function getUserFromToken(token) {

    const session = sessions.find(
        item => item.token === token
    );

    if (!session) return null;

    return getUserById(session.userId);
}

function areBlocked(a, b) {

    return blocks.some(
        block =>
            (
                String(block.userId) === String(a) &&
                String(block.blockedUserId) === String(b)
            ) ||
            (
                String(block.userId) === String(b) &&
                String(block.blockedUserId) === String(a)
            )
    );
}

function chatHasUser(chat, userId) {

    return chat.members.some(
        member =>
            String(member) === String(userId)
    );
}

function getChat(chatId) {

    return chats.find(
        chat => String(chat.id) === String(chatId)
    );
}

function createPrivateChat(userA, userB) {

    const existing = chats.find(chat => {

        if (chat.type !== "private") {
            return false;
        }

        return (
            chat.members.length === 2 &&
            chatHasUser(chat, userA.id) &&
            chatHasUser(chat, userB.id)
        );

    });

    if (existing) {
        return existing;
    }

    const chat = {

        id: id(),

        type: "private",

        members: [
            userA.id,
            userB.id
        ],

        createdBy: userA.id,

        createdAt: Date.now()

    };

    chats.push(chat);

    saveAll();

    return chat;
}

function createGroup(owner, name, memberIds) {

    const members = [
        owner.id,
        ...memberIds
    ];

    const uniqueMembers =
        [...new Set(
            members.map(String)
        )];

    const chat = {

        id: id(),

        type: "group",

        name,

        members: uniqueMembers,

        createdBy: owner.id,

        createdAt: Date.now()

    };

    chats.push(chat);

    saveAll();

    return chat;
}

function chatForUser(chat, userId) {

    if (!chatHasUser(chat, userId)) {
        return null;
    }

    if (chat.type === "group") {

        return {
            ...chat,
            members: chat.members.map(
                memberId => {

                    const user =
                        getUserById(memberId);

                    return publicUser(user);
                }
            )
        };
    }

    const otherId =
        chat.members.find(
            member =>
                String(member) !==
                String(userId)
        );

    const other =
        getUserById(otherId);

    return {
        ...chat,
        otherUser: publicUser(other)
    };
}


/* =========================
   AUTH
========================= */

app.post("/api/register", (req, res) => {

    const username =
        String(req.body.username || "")
            .trim();

    const pin =
        String(req.body.pin || "");

    if (username.length < 3) {
        return res.status(400).json({
            error: "Kullanıcı adı en az 3 karakter olmalı."
        });
    }

    if (pin.length < 4) {
        return res.status(400).json({
            error: "PIN en az 4 karakter olmalı."
        });
    }

    const exists =
        users.some(
            user =>
                user.username.toLowerCase() ===
                username.toLowerCase()
        );

    if (exists) {
        return res.status(409).json({
            error: "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    const user = {

        id: id(),

        username,

        displayName: username,

        pinHash: hash(pin),

        code: generateUserCode(),

        bio: "",

        createdAt: Date.now(),

        online: false,

        lastSeen: Date.now()

    };

    users.push(user);

    const token = id();

    sessions.push({
        token,
        userId: user.id,
        createdAt: Date.now()
    });

    saveAll();

    res.json({
        success: true,
        token,
        user: publicUser(user)
    });

});


app.post("/api/login", (req, res) => {

    const username =
        String(req.body.username || "")
            .trim();

    const pin =
        String(req.body.pin || "");

    const user =
        users.find(
            item =>
                item.username.toLowerCase() ===
                username.toLowerCase()
        );

    if (
        !user ||
        user.pinHash !== hash(pin)
    ) {

        return res.status(401).json({
            error: "Kullanıcı adı veya PIN hatalı."
        });

    }

    const token = id();

    sessions.push({
        token,
        userId: user.id,
        createdAt: Date.now()
    });

    user.online = true;
    user.lastSeen = Date.now();

    saveAll();

    res.json({
        success: true,
        token,
        user: publicUser(user)
    });

});


/* =========================
   STATUS
========================= */

app.get("/api/status", (req, res) => {

    res.json({
        ok: true,
        service: "MesajX",
        users: users.length,
        chats: chats.length,
        messages: messages.length,
        time: Date.now()
    });

});


/* =========================
   SOCKET AUTH
========================= */

const socketUsers = new Map();

io.on("connection", socket => {

    socket.on("authenticate", (data, callback) => {

        const token = data?.token;

        const user =
            getUserFromToken(token);

        if (!user) {

            if (typeof callback === "function") {
                callback({
                    success: false,
                    error: "Oturum geçersiz."
                });
            }

            return;
        }

        socketUsers.set(
            socket.id,
            user.id
        );

        user.online = true;
        user.lastSeen = Date.now();

        socket.userId = user.id;

        saveAll();

        if (typeof callback === "function") {
            callback({
                success: true,
                user: publicUser(user)
            });
        }

    });


    function currentUser() {

        if (!socket.userId) {
            return null;
        }

        return getUserById(socket.userId);
    }


    /* =========================
       KİŞİ ARAMA
    ========================= */

    socket.on("search_users", (data, callback) => {

        const me = currentUser();

        if (!me) {
            return callback?.({
                error: "Oturum yok."
            });
        }

        const code =
            String(data?.code || "")
                .trim()
                .toUpperCase();

        if (!code) {
            return callback?.({
                error: "Kod gerekli."
            });
        }

        const user =
            getUserByCode(code);

        if (!user || user.id === me.id) {

            return callback?.({
                user: null
            });

        }

        callback?.({
            user: publicUser(user)
        });

    });


    /* =========================
       SOHBET OLUŞTUR
    ========================= */

    socket.on("create_chat", (data, callback) => {

        const me = currentUser();

        if (!me) {
            return callback?.({
                success: false,
                error: "Oturum yok."
            });
        }


        /* ÖZEL SOHBET */

        if (data?.type === "private") {

            let target = null;

            if (data.memberCode) {
                target =
                    getUserByCode(
                        data.memberCode
                    );
            }

            if (!target && data.members?.length) {

                target =
                    getUserById(
                        data.members[0]
                    );
            }

            if (!target) {

                return callback?.({
                    success: false,
                    error: "Kişi bulunamadı."
                });

            }

            if (target.id === me.id) {

                return callback?.({
                    success: false,
                    error: "Kendinle sohbet oluşturamazsın."
                });

            }

            if (
                areBlocked(
                    me.id,
                    target.id
                )
            ) {

                return callback?.({
                    success: false,
                    error: "Bu kişiyle iletişim engellenmiş."
                });

            }

            const chat =
                createPrivateChat(
                    me,
                    target
                );

            callback?.({
                success: true,
                chat: chatForUser(
                    chat,
                    me.id
                )
            });

            return;
        }


        /* GRUP */

        if (data?.type === "group") {

            const codes =
                Array.isArray(data.memberCodes)
                ? data.memberCodes
                : [];

            const memberIds = [];

            for (const code of codes) {

                const user =
                    getUserByCode(code);

                if (
                    user &&
                    user.id !== me.id
                ) {

                    memberIds.push(user.id);

                }

            }

            const group =
                createGroup(
                    me,
                    String(data.name || "Yeni Grup")
                        .trim()
                        .slice(0,60),
                    memberIds
                );

            callback?.({
                success: true,
                chat: chatForUser(
                    group,
                    me.id
                )
            });

        }

    });


    /* =========================
       SOHBETLERİ GETİR
    ========================= */

    socket.on("get_chats", (data, callback) => {

        const me = currentUser();

        if (!me) {
            return callback?.({
                chats: []
            });
        }

        const result =
            chats
                .filter(
                    chat =>
                        chatHasUser(
                            chat,
                            me.id
                        )
                )
                .map(
                    chat =>
                        chatForUser(
                            chat,
                            me.id
                        )
                );

        callback?.({
            chats: result
        });

    });


    /* =========================
       MESAJ GEÇMİŞİ
    ========================= */

    socket.on("get_messages", (data, callback) => {

        const me = currentUser();

        if (!me) {
            return callback?.({
                messages: []
            });
        }

        const chat =
            getChat(data?.chatId);

        if (!chat) {
            return callback?.({
                messages: []
            });
        }


        /*
          EN ÖNEMLİ GÜVENLİK:
          Kullanıcı sohbet üyesi değilse
          geçmiş mesajları ASLA alamaz.
        */

        if (!chatHasUser(chat, me.id)) {

            return callback?.({
                messages: []
            });

        }


        const result =
            messages.filter(
                message =>
                    String(message.chatId) ===
                    String(chat.id)
            );

        callback?.({
            messages: result
        });

    });


    /* =========================
       MESAJ GÖNDER
    ========================= */

    socket.on("send_message", (data, callback) => {

        const me = currentUser();

        if (!me) {
            return callback?.({
                success: false,
                error: "Oturum yok."
            });
        }

        const chat =
            getChat(data?.chatId);

        if (!chat) {

            return callback?.({
                success: false,
                error: "Sohbet bulunamadı."
            });

        }


        /*
          BURASI SİSTEMİN ANA GÜVENLİK KURALI.

          Mesaj sadece sohbet üyesinden gelebilir.
        */

        if (!chatHasUser(chat, me.id)) {

            return callback?.({
                success: false,
                error: "Bu sohbete mesaj gönderemezsin."
            });

        }


        const text =
            String(data?.text || "")
                .trim();

        if (
            !text &&
            !data.attachments?.length
        ) {

            return callback?.({
                success: false,
                error: "Boş mesaj gönderilemez."
            });

        }


        /*
          Özel sohbetse karşı tarafla blok kontrolü.
        */

        if (chat.type === "private") {

            const otherId =
                chat.members.find(
                    member =>
                        String(member) !==
                        String(me.id)
                );

            if (
                otherId &&
                areBlocked(
                    me.id,
                    otherId
                )
            ) {

                return callback?.({
                    success: false,
                    error: "Bu kişiyle iletişim engellenmiş."
                });

            }

        }


        const message = {

            id: id(),

            chatId: chat.id,

            senderId: me.id,

            text,

            attachments:
                Array.isArray(data.attachments)
                ? data.attachments
                : [],

            reactions: {},

            createdAt: Date.now(),

            edited: false

        };


        messages.push(message);

        saveAll();


        /*
          SADECE CHAT ÜYELERİNE GÖNDER.
          Herkese gönderilmez.
        */

        chat.members.forEach(memberId => {

            for (
                const [socketId, userId]
                of socketUsers.entries()
            ) {

                if (
                    String(userId) ===
                    String(memberId)
                ) {

                    io.to(socketId)
                        .emit(
                            "new_message",
                            message
                        );

                }

            }

        });


        callback?.({
            success: true,
            message
        });

    });


    /* =========================
       MESAJ TEPKİSİ
    ========================= */

    socket.on("react_message", (data, callback) => {

        const me = currentUser();

        if (!me) return;

        const chat =
            getChat(data?.chatId);

        if (
            !chat ||
            !chatHasUser(
                chat,
                me.id
            )
        ) return;

        const message =
            messages.find(
                item =>
                    item.id ===
                    data.messageId &&
                    item.chatId === chat.id
            );

        if (!message) return;

        const emoji =
            String(data.emoji || "")
                .slice(0,10);

        if (!emoji) return;

        if (!message.reactions) {
            message.reactions = {};
        }

        message.reactions[emoji] =
            (message.reactions[emoji] || 0) + 1;

        saveAll();

        chat.members.forEach(memberId => {

            for (
                const [socketId, userId]
                of socketUsers.entries()
            ) {

                if (
                    String(userId) ===
                    String(memberId)
                ) {

                    io.to(socketId).emit(
                        "new_message",
                        {
                            ...message
                        }
                    );

                }

            }

        });

        callback?.({
            success: true
        });

    });


    /* =========================
       MESAJ DÜZENLE
    ========================= */

    socket.on("edit_message", (data, callback) => {

        const me = currentUser();

        if (!me) return;

        const message =
            messages.find(
                item =>
                    item.id ===
                    data.messageId
            );

        if (!message) return;

        if (
            String(message.senderId) !==
            String(me.id)
        ) return;

        const chat =
            getChat(message.chatId);

        if (
            !chat ||
            !chatHasUser(chat, me.id)
        ) return;

        message.text =
            String(data.text || "")
                .trim();

        message.edited = true;
        message.editedAt = Date.now();

        saveAll();

        chat.members.forEach(memberId => {

            for (
                const [socketId, userId]
                of socketUsers.entries()
            ) {

                if (
                    String(userId) ===
                    String(memberId)
                ) {

                    io.to(socketId).emit(
                        "new_message",
                        message
                    );

                }

            }

        });

        callback?.({
            success: true
        });

    });


    /* =========================
       MESAJ SİL
    ========================= */

    socket.on("delete_message", (data, callback) => {

        const me = currentUser();

        if (!me) return;

        const index =
            messages.findIndex(
                item =>
                    item.id ===
                    data.messageId
            );

        if (index === -1) return;

        const message =
            messages[index];

        if (
            String(message.senderId) !==
            String(me.id)
        ) return;

        const chat =
            getChat(message.chatId);

        if (
            !chat ||
            !chatHasUser(chat, me.id)
        ) return;

        messages.splice(index,1);

        saveAll();


        chat.members.forEach(memberId => {

            for (
                const [socketId, userId]
                of socketUsers.entries()
            ) {

                if (
                    String(userId) ===
                    String(memberId)
                ) {

                    io.to(socketId).emit(
                        "message_deleted",
                        {
                            chatId:chat.id,
                            messageId:message.id
                        }
                    );

                }

            }

        });

        callback?.({
            success:true
        });

    });


    /* =========================
       TYPING
    ========================= */

    socket.on("typing", data => {

        const me = currentUser();

        if (!me) return;

        const chat =
            getChat(data?.chatId);

        if (
            !chat ||
            !chatHasUser(
                chat,
                me.id
            )
        ) return;


        chat.members.forEach(memberId => {

            if (
                String(memberId) ===
                String(me.id)
            ) return;

            for (
                const [socketId, userId]
                of socketUsers.entries()
            ) {

                if (
                    String(userId) ===
                    String(memberId)
                ) {

                    io.to(socketId).emit(
                        "typing",
                        {
                            chatId:chat.id,
                            userId:me.id,
                            typing:!!data.typing
                        }
                    );

                }

            }

        });

    });


    /* =========================
       ENGELLEME
    ========================= */

    socket.on("block_user", (data, callback) => {

        const me = currentUser();

        if (!me) return;

        const target =
            getUserById(data?.userId);

        if (!target) return;


        const exists =
            blocks.some(
                block =>
                    String(block.userId) ===
                    String(me.id) &&
                    String(block.blockedUserId) ===
                    String(target.id)
            );

        if (!exists) {

            blocks.push({

                id:id(),

                userId:me.id,

                blockedUserId:target.id,

                createdAt:Date.now()

            });

        }

        saveAll();

        callback?.({
            success:true
        });

    });


    /* =========================
       ENGEL KALDIR
    ========================= */

    socket.on("unblock_user", (data, callback) => {

        const me = currentUser();

        if (!me) return;

        blocks =
            blocks.filter(
                block =>
                    !(
                        String(block.userId) ===
                        String(me.id) &&
                        String(block.blockedUserId) ===
                        String(data?.userId)
                    )
            );

        saveAll();

        callback?.({
            success:true
        });

    });


    /* =========================
       ÇIKIŞ / BAĞLANTI KESİLME
    ========================= */

    socket.on("disconnect", () => {

        const userId =
            socketUsers.get(socket.id);

        socketUsers.delete(socket.id);

        if (!userId) return;

        const stillOnline =
            [...socketUsers.values()]
                .some(
                    id =>
                        String(id) ===
                        String(userId)
                );

        const user =
            getUserById(userId);

        if (user && !stillOnline) {

            user.online = false;
            user.lastSeen = Date.now();

            saveAll();

        }

    });

});


/* =========================
   ERROR
========================= */

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({
        error:"Sunucu hatası."
    });

});


/* =========================
   START
========================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log("================================");
        console.log("       MESAJX SERVER");
        console.log("================================");
        console.log(
            "Port:",
            PORT
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
        console.log("================================");
        console.log("");

    }
);
