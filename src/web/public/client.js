const connectionStatusDiv = document.getElementById("connectionStatus");
const messagesUl = document.getElementById("messages");
const recipientInput = document.getElementById("recipient");
const messageTextInput = document.getElementById("messageText");
const sendMessageBtn = document.getElementById("sendMessageBtn");

const scheduleRecipientInput = document.getElementById("scheduleRecipient");
const scheduleMessageTextInput = document.getElementById("scheduleMessageText");
const scheduleDateTimeInput = document.getElementById("scheduleDateTime");
const scheduleMessageBtn = document.getElementById("scheduleMessageBtn");
const scheduledMessagesUl = document.getElementById("scheduledMessagesList");

const connectionMethodInfo = document.getElementById("connectionMethodInfo");
const qrCodeContainer = document.getElementById("qrCodeContainer");
const qrCodeImageContainer = document.getElementById("qrCodeImageContainer");
const pairingCodeContainer = document.getElementById("pairingCodeContainer");
const pairingCodeValue = document.getElementById("pairingCodeValue");
const pairingForNumber = document.getElementById("pairingForNumber");

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

socket.onopen = () => {
    connectionStatusDiv.textContent = "الحالة: متصل بالخادم";
    connectionStatusDiv.style.color = "green";
    addMessageToList("تم الاتصال بخادم الويب بنجاح.");
    socket.send(JSON.stringify({ type: "getScheduledMessages" }));
    connectionMethodInfo.style.display = "block"; // Show initial info
    qrCodeContainer.style.display = "none";
    pairingCodeContainer.style.display = "none";
};

socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log("Message from server:", data);
        if (data.type === "status") {
            addMessageToList(`[حالة] ${data.message}`);
            if (data.message === "WhatsApp connection opened!") {
                 qrCodeContainer.style.display = "none"; 
                 pairingCodeContainer.style.display = "none";
                 connectionMethodInfo.style.display = "none";
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
            qrCodeContainer.style.display = "block";
            pairingCodeContainer.style.display = "none";
            connectionMethodInfo.style.display = "none";
            addMessageToList("يرجى مسح رمز QR المعروض أعلاه للاتصال بواتساب.");
        } else if (data.type === "pairingCode") {
            pairingCodeValue.textContent = data.data;
            pairingForNumber.textContent = data.forNumber ? `للرقم: ${data.forNumber}` : "";
            pairingCodeContainer.style.display = "block";
            qrCodeContainer.style.display = "none";
            connectionMethodInfo.style.display = "none";
            addMessageToList(`رمز الاقتران الخاص بك هو: ${data.data}. يرجى إدخاله في واتساب.`);
        } else if (data.success === false && data.message) {
             addMessageToList(`[خطأ جدولة] ${data.message}`, "error");
        } else {
            addMessageToList(event.data);
        }
    } catch (e) {
        addMessageToList(`بيانات غير مفهومة من الخادم: ${event.data}`);
        console.error("Error parsing server message:", e, "Data:", event.data);
    }
};

socket.onclose = () => {
    connectionStatusDiv.textContent = "الحالة: انقطع الاتصال";
    connectionStatusDiv.style.color = "red";
    addMessageToList("انقطع الاتصال بخادم الويب.", "error");
    qrCodeContainer.style.display = "none";
    pairingCodeContainer.style.display = "none";
    connectionMethodInfo.style.display = "block"; // Show info on disconnect
};

socket.onerror = (error) => {
    connectionStatusDiv.textContent = "الحالة: خطأ في الاتصال";
    connectionStatusDiv.style.color = "red";
    addMessageToList("حدث خطأ في اتصال WebSocket: " + (error.message || "غير معروف"), "error");
    console.error("WebSocket Error:", error);
    qrCodeContainer.style.display = "none";
    pairingCodeContainer.style.display = "none";
    connectionMethodInfo.style.display = "block"; // Show info on error
};

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

