"use strict";

const crypto = require("node:crypto");

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function enabled(value, defaultValue = false) {
  if (value === undefined || value === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, text };
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, text };
  }
}

function dingTalkSign(secret) {
  const timestamp = Date.now().toString();
  const sign = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
  return { timestamp, sign: encodeURIComponent(sign) };
}

async function consoleNotify(title, content) {
  console.log(`\n${title}\n\n${content}`);
}

async function wxPusher(title, content) {
  const token = env("WXPUSHER_APP_TOKEN");
  const uids = env("WXPUSHER_UID")
    .split("&")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!token || !uids.length) return false;

  for (const uid of uids) {
    const result = await postJson("https://wxpusher.zjiecode.com/api/send/message", {
      appToken: token,
      content: `${title}\n\n${content}`,
      contentType: 3,
      topicIds: [],
      uids: [uid],
    });
    console.log(result.code === 1000 ? `WxPusher 推送成功：${uid}` : `WxPusher 推送失败：${JSON.stringify(result)}`);
  }
  return true;
}

async function pushPlus(title, content) {
  const token = env("PUSH_PLUS_TOKEN");
  if (!token) return false;

  const result = await postJson("http://www.pushplus.plus/send", {
    token,
    title,
    content,
    topic: env("PUSH_PLUS_USER"),
  });
  console.log(result.code === 200 ? "PushPlus 推送成功" : `PushPlus 推送失败：${JSON.stringify(result)}`);
  return true;
}

async function weComBot(title, content) {
  const key = env("QYWX_KEY");
  if (!key) return false;

  const origin = env("QYWX_ORIGIN", "https://qyapi.weixin.qq.com");
  const result = await postJson(`${origin}/cgi-bin/webhook/send?key=${key}`, {
    msgtype: "text",
    text: { content: `${title}\n\n${content}` },
  });
  console.log(result.errcode === 0 ? "企业微信机器人推送成功" : `企业微信机器人推送失败：${JSON.stringify(result)}`);
  return true;
}

async function dingDing(title, content) {
  const token = env("DD_BOT_TOKEN");
  const secret = env("DD_BOT_SECRET");
  if (!token || !secret) return false;

  const { timestamp, sign } = dingTalkSign(secret);
  const url = `https://oapi.dingtalk.com/robot/send?access_token=${token}&timestamp=${timestamp}&sign=${sign}`;
  const result = await postJson(url, {
    msgtype: "text",
    text: { content: `${title}\n\n${content}` },
  });
  console.log(result.errcode === 0 ? "钉钉机器人推送成功" : `钉钉机器人推送失败：${JSON.stringify(result)}`);
  return true;
}

async function feishu(title, content) {
  const key = env("FS_KEY") || env("FSKEY");
  if (!key) return false;

  const result = await postJson(`https://open.feishu.cn/open-apis/bot/v2/hook/${key}`, {
    msg_type: "text",
    content: { text: `${title}\n\n${content}` },
  });
  console.log(result.StatusCode === 0 || result.code === 0 ? "飞书推送成功" : `飞书推送失败：${JSON.stringify(result)}`);
  return true;
}

async function bark(title, content) {
  const barkPush = env("BARK_PUSH") || env("BARK");
  if (!barkPush) return false;

  const base = barkPush.startsWith("http") ? barkPush.replace(/\/$/, "") : `https://api.day.app/${barkPush}`;
  const url = `${base}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`;
  const result = await getJson(url);
  console.log(result.code === 200 ? "Bark 推送成功" : `Bark 推送失败：${JSON.stringify(result)}`);
  return true;
}

async function sendNotify(title, content) {
  const tasks = [wxPusher, pushPlus, weComBot, dingDing, feishu, bark];
  let usedRemoteNotify = false;

  for (const task of tasks) {
    try {
      usedRemoteNotify = (await task(title, content)) || usedRemoteNotify;
    } catch (error) {
      console.log(`通知失败：${error.message}`);
    }
  }

  if (enabled(env("CONSOLE"), true) || !usedRemoteNotify) {
    await consoleNotify(title, content);
  }
}

module.exports = { sendNotify };

