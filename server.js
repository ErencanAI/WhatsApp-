"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/*
==========================================================
 MESAJX
 REAL-TIME PRIVATE MESSAGING SERVER
==========================================================

 Desteklenen:
 - Register
 - Login
 - TRK kullanıcı kodu
 - Username ile giriş
 - TRK koduyla kullanıcı bulma
 - Private chat
 - Group chat
 - Messages
 - Message history
 - Edit
 - Delete
 - Reactions
 - Typing
 - Presence
 - Block
 - Logout
 - REST API
 - Socket.IO
 - Render
 - Localhost
 - index.html root
 - public/index.html

==========================================================
*/

/* ========================================================
   APP
======================================================== */

const app = express();

const server =
    http.createServer(app);

const io =
    new Server(server, {
        cors: {
            origin: true,
            credentials: true,
            methods: [
                "GET",
                "POST"
            ]
        },

        transports: [
            "websocket",
            "polling"
        ],

        pingInterval: 25000,
        pingTimeout: 20000
    });

const PORT =
    Number(
        process.env.PORT
    ) || 3000;

/* ========================================================
   PATHS
======================================================== */

const ROOT =
    __dirname;

const DATA_DIR =
    path.join(
        ROOT,
        "data"
    );

const PUBLIC_DIR =
    path.join(
        ROOT,
        "public"
    );

const DB = {

    users:
        path.join(
            DATA_DIR,
            "users.json"
        ),

    chats:
        path.join(
            DATA_DIR,
            "chats.json"
        ),

    messages:
        path.join(
            DATA_DIR,
            "messages.json"
        ),

    sessions:
        path.join(
            DATA_DIR,
            "sessions.json"
        )

};

/* ========================================================
   LOG
======================================================== */

function log(...args) {
    console.log(
        "[MESAJX]",
        ...args
    );
}

function logError(...args) {
    console.error(
        "[MESAJX ERROR]",
        ...args
    );
}

/* ========================================================
   DATABASE INIT
======================================================== */

function ensureDirectory() {

    if (
        !fs.existsSync(
            DATA_DIR
        )
    ) {

        fs.mkdirSync(
            DATA_DIR,
            {
                recursive: true
            }
        );
    }
}

function ensureFile(
    file
) {

    if (
        !fs.existsSync(file)
    ) {

        fs.writeFileSync(
            file,
            "[]",
            "utf8"
        );
    }
}

ensureDirectory();

ensureFile(
    DB.users
);

ensureFile(
    DB.chats
);

ensureFile(
    DB.messages
);

ensureFile(
    DB.sessions
);

/* ========================================================
   JSON DATABASE
======================================================== */

function readDB(
    file
) {

    try {

        const raw =
            fs.readFileSync(
                file,
                "utf8"
            );

        if (
            !raw.trim()
        ) {
            return [];
        }

        const data =
            JSON.parse(raw);

        return Array.isArray(data)
            ? data
            : [];

    } catch (error) {

        logError(
            "JSON okunamadı:",
            path.basename(file),
            error.message
        );

        /*
         * Bozuk dosyayı hemen ezmiyoruz.
         * Önce backup oluşturuyoruz.
         */

        try {

            const backup =
                file +
                ".broken-" +
                Date.now();

            fs.copyFileSync(
                file,
                backup
            );

        } catch {}

        return [];
    }
}

function saveDB(
    file,
    data
) {

    try {

        const temp =
            file +
            ".tmp";

        fs.writeFileSync(
            temp,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            temp,
            file
        );

        return true;

    } catch (error) {

        logError(
            "JSON kaydedilemedi:",
            path.basename(file),
            error.message
        );

        return false;
    }
}

let users =
    readDB(
        DB.users
    );

let chats =
    readDB(
        DB.chats
    );

let messages =
    readDB(
        DB.messages
    );

let sessions =
    readDB(
        DB.sessions
    );

/* ========================================================
   GENERAL HELPERS
======================================================== */

function id(
    prefix = ""
) {

    return (
        prefix +
        crypto
            .randomBytes(16)
            .toString("hex")
    );
}

function now() {

    return new Date()
        .toISOString();
}

function text(
    value,
    max = 10000
) {

    return String(
        value ?? ""
    )
        .trim()
        .slice(
            0,
            max
        );
}

function lower(
    value
) {

    return text(
        value,
        500
    ).toLowerCase();
}

function upper(
    value
) {

    return text(
        value,
        500
    ).toUpperCase();
}

