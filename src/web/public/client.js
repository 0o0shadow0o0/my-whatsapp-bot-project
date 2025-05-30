// src/web/public/client.js
const connectionStatusDiv = document.getElementById("connectionStatus");
const messagesUl = document.getElementById("messages");

// Pairing UI elements
const pairingSection = document.getElementById("pairingSection");
const pairingMethodSelect = document.getElementById("pairingMethod");
const phoneNumberInputContainer = document.getElementById("phoneNumberInputContainer");
const phoneNumberInput = document.getElementById("phoneNumber");
const initiatePairingBtn = document.getElementById("initiatePairingBtn");

const qrCodeContainer = document.getElementById("qrCodeContainer");
const qrCodeImageContainer = document.getElementById("qrCodeImageContainer");
const pairingCodeContainer = document.getElementById("pairingCodeContainer");
const pairingCodeValue = document.getElementById("pairingCodeValue");
const pairingForNumber = document.getElementById("pairingForNumber");

// Main controls UI elements
const mainControls = document.getElementById("mainControls");
const recipientInput = document.getElementById("recipient");
const messageTextInput = document.getElementById("messageText");
const sendMessageBtn = document.getElementById("sendMessageBtn");

const scheduleRecipientInput = document.getElementById("scheduleRecipient");
const scheduleMessageTextInput = document.getElementById("scheduleMessageText");
const scheduleDateTimeInput = document.getElementById("scheduleDateTime");
const scheduleMessageBtn = document.getElementById("scheduleMessageBtn");
const scheduledMessagesUl = document.getElementById("scheduledMessagesList");

let qrCodeInstance = null;

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socketURL = `${socketProtocol}//${window.location.host}`;
const socket = new WebSocket(socketURL);

function addMessageToList(message, type = "status") {
    const li = document.createElement("li");
    li.textContent = message;
    li.className = type;
    messagesUl.appendChild(li);
    messagesUl.scrollTop = messagesUl.scrollHeight;
}

function addWhatsAppMessageToList(msgData) {
    const li = document.createElement("li");
    li.className = "whatsapp-message";
    if (msgData.key && msgData.key.fromMe) {
        li.classList.add("sent-message");
    }
    let sender = msgData.key && msgData.key.remoteJid ? msgData.key.remoteJid : "Unknown";
    if (msgData.pushName) {
        sender = `${msgData.pushName} (${sender})`;
    }
    let messageContent = "(No text content)";
    if (msgData.message && msgData.message.conversation) {
        messageContent = msgData.message.conversation;
    } else if (msgData.message && msgData.message.extendedTextMessage && msgData.message.extendedTextMessage.text) {
        messageContent = msgData.message.extendedTextMessage.text;
    }
    li.innerHTML = `<strong>${sender}:</strong> ${messageContent}`;
    messagesUl.appendChild(li);
    messagesUl.scrollTop = messagesUl.scrollHeight;
}

function displayScheduledMessages(messages) {
    scheduledMessagesUl.innerHTML = "";
    if (messages && messages.length > 0) {
        messages.forEach(msg => {
            const li = document.createElement("li");
            li.className = "scheduled-item";
            const sendAt = new Date(msg.sendAt).toLocaleString("ar-EG");
            li.innerHTML = `<span>إلى: ${msg.to} | النص: \"${msg.text}\" | وقت الإرسال: ${sendAt}</span>`;
            
            const cancelButton = document.createElement("button");
            cancelButton.textContent = "إلغاء";
            cancelButton.className = "cancel-btn";
            cancelButton.onclick = () => {
                if (confirm("هل أنت متأكد أنك تريد إلغاء هذه الرسالة المجدولة؟")) {
                    socket.send(JSON.stringify({ type: "cancelScheduledMessage", messageId: msg.id }));
                }
            };
            li.appendChild(cancelButton);
            scheduledMessagesUl.appendChild(li);
        });
    } else {
        scheduledMessagesUl.innerHTML = "<li>لا توجد رسائل مجدولة حالياً.</li>";
    }
}

function showPairingUI() {
    pairingSection.classList.remove("hidden");
    qrCodeContainer.classList.add("hidden");
    pairingCodeContainer.classList.add("hidden");
    mainControls.classList.add("hidden");
    pairingMethodSelect.value = "qr"; // Default to QR
    phoneNumberInputContainer.classList.add("hidden");
}

function showMainControls() {
    pairingSection.classList.add("hidden");
    qrCodeContainer.classList.add("hidden");
    pairingCodeContainer.classList.add("hidden");
    mainControls.classList.remove("hidden");
}

socket.onopen = () => {
    connectionStatusDiv.textContent = "الحالة: متصل بالخادم";
    connectionStatusDiv.style.color = "green";
    addMessageToList("تم الاتصال بخادم الويب بنجاح.");
    socket.send(JSON.stringify({ type: "getScheduledMessages" }));
    // Initially, we don't know if pairing is needed. Backend will tell us.
    // showPairingUI(); // Don't show pairing UI immediately
};

socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log("Message from server:", data);

        if (data.type === "pairingRequired") {
            addMessageToList(data.message || "يرجى ربط حساب واتساب للمتابعة.");
            showPairingUI();
        } else if (data.type === "status") {
            addMessageToList(`[حالة] ${data.message}`);
            if (data.message === "WhatsApp connection opened!") {
                showMainControls();
            }
        } else if (data.type === "error") {
            addMessageToList(`[خطأ] ${data.message}`, "error");
        } else if (data.type === "newWhatsappMessage") {
            addWhatsAppMessageToList(data.data);
        } else if (data.type === "scheduledMessagesList") {
            displayScheduledMessages(data.data);
        } else if (data.type === "qrCode") {
            qrCodeImageContainer.innerHTML = ""; 
            if (typeof QRCode !== 'undefined') {
                qrCodeInstance = new QRCode(qrCodeImageContainer, {
                    text: data.data,
                    width: 256,
                    height: 256,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            } else {
                qrCodeImageContainer.textContent = "QRCode library not loaded."; 
            }
            pairingSection.classList.add("hidden");
            qrCodeContainer.classList.remove("hidden");
            pairingCodeContainer.classList.add("hidden");
            addMessageToList("يرجى مسح رمز QR المعروض أعلاه للاتصال بواتساب.");
        } else if (data.type === "pairingCode") {
            pairingCodeValue.textContent = data.data;
            pairingForNumber.textContent = data.forNumber ? `للرقم: ${data.forNumber}` : "";
            pairingSection.classList.add("hidden");
            qrCodeContainer.classList.add("hidden");
            pairingCodeContainer.classList.remove("hidden");
            addMessageToList(`رمز الاقتران الخاص بك هو: ${data.data}. يرجى إدخاله في واتساب.`);
        } else if (data.success === false && data.message) {
             addMessageToList(`[خطأ جدولة/إرسال] ${data.message}`, "error");
        } else {
            // addMessageToList(event.data); // Avoid showing raw data if not structured
        }
    } catch (e) {
        addMessageToList(`بيانات غير مفهومة من الخادم: ${event.data}`);
        console.error("Error parsing server message:", e, "Data:", event.data);
    }
};

socket.onclose = () => {
    connectionStatusDiv.textContent = "الحالة: انقطع الاتصال بالخادم";
    connectionStatusDiv.style.color = "red";
    addMessageToList("انقطع الاتصال بخادم الويب.", "error");
    showPairingUI(); // Or a specific disconnected message UI
};

socket.onerror = (error) => {
    connectionStatusDiv.textContent = "الحالة: خطأ في الاتصال بالخادم";
    connectionStatusDiv.style.color = "red";
    addMessageToList("حدث خطأ في اتصال WebSocket: " + (error.message || "غير معروف"), "error");
    console.error("WebSocket Error:", error);
    showPairingUI(); // Or a specific error message UI
};

// Event listener for pairing method selection
pairingMethodSelect.addEventListener("change", () => {
    if (pairingMethodSelect.value === "code") {
        phoneNumberInputContainer.classList.remove("hidden");
    } else {
        phoneNumberInputContainer.classList.add("hidden");
    }
});

// Event listener for initiating pairing
initiatePairingBtn.addEventListener("click", () => {
    const method = pairingMethodSelect.value;
    let payload = { type: "initiatePairing", method: method };

    if (method === "code") {
        const phone = phoneNumberInput.value.trim();
        if (!phone) {
            addMessageToList("يرجى إدخال رقم الهاتف للاقتران بالكود.", "error");
            return;
        }
        payload.phoneNumber = phone;
    }
    addMessageToList(`جاري بدء عملية الربط باستخدام: ${method === "qr" ? "رمز QR" : "رمز الاقتران"}...`);
    socket.send(JSON.stringify(payload));
    // Hide pairing selection UI, wait for QR/Code from backend
    pairingSection.classList.add("hidden"); 
});


sendMessageBtn.onclick = () => {
    const recipient = recipientInput.value.trim();
    const text = messageTextInput.value.trim();
    if (!recipient || !text) {
        addMessageToList("يرجى إدخال رقم المستلم ونص الرسالة للإرسال الفوري.", "error");
        return;
    }
    socket.send(JSON.stringify({ type: "sendMessage", to: recipient, text: text }));
    addMessageToList(`جاري إرسال رسالة إلى ${recipient}...`);
    messageTextInput.value = "";
};

scheduleMessageBtn.onclick = () => {
    const recipient = scheduleRecipientInput.value.trim();
    const text = scheduleMessageTextInput.value.trim();
    const sendAt = scheduleDateTimeInput.value;

    if (!recipient || !text || !sendAt) {
        addMessageToList("يرجى إدخال جميع حقول جدولة الرسالة (المستلم، النص، وقت الإرسال).", "error");
        return;
    }
    socket.send(JSON.stringify({ type: "scheduleMessage", to: recipient, text: text, sendAt: sendAt }));
    addMessageToList(`جاري جدولة رسالة إلى ${recipient} في ${new Date(sendAt).toLocaleString("ar-EG")}...`);
    scheduleMessageTextInput.value = "";
};

