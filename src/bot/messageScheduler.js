const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const SCHEDULE_FILE = path.join(DATA_DIR, "scheduled_messages.json");

let scheduledMessages = [];
let sockInstance = null;
let intervalId = null;

// Load scheduled messages from file
function loadScheduledMessages() {
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            const data = fs.readFileSync(SCHEDULE_FILE, "utf-8");
            scheduledMessages = JSON.parse(data);
            console.log("Loaded scheduled messages:", scheduledMessages.length);
        }
    } catch (error) {
        console.error("Error loading scheduled messages:", error);
        scheduledMessages = [];
    }
}

// Save scheduled messages to file
function saveScheduledMessages() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduledMessages, null, 2));
        console.log("Scheduled messages saved.");
    } catch (error) {
        console.error("Error saving scheduled messages:", error);
    }
}

function initScheduler(sock) {
    sockInstance = sock;
    loadScheduledMessages();
    if (intervalId) {
        clearInterval(intervalId);
    }
    // Check every minute for messages to send
    intervalId = setInterval(checkAndSendScheduledMessages, 60 * 1000);
    console.log("Message scheduler initialized.");
}

async function checkAndSendScheduledMessages() {
    if (!sockInstance) {
        console.warn("Scheduler: WhatsApp socket not available.");
        return;
    }

    const now = new Date().getTime();
    const messagesToSend = scheduledMessages.filter(msg => new Date(msg.sendAt).getTime() <= now);

    if (messagesToSend.length > 0) {
        console.log(`Scheduler: Found ${messagesToSend.length} message(s) to send.`);
    }

    for (const msg of messagesToSend) {
        try {
            console.log(`Scheduler: Sending message to ${msg.to}: "${msg.text}"`);
            await sockInstance.sendMessage(msg.to, { text: msg.text });
            console.log(`Scheduler: Message sent to ${msg.to}`);
            // Remove from scheduled list
            scheduledMessages = scheduledMessages.filter(m => m.id !== msg.id);
        } catch (error) {
            console.error(`Scheduler: Error sending scheduled message to ${msg.to}:`, error);
            // Optionally, implement retry logic or mark as failed
        }
    }

    if (messagesToSend.length > 0) {
        saveScheduledMessages(); // Save changes after sending
    }
}

function scheduleMessage(to, text, sendAt) {
    if (!to || !text || !sendAt) {
        console.error("Scheduler: Invalid arguments for scheduleMessage.");
        return { success: false, message: "Invalid arguments" };
    }

    const sendAtDate = new Date(sendAt);
    if (isNaN(sendAtDate.getTime())) {
        console.error("Scheduler: Invalid date format for sendAt.");
        return { success: false, message: "Invalid date format" };
    }

    if (sendAtDate.getTime() <= new Date().getTime()) {
        return { success: false, message: "Scheduled time must be in the future." };
    }

    const newMessage = {
        id: `msg_${new Date().getTime()}_${Math.random().toString(36).substring(7)}`,
        to,
        text,
        sendAt: sendAtDate.toISOString(),
        createdAt: new Date().toISOString()
    };

    scheduledMessages.push(newMessage);
    saveScheduledMessages();
    console.log(`Scheduler: Message scheduled for ${to} at ${sendAtDate.toLocaleString()}`);
    return { success: true, message: "Message scheduled successfully", data: newMessage };
}

function getScheduledMessages() {
    return scheduledMessages;
}

function cancelScheduledMessage(messageId) {
    const initialLength = scheduledMessages.length;
    scheduledMessages = scheduledMessages.filter(msg => msg.id !== messageId);
    if (scheduledMessages.length < initialLength) {
        saveScheduledMessages();
        console.log(`Scheduler: Cancelled message with ID ${messageId}`);
        return { success: true, message: "Message cancelled successfully." };
    }
    return { success: false, message: "Message ID not found." };
}

module.exports = {
    initScheduler,
    scheduleMessage,
    getScheduledMessages,
    cancelScheduledMessage,
    loadScheduledMessages // Export for potential external use or testing
};
