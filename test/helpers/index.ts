import { TransactionReceipt, AbiEventNotFoundError } from "viem";

export async function getTokenIdFromReceipt(
  artGallery: any,
  receipt: TransactionReceipt,
): Promise<bigint | null> {
  try {
    const events = await artGallery.getEvents.ArtworkListed(
      {},
      { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
    );
    const relevantEvent = events.find(
      (e: any) => e.transactionHash === receipt.transactionHash,
    );
    if (relevantEvent?.args?.tokenId !== undefined) {
      return relevantEvent.args.tokenId;
    }
  } catch (error) {
    if (error instanceof AbiEventNotFoundError) {
      console.error("ArtworkListed event ABI not found or mismatch.");
    } else {
      console.error("Error fetching ArtworkListed event:", error);
    }
  }
  return null;
}
