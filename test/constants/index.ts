import { parseEther } from "viem";

export const TEST_CONSTANTS = {
  URI: {
    TEST_1: "ipfs://QmTestHash1",
    TEST_2: "ipfs://QmTestHash2",
    TEST_3: "ipfs://QmTestHash3",
  },
  PRICES: {
    ONE_ETHER: parseEther("1"),
    TWO_ETHER: parseEther("2"),
    POINT_FIVE_ETHER: parseEther("0.5"),
  },
  FEES: {
    DEFAULT_ROYALTY_FEE: 0n,
    MAX_ROYALTY_FEE: 5000n,
    SAMPLE_ROYALTY_FEE_BPS: 500n,
  },
  TOKENS: {
    NON_EXISTENT_ID: 999n,
  },
  MAX_PRICE: {
    DEFAULT: parseEther("1000"),
  },
};
