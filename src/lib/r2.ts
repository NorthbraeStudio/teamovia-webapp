import { S3Client } from "@aws-sdk/client-s3";

function readEnv(name: string): string | undefined {
  const processValue = process.env[name];
  if (processValue && processValue.trim().length > 0) {
    return processValue.trim();
  }

  return undefined;
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

    throw new Error(
      `R2 bucket is not configured. Set one of: R2_BUCKET_NAME, R2_BUCKET, CLOUDFLARE_R2_BUCKET_NAME, CLOUDFLARE_R2_BUCKET. Visible related env keys: ${
        visibleProcessEnvKeys.join(", ") || "none"
      }`
    );
  }

  return bucket;
}
