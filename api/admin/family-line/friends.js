import {
  ensureFamilyLineContactsTable,
  listFamilyLineContacts,
  upsertFamilyLineContact
} from "../../_lib/family-line-contacts.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function lineJson(path, channelAccessToken) {
  const lineResponse = await fetch(`https://api.line.me${path}`, {
    headers: {
      Authorization: `Bearer ${channelAccessToken}`
    }
  });
  const text = await lineResponse.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return {
    ok: lineResponse.ok,
    status: lineResponse.status,
    payload
  };
}

async function fetchFollowerIds(channelAccessToken) {
  const userIds = [];
  let next = "";

  do {
    const query = next ? `?start=${encodeURIComponent(next)}` : "";
    const result = await lineJson(`/v2/bot/followers/ids${query}`, channelAccessToken);
    if (!result.ok) {
      return result;
    }
    const ids = Array.isArray(result.payload?.userIds) ? result.payload.userIds : [];
    userIds.push(...ids);
    next = typeof result.payload?.next === "string" ? result.payload.next : "";
  } while (next);

  return {
    ok: true,
    status: 200,
    payload: { userIds }
  };
}

async function fetchProfile(userId, channelAccessToken) {
  const result = await lineJson(`/v2/bot/profile/${encodeURIComponent(userId)}`, channelAccessToken);
  if (!result.ok) {
    return {
      userId,
      displayName: userId
    };
  }
  return {
    userId,
    displayName: String(result.payload?.displayName ?? userId)
  };
}

async function enrichSavedContacts(savedContacts, channelAccessToken) {
  if (!isRequiredString(channelAccessToken) || savedContacts.length === 0) {
    return savedContacts;
  }

  const enrichedContacts = await Promise.all(
    savedContacts.map(async (contact) => {
      const profile = await fetchProfile(contact.userId, channelAccessToken);
      return upsertFamilyLineContact({
        ...profile,
        source: contact.source ?? "webhook"
      });
    })
  );

  return enrichedContacts.filter(Boolean);
}

function mergeContactsByUserId(...contactGroups) {
  const contactByUserId = new Map();
  contactGroups.flat().filter(Boolean).forEach((contact) => {
    const userId = String(contact?.userId ?? "").trim();
    if (!userId) {
      return;
    }
    const existing = contactByUserId.get(userId);
    contactByUserId.set(userId, {
      ...existing,
      ...contact,
      linkedPatientIds: contact.linkedPatientIds ?? existing?.linkedPatientIds ?? [],
      note: contact.note ?? existing?.note ?? ""
    });
  });
  return Array.from(contactByUserId.values());
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  try {
    await ensureFamilyLineContactsTable();
    const savedContacts = await listFamilyLineContacts();
    if (!isRequiredString(channelAccessToken)) {
      setJson(response, 200, {
        friends: savedContacts,
        warning: "尚未設定 LINE_CHANNEL_ACCESS_TOKEN；目前只顯示 webhook 已收集到的 LINE 好友。",
        databaseConnected: true,
        savedContactCount: savedContacts.length,
        officialFetchedCount: 0,
        returnedCount: savedContacts.length
      });
      return;
    }

    const followersResult = await fetchFollowerIds(channelAccessToken);
    if (!followersResult.ok) {
      const isAccountPlanBlocked = followersResult.status === 403;
      const contacts = isAccountPlanBlocked
        ? await enrichSavedContacts(savedContacts, channelAccessToken)
        : undefined;
      setJson(response, isAccountPlanBlocked ? 200 : 502, {
        friends: contacts,
        warning: isAccountPlanBlocked
          ? "LINE 官方帳號好友名單 API 僅支援認證或 Premium 官方帳號；目前帳號可能無法直接讀取完整好友名單。"
          : undefined,
        error: isAccountPlanBlocked ? undefined : "LINE 官方帳號好友名單同步失敗。",
        databaseConnected: true,
        savedContactCount: savedContacts.length,
        officialFetchedCount: 0,
        returnedCount: contacts?.length ?? 0,
        lineStatus: followersResult.status,
        linePayload: followersResult.payload
      });
      return;
    }

    const userIds = Array.isArray(followersResult.payload.userIds)
      ? followersResult.payload.userIds
      : [];
    const friends = await Promise.all(
      userIds.map((userId) => fetchProfile(String(userId), channelAccessToken))
    );
    const savedFriends = await Promise.all(
      friends.map((friend) =>
        upsertFamilyLineContact({
          ...friend,
          source: "official_friend"
        })
      )
    );

    const mergedFriends = mergeContactsByUserId(savedContacts, savedFriends);
    setJson(response, 200, {
      friends: mergedFriends,
      databaseConnected: true,
      savedContactCount: savedContacts.length,
      officialFetchedCount: friends.length,
      returnedCount: mergedFriends.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    setJson(response, message.includes("DATABASE_URL") ? 503 : 502, {
      error: message.includes("DATABASE_URL")
        ? "LINE 名單資料庫尚未完成設定，請先配置 Neon / Vercel Postgres。"
        : "無法連線到 LINE Messaging API，請稍後再試。"
    });
  }
}