function hashPIN(
    pin
) {

    return crypto
        .createHash("sha256")
        .update(
            String(pin)
        )
        .digest("hex");
}

/* ========================================================
   USER CODE
======================================================== */

function generateTRKCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    for (
        let attempt = 0;
        attempt < 1000;
        attempt++
    ) {

        let part = "";

        for (
            let i = 0;
            i < 6;
            i++
        ) {

            part +=
                chars[
                    crypto.randomInt(
                        0,
                        chars.length
                    )
                ];
        }

        const code =
            "TRK-" +
            part;

        const exists =
            users.some(
                user =>
                    upper(
                        user.code
                    ) ===
                    code
            );

        if (!exists) {

            return code;
        }
    }

    throw new Error(
        "TRK kodu üretilemedi."
    );
}

/* ========================================================
   USER LOOKUPS
======================================================== */

function getUserById(
    userId
) {

    if (!userId) {
        return null;
    }

    return (
        users.find(
            user =>
                String(
                    user.id
                ) ===
                String(
                    userId
                )
        ) || null
    );
}

function getUserByUsername(
    username
) {

    const value =
        lower(
            username
        );

    if (!value) {
        return null;
    }

    return (
        users.find(
            user =>
                lower(
                    user.username
                ) === value
        ) || null
    );
}

function getUserByCode(
    code
) {

    const value =
        upper(
            code
        );

    if (!value) {
        return null;
    }

    return (
        users.find(
            user =>
                upper(
                    user.code
                ) === value
        ) || null
    );
}

/* ========================================================
   PUBLIC USER
======================================================== */

function publicUser(
    user
) {

    if (!user) {
        return null;
    }

    return {

        id:
            user.id,

        username:
            user.username,

        name:
            user.name ||
            user.displayName ||
            user.username,

        displayName:
            user.displayName ||
            user.name ||
            user.username,

        code:
            user.code,

        bio:
            user.bio || "",

        avatar:
            user.avatar || null,

        createdAt:
            user.createdAt

    };
}

/* ========================================================
   SESSION
======================================================== */

function createToken() {

    return crypto
        .randomBytes(48)
        .toString("hex");
}

function createSession(
    userId
) {

    const token =
        createToken();

    sessions.push({

        token,

        userId,

        createdAt:
            now()

    });

    saveDB(
        DB.sessions,
        sessions
    );

    return token;
}

function getSession(
    token
) {

    if (!token) {
        return null;
    }

    return (
        sessions.find(
            session =>
                session.token ===
                token
        ) || null
    );
}

function getUserFromToken(
    token
) {

    const session =
        getSession(
            token
        );

    if (!session) {
        return null;
    }

    return getUserById(
        session.userId
    );
}

function deleteSession(
    token
) {

    sessions =
        sessions.filter(
            session =>
                session.token !==
                token
        );

    saveDB(
        DB.sessions,
        sessions
    );
}

/* ========================================================
   BLOCK
======================================================== */

function blocked(
    a,
    b
) {

    if (!a || !b) {
        return false;
    }

    const listA =
        Array.isArray(
            a.blockedUsers
        )
            ? a.blockedUsers
            : [];

    const listB =
        Array.isArray(
            b.blockedUsers
        )
            ? b.blockedUsers
            : [];

    return (
        listA.includes(b.id) ||
        listB.includes(a.id)
    );
}

/* ========================================================
   CHAT
======================================================== */

function getChat(
    chatId
) {

    return (
        chats.find(
            chat =>
                String(
                    chat.id
                ) ===
                String(
                    chatId
                )
        ) || null
    );
}

function member(
    chat,
    userId
) {

    if (!chat) {
        return false;
    }

    return (
        Array.isArray(
            chat.members
        ) &&
        chat.members.some(
            id =>
                String(id) ===
                String(userId)
        )
    );
}

