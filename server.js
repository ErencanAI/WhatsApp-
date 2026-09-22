require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/* =========================================================
   MESAJX SERVER
   Express 5 + Socket.IO
   ========================================================= */

const APP_NAME = "MesajX";
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true,
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000
});

/* =========================================================
   PATHS
   ========================================================= */

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const DB = {
    users: path.join(DATA_DIR, "users.json"),
    chats: path.join(DATA_DIR, "chats.json"),
    messages: path.join(DATA_DIR, "messages.json"),
    sessions: path.join(DATA_DIR, "sessions.json")
};

/* =========================================================
   STARTUP
   ========================================================= */

function log(...args) {
    console.log(`[${APP_NAME}]`, ...args);
}

function errorLog(...args) {
    console.error(`[${APP_NAME} ERROR]`, ...args);
}

try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, {
            recursive: true
        });
    }
} catch (error) {
    errorLog(
        "data klasörü oluşturulamadı:",
        error.message
    );
}

/* =========================================================
   DATABASE
   ========================================================= */

function ensureJSONFile(file, defaultValue) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(
                    defaultValue,
                    null,
                    2
                ),
                "utf8"
            );
        }
    } catch (error) {
        errorLog(
            "Dosya oluşturulamadı:",
            file,
            error.message
        );
    }
}

function readJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const raw =
            fs.readFileSync(
                file,
                "utf8"
            );

        if (!raw.trim()) {
            return fallback;
        }

        const parsed =
            JSON.parse(raw);

        return parsed;

    } catch (error) {

        errorLog(
            "JSON okunamadı:",
            path.basename(file),
            error.message
        );

        return fallback;
    }
}

