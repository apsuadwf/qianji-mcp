/** 钱迹官方 AI（Emma）客户端：把文本或小票文本转成账单建议，本模块不写入任何账单。 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const EMMA_BASE = "https://api.qianjiapp.com";
/**
 * APK 内公开的客户端签名密钥（与具体用户无关），可用 EMMA_HMAC_KEY 覆盖。
 * 用于 X-Signature = HMAC-SHA256(key, timestamp + body)，不是用户凭证。
 */
const DEFAULT_HMAC_KEY = "e63e01f8b379223e9e48cc1620c021036b18b8b4c7a436a8c75b7e565ab4d688";
const DEFAULT_KEY_FILE = "/data/.emma-key";

export type EmmaBillType = "expense" | "income" | "transfer" | "reimburse" | "credit_pay";

export interface EmmaCategoryNode {
  name: string;
  subs?: string[];
}

export interface EmmaPayloadInput {
  userId: string;
  billType: EmmaBillType;
  text: string;
  categories: EmmaCategoryNode[];
  assets: [string, string][];
  duration?: number;
  bookId?: number;
  versionName?: string;
}

/** 计算请求签名：小写十六进制 HMAC-SHA256(key, timestamp + body)。 */
export function signEmma(timestamp: string, body: string, key = process.env.EMMA_HMAC_KEY || DEFAULT_HMAC_KEY): string {
  return createHmac("sha256", key).update(timestamp + body).digest("hex").toLowerCase();
}

/** 读取 Emma API Key：优先环境变量，其次挂载文件；都没有时返回空串。 */
export function emmaApiKey(): string {
  const fromEnv = (process.env.EMMA_API_KEY ?? "").trim();
  if (fromEnv) return fromEnv;
  const file = process.env.EMMA_KEY_FILE || DEFAULT_KEY_FILE;
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/** 组装 Emma 请求体（字段顺序与官方客户端一致）。 */
export function buildEmmaPayload(input: EmmaPayloadInput): Record<string, unknown> {
  return {
    userId: input.userId,
    bookId: input.bookId ?? -1,
    versionName: input.versionName ?? "4.5.4",
    appSystem: "android",
    quotaMode: "month",
    billType: input.billType,
    text: input.text.slice(0, 4096),
    ...(input.duration === undefined ? {} : { duration: input.duration }),
    categories: input.categories,
    assets: input.assets,
  };
}

/** 调用 Emma，返回原始响应（字段为 snake_case）。 */
export async function callEmma(endpoint: "a11y2billv2" | "ocr2bill", payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiKey = emmaApiKey();
  if (!apiKey) {
    return {
      configured: false,
      message: "未配置 Emma API Key：请设置环境变量 EMMA_API_KEY，或把 key 写入挂载文件 /data/.emma-key",
    };
  }
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${EMMA_BASE}/emmav2/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-timestamp": timestamp,
      "x-signature": signEmma(timestamp, body),
    },
    body,
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, detail: parsed };
  }
  return parsed as Record<string, unknown>;
}