function privateChat(
    userA,
    userB
) {

    return (
        chats.find(
            chat => {

                if (
                    chat.type !==
                    "private"
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
                    chat.members.length !==
                    2
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
            }
        ) || null
    );
}

function lastMessage(
    chatId
) {

    for (
        let i =
            messages.length - 1;
        i >= 0;
        i--
    ) {

        if (
            messages[i]
                .chatId ===
            chatId
        ) {

            return messages[i];
        }
    }

    return null;
}

function chatForUser(
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
            chat.name ||
            null,

        members:
            chat.members ||
            [],

        createdBy:
            chat.createdBy,

        createdAt:
            chat.createdAt,

        updatedAt:
            chat.updatedAt ||
            chat.createdAt,

        lastMessage:
            lastMessage(
                chat.id
            )

    };

    if (
        chat.type ===
        "private"
    ) {

        const otherId =
            chat.members.find(
                id =>
                    String(id) !==
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

function chatsForUser(
    userId
) {

    return chats
        .filter(
            chat =>
                member(
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
                new Date(
                    b.updatedAt
                ) -
                new Date(
                    a.updatedAt
                )
        );
}

/* ========================================================
   ONLINE SYSTEM
======================================================== */

const onlineUsers =
    new Map();

function addOnline(
    userId,
    socketId
) {

    if (
        !onlineUsers.has(
            userId
        )
    ) {

        onlineUsers.set(
            userId,
            new Set()
        );
    }

    onlineUsers
        .get(userId)
        .add(socketId);
}

function removeOnline(
    userId,
    socketId
) {

    const sockets =
        onlineUsers.get(
            userId
        );

    if (!sockets) {
        return;
    }

    sockets.delete(
        socketId
    );

    if (
        sockets.size === 0
    ) {

        onlineUsers.delete(
            userId
        );
    }
}

function online(
    userId
) {

    return onlineUsers.has(
        userId
    );
}

function emitUser(
    userId,
    event,
    data
) {

    const sockets =
        onlineUsers.get(
            userId
        );

    if (!sockets) {
        return;
    }

    for (
        const socketId
        of sockets
    ) {

        io.to(
            socketId
        ).emit(
            event,
            data
        );
    }
}

function emitChat(
    chat,
    event,
    data
) {

    if (!chat) {
        return;
    }

    for (
        const userId
        of chat.members || []
    ) {

        emitUser(
            userId,
            event,
            data
        );
    }
}

/* ========================================================
   EXPRESS
======================================================== */

app.disable(
    "x-powered-by"
);

app.use(
    express.json({
        limit:
            "25mb"
    })
);

app.use(
    express.urlencoded({
        extended:
            true,
        limit:
            "25mb"
    })
);

/* ========================================================
   AUTH HTTP
======================================================== */

function requestToken(
    req
) {

    const authorization =
        req.headers
            .authorization ||
        "";

    if (
        authorization
            .toLowerCase()
            .startsWith(
                "bearer "
            )
    ) {

        return authorization
            .slice(7)
            .trim();
    }

    return (
        req.body?.token ||
        req.query?.token ||
        ""
    );
}

function auth(
    req,
    res,
    next
) {

    const token =
        requestToken(
            req
        );

    const user =
        getUserFromToken(
            token
        );

    if (!user) {

        return res
            .status(401)
            .json({

                success:
                    false,

                error:
                    "Oturum geçersiz."

            });
    }

    req.user =
        user;

    req.token =
        token;

    next();
}

/* ========================================================
   STATUS
======================================================== */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            success:
                true,

            app:
                "MesajX",

            status:
                "online",

            serverTime:
                now(),

            users:
                users.length,

            chats:
                chats.length,

            messages:
                messages.length,

            online:
                onlineUsers.size,

            sockets:
                io.engine
                    .clientsCount

        });
    }
);

/* ========================================================
   REGISTER
======================================================== */

app.post(
    "/api/register",
    (req, res) => {

        try {

            /*
             * Farklı frontend sürümlerinin
             * farklı isimler kullanmasını destekliyoruz.
             */

            const name =
                text(
                    req.body.name ||
                    req.body.displayName ||
                    req.body.fullName,
                    80
                );

            const username =
                text(
                    req.body.username ||
                    req.body.userName ||
                    req.body.identifier,
                    50
                );

            const pin =
                String(
                    req.body.pin ||
                    req.body.password ||
                    req.body.passcode ||
                    ""
                ).trim();

            if (!name) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "Ad gerekli."

                    });
            }

            if (!username) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "Kullanıcı adı gerekli."

                    });
            }

            if (!pin) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "PIN gerekli."

                    });
            }

            if (
                pin.length < 4
            ) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "PIN en az 4 karakter olmalı."

                    });
            }

            if (
                username.length < 3
            ) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "Kullanıcı adı en az 3 karakter olmalı."

                    });
            }

            if (
                !/^[a-zA-Z0-9_.-]+$/
                    .test(
                        username
                    )
            ) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "Kullanıcı adı geçersiz."

                    });
            }

            if (
                getUserByUsername(
                    username
                )
            ) {

                return res
                    .status(409)
                    .json({

                        success:false,

                        error:
                            "Bu kullanıcı adı zaten kullanılıyor."

                    });
            }

            /*
             * TRK kodunu server üretir.
             */

            const code =
                generateTRKCode();

            const user = {

                id:
                    id("user_"),

                username:
                    username,

                name:
                    name,

                displayName:
                    name,

                code:
                    code,

                bio:
                    "",

                avatar:
                    null,

                pinHash:
                    hashPIN(
                        pin
                    ),

                blockedUsers:
                    [],

                createdAt:
                    now()

            };

            users.push(
                user
            );

            if (
                !saveDB(
                    DB.users,
                    users
                )
            ) {

                return res
                    .status(500)
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
                "REGISTER:",
                username,
                code
            );

            return res
                .status(201)
                .json({

                    success:
                        true,

                    token:
                        token,

                    user:
                        publicUser(
                            user
                        ),

                    /*
                     * Eski frontend'ler için
                     * ayrı code alanı da veriyoruz.
                     */

                    code:
                        code

                });

        } catch (error) {

            logError(
                "REGISTER",
                error
            );

            return res
                .status(500)
                .json({

                    success:false,

                    error:
                        "Hesap oluşturulamadı."

                });
        }
    }
);

