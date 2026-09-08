import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import metadata from "./token-metadata.json";

const root = resolve(import.meta.dir, "../..");
const gateway = "https://flap.mypinata.cloud/ipfs/";
export const tokenIdentity = { name: metadata.name, symbol: metadata.symbol };

export function metadataCid(value: string): string {
  if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+|bafk[a-z2-7]+)$/.test(value)) {
    throw new Error("Token metadata must be a bare IPFS CID returned by Flap");
  }
  return value;
}

export async function verifyTokenMetadata(cid = metadata.cid, request: typeof fetch = fetch) {
  let response = await request(gateway + metadataCid(cid), { signal: AbortSignal.timeout(30_000) });
  // A fresh upload can leave a cached "not pinned" response at the gateway.
  if (response.status === 403) {
    response = await request(gateway + metadataCid(cid) + `?verify=${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new Error(`Flap metadata fetch failed: ${response.status}`);
  const uploaded = await response.json();
  for (const field of ["name", "symbol", "description", "website", "twitter", "telegram", "creator"] as const) {
    if ((uploaded[field] || null) !== (metadata[field] || null)) throw new Error(`Flap metadata ${field} does not match the approved launch metadata`);
  }
  if (typeof uploaded.image !== "string") throw new Error("Flap metadata image is missing");
  const imageCid = metadataCid(uploaded.image.replace(/^ipfs:\/\//, "").split("/ipfs/").at(-1)!);
  const image = await request(gateway + imageCid, { signal: AbortSignal.timeout(30_000) });
  if (!image.ok) throw new Error(`Flap image fetch failed: ${image.status}`);
  const bytes = Buffer.from(await image.arrayBuffer());
  const original = readFileSync(resolve(root, metadata.imagePath));
  if (!bytes.equals(original)) throw new Error("Flap token image differs from the approved logo");
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    || bytes.readUInt32BE(16) !== bytes.readUInt32BE(20) || bytes.readUInt32BE(16) < 256) {
    throw new Error("Token logo must be a square PNG at least 256px wide");
  }
  return { cid, image: gateway + imageCid, width: bytes.readUInt32BE(16) };
}

async function main() {
  let cid = metadata.cid;
  if (process.argv.includes("--upload")) {
    if (cid) throw new Error("Metadata already uploaded; check it without --upload");
    const { name, symbol, description, website, twitter, telegram, creator } = metadata;
    const form = new FormData();
    form.append("operations", JSON.stringify({
      query: "mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }",
      variables: { file: null, meta: { name, symbol, description, website, twitter, telegram, creator } },
    }));
    form.append("map", JSON.stringify({ "0": ["variables.file"] }));
    form.append("0", new File([readFileSync(resolve(root, metadata.imagePath))], "doubleball.png", { type: "image/png" }));
    const response = await fetch("https://funcs.flap.sh/api/upload", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Flap upload failed: ${response.status}`);
    const result = await response.json();
    if (result.errors || typeof result.data?.create !== "string") throw new Error(`Flap upload rejected: ${JSON.stringify(result.errors)}`);
    cid = metadataCid(result.data.create);
    // Save immediately so a gateway delay never causes a duplicate upload on retry.
    writeFileSync(resolve(import.meta.dir, "token-metadata.json"), JSON.stringify({ ...metadata, cid }, null, 2) + "\n");
  }
  console.log(JSON.stringify(await verifyTokenMetadata(cid), null, 2));
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
