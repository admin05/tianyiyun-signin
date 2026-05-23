#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const zlib = require("node:zlib");
const { sendNotify } = require("./notify");

const LOGIN_PAGE =
  "https://m.cloud.189.cn/udb/udb_login.jsp?pageId=1&pageKey=default&clientType=wap&redirectURL=https://m.cloud.189.cn/zhuanti/2021/shakeLottery/index.html";
const LOGIN_SUBMIT = "https://open.e.189.cn/api/logbox/oauth2/loginSubmit.do";
const SIGN_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 5.1.1; SM-G930K Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.136 Mobile Safari/537.36 Ecloud/8.6.3 Android/22 clientId/355325117317828 clientModel/SM-G930K imsi/460071114317824 clientChannelId/qq proVersion/1.0.6";
const B64MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";

loadEnvFile();

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function isEnabled(value, defaultValue = false) {
  if (value === undefined || value === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function readAccounts() {
  const usernames = (env("ty_username") || env("TY_USERNAME"))
    .split("&")
    .map((item) => item.trim())
    .filter(Boolean);
  const passwords = (env("ty_password") || env("TY_PASSWORD"))
    .split("&")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!usernames.length || !passwords.length) {
    throw new Error("请设置环境变量 ty_username 和 ty_password，多个账号用 & 分隔");
  }

  if (usernames.length !== passwords.length) {
    console.warn(
      `账号数量(${usernames.length})与密码数量(${passwords.length})不一致，将只处理可配对的前 ${Math.min(
        usernames.length,
        passwords.length,
      )} 个账号。`,
    );
  }

  return usernames.slice(0, passwords.length).map((username, index) => ({
    username,
    password: passwords[index],
  }));
}

function maskAccount(account) {
  if (account.length <= 7) return `${account.slice(0, 2)}****`;
  return `${account.slice(0, 3)}****${account.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function mustMatch(text, regexp, label) {
  const match = text.match(regexp);
  if (!match) throw new Error(`未找到 ${label}`);
  return match[1] || match[0];
}

class Session {
  constructor() {
    this.cookies = new Map();
  }

  addSetCookies(headers) {
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : splitSetCookie(headers.get("set-cookie"));

    for (const cookie of setCookies) {
      const pair = cookie.split(";")[0];
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  async request(url, options = {}) {
    let currentUrl = url;
    let currentOptions = { ...options };

    for (let i = 0; i < 8; i += 1) {
      const headers = new Headers(currentOptions.headers || {});
      const cookie = this.cookieHeader();
      if (cookie) headers.set("Cookie", cookie);

      const response = await fetch(currentUrl, {
        ...currentOptions,
        headers,
        redirect: "manual",
      });
      this.addSetCookies(response.headers);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      currentOptions = {
        ...currentOptions,
        method: response.status === 303 ? "GET" : currentOptions.method,
        body: response.status === 303 ? undefined : currentOptions.body,
      };
    }

    throw new Error("重定向次数过多");
  }

  async text(url, options) {
    const response = await this.request(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }

  async json(url, options) {
    const response = await this.request(url, options);
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`接口返回不是 JSON: ${text.slice(0, 160)}`);
    }
  }

  async legacyJson(url, options = {}) {
    const text = await this.legacyRequest(url, options);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`接口返回不是 JSON: ${text.slice(0, 160)}`);
    }
  }

  legacyRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const headers = { ...(options.headers || {}) };
      const cookie = this.cookieHeader();
      if (cookie) headers.Cookie = cookie;

      const request = https.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: options.method || "GET",
          headers,
          timeout: options.timeout || 15000,
        },
        (response) => {
          this.addSetCookies({
            getSetCookie: () => response.headers["set-cookie"] || [],
            get: (name) => response.headers[name.toLowerCase()],
          });

          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const buffer = Buffer.concat(chunks);
            decodeBody(buffer, response.headers["content-encoding"])
              .then((body) => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                  reject(new Error(`HTTP ${response.statusCode}: ${body}`));
                  return;
                }
                resolve(body);
              })
              .catch(reject);
          });
        },
      );

      request.on("timeout", () => request.destroy(new Error("请求超时")));
      request.on("error", reject);
      if (options.body) request.write(options.body);
      request.end();
    });
  }
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim());
}

function decodeBody(buffer, encoding = "") {
  const normalized = String(encoding).toLowerCase();
  if (normalized.includes("gzip")) {
    return new Promise((resolve, reject) =>
      zlib.gunzip(buffer, (error, result) =>
        error ? reject(error) : resolve(result.toString("utf8")),
      ),
    );
  }
  if (normalized.includes("deflate")) {
    return new Promise((resolve, reject) =>
      zlib.inflate(buffer, (error, result) =>
        error ? reject(error) : resolve(result.toString("utf8")),
      ),
    );
  }
  if (normalized.includes("br")) {
    return new Promise((resolve, reject) =>
      zlib.brotliDecompress(buffer, (error, result) =>
        error ? reject(error) : resolve(result.toString("utf8")),
      ),
    );
  }
  return Promise.resolve(buffer.toString("utf8"));
}

function int2char(value) {
  return BI_RM[value];
}

function b64ToHex(value) {
  let result = "";
  let state = 0;
  let carry = 0;

  for (const char of value) {
    if (char === "=") continue;
    const digit = B64MAP.indexOf(char);
    if (digit < 0) continue;

    if (state === 0) {
      state = 1;
      result += int2char(digit >> 2);
      carry = digit & 3;
    } else if (state === 1) {
      state = 2;
      result += int2char((carry << 2) | (digit >> 4));
      carry = digit & 15;
    } else if (state === 2) {
      state = 3;
      result += int2char(carry);
      result += int2char(digit >> 2);
      carry = digit & 3;
    } else {
      state = 0;
      result += int2char((carry << 2) | (digit >> 4));
      result += int2char(digit & 15);
    }
  }

  if (state === 1) result += int2char(carry << 2);
  return result;
}

function rsaEncode(publicKeyBody, value) {
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKeyBody}\n-----END PUBLIC KEY-----`;
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(String(value)),
  );
  return b64ToHex(encrypted.toString("base64"));
}