/* ========================================================
   LOGIN
======================================================== */

app.post(
    "/api/login",
    (req, res) => {

        try {

            /*
             * username
             * identifier
             * code
             * userCode
             * login
             *
             * hepsini destekliyoruz.
             */

            const identifier =
                text(
                    req.body.username ||
                    req.body.identifier ||
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
                ).trim();

            if (!identifier) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "Kullanıcı adı veya TRK kodu gerekli."

                    });
            }

            if (!pin) {

                return res
                    .status(400)
                    .json({

                        success:false,

                        error:
                            "PIN gerekli."

                    });
            }

            let user =
                null;

            if (
                upper(
                    identifier
                ).startsWith(
                    "TRK-"
                )
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

                return res
                    .status(401)
                    .json({

                        success:false,

                        error:
                            "Kullanıcı bulunamadı."

                    });
            }

            if (
                user.pinHash !==
                hashPIN(
                    pin
                )
            ) {

                return res
                    .status(401)
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
                "LOGIN:",
                user.username
            );

            return res.json({

                success:
                    true,

                token:
                    token,

                user:
                    publicUser(
                        user
                    ),

                code:
                    user.code

            });

        } catch (error) {

            logError(
                "LOGIN",
                error
            );

            return res
                .status(500)
                .json({

                    success:false,

                    error:
                        "Giriş sırasında hata oluştu."

                });
        }
    }
);

/* ========================================================
   ME
======================================================== */

app.get(
    "/api/me",
    auth,
    (req, res) => {

        res.json({

            success:
                true,

            user:
                publicUser(
                    req.user
                )

        });
    }
);

/* ========================================================
   LOGOUT
======================================================== */

app.post(
    "/api/logout",
    auth,
    (req, res) => {

        deleteSession(
            req.token
        );

        res.json({
            success:
                true
        });
    }
);

/* ========================================================
   USER SEARCH HTTP
======================================================== */

app.get(
    "/api/users/search",
    auth,
    (req, res) => {

        const query =
            lower(
                req.query.q ||
                req.query.query ||
                req.query.code ||
                ""
            );

        if (!query) {

            return res.json({

                success:
                    true,

                users:
                    []

            });
        }

        const result =
            users
                .filter(
                    user =>
                        user.id !==
                        req.user.id
                )
                .filter(
                    user => {

                        const username =
                            lower(
                                user.username
                            );

                        const name =
                            lower(
                                user.displayName ||
                                user.name
                            );

                        const code =
                            lower(
                                user.code
                            );

                        return (
                            username.includes(
                                query
                            ) ||
                            name.includes(
                                query
                            ) ||
                            code.includes(
                                query
                            )
                        );
                    }
                )
                .slice(
                    0,
                    20
                )
                .map(
                    publicUser
                );

        res.json({

            success:
                true,

            users:
                result

        });
    }
);

/* ========================================================
   SOCKET.IO
======================================================== */

