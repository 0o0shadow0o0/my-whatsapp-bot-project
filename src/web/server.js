const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const config = require("../../config/settings");

let sockInstance = null; // To hold the Baileys socket instance
let scheduleMessageFunc = null;
let getScheduledMessagesFunc = null;
let cancelScheduledMessageFunc = null;

function startWebServer(baileysSocket, scheduleFunc, getScheduledFunc, cancelFunc) {
    sockInstance = baileysSocket;
    scheduleMessageFunc = scheduleFunc;
    getScheduledMessagesFunc = getScheduledFunc;
    cancelScheduledMessageFunc = cancelFunc;

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

        // Send current scheduled messages on connection
        if (getScheduledMessagesFunc) {
            ws.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFunc() }));
        }

        ws.on("message", async (message) => {
            console.log("Received from web client: %s", message);
            try {
                const parsedMessage = JSON.parse(message);

                if (parsedMessage.type === "sendMessage" && parsedMessage.to && parsedMessage.text) {
                    if (sockInstance) {
                        await sockInstance.sendMessage(parsedMessage.to, { text: parsedMessage.text });
                        ws.send(JSON.stringify({ type: "status", message: "Message sent successfully" }));
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Bot not connected to WhatsApp" }));
                    }
                } else if (parsedMessage.type === "scheduleMessage" && parsedMessage.to && parsedMessage.text && parsedMessage.sendAt) {
                    if (scheduleMessageFunc) {
                        const result = scheduleMessageFunc(parsedMessage.to, parsedMessage.text, parsedMessage.sendAt);
                        ws.send(JSON.stringify(result));
                        if (result.success && getScheduledMessagesFunc) {
                            // Broadcast updated list to all clients
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFunc() }));
                                }
                            });
                        }
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Scheduling function not available" }));
                    }
                } else if (parsedMessage.type === "getScheduledMessages") {
                    if (getScheduledMessagesFunc) {
                        ws.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFunc() }));
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Function to get scheduled messages not available" }));
                    }
                } else if (parsedMessage.type === "cancelScheduledMessage" && parsedMessage.messageId) {
                    if (cancelScheduledMessageFunc) {
                        const result = cancelScheduledMessageFunc(parsedMessage.messageId);
                        ws.send(JSON.stringify(result));
                        if (result.success && getScheduledMessagesFunc) {
                             // Broadcast updated list to all clients
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "scheduledMessagesList", data: getScheduledMessagesFunc() }));
                                }
                            });
                        }
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Function to cancel scheduled messages not available" }));
                    }
                }

            } catch (e) {
                console.error("Failed to parse message from web client or handle it:", e);
                ws.send(JSON.stringify({ type: "error", message: "Invalid message format or server error" }));
            }
        });

        ws.on("close", () => {
            console.log("Web client disconnected");
        });
        ws.on("error", console.error);
    });

    function broadcast(data) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }

    if (sockInstance) {
        sockInstance.ev.on("messages.upsert", m => {
            if (!m.messages) return;
            const msg = m.messages[0];
            if (!msg.message) return;
            broadcast({ type: "newWhatsappMessage", data: msg });
        });
    }

    server.listen(config.webServerPort, () => {
        console.log(`Web server started on http://localhost:${config.webServerPort}`);
    });

    return { app, server, wss, broadcast };
}

module.exports = { startWebServer };
