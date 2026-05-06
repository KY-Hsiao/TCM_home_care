function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isConfigured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  setJson(response, 200, {
    ok: true,
    variables: {
      LINE_CHANNEL_ACCESS_TOKEN: isConfigured(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      LINE_CHANNEL_SECRET: isConfigured(process.env.LINE_CHANNEL_SECRET),
      GOOGLE_MAPS_API_KEY:
        isConfigured(process.env.GOOGLE_MAPS_API_KEY) ||
        isConfigured(process.env.VITE_GOOGLE_MAPS_API_KEY),
      GOOGLE_CALENDAR_ID: isConfigured(process.env.GOOGLE_CALENDAR_ID),
      GOOGLE_DRIVE_ACCESS_TOKEN: isConfigured(process.env.GOOGLE_DRIVE_ACCESS_TOKEN),
      GOOGLE_DRIVE_FOLDER_ID: isConfigured(process.env.GOOGLE_DRIVE_FOLDER_ID)
    }
  });
}
