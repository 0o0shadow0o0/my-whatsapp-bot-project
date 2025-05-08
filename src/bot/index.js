// src/bot/index.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, isJidUser } = require("@whiskeysockets/baileys");
const path = require("path");
const fs = require("fs");
// const qrcode = require("qrcode-terminal"); // Not printing to terminal anymore
const config = require("../../config/settings");
const { Boom } = require("@hapi/boom");
const { startWebServer } = require("../web/server");
const { initScheduler, scheduleMessage, getScheduledMessages, cancelScheduledMessage } = require("./messageScheduler");

const SESSION_DIR = path.join(__dirname, "..", "..", "session");
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

const commands = new Map();
const commandCooldowns = new Map();

const botState = {
    sock: null,
    webInterface: null,
};

function loadCommands() {
    const commandsPath = path.join(__dirname, "commands");
    if (!fs.existsSync(commandsPath)) {
        console.warn("Commands directory does not exist, skipping command loading.");
        return;
    }
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));
    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsPath, file));
            if (command.name && command.execute) {
                commands.set(command.name, command);
                console.log(`Loaded command: ${command.name}`);
            } else {
                console.warn(`Command file ${file} is missing name or execute function.`);
            }
        } catch (error) {
            console.error(`Error loading command from ${file}:`, error);
        }
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(SESSION_DIR, "baileys_auth_info"));
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys version ${version.join(".")}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, 
        browser: Browsers.macOS("Desktop"),
        logger: require("pino")({ level: "silent" }),
        shouldIgnoreJid: jid => !isJidUser(jid)
    });
    botState.sock = sock;

    loadCommands();
    initScheduler(sock);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            if (botState.webInterface && botState.webInterface.broadcast) {
                console.log("QR code received by bot, sending to web interface.");
                botState.webInterface.broadcast({ type: "qrCode", data: qr });
            }
        }
        if (connection === "close") {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            console.log("Connection closed due to ", lastDisconnect.error, `status code: ${statusCode}`);

            if (botState.webInterface && botState.webInterface.broadcast) {
                botState.webInterface.broadcast({ type: "status", message: `Connection closed. Reason: ${lastDisconnect.error?.message || 'Unknown'}` });
            }

            if (statusCode === DisconnectReason.loggedOut) {
                console.log("Logged out. Session data will be cleared. Please re-pair via web interface.");
                try {
                    // Attempt to clear session data for a fresh start
                    fs.rmSync(path.join(SESSION_DIR, "baileys_auth_info"), { recursive: true, force: true });
                    console.log("Cleared session data due to logout.");
                } catch (e) {
                    console.error("Error clearing session data:", e);
                }
                if (botState.webInterface && botState.webInterface.broadcast) {
                    botState.webInterface.broadcast({ type: "pairingRequired", message: "Logged out. Please initiate pairing." });
                }
            } else if (statusCode === DisconnectReason.connectionClosed ||
                       statusCode === DisconnectReason.connectionLost ||
                       statusCode === DisconnectReason.timedOut ||
                       statusCode === DisconnectReason.restartRequired) {
                console.log("Connection issue, Baileys will attempt to reconnect.");
            } else {
                console.log("Connection closed with unhandled reason or no need to auto-reconnect from here.");
                 if (botState.webInterface && botState.webInterface.broadcast && !botState.sock.authState.creds.registered) {
                    botState.webInterface.broadcast({ type: "pairingRequired", message: "Connection failed. Please initiate pairing." });
                }
            }
        } else if (connection === "open") {
            console.log("WhatsApp connection opened!");
            console.log(`Bot Name: ${config.botName}, Owner: ${config.ownerNumber}`);
            if (botState.webInterface && botState.webInterface.broadcast) {
                botState.webInterface.broadcast({ type: "status", message: "WhatsApp connection opened!" });
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
        if (!m.messages) return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || !isJidUser(msg.key.remoteJid)) return;

        if (botState.webInterface && botState.webInterface.broadcast) {
            botState.webInterface.broadcast({ type: "newWhatsappMessage", data: msg });
        }
        const sender = msg.key.remoteJid;
        let text = "";
        if (msg.message.conversation) {
            text = msg.message.conversation;
        } else if (msg.message.extendedTextMessage) {
            text = msg.message.extendedTextMessage.text;
        }
        console.log(`New message from ${sender}: ${text}`);
        if (text.startsWith(config.prefix)) {
            const args = text.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const command = commands.get(commandName);
            if (command) {
                if (command.cooldown) {
                    const now = Date.now();
                    const timestamps = commandCooldowns.get(command.name) || new Map();
                    const cooldownAmount = (command.cooldown || 3) * 1000;
                    if (timestamps.has(sender)) {
                        const expirationTime = timestamps.get(sender) + cooldownAmount;
                        if (now < expirationTime) {
                            const timeLeft = (expirationTime - now) / 1000;
                            await sock.sendMessage(sender, { text: `يرجى الانتظار ${timeLeft.toFixed(1)} ثانية أخرى قبل استخدام الأمر \n${command.name}\nمرة أخرى.` });
                            return;
                        }
                    }
                    timestamps.set(sender, now);
                    commandCooldowns.set(command.name, timestamps);
                    setTimeout(() => timestamps.delete(sender), cooldownAmount);
                }
                try {
                    await command.execute(sock, msg, args, botState.webInterface);
                } catch (error) {
                    console.error(`Error executing command ${command.name}:`, error);
                    await sock.sendMessage(sender, { text: "حدث خطأ أثناء تنفيذ هذا الأمر." });
                }
            }
        }
    });

    return sock;
}

