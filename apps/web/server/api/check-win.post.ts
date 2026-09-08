import { checkTicketWin } from "../utils/contract";
import { parseBlueBall, parseRedBalls } from "../utils/apiValidation";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "Request body must be an object" });
  }

  const { ticketRed, ticketBlue, winningRed, winningBlue } = body;

  const parsedTicketRed = parseRedBalls(ticketRed, "ticketRed");
  const parsedTicketBlue = parseBlueBall(ticketBlue, "ticketBlue");
  const parsedWinningRed = parseRedBalls(winningRed, "winningRed");
  const parsedWinningBlue = parseBlueBall(winningBlue, "winningBlue");

  const result = checkTicketWin(parsedTicketRed, parsedTicketBlue, parsedWinningRed, parsedWinningBlue);

  return {
    success: true,
    ...result,
    isWinner: result.tier > 0,
  };
});