function writeJSON(file, data) {
    try {

        fs.writeFileSync(
            file,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

        return true;

    } catch (error) {

        errorLog(
            "JSON yazılamadı:",
            path.basename(file),
            error.message
        );

        return false;
    }
}

for (const file of Object.values(DB)) {
    ensureJSONFile(file, []);
}

let users =
    readJSON(DB.users, []);

let chats =
    readJSON(DB.chats, []);

let messages =
    readJSON(DB.messages, []);

let sessions =
    readJSON(DB.sessions, []);

/* Eski/bozuk veri array değilse düzelt */

if (!Array.isArray(users)) users = [];
if (!Array.isArray(chats)) chats = [];
if (!Array.isArray(messages)) messages = [];
if (!Array.isArray(sessions)) sessions = [];

/* =========================================================
   EXPRESS
   ========================================================= */

app.disable("x-powered-by");

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

/* =========================================================
   HELPERS
   ========================================================= */

function createId(prefix = "") {
    return (
        prefix +
        crypto
            .randomBytes(16)
            .toString("hex")
    );
}

function timestamp() {
    return new Date().toISOString();
}

function clean(value, max = 10000) {
    return String(value ?? "")
        .trim()
        .slice(0, max);
}

function normalize(value) {
    return clean(value, 200)
        .toLowerCase();
}

function hashPIN(pin) {
    return crypto
        .createHash("sha256")
        .update(String(pin))
        .digest("hex");
}

/* =========================================================
   USER CODE
   ========================================================= */

function generateUserCode() {

    const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    for (let attempt = 0; attempt < 100; attempt++) {

        let part = "";

        for (let i = 0; i < 6; i++) {

            part +=
                characters[
                    crypto.randomInt(
                        0,
                        characters.length
                    )
                ];
        }

        const code =
            `TRK-${part}`;

        const exists =
            users.some(
                user =>
                    String(user.code)
                        .toUpperCase() ===
                    code.toUpperCase()
            );

        if (!exists) {
            return code;
        }
    }

    throw new Error(
        "Benzersiz kullanıcı kodu üretilemedi."
    );
}

/* =========================================================
   USER HELPERS
   ========================================================= */

function getUserById(userId) {
    return users.find(
        user =>
            String(user.id) ===
            String(userId)
    ) || null;
}

function getUserByUsername(username) {

    const value =
        normalize(username);

    return users.find(
        user =>
            normalize(
                user.username
            ) === value
    ) || null;
}

function getUserByCode(code) {

    const value =
        clean(code, 50)
            .toUpperCase();

    return users.find(
        user =>
            String(user.code || "")
                .toUpperCase() ===
            value
    ) || null;
}

function publicUser(user) {

    if (!user) {
        return null;
    }

    return {
        id: user.id,
        username: user.username,
        name:
            user.name ||
            user.displayName ||
            user.username,
        displayName:
            user.displayName ||
            user.name ||
            user.username,
        code: user.code,
        bio: user.bio || "",
        avatar: user.avatar || null,
        createdAt: user.createdAt
    };
}

/* =========================================================
   SESSION
   ========================================================= */

function createToken() {

    return crypto
        .randomBytes(48)
        .toString("hex");
}

function createSession(userId) {

    const token =
        createToken();

    sessions.push({
        token,
        userId,
        createdAt: timestamp()
    });

    writeJSON(
        DB.sessions,
        sessions
    );

    return token;
}

function findSession(token) {

    if (!token) {
        return null;
    }

    return sessions.find(
        session =>
            session.token === token
    ) || null;
}

function userFromToken(token) {

    const session =
        findSession(token);

    if (!session) {
        return null;
    }

    return getUserById(
        session.userId
    );
}

function deleteSession(token) {

    sessions =
        sessions.filter(
            session =>
                session.token !== token
        );

    writeJSON(
        DB.sessions,
        sessions
    );
}

/* =========================================================
   BLOCK SYSTEM
   ========================================================= */

function isBlocked(userA, userB) {

    if (!userA || !userB) {
        return false;
    }

    const a =
        Array.isArray(
            userA.blockedUsers
        )
            ? userA.blockedUsers
            : [];

    const b =
        Array.isArray(
            userB.blockedUsers
        )
            ? userB.blockedUsers
            : [];

    return (
        a.includes(userB.id) ||
        b.includes(userA.id)
    );
}

/* =========================================================
   CHAT HELPERS
   ========================================================= */

function getChat(chatId) {

    return chats.find(
        chat =>
            String(chat.id) ===
            String(chatId)
    ) || null;
}

function isChatMember(chat, userId) {

    if (!chat) {
        return false;
    }

    return (
        Array.isArray(chat.members) &&
        chat.members.some(
            id =>
                String(id) ===
                String(userId)
        )
    );
}

function getLastMessage(chatId) {

    for (
        let i = messages.length - 1;
        i >= 0;
        i--
    ) {

        if (
            messages[i].chatId ===
            chatId
        ) {
            return messages[i];
        }
    }

    return null;
}

function getPrivateChat(userA, userB) {

    return chats.find(chat => {

        if (
            chat.type !== "private"
        ) {
            return false;
        }

        if (
            !Array.isArray(
                chat.members
            )
        ) {
            return false;
        }

        if (
            chat.members.length !== 2
        ) {
            return false;
        }

        return (
            chat.members.includes(
                userA.id
            ) &&
            chat.members.includes(
                userB.id
            )
        );

    }) || null;
}

function makePrivateChat(
    userA,
    userB
) {

    const existing =
        getPrivateChat(
            userA,
            userB
        );

    if (existing) {
        return existing;
    }

    const chat = {

        id:
            createId("chat_"),

        type:
            "private",

        members: [
            userA.id,
            userB.id
        ],

        createdBy:
            userA.id,

        createdAt:
            timestamp(),

        updatedAt:
            timestamp()
    };

    chats.push(chat);

    writeJSON(
        DB.chats,
        chats
    );

    return chat;
}

function makeGroupChat(
    creator,
    name,
    memberIds
) {

    const members =
        [
            creator.id,
            ...memberIds
        ];

    const uniqueMembers =
        [...new Set(members)];

    const chat = {

        id:
            createId("chat_"),

        type:
            "group",

        name:
            clean(
                name,
                80
            ) ||
            "Yeni Grup",

        members:
            uniqueMembers,

        createdBy:
            creator.id,

        createdAt:
            timestamp(),

        updatedAt:
            timestamp()
    };

    chats.push(chat);

    writeJSON(
        DB.chats,
        chats
    );

    return chat;
}

function serializeChat(
    chat,
    userId
) {

    if (!chat) {
        return null;
    }

    const result = {

        id:
            chat.id,

        type:
            chat.type,

        name:
            chat.name || null,

        members:
            chat.members || [],

        createdBy:
            chat.createdBy,

        createdAt:
            chat.createdAt,

        updatedAt:
            chat.updatedAt,

        lastMessage:
            getLastMessage(
                chat.id
            )

    };

    if (
        chat.type === "private"
    ) {

        const otherId =
            chat.members.find(
                memberId =>
                    String(memberId) !==
                    String(userId)
            );

        result.otherUser =
            publicUser(
                getUserById(
                    otherId
                )
            );
    }

    return result;
}

function getUserChats(userId) {

    return chats
        .filter(
            chat =>
                isChatMember(
                    chat,
                    userId
                )
        )
        .map(
            chat =>
                serializeChat(
                    chat,
                    userId
                )
        )
        .sort(
            (a, b) =>
                new Date(
                    b.updatedAt
                ) -
                new Date(
                    a.updatedAt
                )
        );
}

/* =========================================================
   SOCKET / ONLINE
   ========================================================= */

const online = new Map();

function addSocket(
    userId,
    socketId
) {

    if (!online.has(userId)) {
        online.set(
            userId,
            new Set()
        );
    }

    online
        .get(userId)
        .add(socketId);
}

function removeSocket(
    userId,
    socketId
) {

    const set =
        online.get(userId);

    if (!set) {
        return;
    }

    set.delete(socketId);

    if (set.size === 0) {
        online.delete(userId);
    }
}

function isOnline(userId) {
    return online.has(userId);
}

function emitToUser(
    userId,
    event,
    payload
) {

    const sockets =
        online.get(userId);

    if (!sockets) {
        return;
    }

    for (
        const socketId of sockets
    ) {

        io.to(socketId)
            .emit(
                event,
                payload
            );
    }
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
   AUTH HTTP
   ========================================================= */

function getRequestToken(req) {

    const auth =
        req.headers.authorization ||
        "";

    if (
        auth
            .toLowerCase()
            .startsWith("bearer ")
    ) {

        return auth
            .slice(7)
            .trim();
    }

    return (
        req.body?.token ||
        req.query?.token ||
        ""
    );
}

function requireAuth(
    req,
    res,
    next
) {

    const token =
        getRequestToken(req);

    const user =
        userFromToken(token);

    if (!user) {

        return res.status(401).json({
            success: false,
            error:
                "Oturum geçersiz veya süresi dolmuş."
        });
    }

    req.user = user;
    req.token = token;

    next();
}

/* =========================================================
   API STATUS
   ========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            success: true,

            app:
                APP_NAME,

            status:
                "online",

            serverTime:
                timestamp(),

            users:
                users.length,

            chats:
                chats.length,

            messages:
                messages.length,

            sockets:
                io.engine.clientsCount

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
                clean(
                    req.body.name ||
                    req.body.displayName,
                    80
                );

            const username =
                clean(
                    req.body.username,
                    40
                );

            const pin =
                String(
                    req.body.pin || ""
                ).trim();

            if (!name) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "Ad gerekli."
                    });
            }

            if (!username) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "Kullanıcı adı gerekli."
                    });
            }

            if (!pin) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "PIN gerekli."
                    });
            }

            if (
                pin.length < 4
            ) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "PIN en az 4 karakter olmalı."
                    });
            }

            if (
                username.length < 3
            ) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "Kullanıcı adı en az 3 karakter olmalı."
                    });
            }

            if (
                !/^[a-zA-Z0-9_.-]+$/
                    .test(username)
            ) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "Kullanıcı adında yalnızca harf, rakam, nokta, alt çizgi ve tire kullanılabilir."
                    });
            }

            if (
                getUserByUsername(
                    username
                )
            ) {

                return res.status(409)
                    .json({
                        success:false,
                        error:
                            "Bu kullanıcı adı zaten alınmış."
                    });
            }

            /*
             * KODU SERVER ÜRETİYOR.
             * Kullanıcının ayrıca kod girmesine gerek yok.
             */

            const code =
                generateUserCode();

            const user = {

                id:
                    createId("user_"),

                username,

                name,

                displayName:
                    name,

                code,

                bio: "",

                avatar: null,

                pinHash:
                    hashPIN(pin),

                blockedUsers: [],

                createdAt:
                    timestamp()
            };

            users.push(user);

            if (
                !writeJSON(
                    DB.users,
                    users
                )
            ) {

                return res.status(500)
                    .json({
                        success:false,
                        error:
                            "Hesap kaydedilemedi."
                    });
            }

            const token =
                createSession(
                    user.id
                );

            log(
                "Yeni kullanıcı:",
                user.username,
                user.code
            );

            return res.status(201)
                .json({

                    success:true,

                    token,

                    user:
                        publicUser(
                            user
                        )

                });

        } catch (error) {

            errorLog(
                "REGISTER:",
                error
            );

            return res.status(500)
                .json({
                    success:false,
                    error:
                        "Hesap oluşturulurken sunucu hatası oluştu."
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
                clean(
                    req.body.username ||
                    req.body.identifier ||
                    "",
                    80
                );

            const pin =
                String(
                    req.body.pin || ""
                ).trim();

            if (!identifier) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "Kullanıcı adı veya TRK kodu gerekli."
                    });
            }

            if (!pin) {

                return res.status(400)
                    .json({
                        success:false,
                        error:
                            "PIN gerekli."
                    });
            }

            let user = null;

            if (
                identifier
                    .toUpperCase()
                    .startsWith("TRK-")
            ) {

                user =
                    getUserByCode(
                        identifier
                    );

            } else {

                user =
                    getUserByUsername(
                        identifier
                    );
            }

            if (!user) {

                return res.status(401)
                    .json({
                        success:false,
                        error:
                            "Kullanıcı bulunamadı."
                    });
            }

            if (
                user.pinHash !==
                hashPIN(pin)
            ) {

                return res.status(401)
                    .json({
                        success:false,
                        error:
                            "PIN hatalı."
                    });
            }

            const token =
                createSession(
                    user.id
                );

            log(
                "Giriş:",
                user.username
            );

            return res.json({

                success:true,

                token,

                user:
                    publicUser(
                        user
                    )

            });

        } catch (error) {

            errorLog(
                "LOGIN:",
                error
            );

            return res.status(500)
                .json({
                    success:false,
                    error:
                        "Giriş sırasında sunucu hatası oluştu."
                });
        }
    }
);

