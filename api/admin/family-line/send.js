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
  return recipients
    .map((recipient) => ({
      caregiverId: String(recipient?.caregiverId ?? ""),
      caregiverName: String(recipient?.caregiverName ?? ""),
      patientId: String(recipient?.patientId ?? ""),
      patientName: String(recipient?.patientName ?? ""),
      lineUserId: String(recipient?.lineUserId ?? "").trim()
    }))
    .filter((recipient) => isRequiredString(recipient.lineUserId));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!isRequiredString(channelAccessToken)) {
    setJson(response, 503, {
      error: "尚未設定 LINE_CHANNEL_ACCESS_TOKEN，無法呼叫 LINE Messaging API。"
    });
    return;
  }

  const body = request.body ?? {};
  const subject = String(body.subject ?? "").trim();
  const content = String(body.content ?? "").trim();
  const recipients = normalizeRecipients(body.recipients);

  if (!isRequiredString(subject) || !isRequiredString(content) || recipients.length === 0) {
    setJson(response, 400, { error: "LINE 發送資料不完整，請確認標題、內容與收件人。" });
    return;
  }

  const text = `${subject}\n\n${content}`;
  const results = [];
  for (const recipient of recipients) {
    const lineResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: recipient.lineUserId,
        messages: [
          {
            type: "text",
            text
          }
        ]
      })
    });

    const responseText = await lineResponse.text();
    results.push({
      caregiverId: recipient.caregiverId,
      patientId: recipient.patientId,
      ok: lineResponse.ok,
      status: lineResponse.status,
      error: lineResponse.ok ? null : responseText
    });
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    setJson(response, 502, {
      error: `LINE 部分或全部發送失敗：成功 ${results.length - failed.length} 位，失敗 ${failed.length} 位。`,
      results
    });
    return;
  }

  setJson(response, 200, {
    sentCount: results.length,
    results
  });
}