io.on(
    "connection",
    socket => {

        let currentUser =
            null;

        log(
            "SOCKET CONNECT:",
            socket.id
        );

        /* =================================================
           AUTHENTICATE
        ================================================= */

        socket.on(
            "authenticate",
            (data, callback) => {

                const token =
                    data?.token ||
                    data?.sessionToken ||
                    data?.authToken;

                const user =
                    getUserFromToken(
                        token
                    );

                if (!user) {

                    socket.emit(
                        "auth_error",
                        {
                            success:false,
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

                addOnline(
                    user.id,
                    socket.id
                );

                const response = {

                    success:
                        true,

                    user:
                        publicUser(
                            user
                        )

                };

                callback?.(
                    response
                );

                socket.emit(
                    "auth_ok",
                    response
                );

                /*
                 * Bazı eski frontend sürümleri
                 * authenticated dinliyor olabilir.
                 */

                socket.emit(
                    "authenticated",
                    response
                );

                log(
                    "SOCKET AUTH:",
                    user.username
                );

                /* Presence */

                for (
                    const userId
                    of onlineUsers.keys()
                ) {

                    if (
                        String(
                            userId
                        ) ===
                        String(
                            user.id
                        )
                    ) {
                        continue;
                    }

                    emitUser(
                        userId,
                        "presence",
                        {
                            userId:
                                user.id,

                            online:
                                true
                        }
                    );
                }
            }
        );

        /* =================================================
           GET CHATS
        ================================================= */

        socket.on(
            "get_chats",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false,

                        error:
                            "Oturum gerekli."

                    });
                }

                const result =
                    chatsForUser(
                        currentUser.id
                    );

                callback?.({

                    success:
                        true,

                    chats:
                        result

                });
            }
        );

        /* =================================================
           SEARCH USERS
        ================================================= */

        socket.on(
            "search_users",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false,

                        error:
                            "Oturum gerekli."

                    });
                }

                const query =
                    lower(
                        data?.query ||
                        data?.q ||
                        data?.code ||
                        data?.username ||
                        ""
                    );

                if (!query) {

                    return callback?.({

                        success:
                            true,

                        users:
                            []

                    });
                }

                const result =
                    users
                        .filter(
                            user =>
                                user.id !==
                                currentUser.id
                        )
                        .filter(
                            user => {

                                const code =
                                    lower(
                                        user.code
                                    );

                                const username =
                                    lower(
                                        user.username
                                    );

                                const name =
                                    lower(
                                        user.displayName ||
                                        user.name
                                    );

                                return (
                                    code.includes(
                                        query
                                    ) ||
                                    username.includes(
                                        query
                                    ) ||
                                    name.includes(
                                        query
                                    )
                                );
                            }
                        )
                        .slice(
                            0,
                            20
                        )
                        .map(
                            publicUser
                        );

                callback?.({

                    success:
                        true,

                    users:
                        result

                });
            }
        );

        /* =================================================
           CREATE CHAT
        ================================================= */

        socket.on(
            "create_chat",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false,

                        error:
                            "Oturum gerekli."

                    });
                }

                const type =
                    data?.type ||
                    data?.chatType ||
                    (
                        data?.group
                            ? "group"
                            : "private"
                    );

                /* =========================================
                   PRIVATE
                ========================================= */

                if (
                    type ===
                    "private"
                ) {

                    let target =
                        null;

                    /*
                     * userId
                     */

                    if (
                        data?.userId
                    ) {

                        target =
                            getUserById(
                                data.userId
                            );
                    }

                    /*
                     * code
                     */

                    if (
                        !target &&
                        data?.code
                    ) {

                        target =
                            getUserByCode(
                                data.code
                            );
                    }

                    /*
                     * userCode
                     */

                    if (
                        !target &&
                        data?.userCode
                    ) {

                        target =
                            getUserByCode(
                                data.userCode
                            );
                    }

                    /*
                     * username
                     */

                    if (
                        !target &&
                        data?.username
                    ) {

                        target =
                            getUserByUsername(
                                data.username
                            );
                    }

                    /*
                     * targetId
                     */

                    if (
                        !target &&
                        data?.targetId
                    ) {

                        target =
                            getUserById(
                                data.targetId
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
                                "Kendinle sohbet açamazsın."

                        });
                    }

                    if (
                        blocked(
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
                        privateChat(
                            currentUser,
                            target
                        ) ||
                        (() => {

                            const newChat = {

                                id:
                                    id(
                                        "chat_"
                                    ),

                                type:
                                    "private",

                                members: [
                                    currentUser.id,
                                    target.id
                                ],

                                createdBy:
                                    currentUser.id,

                                createdAt:
                                    now(),

                                updatedAt:
                                    now()
                            };

                            chats.push(
                                newChat
                            );

                            saveDB(
                                DB.chats,
                                chats
                            );

                            return newChat;

                        })();

                    callback?.({

                        success:
                            true,

                        chat:
                            chatForUser(
                                chat,
                                currentUser.id
                            )

                    });

                    emitUser(
                        target.id,
                        "chat_created",
                        {
                            chat:
                                chatForUser(
                                    chat,
                                    target.id
                                )
                        }
                    );

                    return;
                }

                /* =========================================
                   GROUP
                ========================================= */

                if (
                    type ===
                    "group"
                ) {

                    const name =
                        text(
                            data?.name ||
                            data?.groupName ||
                            "Yeni Grup",
                            80
                        );

                    let memberIds =
                        [];

                    /*
                     * memberIds
                     */

                    if (
                        Array.isArray(
                            data?.memberIds
                        )
                    ) {

                        for (
                            const memberId
                            of data.memberIds
                        ) {

                            const user =
                                getUserById(
                                    memberId
                                );

                            if (
                                user &&
                                user.id !==
                                currentUser.id &&
                                !blocked(
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

                    /*
                     * memberCodes
                     */

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
                                !blocked(
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

                    /*
                     * members
                     */

                    if (
                        Array.isArray(
                            data?.members
                        )
                    ) {

                        for (
                            const item
                            of data.members
                        ) {

                            const user =
                                getUserById(
                                    item
                                ) ||
                                getUserByCode(
                                    item
                                );

                            if (
                                user &&
                                user.id !==
                                currentUser.id &&
                                !blocked(
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
                        memberIds.length ===
                        0
                    ) {

                        return callback?.({

                            success:false,

                            error:
                                "En az bir geçerli üye gerekli."

                        });
                    }

                    const group = {

                        id:
                            id(
                                "chat_"
                            ),

                        type:
                            "group",

                        name:
                            name,

                        members:
                            [
                                currentUser.id,
                                ...memberIds
                            ],

                        createdBy:
                            currentUser.id,

                        createdAt:
                            now(),

                        updatedAt:
                            now()

                    };

                    group.members =
                        [
                            ...new Set(
                                group.members
                            )
                        ];

                    chats.push(
                        group
                    );

                    saveDB(
                        DB.chats,
                        chats
                    );

                    for (
                        const memberId
                        of group.members
                    ) {

                        emitUser(
                            memberId,
                            "chat_created",
                            {
                                chat:
                                    chatForUser(
                                        group,
                                        memberId
                                    )
                            }
                        );
                    }

                    callback?.({

                        success:
                            true,

                        chat:
                            chatForUser(
                                group,
                                currentUser.id
                            )

                    });

                    return;
                }

                callback?.({

                    success:false,

                    error:
                        "Geçersiz sohbet türü."

                });
            }
        );

        /* =================================================
           GET MESSAGES
        ================================================= */

        socket.on(
            "get_messages",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false,

                        error:
                            "Oturum gerekli."

                    });
                }

                const chatId =
                    data?.chatId ||
                    data?.id;

                const chat =
                    getChat(
                        chatId
                    );

                if (!chat) {

                    return callback?.({

                        success:false,

                        error:
                            "Sohbet bulunamadı."

                    });
                }

                if (
                    !member(
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
                            String(
                                message.chatId
                            ) ===
                            String(
                                chat.id
                            )
                    );

                callback?.({

                    success:
                        true,

                    messages:
                        result

                });
            }
        );

        /* =================================================
           SEND MESSAGE
        ================================================= */

        socket.on(
            "send_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false,

                        error:
                            "Oturum gerekli."

                    });
                }

                const chatId =
                    data?.chatId ||
                    data?.conversationId ||
                    data?.conversation;

                const chat =
                    getChat(
                        chatId
                    );

                if (!chat) {

                    return callback?.({

                        success:false,

                        error:
                            "Sohbet bulunamadı."

                    });
                }

                /*
                 * BU KONTROL ÇOK ÖNEMLİ.
                 *
                 * Kullanıcı chat üyesi değilse
                 * mesaj gönderemez.
                 */

                if (
                    !member(
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

                /* Private block */

                if (
                    chat.type ===
                    "private"
                ) {

                    const otherId =
                        chat.members.find(
                            userId =>
                                String(
                                    userId
                                ) !==
                                String(
                                    currentUser.id
                                )
                        );

                    const other =
                        getUserById(
                            otherId
                        );

                    if (
                        blocked(
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

                const messageText =
                    text(
                        data?.text ||
                        data?.message ||
                        data?.content ||
                        "",
                        10000
                    );

                const attachments =
                    Array.isArray(
                        data?.attachments
                    )
                        ? data.attachments
                        : [];

                if (
                    !messageText &&
                    attachments.length ===
                    0
                ) {

                    return callback?.({

                        success:false,

                        error:
                            "Mesaj boş olamaz."

                    });
                }

                const message = {

                    id:
                        id(
                            "msg_"
                        ),

                    chatId:
                        chat.id,

                    senderId:
                        currentUser.id,

                    sender:
                        publicUser(
                            currentUser
                        ),

                    text:
                        messageText,

                    content:
                        messageText,

                    attachments:
                        attachments,

                    createdAt:
                        now(),

                    edited:
                        false,

                    reactions:
                        {}

                };

                messages.push(
                    message
                );

                chat.updatedAt =
                    message.createdAt;

                const saved =
                    saveDB(
                        DB.messages,
                        messages
                    );

                saveDB(
                    DB.chats,
                    chats
                );

                if (!saved) {

                    return callback?.({

                        success:false,

                        error:
                            "Mesaj kaydedilemedi."

                    });
                }

                /*
                 * SADECE CHAT ÜYELERİ
                 */

                emitChat(
                    chat,
                    "new_message",
                    message
                );

                /*
                 * Bazı eski frontend'ler
                 * message eventini kullanabilir.
                 */

                emitChat(
                    chat,
                    "message",
                    message
                );

                callback?.({

                    success:
                        true,

                    message:
                        message

                });
            }
        );

        /* =================================================
           EDIT MESSAGE
        ================================================= */

        socket.on(
            "edit_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false

                    });
                }

                const messageId =
                    data?.messageId ||
                    data?.id;

                const message =
                    messages.find(
                        item =>
                            item.id ===
                            messageId
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
                    !member(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({

                        success:false

                    });
                }

                const newText =
                    text(
                        data?.text ||
                        data?.message ||
                        data?.content,
                        10000
                    );

                if (!newText) {

                    return callback?.({

                        success:false,

                        error:
                            "Mesaj boş olamaz."

                    });
                }

                message.text =
                    newText;

                message.content =
                    newText;

                message.edited =
                    true;

                saveDB(
                    DB.messages,
                    messages
                );

                emitChat(
                    chat,
                    "message_edited",
                    message
                );

                callback?.({

                    success:
                        true,

                    message:
                        message

                });
            }
        );

        /* =================================================
           DELETE MESSAGE
        ================================================= */

        socket.on(
            "delete_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false

                    });
                }

                const messageId =
                    data?.messageId ||
                    data?.id;

                const index =
                    messages.findIndex(
                        item =>
                            item.id ===
                            messageId
                    );

                if (
                    index ===
                    -1
                ) {

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
                    !member(
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

                saveDB(
                    DB.messages,
                    messages
                );

                emitChat(
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

                    success:
                        true

                });
            }
        );

        /* =================================================
           REACTION
        ================================================= */

        socket.on(
            "react_message",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false

                    });
                }

                const message =
                    messages.find(
                        item =>
                            item.id ===
                            (
                                data?.messageId ||
                                data?.id
                            )
                    );

                if (!message) {

                    return callback?.({

                        success:false,

                        error:
                            "Mesaj bulunamadı."

                    });
                }

                const chat =
                    getChat(
                        message.chatId
                    );

                if (
                    !member(
                        chat,
                        currentUser.id
                    )
                ) {

                    return callback?.({

                        success:false

                    });
                }

                const reaction =
                    text(
                        data?.reaction ||
                        data?.emoji,
                        30
                    );

                if (!reaction) {

                    return callback?.({

                        success:false

                    });
                }

                if (
                    !message.reactions
                ) {

                    message.reactions =
                        {};
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

                saveDB(
                    DB.messages,
                    messages
                );

                emitChat(
                    chat,
                    "message_reaction",
                    message
                );

                callback?.({

                    success:
                        true,

                    message:
                        message

                });
            }
        );

        /* =================================================
           TYPING
        ================================================= */

        socket.on(
            "typing",
            data => {

                if (!currentUser) {
                    return;
                }

                const chat =
                    getChat(
                        data?.chatId ||
                        data?.conversationId
                    );

                if (!chat) {
                    return;
                }

                if (
                    !member(
                        chat,
                        currentUser.id
                    )
                ) {
                    return;
                }

                const payload = {

                    chatId:
                        chat.id,

                    userId:
                        currentUser.id,

                    typing:
                        Boolean(
                            data?.typing ??
                            data?.isTyping
                        )

                };

                emitChat(
                    chat,
                    "typing",
                    payload
                );
            }
        );

        /* =================================================
           BLOCK
        ================================================= */

        socket.on(
            "block_user",
            (
                data,
                callback
            ) => {

                if (!currentUser) {

                    return callback?.({

                        success:false

                    });
                }

                const target =
                    getUserById(
                        data?.userId
                    ) ||
                    getUserByCode(
                        data?.code
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
                    data?.blocked !==
                    false;

                const index =
                    currentUser
                        .blockedUsers
                        .indexOf(
                            target.id
                        );

                if (
                    shouldBlock &&
                    index === -1
                ) {

                    currentUser
                        .blockedUsers
                        .push(
                            target.id
                        );
                }

                if (
                    !shouldBlock &&
                    index !== -1
                ) {

                    currentUser
                        .blockedUsers
                        .splice(
                            index,
                            1
                        );
                }

                saveDB(
                    DB.users,
                    users
                );

                callback?.({

                    success:
                        true,

                    blocked:
                        shouldBlock

                });
            }
        );

        /* =================================================
           DISCONNECT
        ================================================= */

        socket.on(
            "disconnect",
            reason => {

                if (
                    currentUser
                ) {

                    removeOnline(
                        currentUser.id,
                        socket.id
                    );

                    if (
                        !online(
                            currentUser.id
                        )
                    ) {

                        for (
                            const userId
                            of onlineUsers.keys()
                        ) {

                            emitUser(
                                userId,
                                "presence",
                                {

                                    userId:
                                        currentUser.id,

                                    online:
                                        false

                                }
                            );
                        }
                    }

                    log(
                        "DISCONNECT:",
                        currentUser.username,
                        reason
                    );

                } else {

                    log(
                        "DISCONNECT:",
                        socket.id,
                        reason
                    );
                }
            }
        );
    }
);

