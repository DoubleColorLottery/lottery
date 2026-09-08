import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";

const task = {
  batchId: 0, chainId: 56,
  lotteryAddress: "0x1111111111111111111111111111111111111111",
  roundId: 1, user: "0x2222222222222222222222222222222222222222",
  batchStart: 0, batchCount: 1, overrides: {},
};
function run(name: string, input: object) {
  const result = spawnSync("bun", [`apps/web/server/workers/${name}-tickets-script.ts`, JSON.stringify(input)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const derived = run("derive", task);
assert.equal(derived.tickets.length, 1);
const ticket = derived.tickets[0];
assert.equal(new Set(ticket.redBalls).size, 6);
const processed = run("process", { ...task, winningReds: ticket.redBalls, winningBlue: ticket.blueBall });
assert.equal(processed.tickets.length, 1);
assert.equal(processed.tickets[0].tier, 1);
console.log("Runtime ticket workers passed derivation and winner processing");