async function login(username, password) {
  console.log("正在执行登录流程...");
  const session = new Session();

  const tokenPage = await session.text(LOGIN_PAGE);
  const dynamicUrl = mustMatch(tokenPage, /https?:\/\/[^\s'"]+/, "动态登录页");
  const dynamicPage = await session.text(dynamicUrl);
  const loginHref = mustMatch(
    dynamicPage,
    /<a id="j-tab-login-link"[^>]*href="([^"]+)"/,
    "账号密码登录入口",
  );
  const loginPage = await session.text(loginHref);

  const captchaToken = mustMatch(loginPage, /captchaToken' value='(.+?)'/, "captchaToken");
  const lt = mustMatch(loginPage, /lt = "(.+?)"/, "lt");
  const returnUrl = mustMatch(loginPage, /returnUrl= '(.+?)'/, "returnUrl");
  const paramId = mustMatch(loginPage, /paramId = "(.+?)"/, "paramId");
  const rsaKey = mustMatch(loginPage, /j_rsaKey" value="(\S+)"/, "RSA 公钥");

  const body = new URLSearchParams({
    appKey: "cloud",
    accountType: "01",
    userName: `{RSA}${rsaEncode(rsaKey, username)}`,
    password: `{RSA}${rsaEncode(rsaKey, password)}`,
    validateCode: "",
    captchaToken,
    returnUrl,
    mailSuffix: "@189.cn",
    paramId,
  });

  const result = await session.json(LOGIN_SUBMIT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:74.0) Gecko/20100101 Firefox/76.0",
      Referer: "https://open.e.189.cn/",
      lt,
    },
    body,
  });

  if (result.result !== 0) {
    throw new Error(result.msg || "登录失败");
  }

  if (result.toUrl) await session.text(result.toUrl);
  console.log("登录成功");
  return session;
}

async function signIn(session) {
  const rand = Date.now();
  const signUrl = `https://api.cloud.189.cn/mkt/userSign.action?rand=${rand}&clientType=TELEANDROID&version=8.6.3&model=SM-G930K`;
  const headers = {
    "User-Agent": SIGN_USER_AGENT,
    Referer: "https://m.cloud.189.cn/zhuanti/2016/sign/index.jsp?albumBackupOpened=1",
    Host: "m.cloud.189.cn",
    "Accept-Encoding": "gzip, deflate",
  };

  const result = await session.legacyJson(signUrl, { headers });
  const bonus = result.netdiskBonus ?? 0;
  if (result.isSign === "false") return `成功 +${bonus}M`;
  return `已签到 +${bonus}M`;
}

async function drawPrize(session) {
  const lotteryUrl =
    "https://m.cloud.189.cn/v2/drawPrizeMarketDetails.action?taskId=TASK_SIGNIN&activityId=ACT_SIGNIN";
  const result = await session.json(lotteryUrl, {
    headers: {
      "User-Agent": SIGN_USER_AGENT,
      Referer: "https://m.cloud.189.cn/zhuanti/2016/sign/index.jsp?albumBackupOpened=1",
    },
  });

  if (result.errorCode) return `失败 ${result.errorCode}`;
  return result.prizeName || result.description || "未返回奖品";
}

async function processAccount(account) {
  const masked = maskAccount(account.username);
  const row = { username: masked, sign: "", lottery: "" };
  console.log(`\n处理账号：${masked}`);

  try {
    const session = await login(account.username, account.password);
    row.sign = await signIn(session);
    if (isEnabled(env("ENABLE_LOTTERY"))) {
      await sleep(randomInt(2000, 5000));
      row.lottery = await drawPrize(session);
    } else {
      row.lottery = "未启用";
    }
  } catch (error) {
    if (!row.sign) row.sign = "失败";
    row.lottery = error.message;
  }

  console.log(`${row.sign} | ${row.lottery}`);
  return row;
}

function buildMarkdown(results) {
  const rows = [
    "### 天翼云盘签到汇总",
    "",
    "| 账号 | 签到结果 | 每日抽奖 |",
    "|:-:|:-:|:-:|",
  ];
  for (const result of results) {
    rows.push(`| ${result.username} | ${result.sign} | ${result.lottery} |`);
  }
  return rows.join("\n");
}

async function main() {
  console.log("\n=============== 天翼云盘签到开始 ===============");
  const accounts = readAccounts();
  const results = [];

  for (const account of accounts) {
    results.push(await processAccount(account));
  }

  const message = buildMarkdown(results);
  await sendNotify("天翼云盘自动签到", message);
  console.log("\n所有账号处理完成！");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`运行失败：${error.message}`);
    process.exitCode = 1;
  });
}