/* ========================================================
   STATIC FILES
======================================================== */

/*
 * Önce root index.html.
 */

const rootIndex =
    path.join(
        ROOT,
        "index.html"
    );

const publicIndex =
    path.join(
        PUBLIC_DIR,
        "index.html"
    );

if (
    fs.existsSync(
        rootIndex
    )
) {

    app.use(
        express.static(
            ROOT
        )
    );

    log(
        "Frontend: root/index.html"
    );

} else if (
    fs.existsSync(
        publicIndex
    )
) {

    app.use(
        express.static(
            PUBLIC_DIR
        )
    );

    log(
        "Frontend: public/index.html"
    );
}

/* ========================================================
   SPA FALLBACK
   ======================================================== */

/*
 * Express 5 ile "*" kullanmıyoruz.
 */

app.use(
    (req, res, next) => {

        if (
            req.method !==
            "GET"
        ) {

            return next();
        }

        if (
            req.path.startsWith(
                "/api/"
            )
        ) {

            return res
                .status(404)
                .json({

                    success:
                        false,

                    error:
                        "API bulunamadı."

                });
        }

        if (
            req.path.startsWith(
                "/socket.io"
            )
        ) {

            return next();
        }

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

        return res
            .status(404)
            .send(
                "MesajX index.html bulunamadı."
            );
    }
);

