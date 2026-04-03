import { S3Client } from "@aws-sdk/client-s3";
import { loadEnvConfig } from "@next/env";
import fs from "fs";
import path from "path";

let envLoaded = false;
let fileEnvCache: Record<string, string> | null = null;

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['\"]|['\"]$/g, "");
    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function loadEnvFromFiles(): Record<string, string> {
  if (fileEnvCache) return fileEnvCache;

  const roots = Array.from(
    new Set([process.cwd(), process.env.INIT_CWD, process.env.PWD].filter(Boolean) as string[])
  );

  const merged: Record<string, string> = {};
  for (const root of roots) {
    for (const fileName of [".env", ".env.local"]) {
      const filePath = path.join(root, fileName);
      if (!fs.existsSync(filePath)) continue;
      try {
        Object.assign(merged, parseEnvFile(fs.readFileSync(filePath, "utf8")));
      } catch {
        // Ignore unreadable env files and continue with other sources.
      }
    }
  }

  fileEnvCache = merged;
  return merged;
}

function readEnv(name: string): string | undefined {
  const processValue = process.env[name];
  if (processValue && processValue.trim().length > 0) {
    return processValue.trim();
  }

  const fileValue = loadEnvFromFiles()[name];
  if (fileValue && fileValue.trim().length > 0) {
    return fileValue.trim();
  }

  return undefined;
}

function ensureEnvLoaded() {
  if (envLoaded) return;
  loadEnvConfig(process.cwd());
  envLoaded = true;
}

function getNormalizedEndpoint(rawEndpoint: string): string {
  try {
    const parsed = new URL(rawEndpoint);
    // S3 client endpoint must be origin only; path segments are not part of endpoint.
    return parsed.origin;
  } catch {
    return rawEndpoint;
  }
}

function getBucketFromEndpointPath(rawEndpoint: string | undefined): string | undefined {
  if (!rawEndpoint) return undefined;
  try {
    const parsed = new URL(rawEndpoint);
    const bucketFromPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return bucketFromPath || undefined;
  } catch {
    return undefined;
  }
}

export function getR2Client(): S3Client {
  ensureEnvLoaded();

  const endpoint = readEnv("R2_ENDPOINT");
  const accessKeyId = readEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY");

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials are not configured. Ensure R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: getNormalizedEndpoint(endpoint),
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function getR2Bucket(): string {
  ensureEnvLoaded();

  const bucketCandidates = [
    readEnv("R2_BUCKET_NAME"),
    readEnv("R2_BUCKET"),
    readEnv("CLOUDFLARE_R2_BUCKET_NAME"),
    readEnv("CLOUDFLARE_R2_BUCKET"),
    getBucketFromEndpointPath(readEnv("R2_ENDPOINT")),
  ];

  const bucket = bucketCandidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  )?.trim();

  if (!bucket) {
    const visibleProcessEnvKeys = Object.keys(process.env)
      .filter((key) => key.includes("R2") || key.includes("BUCKET"))
      .sort();
    const visibleFileEnvKeys = Object.keys(loadEnvFromFiles())
      .filter((key) => key.includes("R2") || key.includes("BUCKET"))
      .sort();

    throw new Error(
      `R2 bucket is not configured. Set one of: R2_BUCKET_NAME, R2_BUCKET, CLOUDFLARE_R2_BUCKET_NAME, CLOUDFLARE_R2_BUCKET. Visible related env keys: ${
        visibleProcessEnvKeys.join(", ") || "none"
      }. Visible file env keys: ${visibleFileEnvKeys.join(", ") || "none"}`
    );
  }

  return bucket;
}