/* =========================================================
   ME
   ========================================================= */

app.get(
    "/api/me",
    requireAuth,
    (req, res) => {

        res.json({

            success:true,

            user:
                publicUser(
                    req.user
                )

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

        deleteSession(
            req.token
        );

        res.json({
            success:true
        });
    }
);

/* =========================================================
   USER SEARCH HTTP
   ========================================================= */

app.get(
    "/api/users/search",
    requireAuth,
    (req, res) => {

        const query =
            normalize(
                req.query.q
            );

        if (!query) {

            return res.json({
                success:true,
                users:[]
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

                    const name =
                        normalize(
                            user.displayName ||
                            user.name
                        );

                    const username =
                        normalize(
                            user.username
                        );

                    const code =
                        normalize(
                            user.code
                        );

                    return (
                        name.includes(query) ||
                        username.includes(query) ||
                        code.includes(query)
                    );
                })
                .slice(0, 20)
                .map(publicUser);

        res.json({
            success:true,
            users:result
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

        log(
            "Socket bağlantısı:",
            socket.id
        );

        /* ---------------------------------------------
           AUTHENTICATE
        --------------------------------------------- */

        socket.on(
            "authenticate",
            (data, callback) => {

                const token =
                    data?.token;

                const user =
                    userFromToken(
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

                    callback?.({
                        success:false,
                        error:
                            "Oturum geçersiz."
                    });

                    return;
                }

                currentUser =
                    user;

                socket.userId =
                    user.id;

                addSocket(
                    user.id,
                    socket.id
                );

                callback?.({
                    success:true,
                    user:
                        publicUser(user)
                });

                socket.emit(
                    "auth_ok",
                    {
                        success:true,
                        user:
                            publicUser(user)
                    }
                );

                log(
                    "Socket doğrulandı:",
                    user.username
                );

                /* Herkese presence */

                for (
                    const [
                        onlineUserId
                    ]
                    of online
                ) {

                    if (
                        String(
                            onlineUserId
                        ) ===
                        String(user.id)
                    ) {
                        continue;
                    }

                    emitToUser(
                        onlineUserId,
                        "presence",
                        {
                            userId:
                                user.id,
                            online:true
                        }
                    );
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
                            "Önce giriş yapmalısın."
                    });
                }

                callback?.({

                    success:true,

                    chats:
                        getUserChats(
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
                    normalize(
                        data?.query
                    );

                if (!query) {

                    return callback?.({
                        success:true,
                        users:[]
                    });
                }

                const result =
                    users
                        .filter(
                            user =>
                                user.id !==
                                currentUser.id
                        )
                        .filter(user => {

                            const code =
                                normalize(
                                    user.code
                                );

                            const username =
                                normalize(
                                    user.username
                                );

                            const name =
                                normalize(
                                    user.displayName ||
                                    user.name
                                );

                            return (
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
           CREATE PRIVATE / GROUP CHAT
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

                if (
                    type === "private"
                ) {

                    let target =
                        null;

                    if (
                        data?.userId
                    ) {

                        target =
                            getUserById(
                                data.userId
                            );
                    }

                    if (
                        !target &&
                        data?.code
                    ) {

                        target =
                            getUserByCode(
                                data.code
                            );
                    }

                    if (
                        !target &&
                        data?.username
                    ) {

                        target =
                            getUserByUsername(
                                data.username
                            );
                    }

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
                                "Kendinle özel sohbet oluşturamazsın."
                        });
                    }

                    if (
                        isBlocked(
                            currentUser,
                            target
                        )
                    ) {

                        return callback?.({
                            success:false,
                            error:
                                "Bu kullanıcıyla iletişim kurulamıyor."
                        });
                    }

                    const chat =
                        makePrivateChat(
                            currentUser,
                            target
                        );

                    callback?.({

                        success:true,

                        chat:
                            serializeChat(
                                chat,
                                currentUser.id
                            )

                    });

                    emitToUser(
                        target.id,
                        "chat_created",
                        {
                            chat:
                                serializeChat(
                                    chat,
                                    target.id
                                )
                        }
                    );

                    return;
                }

                /* GROUP */

                if (
                    type === "group"
                ) {

                    const name =
                        clean(
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

                    if (
                        Array.isArray(
                            data?.memberIds
                        )
                    ) {

                        memberIds =
                            data.memberIds
                                .map(
                                    id =>
                                        getUserById(
                                            id
                                        )
                                )
                                .filter(Boolean)
                                .filter(
                                    user =>
                                        user.id !==
                                        currentUser.id
                                )
                                .filter(
                                    user =>
                                        !isBlocked(
                                            currentUser,
                                            user
                                        )
                                )
                                .map(
                                    user =>
                                        user.id
                                );
                    }

                    if (
                        Array.isArray(
                            data?.memberCodes
                        )
                    ) {

                        for (
                            const code
                            of data.memberCodes
                        ) {

                            const user =
                                getUserByCode(
                                    code
                                );

                            if (
                                user &&
                                user.id !==
                                currentUser.id &&
                                !isBlocked(
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

                    memberIds =
                        [
                            ...new Set(
                                memberIds
                            )
                        ];

                    if (
                        memberIds.length === 0
                    ) {

                        return callback?.({
                            success:false,
                            error:
                                "En az bir geçerli üye gerekli."
                        });
                    }

                    const chat =
                        makeGroupChat(
                            currentUser,
                            name,
                            memberIds
                        );

                    callback?.({

                        success:true,

                        chat:
                            serializeChat(
                                chat,
                                currentUser.id
                            )

                    });

                    for (
                        const memberId
                        of chat.members
                    ) {

                        emitToUser(
                            memberId,
                            "chat_created",
                            {
                                chat:
                                    serializeChat(
                                        chat,
                                        memberId
                                    )
                            }
                        );
                    }

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
                    getChat(
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
                    !isChatMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Bu sohbete erişim yok."
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

                    messages:
                        result

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
                    getChat(
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
                 * KRİTİK GÜVENLİK:
                 * Kullanıcı chat üyesi değilse
                 * mesaj kesinlikle gönderilmez.
                 */

                if (
                    !isChatMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Bu sohbete mesaj gönderemezsin."
                    });
                }

                /* Private block kontrolü */

                if (
                    chat.type === "private"
                ) {

                    const otherId =
                        chat.members.find(
                            id =>
                                String(id) !==
                                String(
                                    currentUser.id
                                )
                        );

                    const otherUser =
                        getUserById(
                            otherId
                        );

                    if (
                        isBlocked(
                            currentUser,
                            otherUser
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
                    clean(
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
                    attachments.length === 0
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Mesaj boş olamaz."
                    });
                }

                const message = {

                    id:
                        createId("msg_"),

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
                        timestamp(),

                    edited:false,

                    reactions:{}

                };

                messages.push(
                    message
                );

                chat.updatedAt =
                    message.createdAt;

                if (
                    !writeJSON(
                        DB.messages,
                        messages
                    )
                ) {

                    return callback?.({
                        success:false,
                        error:
                            "Mesaj kaydedilemedi."
                    });
                }

                writeJSON(
                    DB.chats,
                    chats
                );

                /*
                 * SADECE CHAT ÜYELERİ
                 */

                emitToChat(
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
           EDIT
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
                        item =>
                            item.id ===
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
                            "Bu mesaj sana ait değil."
                    });
                }

                const chat =
                    getChat(
                        message.chatId
                    );

                if (
                    !isChatMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false
                    });
                }

                const newText =
                    clean(
                        data?.text,
                        10000
                    );

                if (!newText) {

                    return callback?.({
                        success:false,
                        error:
                            "Yeni mesaj boş olamaz."
                    });
                }

                message.text =
                    newText;

                message.edited =
                    true;

                writeJSON(
                    DB.messages,
                    messages
                );

                emitToChat(
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
           DELETE
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
                        item =>
                            item.id ===
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
                            "Bu mesaj sana ait değil."
                    });
                }

                const chat =
                    getChat(
                        message.chatId
                    );

                if (
                    !isChatMember(
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
                    DB.messages,
                    messages
                );

                emitToChat(
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
                        item =>
                            item.id ===
                            data?.messageId
                    );

                if (!message) {

                    return callback?.({
                        success:false
                    });
                }

                const chat =
                    getChat(
                        message.chatId
                    );

                if (
                    !isChatMember(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({
                        success:false
                    });
                }

                const reaction =
                    clean(
                        data?.reaction,
                        20
                    );

                if (!reaction) {

                    return callback?.({
                        success:false
                    });
                }

                if (
                    !message.reactions
                ) {
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

                const index =
                    list.indexOf(
                        currentUser.id
                    );

                if (index >= 0) {

                    list.splice(
                        index,
                        1
                    );

                } else {

                    list.push(
                        currentUser.id
                    );
                }

                writeJSON(
                    DB.messages,
                    messages
                );

                emitToChat(
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

                if (!currentUser) {
                    return;
                }

                const chat =
                    getChat(
                        data?.chatId
                    );

                if (!chat) {
                    return;
                }

                if (
                    !isChatMember(
                        chat,
                        currentUser.id
                    )
                ) {
                    return;
                }

                emitToChat(
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
           BLOCK
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

                if (
                    !Array.isArray(
                        currentUser.blockedUsers
                    )
                ) {

                    currentUser.blockedUsers =
                        [];
                }

                const shouldBlock =
                    data?.blocked !== false;

                const index =
                    currentUser.blockedUsers
                        .indexOf(
                            target.id
                        );

                if (
                    shouldBlock &&
                    index === -1
                ) {

                    currentUser.blockedUsers
                        .push(
                            target.id
                        );
                }

                if (
                    !shouldBlock &&
                    index !== -1
                ) {

                    currentUser.blockedUsers
                        .splice(
                            index,
                            1
                        );
                }

                writeJSON(
                    DB.users,
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
            reason => {

                if (currentUser) {

                    removeSocket(
                        currentUser.id,
                        socket.id
                    );

                    if (
                        !isOnline(
                            currentUser.id
                        )
                    ) {

                        for (
                            const [
                                userId
                            ]
                            of online.keys()
                        ) {

                            emitToUser(
                                userId,
                                "presence",
                                {
                                    userId:
                                        currentUser.id,
                                    online:false
                                }
                            );
                        }
                    }

                    log(
                        "Bağlantı kapandı:",
                        currentUser.username,
                        reason
                    );

                } else {

                    log(
                        "Kimlik doğrulanmamış socket kapandı:",
                        socket.id
                    );
                }
            }
        );
    }
);

/* =========================================================
   FRONTEND
   ========================================================= */

const publicDir =
    path.join(
        ROOT,
        "public"
    );

/*
 * Eğer index.html ana klasördeyse onu kullan.
 * Eğer public/index.html varsa onu da destekle.
 */

if (
    fs.existsSync(
        path.join(
            ROOT,
            "index.html"
        )
    )
) {

    app.use(
        express.static(ROOT)
    );

} else if (
    fs.existsSync(
        path.join(
            publicDir,
            "index.html"
        )
    )
) {

    app.use(
        express.static(publicDir)
    );
}

/* =========================================================
   FRONTEND FALLBACK
   EXPRESS 5 UYUMLU
   ========================================================= */

/*
 * Eski:
 *
 * app.get("*", ...)
 *
 * KULLANMIYORUZ.
 *
 * Çünkü Express 5'te wildcard syntax değişti.
 */

app.use(
    (req, res, next) => {

        if (
            req.method !== "GET"
        ) {
            return next();
        }

        if (
            req.path.startsWith("/api/")
        ) {

            return res.status(404)
                .json({
                    success:false,
                    error:
                        "API endpoint bulunamadı."
                });
        }

        if (
            req.path.startsWith("/socket.io/")
        ) {

            return next();
        }

        const rootIndex =
            path.join(
                ROOT,
                "index.html"
            );

        const publicIndex =
            path.join(
                publicDir,
                "index.html"
            );

        if (
            fs.existsSync(
                rootIndex
            )
        ) {

            return res.sendFile(
                rootIndex
            );
        }

        if (
            fs.existsSync(
                publicIndex
            )
        ) {

            return res.sendFile(
                publicIndex
            );
        }

        return res.status(404)
            .send(
                `
                <!doctype html>
                <html lang="tr">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport"
                          content="width=device-width,initial-scale=1">
                    <title>MesajX</title>
                    <style>
                        body{
                            margin:0;
                            min-height:100vh;
                            display:grid;
                            place-items:center;
                            background:#07090f;
                            color:#fff;
                            font-family:Arial,sans-serif;
                        }
                        .box{
                            width:min(420px,90%);
                            padding:30px;
                            border:1px solid #222936;
                            border-radius:24px;
                            background:#0e121a;
                            text-align:center;
                        }
                        h1{
                            margin-top:0;
                        }
                        p{
                            color:#aeb6c7;
                        }
                    </style>
                </head>
                <body>
                    <div class="box">
                        <h1>MesajX</h1>
                        <p>index.html bulunamadı.</p>
                    </div>
                </body>
                </html>
                `
            );
    }
);

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
    (err, req, res, next) => {

        errorLog(
            "Express:",
            err
        );

        if (
            res.headersSent
        ) {
            return next(err);
        }

        res.status(500)
            .json({

                success:false,

                error:
                    "Sunucuda beklenmeyen bir hata oluştu."

            });
    }
);

/* =========================================================
   PROCESS ERROR HANDLERS
   ========================================================= */

process.on(
    "uncaughtException",
    error => {

        errorLog(
            "UNCAUGHT EXCEPTION:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {

        errorLog(
            "UNHANDLED REJECTION:",
            error
        );
    }
);

/* =========================================================
   SERVER START
   ========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "╔══════════════════════════════════════╗"
        );
        console.log(
            "║          MESAJX SERVER              ║"
        );
        console.log(
            "║            ONLINE                    ║"
        );
        console.log(
            "╠══════════════════════════════════════╣"
        );
        console.log(
            `║ PORT     : ${String(PORT).padEnd(23)}║`
        );
        console.log(
            `║ USERS    : ${String(users.length).padEnd(23)}║`
        );
        console.log(
            `║ CHATS    : ${String(chats.length).padEnd(23)}║`
        );
        console.log(
            `║ MESSAGES : ${String(messages.length).padEnd(23)}║`
        );
        console.log(
            "╚══════════════════════════════════════╝"
        );
        console.log("");
        console.log(
            "MesajX bağlantı bekliyor..."
        );
        console.log("");

    }
);

/* =========================================================
   SERVER ERROR
   ========================================================= */

server.on(
    "error",
    error => {

        if (
            error.code ===
            "EADDRINUSE"
        ) {

            errorLog(
                `Port ${PORT} zaten kullanımda.`
            );

        } else {

            errorLog(
                "HTTP SERVER ERROR:",
                error
            );
        }
    }
);