async function requestPairingCodeFromWeb(phoneNumber) {
    if (!botState.sock) {
        console.error("Socket not initialized for pairing code request.");
        return { success: false, message: "Bot not initialized." };
    }
    if (!phoneNumber || !phoneNumber.startsWith("+")) {
        return { success: false, message: "Invalid phone number format. Must include country code e.g. +123..." };
    }
    try {
        console.log(`Requesting pairing code for ${phoneNumber} via web command...`);
        const code = await botState.sock.requestPairingCode(phoneNumber.replace("+", ""));
        console.log(`Pairing code for ${phoneNumber} is: ${code}`);
        if (botState.webInterface && botState.webInterface.broadcast) {
            botState.webInterface.broadcast({ type: "pairingCode", data: code, forNumber: phoneNumber });
        }
        return { success: true, code: code, forNumber: phoneNumber };
    } catch (e) {
        console.error("Failed to request pairing code via web:", e.message);
        if (botState.webInterface && botState.webInterface.broadcast) {
            botState.webInterface.broadcast({ type: "error", message: `Failed to get pairing code: ${e.message}` });
        }
        return { success: false, message: e.message };
    }
}

async function main() {
    await connectToWhatsApp(); 
    botState.webInterface = startWebServer(botState, scheduleMessage, getScheduledMessages, cancelScheduledMessage, requestPairingCodeFromWeb);

    if (botState.sock && !botState.sock.authState.creds.registered) {
        if (botState.webInterface && botState.webInterface.broadcast) {
            console.log("Broadcasting pairingRequired to web interface as no session found after start.");
            botState.webInterface.broadcast({ type: "pairingRequired" });
        }
    }
}

main().catch(err => {
    console.error("Failed to start bot:", err);
});

const gracefulShutdown = () => {
    console.log("Shutting down gracefully...");
    if (botState.sock) {
        console.log("Closing WhatsApp socket (Baileys should handle actual disconnection).");
        // botState.sock.end(new Error("Graceful shutdown")); // Optional: force close
    }
    if (botState.webInterface && botState.webInterface.server) {
        console.log("Closing web server...");
        botState.webInterface.server.close(() => {
            console.log("Web server closed.");
            process.exit(0);
        });
        setTimeout(() => {
            console.error("Graceful shutdown timed out, forcing exit.");
            process.exit(1);
        }, 5000);
    } else {
        process.exit(0);
    }
};
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

module.exports = { requestPairingCodeFromWeb, botState };

