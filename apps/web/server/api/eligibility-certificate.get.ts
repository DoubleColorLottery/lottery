import { LOTTERY_ADDRESS } from "../utils/contract";
import { parseNonNegativeBigIntParam, parseWalletAddress } from "../utils/apiValidation";
import { getEligibilityCertificate } from "../utils/surrealdb";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const account = parseWalletAddress(query.address);
  const roundId = parseNonNegativeBigIntParam(query.roundId, "roundId");
  if (roundId === 0n) throw createError({ statusCode: 400, message: "roundId must be greater than zero" });
  const certificate = await getEligibilityCertificate(LOTTERY_ADDRESS, Number(roundId), account);

  if (!certificate?.signature || !certificate.eligibilitySetId) {
    throw createError({ statusCode: 404, message: "No eligibility certificate exists for this wallet and round" });
  }

  return {
    success: true,
    certificate: {
      roundId: certificate.roundId.toString(),
      account: certificate.account,
      eligibleBalance: certificate.eligibleBalance,
      ticketCount: certificate.ticketCount,
      eligibilitySetId: certificate.eligibilitySetId,
      signature: certificate.signature,
    },
  };
});
