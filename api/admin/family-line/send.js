function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRecipients(recipients) {
  if (!Array.isArray(recipients)) {
    return [];
  }
  const seenLineUserIds = new Set();
  const normalizedRecipients = recipients
    .map((recipient) => ({
      caregiverId: String(recipient?.caregiverId ?? ""),
      caregiverName: String(recipient?.caregiverName ?? ""),
      patientId: String(recipient?.patientId ?? ""),
      patientName: String(recipient?.patientName ?? ""),
      doctorId: String(recipient?.doctorId ?? ""),
      doctorName: String(recipient?.doctorName ?? ""),
      lineUserId: String(recipient?.lineUserId ?? "").trim()
    }))
    .filter((recipient) => isRequiredString(recipient.lineUserId));
  return normalizedRecipients.filter((recipient) => {
    if (seenLineUserIds.has(recipient.lineUserId)) {
      return false;
    }
    seenLineUserIds.add(recipient.lineUserId);
    return true;
  });
}

function chunkRecipients(recipients, size) {
  const chunks = [];
  for (let index = 0; index < recipients.length; index += size) {
    chunks.push(recipients.slice(index, index + size));
  }
  return chunks;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const body = request.body ?? {};
  const channelAccessToken =
    String(body.lineChannelAccessToken ?? "").trim() ||
    process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!isRequiredString(channelAccessToken)) {
    setJson(response, 503, {
      error: "尚未設定 LINE_CHANNEL_ACCESS_TOKEN，無法呼叫 LINE Messaging API。"
    });
    return;
  }

  const subject = String(body.subject ?? "").trim();
  const content = String(body.content ?? "").trim();
  const recipients = normalizeRecipients(body.recipients);

  if (!isRequiredString(subject) || !isRequiredString(content) || recipients.length === 0) {
    setJson(response, 400, { error: "LINE 發送資料不完整，請確認標題、內容與收件人。" });
    return;
  }

  const text = `${subject}\n\n${content}`;
  const results = [];
  for (const recipientBatch of chunkRecipients(recipients, 500)) {
    const lineResponse = await fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: recipientBatch.map((recipient) => recipient.lineUserId),
        messages: [
          {
            type: "text",
            text
          }
        ]
      })
    });

    const responseText = await lineResponse.text();
    recipientBatch.forEach((recipient) => {
      results.push({
        caregiverId: recipient.caregiverId,
        patientId: recipient.patientId,
        doctorId: recipient.doctorId,
        lineUserId: recipient.lineUserId,
        ok: lineResponse.ok,
        status: lineResponse.status,
        error: lineResponse.ok ? null : responseText
      });
    });
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    setJson(response, 502, {
      error: `LINE 部分或全部發送失敗：成功 ${results.length - failed.length} 位，失敗 ${failed.length} 位。`,
      sentCount: results.length - failed.length,
      failedCount: failed.length,
      attemptedCount: results.length,
      results
    });
    return;
  }

  setJson(response, 200, {
    sentCount: results.length,
    failedCount: 0,
    attemptedCount: results.length,
    results
  });
}