/* ========================================================
   ERROR HANDLER
======================================================== */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        logError(
            "EXPRESS:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(
                error
            );
        }

        res
            .status(500)
            .json({

                success:
                    false,

                error:
                    "Sunucu hatası."

            });
    }
);

/* ========================================================
   PROCESS ERROR
======================================================== */

process.on(
    "uncaughtException",
    error => {

        logError(
            "UNCAUGHT:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {

        logError(
            "REJECTION:",
            error
        );
    }
);

/* ========================================================
   START
======================================================== */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");

        console.log(
            "╔══════════════════════════════════════════╗"
        );

        console.log(
            "║              MESAJX SERVER              ║"
        );

        console.log(
            "║                 ONLINE                   ║"
        );

        console.log(
            "╠══════════════════════════════════════════╣"
        );

        console.log(
            `║ PORT     : ${String(PORT).padEnd(27)}║`
        );

        console.log(
            `║ USERS    : ${String(users.length).padEnd(27)}║`
        );

        console.log(
            `║ CHATS    : ${String(chats.length).padEnd(27)}║`
        );

        console.log(
            `║ MESSAGES : ${String(messages.length).padEnd(27)}║`
        );

        console.log(
            "╚══════════════════════════════════════════╝"
        );

        console.log("");

        log(
            "Sunucu bağlantı bekliyor..."
        );

    }
);
