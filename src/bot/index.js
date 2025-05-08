const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, isJidUser } = require("@whiskeysockets/baileys");
const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const readline = require("readline"); 
const config = require("../../config/settings");
const { Boom } = require("@hapi/boom");
const { startWebServer } = require("../web/server");
const { initScheduler, scheduleMessage, getScheduledMessages, cancelScheduledMessage } = require("./messageScheduler");

const SESSION_DIR = path.join(__dirname, "..", "..", "session");
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

let webInterface = null;
const commands = new Map();
const commandCooldowns = new Map();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

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

    if (!sock.authState.creds.registered) {
        const connectMethod = await question("Choose connection method: (1) QR Code (2) Pairing Code\nType 1 or 2 and press Enter: ");

        if (connectMethod.trim() === "2") {
            let phoneNumber = await question("Please enter your WhatsApp number with country code (e.g., +1234567890): ");
            phoneNumber = phoneNumber.replace(/[^0-9+]/g, "").trim();
            if (!phoneNumber.startsWith("+")) {
                 console.log("Warning: Phone number must start with a country code (e.g., +1, +91). Attempting to proceed, but this might fail.");
            }
            if (phoneNumber) {
                try {
                    console.log(`Requesting pairing code for ${phoneNumber}...`);
                    const code = await sock.requestPairingCode(phoneNumber.replace("+","")); 
                    console.log(`Your pairing code is: ${code}`);
                    console.log("Please enter this code on your WhatsApp (Link a device > Link with phone number instead).");
                    if (webInterface && webInterface.broadcast) {
                        webInterface.broadcast({ type: "pairingCode", data: code, forNumber: phoneNumber });
                    }
                } catch (e) {
                    console.error("Failed to request pairing code:", e.message);
                    console.log("Falling back to QR code method. Please restart if you want to try pairing code again.");
                    sock.printQRInTerminal = true; 
                }
            } else {
                console.log("No phone number entered. Falling back to QR code method.");
                sock.printQRInTerminal = true;
            }
        } else {
            console.log("Using QR Code method.");
            sock.printQRInTerminal = true; 
        }
    } else {
         console.log("Found existing session, attempting to connect...");
    }

    loadCommands();
    initScheduler(sock);

    if (!webInterface) {
        webInterface = startWebServer(sock, scheduleMessage, getScheduledMessages, cancelScheduledMessage);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && sock.printQRInTerminal) { 
            console.log("QR code received, scan it with your WhatsApp:");
            qrcode.generate(qr, { small: true });
            if (webInterface && webInterface.broadcast) {
                webInterface.broadcast({ type: "qrCode", data: qr });
            }
        }
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed due to ", lastDisconnect.error, ", reconnecting ", shouldReconnect);
            if (webInterface && webInterface.broadcast) {
                webInterface.broadcast({ type: "status", message: `Connection closed. Reconnecting: ${shouldReconnect}` });
            }
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log("Not reconnecting, logged out or other reason.");
                if (rl && !rl.closed) rl.close();
            }
        } else if (connection === "open") {
            console.log("WhatsApp connection opened!");
            console.log(`Bot Name: ${config.botName}, Owner: ${config.ownerNumber}`);
            if (webInterface && webInterface.broadcast) {
                webInterface.broadcast({ type: "status", message: "WhatsApp connection opened!" });
            }
            if (rl && !rl.closed) rl.close(); 
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
        if (!m.messages) return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || !isJidUser(msg.key.remoteJid)) return;

        if (webInterface && webInterface.broadcast) {
            webInterface.broadcast({ type: "newWhatsappMessage", data: msg });
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
                    await command.execute(sock, msg, args, webInterface);
                } catch (error) {
                    console.error(`Error executing command ${command.name}:`, error);
                    await sock.sendMessage(sender, { text: "حدث خطأ أثناء تنفيذ هذا الأمر." });
                }
            }
        }
    });
    return sock;
}

connectToWhatsApp().catch(err => {
    console.error("Failed to connect to WhatsApp:", err);
    if (rl && !rl.closed) rl.close();
});

// Graceful shutdown
const gracefulShutdown = () => {
    console.log("Shutting down gracefully...");
    if (rl && !rl.closed) {
        rl.close();
    }
    // Add any other cleanup tasks here
    process.exit(0);
};
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

module.exports = { connectToWhatsApp };
