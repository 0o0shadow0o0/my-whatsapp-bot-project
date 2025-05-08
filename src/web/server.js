// src/web/server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const config = require("../../config/settings");

// These will be populated when startWebServer is called
let botStateRef = null; 
let scheduleMessageFuncRef = null;
let getScheduledMessagesFuncRef = null;
let cancelScheduledMessageFuncRef = null;
let requestPairingCodeWebFuncRef = null;

function startWebServer(currentBotState, scheduleFunc, getScheduledFunc, cancelFunc, requestPairingCodeFunc) {
    botStateRef = currentBotState;
    scheduleMessageFuncRef = scheduleFunc;
    getScheduledMessagesFuncRef = getScheduledFunc;
    cancelScheduledMessageFuncRef = cancelFunc;
    requestPairingCodeWebFuncRef = requestPairingCodeFunc;

    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });

    app.use(express.static(path.join(__dirname, "public")));

    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, "public", "index.html"));
    });

    wss.on("connection", (ws) => {
        console.log("Web client connected");
        ws.send(JSON.stringify({ type: "status", message: "Connected to Bot Web Interface" }));

        if (getScheduledMessagesFuncRef) {
            ws.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFuncRef() }));
        }

        // If bot is not paired, immediately tell the UI to show pairing options
        if (botStateRef && botStateRef.sock && !botStateRef.sock.authState.creds.registered) {
             console.log("Web client connected, bot not paired, sending pairingRequired.");
             ws.send(JSON.stringify({ type: "pairingRequired", message: "WhatsApp account not linked. Please choose a pairing method." }));
        } else if (botStateRef && botStateRef.sock && botStateRef.sock.authState.creds.registered){
            ws.send(JSON.stringify({ type: "status", message: "WhatsApp connection appears to be active." }));
        }

        ws.on("message", async (message) => {
            console.log("Received from web client: %s", message);
            try {
                const parsedMessage = JSON.parse(message);

                if (parsedMessage.type === "initiatePairing") {
                    if (!botStateRef || !botStateRef.sock) {
                        ws.send(JSON.stringify({ type: "error", message: "Bot is not initialized yet." }));
                        return;
                    }
                    if (parsedMessage.method === "qr") {
                        // The QR code is typically sent by the bot's `connection.update` event when it's generated.
                        // We just need to ensure the bot is attempting to connect if it's not already.
                        // If already trying, the QR will be broadcast. If connected, this request is odd.
                        console.log("Web client requested QR pairing. QR should be broadcast on connection event.");
                        ws.send(JSON.stringify({ type: "status", message: "QR code will be displayed if a new session is required." }));
                         // If there's an existing QR, or if the bot is in a state to generate one, it will be sent via broadcast.
                         // No direct action here other than logging, as index.js handles QR emission.
                    } else if (parsedMessage.method === "code" && parsedMessage.phoneNumber) {
                        if (requestPairingCodeWebFuncRef) {
                            const result = await requestPairingCodeWebFuncRef(parsedMessage.phoneNumber);
                            // The result (success/failure, code) is broadcast by requestPairingCodeFromWeb itself in index.js
                            // So, no need to send a specific response here unless it's an immediate local error.
                            if (!result || !result.success) {
                                 ws.send(JSON.stringify({ type: "error", message: result.message || "Failed to initiate pairing code request." }));
                            }
                        } else {
                            ws.send(JSON.stringify({ type: "error", message: "Pairing code function not available." }));
                        }
                    }
                } else if (parsedMessage.type === "sendMessage" && parsedMessage.to && parsedMessage.text) {
                    if (botStateRef && botStateRef.sock && botStateRef.sock.authState.creds.registered) {
                        await botStateRef.sock.sendMessage(parsedMessage.to, { text: parsedMessage.text });
                        ws.send(JSON.stringify({ type: "status", message: "Message sent successfully" }));
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Bot not connected to WhatsApp or not paired." }));
                    }
                } else if (parsedMessage.type === "scheduleMessage" && parsedMessage.to && parsedMessage.text && parsedMessage.sendAt) {
                    if (scheduleMessageFuncRef) {
                        const result = scheduleMessageFuncRef(parsedMessage.to, parsedMessage.text, parsedMessage.sendAt);
                        ws.send(JSON.stringify(result)); // Send direct result to requesting client
                        if (result.success && getScheduledMessagesFuncRef) {
                            // Broadcast updated list to all clients
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFuncRef() }));
                                }
                            });
                        }
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Scheduling function not available" }));
                    }
                } else if (parsedMessage.type === "getScheduledMessages") {
                    if (getScheduledMessagesFuncRef) {
                        ws.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFuncRef() }));
                    }
                } else if (parsedMessage.type === "cancelScheduledMessage" && parsedMessage.messageId) {
                    if (cancelScheduledMessageFuncRef) {
                        const result = cancelScheduledMessageFuncRef(parsedMessage.messageId);
                        ws.send(JSON.stringify(result)); // Send direct result
                        if (result.success && getScheduledMessagesFuncRef) {
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFuncRef() }));
                                }
                            });
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to parse message from web client or handle it:", e);
                ws.send(JSON.stringify({ type: "error", message: "Invalid message format or server error." }));
            }
        });

        ws.on("close", () => {
            console.log("Web client disconnected");
        });
        ws.on("error", console.error);
    });

    // This broadcast function will be part of the returned webInterface object in index.js
    const broadcast = (data) => {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    };

    // Attach Baileys event listeners ONLY if botStateRef.sock is valid
    // This was the source of the previous error. `botStateRef.sock` might be null initially.
    // The event listeners for Baileys socket events should ideally be managed in index.js
    // or ensured that botStateRef.sock is valid before attaching.
    // For now, we rely on index.js to have initialized botStateRef.sock and its events that call broadcast.

    server.listen(config.webServerPort, () => {
        console.log(`Web server started on http://localhost:${config.webServerPort}`);
    });

    return { app, server, wss, broadcast }; // broadcast is used by index.js
}

module.exports = { startWebServer };

