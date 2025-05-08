// Example command: src/bot/commands/ping.js
module.exports = {
    name: "ping",
    description: "Replies with Pong!",
    cooldown: 5, // seconds
    async execute(sock, msg, args) {
        const sender = msg.key.remoteJid;
        await sock.sendMessage(sender, { text: "Pong! From command file!" });
        console.log(`Executed ping command for ${sender}`);
    }
};
