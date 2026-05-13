import { Pool } from "@neondatabase/serverless";

const ARRIVAL_REMINDER_COOLDOWN_MS = 2 * 60 * 60 * 1000;

let poolInstance = null;
let cooldownTableEnsured = false;

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return {};
}

function getPool() {
  if (poolInstance) return poolInstance;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) return null;
  poolInstance = new Pool({ connectionString });
  return poolInstance;
}

async function query(text, params = []) {
  const pool = getPool();
  if (!pool) throw new Error("Missing DATABASE_URL/POSTGRES_URL");
  return pool.query(text, params);
}

async function ensureCooldownTable() {
  if (cooldownTableEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS line_message_send_locks (
      lock_key TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS line_message_send_locks_expires_idx ON line_message_send_locks (expires_at);");
  cooldownTableEnsured = true;
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

function isArrivalReminderMessage(body, subject, content) {
  const eventType = String(body.eventType ?? body.messageType ?? "").trim();
  if (eventType === "arrival_reminder" || eventType === "doctor_arrival_reminder") {
    return true;
  }
  return (
    subject.includes("抵達提醒") ||
    subject.includes("即將抵達") ||
    content.includes("已出發前往個案住處") ||
    content.includes("已出發前往")
  );
}

function uniquePatientIds(recipients) {
  return Array.from(
    new Set(recipients.map((recipient) => recipient.patientId).filter((patientId) => patientId.trim()))
  );
}

async function acquireArrivalReminderLocks(recipients, subject, content) {
  const patientIds = uniquePatientIds(recipients);
  if (!patientIds.length || !getPool()) {
    return {
      allowedPatientIds: new Set(patientIds),
      acquiredLockKeys: [],
      skippedPatientIds: new Set(),
      databaseBacked: Boolean(getPool())
    };
  }

  await ensureCooldownTable();
  await query("DELETE FROM line_message_send_locks WHERE expires_at < NOW() - INTERVAL '1 day';");

  const allowedPatientIds = new Set();
  const skippedPatientIds = new Set();
  const acquiredLockKeys = [];
  const expiresAt = new Date(Date.now() + ARRIVAL_REMINDER_COOLDOWN_MS).toISOString();

  for (const patientId of patientIds) {
    const lockKey = `arrival_reminder:patient:${patientId}`;
    const patientRecipientCount = recipients.filter((recipient) => recipient.patientId === patientId).length;
    const result = await query(
      `
        INSERT INTO line_message_send_locks (lock_key, sent_at, expires_at, payload)
        VALUES ($1, NOW(), $2, $3::jsonb)
        ON CONFLICT (lock_key) DO UPDATE SET
          sent_at = EXCLUDED.sent_at,
          expires_at = EXCLUDED.expires_at,
          payload = EXCLUDED.payload
        WHERE line_message_send_locks.expires_at <= NOW()
        RETURNING lock_key;
      `,
      [
        lockKey,
        expiresAt,
        JSON.stringify({
          patientId,
          subject,
          contentPreview: content.slice(0, 80),
          recipientCount: patientRecipientCount
        })
      ]
    );

    if (result.rows.length > 0) {
      allowedPatientIds.add(patientId);
      acquiredLockKeys.push(lockKey);
    } else {
      skippedPatientIds.add(patientId);
    }
  }

  return { allowedPatientIds, acquiredLockKeys, skippedPatientIds, databaseBacked: true };
}

async function releaseLocks(lockKeys) {
  if (!lockKeys.length || !getPool()) return;
  for (const lockKey of lockKeys) {
    await query("DELETE FROM line_message_send_locks WHERE lock_key = $1;", [lockKey]);
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const body = normalizeBody(request);
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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

  const isArrivalReminder = isArrivalReminderMessage(body, subject, content);
  let recipientsToSend = recipients;
  let skippedResults = [];
  let acquiredLockKeys = [];
  let cooldownApplied = false;

  if (isArrivalReminder) {
    const lockResult = await acquireArrivalReminderLocks(recipients, subject, content);
    acquiredLockKeys = lockResult.acquiredLockKeys;
    cooldownApplied = lockResult.databaseBacked;
    recipientsToSend = recipients.filter((recipient) =>
      recipient.patientId ? lockResult.allowedPatientIds.has(recipient.patientId) : true
    );
    skippedResults = recipients
      .filter((recipient) => recipient.patientId && lockResult.skippedPatientIds.has(recipient.patientId))
      .map((recipient) => ({
        caregiverId: recipient.caregiverId,
        patientId: recipient.patientId,
        doctorId: recipient.doctorId,
        lineUserId: recipient.lineUserId,
        ok: true,
        status: 200,
        skipped: true,
        error: "patient_2h_cooldown"
      }));

    if (recipientsToSend.length === 0) {
      setJson(response, 200, {
        sentCount: 0,
        failedCount: 0,
        attemptedCount: recipients.length,
        skippedCount: skippedResults.length,
        cooldownApplied,
        results: skippedResults
      });
      return;
    }
  }

  const text = `${subject}\n\n${content}`;
  const results = [];
  try {
    for (const recipientBatch of chunkRecipients(recipientsToSend, 500)) {
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
          skipped: false,
          error: lineResponse.ok ? null : responseText
        });
      });
    }
  } catch (error) {
    await releaseLocks(acquiredLockKeys);
    const message = error instanceof Error ? error.message : "LINE 發送失敗。";
    setJson(response, 502, { error: message, sentCount: 0, failedCount: recipientsToSend.length });
    return;
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    await releaseLocks(acquiredLockKeys);
    setJson(response, 502, {
      error: `LINE 部分或全部發送失敗：成功 ${results.length - failed.length} 位，失敗 ${failed.length} 位。`,
      sentCount: results.length - failed.length,
      failedCount: failed.length,
      attemptedCount: recipients.length,
      skippedCount: skippedResults.length,
      cooldownApplied,
      results: [...results, ...skippedResults]
    });
    return;
  }

  setJson(response, 200, {
    sentCount: results.length,
    failedCount: 0,
    attemptedCount: recipients.length,
    skippedCount: skippedResults.length,
    cooldownApplied,
    results: [...results, ...skippedResults]
  });
}
