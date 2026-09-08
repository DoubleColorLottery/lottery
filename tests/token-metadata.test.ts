import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { metadataCid, tokenIdentity, verifyTokenMetadata } from "../scripts/launch/metadata";
import metadata from "../scripts/launch/token-metadata.json";
import { tokenParameters } from "../scripts/launch/live";

const cid = "bafkreia4hke7y3jhr4k6hfq7we3se6xxyujb3iys3lwjm5slz2nblab5wy";
function fixture(overrides = {}, bytes = readFileSync(metadata.imagePath), status = 200) {
  let calls = 0;
  return (async () => ++calls === 1 || status !== 200
    ? Response.json({ ...metadata, image: cid, twitter: "", telegram: "", ...overrides }, { status })
    : new Response(bytes, { headers: { "content-type": "image/png" } })) as typeof fetch;
}

test("metadata identity reaches the token launch parameters", () => {
  const address = "0x0000000000000000000000000000000000000001";
  const params = tokenParameters("0x" + "00".repeat(32), address, address, cid);
  expect(params.name).toBe(tokenIdentity.name);
  expect(params.symbol).toBe(tokenIdentity.symbol);
  expect(params.name).toBe("双色球");
  expect(params.symbol).toBe("双色球");
  expect(params.meta).toBe(cid);
  expect(params.buyTaxRate).toBe(200);
  expect(params.sellTaxRate).toBe(200);
});

test("verifies the published fields and exact square PNG", async () => {
  expect((await verifyTokenMetadata(cid, fixture())).width).toBe(256);
});

test("rejects a changed description", async () => {
  await expect(verifyTokenMetadata(cid, fixture({ description: "wrong" }))).rejects.toThrow("description");
});

test("rejects a different logo", async () => {
  await expect(verifyTokenMetadata(cid, fixture({}, Buffer.from("not the logo")))).rejects.toThrow("differs");
});

test("rejects a missing or external image", async () => {
  await expect(verifyTokenMetadata(cid, fixture({ image: null }))).rejects.toThrow("missing");
  await expect(verifyTokenMetadata(cid, fixture({ image: "https://example.com/image.png" }))).rejects.toThrow("CID");
});

test("fails closed when the gateway is unavailable", async () => {
  await expect(verifyTokenMetadata(cid, fixture({}, undefined, 403))).rejects.toThrow("403");
});

test("only accepts bare metadata CIDs", () => {
  expect(metadataCid(cid)).toBe(cid);
  for (const value of ["", "https://example.com", "ipfs://" + cid, cid + "/extra"]) {
    expect(() => metadataCid(value)).toThrow("CID");
  }
});
